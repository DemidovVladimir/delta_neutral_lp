/**
 * Signal generators for HYPOTHESES.md §5 (entries) and §6 (filters), on a canonical tape.
 * Every generator is point-in-time: it reads only trades with tick <= the signal tick.
 * Grids are exactly the frozen ones; this file adds no grid points.
 */
import { INIT_VSOL_F, RS_GRAD_F, TOTAL_SUPPLY_F } from './curve.ts';
import { lastAtOrBefore } from './tape.ts';
import type { Ctx } from './context.ts';
import type { Signal } from './sim.ts';

const SOL = 1e9;
export interface SigOut { signals: Signal[]; note?: string }

/** Organic flag per trade (trader outside X(m) = C ∪ B ∪ S ∪ R(d) ∪ Bot(d)); d = creation day of the mint. */
export function organicFlags(ctx: Ctx): Uint8Array {
  const { tape } = ctx;
  const org = new Uint8Array(tape.tick.length);
  for (let m = 0; m < ctx.nM; m++) {
    if (!ctx.universe[m]) continue;
    const b = ctx.bundleOf(m), s = ctx.sniperOf(m), d = ctx.mintDay[m];
    for (let i = tape.off[m]; i < tape.off[m + 1]; i++) org[i] = ctx.isExcluded(m, d, tape.trader[i], b, s) ? 0 : 1;
  }
  return org;
}

const inAnalysis = (ctx: Ctx, tSig: number) => ctx.signalOk(tSig); // analysis day, not dropped (G5), no downtime during the hold
const completedBy = (ctx: Ctx, m: number, idx: number) => ctx.tape.meta[m].completeIdx >= 0 && idx >= ctx.tape.meta[m].completeIdx;
const progressOf = (vSol: number) => (vSol - INIT_VSOL_F) / RS_GRAD_F;
const vSolAt = (ctx: Ctx, m: number, i: number) => (i < ctx.tape.off[m] ? INIT_VSOL_F : ctx.tape.vSol[i]);

function timeSignal(ctx: Ctx, m: number, ageSec: number): Signal | null {
  const tSig = ctx.t0[m] + ctx.secToTicks(ageSec);
  const lo = ctx.tape.off[m], hi = ctx.tape.off[m + 1];
  const sigIdx = lastAtOrBefore(ctx.tape.tick, lo, hi, Math.floor(tSig));
  if (completedBy(ctx, m, sigIdx) || !inAnalysis(ctx, tSig)) return null;
  return { m, tSig, sigIdx };
}

// ---------------------------------------------------------------- H01 velocity
export function H01(ctx: Ctx, org: Uint8Array, p: { V: number; N: number; T: number }): SigOut {
  const { tape } = ctx; const out: Signal[] = [];
  for (let m = 0; m < ctx.nM; m++) {
    if (!ctx.universe[m]) continue;
    const lo = tape.off[m], hi = tape.off[m + 1];
    let orgNet = 0;
    for (let i = lo; i < hi; i++) {
      if (i - lo + 1 > p.N) break;
      if ((tape.tick[i] - ctx.t0[m]) * ctx.tickSec > p.T) break;
      if (completedBy(ctx, m, i)) break;
      if (org[i]) orgNet += tape.isBuy[i] ? tape.sol[i] : -tape.sol[i];
      const rs = tape.vSol[i] - INIT_VSOL_F;
      if (rs >= p.V * SOL && orgNet >= 0.5 * rs) { if (inAnalysis(ctx, tape.tick[i])) out.push({ m, tSig: tape.tick[i], sigIdx: i }); break; }
    }
  }
  return { signals: out };
}

