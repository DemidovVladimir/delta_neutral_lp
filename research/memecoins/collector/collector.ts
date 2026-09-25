/**
 * Memecoin trade collector — pump.fun bonding curve + PumpSwap AMM, every trade, live.
 *
 * Source of truth: `logsSubscribe` (mentions = program id) on FREE public Solana websocket
 * endpoints (0 Helius credits). Each successful tx's `Program data:` events are decoded
 * with the official pump-public-docs IDLs. Extras:
 *   - truncated logs  -> re-fetch the tx (public RPC first) and decode the self-CPI events
 *   - unknown PumpSwap pool -> resolve base/quote mint from the pool account
 *   - websocket gaps (reconnects) -> recorded in `gaps`; optionally filled with Helius
 *     getTransactionsForAddress under a hard credit budget (default 1500/h, 5000/day)
 *   - PumpPortal free feed (new tokens + migrations) as an independent cross-check
 *   - tx_index: each slot's block signature list (getBlock, transactionDetails=signatures, free
 *     public RPC) gives every trade its position in the block
 *   - token metadata JSON fetched from each new coin's uri (best-effort, async)
 *
 * Strictly read-only: no wallet, no transactions. Run: node --import tsx collector.ts [flags]
 */
import fs from 'node:fs';
import path from 'node:path';
import WebSocket from 'ws';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { extractLogEvents, extractTxEvents, PUMP_AMM_PROGRAM, PUMP_PROGRAM, tradeEventKeys } from './decode.ts';
import { Processor } from './processor.ts';
import { CreditBudget, fetchPools, fetchTx, gtfaWindow, heliusUrl, redact, RpcError } from './rpc.ts';
import { Store, type EventRow, type TradeRow } from './store.ts';
import { rpcCall } from './rpc.ts';
import { PoolTracker } from './pools.ts';
import { loadChainRows, solve, writeSeq } from './chain.ts';

// ---------------------------------------------------------------- config
const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(`--${name}`);
const opt = (name: string, dflt: string) => { const a = argv.find(x => x.startsWith(`--${name}=`)); return a ? a.slice(name.length + 3) : dflt; };
const DATA_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'data');
const CFG = {
  db: opt('db', path.join(DATA_DIR, 'memecoins.db')),
  log: opt('log', ''),                                  // '' = stdout
  logMaxMb: Number(opt('log-max-mb', '20')),
  venues: opt('venues', 'pump').split(','),               // program-wide sockets; 'amm' = ALL PumpSwap trades (~4.4 GB/h, off since v3)
  amm: opt('amm', 'graduates'),                           // 'graduates' = only pools of coins that graduate while we collect; 'off'
  ammLogsMin: Number(opt('amm-logs-min', '1')),           // trade-level (per-pool logs) window after migration, minutes (~6 MB/graduate/min)
  armRealTokens: Number(opt('arm-real-tokens', '119000000000000')), // pre-subscribe the future pool when real curve tokens <= this (≈85 % sold)
  poolTrackHours: Number(opt('pool-track-hours', '78')),  // reserve-state polling horizon after migration (72 h max hold + 6 h entry offset)
  chainAuditMin: Number(opt('chain-audit-min', '5')),
  // 'confirmed' (measured best). At 'finalized' mainnet-beta still delivered never-landed "phantom" txs AND missed
  // ~0.5 % of pump trades (169 in 12 min, found by the reserve chain and refilled). Phantoms (up to ~18/min) are removed
  // by the online reserve-chain audit (getTransaction == null on every endpoint).
  commitment: opt('commitment', 'confirmed'),     // online G1 reserve-chain audit + intra-slot order (seq) + phantom removal
  wsUrls: opt('ws', 'wss://api.mainnet-beta.solana.com,wss://solana-rpc.publicnode.com').split(','),
  httpUrls: opt('http', 'https://api.mainnet-beta.solana.com,https://solana-rpc.publicnode.com').split(','),
  // getBlock (tx_index) load is kept OFF the primary websocket host: mainnet-beta dropped the PumpSwap socket
  // about once a minute while it also served ~2 getBlock/s from the same IP.
  blockUrls: opt('block-http', 'https://solana-rpc.publicnode.com').split(','),
  pumpportal: !flag('no-pumpportal'),
  gapFill: !flag('no-gap-fill'),
  creditsPerHour: Number(opt('helius-credits-per-hour', '6000')),
  creditsPerDay: Number(opt('helius-credits-per-day', '25000')),   // coordinator cap: <= 30k/day total incl. manual verification
  minFreeGb: Number(opt('min-free-gb', '20')),
  durationMin: Number(opt('duration-min', '0')),         // 0 = run forever
  heartbeatSec: Number(opt('heartbeat-sec', '60')),
  txIndex: flag('tx-index'),                             // OPT-IN since v3: getBlock(signatures) per slot costs ~1.35 GB/h; per-coin order comes from the reserve chain (seq)
  meta: !flag('no-meta'),                               // fetch token metadata JSON from uri
  auditMin: Number(opt('audit-min', '120')),            // periodic completeness audit vs Helius (0 = off); ~100 credits each
  lockFile: opt('lock', path.join(DATA_DIR, 'collector.lock')),
};
const HELIUS = heliusUrl();
const budget = new CreditBudget(CFG.creditsPerHour, CFG.creditsPerDay);

// ---------------------------------------------------------------- logging (size-capped rotation)
let logBytes = 0;
function log(msg: string) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  if (!CFG.log) { process.stdout.write(line); return; }
  try {
    if (logBytes === 0 && fs.existsSync(CFG.log)) logBytes = fs.statSync(CFG.log).size;
    if (logBytes > CFG.logMaxMb * 1e6) {
      for (let i = 2; i >= 1; i--) if (fs.existsSync(`${CFG.log}.${i}`)) fs.renameSync(`${CFG.log}.${i}`, `${CFG.log}.${i + 1}`);
      fs.renameSync(CFG.log, `${CFG.log}.1`); logBytes = 0;
    }
    fs.appendFileSync(CFG.log, line); logBytes += line.length;
  } catch { process.stdout.write(line); }
}
const throttled = new Map<string, number>();
function logThrottled(key: string, msg: string, everyMs = 60_000) {
  const last = throttled.get(key) ?? 0;
  if (Date.now() - last > everyMs) { throttled.set(key, Date.now()); log(msg); }
}

// ---------------------------------------------------------------- single-instance lock
fs.mkdirSync(path.dirname(CFG.lockFile), { recursive: true });
if (fs.existsSync(CFG.lockFile)) {
  const other = Number(fs.readFileSync(CFG.lockFile, 'utf8').trim());
  let alive = false; try { if (other) { process.kill(other, 0); alive = true; } } catch { /* dead */ }
  if (alive && other !== process.pid) { log(`another collector is running (pid ${other}); exiting`); process.exit(3); }
}
fs.writeFileSync(CFG.lockFile, String(process.pid));

