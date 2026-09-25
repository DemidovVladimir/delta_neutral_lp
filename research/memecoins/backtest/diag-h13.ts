/**
 * Diagnostic: what does the H13 ceiling model exploit on the public tape?
 * Naive entry at age 60 s, exit XB, PRIMARY setting; mean return by quintile of each feature, plus GBM (C1) gain importance.
 *   node --max-old-space-size=8000 --import tsx research/memecoins/backtest/diag-h13.ts
 */
import fs from 'node:fs';
import { loadTape, lastAtOrBefore } from './tape.ts';
import { buildCtx } from './context.ts';
import { simulate, defaultCfg, EXITS } from './sim.ts';
import { SETTINGS } from './run-futility.ts';
import { organicFlags } from './signals.ts';
import { features, FEATURES, fitGBM, CONFIGS } from './h13.ts';
const tape = loadTape('research/memecoins/data/public/cache/vdw');
const ctx = buildCtx(tape, { g1Mode: 'fromStart', warmupDays: 7, g5Mode: 'guard' }, () => {});
const org = organicFlags(ctx);
const X: number[][] = [], y: number[] = [];
for (let m = 0; m < ctx.nM; m++) {
  if (!ctx.universe[m]) continue;
  const tSig = ctx.t0[m] + 60; const sigIdx = lastAtOrBefore(tape.tick, tape.off[m], tape.off[m + 1], tSig);
  const ci = tape.meta[m].completeIdx; if ((ci >= 0 && sigIdx >= ci) || !ctx.signalOk(tSig)) continue;
  const f = simulate(tape, { m, tSig, sigIdx }, EXITS.XB, defaultCfg(SETTINGS.PRIMARY)); if (f.status !== 'ok') continue;
  X.push(features(ctx, org, m, sigIdx, tSig)); y.push(f.ret);
}
const out: Record<string, unknown> = { n: y.length, meanAll: y.reduce((a, b) => a + b, 0) / y.length, quintiles: {} as Record<string, number[]> };
for (let fi = 0; fi < FEATURES.length; fi++) {
  const idx = X.map((_, i) => i).sort((a, b) => X[a][fi] - X[b][fi]);
  const q: number[] = [];
  for (let k = 0; k < 5; k++) { const sl = idx.slice(Math.floor((k * idx.length) / 5), Math.floor(((k + 1) * idx.length) / 5)); q.push(sl.reduce((a, i) => a + y[i], 0) / sl.length); }
  (out.quintiles as Record<string, number[]>)[FEATURES[fi]] = q.map((v) => Math.round(v * 1000) / 10);
}
const imp = new Float64Array(FEATURES.length);
fitGBM(X, y, CONFIGS.C1, 1, imp);
const tot = imp.reduce((a, b) => a + b, 0);
out.importanceC1 = Object.fromEntries(FEATURES.map((f, i) => [f, Math.round((imp[i] / tot) * 1000) / 10]).sort((a, b) => (b[1] as number) - (a[1] as number)).slice(0, 10));
fs.writeFileSync('research/memecoins/results/raw/diag-h13.fromStart.guard.json', JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
