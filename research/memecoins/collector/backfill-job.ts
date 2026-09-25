/**
 * Resumable historical backfill job (Helius getTransactionsForAddress, full txs, succeeded only).
 * Decodes on the fly and stores only decoded rows (same tables/fields as live; trades.source = 2,
 * tx_index = gTFA transactionIndex). Read-only on chain.
 *
 *   node --import tsx backfill-job.ts --job=pump7d --from-time=2026-09-18T00:00:00Z [--to-slot=N]
 *        [--max-credits=2600000] [--workers=4] [--max-mbps=8] [--chunk-slots=2250] [--projection-after=20]
 *
 * - The slot range is split into chunks (default 2,250 slots ≈ 10 min of chain); chunks run newest-first
 *   on N workers; each page (≤1000 txs) is decoded, written, and the chunk cursor (pagination token) saved,
 *   so a killed job resumes where it stopped (`backfill_jobs`, `backfill_chunks` tables).
 * - Download is gzip (≈4.5x smaller) and throttled by a token bucket to --max-mbps of WIRE bytes.
 * - Credits: 10 per 100 returned txs. Hard stop at --max-credits (job total); after --projection-after chunks
 *   the job projects its total and stops if the projection exceeds the cap.
 * - Failed chunks (after retries) are recorded in `gaps` (stream 'backfill:<job>') and retried once at the end.
 * Default scope: the pump.fun program (all curve trades, creates, completions, migrations). PumpSwap events inside
 * these txs are kept only for pools created by a migration seen in the backfill (the migration tx itself).
 */
import fs from 'node:fs';
import path from 'node:path';
import { extractTxEvents, PUMP_PROGRAM, type RpcTx } from './decode.ts';
import { Processor } from './processor.ts';
import { heliusUrl, rpcCall, rpcCallMeta, RpcError, rpcStats } from './rpc.ts';
import { Store } from './store.ts';

