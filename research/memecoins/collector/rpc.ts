/**
 * Read-only JSON-RPC helpers: free public endpoints first, the Helius key (from the repo
 * .env RPC_URL line ONLY — nothing else in .env is read) as a metered fallback with a
 * hard credit budget. Credit costs per Helius docs (2026-09):
 *   getTransaction / getMultipleAccounts: 1 credit
 *   getTransactionsForAddress: full = 10 credits per 100 returned (rounded up, min 10); signatures = 10 flat
 *   websocket: 2 credits per 0.1 MB streamed (+1 per connection) — NOT used by the collector.
 */
import fs from 'node:fs';
import https from 'node:https';
import zlib from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bs58 from 'bs58';
import type { RpcTx } from './decode.ts';
import type { PoolInfo } from './processor.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, '..', '..', '..');

/** Reads ONLY the RPC_URL line of the repo .env (never the private key). */
export function heliusUrl(): string | null {
  if (process.env.MEMECOINS_HELIUS_URL) return process.env.MEMECOINS_HELIUS_URL;
  try {
    const line = fs.readFileSync(path.join(REPO_ROOT, '.env'), 'utf8').split('\n').find(l => l.startsWith('RPC_URL='));
    const url = line?.slice('RPC_URL='.length).trim().replace(/^["']|["']$/g, '');
    return url && url.includes('helius') ? url : null;
  } catch { return null; }
}

export class CreditBudget {
  private hour = new Map<string, number>();
  private day = new Map<string, number>();
  total = 0;
  /** Optional persistence so hourly/daily caps survive restarts (a crash loop must not reset the budget). */
  onChange: ((state: string) => void) | null = null;
  constructor(public perHour: number, public perDay: number) {}
  load(state: string | null | undefined) {
    if (!state) return;
    try { const j = JSON.parse(state); this.hour = new Map(Object.entries(j.hour ?? {})); this.day = new Map(Object.entries(j.day ?? {})); } catch { /* ignore */ }
  }
  state() { return JSON.stringify({ hour: Object.fromEntries(this.hour), day: Object.fromEntries(this.day) }); }
  private keys() { const iso = new Date().toISOString(); return [iso.slice(0, 13), iso.slice(0, 10)]; }
  usedHour() { return this.hour.get(this.keys()[0]) ?? 0; }
  usedDay() { return this.day.get(this.keys()[1]) ?? 0; }
  canSpend(n: number) { return this.usedHour() + n <= this.perHour && this.usedDay() + n <= this.perDay; }
  spend(n: number) {
    const [h, d] = this.keys();
    this.hour.set(h, (this.hour.get(h) ?? 0) + n); this.day.set(d, (this.day.get(d) ?? 0) + n); this.total += n;
    if (this.hour.size > 48) this.hour.delete(this.hour.keys().next().value!);
    if (this.day.size > 14) this.day.delete(this.day.keys().next().value!);
    if (this.onChange) { try { this.onChange(this.state()); } catch { /* ignore */ } }
  }
}

export class RpcError extends Error { constructor(msg: string, public code?: number, public status?: number) { super(msg); } }

/** Bytes received by rpcCall: `wire` = bytes on the socket (gzip), `bytes` = decoded JSON text. */
export const rpcStats = { bytes: 0, wire: 0, calls: 0 };

const agent = new https.Agent({ keepAlive: true, maxSockets: 16 });

/** POST JSON over https with `Accept-Encoding: gzip` (Helius gzips JSON ~4.5x: a 1000-tx gTFA page 10.0 MB -> 2.2 MB). */
export function httpJson(url: string, body: string, timeoutMs: number): Promise<{ status: number; text: string; wire: number }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({ hostname: u.hostname, port: u.port || 443, path: u.pathname + u.search, method: 'POST', agent,
      headers: { 'content-type': 'application/json', 'accept-encoding': 'gzip', 'content-length': Buffer.byteLength(body) } }, (res) => {
      let wire = 0;
      res.on('data', (c: Buffer) => { wire += c.length; });
      const enc = String(res.headers['content-encoding'] ?? '');
      const stream = enc.includes('gzip') ? res.pipe(zlib.createGunzip()) : enc.includes('deflate') ? res.pipe(zlib.createInflate()) : res;
      const chunks: Buffer[] = [];
      stream.on('data', (c: Buffer) => chunks.push(c));
      stream.on('end', () => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString('utf8'), wire }));
      stream.on('error', reject);
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`timeout after ${timeoutMs} ms`)));
    req.on('error', reject);
    req.end(body);
  });
}

export async function rpcCall<T = any>(url: string, method: string, params: unknown[], timeoutMs = 30_000): Promise<T> {
  return (await rpcCallMeta<T>(url, method, params, timeoutMs)).result;
}

