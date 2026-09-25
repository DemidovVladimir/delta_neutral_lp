/**
 * Derived, point-in-time objects of HYPOTHESES §2 built from a canonical tape.
 *
 *   C(m)   creator group            = {creator} (tape limits: no same-tx co-buyers, no E-fund)
 *   B(m)   bundle set               = non-creator buyers in the creation tick
 *   S(m)   sniper set               = non-creator wallets whose first buy is within 1.6 s of creation
 *   Bot(d) from day d-1             = >=300 trades across >=100 mints, or median hold < 3 s over >=20 round trips, + mayhem agent
 *   R(d)   rings from days d-7..d-1 = first-20-buyer pair co-occurrence >=3 launches, Jaccard >=0.5, components of size 2..12
 *   W*(d)  smart wallets, d-7..d-1  = >=20 closed mints, mean > 0, t > 2, median hold >= 10 s; minus Bot, rings, creators
 * Day objects for day d use only data from days < d.
 */
import { CURVE_FEE, feeTotalBps } from './curve.ts';
import { type Tape, dayOf, unixOf } from './tape.ts';
import { MAYHEM_AGENT } from './adapters/vdw.ts';

export interface CtxOpts { g1Mode: 'strict' | 'fromStart' | 'all'; warmupDays: number; g5Mode?: 'guard' | 'drop' }

export interface Ctx {
  tape: Tape;
  tickSec: number;
  nM: number;
  creatorId: Int32Array;
  t0: Float64Array;
  mintDay: Int32Array;
  universe: Uint8Array;       // tradeable mint
  usable: Uint8Array;         // usable for trailing objects (non-mayhem, has trades)
  firstDay: number; lastDay: number; analysisFirstDay: number;
  mayhemId: number;
  bot: Map<number, Set<number>>;
  ring: Map<number, Map<number, number>>;
  wstar: Map<number, Set<number>>;
  bundleOf: (m: number) => Set<number>;
  sniperOf: (m: number) => Set<number>;
  isExcluded: (m: number, day: number, w: number, bundle: Set<number>, snipers: Set<number>) => boolean;
  creatorLaunches: Map<number, number[]>; // creatorId -> mint indices sorted by t0
  completeTick: Float64Array;              // tick of curve completion, NaN if none
  secToTicks: (s: number) => number;
  /** G5: minute index (unix/60) -> 1 if the tape has zero trades in that minute (collector down) */
  downMinute: Uint8Array; minute0: number;
  droppedDays: number[];
  /** entry allowed: analysis day, day not dropped (G5), and no downtime from tSig to tSig + 65 min */
  signalOk: (tSig: number) => boolean;
}

