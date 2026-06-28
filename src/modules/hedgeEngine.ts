/**
 * HedgeEngine — venue-agnostic contract for the perpetuals hedge (ADR-015).
 *
 * The bot holds long SOL exposure via the Meteora DLMM LP and needs a SHORT
 * SOL perp to bring net ΔSOL ≈ 0. Originally designed for Drift (ADR-014), but
 * Drift went down after an exploit, so the active backend is Jupiter Perps
 * (`JupiterPerpsEngine`). This interface keeps the controller/dashboard/read
 * side independent of the venue so a backend can be swapped (e.g. back to Drift
 * if/when it relaunches) without touching callers.
 */

import type { LpExposure } from '../types/index.js';

/** A point-in-time read of the hedge — the controller's primary input. */
export interface HedgeState {
  /** Which venue produced this read (e.g. 'jupiter-perps', 'drift'). */
  venue: string;
  /** Current perp base position in SOL. Negative = short. 0 = no position. */
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
  /** Estimated liquidation price for the position, USD. Null when no position. */
  liquidationPrice: number | null;
  /** Oracle mark price for SOL, USD. */
  oraclePriceUsd: number;
}

/** Net-delta view combining LP exposure with the current short. */
export interface DeltaView {
  /** SOL held long via the LP position. */
  lpSolExposure: number;
  /** SOL shorted on the perp venue (positive magnitude; 0 if none). */
  shortSol: number;
  /** Net ΔSOL = lpSolExposure + perpBaseSol (perp is negative for a short). Target ≈ 0. */
  netDeltaSol: number;
  /** True when |netDeltaSol| exceeds the rebalance band (DELTA_THRESHOLD_SOL). */
  outOfBand: boolean;
}

export type HedgeAction = 'none' | 'increase_short' | 'decrease_short' | 'blocked';

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
  /** SOL size adjusted (signed: negative = added to short). 0 if no-op/blocked. */
  adjustedSol: number;
  blockedReason?: string;
  signatures: string[];
  deltaBefore: DeltaView;
  deltaAfter?: DeltaView;
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
