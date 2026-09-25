/**
 * Exact pump.fun bonding-curve and PumpSwap math (PROTOCOL.md §4.1, §4.2).
 *
 * Two paths with the same formulas:
 *   - BigInt ("exact"): integer lamport / base-unit math with the SDK's floor/ceil order.
 *     Used for OUR fills (the numbers that become P&L).
 *   - float64 ("fast"): the same formulas on doubles, used only to replay other traders'
 *     observed trades on the adjusted reserves during insert-and-replay. selftest.ts checks
 *     that both paths agree to <= 2 base units on random states.
 *
 * Standard pump.fun coin (Global PDA 4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf):
 *   vSol0 = 30 SOL, vTok0 = 1,073,000,000 tokens (6 dp), real tokens 793,100,000, supply 1e9.
 *   Completion when real tokens reach 0 -> vTok = 279,900,000 tokens, vSol = 115.005359 SOL.
 */

export const INIT_VSOL = 30_000_000_000n;
export const INIT_VTOK = 1_073_000_000_000_000n;
export const INIT_RTOK = 793_100_000_000_000n;
export const VTOK_COMPLETE = INIT_VTOK - INIT_RTOK; // 279_900_000_000_000
export const TOTAL_SUPPLY = 1_000_000_000_000_000n;
export const POOL_BASE_AT_MIGRATION = TOTAL_SUPPLY - INIT_RTOK; // 206_900_000_000_000
export const MIGRATION_FEE = 15_000_001n; // pool_migration_fee 0.015000001 SOL

export const INIT_VSOL_F = 30e9;
export const INIT_VTOK_F = 1.073e15;
export const VTOK_COMPLETE_F = 2.799e14;
export const RS_GRAD_F = 85_005_359_000; // real SOL at completion (lamports), PROTOCOL §4.1
export const TOTAL_SUPPLY_F = 1e15;

/** Per-side fee split in basis points. Curve: 95 protocol + 30 creator (FeeConfig 8Wf5TiAheLUqBrKXeYg2JtAFFMWtKdG2BSFgqUcPVwTt). */
export interface FeeBps { a: number; b: number; c?: number } // components; each is ceil-charged separately
export const CURVE_FEE: FeeBps = { a: 95, b: 30 };
/** PumpSwap canonical pool tier 0 (pool mcap < 420 SOL): lp 2 / protocol 93 / creator 30 = 1.25 %. */
export const POOL_TIER0_FEE: FeeBps = { a: 2, b: 93, c: 30 };

export function feeTotalBps(f: FeeBps): number { return f.a + f.b + (f.c ?? 0); }
export function scaleFee(f: FeeBps, mult: number): FeeBps {
  // sensitivity "fees +20 %": scale each component, keep integer bps (round half up)
  return { a: Math.round(f.a * mult), b: Math.round(f.b * mult), c: f.c === undefined ? undefined : Math.round(f.c * mult) };
}

const ceilDiv = (x: bigint, d: bigint) => (x + d - 1n) / d;
const feeOn = (amt: bigint, f: FeeBps) =>
  ceilDiv(amt * BigInt(f.a), 10_000n) + ceilDiv(amt * BigInt(f.b), 10_000n) + (f.c ? ceilDiv(amt * BigInt(f.c), 10_000n) : 0n);

// ---------------------------------------------------------------- exact (BigInt) curve

/** SDK getBuyTokenAmountFromSolAmount: tokens for a SOL budget S (fees inside S). */
export function buyTokensForSol(S: bigint, vSol: bigint, vTok: bigint, realTok: bigint, f: FeeBps = CURVE_FEE): bigint {
  if (S <= 1n) return 0n;
  const input = ((S - 1n) * 10_000n) / (10_000n + BigInt(feeTotalBps(f)));
  const t = (input * vTok) / (vSol + input);
  return t < realTok ? t : realTok;
}

