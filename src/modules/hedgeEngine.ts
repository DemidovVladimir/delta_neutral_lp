/**
 * HedgeEngine — venue-agnostic contract for the perpetuals hedge (ADR-015/017).
 *
 * The bot holds long SOL exposure via the Meteora DLMM LP; the hedge holds a
 * SOL perp (SHORT or LONG) sized so net ΔSOL ≈ HEDGE_TARGET_DELTA_SOL
 * (default 0 = delta-neutral). Originally designed for Drift (ADR-014), but
 * Drift went down after an exploit, so the active backend is Jupiter Perps
 * (`JupiterPerpsEngine`). This interface keeps the controller/dashboard/read
 * side independent of the venue so a backend can be swapped without touching
 * callers.
 */

import type { LpExposure } from '../types/index.js';

/** Per-side detail of the hedge (a venue may hold long and short PDAs). */
export interface HedgeSideState {
  /** Notional of this side in USD (absolute). */
  notionalUsd: number;
  /** Collateral posted on this side, USD. */
  collateralUsd: number;
  /** Average entry price of this side, USD. */
  entryPriceUsd: number;
  /**
   * Mark-to-market PRICE PnL vs entry, USD. Positive = the side is in profit.
   * Borrow fees are NOT netted here — see accruedBorrowFeeUsd.
   * Side equity ≈ collateralUsd + unrealizedPnlUsd − accruedBorrowFeeUsd.
   */
  unrealizedPnlUsd: number;
  /** Borrow fees accrued since entry, USD (always a cost on Jupiter). */
  accruedBorrowFeeUsd: number;
  /** Estimated liquidation price for this side, USD. Null when unavailable. */
  liquidationPrice: number | null;
  /**
   * Annualised carry rate of THIS side, bps. Positive = earns, negative =
   * pays. On Jupiter this is the borrow fee of the side's COLLATERAL custody
   * (USDC for shorts, SOL for longs) — always negative.
   */
  carryRateBps: number;
}

/** A point-in-time read of the hedge — the controller's primary input. */
export interface HedgeState {
  /** Which venue produced this read (e.g. 'jupiter-perps', 'drift'). */
  venue: string;
  /** Current NET perp base position in SOL (long − short). Negative = net short. */
  perpBaseSol: number;
  /** Notional of the perp position in USD (absolute). */
  perpNotionalUsd: number;
  /** Total collateral on the hedge account, USD. */
  totalCollateralUsd: number;
  /** Free/withdrawable collateral, USD. */
  freeCollateralUsd: number;
  /** Collateral ratio = collateral / max(notional, ε). Infinity when no position. */
  collateralRatio: number;
  /**
   * Annualised carry rate of the hedge, in bps.
   * SIGN CONVENTION: positive = the hedge EARNS, negative = the hedge PAYS.
   * On Jupiter Perps this is always negative (borrow fee, a continuous cost).
   */
  carryRateBps: number;
  /** Estimated liquidation price for the open side, USD. Null when no position. */
  liquidationPrice: number | null;
  /** Oracle mark price for SOL, USD. */
  oraclePriceUsd: number;
  /** Per-side breakdown (both PDAs read). Optional for backends without it. */
  sides?: { long: HedgeSideState | null; short: HedgeSideState | null };
}

/** Net-delta view combining LP exposure with the current hedge. */
export interface DeltaView {
  /** SOL held long via the LP position. */
  lpSolExposure: number;
  /** SOL shorted on the perp venue (positive magnitude; 0 if none). */
  shortSol: number;
  /** SOL held long on the perp venue (positive magnitude; 0 if none). */
  longSol: number;
  /** Net ΔSOL = lpSolExposure + perpBaseSol (perp nets long − short). */
  netDeltaSol: number;
  /** The delta the controller steers toward (HEDGE_TARGET_DELTA_SOL, default 0). */
  targetDeltaSol: number;
  /** True when |netDeltaSol − targetDeltaSol| exceeds the band (DELTA_THRESHOLD_SOL). */
  outOfBand: boolean;
}

export type HedgeAction =
  | 'none'
  | 'increase_short'
  | 'decrease_short'
  | 'increase_long'
  | 'decrease_long'
  | 'blocked';

/** Outcome of an on-chain simulation (dry-run): did the tx revert, and why. */
export interface SimResult {
  success: boolean;
  unitsConsumed?: number;
  logs?: string[];
  err?: unknown;
}

/** Result of a hedge mutation (open/adjust/close/deposit). */
export interface MutationResult {
  action: string;
  /** True = simulated only, nothing sent. False = a real transaction was sent. */
  dryRun: boolean;
  simulated?: SimResult;
  /** Signature(s) of sent transaction(s). Jupiter uses a request + keeper-fill flow. */
  signatures?: string[];
  detail?: string;
}

/** Result of a rebalance attempt. */
export interface HedgeRebalanceResult {
  action: HedgeAction;
  /**
   * Signed change to the perp base position in SOL (negative = short grown or
   * long reduced; positive = the mirror). 0 if no-op/blocked.
   */
  adjustedSol: number;
  blockedReason?: string;
  signatures: string[];
  deltaBefore: DeltaView;
  deltaAfter?: DeltaView;
  /** Oracle SOL price the decision was made at, USD. 0 when unavailable. */
  oraclePriceUsd?: number;
  /** The underlying open/decrease mutation (sim result in dry-run, sigs when live). */
  mutation?: MutationResult;
}

/** The contract every perp-hedge backend implements. */
export interface HedgeEngine {
  /** Human-readable venue id. */
  readonly venue: string;
  /** Connect/prepare the engine. Idempotent. */
  initialize(): Promise<void>;
  /** Read the current hedge state (read-only). */
  getHedgeState(): Promise<HedgeState>;
  /** Combine LP exposure with the current short into a net-delta view. */
  computeDelta(lpExposure: LpExposure): Promise<DeltaView>;
  /** Tear down any connections/subscriptions. */
  shutdown(): Promise<void>;
}
