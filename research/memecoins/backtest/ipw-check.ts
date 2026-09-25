/**
 * Selection-bias probe for surviving variants (information only; not a verdict input).
 * Each tape coin that also appears in RED-PUMP's launch census gets weight 1 / P(in tape | initial-mcap bucket,
 * graduated within ~6 min), with P from selection-audit.json (16 fully collected overlap days). This undoes only
 * the graduation dimension of the tape's outcome-correlated inclusion, so it shows the DIRECTION of the bias.
 *
 *   node --max-old-space-size=8000 --import tsx research/memecoins/backtest/ipw-check.ts
 */
import fs from 'node:fs';
import zlib from 'node:zlib';
import { loadTape, lastAtOrBefore } from './tape.ts';
import { buildCtx } from './context.ts';
import { simulate, defaultCfg, EXITS, type Signal } from './sim.ts';
import { SETTINGS, HYPS } from './run-futility.ts';
import { organicFlags } from './signals.ts';
import { mulberry } from './stats.ts';

const tape = loadTape('research/memecoins/data/public/cache/vdw');
const ctx = buildCtx(tape, { g1Mode: 'fromStart', warmupDays: 7, g5Mode: 'guard' }, () => {});
const org = organicFlags(ctx);
const sel = JSON.parse(fs.readFileSync('research/memecoins/results/raw/selection-audit.json', 'utf8')).byInitialMcap as Record<string, { pInTape_graduated6min: number | null; pInTape_notGraduated: number }>;
const init = new Map<string, number>(); const grad = new Set<string>();
for (const line of zlib.gunzipSync(fs.readFileSync('research/memecoins/data/public/redpump/red_pump_2026_v1_launches.jsonl.gz')).toString('utf8').split('\n')) { if (!line) continue; const j = JSON.parse(line); if (!init.has(j.mint)) init.set(j.mint, j.initial_market_cap_sol); }
for (const line of zlib.gunzipSync(fs.readFileSync('research/memecoins/data/public/redpump/red_pump_2026_v1_outcomes.csv.gz')).toString('utf8').split('\n')) { const c = line.split(','); if (c[3] === 'GRADUATED') grad.add(c[1]); }
const selMove = JSON.parse(fs.readFileSync('research/memecoins/results/raw/selection-audit.json', 'utf8')).byInitialMcapAndEarlyMove_nonGraduated as Record<string, { n: number; pInTape: number }>;
const finMcap = new Map<string, number>();
for (const line of zlib.gunzipSync(fs.readFileSync('research/memecoins/data/public/redpump/red_pump_2026_v1_outcomes.csv.gz')).toString('utf8').split('\n')) { const c = line.split(','); if (c[3] === 'TIMEOUT' || c[3] === 'GRADUATED') { const v = Number(c[6]); if (Number.isFinite(v)) finMcap.set(c[1], v); } }
const fbucket = (r: number) => (r < 0.9 ? 'fell' : r < 1.2 ? 'flat' : r < 2 ? 'x1.2-2' : r < 5 ? 'x2-5' : '>=x5');
/** weight 2: 1 / P(in tape | initial-mcap bucket, early move to ~6 min), non-graduated coins; graduated use weight 1. */
const weight2 = (m: number): number | null => {
  const mint = tape.meta[m].mint; const im = init.get(mint); const fm = finMcap.get(mint);
  if (im === undefined || fm === undefined || im <= 0) return null;
  if (grad.has(mint)) { const s = sel[bucket(im)]; return s?.pInTape_graduated6min ? 1 / s.pInTape_graduated6min : null; }
  const e = selMove[`${bucket(im)}|${fbucket(fm / im)}`]; return e && e.pInTape > 0.05 && e.n >= 200 ? 1 / e.pInTape : null;
};
const bucket = (im: number) => (Math.abs(im - 30) < 1e-6 ? '=30' : im < 30 ? '<30' : im < 32 ? '30-32' : im < 45 ? '32-45' : '>=45');
const weight = (m: number): number | null => {
  const mint = tape.meta[m].mint; const im = init.get(mint); if (im === undefined) return null;
  const s = sel[bucket(im)]; if (!s) return null;
  const p = grad.has(mint) ? s.pInTape_graduated6min : s.pInTape_notGraduated;
  return p && p > 0 ? 1 / p : null;
};

