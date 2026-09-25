/**
 * Historical backfill via Helius getTransactionsForAddress (full txs, succeeded only).
 * Cost: 10 credits per 100 returned transactions (0.1 credit/tx). Read-only.
 *
 *   node --import tsx backfill.ts --program=pump|amm --minutes-ago=60 --span-min=5 --max-credits=1000
 *   node --import tsx backfill.ts --program=pump --from-slot=A --to-slot=B --max-credits=N
 *   node --import tsx backfill.ts --mint=<mint> --since-hours=24 --max-credits=N      (one token, both venues)
 *   node --import tsx backfill.ts --address=<any pubkey, e.g. a pool> --from-slot=A --to-slot=B --max-credits=N
 *   common: [--db=path] (default research/memecoins/data/memecoins.db)
 *
 * Rows land in the same tables with trades.source = 2; (sig, idx) dedupe makes re-runs and
 * overlap with the live collector harmless. Prints throughput so larger jobs can be costed.
 */
import path from 'node:path';
import { extractTxEvents, PUMP_AMM_PROGRAM, PUMP_PROGRAM } from './decode.ts';
import { Processor } from './processor.ts';
import { CreditBudget, fetchPools, gtfaWindow, heliusUrl, rpcCall, rpcStats } from './rpc.ts';
import { Store } from './store.ts';

/** Measured 2026-09-25 (getBlockTime over 100k slots): 0.2664 s per slot (~225 slots/min). */
const SLOT_SEC = 0.2664;
const argv = process.argv.slice(2);
const opt = (n: string, d = '') => { const a = argv.find(x => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const HELIUS = heliusUrl(); if (!HELIUS) throw new Error('no Helius RPC_URL in .env');
const PUBLIC = ['https://solana-rpc.publicnode.com', 'https://api.mainnet-beta.solana.com'];
const maxCredits = Number(opt('max-credits', '1000'));
const budget = new CreditBudget(maxCredits, maxCredits);
const store = new Store(opt('db', path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'data', 'memecoins.db')));
const processor = new Processor(store, pools => fetchPools(pools, PUBLIC, null, budget));
// v3 scope: PumpSwap rows only for tracked (graduated-in-window) pools, unless --all-amm
if (!argv.includes('--all-amm')) {
  const tracked = new Set((store.db.prepare('SELECT pool FROM tracked_pools').all() as { pool: string }[]).map(r => r.pool));
  processor.ammFilter = (pool) => tracked.has(pool);   // backfill.ts: whole requested slot window
}

const tip = await rpcCall<number>(PUBLIC[0], 'getSlot', [{ commitment: 'confirmed' }]);
let address: string, from: number, to: number;
if (opt('address')) {
  address = opt('address'); from = Number(opt('from-slot')); to = Number(opt('to-slot', String(tip - 40)));
} else if (opt('mint')) {
  address = opt('mint');
  to = tip - 40; from = to - Math.round(Number(opt('since-hours', '24')) * 3600 / SLOT_SEC);
} else {
  address = opt('program', 'pump') === 'amm' ? PUMP_AMM_PROGRAM : PUMP_PROGRAM;
  if (opt('from-slot')) { from = Number(opt('from-slot')); to = Number(opt('to-slot', String(tip - 40))); }
  else { to = tip - Math.round(Number(opt('minutes-ago', '60')) * 60 / SLOT_SEC); from = to - Math.round(Number(opt('span-min', '5')) * 60 / SLOT_SEC); }
}
console.log(`backfill ${address} slots ${from}..${to} (${to - from + 1} slots ≈ ${((to - from + 1) * SLOT_SEC / 60).toFixed(1)} min), budget ${maxCredits} credits`);
const t0 = Date.now(); let txs = 0, withEvents = 0;
const before = store.totals.tradesInserted;
const r = await gtfaWindow(HELIUS, address, from, to, budget, (page) => {
  for (const tx of page) {
    txs++;
    if (!tx.meta || tx.meta.err) continue;
    const { events } = extractTxEvents(tx);
    if (events.length) { withEvents++; processor.handleTx(tx.transaction.signatures[0], tx.slot, events, 2, tx.transactionIndex ?? null); }
  }
  store.flush();
  const s = (Date.now() - t0) / 1000;
  process.stdout.write(`\r  ${txs} txs, ${budget.total} credits, ${(rpcStats.bytes / 1e6).toFixed(0)} MB, ${(txs / s).toFixed(0)} tx/s   `);
});
for (let i = 0; i < 10 && processor.pendingPoolTrades(); i++) { await processor.resolvePending(); await new Promise(res => setTimeout(res, 500)); }
processor.drainUnresolved(); store.flush();
const secs = (Date.now() - t0) / 1000;
const inserted = store.totals.tradesInserted - before;
console.log(`\nBACKFILL ${JSON.stringify({ address, from, to, slots: to - from + 1, complete: r.complete, reason: r.reason, txs, txsWithEvents: withEvents,
  tradesInserted: inserted, tradesDup: store.totals.tradesDup, credits: r.credits, mb: +(rpcStats.bytes / 1e6).toFixed(1), seconds: +secs.toFixed(1),
  txPerSec: +(txs / secs).toFixed(1), creditsPerSlot: +(r.credits / (to - from + 1)).toFixed(3), txPerSlot: +(txs / (to - from + 1)).toFixed(2), bytesPerTx: Math.round(rpcStats.bytes / Math.max(1, txs)) })}`);
store.close();