const argv = process.argv.slice(2);
const opt = (n: string, d = '') => { const a = argv.find(x => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const DATA = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'data');
const JOB = opt('job', 'pump7d');
const ADDRESS = opt('address', PUMP_PROGRAM);
const MAX_CREDITS = Number(opt('max-credits', '2600000'));
const WORKERS = Number(opt('workers', '4'));
const MAX_BPS = Number(opt('max-mbps', '8')) * 1e6;
const CHUNK = Number(opt('chunk-slots', '2250'));
const PROJ_AFTER = Number(opt('projection-after', '20'));
const PRIORITY_BEFORE = Number(opt('priority-before-slot', '0'));   // chunks starting below this slot go first (newest-first)
const LOG = path.join(DATA, `backfill-${JOB}.log`);
const HELIUS = heliusUrl(); if (!HELIUS) throw new Error('no Helius RPC_URL in .env');
const PUBLIC = ['https://api.mainnet-beta.solana.com', 'https://solana-rpc.publicnode.com'];

function log(m: string) { const line = `[${new Date().toISOString()}] ${m}\n`; fs.appendFileSync(LOG, line); process.stdout.write(line); }

const store = new Store(opt('db', path.join(DATA, 'memecoins.db')));
store.db.exec(`CREATE TABLE IF NOT EXISTS backfill_jobs(name TEXT PRIMARY KEY, address TEXT, from_slot INTEGER, to_slot INTEGER, from_time TEXT,
  chunk_slots INTEGER, max_credits INTEGER, credits INTEGER DEFAULT 0, txs INTEGER DEFAULT 0, trades INTEGER DEFAULT 0, wire_bytes INTEGER DEFAULT 0,
  raw_bytes INTEGER DEFAULT 0, status TEXT, note TEXT, started_at INTEGER, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS backfill_chunks(job TEXT NOT NULL, from_slot INTEGER NOT NULL, to_slot INTEGER NOT NULL, status TEXT NOT NULL,
  token TEXT, credits INTEGER DEFAULT 0, txs INTEGER DEFAULT 0, trades INTEGER DEFAULT 0, attempts INTEGER DEFAULT 0, error TEXT,
  started_at INTEGER, finished_at INTEGER, PRIMARY KEY(job, from_slot));`);

// ------------------------------------------------------------------ slot range
async function slotAtTime(unix: number): Promise<number> {
  // first pump-program tx at/after `unix` (Helius gTFA signatures-only, 10 credits) — public getBlockTime lacks old slots
  const r = await rpcCall<{ data: { slot: number; blockTime: number }[] }>(HELIUS!, 'getTransactionsForAddress',
    [PUMP_PROGRAM, { transactionDetails: 'signatures', sortOrder: 'asc', limit: 1, filters: { blockTime: { gte: unix } } }], 60_000);
  if (!r.data.length) throw new Error('no tx at/after ' + unix);
  log(`slotAtTime(${new Date(unix * 1000).toISOString()}) = ${r.data[0].slot} (blockTime ${new Date(r.data[0].blockTime * 1000).toISOString()})`);
  return r.data[0].slot;
}

let job = store.db.prepare('SELECT * FROM backfill_jobs WHERE name = ?').get(JOB) as any;
if (!job) {
  const fromTime = opt('from-time', '2026-09-18T00:00:00Z');
  const fromSlot = opt('from-slot') ? Number(opt('from-slot')) : await slotAtTime(Math.floor(Date.parse(fromTime) / 1000));
  const firstLive = (store.db.prepare('SELECT min(slot) AS s FROM trades WHERE source = 0').get() as { s: number }).s;
  const toSlot = Number(opt('to-slot', String(firstLive - 1)));
  store.db.prepare(`INSERT INTO backfill_jobs(name, address, from_slot, to_slot, from_time, chunk_slots, max_credits, status, started_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(JOB, ADDRESS, fromSlot, toSlot, fromTime, CHUNK, MAX_CREDITS, 'running', Date.now(), Date.now());
  const ins = store.db.prepare('INSERT OR IGNORE INTO backfill_chunks(job, from_slot, to_slot, status) VALUES (?,?,?,?)');
  store.db.transaction(() => { for (let a = fromSlot; a <= toSlot; a += CHUNK) ins.run(JOB, a, Math.min(toSlot, a + CHUNK - 1), 'pending'); })();
  job = store.db.prepare('SELECT * FROM backfill_jobs WHERE name = ?').get(JOB);
  log(`job ${JOB} created: ${ADDRESS} slots ${fromSlot}..${toSlot} (${toSlot - fromSlot + 1} slots, from ${fromTime} to the first live slot) in ${Math.ceil((toSlot - fromSlot + 1) / CHUNK)} chunks`);
} else {
  store.db.prepare("UPDATE backfill_chunks SET status = 'pending' WHERE job = ? AND status = 'running'").run(JOB);
  store.db.prepare("UPDATE backfill_jobs SET status = 'running', updated_at = ? WHERE name = ?").run(Date.now(), JOB);
  log(`job ${JOB} resumed (credits so far ${job.credits})`);
}
fs.writeFileSync(path.join(DATA, `backfill-${JOB}.pid`), String(process.pid));

// ------------------------------------------------------------------ processor (scope: pump + migration-created pools)
const scopePools = new Set<string>((store.db.prepare("SELECT pool FROM migrations WHERE kind = 'migrate' AND pool IS NOT NULL").all() as { pool: string }[]).map(r => r.pool));
const processor = new Processor(store, async () => new Map());
processor.ammFilter = (pool) => scopePools.has(pool);   // CreatePool / InitBoost events of migration txs
processor.dropAmmTrades = true;                          // PumpSwap trade history needs the per-pool job (backfill-pools.ts)
processor.onMigration = (m) => { scopePools.add(m.pool); };

// ------------------------------------------------------------------ throttle (token bucket on wire bytes)
let tokens = MAX_BPS * 2; let lastRefill = Date.now();
// Helius 429 back-off shared by all workers: every 429 pauses everyone (5 s doubling to 60 s; decays on success)
let pauseUntil = 0, backoffMs = 0, rateLimited = 0;
function on429() { backoffMs = Math.min(60_000, backoffMs ? backoffMs * 2 : 5_000); pauseUntil = Math.max(pauseUntil, Date.now() + backoffMs); rateLimited++; }
function onOk() { if (backoffMs) backoffMs = Math.max(0, Math.floor(backoffMs / 2) - 1000); }
async function throttle() {
  for (;;) {
    const wait = pauseUntil - Date.now();
    if (wait > 0) { await new Promise(r => setTimeout(r, wait)); continue; }
    const now = Date.now(); tokens = Math.min(MAX_BPS * 2, tokens + (now - lastRefill) / 1000 * MAX_BPS); lastRefill = now;
    if (tokens > 0) return;
    await new Promise(r => setTimeout(r, Math.min(2000, (-tokens / MAX_BPS) * 1000 + 50)));
  }
}

// ------------------------------------------------------------------ workers
let stopping = false; let stopReason = '';
const t0 = Date.now(); const wire0 = rpcStats.wire, raw0 = rpcStats.bytes;
let sessionCredits = 0, sessionTxs = 0, sessionTrades = 0, chunksDone = 0;
const jobCredits = () => (store.db.prepare('SELECT credits FROM backfill_jobs WHERE name = ?').get(JOB) as { credits: number }).credits;
const addJob = store.db.prepare('UPDATE backfill_jobs SET credits = credits + ?, txs = txs + ?, trades = trades + ?, wire_bytes = wire_bytes + ?, raw_bytes = raw_bytes + ?, updated_at = ? WHERE name = ?');
// Order: with --priority-before-slot=S, chunks starting below S first (newest-first), then the rest (newest-first);
// without it, a stride sample (every 50th chunk) first so the credit projection is representative, then newest-first.
const ORDER = PRIORITY_BEFORE
  ? `(from_slot < ${PRIORITY_BEFORE}) DESC, from_slot DESC`
  : `(((from_slot - ${Number(job.from_slot)}) / ${Number(job.chunk_slots)}) % 50 = 0) DESC, from_slot DESC`;
const nextChunk = store.db.prepare(`UPDATE backfill_chunks SET status = 'running', attempts = attempts + 1, started_at = ?
  WHERE job = ? AND from_slot = (SELECT from_slot FROM backfill_chunks WHERE job = ? AND status = 'pending' ORDER BY ${ORDER} LIMIT 1) RETURNING *`);
// Hard cap without overshoot: every in-flight page reserves the worst case (1000 txs = 100 credits) before it is sent.
let reserved = 0;

async function runChunk(c: any) {
  let token: string | null = c.token; let credits = 0, txs = 0, trades = 0;
  for (;;) {
    if (stopping) { store.db.prepare("UPDATE backfill_chunks SET status = 'pending', token = ? WHERE job = ? AND from_slot = ?").run(token, JOB, c.from_slot); return false; }
    if (jobCredits() + reserved + 100 > MAX_CREDITS) { stopping = true; stopReason = `credit cap ${MAX_CREDITS} reached`; continue; }
    reserved += 100;
    try { await throttle(); } catch (e) { reserved -= 100; throw e; }
    const cfg: any = { transactionDetails: 'full', sortOrder: 'asc', limit: 1000, commitment: 'finalized', encoding: 'json', maxSupportedTransactionVersion: 1,
      filters: { slot: { gte: c.from_slot, lte: c.to_slot }, status: 'succeeded' } };
    if (token) cfg.paginationToken = token;
    let page: { data: RpcTx[]; paginationToken: string | null } | null = null; let wire = 0, raw = 0;
    try {
      for (let a = 0, errs = 0; !page; a++) {
        try { const m = await rpcCallMeta<{ data: RpcTx[]; paginationToken: string | null }>(HELIUS!, 'getTransactionsForAddress', [ADDRESS, cfg], 180_000); page = m.result; wire = m.wire; raw = m.raw; onOk(); }
        catch (e: any) {
          if (e instanceof RpcError && e.code === -32429) { stopping = true; stopReason = 'Helius credits exhausted (-32429)'; break; }
          if (e instanceof RpcError && e.status === 429 && a < 60 && !stopping) { on429(); await throttle(); continue; }   // rate limit: back off, not an error
          errs++;
          log(`page retry ${errs} for chunk ${c.from_slot}: ${String(e?.message ?? e).replace(/api-key=[^&\s"]+/g, 'api-key=<redacted>').slice(0, 160)}`);
          if (errs >= 5) throw e;
          await new Promise(r => setTimeout(r, 3000 * errs));
        }
      }
    } finally { reserved -= 100; }
    if (!page) continue;
    tokens -= wire;
    const n = page.data.length; const cost = Math.max(10, Math.ceil(n / 100) * 10);
    let pageTrades = 0;
    for (const tx of page.data) {
      if (!tx.meta || tx.meta.err) continue;
      const { events } = extractTxEvents(tx);
      if (!events.length) continue;
      const before = processor.counts['pump.trade'] ?? 0;
      processor.handleTx(tx.transaction.signatures[0], tx.slot, events, 2, tx.transactionIndex ?? null);
      pageTrades += (processor.counts['pump.trade'] ?? 0) - before;
    }
    const nextToken = n < 1000 ? null : page.paginationToken;
    // write rows + cursor + counters (a crash between flush and cursor save only re-reads one page; rows dedupe)
    for (let a = 0; ; a++) { try { store.flush(); break; } catch (e) { if (a > 20) throw e; await new Promise(r => setTimeout(r, 500)); } }
    store.db.prepare('UPDATE backfill_chunks SET token = ?, credits = credits + ?, txs = txs + ?, trades = trades + ? WHERE job = ? AND from_slot = ?')
      .run(nextToken, cost, n, pageTrades, JOB, c.from_slot);
    addJob.run(cost, n, pageTrades, wire, raw, Date.now(), JOB);
    credits += cost; txs += n; trades += pageTrades; sessionCredits += cost; sessionTxs += n; sessionTrades += pageTrades;
    token = nextToken;
    if (!token) break;
  }
  store.db.prepare("UPDATE backfill_chunks SET status = 'done', finished_at = ?, token = NULL WHERE job = ? AND from_slot = ?").run(Date.now(), JOB, c.from_slot);
  chunksDone++;
  return true;
}

async function worker(id: number) {
  while (!stopping) {
    const c = nextChunk.get(Date.now(), JOB, JOB) as any;
    if (!c) return;
    try { await runChunk(c); }
    catch (e: any) {
      const msg = String(e?.message ?? e).replace(/api-key=[^&\s"]+/g, 'api-key=<redacted>').slice(0, 200);
      store.db.prepare("UPDATE backfill_chunks SET status = ?, error = ? WHERE job = ? AND from_slot = ?").run(c.attempts >= 3 ? 'error' : 'pending', msg, JOB, c.from_slot);
      if (c.attempts >= 3) store.recordGap(`backfill:${JOB}`, c.from_slot, c.to_slot, Date.now(), Date.now(), `backfill chunk failed: ${msg}`);
      log(`worker ${id}: chunk ${c.from_slot}..${c.to_slot} failed (attempt ${c.attempts}): ${msg}`);
      await new Promise(r => setTimeout(r, 5000));
    }
    // projection check
    const done = store.db.prepare("SELECT count(*) AS n, sum(to_slot - from_slot + 1) AS slots, sum(credits) AS credits FROM backfill_chunks WHERE job = ? AND status = 'done'").get(JOB) as any;
    if (done.n >= PROJ_AFTER) {
      const total = store.db.prepare('SELECT sum(to_slot - from_slot + 1) AS slots FROM backfill_chunks WHERE job = ?').get(JOB) as any;
      const projected = Math.round(done.credits / done.slots * total.slots);
      if (projected > MAX_CREDITS && !stopping) { stopping = true; stopReason = `projection ${projected} credits > cap ${MAX_CREDITS}`; }
    }
  }
}

function progress() {
  const q = store.db.prepare(`SELECT count(*) AS n, sum(status = 'done') AS done, sum(status = 'error') AS err, sum(CASE WHEN status = 'done' THEN to_slot - from_slot + 1 END) AS slotsDone,
    sum(to_slot - from_slot + 1) AS slots, sum(credits) AS credits, sum(txs) AS txs, sum(trades) AS trades,
    sum(CASE WHEN status = 'done' THEN credits END) AS doneCredits, sum(CASE WHEN status = 'done' THEN txs END) AS doneTxs FROM backfill_chunks WHERE job = ?`).get(JOB) as any;
  const secs = (Date.now() - t0) / 1000;
  const wireMbps = (rpcStats.wire - wire0) / 1e6 / secs, rawMbps = (rpcStats.bytes - raw0) / 1e6 / secs;
  const creditsPerSlot = q.slotsDone ? q.doneCredits / q.slotsDone : null;   // from finished chunks only
  const projected = creditsPerSlot ? Math.round(creditsPerSlot * q.slots) : null;
  const slotRate = sessionTxs && q.txs ? (q.slotsDone ?? 0) : 0;
  const txPerSlot = q.slotsDone ? q.doneTxs / q.slotsDone : 10;
  const etaH = sessionTxs ? Math.max(0, q.slots * txPerSlot - q.txs) / (sessionTxs / secs) / 3600 : null;
  const line = { chunks: `${q.done}/${q.n}`, errors: q.err, slotsDone: q.slotsDone, slots: q.slots, pct: +(100 * (q.slotsDone ?? 0) / q.slots).toFixed(2),
    credits: q.credits, creditsPerSlot: creditsPerSlot ? +creditsPerSlot.toFixed(3) : null, projectedCredits: projected, cap: MAX_CREDITS, txs: q.txs, trades: q.trades, sessionTxPerSec: +(sessionTxs / secs).toFixed(0),
    wireMBps: +wireMbps.toFixed(2), rawMBps: +rawMbps.toFixed(2), http429: rateLimited, backoffMs, gzipRatio: rawMbps ? +(wireMbps / rawMbps).toFixed(3) : null, etaHours: etaH ? +etaH.toFixed(2) : null, rssMb: Math.round(process.memoryUsage().rss / 1e6) };
  void slotRate;
  log(`PROGRESS ${JSON.stringify(line)}`);
  store.db.prepare('UPDATE backfill_jobs SET note = ?, updated_at = ? WHERE name = ?').run(JSON.stringify(line), Date.now(), JOB);
}

process.on('SIGTERM', () => { stopping = true; stopReason = 'SIGTERM'; });
process.on('SIGINT', () => { stopping = true; stopReason = 'SIGINT'; });
const timer = setInterval(progress, 60_000);
log(`start: workers=${WORKERS} maxMBps=${MAX_BPS / 1e6} cap=${MAX_CREDITS} chunkSlots=${CHUNK}`);
await Promise.all(Array.from({ length: WORKERS }, (_, i) => worker(i)));
// retry error chunks once at the end
if (!stopping) {
  const n = store.db.prepare("UPDATE backfill_chunks SET status = 'pending' WHERE job = ? AND status = 'error' AND attempts < 6").run(JOB).changes;
  if (n) { log(`retrying ${n} failed chunks`); await Promise.all(Array.from({ length: Math.min(WORKERS, n) }, (_, i) => worker(i))); }
}
clearInterval(timer); progress();
const left = (store.db.prepare("SELECT count(*) AS n FROM backfill_chunks WHERE job = ? AND status != 'done'").get(JOB) as any).n;
const status = left === 0 ? 'done' : stopping ? `stopped: ${stopReason}` : `incomplete (${left} chunks not done)`;
store.db.prepare('UPDATE backfill_jobs SET status = ?, updated_at = ? WHERE name = ?').run(status, Date.now(), JOB);
log(`finished: ${status}; this session ${sessionCredits} credits, ${sessionTxs} txs, ${sessionTrades} trades`);
store.close();
try { fs.unlinkSync(path.join(DATA, `backfill-${JOB}.pid`)); } catch { /* ignore */ }
process.exit(0);
