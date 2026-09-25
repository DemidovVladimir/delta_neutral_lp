/**
 * PumpSwap backfill for coins that graduated inside a backfill window: per graduated pool, Helius
 * getTransactionsForAddress(pool, full, succeeded) from the migration slot to migration + W.
 * (Measured: gTFA on a pool address returns only txs that write the pool — 559 txs = 559 trades for a
 * fresh pool's first minute — so the cost is ≈ 0.1 credit per real trade; read-only bot mentions are not billed.)
 *
 *   projection only (signatures, 10 credits per ≤1000 sigs per sampled pool):
 *     node --import tsx backfill-pools.ts --job=pumpswap7d --window-min=1440 --sample=12 --projection-only
 *   run (resumable, gzip, throttled):
 *     node --import tsx backfill-pools.ts --job=pumpswap7d --window-min=1440 --max-credits=N [--workers=3] [--max-mbps=8]
 *   graduates are read from `migrations` within --from-slot..--to-slot (default: the pump7d job's range).
 */
import fs from 'node:fs';
import path from 'node:path';
import { extractTxEvents, type RpcTx } from './decode.ts';
import { Processor } from './processor.ts';
import { heliusUrl, rpcCall, rpcCallMeta, RpcError, rpcStats } from './rpc.ts';
import { Store } from './store.ts';