// ---------------------------------------------------------------- core objects
const store = new Store(CFG.db);
// Helius caps are shared by all runs of the collector: usage is persisted in meta and reloaded on start.
budget.load((store.db.prepare("SELECT v FROM meta WHERE k = 'helius_budget'").get() as { v: string } | undefined)?.v);
budget.onChange = (st) => store.db.prepare("INSERT OR REPLACE INTO meta(k, v) VALUES ('helius_budget', ?)").run(st);

/**
 * Attaches tx_index (position of the transaction inside its block) to live rows: rows wait per
 * slot until that slot's block signature list is fetched (free public RPC, alternating endpoints),
 * or are written with tx_index NULL after 60 s. Rows that already carry an index (gTFA) pass through.
 */
class BlockIndexer {
  private pending = new Map<number, { trades: TradeRow[]; events: EventRow[]; firstAt: number; nextAt: number; tries: number; inflight: boolean }>();
  private cache = new Map<number, Map<string, number>>();
  private rr = 0; private cooldown = new Map<string, number>(); private inflight = 0;
  stats = { blocks: 0, resolvedRows: 0, unresolvedRows: 0, errors: 0, kb: 0 };
  add(slot: number, trades: TradeRow[], events: EventRow[]) {
    const known = this.cache.get(slot);
    if (known) { this.apply(known, trades, events); return; }
    const p = this.pending.get(slot) ?? { trades: [], events: [], firstAt: Date.now(), nextAt: Date.now() + 1500, tries: 0, inflight: false };
    p.trades.push(...trades); p.events.push(...events);
    this.pending.set(slot, p);
  }
  private apply(map: Map<string, number>, trades: TradeRow[], events: EventRow[]) {
    // A tx that the websocket reported at `confirmed` but that is absent from the confirmed block is suspect:
    // validation found such rows were never landed (getTransaction -> null) and broke the reserve chains. They are
    // held back and verified by getTransaction before being stored (or dropped). Storing them would also block the
    // real row via the (sig, idx) dedupe if the tx later lands in another slot.
    const okT: TradeRow[] = [], okE: EventRow[] = [];
    for (const t of trades) { const i = map.get(t.sig); if (i === undefined) phantoms.hold(t.sig, [t], []); else { t.txIndex = i; okT.push(t); this.stats.resolvedRows++; } }
    for (const e of events) { const i = map.get(e.sig); if (i === undefined) phantoms.hold(e.sig, [], [e]); else { e.txIndex = i; okE.push(e); } }
    if (okT.length) store.addTrades(okT);
    if (okE.length) store.addEvents(okE);
  }
  pendingRows() { let n = 0; for (const p of this.pending.values()) n += p.trades.length + p.events.length; return n; }
  private giveUp(slot: number) {
    const p = this.pending.get(slot); if (!p) return;
    this.pending.delete(slot);
    this.stats.unresolvedRows += p.trades.length;
    if (p.trades.length) store.addTrades(p.trades);
    if (p.events.length) store.addEvents(p.events);
  }
  drain() { for (const slot of [...this.pending.keys()]) this.giveUp(slot); }
  private url(): string | null {
    for (let k = 0; k < CFG.blockUrls.length; k++) {
      const u = CFG.blockUrls[(this.rr++) % CFG.blockUrls.length];
      if ((this.cooldown.get(u) ?? 0) <= Date.now()) return u;
    }
    return null;
  }
  async fetch(slot: number) {
    const p = this.pending.get(slot); if (!p) return;
    const u = this.url(); if (!u) return;
    p.inflight = true; this.inflight++;
    try {
      const blk = await rpcCall<{ signatures: string[] } | null>(u, 'getBlock', [slot, { encoding: 'json', transactionDetails: 'signatures', rewards: false, maxSupportedTransactionVersion: 1, commitment: 'confirmed' }], 20_000);
      if (!blk?.signatures) throw new Error('empty block');
      const map = new Map<string, number>(); blk.signatures.forEach((sg, i) => map.set(sg, i));
      this.stats.blocks++; this.stats.kb += blk.signatures.length * 0.09;
      this.cache.set(slot, map);
      if (this.cache.size > 200) this.cache.delete(this.cache.keys().next().value!);
      const cur = this.pending.get(slot); this.pending.delete(slot);
      if (cur) this.apply(map, cur.trades, cur.events);
    } catch (e: any) {
      this.stats.errors++;
      if (e instanceof RpcError && (e.status === 429 || e.code === 429)) this.cooldown.set(u, Date.now() + 10_000);
      const cur = this.pending.get(slot);
      if (cur) { cur.tries++; cur.inflight = false; cur.nextAt = Date.now() + 2000; }
      logThrottled('blockidx', `[txindex] getBlock ${slot} via ${u}: ${redact(String(e?.message ?? e)).slice(0, 160)}`);
    } finally { this.inflight--; }
  }
  tick() {
    const now = Date.now();
    for (const [slot, p] of this.pending) {
      if (now - p.firstAt > 60_000) { this.giveUp(slot); continue; }
      if (!p.inflight && p.nextAt <= now && this.inflight < 4) void this.fetch(slot);
    }
  }
}
const indexer = new BlockIndexer();

/** Rows whose tx was not in its confirmed block: verify with getTransaction, store with the real slot or drop. */
class PhantomChecker {
  private held = new Map<string, { trades: TradeRow[]; events: EventRow[]; attempts: number; nextAt: number }>();
  stats = { held: 0, confirmed: 0, dropped: 0 };
  hold(sig: string, trades: TradeRow[], events: EventRow[]) {
    const h = this.held.get(sig) ?? { trades: [], events: [], attempts: 0, nextAt: Date.now() + 20_000 };
    if (!this.held.has(sig)) this.stats.held++;
    h.trades.push(...trades); h.events.push(...events); this.held.set(sig, h);
  }
  size() { return this.held.size; }
  private running = false;
  async tick() {
    if (this.running) return; this.running = true;
    try { await this.tickInner(); } finally { this.running = false; }
  }
  private async tickInner() {
    const now = Date.now(); let n = 0;
    for (const [sig, h] of this.held) {
      if (h.nextAt > now) continue;
      if (++n > 3) break;
      h.attempts++; h.nextAt = now + 60_000;
      let tx: any = null, ok = false;
      for (const u of [...CFG.blockUrls, ...CFG.httpUrls]) {
        try { tx = await rpcCall(u, 'getTransaction', [sig, { encoding: 'json', maxSupportedTransactionVersion: 1, commitment: 'confirmed' }], 15_000); ok = true; break; } catch { /* next */ }
      }
      if (!ok) continue;                        // RPC trouble: retry later
      if (tx && tx.slot) {
        this.held.delete(sig); this.stats.confirmed++;
        for (const t of h.trades) { t.slot = tx.slot; t.txIndex = null; }
        for (const e of h.events) { e.slot = tx.slot; e.txIndex = null; }
        if (h.trades.length) store.addTrades(h.trades);
        if (h.events.length) store.addEvents(h.events);
      } else if (h.attempts >= 3) {
        this.held.delete(sig); this.stats.dropped++;
        logThrottled('phantom', `[phantom] dropped tx never landed: ${sig} (${h.trades.length} trades, ${h.events.length} events)`, 300_000);
      }
    }
  }
  drain() { this.held.clear(); }                 // on shutdown unverified rows are discarded (they were not in their block)
}
const phantoms = new PhantomChecker();
const sink = CFG.txIndex
  ? { trades: (rows: TradeRow[]) => routeRows(rows, []), events: (rows: EventRow[]) => routeRows([], rows) }
  : { trades: (rows: TradeRow[]) => store.addTrades(rows), events: (rows: EventRow[]) => store.addEvents(rows) };