/** On-chain `buy(t, max_sol_cost)`: curve SOL (TradeEvent sol_amount) and total paid incl. fees. */
export function buyCostForTokens(t: bigint, vSol: bigint, vTok: bigint, f: FeeBps = CURVE_FEE): { curve: bigint; total: bigint } {
  if (t <= 0n) return { curve: 0n, total: 0n };
  if (t >= vTok) return { curve: 1n << 120n, total: 1n << 120n };
  const curve = (t * vSol) / (vTok - t) + 1n;
  return { curve, total: curve + feeOn(curve, f) };
}

/** On-chain `sell(t, min_sol_output)`: gross curve SOL out and what the seller receives. */
export function sellProceeds(t: bigint, vSol: bigint, vTok: bigint, f: FeeBps = CURVE_FEE): { gross: bigint; net: bigint } {
  if (t <= 0n) return { gross: 0n, net: 0n };
  const gross = (t * vSol) / (vTok + t);
  const fee = feeOn(gross, f);
  return { gross, net: gross > fee ? gross - fee : 0n };
}

// ---------------------------------------------------------------- exact (BigInt) PumpSwap

/** Sell base b into a constant-product pool (quote Qeff, base B). out = Qeff*b/(B+b); receive out - fees.
 *  realVault: the real quote vault. A sell reverts if realVault < out - lpFee (post-BOOST check, §4.2);
 *  then the largest clearing amount is sold and the rest is worth 0 (§3.4). */
export function poolSell(b: bigint, Qeff: bigint, B: bigint, realVault: bigint, f: FeeBps = POOL_TIER0_FEE): { sold: bigint; net: bigint; out: bigint } {
  if (b <= 0n) return { sold: 0n, net: 0n, out: 0n };
  const outOf = (x: bigint) => (Qeff * x) / (B + x);
  const lpFee = (x: bigint) => ceilDiv(x * BigInt(f.a), 10_000n);
  let sold = b;
  let out = outOf(sold);
  if (realVault < out - lpFee(out)) {
    // binary search the largest clearing amount
    let lo = 0n, hi = b;
    while (lo < hi) {
      const mid = (lo + hi + 1n) / 2n;
      const o = outOf(mid);
      if (realVault >= o - lpFee(o)) lo = mid; else hi = mid - 1n;
    }
    sold = lo; out = outOf(sold);
  }
  const fee = feeOn(out, f);
  return { sold, out, net: out > fee ? out - fee : 0n };
}

// ---------------------------------------------------------------- fast (float64) path

/** Replay an observed buy that kept its curve SOL input X on (possibly adjusted) reserves. Returns tokens out. */
export function fBuyTokensForCurveSol(X: number, vSol: number, vTok: number): number {
  // inverse of curve = t*vSol/(vTok-t) + 1  ->  t = (X-1)*vTok/(vSol+X-1)
  const x = X - 1;
  if (x <= 0) return 0;
  return Math.floor((x * vTok) / (vSol + x));
}
/** Gross curve SOL for selling t tokens. */
export function fSellGross(t: number, vSol: number, vTok: number): number {
  if (t <= 0) return 0;
  return Math.floor((t * vSol) / (vTok + t));
}
export function fFeeOn(amt: number, f: FeeBps): number {
  return Math.ceil((amt * f.a) / 10_000) + Math.ceil((amt * f.b) / 10_000) + (f.c ? Math.ceil((amt * f.c) / 10_000) : 0);
}
/** Net SOL for selling t tokens into the curve (fees charged), float path. */
export function fSellNet(t: number, vSol: number, vTok: number, f: FeeBps = CURVE_FEE): number {
  const g = fSellGross(t, vSol, vTok);
  const n = g - fFeeOn(g, f);
  return n > 0 ? n : 0;
}

/** Spot price in lamports per raw token unit (for drawdown-type signals only; never for P&L). */
export const fPrice = (vSol: number, vTok: number) => vSol / vTok;
/** progress = real SOL / 85.005359 SOL (standard coins). */
export const fProgress = (vSol: number) => (vSol - INIT_VSOL_F) / RS_GRAD_F;