// ---------------------------------------------------------------- H02 organic breadth at age W
export function H02(ctx: Ctx, org: Uint8Array, p: { W: number; U: number }): SigOut {
  const { tape } = ctx; const out: Signal[] = [];
  for (let m = 0; m < ctx.nM; m++) {
    if (!ctx.universe[m]) continue;
    const s = timeSignal(ctx, m, p.W); if (!s) continue;
    const lo = tape.off[m];
    const buySol = new Map<number, number>(); let net = 0, tot = 0;
    for (let i = lo; i <= s.sigIdx; i++) {
      if (!org[i]) continue;
      if (tape.isBuy[i]) { buySol.set(tape.trader[i], (buySol.get(tape.trader[i]) ?? 0) + tape.sol[i]); tot += tape.sol[i]; net += tape.sol[i]; } else net -= tape.sol[i];
    }
    if (buySol.size < p.U || net <= 0 || tot <= 0) continue;
    let hhi = 0; for (const v of buySol.values()) hhi += (v / tot) ** 2;
    if (hhi <= 0.10) out.push(s);
  }
  return { signals: out };
}

// ---------------------------------------------------------------- H03 net organic buy pressure (rolling window)
export function H03(ctx: Ctx, org: Uint8Array, p: { D: number; F: number }): SigOut {
  const { tape } = ctx; const out: Signal[] = [];
  const w = ctx.secToTicks(p.D);
  for (let m = 0; m < ctx.nM; m++) {
    if (!ctx.universe[m]) continue;
    const lo = tape.off[m], hi = tape.off[m + 1];
    let a = lo, net = 0, nb = 0, ns = 0;
    for (let i = lo; i < hi; i++) {
      if (completedBy(ctx, m, i)) break;
      if (org[i]) { if (tape.isBuy[i]) { net += tape.sol[i]; nb++; } else { net -= tape.sol[i]; ns++; } }
      while (tape.tick[a] <= tape.tick[i] - w) { if (org[a]) { if (tape.isBuy[a]) { net -= tape.sol[a]; nb--; } else { net += tape.sol[a]; ns--; } } a++; }
      const age = (tape.tick[i] - ctx.t0[m]) * ctx.tickSec;
      if (age > 1800) break;
      if (age < 60) continue;
      if (net >= p.F * SOL && nb >= 2 * ns && nb > 0) { if (inAnalysis(ctx, tape.tick[i])) out.push({ m, tSig: tape.tick[i], sigIdx: i }); break; }
    }
  }
  return { signals: out };
}

// ---------------------------------------------------------------- H04 early-holder retention at age A
export function H04(ctx: Ctx, org: Uint8Array, p: { A: number; r: number }): SigOut {
  const { tape } = ctx; const out: Signal[] = [];
  for (let m = 0; m < ctx.nM; m++) {
    if (!ctx.universe[m]) continue;
    const s = timeSignal(ctx, m, p.A); if (!s) continue;
    const pr = progressOf(vSolAt(ctx, m, s.sigIdx));
    if (pr < 0.15 || pr > 0.70) continue;
    const first: number[] = []; const bought = new Map<number, number>(), sold = new Map<number, number>();
    for (let i = tape.off[m]; i <= s.sigIdx; i++) {
      const wlt = tape.trader[i];
      if (tape.isBuy[i]) {
        if (org[i] && !bought.has(wlt) && first.length < 20) first.push(wlt);
        bought.set(wlt, (bought.get(wlt) ?? 0) + tape.tok[i]);
      } else sold.set(wlt, (sold.get(wlt) ?? 0) + tape.tok[i]);
    }
    if (first.length < 20) continue;
    let hold = 0;
    for (const wlt of first) { const b = bought.get(wlt)!; if (b - (sold.get(wlt) ?? 0) >= 0.8 * b) hold++; }
    if (hold / 20 >= p.r) out.push(s);
  }
  return { signals: out };
}

// ---------------------------------------------------------------- H05 near-graduation run-up
export function H05(ctx: Ctx, _org: Uint8Array, p: { P: number; Tfast: number }): SigOut {
  const { tape } = ctx; const out: Signal[] = [];
  for (let m = 0; m < ctx.nM; m++) {
    if (!ctx.universe[m]) continue;
    let t50 = NaN;
    for (let i = tape.off[m]; i < tape.off[m + 1]; i++) {
      if (completedBy(ctx, m, i)) break;
      const pr = progressOf(tape.vSol[i]);
      if (Number.isNaN(t50) && pr >= 0.5) t50 = tape.tick[i];
      if (pr >= p.P) {
        if ((tape.tick[i] - t50) * ctx.tickSec <= p.Tfast && inAnalysis(ctx, tape.tick[i])) out.push({ m, tSig: tape.tick[i], sigIdx: i });
        break;
      }
    }
  }
  return { signals: out };
}