function routeRows(trades: TradeRow[], events: EventRow[]) {
  // rows with a known tx_index (gTFA) go straight to the store; others wait for their block
  const bySlot = new Map<number, { t: TradeRow[]; e: EventRow[] }>();
  for (const t of trades) { if (t.txIndex !== null) { store.addTrades([t]); continue; } const g = bySlot.get(t.slot) ?? { t: [], e: [] }; g.t.push(t); bySlot.set(t.slot, g); }
  for (const e of events) { if (e.txIndex !== null) { store.addEvents([e]); continue; } const g = bySlot.get(e.slot) ?? { t: [], e: [] }; g.e.push(e); bySlot.set(e.slot, g); }
  for (const [slot, g] of bySlot) indexer.add(slot, g.t, g.e);
}
const processor = new Processor(store, pools => fetchPools(pools, CFG.httpUrls, HELIUS, budget), sink);

// ---------------------------------------------------------------- token metadata (best effort)
const metaQueue: { mint: string; uri: string; attempts: number; notBefore: number }[] = [];
const metaStats = { ok: 0, failed: 0, dropped: 0 };
if (CFG.meta) processor.onCreate = (mint, uri) => {
  if (metaQueue.length >= 5000) { metaQueue.shift(); metaStats.dropped++; }
  metaQueue.push({ mint, uri, attempts: 0, notBefore: Date.now() + 5000 }); // give pinning a moment
};
// ipfs.io / dweb.link answered 429 during validation (shared IP with other jobs); pinata worked. Rotate per attempt.
const IPFS_GATEWAYS = ['https://gateway.pinata.cloud/ipfs/', 'https://w3s.link/ipfs/', 'https://4everland.io/ipfs/', 'https://ipfs.io/ipfs/', 'https://dweb.link/ipfs/'];
function metaUrl(uri: string, attempt: number): string {
  const m = /\/ipfs\/([^?#]+)/.exec(uri) ?? /^ipfs:\/\/([^?#]+)/.exec(uri);
  if (!m) return uri;                                   // non-IPFS hosts (metadata.j7tracker.io, ...) as given
  return IPFS_GATEWAYS[attempt % IPFS_GATEWAYS.length] + m[1];
}
async function metaWorker() {
  while (!stopping) {
    const i = metaQueue.findIndex(x => x.notBefore <= Date.now());
    if (i < 0) { await sleep(1000); continue; }
    const job = metaQueue.splice(i, 1)[0];
    const url = metaUrl(job.uri, job.attempts); job.attempts++;
    let status = 'error';
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(15_000), headers: { accept: 'application/json,*/*' } });
      if (!r.ok) status = `http ${r.status}`;
      else {
        const text = (await r.text()).slice(0, 32_768);
        let j: any = null; try { j = JSON.parse(text); } catch { status = 'bad-json'; }
        if (j && typeof j === 'object') {
          const str = (v: unknown) => (typeof v === 'string' ? v.slice(0, 2000) : null);
          store.queueMeta({ mint: job.mint, uri: job.uri, status: 'ok', attempts: job.attempts, json: text, description: str(j.description),
            image: str(j.image), twitter: str(j.twitter ?? j.extensions?.twitter), telegram: str(j.telegram ?? j.extensions?.telegram),
            website: str(j.website ?? j.extensions?.website) });
          metaStats.ok++; continue;
        }
      }
    } catch (e: any) { status = `error:${String(e?.name ?? e?.message ?? e).slice(0, 60)}`; }
    if (job.attempts < 5) { job.notBefore = Date.now() + 20_000 * job.attempts; metaQueue.push(job); }
    else { metaStats.failed++; store.queueMeta({ mint: job.mint, uri: job.uri, status, attempts: job.attempts }); }
  }
}
const recentSigs = [new Set<string>(), new Set<string>()]; // two generations, rotated every 2 min
const seenSig = (s: string) => recentSigs[0].has(s) || recentSigs[1].has(s);
const markSig = (s: string) => recentSigs[0].add(s);
setInterval(() => { recentSigs[1] = recentSigs[0]; recentSigs[0] = new Set(); }, 120_000).unref();

const startedAt = Date.now();
const ZERO_SIG = /^1{64,88}$/;
const loopDelay = monitorEventLoopDelay({ resolution: 20 }); loopDelay.enable();
let lastEventTs = 0;
const txFetchQueue: string[] = [];
let txFetchStats = { queued: 0, fixed: 0, failed: 0, dropped: 0 };
const gapQueue: { id: number; stream: string; address: string; from: number; to: number; notBefore: number }[] = [];
let stopping = false;

// ---------------------------------------------------------------- websocket log streams
// Endpoint policy (measured 2026-09-25): wss://api.mainnet-beta.solana.com delivered ~100% of events
// (same set as Helius), wss://solana-rpc.publicnode.com only ~53% (and ~10 s later). So the first URL
// is PRIMARY: it is retried several times before falling back, time on a fallback endpoint is recorded
// as a gap (source incomplete), and while on a fallback the primary is re-tried every minute
// "make-before-break" (the fallback socket is closed only once the primary delivers).
interface StreamStats { msgs: number; bytes: number; failed: number; txs: number; dupTx: number; truncated: number; reconnects: number }
const PRIMARY_RETRIES = 4;
class LogStream {
  ws: WebSocket | null = null; wsUrl = '';
  standby: WebSocket | null = null; standbyAt = 0;
  stats: StreamStats = { msgs: 0, bytes: 0, failed: 0, txs: 0, dupTx: 0, truncated: 0, reconnects: 0 };
  lastSlot: number | null = null; lastMsgAt = 0; urlIdx = 0; failures = 0;
  disconnectedAt: number | null = null; slotAtDisconnect: number | null = null; gapReason = '';
  degradedFromSlot: number | null = null; degradedAt = 0;   // set while on a fallback endpoint
  lastTs = 0;                                                // newest on-chain event timestamp seen on this stream
  subscribed = false;
  constructor(public name: string, public program: string) {}

