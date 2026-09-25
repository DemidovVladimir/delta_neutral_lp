/**
 * Diagnostic for a surviving cell (default H17 [0.05,0.2) SOL creator buy, exit XB): split trades by the coin's
 * lifetime trade count and show the pooled mean if quiet coins are under-represented on the tape by factor k
 * (RED-PUMP census: flat coins are 2-4x less likely to be on the tape than coins with early traction).
 *   node --max-old-space-size=8000 --import tsx research/memecoins/backtest/activity-split.ts
 */
import fs from 'node:fs';
import { loadTape } from './tape.ts';
import { buildCtx } from './context.ts';
import { simulate, defaultCfg, EXITS } from './sim.ts';
import { SETTINGS, HYPS } from './run-futility.ts';
import { organicFlags } from './signals.ts';
const tape = loadTape('research/memecoins/data/public/cache/vdw');
const ctx = buildCtx(tape, { g1Mode: 'fromStart', warmupDays: 7, g5Mode: 'guard' }, () => {});
const org = organicFlags(ctx);
const out: Record<string, unknown> = {};
for (const [hyp, params, exit] of [['H17', { lo: 0.05, hi: 0.2 }, 'XB'], ['H17', { lo: 0.05, hi: 0.2 }, 'XR'], ['H17', { lo: 0.2, hi: 5 }, 'XB']] as const) {
  const sigs = HYPS.find((h) => h.id === hyp)!.gen(ctx, org, params).signals;
  for (const st of ['PRIMARY', 'KILL']) {
    const g: Record<string, number[]> = { quiet: [], active: [] };
    for (const s of sigs) {
      const f = simulate(tape, s, EXITS[exit], defaultCfg(SETTINGS[st])); if (f.status !== 'ok') continue;
      const nTr = tape.off[s.m + 1] - tape.off[s.m];
      (nTr < 50 ? g.quiet : g.active).push(f.ret);
    }
    const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
    const mq = mean(g.quiet), ma = mean(g.active), nq = g.quiet.length, na = g.active.length;
    const scen: Record<string, number> = {};
    for (const k of [1, 2, 3, 5, 8]) scen[`quietUnderSampledBy${k}x`] = (k * nq * mq + na * ma) / (k * nq + na);
    const key = `${hyp}|${JSON.stringify(params)}|${exit}|${st}`;
    out[key] = { nQuiet: nq, meanQuiet: mq, nActive: na, meanActive: ma, pooledIfReweighted: scen };
    console.log(key, JSON.stringify(out[key]));
  }
}
fs.writeFileSync('research/memecoins/results/raw/activity-split.fromStart.guard.json', JSON.stringify(out, null, 1));
