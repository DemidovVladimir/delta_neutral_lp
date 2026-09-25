/**
 * Activity of coins in the first 30 min after creation: our collector (2026-09-23..25) vs the public tape.
 * For C1 coins (creator buy 0.05-0.2 SOL) and all universe coins. Also curve completion within 1 h on the tape.
 *   node --max-old-space-size=8000 --import tsx research/memecoins/backtest/activity-compare.ts <collector|vdw>
 */
import fs from 'node:fs';
import { loadCollector } from './adapters/collector.ts';
import { loadTape, lastAtOrBefore, type Tape } from './tape.ts';
import { buildCtx } from './context.ts';
const which = process.argv[2];
const D = (s: string) => Date.parse(s) / 1000;
const tape: Tape = which === 'collector'
  ? loadCollector('research/memecoins/data/memecoins.db', { createdFrom: D('2026-09-18T00:00:00Z'), createdTo: D('2026-09-25T13:48:32Z'), tradesTo: D('2026-09-25T14:00:00Z') }).tape
  : loadTape('research/memecoins/data/public/cache/vdw');
const ctx = buildCtx(tape, { g1Mode: 'fromStart', warmupDays: which === 'collector' ? 0 : 7, g5Mode: 'guard' }, () => {});
const q = (a: number[], p: number) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor((s.length - 1) * p)] ?? NaN; };
const res: Record<string, unknown> = {};
for (const grp of ['C1', 'all']) {
  const n30: number[] = [], vol30: number[] = []; let zero = 0, n = 0, c1h = 0, maxProg: number[] = [];
  for (let m = 0; m < ctx.nM; m++) {
    if (!ctx.universe[m] || !ctx.signalOk(ctx.t0[m])) continue;
    const mm = tape.meta[m];
    if (grp === 'C1' && !(mm.t0Exact && mm.creatorBuyLamports >= 5e7 && mm.creatorBuyLamports < 2e8)) continue;
    const lo = tape.off[m], hi = tape.off[m + 1];
    const e = lastAtOrBefore(tape.tick, lo, hi, Math.floor(ctx.t0[m] + 1800 / tape.tickSec));
    const k = Math.max(0, e - lo); // trades after the first one, within 30 min
    n++; n30.push(k); if (k === 0) zero++;
    let v = 0, mx = 0; for (let i = lo + 1; i <= e; i++) { v += tape.sol[i]; if (tape.vSol[i] > mx) mx = tape.vSol[i]; }
    vol30.push(v / 1e9); maxProg.push(Math.max(0, (mx - 30e9) / 85.005359e9));
    const ct = ctx.completeTick[m]; if (Number.isFinite(ct) && (ct - ctx.t0[m]) * tape.tickSec <= 3600) c1h++;
  }
  res[grp] = { coins: n, shareNoTradeAfterCreation30m: zero / n, tradesIn30m: { p25: q(n30, 0.25), p50: q(n30, 0.5), p75: q(n30, 0.75), p90: q(n30, 0.9) }, solVolumeIn30m: { p50: q(vol30, 0.5), p90: q(vol30, 0.9) }, maxProgress30m: { p50: q(maxProg, 0.5), p90: q(maxProg, 0.9) }, completedWithin1h: c1h / n };
}
console.log(JSON.stringify(res, null, 1));
fs.writeFileSync(`research/memecoins/results/raw/activity-compare.${which}.json`, JSON.stringify(res, null, 1));