  private open(url: string, onNotification: (ws: WebSocket, slot: number) => void): WebSocket {
    const ws = new WebSocket(url, { perMessageDeflate: false, maxPayload: 64 * 1024 * 1024 });
    ws.on('open', () => ws.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'logsSubscribe', params: [{ mentions: [this.program] }, { commitment: CFG.commitment }] })));
    ws.on('message', (data: Buffer) => {
      // cheap peek at the notification slot (only notifications carry "context":{"slot":N})
      const m = /"context":\{"slot":(\d+)/.exec(data.toString('latin1', 0, 200));
      if (m) onNotification(ws, Number(m[1]));
      this.onMessage(data, url);
    });
    ws.on('error', (e) => logThrottled(`wserr-${this.name}-${url}`, `[${this.name}] ws error on ${url}: ${e.message}`, 30_000));
    return ws;
  }

  connect() {
    if (stopping) return;
    const url = CFG.wsUrls[this.urlIdx % CFG.wsUrls.length];
    const onPrimary = url === CFG.wsUrls[0];
    if (!onPrimary && this.degradedFromSlot === null) { this.degradedFromSlot = this.slotAtDisconnect ?? this.lastSlot; this.degradedAt = Date.now(); }
    const ws = this.open(url, () => {});
    this.ws = ws; this.wsUrl = url; this.subscribed = false; this.lastMsgAt = Date.now();
    ws.on('close', (code, reason) => {
      if (this.ws !== ws) return; // replaced (e.g. promoted standby) — nothing to do
      this.ws = null;
      if (this.disconnectedAt === null) { this.disconnectedAt = Date.now(); this.slotAtDisconnect = this.lastSlot; this.gapReason = `close ${code} ${reason.toString().slice(0, 80)}`; }
      if (stopping) return;
      this.failures++; this.stats.reconnects++;
      if (this.failures >= PRIMARY_RETRIES) this.urlIdx++; // rotate only after repeated failures
      const delay = Math.min(30_000, 1000 * 2 ** Math.min(this.failures - 1, 5));
      log(`[${this.name}] disconnected (${code}); reconnect in ${delay} ms via ${CFG.wsUrls[this.urlIdx % CFG.wsUrls.length]}`);
      setTimeout(() => this.connect(), delay);
    });
  }

  /** While on a fallback endpoint: try the primary without dropping the fallback. */
  private tryPrimary() {
    if (this.standby || stopping || CFG.wsUrls.length < 2) return;
    const url = CFG.wsUrls[0];
    let promoted = false;
    const sb = this.open(url, (w, firstSlot) => {
      if (promoted || this.standby !== w) return;
      promoted = true;
      // the degraded window ends where the PRIMARY's stream begins (the fallback may lag it by ~40 slots)
      const degradedTo = firstSlot;
      const old = this.ws; this.ws = w; this.wsUrl = url; this.standby = null; this.urlIdx = 0; this.failures = 0; this.lastMsgAt = Date.now();
      w.on('close', (code, reason) => {
        if (this.ws !== w) return;
        this.ws = null;
        if (this.disconnectedAt === null) { this.disconnectedAt = Date.now(); this.slotAtDisconnect = this.lastSlot; this.gapReason = `close ${code} ${reason.toString().slice(0, 80)}`; }
        if (stopping) return;
        this.failures++; this.stats.reconnects++;
        const delay = Math.min(30_000, 1000 * 2 ** Math.min(this.failures - 1, 5));
        log(`[${this.name}] disconnected (${code}); reconnect in ${delay} ms`);
        setTimeout(() => this.connect(), delay);
      });
      try { old?.close(); } catch { /* ignore */ }
      this.endDegraded(degradedTo);
    });
    this.standby = sb; this.standbyAt = Date.now();
    sb.on('close', () => { if (this.standby === sb) this.standby = null; });
  }

  private endDegraded(toSlot: number) {
    if (this.degradedFromSlot === null) return;
    const from = this.degradedFromSlot, to = Math.max(toSlot, this.lastSlot ?? toSlot), at = this.degradedAt;
    this.degradedFromSlot = null;
    log(`[${this.name}] back on primary endpoint after ${((Date.now() - at) / 1000).toFixed(0)} s on fallback`);
    this.registerGap(from, to, at, 'fallback endpoint (incomplete source)');
  }

  onMessage(data: Buffer, url: string) {
    this.lastMsgAt = Date.now(); this.stats.bytes += data.length;
    let j: any; try { j = JSON.parse(data.toString()); } catch { return; }
    if (!j.params) {
      if (j.id === 1 && j.result !== undefined) { if (url === this.wsUrl) this.subscribed = true; log(`[${this.name}] subscribed on ${url} (sub id ${j.result})`); }
      else if (j.error) log(`[${this.name}] subscribe error on ${url}: ${JSON.stringify(j.error)}`);
      return;
    }
    const slot: number = j.params.result.context.slot; const v = j.params.result.value;
    this.stats.msgs++;
    if (this.disconnectedAt !== null) this.closeGap(slot);
    if (url === this.wsUrl) this.failures = 0;
    if (this.lastSlot === null || slot > this.lastSlot) this.lastSlot = slot;
    if (v.err) { this.stats.failed++; return; }
    if (ZERO_SIG.test(v.signature)) { this.stats.failed++; return; } // placeholder signature (all-zero bytes): never a landed tx
    if (seenSig(v.signature)) { this.stats.dupTx++; return; }
    markSig(v.signature);
    const { events, truncated } = extractLogEvents(v.logs ?? []);
    if (truncated) {
      this.stats.truncated++;
      if (txFetchQueue.length < 5000) { txFetchQueue.push(v.signature); txFetchStats.queued++; } else txFetchStats.dropped++;
    }
    if (!events.length) return;
    this.stats.txs++;
    for (const e of events) if (e.data.timestamp !== undefined) { const t = Number(e.data.timestamp); if (t > lastEventTs) lastEventTs = t; if (t > this.lastTs) this.lastTs = t; }
    try { processor.handleTx(v.signature, slot, events, 0); }
    catch (err: any) { logThrottled('proc', `[${this.name}] process error ${v.signature}: ${err?.stack ?? err}`); }
  }

  closeGap(firstSlot: number) {
    const fromSlot = this.slotAtDisconnect; const fromAt = this.disconnectedAt!;
    this.disconnectedAt = null;
    if (fromSlot === null) return; // initial connect, nothing was missed "inside" our window
    if (firstSlot <= fromSlot + 1) {
      // The new endpoint is at or behind the slot we last saw (endpoints lag each other by seconds): overlap, no gap.
      log(`[${this.name}] reconnected with overlap (first slot ${firstSlot} <= last seen ${fromSlot}); no gap`);
      return;
    }
    this.registerGap(fromSlot, firstSlot, fromAt, this.gapReason);
  }

  registerGap(fromSlot: number, toSlot: number, fromAt: number, reason: string) {
    // Overlapping with a gap still waiting in the fill queue (e.g. restart gap + fallback period): widen that one
    // instead of paying twice for the same slots.
    const q = gapQueue.find(g => g.stream === this.name && g.from <= toSlot + 1 && fromSlot <= g.to + 1);
    if (q) {
      const nf = Math.min(q.from, fromSlot), nt = Math.max(q.to, toSlot);
      store.db.prepare('UPDATE gaps SET from_slot = ?, to_slot = ? WHERE id = ?').run(nf, nt, q.id);
      const mid = store.recordGap(this.name, fromSlot, toSlot, fromAt, Date.now(), reason);
      store.markGap(mid, `merged into #${q.id}`, null, null);
      q.from = nf; q.to = nt;
      log(`[${this.name}] gap #${mid}: slots ${fromSlot}..${toSlot} ${reason} — merged into queued gap #${q.id} (${nf}..${nt})`);
      return;
    }
    if (this.name === 'pump' && tracker) tracker.onPumpGap(fromSlot, toSlot);
    const id = store.recordGap(this.name, fromSlot, toSlot, fromAt, Date.now(), reason);
    log(`[${this.name}] gap #${id}: slots ${fromSlot}..${toSlot} (${toSlot - fromSlot} slots, ${((Date.now() - fromAt) / 1000).toFixed(1)} s) ${reason}`);
    if (CFG.gapFill && HELIUS) gapQueue.push({ id, stream: this.name, address: this.program, from: fromSlot, to: toSlot, notBefore: Date.now() + 45_000 });
    else store.markGap(id, CFG.gapFill ? 'skipped:no-helius-url' : 'skipped:gap-fill-disabled', null, null);
  }

  watchdog() {
    if (this.standby && Date.now() - this.standbyAt > 30_000) { try { this.standby.terminate(); } catch { /* ignore */ } this.standby = null; }
    if (this.ws && this.wsUrl !== CFG.wsUrls[0] && !this.standby && Date.now() - this.standbyAt > 60_000) this.tryPrimary();
    if (!this.ws) return;
    if (Date.now() - this.lastMsgAt > 45_000) {
      log(`[${this.name}] no data for 45 s — terminating socket`);
      if (this.disconnectedAt === null) { this.disconnectedAt = this.lastMsgAt; this.slotAtDisconnect = this.lastSlot; this.gapReason = 'stall'; }
      this.ws.terminate();
      return;
    }
    if (this.ws.readyState === WebSocket.OPEN) this.ws.ping();
  }

  takeStats() { const s = this.stats; this.stats = { msgs: 0, bytes: 0, failed: 0, txs: 0, dupTx: 0, truncated: 0, reconnects: 0 }; return s; }
}

