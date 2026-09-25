/**
 * Descriptive baselines on a tape, for sanity checks against our earlier measurements
 * (A26: retail SOL-weighted −20 %/position after retail costs, first-slot snipers −29…−51 %,
 * ~1 % graduation).
 *
 *   node --max-old-space-size=12000 --import tsx research/memecoins/backtest/baselines.ts --tape=research/memecoins/data/public/cache/vdw
 *
 * Positions = (wallet, mint) aggregates over the whole observed life of the mint:
 *   in  = Σ buy curve-SOL × (1 + fee)            out = Σ sell curve-SOL × (1 − fee) + mark of remaining tokens
 *   mark: remaining tokens sold into the final curve state (float path, fees charged); for curves that
 *   completed, into the pool-opening state (optimistic: the tape has no PumpSwap trades).
 * Fee levels: raw (0), pump (1.25 %/side), retail (1.25 % + 1 % terminal per side).
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { loadTape, dayOf, dayStr } from './tape.ts';
import { INIT_VSOL_F, RS_GRAD_F } from './curve.ts';
import { MAYHEM_AGENT } from './adapters/vdw.ts';
import { buildCtx } from './context.ts';

function arg(name: string, def?: string) { const a = process.argv.find((x) => x.startsWith(`--${name}=`)); return a ? a.slice(name.length + 3) : def; }

const tape = loadTape(arg('tape', 'research/memecoins/data/public/cache/vdw')!);
const outDir = arg('out', 'research/memecoins/results/raw')!;
const g1Mode = arg('g1', 'fromStart');
const nM = tape.meta.length;
const mayhemId = tape.traders.indexOf(MAYHEM_AGENT);
// downtime-safe position sample: creation day passes G5 and no downtime minute in [t0, t0 + 2 h]
const ctx = buildCtx(tape, { g1Mode: 'fromStart', warmupDays: 0, g5Mode: 'drop' }, () => {});
const dropped = new Set(ctx.droppedDays);
const cleanLife = (m: number) => {
  const u = tape.epoch + tape.meta[m].t0 * tape.tickSec; if (dropped.has(Math.floor(u / 86_400))) return false;
  const k0 = Math.floor(u / 60) - ctx.minute0; for (let k = k0; k <= k0 + 120; k++) if (k < 0 || k >= ctx.downMinute.length || ctx.downMinute[k]) return false;
  return true;
};
let posMints = 0;

// ---------------- coverage and graduation
const byDay = new Map<number, { launches: number; withTrades: number; fromStart: number; strict: number; complete: number; completeFromStart: number; trades: number }>();
const get = (d: number) => { let e = byDay.get(d); if (!e) { e = { launches: 0, withTrades: 0, fromStart: 0, strict: 0, complete: 0, completeFromStart: 0, trades: 0 }; byDay.set(d, e); } return e; };
for (let m = 0; m < nM; m++) {
  const mm = tape.meta[m];
  if (mm.mayhem) continue;
  const e = get(dayOf(tape, mm.t0));
  e.launches++;
  if (tape.off[m + 1] > tape.off[m]) e.withTrades++;
  if (mm.chainFromStart) e.fromStart++;
  if (mm.g1Strict) e.strict++;
  if (mm.completeIdx >= 0) { e.complete++; if (mm.chainFromStart) e.completeFromStart++; }
}
for (let i = 0; i < tape.tick.length; i++) get(dayOf(tape, tape.tick[i])).trades++;

// RED-PUMP launches per day + overlap
const rpPath = arg('redpump', 'research/memecoins/data/public/redpump/red_pump_2026_v1_launches.jsonl.gz')!;
const rpByDay = new Map<number, number>(); const rpMints = new Set<string>();
const rpOutPath = 'research/memecoins/data/public/redpump/red_pump_2026_v1_outcomes.csv.gz';
let rpGrad = 0, rpTimeout = 0; const rpInitHi = { grad: 0, n: 0 }, rpInitLo = { grad: 0, n: 0 };
if (fs.existsSync(rpPath)) {
  const init = new Map<string, number>();
  for (const line of zlib.gunzipSync(fs.readFileSync(rpPath)).toString('utf8').split('\n')) {
    if (!line) continue; const j = JSON.parse(line); if (rpMints.has(j.mint)) continue; rpMints.add(j.mint);
    const d = Math.floor(j.created_timestamp / 86_400_000); rpByDay.set(d, (rpByDay.get(d) ?? 0) + 1); init.set(j.mint, j.initial_market_cap_sol);
  }
  const outcome = new Map<string, string>();
  for (const line of zlib.gunzipSync(fs.readFileSync(rpOutPath)).toString('utf8').split('\n').slice(1)) {
    const c = line.split(','); const mint = c[1], oc = c[3];
    if (oc !== 'GRADUATED' && oc !== 'TIMEOUT') continue;
    if (outcome.get(mint) === 'GRADUATED') continue; outcome.set(mint, oc);
  }
  for (const [mint, oc] of outcome) {
    if (oc === 'GRADUATED') rpGrad++; else rpTimeout++;
    const im = init.get(mint); if (im === undefined) continue;
    const b = im > 30.0001 ? rpInitHi : rpInitLo; b.n++; if (oc === 'GRADUATED') b.grad++;
  }
}
let overlapMints = 0, vdwInRpDays = 0;
const rpDaySet = new Set(rpByDay.keys());
for (let m = 0; m < nM; m++) { const d = dayOf(tape, tape.meta[m].t0); if (rpDaySet.has(d)) { vdwInRpDays++; if (rpMints.has(tape.meta[m].mint)) overlapMints++; } }

// ---------------- positions
const FEES = { raw: 0, pump: 0.0125, retail: 0.0225 };
type Acc = { inS: number; outS: number; n: number; win: number };
const acc: Record<string, Record<string, Acc>> = {};
const add = (grp: string, fk: string, inS: number, outS: number) => {
  acc[grp] ??= {}; const a = (acc[grp][fk] ??= { inS: 0, outS: 0, n: 0, win: 0 });
  a.inS += inS; a.outS += outS; a.n++; if (outS > inS) a.win++;
};
let solInGraduated = 0, solInAll = 0;
const zeroSum = { inS: 0, outS: 0, gap: 0 };
for (let m = 0; m < nM; m++) {
  const mm = tape.meta[m];
  if (mm.mayhem || !(g1Mode === 'strict' ? mm.g1Strict : mm.chainFromStart) || !cleanLife(m)) continue;
  posMints++;
  const lo = tape.off[m], hi = tape.off[m + 1]; if (hi <= lo) continue;
  const pos = new Map<number, { b: number; s: number; tokB: number; tokS: number; first: number }>();
  for (let i = lo; i < hi; i++) {
    const w = tape.trader[i]; if (w === mayhemId) continue;
    let p = pos.get(w); if (!p) { p = { b: 0, s: 0, tokB: 0, tokS: 0, first: tape.tick[i] }; pos.set(w, p); }
    if (tape.isBuy[i]) { p.b += tape.sol[i]; p.tokB += tape.tok[i]; } else { p.s += tape.sol[i]; p.tokS += tape.tok[i]; }
  }
  const last = hi - 1; const complete = mm.completeIdx >= 0;
  // Pro-rata liquidation mark: all outstanding tokens together extract exactly the curve's real SOL
  // (vSol - 30 SOL) or, after completion, Q*H/(B+H) from the pool-opening state. Marks therefore sum to
  // what can actually be withdrawn (zero-sum check: all wallets, raw, ~= 0 up to unobserved flow).
  const creatorName = mm.creator;
  let H = 0; for (const p of pos.values()) H += Math.max(0, p.tokB - p.tokS);
  const endS = complete ? tape.vSol[mm.completeIdx] : tape.vSol[last];
  const Q = endS - INIT_VSOL_F - (complete ? 15_000_001 : 0), B = 206_900_000e6;
  const liq = H <= 0 ? 0 : complete ? (Q * H) / (B + H) : Q;
  const perTok = H > 0 ? liq / H : 0;
  let sysIn = 0, sysOut = 0;
  for (const [w, p] of pos) {
    if (p.b <= 0) continue;
    const isCreator = tape.traders[w] === creatorName;
    const rem = Math.max(0, p.tokB - p.tokS);
    const markGross = rem * perTok;
    sysIn += p.b; sysOut += p.s + markGross;
    const ageFirst = (p.first - mm.t0) * tape.tickSec;
    const grp = isCreator ? 'creator' : ageFirst <= 0 ? 'sniper_t0' : ageFirst <= 2 ? 'sniper_2s' : ageFirst <= 10 ? 'early_2_10s' : 'other';
    for (const [fk, f] of Object.entries(FEES)) {
      const inS = p.b * (1 + f), outS = (p.s + markGross) * (1 - f);
      add(grp, fk, inS, outS);
      if (!isCreator) add('all_noncreator', fk, inS, outS);
    }
    if (!isCreator) { solInAll += p.b; if (complete) solInGraduated += p.b; }
  }
  zeroSum.inS += sysIn; zeroSum.outS += sysOut; zeroSum.gap += mm.gapAbsLamports;
}
const posOut: Record<string, Record<string, { n: number; solWeighted: number; pctProfitable: number; solInSOL: number }>> = {};
for (const [g, byF] of Object.entries(acc)) { posOut[g] = {}; for (const [fk, a] of Object.entries(byF)) posOut[g][fk] = { n: a.n, solWeighted: a.outS / a.inS - 1, pctProfitable: a.win / a.n, solInSOL: a.inS / 1e9 }; }

const days = [...byDay.keys()].sort((a, b) => a - b);
const perDay = days.map((d) => ({ day: dayStr(d), ...byDay.get(d)!, redpumpLaunches: rpByDay.get(d) ?? 0 }));
const tot = perDay.reduce((s, e) => ({ launches: s.launches + e.launches, fromStart: s.fromStart + e.fromStart, strict: s.strict + e.strict, complete: s.complete + e.complete, completeFromStart: s.completeFromStart + e.completeFromStart, trades: s.trades + e.trades }), { launches: 0, fromStart: 0, strict: 0, complete: 0, completeFromStart: 0, trades: 0 });
const summary = {
  source: tape.source, g1Mode, mints: nM, trades: tape.tick.length, firstDay: dayStr(days[0]), lastDay: dayStr(days[days.length - 1]),
  totals: tot,
  graduation: { allLaunches: tot.complete / tot.launches, chainFromStart: tot.completeFromStart / tot.fromStart },
  redpump: { launches: rpMints.size, graduated: rpGrad, timeout: rpTimeout, gradRateLowerBound: rpGrad / (rpGrad + rpTimeout), initMcapAbove30: { n: rpInitHi.n, gradRate: rpInitHi.grad / rpInitHi.n }, initMcap30orLess: { n: rpInitLo.n, gradRate: rpInitLo.grad / rpInitLo.n }, vdwMintsOnRedpumpDays: vdwInRpDays, ofWhichInRedpump: overlapMints },
  positionSampleMints: posMints, positionSampleDays: [...new Set(Array.from({ length: nM }, (_, m) => m).filter((m) => !tape.meta[m].mayhem && cleanLife(m)).map((m) => dayStr(dayOf(tape, tape.meta[m].t0))))].sort(),
  zeroSumCheck: { allWalletsRawReturn: zeroSum.outS / zeroSum.inS - 1, unobservedFlowShareOfIn: zeroSum.gap / zeroSum.inS, note: 'all wallets incl. creators, raw curve amounts, pro-rata liquidation marks; should be ~0' },
  positions: posOut, nonCreatorSolInGraduatedShare: solInGraduated / solInAll,
  perDay,
};
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, `baselines.${tape.source}.${g1Mode}.json`), JSON.stringify(summary, null, 1));
console.log(JSON.stringify({ ...summary, perDay: undefined }, null, 1));
void RS_GRAD_F;
