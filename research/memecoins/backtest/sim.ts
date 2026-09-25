/**
 * Execution simulator (PROTOCOL §3), generic over the tape clock.
 *
 * Time is continuous in ticks (x). A signal known at tick x_sig lands at x = x_sig + L/tickSec.
 *   pessimistic placement: we execute after every trade with tick <= ceil(x)
 *   optimistic placement:  we execute after the trades with tick <= floor(x - 1) (never before the signal trade)
 * On a slot clock (tickSec 0.4) this is exactly "after / before every trade in landing slot s_sig + Δ".
 * On a 1-s clock (public tape) it is the pessimistic / optimistic bound over the unknown sub-second position.
 *
 * Counterfactual (§3.2):
 *   replay   (primary): our buy is applied at landing, every later observed trade is replayed on the adjusted
 *            reserves (buys keep curve-SOL input, sells keep token amount); unobserved flow across a chain gap is
 *            replayed as one aggregate trade of the same kind.
 *   noinsert (conservative): buy and sell each priced on the observed state.
 * Fills use exact BigInt math (curve.ts); exit TRIGGERS are evaluated after every trade with the float path.
 */
import {
  CURVE_FEE, POOL_TIER0_FEE, INIT_VSOL, INIT_VSOL_F, INIT_VTOK_F, VTOK_COMPLETE, VTOK_COMPLETE_F, POOL_BASE_AT_MIGRATION,
  MIGRATION_FEE, RS_GRAD_F, buyTokensForSol, buyCostForTokens, sellProceeds, poolSell, fBuyTokensForCurveSol, fSellGross, fSellNet,
  type FeeBps,
} from './curve.ts';
import { type Tape, lastAtOrBefore, dayOf } from './tape.ts';

export const BASE_FEE = 5_000; // lamports per signature

export interface ExecCfg {
  L: number;                       // latency, seconds
  placement: 'pess' | 'opt';
  size: number;                    // lamports we are willing to spend per entry
  model: 'replay' | 'noinsert';
  budget: number;                  // priority + tip per landed tx, lamports (0.0001 SOL normal, 0.0005 racing)
  pFail: number;                   // landing failure probability per attempt
  fee: FeeBps;
  poolFee: FeeBps;
  fixedMult: number;               // sensitivity: fixed costs x3
}

export const defaultCfg = (over: Partial<ExecCfg> = {}): ExecCfg => ({
  L: 2, placement: 'pess', size: 100_000_000, model: 'replay', budget: 100_000, pFail: 0.10,
  fee: CURVE_FEE, poolFee: POOL_TIER0_FEE, fixedMult: 1, ...over,
});

export type Exit =
  | { id: string; kind: 'XT'; tau: number }
  | { id: string; kind: 'XB'; tp: number; sl: number; maxHold: number }
  | { id: string; kind: 'XR'; trail: number; maxHold: number }
  | { id: string; kind: 'XG'; prog: number; sl: number; maxHold: number };

export const EXITS: Record<string, Exit> = {
  XT60: { id: 'XT60', kind: 'XT', tau: 60 },
  XT300: { id: 'XT300', kind: 'XT', tau: 300 },
  XT1800: { id: 'XT1800', kind: 'XT', tau: 1800 },
  XB: { id: 'XB', kind: 'XB', tp: 0.5, sl: -0.3, maxHold: 1800 },
  XR: { id: 'XR', kind: 'XR', trail: 0.35, maxHold: 1800 },
  XG: { id: 'XG', kind: 'XG', prog: 0.95, sl: -0.3, maxHold: 3600 },
};
export const ALL_EXITS = ['XT60', 'XT300', 'XT1800', 'XB', 'XR', 'XG'];

export interface Signal {
  m: number;          // mint index
  tSig: number;       // tick at which the signal is known
  sigIdx: number;     // global index of the trade completing the signal (or last trade <= tSig; off[m]-1 = none yet)
  overrideIdx?: number; // F02(b): global trade index at which an exit override fires
}

export type FillStatus = 'ok' | 'abandoned' | 'slip' | 'complete-before-entry';
export interface Fill {
  status: FillStatus;
  ret: number;        // (exit value - basis) / basis ; NaN when no position
  pnl: number;        // lamports, incl. failed-attempt costs (also when no position)
  basis: number;      // lamports
  day: number;        // UTC day of the signal
  xEntry: number; xExit: number;
  reason: string;     // exit reason
  viaPool: boolean;   // exited into the migration pool (tape has no pool trades -> pool-open state)
}