const streams: LogStream[] = [];
if (CFG.venues.includes('pump')) streams.push(new LogStream('pump', PUMP_PROGRAM));
if (CFG.venues.includes('amm')) streams.push(new LogStream('amm', PUMP_AMM_PROGRAM));
const pumpStream = streams.find(s => s.name === 'pump') ?? null;

// ---------------------------------------------------------------- PumpSwap scope: graduated pools only (see pools.ts)
function queueGap(stream: string, address: string, from: number, to: number, reason: string) {
  if (to < from) return;
  const q = gapQueue.find(g => g.stream === stream && g.from <= to + 1 && from <= g.to + 1);
  if (q) { q.from = Math.min(q.from, from); q.to = Math.max(q.to, to); store.db.prepare('UPDATE gaps SET from_slot = ?, to_slot = ? WHERE id = ?').run(q.from, q.to, q.id); return; }
  const id = store.recordGap(stream, from, to, Date.now(), Date.now(), reason);
  if (CFG.gapFill && HELIUS) gapQueue.push({ id, stream, address, from, to, notBefore: Date.now() + 45_000 });
  else store.markGap(id, CFG.gapFill ? 'skipped:no-helius-url' : 'skipped:gap-fill-disabled', null, null);
}
const tracker = CFG.amm === 'graduates' && !CFG.venues.includes('amm') ? new PoolTracker({
  store, processor, log, logThrottled, seenSig, markSig, queueGap, tipSlot: () => pumpStream?.lastSlot ?? null,
  wsUrl: CFG.wsUrls[0], httpUrls: CFG.httpUrls, commitment: CFG.commitment, logsMinutes: CFG.ammLogsMin, armRealTokens: CFG.armRealTokens,
  trackHours: CFG.poolTrackHours, stopping: () => stopping,
}) : null;
if (tracker) {
  processor.onMigration = (m) => tracker.onMigration(m);
  processor.onPumpTrade = (t) => tracker.onPumpTrade(t);
} else if (CFG.amm === 'off' && !CFG.venues.includes('amm')) processor.ammFilter = () => false;
// Downtime between process runs (restart, crash) is a gap too. Resume from the last slot each STREAM actually
// received (persisted in meta every 5 s and at shutdown). Deriving it from max(slot) per venue is wrong: the pump
// socket also delivers txs that contain PumpSwap trades, and a lagging socket loses its unread tail on close.
const saveStreamSlots = () => {
  const up = store.db.prepare('INSERT OR REPLACE INTO meta(k, v) VALUES (?, ?)');
  for (const s of streams) if (s.lastSlot !== null) up.run(`last_slot_${s.name}`, JSON.stringify({ slot: s.lastSlot, at: Date.now() }));
};
for (const s of streams) {
  const row = store.db.prepare('SELECT v FROM meta WHERE k = ?').get(`last_slot_${s.name}`) as { v: string } | undefined;
  let saved: { slot: number; at: number } | null = null; try { saved = row ? JSON.parse(row.v) : null; } catch { saved = null; }
  if (!saved) {
    const venue = s.name === 'pump' ? 0 : 1; // fallback for DBs written before this change (conservative: min of both streams' max)
    const r = store.db.prepare('SELECT max(slot) AS slot FROM trades WHERE venue = ? AND source = 0').get(venue) as { slot: number | null };
    if (r?.slot) saved = { slot: r.slot - 150, at: Date.now() };
  }
  if (saved?.slot) { s.disconnectedAt = saved.at; s.slotAtDisconnect = saved.slot; s.gapReason = 'process restart'; }
}
setInterval(() => { try { saveStreamSlots(); } catch { /* ignore */ } }, 5000);

// Gaps recorded by a previous run but never attempted (process stopped before the fill ran) are re-queued.
if (CFG.gapFill && HELIUS) {
  const stale = store.db.prepare(`SELECT id, stream, from_slot, to_slot FROM gaps WHERE fill_status IS NULL AND from_at > ? ORDER BY id`).all(Date.now() - 6 * 3600_000) as any[];
  for (const g of stale) gapQueue.push({ id: g.id, stream: g.stream, address: g.stream === 'pump' ? PUMP_PROGRAM : g.stream === 'amm' ? PUMP_AMM_PROGRAM : g.stream.slice(g.stream.indexOf(':') + 1), from: g.from_slot, to: g.to_slot, notBefore: Date.now() + 30_000 });
}