// ---------------------------------------------------------------- H06 smart-wallet consensus
export function H06(ctx: Ctx, _org: Uint8Array, p: { k: number; D: number }): SigOut {
  const { tape } = ctx; const out: Signal[] = [];
  const w = ctx.secToTicks(p.D);
  for (let m = 0; m < ctx.nM; m++) {
    if (!ctx.universe[m]) continue;
    const ws = ctx.wstar.get(ctx.mintDay[m]); if (!ws || !ws.size) continue;
    const seen = new Set<number>(); const buys: number[] = []; // trade indices of first buys by W*
    for (let i = tape.off[m]; i < tape.off[m + 1]; i++) {
      if (completedBy(ctx, m, i)) break;
      const wl = tape.trader[i];
      if (!tape.isBuy[i] || !ws.has(wl) || seen.has(wl)) continue;
      seen.add(wl); buys.push(i);
      if (buys.length >= p.k) {
        const first = buys[buys.length - p.k];
        if (tape.tick[i] - tape.tick[first] <= w) {
          if (progressOf(tape.vSol[i]) < 0.7 && inAnalysis(ctx, tape.tick[i])) out.push({ m, tSig: tape.tick[i], sigIdx: i });
          break;
        }
      }
    }
  }
  return { signals: out };
}

// ---------------------------------------------------------------- H08 creator track record (entry at s0 + L)
export function H08(ctx: Ctx, _org: Uint8Array, p: { nMin: number; g: number }): SigOut {
  const out: Signal[] = []; const day = 86_400 / ctx.tickSec, tenMin = 600 / ctx.tickSec;
  for (const list of ctx.creatorLaunches.values()) {
    for (let j = 0; j < list.length; j++) {
      const m = list[j]; if (!ctx.universe[m]) continue;
      const t = ctx.t0[m];
      const prior = list.slice(0, j).filter((x) => ctx.t0[x] >= t - 30 * day && ctx.t0[x] < t);
      if (prior.length < p.nMin) continue;
      const grads = prior.filter((x) => ctx.completeTick[x] < t).length;
      if (grads / prior.length < p.g) continue;
      const ts = [...prior.map((x) => ctx.t0[x]), t];
      const gaps = ts.slice(1).map((v, i) => v - ts[i]).sort((a, b) => a - b);
      const med = gaps.length % 2 ? gaps[(gaps.length - 1) / 2] : (gaps[gaps.length / 2 - 1] + gaps[gaps.length / 2]) / 2;
      if (med < tenMin) continue;
      const s = timeSignal(ctx, m, 0); if (s) out.push(s);
    }
  }
  return { signals: out };
}

// ---------------------------------------------------------------- H09 narrative originality (copycat wave)
export const normTicker = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/[0-9]+$/, '');
export function H09(ctx: Ctx, _org: Uint8Array, p: { c: number; D: number }): SigOut {
  const { tape } = ctx; const out: Signal[] = [];
  const byT = new Map<string, number[]>();
  for (let m = 0; m < ctx.nM; m++) { if (!ctx.usable[m]) continue; const k = normTicker(tape.meta[m].symbol); if (!k) continue; const a = byT.get(k) ?? []; a.push(m); byT.set(k, a); }
  const day = 86_400 / ctx.tickSec, Dt = ctx.secToTicks(p.D * 60);
  for (const list of byT.values()) {
    list.sort((a, b) => ctx.t0[a] - ctx.t0[b]);
    for (let j = 0; j < list.length; j++) {
      const m = list[j]; if (!ctx.universe[m]) continue;
      if (j > 0 && ctx.t0[list[j - 1]] >= ctx.t0[m] - day) continue; // not the earliest in trailing 24 h
      const copies = list.slice(j + 1).filter((x) => ctx.t0[x] > ctx.t0[m] && ctx.t0[x] <= ctx.t0[m] + Dt);
      if (copies.length < p.c) continue;
      const tSig = ctx.t0[copies[p.c - 1]];
      const sigIdx = lastAtOrBefore(tape.tick, tape.off[m], tape.off[m + 1], Math.floor(tSig));
      if (completedBy(ctx, m, sigIdx) || progressOf(vSolAt(ctx, m, sigIdx)) >= 0.9 || !inAnalysis(ctx, tSig)) continue;
      out.push({ m, tSig, sigIdx });
    }
  }
  return { signals: out };
}

