/**
 * Size sensitivity (PROTOCOL §7 "return vs size, 0.05 -> 0.5 SOL") for selected cells; not selection variants.
 *   node --max-old-space-size=8000 --import tsx research/memecoins/backtest/size-sweep.ts
 */
import fs from 'node:fs';
import { loadTape, lastAtOrBefore } from './tape.ts';
import { buildCtx } from './context.ts';
import { simulate, defaultCfg, EXITS, type Signal } from './sim.ts';
import { SETTINGS, HYPS } from './run-futility.ts';
import { organicFlags } from './signals.ts';
import { summarize } from './stats.ts';
const tape = loadTape('research/memecoins/data/public/cache/vdw');
const ctx = buildCtx(tape, { g1Mode: 'fromStart', warmupDays: 7, g5Mode: 'guard' }, () => {});
const org = organicFlags(ctx);
const naive: Signal[] = [];
for (let m = 0; m < ctx.nM; m++) { if (!ctx.universe[m]) continue; const tSig = ctx.t0[m] + 30; const sigIdx = lastAtOrBefore(tape.tick, tape.off[m], tape.off[m + 1], tSig); const ci = tape.meta[m].completeIdx; if ((ci >= 0 && sigIdx >= ci) || !ctx.signalOk(tSig)) continue; naive.push({ m, tSig, sigIdx }); }
const cells: [string, Signal[], string][] = [
  ['H17|lo=0.05;hi=0.2', HYPS.find((h) => h.id === 'H17')!.gen(ctx, org, { lo: 0.05, hi: 0.2 }).signals, 'XB'],
  ['B_naive age=30', naive, 'XT300'],
];
const out: unknown[] = [];
for (const [name, sigs, ex] of cells) for (const size of [0.05, 0.1, 0.25, 0.5]) {
  const cfg = defaultCfg({ ...SETTINGS.PRIMARY, size: size * 1e9 });
  const ok = sigs.map((s) => simulate(tape, s, EXITS[ex], cfg)).filter((f) => f.status === 'ok');
  const sm = summarize(ok.map((f) => f.ret), ok.map((f) => f.pnl), ok.map((f) => f.basis), ok.map((f) => f.day), 2000);
  out.push({ cell: name, exit: ex, sizeSol: size, n: sm.n, mean: sm.mean, lo: sm.lo, hi: sm.hi, solWeighted: sm.solWeighted });
  console.log(`${name} ${ex} size ${size}: n=${sm.n} mean=${(sm.mean * 100).toFixed(2)} % [${(sm.lo * 100).toFixed(2)}, ${(sm.hi * 100).toFixed(2)}]`);
}
fs.writeFileSync('research/memecoins/results/raw/size-sweep.fromStart.guard.json', JSON.stringify(out, null, 1));