/** Deterministic uniform [0,1) from three ints (common random numbers across variants). */
export function rng(a: number, b: number, c: number): number {
  let h = Math.imul(a ^ 0x9e3779b1, 0x85ebca77) ^ Math.imul(b ^ 0xc2b2ae3d, 0x27d4eb2f) ^ Math.imul(c + 0x165667b1, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b); h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const big = (x: number) => BigInt(Math.round(x));

export function simulate(tape: Tape, sig: Signal, exit: Exit, cfg: ExecCfg): Fill {
  const { tick, vSol, vTok, sol, tok, isBuy, gap } = tape;
  const m = sig.m, lo = tape.off[m], hi = tape.off[m + 1];
  const dl = cfg.L / tape.tickSec;
  const landedCost = (BASE_FEE + cfg.budget) * cfg.fixedMult;
  const failedCost = (BASE_FEE + 0.5 * cfg.budget) * cfg.fixedMult;
  const day = dayOf(tape, sig.tSig);
  const sOf = (i: number) => (i < lo ? INIT_VSOL_F : vSol[i]);
  const tOf = (i: number) => (i < lo ? INIT_VTOK_F : vTok[i]);
  const landIdx = (x: number, ref: number) =>
    cfg.placement === 'pess'
      ? Math.max(ref, lastAtOrBefore(tick, lo, hi, Math.ceil(x - 1e-9)))
      : Math.max(ref, lastAtOrBefore(tick, lo, hi, Math.floor(x - 1 + 1e-9)));
  const obsComplete = tape.meta[m].completeIdx;
  const none = (status: FillStatus, pnl: number): Fill => ({ status, ret: NaN, pnl, basis: 0, day, xEntry: NaN, xExit: NaN, reason: status, viaPool: false });

  // ---------------- entry
  const sigI = sig.sigIdx;
  if (obsComplete >= 0 && sigI >= obsComplete) return none('complete-before-entry', 0);
  const qS = sOf(sigI), qT = tOf(sigI);
  const tq0 = buyTokensForSol(BigInt(cfg.size), big(qS), big(qT), big(qT - VTOK_COMPLETE_F));
  if (tq0 <= 0n) return none('complete-before-entry', 0);
  const quoted = buyCostForTokens(tq0, big(qS), big(qT), cfg.fee).total;
  let costs = 0;
  let x = sig.tSig;
  let j = -2;
  for (let a = 0; a < 2; a++) {
    x += dl;
    if (rng(m, sig.tSig, a) < cfg.pFail) { costs += failedCost; continue; }
    j = landIdx(x, sigI);
    break;
  }
  if (j === -2) return none('abandoned', -costs);
  if (obsComplete >= 0 && j >= obsComplete) return none('complete-before-entry', -(costs + failedCost));
  const lS = sOf(j), lT = tOf(j);
  const realLeft = big(lT) - VTOK_COMPLETE;
  const tq = tq0 < realLeft ? tq0 : realLeft;
  if (tq <= 0n) return none('complete-before-entry', -(costs + failedCost));
  const cost = buyCostForTokens(tq, big(lS), big(lT), cfg.fee);
  if (cost.total * 100n > quoted * 120n) return none('slip', -(costs + failedCost));
  costs += landedCost;
  const q = tq, qf = Number(tq);
  const basis = Number(cost.total) + costs; // failed attempts before entry are part of the cost basis
  const xEntry = x;
  let exitCosts = 0;

  // ---------------- state walker
  const replay = cfg.model === 'replay';
  let aS = replay ? lS + Number(cost.curve) : lS;
  let aT = replay ? lT - qf : lT;
  let cur = j;              // last observed trade applied
  let complete = false, completeX = NaN, completeS = NaN;
  const advanceTo = (idx: number) => {
    while (cur < idx && !complete) {
      const c = ++cur;
      if (!replay) {
        aS = vSol[c]; aT = vTok[c];
        if (obsComplete >= 0 && c >= obsComplete) { complete = true; completeX = tick[c]; completeS = vSol[c]; }
        continue;
      }
      const g = gap[c];
      if (g !== 0) {
        // unobserved net flow between c-1 and c, replayed as one aggregate trade
        const preObsS = isBuy[c] ? vSol[c] - sol[c] : vSol[c] + sol[c];
        if (g > 0) {
          const t = fBuyTokensForCurveSol(g + 1, aS, aT);
          const t2 = Math.min(t, aT - VTOK_COMPLETE_F);
          aS += t2 < t ? Math.floor((t2 * aS) / (aT - t2)) + 1 : g; aT -= t2;
        } else {
          const prevT = tOf(c - 1);
          const preObsT = (sOf(c - 1) * prevT) / preObsS; // K-carried
          const dT = Math.max(0, preObsT - prevT);
          const gross = fSellGross(dT, aS, aT); aS -= gross; aT += dT;
        }
        if (aT <= VTOK_COMPLETE_F + 1) { complete = true; completeX = tick[c]; completeS = aS; break; }
      }
      if (isBuy[c]) {
        const t = fBuyTokensForCurveSol(sol[c], aS, aT);
        const room = aT - VTOK_COMPLETE_F;
        if (t >= room) {
          const cin = Math.floor((room * aS) / (aT - room)) + 1;
          aS += cin; aT -= room; complete = true; completeX = tick[c]; completeS = aS;
        } else { aS += sol[c]; aT -= t; }
      } else {
        const gross = fSellGross(tok[c], aS, aT); aS -= gross; aT += tok[c];
      }
      if (obsComplete >= 0 && c >= obsComplete && !complete) { complete = true; completeX = tick[c]; completeS = aS; }
    }
  };
  const nlvF = () => fSellNet(qf, aS, aT, cfg.fee) - landedCost;

  // ---------------- exit trigger
  const holdTicks = (exit.kind === 'XT' ? exit.tau : exit.maxHold) / tape.tickSec;
  const xDead = xEntry + holdTicks;
  let peak = nlvF();
  let xTrig = NaN, trigIdx = -1, reason = '';
  for (let k = j + 1; k < hi; k++) {
    if (tick[k] > xDead) break;
    advanceTo(k);
    if (complete) break;
    if (sig.overrideIdx !== undefined && k === sig.overrideIdx) { xTrig = tick[k]; trigIdx = k; reason = 'override'; break; }
    if (exit.kind === 'XT') continue;
    const v = nlvF();
    const r = (v - basis) / basis;
    if (exit.kind === 'XB') {
      if (r >= exit.tp) { xTrig = tick[k]; trigIdx = k; reason = 'tp'; break; }
      if (r <= exit.sl) { xTrig = tick[k]; trigIdx = k; reason = 'sl'; break; }
    } else if (exit.kind === 'XR') {
      if (v > peak) peak = v;
      if (v <= peak * (1 - exit.trail)) { xTrig = tick[k]; trigIdx = k; reason = 'trail'; break; }
    } else if (exit.kind === 'XG') {
      if ((aS - INIT_VSOL_F) / RS_GRAD_F >= exit.prog) { xTrig = tick[k]; trigIdx = k; reason = 'prog'; break; }
      if (r <= exit.sl) { xTrig = tick[k]; trigIdx = k; reason = 'sl'; break; }
    }
  }
  if (!complete && trigIdx < 0) { xTrig = xDead; trigIdx = Math.max(cur, lastAtOrBefore(tick, lo, hi, Math.floor(xDead))); advanceTo(trigIdx); reason = 'time'; }

  // ---------------- exit execution
  const poolExit = (): Fill => {
    // pool-opening state at completion + L (resolution D6): quote = real SOL at completion - migration fee
    let xx = completeX;
    for (let a = 0; a < 50; a++) { xx += dl; if (rng(m, sig.tSig, 200 + a) < cfg.pFail) { exitCosts += failedCost; continue; } break; }
    const Q = big(completeS) - INIT_VSOL - MIGRATION_FEE;
    const r = poolSell(q, Q, POOL_BASE_AT_MIGRATION, Q, cfg.poolFee);
    const proceeds = Number(r.net) - landedCost - exitCosts;
    const value = Number(r.net) - landedCost > 0 ? proceeds : -exitCosts; // unsellable -> burn & close
    return { status: 'ok', ret: (value - basis) / basis, pnl: value - basis, basis, day, xEntry, xExit: xx, reason: reason ? `${reason}+pool` : 'complete', viaPool: true };
  };
  if (complete) return poolExit();

  // negative NLV: not sold, -100 %, rent recovered
  const quoteNet = fSellNet(qf, aS, aT, cfg.fee);
  if (quoteNet - landedCost <= 0) return { status: 'ok', ret: -1, pnl: -basis, basis, day, xEntry, xExit: xTrig, reason: `${reason}:dead`, viaPool: false };
  let minOut = 0.7 * quoteNet;
  let xs = xTrig;
  for (let a = 0; a < 400; a++) {
    xs += dl;
    if (rng(m, sig.tSig, 100 + a) < cfg.pFail) { exitCosts += failedCost; continue; }
    const li = landIdx(xs, cur);
    advanceTo(li);
    if (complete) return poolExit();
    const outF = Number(sellProceeds(q, big(aS), big(aT), cfg.fee).net);
    if (outF < minOut) { exitCosts += failedCost; minOut = 0.7 * outF; continue; }
    if (outF - landedCost <= 0) return { status: 'ok', ret: (-exitCosts - basis) / basis, pnl: -exitCosts - basis, basis, day, xEntry, xExit: xs, reason: `${reason}:dead`, viaPool: false };
    const value = outF - landedCost - exitCosts;
    return { status: 'ok', ret: (value - basis) / basis, pnl: value - basis, basis, day, xEntry, xExit: xs, reason, viaPool: false };
  }
  // could not fill in 400 attempts (pathological): mark at the last state
  const value = fSellNet(qf, aS, aT, cfg.fee) - landedCost - exitCosts;
  return { status: 'ok', ret: (value - basis) / basis, pnl: value - basis, basis, day, xEntry, xExit: xs, reason: `${reason}:unfilled`, viaPool: false };
}

/** Initial-state accessor for signal code. */
export const stateAfter = (tape: Tape, m: number, i: number): [number, number] =>
  i < tape.off[m] ? [INIT_VSOL_F, INIT_VTOK_F] : [tape.vSol[i], tape.vTok[i]];
export const progressAfter = (tape: Tape, m: number, i: number) => (stateAfter(tape, m, i)[0] - INIT_VSOL_F) / RS_GRAD_F;
export { VTOK_COMPLETE };