// ---------------------------------------------------------------- H10 dip-buy / recovery
export function H10(ctx: Ctx, _org: Uint8Array, p: { Pk: number; D: number; mode: 'dip' | 'recovery' }): SigOut {
  const { tape } = ctx; const out: Signal[] = [];
  const win = ctx.secToTicks(600), rwin = ctx.secToTicks(1800);
  const pkPrice = (vs: number) => vs * vs; // spot price ∝ vSol^2 on a constant-product curve (monotone); ratios are what matter
  for (let m = 0; m < ctx.nM; m++) {
    if (!ctx.universe[m]) continue;
    const lo = tape.off[m], hi = tape.off[m + 1];
    const dq: number[] = []; // indices, decreasing price, within trailing 600 s
    let dipIdx = -1, peakP = 0;
    for (let i = lo; i < hi; i++) {
      if (completedBy(ctx, m, i)) break;
      const price = tape.vSol[i] / tape.vTok[i];
      while (dq.length && tape.tick[dq[0]] < tape.tick[i] - win) dq.shift();
      if (dq.length) {
        const top = dq[0]; const tp = tape.vSol[top] / tape.vTok[top];
        if (progressOf(tape.vSol[top]) >= p.Pk && price <= (1 - p.D) * tp) { dipIdx = i; peakP = tp; break; }
      }
      while (dq.length && tape.vSol[dq[dq.length - 1]] / tape.vTok[dq[dq.length - 1]] <= price) dq.pop();
      dq.push(i);
    }
    void pkPrice;
    if (dipIdx < 0) continue;
    if (p.mode === 'dip') { if (inAnalysis(ctx, tape.tick[dipIdx])) out.push({ m, tSig: tape.tick[dipIdx], sigIdx: dipIdx }); continue; }
    let trough = tape.vSol[dipIdx] / tape.vTok[dipIdx];
    for (let i = dipIdx + 1; i < hi; i++) {
      if (completedBy(ctx, m, i) || tape.tick[i] > tape.tick[dipIdx] + rwin) break;
      const price = tape.vSol[i] / tape.vTok[i];
      if (price < trough) trough = price;
      if (price >= trough + (peakP - trough) / 3) { if (inAnalysis(ctx, tape.tick[i])) out.push({ m, tSig: tape.tick[i], sigIdx: i }); break; }
    }
  }
  return { signals: out };
}

// ---------------------------------------------------------------- H07 KOL buy (CONTROL ONLY on public tapes)
/** kols: trader indices of KOL wallets. NOT point-in-time on the public tape (list is a 2026-09-25 snapshot). */
export function H07(ctx: Ctx, _org: Uint8Array, p: { S: number; kols: Set<number>; mirror?: boolean }): SigOut {
  const { tape } = ctx; const out: Signal[] = [];
  for (let m = 0; m < ctx.nM; m++) {
    if (!ctx.universe[m]) continue;
    for (let i = tape.off[m]; i < tape.off[m + 1]; i++) {
      if (completedBy(ctx, m, i)) break;
      const w = tape.trader[i];
      if (!tape.isBuy[i] || !p.kols.has(w) || tape.sol[i] < p.S * SOL) continue;
      if (progressOf(tape.vSol[i]) >= 0.9 || !inAnalysis(ctx, tape.tick[i])) break;
      let overrideIdx: number | undefined;
      if (p.mirror) for (let k = i + 1; k < tape.off[m + 1]; k++) if (!tape.isBuy[k] && tape.trader[k] === w) { overrideIdx = k; break; }
      out.push({ m, tSig: tape.tick[i], sigIdx: i, overrideIdx });
      break;
    }
  }
  return { signals: out };
}