// ---------------------------------------------------------------- PumpPortal (free: new tokens + migrations)
const pp = { creates: 0, migrations: 0, reconnects: 0, other: 0, ws: null as WebSocket | null, lastMsgAt: 0, failures: 0, loggedMigSample: false };
function ppConnect() {
  if (stopping || !CFG.pumpportal) return;
  const ws = new WebSocket('wss://pumpportal.fun/api/data');
  pp.ws = ws; pp.lastMsgAt = Date.now();
  ws.on('open', () => { ws.send(JSON.stringify({ method: 'subscribeNewToken' })); ws.send(JSON.stringify({ method: 'subscribeMigration' })); });
  ws.on('message', (d: Buffer) => {
    pp.lastMsgAt = Date.now();
    let j: any; try { j = JSON.parse(d.toString()); } catch { return; }
    if (j.txType === 'create' && j.mint) {
      pp.creates++; pp.failures = 0;
      store.queueTokenPp({ mint: j.mint, creator: j.traderPublicKey ?? null, createSig: j.signature ?? null, name: j.name ?? null, symbol: j.symbol ?? null,
        uri: j.uri ?? null, bondingCurve: j.bondingCurveKey ?? null, isMayhem: j.is_mayhem_mode ?? null, launchpad: j.pool ?? null,
        initialBuySol: typeof j.solAmount === 'number' ? Math.round(j.solAmount * 1e9) : null,
        initialBuyTokens: typeof j.initialBuy === 'number' ? Math.round(j.initialBuy * 1e6) : null });
    } else if ((j.txType === 'migrate' || j.txType === 'migration') && j.mint) {
      pp.migrations++;
      if (!pp.loggedMigSample) { pp.loggedMigSample = true; log(`[pumpportal] first migration message: ${JSON.stringify(j).slice(0, 600)}`); }
      store.queueMigrationPp(j.mint, j.signature ?? null, j.pool && j.pool.length > 30 ? j.pool : null);
    } else if (j.message) log(`[pumpportal] ${String(j.message).slice(0, 200)}`);
    else pp.other++;
  });
  ws.on('error', (e) => logThrottled('pperr', `[pumpportal] ws error: ${e.message}`, 60_000));
  ws.on('close', (code) => {
    if (pp.ws !== ws) return;
    pp.ws = null; if (stopping) return;
    pp.reconnects++; pp.failures++;
    const delay = Math.min(300_000, 5000 * 2 ** Math.min(pp.failures - 1, 6)); // PumpPortal bans connection spam: back off hard
    log(`[pumpportal] closed (${code}); reconnect in ${delay / 1000} s`);
    setTimeout(ppConnect, delay);
  });
}

// ---------------------------------------------------------------- background workers
async function txFetchLoop() {
  while (!stopping) {
    const sig = txFetchQueue.shift();
    if (!sig) { await sleep(500); continue; }
    try {
      const tx = await fetchTx(sig, CFG.httpUrls, HELIUS, budget);
      if (!tx || !tx.meta || tx.meta.err) { txFetchStats.failed++; }
      else { const { events } = extractTxEvents(tx); processor.handleTx(sig, tx.slot, events, 1); txFetchStats.fixed++; }
    } catch (e: any) { txFetchStats.failed++; logThrottled('txfetch', `[txfetch] ${redact(String(e?.message ?? e))}`); }
    await sleep(350); // stay well under public RPC per-method limits
  }
}

async function poolLoop() {
  while (!stopping) {
    try { await processor.resolvePending(); } catch (e: any) { logThrottled('pool', `[pools] ${redact(String(e?.message ?? e))}`); }
    await sleep(1000);
  }
}

async function gapLoop() {
  while (!stopping) {
    const g = gapQueue[0];
    if (!g || Date.now() < g.notBefore) { await sleep(2000); continue; }
    gapQueue.shift();
    const slots = g.to - g.from + 1;
    // measured: PumpSwap program 99-150, pump program ~9.4, one fresh pool ~2 successful tx per slot; 0.1 credit per tx (min 10 per call)
    const estCredits = Math.ceil(g.stream === 'amm' ? slots * 14 : g.stream === 'pump' ? slots * 1.2 : 10 + slots * 0.4);
    if (!budget.canSpend(estCredits)) { store.markGap(g.id, `skipped:budget(est ${estCredits} credits for ${slots} slots)`, null, null); log(`[gapfill] gap #${g.id} skipped: est ${estCredits} credits exceeds remaining budget`); continue; }
    try {
      let n = 0;
      const r = await gtfaWindow(HELIUS!, g.address, g.from, g.to, budget, (txs) => {
        for (const tx of txs) {
          n++;
          const sig = tx.transaction.signatures[0];
          if (!tx.meta || tx.meta.err || seenSig(sig)) continue;
          markSig(sig);
          const { events } = extractTxEvents(tx);
          if (events.length) processor.handleTx(sig, tx.slot, events, 2, tx.transactionIndex ?? null);
        }
      }, { limit: 500, pauseMs: 1400 }); // throttled (~3 MB/s; page sizes that are multiples of 100 avoid credit rounding): an unthrottled fill starved the PumpSwap socket on a shared link
      store.markGap(g.id, r.complete ? 'filled' : `partial:${r.reason}`, r.txs, r.credits);
      log(`[gapfill] gap #${g.id} ${g.stream} slots ${g.from}..${g.to}: ${r.txs} txs, ${r.credits} credits, ${r.complete ? 'complete' : 'PARTIAL ' + r.reason}`);
    } catch (e: any) {
      store.markGap(g.id, `error:${redact(String(e?.message ?? e)).slice(0, 120)}`, null, null);
      log(`[gapfill] gap #${g.id} error: ${redact(String(e?.message ?? e))}`);
      if (e instanceof RpcError && e.code === -32429) { log('[gapfill] Helius credits exhausted — disabling gap fill'); CFG.gapFill = false; }
    }
  }
}

/** Periodic self-audit: a small slot window per venue re-read from Helius and compared event-by-event. */
async function auditLoop() {
  if (!CFG.auditMin || !HELIUS) return;
  await sleep(10 * 60_000);
  while (!stopping) {
    if (tracker && !stopping) await auditPoolWindow();
    for (const s of streams) {
      if (stopping || s.lastSlot === null) continue;
      const venue = s.name === 'pump' ? 0 : 1; const width = venue === 0 ? 40 : 6;
      const to = s.lastSlot - 300, from = to - width + 1; // ~80 s back: rows may wait up to 60 s for tx_index
      if (!budget.canSpend(venue === 0 ? 60 : 90)) { log(`[audit] ${s.name} skipped (budget)`); continue; }
      try {
        const truth = new Set<string>();
        const r = await gtfaWindow(HELIUS, s.program, from, to, budget, (txs) => { for (const tx of txs) if (tx.meta && !tx.meta.err) for (const k of tradeEventKeys(tx)) if (k.venue === venue) truth.add(k.key); });
        store.flush();
        const rows = store.db.prepare('SELECT sig, idx FROM trades WHERE slot BETWEEN ? AND ? AND venue = ?').all(from, to, venue) as { sig: string; idx: number }[];
        const have = new Set(rows.map(x => `${x.sig}:${x.idx}`));
        let matched = 0; for (const k of truth) if (have.has(k)) matched++;
        store.audit({ venue: s.name, from, to, chain: truth.size, db: rows.length, matched, credits: r.credits, endpoint: s.wsUrl });
        log(`[audit] ${s.name} slots ${from}..${to}: chain ${truth.size} trade events, db ${rows.length}, matched ${matched} (${truth.size ? (100 * matched / truth.size).toFixed(2) : 'n/a'}%), ${r.credits} credits, endpoint ${s.wsUrl}`);
      } catch (e: any) { log(`[audit] ${s.name} error: ${redact(String(e?.message ?? e))}`); }
    }
    await sleep(CFG.auditMin * 60_000);
  }
}