const probes: { hyp: string; params: Record<string, unknown>; exit: string }[] = [
  ...['XT60', 'XT300', 'XT1800', 'XB', 'XR', 'XG'].map((exit) => ({ hyp: 'H17', params: { lo: 0.05, hi: 0.2 }, exit })),
  { hyp: 'H01', params: { V: 35, N: 25, T: 60 }, exit: 'XT60' }, { hyp: 'H01', params: { V: 35, N: 25, T: 60 }, exit: 'XR' },
  { hyp: 'H04', params: { A: 900, r: 0.8 }, exit: 'XR' }, { hyp: 'H06', params: { k: 2, D: 60 }, exit: 'XR' },
  { hyp: 'H08', params: { nMin: 10, g: 0.15 }, exit: 'XT300' }, { hyp: 'H03', params: { D: 30, F: 8 }, exit: 'XR' },
  { hyp: 'NAIVE', params: { age: 30 }, exit: 'XT300' },
  // diagnostic (exploratory, logged): quiet vs active coins at age 60 s, XB exit (the pattern H13 can learn)
  { hyp: 'NAIVE', params: { age: 60, quiet: true }, exit: 'XB' },
  { hyp: 'NAIVE', params: { age: 60, quiet: false }, exit: 'XB' },
];
const out: unknown[] = [];
for (const pr of probes) {
  let sigs: Signal[];
  if (pr.hyp === 'NAIVE') {
    sigs = [];
    const age = pr.params.age as number, quiet = pr.params.quiet as boolean | undefined;
    for (let m = 0; m < ctx.nM; m++) {
      if (!ctx.universe[m]) continue; const tSig = ctx.t0[m] + age; const sigIdx = lastAtOrBefore(tape.tick, tape.off[m], tape.off[m + 1], tSig);
      const ci = tape.meta[m].completeIdx; if ((ci >= 0 && sigIdx >= ci) || !ctx.signalOk(tSig)) continue;
      if (quiet !== undefined) { const rs = (sigIdx >= tape.off[m] ? tape.vSol[sigIdx] : 30e9) - 30e9; if (quiet !== rs < 1e9) continue; }
      sigs.push({ m, tSig, sigIdx });
    }
  } else sigs = HYPS.find((h) => h.id === pr.hyp)!.gen(ctx, org, pr.params).signals;
  const row: Record<string, unknown> = { ...pr, nSignals: sigs.length };
  for (const st of ['PRIMARY', 'KILL']) {
    const cfg = defaultCfg(SETTINGS[st]);
    const byDay = new Map<number, [number, number, number, number]>(); // sum r, n, sum w r, sum w (joined subset)
    let w2s = 0, w2r = 0, w2n = 0, w2u = 0;
    let nAll = 0, sAll = 0;
    for (const s of sigs) {
      const f = simulate(tape, s, EXITS[pr.exit], cfg); if (f.status !== 'ok') continue;
      nAll++; sAll += f.ret;
      const w2 = weight2(s.m); if (w2 !== null) { w2s += w2; w2r += w2 * f.ret; w2n++; w2u += f.ret; }
      const w = weight(s.m); if (w === null) continue;
      const e = byDay.get(f.day) ?? [0, 0, 0, 0]; e[0] += f.ret; e[1]++; e[2] += w * f.ret; e[3] += w; byDay.set(f.day, e);
    }
    const D = [...byDay.values()]; const tot = D.reduce((a, e) => [a[0] + e[0], a[1] + e[1], a[2] + e[2], a[3] + e[3]], [0, 0, 0, 0]);
    const rnd = mulberry(27); const bs: number[] = [];
    for (let b = 0; b < 5000; b++) { let a = 0, c = 0; for (let k = 0; k < D.length; k++) { const e = D[Math.floor(rnd() * D.length)]; a += e[2]; c += e[3]; } bs.push(a / c); }
    bs.sort((x, y) => x - y);
    row[st] = { nAll, meanAll: sAll / nAll, nJoined: tot[1], meanJoinedUnweighted: tot[0] / tot[1], meanJoinedIPW: tot[2] / tot[3], ipwCI: [bs[Math.floor(0.025 * bs.length)], bs[Math.floor(0.975 * bs.length)]], days: D.length, moveWeighted: { n: w2n, unweighted: w2u / w2n, weighted: w2r / w2s } };
  }
  out.push(row);
  console.log(JSON.stringify(row));
}
fs.writeFileSync('research/memecoins/results/raw/ipw-check.fromStart.guard.json', JSON.stringify(out, null, 1));