export function buildCtx(tape: Tape, opts: CtxOpts, log = console.log): Ctx {
  const t0c = Date.now();
  const nM = tape.meta.length;
  const traderIdx = new Map<string, number>();
  tape.traders.forEach((w, i) => traderIdx.set(w, i));
  const mayhemId = traderIdx.get(MAYHEM_AGENT) ?? -2;
  const creatorId = new Int32Array(nM), t0 = new Float64Array(nM), mintDay = new Int32Array(nM);
  const universe = new Uint8Array(nM), usable = new Uint8Array(nM), completeTick = new Float64Array(nM);
  let firstDay = Infinity, lastDay = -Infinity;
  for (let m = 0; m < nM; m++) {
    const mm = tape.meta[m];
    creatorId[m] = traderIdx.get(mm.creator) ?? -1;
    t0[m] = mm.t0;
    mintDay[m] = dayOf(tape, mm.t0);
    const has = tape.off[m + 1] > tape.off[m];
    usable[m] = has && !mm.mayhem ? 1 : 0;
    const g1 = opts.g1Mode === 'strict' ? mm.g1Strict : opts.g1Mode === 'fromStart' ? mm.chainFromStart : true;
    universe[m] = usable[m] && g1 ? 1 : 0;
    completeTick[m] = mm.completeIdx >= 0 ? tape.tick[mm.completeIdx] : NaN;
    if (has) { firstDay = Math.min(firstDay, mintDay[m]); lastDay = Math.max(lastDay, dayOf(tape, tape.tick[tape.off[m + 1] - 1])); }
  }
  // U5: the first `warmupDays` COLLECTED days (days with launches) are warm-up only; the tape has multi-week holes
  const collected = [...new Set(Array.from(mintDay).filter((_, m) => usable[m]))].sort((a, b) => a - b);
  const analysisFirstDay = collected[Math.min(opts.warmupDays, collected.length - 1)];
  const secToTicks = (s: number) => s / tape.tickSec;
  // ---- G5 downtime: minutes with zero trades over the tape span
  const unixAt = (tick: number) => unixOf(tape, tick);
  let tMin = Infinity, tMax = -Infinity;
  for (let i = 0; i < tape.tick.length; i++) { const t = tape.tick[i]; if (t < tMin) tMin = t; if (t > tMax) tMax = t; }
  const minute0 = Math.floor(unixAt(tMin) / 60);
  const nMin = Math.floor(unixAt(tMax) / 60) - minute0 + 1;
  const perMin = new Int32Array(nMin);
  for (let i = 0; i < tape.tick.length; i++) perMin[Math.floor(unixAt(tape.tick[i]) / 60) - minute0]++;
  const downMinute = new Uint8Array(nMin); for (let k = 0; k < nMin; k++) downMinute[k] = perMin[k] === 0 ? 1 : 0;
  const downPerDay = new Map<number, number>();
  for (let k = 0; k < nMin; k++) if (downMinute[k]) { const d = Math.floor(((minute0 + k) * 60) / 86_400); downPerDay.set(d, (downPerDay.get(d) ?? 0) + 1); }
  const dayMinutesCovered = (d: number) => { let c = 0; for (let k = 0; k < 1440; k++) { const idx = d * 1440 + k - minute0; if (idx >= 0 && idx < nMin) c++; } return c; };
  const droppedDays: number[] = [];
  for (const d of new Set(Array.from(mintDay).filter((_, m) => usable[m]))) {
    // uncovered minutes at the tape's edges count as downtime too
    const down = (downPerDay.get(d) ?? 0) + (1440 - dayMinutesCovered(d));
    if (opts.g5Mode === 'drop' && down > 0.01 * 1440) droppedDays.push(d);
  }
  droppedDays.sort((a, b) => a - b);
  const dropped = new Set(droppedDays);
  const holdGuardMin = 65;
  const sniperTicks = Math.ceil(1.6 / tape.tickSec - 1e-9);

  const bundleOf = (m: number) => {
    const s = new Set<number>();
    for (let i = tape.off[m]; i < tape.off[m + 1] && tape.tick[i] <= t0[m]; i++) if (tape.isBuy[i] && tape.trader[i] !== creatorId[m]) s.add(tape.trader[i]);
    return s;
  };
  const sniperOf = (m: number) => {
    const s = new Set<number>();
    for (let i = tape.off[m]; i < tape.off[m + 1] && tape.tick[i] <= t0[m] + sniperTicks; i++) if (tape.isBuy[i] && tape.trader[i] !== creatorId[m]) s.add(tape.trader[i]);
    return s;
  };

  // ------------------------------------------------ Bot(d) from day d-1
  const nDays = lastDay - firstDay + 1;
  const cntTr = new Map<number, number>(); // key wallet*128+dayOff -> trades
  const cntMint = new Map<number, number>(); // distinct mints
  const lastMint = new Map<number, number>();
  const holds = new Map<number, number[]>(); // key wallet*128+dayOff -> hold seconds of closed round trips
  // memory guard: Bot needs >=300 trades or >=20 round trips, W* needs >=20 closed mints -> both need >=40 trades
  const totTr = new Int32Array(tape.traders.length);
  for (let i = 0; i < tape.trader.length; i++) totTr[tape.trader[i]]++;
  const cand = (w: number) => totTr[w] >= 40;
  for (let m = 0; m < nM; m++) {
    if (!usable[m]) continue;
    const bal = new Map<number, { b: number; max: number; open: number }>();
    for (let i = tape.off[m]; i < tape.off[m + 1]; i++) {
      const w = tape.trader[i];
      if (!cand(w)) continue;
      const dOff = dayOf(tape, tape.tick[i]) - firstDay;
      const k = w * 128 + dOff;
      cntTr.set(k, (cntTr.get(k) ?? 0) + 1);
      if (lastMint.get(k) !== m) { lastMint.set(k, m); cntMint.set(k, (cntMint.get(k) ?? 0) + 1); }
      let e = bal.get(w);
      if (tape.isBuy[i]) {
        if (!e || e.b <= 0) { e = { b: 0, max: 0, open: tape.tick[i] }; bal.set(w, e); }
        e.b += tape.tok[i]; if (e.b > e.max) e.max = e.b;
      } else if (e && e.b > 0) {
        e.b -= tape.tok[i];
        if (e.b <= 0.01 * e.max) {
          const arr = holds.get(k) ?? []; arr.push((tape.tick[i] - e.open) * tape.tickSec); holds.set(k, arr);
          e.b = 0;
        }
      }
    }
  }
  const bot = new Map<number, Set<number>>();
  for (let dOff = 0; dOff < nDays; dOff++) bot.set(firstDay + dOff + 1, new Set(mayhemId >= 0 ? [mayhemId] : []));
  for (const [k, n] of cntTr) {
    const w = Math.floor(k / 128), dOff = k % 128;
    if (n >= 300 && (cntMint.get(k) ?? 0) >= 100) bot.get(firstDay + dOff + 1)!.add(w);
  }
  for (const [k, arr] of holds) {
    if (arr.length < 20) continue;
    arr.sort((a, b) => a - b);
    const med = arr[Math.floor((arr.length - 1) / 2)] * 0.5 + arr[Math.ceil((arr.length - 1) / 2)] * 0.5;
    if (med < 3) bot.get(firstDay + (k % 128) + 1)!.add(Math.floor(k / 128));
  }
  log(`  Bot sets built (${((Date.now() - t0c) / 1000).toFixed(0)} s): ${[...bot.values()].map((s) => s.size).join(',')}`);

  // ------------------------------------------------ first-20 buyers per launch -> rings R(d)
  const first20 = new Map<number, Int32Array>();
  for (let m = 0; m < nM; m++) {
    if (!usable[m]) continue;
    const seen: number[] = []; const set = new Set<number>();
    for (let i = tape.off[m]; i < tape.off[m + 1] && seen.length < 20; i++) {
      const w = tape.trader[i];
      if (!tape.isBuy[i] || w === creatorId[m] || w === mayhemId || set.has(w)) continue;
      set.add(w); seen.push(w);
    }
    first20.set(m, Int32Array.from(seen));
  }
  const launchesByDay = new Map<number, number[]>();
  for (let m = 0; m < nM; m++) if (usable[m]) { const a = launchesByDay.get(mintDay[m]) ?? []; a.push(m); launchesByDay.set(mintDay[m], a); }
  const ring = new Map<number, Map<number, number>>();
  const TR = tape.traders.length;
  for (let d = firstDay + 1; d <= lastDay + 1; d++) {
    const ls: number[] = [];
    for (let dd = d - 7; dd < d; dd++) for (const m of launchesByDay.get(dd) ?? []) ls.push(m);
    const nA = new Map<number, number>();
    for (const m of ls) for (const w of first20.get(m)!) nA.set(w, (nA.get(w) ?? 0) + 1);
    const pair = new Map<number, number>();
    for (const m of ls) {
      const f = Array.from(first20.get(m)!).filter((w) => (nA.get(w) ?? 0) >= 3).sort((a, b) => a - b);
      for (let x = 0; x < f.length; x++) for (let y = x + 1; y < f.length; y++) { const key = f[x] * TR + f[y]; pair.set(key, (pair.get(key) ?? 0) + 1); }
    }
    const parent = new Map<number, number>();
    const find = (a: number): number => { let r = a; while (parent.get(r)! !== r) r = parent.get(r)!; let c = a; while (parent.get(c)! !== r) { const nx = parent.get(c)!; parent.set(c, r); c = nx; } return r; };
    for (const [key, co] of pair) {
      if (co < 3) continue;
      const a = Math.floor(key / TR), b = key % TR;
      const jac = co / (nA.get(a)! + nA.get(b)! - co);
      if (jac < 0.5) continue;
      if (!parent.has(a)) parent.set(a, a); if (!parent.has(b)) parent.set(b, b);
      const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb);
    }
    const comp = new Map<number, number[]>();
    for (const w of parent.keys()) { const r = find(w); const c = comp.get(r) ?? []; c.push(w); comp.set(r, c); }
    const mp = new Map<number, number>();
    for (const [r, ws] of comp) if (ws.length >= 2 && ws.length <= 12) for (const w of ws) mp.set(w, r);
    ring.set(d, mp);
  }
  log(`  ring sets built (${((Date.now() - t0c) / 1000).toFixed(0)} s): members/day ${[...ring.values()].map((s) => s.size).join(',')}`);

  // ------------------------------------------------ W*(d): per (wallet, mint) closed positions
  const fee = feeTotalBps(CURVE_FEE) / 10_000;
  const closed = new Map<number, { ret: number[]; hold: number[]; creator: boolean }>(); // key wallet*128+dayOff(close)
  const creatorOfTraded = new Set<number>(); // wallets that created a coin they traded (any time before) -> approximated per window below
  for (let m = 0; m < nM; m++) {
    if (!usable[m]) continue;
    const pos = new Map<number, { bSol: number; sSol: number; bTok: number; sTok: number; first: number; done: boolean }>();
    for (let i = tape.off[m]; i < tape.off[m + 1]; i++) {
      const w = tape.trader[i];
      if (w === mayhemId) continue;
      if (w === creatorId[m]) { creatorOfTraded.add(w); continue; }
      if (!cand(w)) continue;
      let p = pos.get(w);
      if (tape.isBuy[i]) {
        if (!p) { p = { bSol: 0, sSol: 0, bTok: 0, sTok: 0, first: tape.tick[i], done: false }; pos.set(w, p); }
        if (p.done) continue;
        p.bSol += tape.sol[i] * (1 + fee); p.bTok += tape.tok[i];
      } else if (p && !p.done) {
        p.sSol += tape.sol[i] * (1 - fee); p.sTok += tape.tok[i];
        if (p.sTok >= 0.99 * p.bTok) {
          p.done = true;
          const k = w * 128 + (dayOf(tape, tape.tick[i]) - firstDay);
          const e = closed.get(k) ?? { ret: [], hold: [], creator: false };
          e.ret.push(p.sSol / p.bSol - 1); e.hold.push((tape.tick[i] - p.first) * tape.tickSec);
          closed.set(k, e);
        }
      }
    }
  }
  const byWallet = new Map<number, number[]>(); // wallet -> dayOffs with closes
  for (const k of closed.keys()) { const w = Math.floor(k / 128); const a = byWallet.get(w) ?? []; a.push(k % 128); byWallet.set(w, a); }
  const wstar = new Map<number, Set<number>>();
  for (let d = firstDay + 1; d <= lastDay + 1; d++) wstar.set(d, new Set());
  for (const [w, dOffs] of byWallet) {
    if (creatorOfTraded.has(w)) continue; // was C(m) for a coin it traded
    const uniq = [...new Set(dOffs)];
    if (uniq.reduce((a, dOff) => a + closed.get(w * 128 + dOff)!.ret.length, 0) < 20) continue; // can never reach 20 closed mints
    for (let d = firstDay + 1; d <= lastDay + 1; d++) {
      const rets: number[] = [], hs: number[] = [];
      for (const dOff of uniq) { const dd = firstDay + dOff; if (dd >= d - 7 && dd < d) { const e = closed.get(w * 128 + dOff)!; rets.push(...e.ret); hs.push(...e.hold); } }
      if (rets.length < 20) continue;
      const n = rets.length, mean = rets.reduce((a, b) => a + b, 0) / n;
      if (mean <= 0) continue;
      const sd = Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1));
      if (!(mean / (sd / Math.sqrt(n)) > 2)) continue;
      hs.sort((a, b) => a - b);
      if (hs[Math.floor(hs.length / 2)] < 10) continue;
      if (bot.get(d)?.has(w) || ring.get(d)?.has(w)) continue;
      wstar.get(d)!.add(w);
    }
  }
  log(`  W* sets built (${((Date.now() - t0c) / 1000).toFixed(0)} s): sizes/day ${[...wstar.values()].map((s) => s.size).join(',')}`);

  const creatorLaunches = new Map<number, number[]>();
  for (let m = 0; m < nM; m++) if (usable[m] && creatorId[m] >= 0) { const a = creatorLaunches.get(creatorId[m]) ?? []; a.push(m); creatorLaunches.set(creatorId[m], a); }
  for (const a of creatorLaunches.values()) a.sort((x, y) => t0[x] - t0[y]);

  const signalOk = (tSig: number) => {
    const u = unixAt(tSig); const d = Math.floor(u / 86_400);
    if (d < analysisFirstDay || dropped.has(d)) return false;
    const k0 = Math.floor(u / 60) - minute0;
    for (let k = k0; k <= k0 + holdGuardMin; k++) if (k < 0 || k >= nMin || downMinute[k]) return false;
    return true;
  };
  const isExcluded = (m: number, day: number, w: number, bundle: Set<number>, snipers: Set<number>) =>
    w === creatorId[m] || w === mayhemId || bundle.has(w) || snipers.has(w) || !!bot.get(day)?.has(w) || !!ring.get(day)?.has(w);

  return {
    tape, tickSec: tape.tickSec, nM, creatorId, t0, mintDay, universe, usable, firstDay, lastDay, analysisFirstDay, mayhemId,
    bot, ring, wstar, bundleOf, sniperOf, isExcluded, creatorLaunches, completeTick, secToTicks, downMinute, minute0, droppedDays, signalOk,
  };
}