// ---------------------------------------------------------------- H17 creator's own initial buy (entry at s0 + L)
export function H17(ctx: Ctx, _org: Uint8Array, p: { lo: number; hi: number }): SigOut {
  const out: Signal[] = [];
  for (let m = 0; m < ctx.nM; m++) {
    if (!ctx.universe[m] || !ctx.tape.meta[m].t0Exact) continue;
    const b = ctx.tape.meta[m].creatorBuyLamports / SOL;
    if (b < p.lo || b >= p.hi) continue;
    const s = timeSignal(ctx, m, 0); if (s) out.push(s);
  }
  return { signals: out };
}

// ================================================================ filters (flags at the naive entry signal)
export interface FilterCtx { ctx: Ctx; org: Uint8Array }

/** Per-wallet net token holdings up to index `upto` (inclusive). */
function holdings(ctx: Ctx, m: number, upto: number): Map<number, number> {
  const h = new Map<number, number>(); const { tape } = ctx;
  for (let i = ctx.tape.off[m]; i <= upto; i++) h.set(tape.trader[i], (h.get(tape.trader[i]) ?? 0) + (tape.isBuy[i] ? tape.tok[i] : -tape.tok[i]));
  return h;
}

export function F01(ctx: Ctx, m: number, _s: Signal, p: { b: number; s: number }): boolean {
  const { tape } = ctx; const buyers = new Set<number>(); let tok = 0;
  for (let i = tape.off[m]; i < tape.off[m + 1] && tape.tick[i] <= ctx.t0[m]; i++) {
    if (!tape.isBuy[i]) continue;
    tok += tape.tok[i];
    if (tape.trader[i] !== ctx.creatorId[m]) buyers.add(tape.trader[i]);
  }
  return buyers.size >= p.b || tok >= (p.s / 100) * TOTAL_SUPPLY_F;
}

/** F02: index of the creator trade at which C(m) has sold >= x of what it acquired, within T of s0 (-1 if never). */
export function F02flagIdx(ctx: Ctx, m: number, p: { x: number; T: number }): number {
  const { tape } = ctx; let b = 0, s = 0;
  const lim = ctx.t0[m] + ctx.secToTicks(p.T);
  for (let i = tape.off[m]; i < tape.off[m + 1] && tape.tick[i] <= lim; i++) {
    if (tape.trader[i] !== ctx.creatorId[m]) continue;
    if (tape.isBuy[i]) b += tape.tok[i]; else { s += tape.tok[i]; if (b > 0 && s >= (p.x / 100) * b) return i; }
  }
  return -1;
}

export function F03(ctx: Ctx, m: number, sg: Signal, p: { h: number }): boolean {
  const ring = ctx.ring.get(ctx.mintDay[m]); if (!ring || !ring.size) return false;
  const h = holdings(ctx, m, sg.sigIdx); let rs = 0;
  for (const [w, v] of h) if (ring.has(w) && v > 0) rs += v;
  if (rs >= (p.h / 100) * TOTAL_SUPPLY_F) return true;
  const { tape } = ctx; const first: number[] = []; const set = new Set<number>();
  for (let i = tape.off[m]; i <= sg.sigIdx && first.length < 20; i++) {
    const w = tape.trader[i]; if (!tape.isBuy[i] || w === ctx.creatorId[m] || set.has(w)) continue; set.add(w); first.push(w);
  }
  return first.length > 0 && first.filter((w) => ring.has(w)).length / first.length >= 0.25;
}

