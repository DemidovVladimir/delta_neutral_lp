/**
 * Operator-ordered analysis of the collector data available on 2026-09-25 (HYPOTHESES.md Amendment A1.2).
 *   1. C1 exactly as frozen (A1.4 + A1.1), decision per A1.2 (1-hour-block bootstrap), plus coin-level and day-block CIs,
 *      sensitivities L = 0.4 s (optimistic, racing budget; and pessimistic), no-insert, L = 10 s.
 *   2. EXPLORATORY scan of the public-tape grid (H01–H10, H17, H07 control; filters F01–F07 + NOCB + F02b), 1-hour blocks.
 *   3. Descriptive: completion rate, SOL-weighted returns of buyer groups (pro-rata liquidation marks).
 *   node --max-old-space-size=8000 --import tsx research/memecoins/backtest/collected-2d.ts
 * Reuses the frozen components unchanged (collector adapter, context, signals, sim, stats).
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadCollector } from './adapters/collector.ts';
import { buildCtx, type Ctx } from './context.ts';
import { simulate, defaultCfg, EXITS, ALL_EXITS, type Fill, type Signal, type ExecCfg } from './sim.ts';
import { SETTINGS, HYPS } from './run-futility.ts';
import * as S from './signals.ts';
import { summarize, dayBootstrap, pairedDiffBootstrap } from './stats.ts';
import { unixOf, dayOf, dayStr, lastAtOrBefore } from './tape.ts';
import { INIT_VSOL_F } from './curve.ts';
import { appendLedger, codeHash, type LedgerRow } from './ledger.ts';

const DB = 'research/memecoins/data/memecoins.db';
const D = (s: string) => Date.parse(s) / 1000;
const t00 = Date.now(); const log = (s: string) => console.log(`[${((Date.now() - t00) / 1000).toFixed(0)}s] ${s}`);
const { tape, stats: load } = loadCollector(DB, { createdFrom: D('2026-09-18T00:00:00Z'), createdTo: D('2026-09-25T13:48:32Z'), tradesTo: D('2026-09-25T14:00:00Z') });
log(`loaded ${JSON.stringify(load)}`);
const ctx: Ctx = buildCtx(tape, { g1Mode: 'fromStart', warmupDays: 0, g5Mode: 'guard' }, log);
const hourOf = (s: Signal) => Math.floor(unixOf(tape, s.tSig) / 3600);
const SET: Record<string, Partial<ExecCfg>> = { ...SETTINGS, L04pess: { L: 0.4, placement: 'pess', model: 'replay', budget: 500_000 } };
const pct = (x: number) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(2)} %`;
const out: Record<string, unknown> = { load, measuredSlotSec: tape.tickSec, deltaSlotsL2: Math.ceil(2 / tape.tickSec - 1e-9) };
const hash = codeHash();
const ledger: LedgerRow[] = [];

function evalSig(sigs: Signal[], exitId: string, st: string, extra?: (s: Signal) => Signal) {
  const cfg = defaultCfg(SET[st]);
  const rows: { f: Fill; s: Signal; hour: number }[] = [];
  const statuses: Record<string, number> = {};
  for (const s0 of sigs) { const s = extra ? extra(s0) : s0; const f = simulate(tape, s, EXITS[exitId], cfg); statuses[f.status] = (statuses[f.status] ?? 0) + 1; if (f.status === 'ok') rows.push({ f, s, hour: hourOf(s) }); }
  return { rows, statuses };
}
function summ(rows: { f: Fill; hour: number }[]) {
  const r = rows.map((x) => x.f.ret), p = rows.map((x) => x.f.pnl), b = rows.map((x) => x.f.basis);
  const sm = summarize(r, p, b, rows.map((x) => x.hour), 10_000); // lo/hi = 1-hour-block bootstrap
  const coin = dayBootstrap(rows.map((_, i) => i), r, 10_000); // coin-level (one trade per coin)
  const day = dayBootstrap(rows.map((x) => x.f.day), r, 10_000);
  return { n: sm.n, hours: sm.days, days: new Set(rows.map((x) => x.f.day)).size, mean: sm.mean, median: sm.median, win: sm.win, trim1: sm.trim1, meanNoTop3: sm.meanNoTop3,
    worst: sm.worst, best: sm.best, pnlSol: p.reduce((a, v) => a + v, 0) / 1e9, solWeighted: sm.solWeighted, hourCI: [sm.lo, sm.hi], coinCI: [coin.lo, coin.hi], dayCI: [day.lo, day.hi], bestHourShare: sm.bestDayShare };
}

// ============================================================ 1. C1
const c1sigs = S.H17(ctx, new Uint8Array(0), { lo: 0.05, hi: 0.2 }).signals;
const c1: Record<string, unknown> = { nSignals: c1sigs.length };
for (const st of ['PRIMARY', 'KILL', 'L04pess', 'NOINS', 'L10']) {
  const { rows, statuses } = evalSig(c1sigs, 'XB', st);
  const sm = summ(rows);
  const seg = (pred: (s: Signal) => boolean) => { const rr = rows.filter((x) => pred(x.s)); return rr.length ? { n: rr.length, mean: rr.reduce((a, x) => a + x.f.ret, 0) / rr.length, pnlSol: rr.reduce((a, x) => a + x.f.pnl, 0) / 1e9 } : { n: 0 }; };
  const live = D('2026-09-25T00:00:00Z');
  c1[st] = { ...sm, statuses, exitReasons: rows.reduce<Record<string, number>>((a, x) => { a[x.f.reason] = (a[x.f.reason] ?? 0) + 1; return a; }, {}),
    backfillSegment: seg((s) => tape.meta[s.m].createdAt < live), liveSegment: seg((s) => tape.meta[s.m].createdAt >= live),
    perDay: [...new Set(rows.map((x) => x.f.day))].sort().map((d) => { const rr = rows.filter((x) => x.f.day === d); return { day: dayStr(d), n: rr.length, mean: rr.reduce((a, x) => a + x.f.ret, 0) / rr.length }; }) };
  log(`C1 ${st}: n=${sm.n} hours=${sm.hours} mean=${pct(sm.mean)} median=${pct(sm.median)} win=${(sm.win * 100).toFixed(1)} % pnl=${sm.pnlSol.toFixed(4)} SOL hourCI=[${pct(sm.hourCI[0])}, ${pct(sm.hourCI[1])}] coinCI=[${pct(sm.coinCI[0])}, ${pct(sm.coinCI[1])}]`);
  const c = { ...defaultCfg(), ...SET[st] };
  ledger.push({ hypothesis: 'H17', variantId: 'H17|lo=0.05;hi=0.2|XB', params: 'lo=0.05;hi=0.2 (C1)', exit: 'XB', filterSet: 'none', latency: c.L, placement: c.placement, model: c.model, sizeSol: 0.1, split: 'collector-C1-look1-A1.2(hour-block CI)', n: sm.n, mean: sm.mean, lo: sm.hourCI[0], hi: sm.hourCI[1], countsTowardK: false });
}
const P = c1.PRIMARY as { n: number; mean: number; hourCI: number[] };
c1.decisionA12 = P.hourCI[1] < 0 ? 'KILL' : P.mean > 0 && P.hourCI[0] > 0 ? 'PASS-1' : 'CONTINUE';
log(`C1 decision (A1.2): ${c1.decisionA12}`);
out.C1 = c1;

// ============================================================ 2. exploratory scan
const dir = 'research/memecoins/notes/robinhood-and-social-data'; const kw = new Set<string>();
for (const f of ['kolscan_leaderboard_2026-09-25.json', 'kolscan_all_kols_2026-09-25.json']) { const p = path.join(dir, f); if (fs.existsSync(p)) for (const r of JSON.parse(fs.readFileSync(p, 'utf8'))) if (r.wallet) kw.add(r.wallet); }
const kols = new Set<number>(); tape.traders.forEach((w, i) => { if (kw.has(w)) kols.add(i); });
const org = S.organicFlags(ctx);
const defs = [...HYPS, { id: 'H07', gen: S.H07, grid: [{ S: 0.5, kols }, { S: 2, kols }], exits: ALL_EXITS }, { id: 'H07', gen: S.H07, grid: [{ S: 0.5, kols, mirror: true }, { S: 2, kols, mirror: true }], exits: ['XT1800'] }];
const scan: { hyp: string; variantId: string; nSignals: number; PRIMARY: ReturnType<typeof summ>; KILL: ReturnType<typeof summ> }[] = [];
for (const h of defs) for (const p of h.grid) {
  const sigs = h.gen(ctx, org, p as never).signals;
  const pShow = Object.entries(p).filter(([k]) => k !== 'kols').map(([k, v]) => `${k}=${v}`).join(';');
  for (const ex of h.exits) {
    const v = { hyp: h.id, variantId: `${h.id}|${pShow}|${ex}`, nSignals: sigs.length, PRIMARY: summ(evalSig(sigs, ex, 'PRIMARY').rows), KILL: summ(evalSig(sigs, ex, 'KILL').rows) };
    scan.push(v);
    ledger.push({ hypothesis: h.id, variantId: v.variantId, params: pShow, exit: ex, filterSet: 'none', latency: 2, placement: 'pess', model: 'replay', sizeSol: 0.1, split: 'collector-exploratory-2026-09-23..25(hour-block CI)', n: v.PRIMARY.n, mean: v.PRIMARY.mean, lo: v.PRIMARY.hourCI[0], hi: v.PRIMARY.hourCI[1], countsTowardK: false });
  }
}
log(`scan: ${scan.length} variants`);
out.scan = scan;

// naive baseline + filters
const naive = (age: number): Signal[] => {
  const o: Signal[] = [];
  for (let m = 0; m < ctx.nM; m++) { if (!ctx.universe[m]) continue; const tSig = ctx.t0[m] + ctx.secToTicks(age); const sigIdx = lastAtOrBefore(tape.tick, tape.off[m], tape.off[m + 1], Math.floor(tSig)); const ci = tape.meta[m].completeIdx; if ((ci >= 0 && sigIdx >= ci) || !ctx.signalOk(tSig)) continue; o.push({ m, tSig, sigIdx }); }
  return o;
};
const f06 = S.makeF06(ctx);
const f02 = new Map<string, Int32Array>();
const f02idx = (x: number, T: number) => { const k = `${x}|${T}`; let a = f02.get(k); if (!a) { a = new Int32Array(ctx.nM).fill(-1); for (let m = 0; m < ctx.nM; m++) if (ctx.universe[m]) a[m] = S.F02flagIdx(ctx, m, { x, T }); f02.set(k, a); } return a; };
const filters: { id: string; params: Record<string, unknown>; flag: (m: number, s: Signal) => boolean | null }[] = [];
for (const b of [1, 3]) for (const s of [10, 25]) filters.push({ id: 'F01', params: { b, s }, flag: (m, sg) => S.F01(ctx, m, sg, { b, s }) });
for (const x of [50, 90]) for (const T of [60, 600]) filters.push({ id: 'F02a', params: { x, T }, flag: (m, sg) => { const i = f02idx(x, T)[m]; return i >= 0 && i <= sg.sigIdx; } });
for (const h of [5, 15]) filters.push({ id: 'F03', params: { h }, flag: (m, sg) => S.F03(ctx, m, sg, { h }) });
for (const c of [25, 40]) filters.push({ id: 'F04', params: { c }, flag: (m, sg) => S.F04(ctx, m, sg, { c }) });
for (const n of [5, 20]) filters.push({ id: 'F05', params: { n }, flag: (m, sg) => S.F05(ctx, m, sg, { n }) });
filters.push({ id: 'F06', params: {}, flag: (m, sg) => f06(m, sg) });
for (const w of [10, 30]) filters.push({ id: 'F07', params: { w }, flag: (m, sg) => S.F07(ctx, m, sg, { w }) });
filters.push({ id: 'NOCB', params: {}, flag: (m) => (tape.meta[m].chainFromStart ? !tape.meta[m].t0Exact : null) });
const naiveOut: unknown[] = [], filtOut: unknown[] = [];
for (const age of [30, 120]) {
  const sigs = naive(age);
  for (const ex of ['XT300', 'XB']) for (const st of ['PRIMARY', 'KILL']) {
    const { rows } = evalSig(sigs, ex, st);
    const sm = summ(rows); naiveOut.push({ age, exit: ex, setting: st, ...sm });
    log(`B_naive age=${age} ${ex} ${st}: n=${sm.n} mean=${pct(sm.mean)} median=${pct(sm.median)} hourCI=[${pct(sm.hourCI[0])}, ${pct(sm.hourCI[1])}]`);
    if (st !== 'PRIMARY') continue;
    for (const f of filters) {
      const fa: number[] = [], fh: number[] = [], ua: number[] = [], uh: number[] = [];
      for (const x of rows) { const fl = f.flag(x.s.m, x.s); if (fl === null) continue; if (fl) { fa.push(x.f.ret); fh.push(x.hour); } else { ua.push(x.f.ret); uh.push(x.hour); } }
      const d = fa.length && ua.length ? pairedDiffBootstrap(fh, fa, uh, ua, 10_000) : { diff: NaN, lo: NaN, hi: NaN };
      filtOut.push({ filter: f.id, params: f.params, age, exit: ex, nFlagged: fa.length, nUnflagged: ua.length, meanFlagged: fa.reduce((a, v) => a + v, 0) / Math.max(1, fa.length), meanUnflagged: ua.reduce((a, v) => a + v, 0) / Math.max(1, ua.length), diff: d.diff, lo: d.lo, hi: d.hi });
    }
    // F02b exit override
    for (const x of [50, 90]) for (const T of [60, 600]) {
      const idx = f02idx(x, T); const dv: number[] = [], dh: number[] = [];
      for (const r of rows) { const fi = idx[r.s.m]; if (fi < 0 || fi <= r.s.sigIdx) continue; const g = simulate(tape, { ...r.s, overrideIdx: fi }, EXITS[ex], defaultCfg(SET.PRIMARY)); if (g.status !== 'ok') continue; dv.push(g.ret - r.f.ret); dh.push(r.hour); }
      const d = dv.length ? pairedDiffBootstrap(dh, dv, dh, dv.map(() => 0), 10_000) : { diff: NaN, lo: NaN, hi: NaN };
      filtOut.push({ filter: 'F02b', params: { x, T }, age, exit: ex, n: dv.length, diff: d.diff, lo: d.lo, hi: d.hi });
    }
  }
}
out.naive = naiveOut; out.filters = filtOut;

// ============================================================ 3. descriptive
const cleanLife = (m: number, hours: number) => { const k0 = Math.floor(unixOf(tape, ctx.t0[m]) / 60) - ctx.minute0; for (let k = k0; k <= k0 + hours * 60; k++) if (k < 0 || k >= ctx.downMinute.length || ctx.downMinute[k]) return false; return true; };
let nL = 0, c1h = 0, cAny = 0; const byBucket: Record<string, [number, number]> = {};
for (let m = 0; m < ctx.nM; m++) {
  if (!ctx.universe[m] || !cleanLife(m, 1)) continue;
  nL++; const ct = ctx.completeTick[m];
  const done1h = Number.isFinite(ct) && (ct - ctx.t0[m]) * tape.tickSec <= 3600; if (done1h) c1h++; if (Number.isFinite(ct)) cAny++;
  const cb = tape.meta[m].t0Exact ? tape.meta[m].creatorBuyLamports / 1e9 : -1;
  const b = cb < 0 ? 'none/unknown' : cb < 0.05 ? '<0.05' : cb < 0.2 ? '0.05-0.2' : cb < 5 ? '0.2-5' : '>=5';
  const e = (byBucket[b] ??= [0, 0]); e[0]++; if (done1h) e[1]++;
}
const FEES = { raw: 0, pump: 0.0125, retail: 0.0225 };
const acc: Record<string, Record<string, { inS: number; outS: number; n: number; win: number }>> = {};
const add = (g: string, fk: string, i: number, o: number) => { acc[g] ??= {}; const a = (acc[g][fk] ??= { inS: 0, outS: 0, n: 0, win: 0 }); a.inS += i; a.outS += o; a.n++; if (o > i) a.win++; };
const mayhemId = ctx.mayhemId; let posMints = 0;
for (let m = 0; m < ctx.nM; m++) {
  if (!ctx.universe[m] || !cleanLife(m, 2)) continue;
  posMints++;
  const lo = tape.off[m], hi = tape.off[m + 1]; if (hi <= lo) continue;
  const pos = new Map<number, { b: number; s: number; tb: number; ts: number; first: number }>();
  for (let i = lo; i < hi; i++) { const w = tape.trader[i]; if (w === mayhemId) continue; let p = pos.get(w); if (!p) { p = { b: 0, s: 0, tb: 0, ts: 0, first: tape.tick[i] }; pos.set(w, p); } if (tape.isBuy[i]) { p.b += tape.sol[i]; p.tb += tape.tok[i]; } else { p.s += tape.sol[i]; p.ts += tape.tok[i]; } }
  const mm = tape.meta[m]; const complete = mm.completeIdx >= 0;
  let H = 0; for (const p of pos.values()) H += Math.max(0, p.tb - p.ts);
  const endS = complete ? tape.vSol[mm.completeIdx] : tape.vSol[hi - 1];
  const Q = endS - INIT_VSOL_F - (complete ? 15_000_001 : 0), B = 206_900_000e6;
  const perTok = H > 0 ? (complete ? (Q * H) / (B + H) : Q) / H : 0;
  const creatorTi = ctx.creatorId[m];
  for (const [w, p] of pos) {
    if (p.b <= 0) continue;
    const isC = w === creatorTi; const mark = Math.max(0, p.tb - p.ts) * perTok;
    const ageS = (p.first - ctx.t0[m]) * tape.tickSec;
    const g = isC ? 'creator' : p.first === ctx.t0[m] ? 'first_slot' : ageS < 1 ? 'first_1s' : ageS <= 2 ? 'within_2s' : ageS <= 10 ? 'early_2_10s' : 'other';
    for (const [fk, f] of Object.entries(FEES)) { const i = p.b * (1 + f), o = (p.s + mark) * (1 - f); add(g, fk, i, o); if (!isC) add('all_noncreator', fk, i, o); if (!isC && ageS <= 1.0) add('same_second_like_tape', fk, i, o); }
  }
}
const posOut: Record<string, Record<string, unknown>> = {};
for (const [g, byF] of Object.entries(acc)) { posOut[g] = {}; for (const [fk, a] of Object.entries(byF)) posOut[g][fk] = { n: a.n, solWeighted: a.outS / a.inS - 1, pctProfitable: a.win / a.n, solInSOL: a.inS / 1e9 }; }
out.descriptive = { launchesClean1h: nL, completedWithin1h: c1h, rateWithin1h: c1h / nL, completedByDataEnd: cAny, byCreatorBuyBucket: Object.fromEntries(Object.entries(byBucket).map(([k, [n, c]]) => [k, { n, completedWithin1h: c, rate: c / n }])), positionSampleMints: posMints, positions: posOut };
out.codeHash = hash;
fs.writeFileSync('research/memecoins/results/raw/collected-2d.json', JSON.stringify(out, null, 1));
appendLedger(ledger, hash);
log('done');
void dayOf;