/** Audit of the PumpSwap trade-level scope: the first ~60 slots after the most recent completed migration window. */
async function auditPoolWindow() {
  // latest pool whose trade-level window ended >= 5 min ago (its gap fills, if any, have run)
  const p = store.db.prepare(`SELECT pool, migrate_slot, logs_status FROM tracked_pools WHERE logs_to_slot IS NOT NULL AND registered_at < ? ORDER BY registered_at DESC LIMIT 1`).get(Date.now() - (CFG.ammLogsMin + 5) * 60_000) as any;
  if (!p || !HELIUS) return;
  const from = p.migrate_slot, to = p.migrate_slot + 60;
  if (!budget.canSpend(80)) { log('[audit] pool window skipped (budget)'); return; }
  try {
    const truth = new Set<string>();
    const r = await gtfaWindow(HELIUS, p.pool, from, to, budget, (txs) => {
      for (const tx of txs) if (tx.meta && !tx.meta.err) {
        const sig = tx.transaction.signatures[0]; let idx = 0;
        for (const e of extractTxEvents(tx).events) {
          if (e.program === 'pump' && e.name === 'TradeEvent') { idx++; continue; }
          if (e.program === 'amm' && (e.name === 'BuyEvent' || e.name === 'SellEvent')) { if (e.data.pool === p.pool) truth.add(`${sig}:${idx}`); idx++; }
        }
      }
    }, { limit: 500 });
    store.flush();
    const rows = store.db.prepare('SELECT sig, idx FROM trades WHERE slot BETWEEN ? AND ? AND venue = 1 AND pool_id = (SELECT id FROM keys WHERE pubkey = ?)').all(from, to, p.pool) as any[];
    const have = new Set(rows.map((x: any) => `${x.sig}:${x.idx}`));
    let matched = 0; for (const k of truth) if (have.has(k)) matched++;
    store.audit({ venue: `pool:${p.pool}`, from, to, chain: truth.size, db: rows.length, matched, credits: r.credits, endpoint: p.logs_status });
    log(`[audit] pool ${p.pool} slots ${from}..${to} (${p.logs_status}): chain ${truth.size} trades, db ${rows.length}, matched ${matched} (${truth.size ? (100 * matched / truth.size).toFixed(2) : 'n/a'}%), ${r.credits} credits`);
  } catch (e: any) { log(`[audit] pool window error: ${redact(String(e?.message ?? e))}`); }
}

/**
 * Online G1: every few minutes, solve the reserve chain of every coin/pool over the recent window, write the
 * per-coin intra-slot order (seq), delete "phantom" rows (websocket-reported txs that never landed —
 * getTransaction returns null) and queue a per-coin Helius fill for genuine holes.
 */
let chainLo: number | null = null;
const chainStats = { runs: 0, pairs: 0, breaks: 0, phantoms: 0, holes: 0 };
async function chainAudit() {
  const tip = pumpStream?.lastSlot; if (!tip) return;
  const hi = tip - 150; const lo = Math.max(chainLo ?? hi - 1200, hi - 4500) - 300;
  if (hi <= lo) return;
  store.flush();
  const rows = loadChainRows(store.db, lo, hi);
  const { seq, breaks, pairs } = solve(rows);
  try { writeSeq(store.db, seq, rows); } catch (e: any) { logThrottled('seq', `[chain] seq write error: ${e?.message ?? e}`); }
  chainStats.runs++; chainStats.pairs += pairs; chainStats.breaks += breaks.length;
  const checked = new Map<string, boolean>(); let phantoms = 0, holes = 0;
  const landed = async (sig: string) => {
    if (checked.has(sig)) return checked.get(sig)!;
    let nulls = 0;
    // public endpoints first; Helius (1 credit) as the tie-breaker when they throttle (429) — a phantom that is not
    // verified would otherwise stay in the chain and trigger a useless hole fill
    const urls = [...CFG.httpUrls, ...(HELIUS && budget.canSpend(1) ? [HELIUS] : [])];
    for (const u of urls) {
      try {
        if (u === HELIUS) budget.spend(1);
        const tx = await rpcCall<any>(u, 'getTransaction', [sig, { encoding: 'json', maxSupportedTransactionVersion: 1, commitment: 'confirmed' }], 15_000);
        if (tx) { checked.set(sig, true); return true; }
        nulls++;
        if (nulls >= 2) break; // two independent "never landed" answers are enough
      } catch { /* next */ }
    }
    const ok = nulls === 0; // every endpoint errored -> unknown -> assume landed; a null and no hit -> never landed
    checked.set(sig, ok); return ok;
  };
  for (const b of breaks.slice(0, 150)) {
    let ph = false;
    for (const r of [b.prev, b.row]) if (!(await landed(r.sig))) {
      store.db.transaction(() => { store.db.prepare('DELETE FROM trades WHERE sig = ?').run(r.sig); store.db.prepare('DELETE FROM events WHERE sig = ?').run(r.sig); }).immediate();
      phantoms++; ph = true; log(`[chain] removed phantom tx (never landed): ${r.sig}`);
    }
    if (!ph) {
      const key = store.db.prepare('SELECT pubkey FROM keys WHERE id = ?').get(b.row.venue === 0 ? b.row.mint_id : b.row.pool_id) as { pubkey: string } | undefined;
      if (key) { queueGap(`coin:${key.pubkey}`, key.pubkey, b.prev.slot, b.row.slot, 'reserve-chain break (G1)'); holes++; }
    }
  }
  chainStats.phantoms += phantoms; chainStats.holes += holes;
  if (breaks.length) log(`[chain] slots ${lo}..${hi}: ${pairs} pairs, ${breaks.length} breaks -> ${phantoms} phantom txs removed, ${holes} holes queued for fill`);
  store.audit({ venue: 'chain', from: lo, to: hi, chain: pairs, db: pairs - breaks.length, matched: pairs - breaks.length, credits: 0, endpoint: `phantoms=${phantoms} holes=${holes}` });
  chainLo = hi;
}

function freeDiskGb(): number {
  try { const s = fs.statfsSync(path.dirname(CFG.db)); return (s.bavail * s.bsize) / 1e9; } catch { return Infinity; }
}
function dbSizeMb(): number {
  let t = 0; for (const f of [CFG.db, `${CFG.db}-wal`]) { try { t += fs.statSync(f).size; } catch { /* none */ } }
  return t / 1e6;
}

