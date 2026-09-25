/**
 * Data-quality audit of a canonical tape (G1 gap sizes, creator-buy distribution, G5 downtime, activity).
 *   node --max-old-space-size=6000 --import tsx research/memecoins/backtest/tape-audit.ts --tape=research/memecoins/data/public/cache/vdw
 */
import fs from 'node:fs';
import { loadTape, dayOf, dayStr } from './tape.ts';
import { buildCtx } from './context.ts';
const arg = (n: string, d?: string) => { const a = process.argv.find((x) => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const tape = loadTape(arg('tape', 'research/memecoins/data/public/cache/vdw')!);
const nM = tape.meta.length;
const q = (a: number[], p: number) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor((s.length - 1) * p)]; };
// gap size relative to observed volume per gapped mint
const rel: number[] = []; const gapN: number[] = []; let volAll = 0, gapAll = 0; const gapTiming: number[] = [];
for (let m = 0; m < nM; m++) {
  const mm = tape.meta[m]; let vol = 0;
  for (let i = tape.off[m]; i < tape.off[m + 1]; i++) { vol += tape.sol[i]; if (tape.gap[i] !== 0) gapTiming.push((tape.tick[i] - mm.t0) * tape.tickSec); }
  volAll += vol; gapAll += mm.gapAbsLamports;
  if (mm.gaps > 0) { rel.push(mm.gapAbsLamports / vol); gapN.push(mm.gaps); }
}
const cb = tape.meta.filter((m) => m.t0Exact).map((m) => m.creatorBuyLamports / 1e9);
const buckets = { none: tape.meta.filter((m) => m.chainFromStart && !m.t0Exact).length, lt005: cb.filter((x) => x < 0.05).length, b005_02: cb.filter((x) => x >= 0.05 && x < 0.2).length, b02_5: cb.filter((x) => x >= 0.2 && x < 5).length, ge5: cb.filter((x) => x >= 5).length };
const ctx = buildCtx(tape, { g1Mode: 'fromStart', warmupDays: 7 }, () => {});
const downByDay: Record<string, number> = {};
for (let k = 0; k < ctx.downMinute.length; k++) if (ctx.downMinute[k]) { const d = dayStr(Math.floor(((ctx.minute0 + k) * 60) / 86_400)); downByDay[d] = (downByDay[d] ?? 0) + 1; }
const tradesPerDay: Record<string, number> = {}; for (let i = 0; i < tape.tick.length; i++) { const d = dayStr(dayOf(tape, tape.tick[i])); tradesPerDay[d] = (tradesPerDay[d] ?? 0) + 1; }
const out = {
  gappedMints: rel.length, unobservedShareOfVolume: gapAll / volAll,
  gapRelToMintVolume: { p50: q(rel, 0.5), p90: q(rel, 0.9), p99: q(rel, 0.99) }, gapsPerGappedMint: { p50: q(gapN, 0.5), p90: q(gapN, 0.9) },
  gapAgeSec: { p10: q(gapTiming, 0.1), p50: q(gapTiming, 0.5), p90: q(gapTiming, 0.9), shareFirst5s: gapTiming.filter((x) => x <= 5).length / gapTiming.length },
  creatorBuyBuckets: buckets, creatorBuySol: { p10: q(cb, 0.1), p50: q(cb, 0.5), p90: q(cb, 0.9) },
  analysisFirstDay: dayStr(ctx.analysisFirstDay), droppedDays: ctx.droppedDays.map(dayStr), downMinutesByDay: downByDay, tradesPerDay,
};
fs.writeFileSync('research/memecoins/results/raw/tape-audit.vdw.json', JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