/** rpcCall that also reports this call's own wire/raw bytes (concurrent callers must not use the global counters). */
export async function rpcCallMeta<T = any>(url: string, method: string, params: unknown[], timeoutMs = 30_000): Promise<{ result: T; wire: number; raw: number }> {
  const r = await httpJson(url, JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), timeoutMs);
  const text = r.text;
  rpcStats.bytes += text.length; rpcStats.wire += r.wire; rpcStats.calls++;
  let j: any;
  // Helius signals exhausted credits as HTTP 429 with the plain-text body "max usage reached" (or JSON -32429):
  // map both to code -32429 so every caller stops instead of backing off as if it were rate limiting (BUG-014 class)
  if (/max usage reached/i.test(text)) throw new RpcError(`HTTP ${r.status} max usage reached (credits exhausted)`, -32429, r.status);
  try { j = JSON.parse(text); } catch { throw new RpcError(`HTTP ${r.status} non-JSON: ${text.slice(0, 200)}`, undefined, r.status); }
  if (j.error) throw new RpcError(`${method}: ${j.error.code} ${j.error.message}`, j.error.code, r.status);
  if (r.status < 200 || r.status >= 300) throw new RpcError(`HTTP ${r.status}`, undefined, r.status);
  return { result: j.result as T, wire: r.wire, raw: text.length };
}

export const redact = (s: string) => s.replace(/api-key=[^&\s"]+/g, 'api-key=<redacted>');

/** getTransaction via the public endpoints, then (budget permitting) Helius. */
export async function fetchTx(sig: string, publicUrls: string[], helius: string | null, budget: CreditBudget): Promise<RpcTx | null> {
  const params = [sig, { encoding: 'json', maxSupportedTransactionVersion: 1, commitment: 'confirmed' }];
  for (const u of publicUrls) {
    try { const tx = await rpcCall<RpcTx | null>(u, 'getTransaction', params, 20_000); if (tx) return tx; } catch { /* next */ }
  }
  if (helius && budget.canSpend(1)) {
    budget.spend(1);
    return await rpcCall<RpcTx | null>(helius, 'getTransaction', params, 20_000);
  }
  return null;
}

/** Resolve PumpSwap pool -> (base_mint, quote_mint) from the pool account (offset 43: base, 75: quote). */
export async function fetchPools(pools: string[], publicUrls: string[], helius: string | null, budget: CreditBudget): Promise<Map<string, PoolInfo | null>> {
  const params = [pools, { encoding: 'base64', dataSlice: { offset: 43, length: 64 }, commitment: 'confirmed' }];
  let res: any = null;
  for (const u of publicUrls) { try { res = await rpcCall(u, 'getMultipleAccounts', params, 20_000); break; } catch { /* next */ } }
  if (!res && helius && budget.canSpend(1)) { budget.spend(1); res = await rpcCall(helius, 'getMultipleAccounts', params, 20_000); }
  const out = new Map<string, PoolInfo | null>();
  if (!res) return out;
  pools.forEach((p, i) => {
    const a = res.value?.[i];
    if (!a || a.owner !== 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA') { out.set(p, null); return; }
    const b = Buffer.from(a.data[0], 'base64');
    if (b.length < 64) { out.set(p, null); return; }
    out.set(p, { base: bs58.encode(b.subarray(0, 32)), quote: bs58.encode(b.subarray(32, 64)) });
  });
  return out;
}

export interface GtfaPage { data: RpcTx[]; paginationToken: string | null }

/** Credits a full-transaction gTFA page costs (10 per 100 returned, rounded up, min 10). */
export const gtfaFullCost = (returned: number) => Math.max(10, Math.ceil(returned / 100) * 10);

/**
 * Page through Helius getTransactionsForAddress (full, succeeded only, slot window, ascending).
 * Stops early (returns stoppedForBudget) if the next page could exceed the budget.
 */
export async function gtfaWindow(helius: string, address: string, fromSlot: number, toSlot: number, budget: CreditBudget,
  onPage: (txs: RpcTx[]) => void, opts: { limit?: number; maxPages?: number; commitment?: 'confirmed' | 'finalized'; pauseMs?: number } = {}) {
  const limit = opts.limit ?? 1000;
  let token: string | null = null; let pages = 0, txs = 0, credits = 0;
  do {
    const worst = gtfaFullCost(limit);
    if (!budget.canSpend(worst)) return { txs, credits, pages, complete: false, reason: 'budget' as const };
    const cfg: any = { transactionDetails: 'full', sortOrder: 'asc', limit, commitment: opts.commitment ?? 'confirmed', encoding: 'json',
      maxSupportedTransactionVersion: 1, filters: { slot: { gte: fromSlot, lte: toSlot }, status: 'succeeded' } };
    if (token) cfg.paginationToken = token;
    let page: GtfaPage | null = null;
    for (let attempt = 0; attempt < 4 && !page; attempt++) {
      try { page = await rpcCall<GtfaPage>(helius, 'getTransactionsForAddress', [address, cfg], 120_000); }
      catch (e: any) {
        if (e instanceof RpcError && e.code === -32429) throw e; // credits exhausted: never retry
        if (attempt === 3) throw e;
        await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
      }
    }
    const n = page!.data.length; const cost = gtfaFullCost(n);
    budget.spend(cost); credits += cost; txs += n; pages++;
    onPage(page!.data);
    token = page!.paginationToken;
    // A short page means the window is exhausted (Helius returns a token even on the last page;
    // following it would cost a 10-credit empty call).
    if (n < limit) break;
    if (opts.maxPages && pages >= opts.maxPages) return { txs, credits, pages, complete: false, reason: 'maxPages' as const };
    if (opts.pauseMs) await new Promise(r => setTimeout(r, opts.pauseMs));
  } while (token);
  return { txs, credits, pages, complete: true, reason: null };
}