let lastHb = Date.now();
let lastTotals = { ...store.totals };
function heartbeat() {
  const now = Date.now(); const mins = (now - lastHb) / 60_000; lastHb = now;
  const ss: Record<string, StreamStats & { lastSlot: number | null; up: boolean; endpoint: string; degraded: boolean; lagSec: number | null }> = {};
  for (const s of streams) ss[s.name] = { ...s.takeStats(), lastSlot: s.lastSlot, up: !!s.ws && s.subscribed, endpoint: s.wsUrl, degraded: s.degradedFromSlot !== null,
    lagSec: s.lastTs ? Math.max(0, Math.round(now / 1000 - s.lastTs)) : null };
  const ev = processor.takeCounts();
  const t = store.totals; const ins = t.tradesInserted - lastTotals.tradesInserted; const dup = t.tradesDup - lastTotals.tradesDup; lastTotals = { ...t };
  const disk = freeDiskGb(); const db = dbSizeMb(); const lag = lastEventTs ? Math.max(0, now / 1000 - lastEventTs) : null;
  const ppStats = { creates: pp.creates, migrations: pp.migrations, reconnects: pp.reconnects, up: !!pp.ws };
  pp.creates = 0; pp.migrations = 0; pp.reconnects = 0;
  const tf = { ...txFetchStats, queue: txFetchQueue.length }; txFetchStats = { queued: 0, fixed: 0, failed: 0, dropped: 0 };
  const idxSnap = { ...indexer.stats }; indexer.stats = { blocks: 0, resolvedRows: 0, unresolvedRows: 0, errors: 0, kb: 0 }; idxSnap.kb = Math.round(idxSnap.kb);
  const metaSnap = { ...metaStats }; metaStats.ok = 0; metaStats.failed = 0; metaStats.dropped = 0;
  const chainSnap = { ...chainStats }; chainStats.runs = 0; chainStats.pairs = 0; chainStats.breaks = 0; chainStats.phantoms = 0; chainStats.holes = 0;
  const stats = { minutes: +mins.toFixed(2), uptimeMin: +((now - startedAt) / 60_000).toFixed(1), streams: ss, events: ev, tradesInserted: ins, tradesDup: dup,
    pendingPoolTrades: processor.pendingPoolTrades(), pendingWrites: store.pendingCount(), txFetch: tf, pumpportal: ppStats,
    helius: { hour: budget.usedHour(), day: budget.usedDay(), total: budget.total }, gapsQueued: gapQueue.length,
    txIndex: CFG.txIndex ? { ...idxSnap, pendingRows: indexer.pendingRows(), phantoms: { ...phantoms.stats, holding: phantoms.size() } } : 'off',
    pools: tracker ? tracker.takeStats() : null, chain: chainSnap, meta: { ...metaSnap, queue: metaQueue.length },
    loopDelayMsP99: Math.round(loopDelay.percentile(99) / 1e6), lagSec: lag === null ? null : +lag.toFixed(1), dbMb: +db.toFixed(1), diskFreeGb: +disk.toFixed(1), rssMb: Math.round(process.memoryUsage().rss / 1e6) };
  loopDelay.reset();
  try { store.heartbeat(stats); } catch { /* ignore */ }
  const sfmt = Object.entries(ss).map(([k, s]) => `${k}{msgs=${s.msgs} MB=${(s.bytes / 1e6).toFixed(1)} fail=${s.failed} tx=${s.txs} dupTx=${s.dupTx} trunc=${s.truncated} rc=${s.reconnects} slot=${s.lastSlot} lag=${s.lagSec}s ${s.up ? 'UP' : 'DOWN'}${s.degraded ? ' FALLBACK(' + s.endpoint + ')' : ''}}`).join(' ');
  log(`HB up=${stats.uptimeMin}m ${sfmt} ev=${JSON.stringify(ev)} ins=${ins} dup=${dup} pendPool=${stats.pendingPoolTrades} txfetch=${JSON.stringify(tf)} pp=${JSON.stringify(ppStats)} pools=${JSON.stringify(stats.pools)} chain=${JSON.stringify(stats.chain)} meta=${JSON.stringify(stats.meta)} helius=${JSON.stringify(stats.helius)} loopP99=${stats.loopDelayMsP99}ms lag=${stats.lagSec}s db=${stats.dbMb}MB disk=${stats.diskFreeGb}GB rss=${stats.rssMb}MB`);
  if (disk < CFG.minFreeGb) { log(`!!! free disk ${disk.toFixed(1)} GB < ${CFG.minFreeGb} GB — stopping to protect the machine`); shutdown('disk-guard', 4); }
}

// ---------------------------------------------------------------- lifecycle
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
function shutdown(reason: string, code = 0) {
  if (stopping) return; stopping = true;
  log(`shutting down (${reason})`);
  try { saveStreamSlots(); } catch { /* ignore */ }
  for (const s of streams) { try { s.ws?.close(); } catch { /* ignore */ } }
  try { tracker?.closeAll(); } catch { /* ignore */ }
  try { pp.ws?.close(); } catch { /* ignore */ }
  setTimeout(() => {
    try { processor.drainUnresolved(); indexer.drain(); store.close(); } catch (e: any) { log(`close error: ${e?.message}`); }
    try { if (fs.readFileSync(CFG.lockFile, 'utf8').trim() === String(process.pid)) fs.unlinkSync(CFG.lockFile); } catch { /* ignore */ }
    log(`stopped. totals=${JSON.stringify(store.totals)} heliusCredits=${budget.total}`);
    process.exit(code);
  }, 1500);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('uncaughtException', (e) => { log(`uncaughtException: ${e?.stack ?? e}`); shutdown('uncaughtException', 1); });
process.on('unhandledRejection', (e: any) => { logThrottled('unhandled', `unhandledRejection: ${redact(String(e?.stack ?? e))}`); });

log(`collector start pid=${process.pid} db=${CFG.db} venues=${CFG.venues.join(',')} amm=${tracker ? 'graduates(logs ' + CFG.ammLogsMin + ' min, poll ' + CFG.poolTrackHours + ' h)' : CFG.venues.includes('amm') ? 'all' : 'off'} ws=${CFG.wsUrls.join(',')} pumpportal=${CFG.pumpportal} commitment=${CFG.commitment} gapFill=${CFG.gapFill && !!HELIUS} auditMin=${CFG.auditMin} txIndex=${CFG.txIndex} meta=${CFG.meta} heliusBudget=${CFG.creditsPerHour}/h,${CFG.creditsPerDay}/day minFreeGb=${CFG.minFreeGb}`);
for (const s of streams) s.connect();
ppConnect();
setInterval(() => { try { store.flush(); } catch (e: any) { logThrottled('flush', `flush error (rows kept for retry): ${e?.message ?? e}`, 10_000); } }, 500);
setInterval(() => { for (const s of streams) s.watchdog(); if (pp.ws && Date.now() - pp.lastMsgAt > 15 * 60_000) { log('[pumpportal] silent 15 min — reconnecting'); pp.ws.terminate(); } }, 15_000);
setInterval(heartbeat, CFG.heartbeatSec * 1000);
void txFetchLoop(); void poolLoop(); void gapLoop(); void auditLoop();
if (CFG.meta) { void metaWorker(); void metaWorker(); void metaWorker(); }
if (CFG.txIndex) { setInterval(() => indexer.tick(), 200); setInterval(() => { void phantoms.tick(); }, 2000); }
if (tracker) setInterval(() => { try { tracker.tick(); } catch (e: any) { logThrottled('tracker', `[pools] tick error: ${e?.message ?? e}`); } }, 1000);
let chainBusy = false;
if (CFG.chainAuditMin > 0) setInterval(() => { if (chainBusy || stopping) return; chainBusy = true; chainAudit().catch((e) => log(`[chain] error: ${e?.message ?? e}`)).finally(() => { chainBusy = false; }); }, CFG.chainAuditMin * 60_000);
if (CFG.durationMin > 0) setTimeout(() => shutdown(`duration ${CFG.durationMin} min reached`), CFG.durationMin * 60_000);