const argv = process.argv.slice(2);
const opt = (n: string, d = '') => { const a = argv.find(x => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const DATA = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'data');
const JOB = opt('job', 'pumpswap7d');
const WINDOW_SLOTS = Math.round(Number(opt('window-min', '1440')) * 60 / 0.2664);
const MAX_CREDITS = Number(opt('max-credits', '0'));
const WORKERS = Number(opt('workers', '3'));
const MAX_BPS = Number(opt('max-mbps', '8')) * 1e6;
const LOG = path.join(DATA, `backfill-${JOB}.log`);
const HELIUS = heliusUrl(); if (!HELIUS) throw new Error('no Helius RPC_URL in .env');
function log(m: string) { const line = `[${new Date().toISOString()}] ${m}\n`; fs.appendFileSync(LOG, line); process.stdout.write(line); }

const store = new Store(opt('db', path.join(DATA, 'memecoins.db')));
store.db.exec(`CREATE TABLE IF NOT EXISTS backfill_units(job TEXT NOT NULL, address TEXT NOT NULL, mint TEXT, from_slot INTEGER, to_slot INTEGER,
  status TEXT NOT NULL, token TEXT, credits INTEGER DEFAULT 0, txs INTEGER DEFAULT 0, trades INTEGER DEFAULT 0, attempts INTEGER DEFAULT 0,
  error TEXT, started_at INTEGER, finished_at INTEGER, PRIMARY KEY(job, address))`);
const pumpJob = store.db.prepare("SELECT from_slot, to_slot FROM backfill_jobs WHERE name = 'pump7d'").get() as any;
const FROM = Number(opt('from-slot', String(pumpJob?.from_slot ?? 0))), TO = Number(opt('to-slot', String(pumpJob?.to_slot ?? 0)));
const grads = store.db.prepare(`SELECT mint, pool, slot FROM migrations WHERE kind = 'migrate' AND pool IS NOT NULL AND slot BETWEEN ? AND ? ORDER BY slot DESC`).all(FROM, TO) as any[];
log(`${grads.length} graduates with a known pool in slots ${FROM}..${TO}; window ${WINDOW_SLOTS} slots (${opt('window-min', '1440')} min)`);

// ------------------------------------------------------------------ projection (signatures only)
if (argv.includes('--projection-only')) {
  const tip = await rpcCall<number>('https://api.mainnet-beta.solana.com', 'getSlot', [{ commitment: 'finalized' }]);
  const full = grads.filter(g => g.slot + WINDOW_SLOTS < tip - 100);   // only graduates whose whole window is in the past
  const n = Math.min(Number(opt('sample', '12')), full.length);
  // spread the sample over the list (different days / hours)
  const sample = Array.from({ length: n }, (_, i) => full[Math.floor((i + 0.5) * full.length / n)]);
  let spent = 0; const counts: number[] = [];
  for (const g of sample) {
    let token: string | null = null, sigs = 0, pages = 0;
    const to = Math.min(g.slot + WINDOW_SLOTS, tip - 100);
    do {
      const cfg: any = { transactionDetails: 'signatures', sortOrder: 'asc', limit: 1000, filters: { slot: { gte: g.slot, lte: to }, status: 'succeeded' } };
      if (token) cfg.paginationToken = token;
      let r: any = null;
      for (let a = 0; a < 8 && !r; a++) { try { r = await rpcCall(HELIUS!, 'getTransactionsForAddress', [g.pool, cfg], 60_000); } catch (e: any) { if (a === 7) throw e; await new Promise(res => setTimeout(res, 2000 * (a + 1))); } }
      spent += 10; pages++; sigs += r.data.length;
      token = r.data.length < 1000 ? null : r.paginationToken;
    } while (token && pages < 200);
    counts.push(sigs);
    log(`sample ${g.pool} (mint ${g.mint}) migrated slot ${g.slot}: ${sigs} succeeded txs in window${to < g.slot + WINDOW_SLOTS ? ' (window truncated at tip)' : ''}`);
  }
  const avg = counts.reduce((a, b) => a + b, 0) / Math.max(1, counts.length);
  const sorted = [...counts].sort((a, b) => a - b);
  const perPool = Math.ceil(avg / 100) * 10;
  log(`PROJECTION ${JSON.stringify({ graduates: grads.length, sampled: counts.length, avgTxs: Math.round(avg), medianTxs: sorted[sorted.length >> 1], maxTxs: sorted[sorted.length - 1],
    creditsPerPool: perPool, projectedCredits: perPool * grads.length, samplingCredits: spent })}`);
  store.close(); process.exit(0);
}

// ------------------------------------------------------------------ run
if (!MAX_CREDITS) throw new Error('--max-credits is required for a run');
const ins = store.db.prepare(`INSERT OR IGNORE INTO backfill_units(job, address, mint, from_slot, to_slot, status) VALUES (?,?,?,?,?,'pending')`);
store.db.transaction(() => { for (const g of grads) ins.run(JOB, g.pool, g.mint, g.slot, g.slot + WINDOW_SLOTS); })();
store.db.prepare("UPDATE backfill_units SET status = 'pending' WHERE job = ? AND status = 'running'").run(JOB);
fs.writeFileSync(path.join(DATA, `backfill-${JOB}.pid`), String(process.pid));
const scope = new Set<string>(grads.map(g => g.pool));
const processor = new Processor(store, async () => new Map());
processor.ammFilter = (pool) => scope.has(pool);
for (const g of grads) processor.pools.set(g.pool, { base: g.mint, quote: 'So11111111111111111111111111111111111111112' });
for (const r of store.db.prepare('SELECT pool, base_mint, quote_mint FROM pools WHERE pool IN (SELECT address FROM backfill_units WHERE job = ?)').all(JOB) as any[])
  processor.pools.set(r.pool, { base: r.base_mint, quote: r.quote_mint });

let tokens = MAX_BPS * 2, lastRefill = Date.now();
async function throttle() { for (;;) { const now = Date.now(); tokens = Math.min(MAX_BPS * 2, tokens + (now - lastRefill) / 1000 * MAX_BPS); lastRefill = now; if (tokens > 0) return; await new Promise(r => setTimeout(r, Math.min(2000, (-tokens / MAX_BPS) * 1000 + 50))); } }
let stopping = false, stopReason = '';
const spentTotal = () => (store.db.prepare('SELECT coalesce(sum(credits), 0) AS c FROM backfill_units WHERE job = ?').get(JOB) as any).c as number;
const next = store.db.prepare(`UPDATE backfill_units SET status = 'running', attempts = attempts + 1, started_at = ? WHERE job = ? AND address =
  (SELECT address FROM backfill_units WHERE job = ? AND status = 'pending' ORDER BY from_slot DESC LIMIT 1) RETURNING *`);
const t0 = Date.now(), w0 = rpcStats.wire;
async function worker() {
  while (!stopping) {
    const u = next.get(Date.now(), JOB, JOB) as any; if (!u) return;
    let token: string | null = u.token;
    try {
      for (;;) {
        if (stopping) { store.db.prepare("UPDATE backfill_units SET status = 'pending', token = ? WHERE job = ? AND address = ?").run(token, JOB, u.address); break; }
        if (spentTotal() + 10 > MAX_CREDITS) { stopping = true; stopReason = `credit cap ${MAX_CREDITS}`; continue; }
        await throttle();
        const cfg: any = { transactionDetails: 'full', sortOrder: 'asc', limit: 1000, commitment: 'finalized', encoding: 'json', maxSupportedTransactionVersion: 1,
          filters: { slot: { gte: u.from_slot, lte: u.to_slot }, status: 'succeeded' } };
        if (token) cfg.paginationToken = token;
        const m = await rpcCallMeta<{ data: RpcTx[]; paginationToken: string | null }>(HELIUS!, 'getTransactionsForAddress', [u.address, cfg], 180_000);
        const page = m.result; tokens -= m.wire;
        const n = page.data.length, cost = Math.max(10, Math.ceil(n / 100) * 10);
        const before = processor.counts['amm.trade'] ?? 0;
        for (const tx of page.data) { if (!tx.meta || tx.meta.err) continue; const { events } = extractTxEvents(tx); if (events.length) processor.handleTx(tx.transaction.signatures[0], tx.slot, events, 2, tx.transactionIndex ?? null); }
        store.flush();
        token = n < 1000 ? null : page.paginationToken;
        store.db.prepare('UPDATE backfill_units SET token = ?, credits = credits + ?, txs = txs + ?, trades = trades + ? WHERE job = ? AND address = ?')
          .run(token, cost, n, (processor.counts['amm.trade'] ?? 0) - before, JOB, u.address);
        if (!token) { store.db.prepare("UPDATE backfill_units SET status = 'done', finished_at = ? WHERE job = ? AND address = ?").run(Date.now(), JOB, u.address); break; }
      }
    } catch (e: any) {
      const msg = String(e?.message ?? e).replace(/api-key=[^&\s"]+/g, 'api-key=<redacted>').slice(0, 200);
      store.db.prepare('UPDATE backfill_units SET status = ?, token = ?, error = ? WHERE job = ? AND address = ?').run(u.attempts >= 3 ? 'error' : 'pending', token, msg, JOB, u.address);
      if (e instanceof RpcError && e.code === -32429) { stopping = true; stopReason = 'Helius credits exhausted'; }
      log(`unit ${u.address} failed: ${msg}`);
    }
  }
}
const prog = () => {
  const q = store.db.prepare(`SELECT count(*) AS n, sum(status = 'done') AS done, sum(status = 'error') AS err, sum(credits) AS credits, sum(txs) AS txs, sum(trades) AS trades FROM backfill_units WHERE job = ?`).get(JOB) as any;
  log(`PROGRESS ${JSON.stringify({ ...q, cap: MAX_CREDITS, wireMBps: +((rpcStats.wire - w0) / 1e6 / ((Date.now() - t0) / 1000)).toFixed(2) })}`);
};
process.on('SIGTERM', () => { stopping = true; stopReason = 'SIGTERM'; });
const timer = setInterval(prog, 60_000);
await Promise.all(Array.from({ length: WORKERS }, () => worker()));
clearInterval(timer); prog();
log(`finished: ${stopping ? 'stopped: ' + stopReason : 'done'}`);
store.close(); try { fs.unlinkSync(path.join(DATA, `backfill-${JOB}.pid`)); } catch { /* ignore */ }
process.exit(0);