export function F04(ctx: Ctx, m: number, sg: Signal, p: { c: number }): boolean {
  const ring = ctx.ring.get(ctx.mintDay[m]) ?? new Map<number, number>();
  const h = holdings(ctx, m, sg.sigIdx); const merged = new Map<string, number>();
  for (const [w, v] of h) {
    if (v <= 0) continue;
    const key = w === ctx.creatorId[m] ? 'C' : ring.has(w) ? `R${ring.get(w)}` : `w${w}`;
    merged.set(key, (merged.get(key) ?? 0) + v);
  }
  const top = [...merged.values()].sort((a, b) => b - a).slice(0, 10).reduce((a, b) => a + b, 0);
  return top >= (p.c / 100) * TOTAL_SUPPLY_F;
}

export function F05(ctx: Ctx, m: number, _s: Signal, p: { n: number }): boolean {
  const list = ctx.creatorLaunches.get(ctx.creatorId[m]); if (!list) return false;
  const t = ctx.t0[m], day = 86_400 / ctx.tickSec;
  const w = list.filter((x) => ctx.t0[x] >= t - day && ctx.t0[x] <= t);
  const prior = w.filter((x) => x !== m);
  if (prior.length >= p.n && prior.every((x) => !(ctx.completeTick[x] < t))) return true;
  if (w.length >= 3) {
    const ts = w.map((x) => ctx.t0[x]).sort((a, b) => a - b);
    const gaps = ts.slice(1).map((v, i) => (v - ts[i]) * ctx.tickSec).sort((a, b) => a - b);
    const med = gaps.length % 2 ? gaps[(gaps.length - 1) / 2] : (gaps[gaps.length / 2 - 1] + gaps[gaps.length / 2]) / 2;
    if (med < 60) return true;
  }
  return false;
}

/** F06 needs, per mint, the tick at which progress first reached 0.3 (or completion). */
export function progress30Ticks(ctx: Ctx): Float64Array {
  const { tape } = ctx; const out = new Float64Array(ctx.nM).fill(NaN);
  const thr = INIT_VSOL_F + 0.3 * RS_GRAD_F;
  for (let m = 0; m < ctx.nM; m++) for (let i = tape.off[m]; i < tape.off[m + 1]; i++) if (tape.vSol[i] >= thr) { out[m] = tape.tick[i]; break; }
  return out;
}
export function makeF06(ctx: Ctx) {
  const p30 = progress30Ticks(ctx);
  const byT = new Map<string, number[]>();
  for (let m = 0; m < ctx.nM; m++) { if (!ctx.usable[m]) continue; const k = normTicker(ctx.tape.meta[m].symbol); if (!k) continue; const a = byT.get(k) ?? []; a.push(m); byT.set(k, a); }
  const day = 86_400 / ctx.tickSec;
  return (m: number, sg: Signal): boolean => {
    const k = normTicker(ctx.tape.meta[m].symbol); const list = byT.get(k); if (!list) return false;
    return list.some((x) => x !== m && ctx.t0[x] < ctx.t0[m] && ctx.t0[x] >= ctx.t0[m] - day && (p30[x] <= sg.tSig || ctx.completeTick[x] <= sg.tSig));
  };
}

export function F07(ctx: Ctx, m: number, sg: Signal, p: { w: number }): boolean {
  const { tape } = ctx; const lo = tape.off[m]; const n = sg.sigIdx - lo + 1; if (n <= 0) return false;
  const flag = new Uint8Array(n); const win = ctx.secToTicks(5);
  for (let i = lo; i <= sg.sigIdx; i++) {
    if (!tape.isBuy[i]) continue;
    for (let j = i + 1; j <= sg.sigIdx && tape.tick[j] <= tape.tick[i] + win; j++) {
      if (!tape.isBuy[j] && tape.trader[j] === tape.trader[i] && Math.abs(tape.tok[j] - tape.tok[i]) <= 0.02 * tape.tok[i]) { flag[i - lo] = 1; flag[j - lo] = 1; break; }
    }
  }
  let c = 0; for (let k = 0; k < n; k++) c += flag[k];
  return c / n >= p.w / 100;
}
