/**
 * «Выдержка на вход» (re-entry gate, BACKLOG A15, operator-approved
 * 2026-07-13) — the pure decision core.
 *
 * The storm pause (ADR-021) only sees FAST moves (2%/5min); slow saws and
 * trends — the regimes that actually cost the strategy money — sail under
 * it. This gate is the complement on the RE-OPEN side: after a recenter
 * CLOSES the old position, the inventory parks in the wallet (ADR-021 keeps
 * it hedged/neutral) and the new position opens only once the price has
 * stayed within ±tolerance of an anchor for the confirm window. The anchor
 * resets on every breakout, so a running move keeps the machine out of the
 * pool until it pauses.
 *
 * Simulator evidence (calibrated fees, `95fe61c`): crash month +21.48 vs
 * +14.24 deployed, rally month −12.56 vs −20.87, C3 crash-night week +2.27
 * vs +1.93, C4 saw window +2.24 vs +3.03 — wins 3 of 4 windows, flips the
 * two-month sum from −6.6 to +8.9 USD.
 *
 * Pure: no I/O, no clock, no config reads — fully unit-tested.
 */

export type ReentryDecision =
  | { action: 'hold' }
  | { action: 'rearm'; anchorPrice: number; stableSinceMs: number }
  | { action: 'open' };

export interface ReentryGateInput {
  nowMs: number;
  /** Current oracle price (cross-validated). */
  price: number;
  /** Anchor set at close time or at the last breakout. */
  anchorPrice: number;
  /** When the price last (re)entered the calm corridor around the anchor. */
  stableSinceMs: number;
  /**
   * Corridor half-width as a PRICE FRACTION (already scaled from the range
   * geometry at close time: REENTRY_TOL_FRAC × range width / price).
   */
  tolPriceFrac: number;
  /** REENTRY_CONFIRM_MS. 0 or negative = open immediately (feature off /
   * operator rollback mid-wait). */
  confirmMs: number;
  /** ADR-021 storm: never open into a storm — keep waiting (the anchor
   * logic still runs, so a storm breakout re-arms normally). */
  stormActive: boolean;
}

export function evaluateReentryGate(input: ReentryGateInput): ReentryDecision {
  const { nowMs, price, anchorPrice, stableSinceMs, tolPriceFrac, confirmMs, stormActive } = input;

  // Never act on garbage — a broken oracle read must not open a position
  // (nor destroy the anchor).
  if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(anchorPrice) || anchorPrice <= 0) {
    return { action: 'hold' };
  }

  if (Math.abs(price / anchorPrice - 1) > tolPriceFrac) {
    // Breakout — the move is still running. Re-anchor at the new level and
    // restart the calm clock.
    return { action: 'rearm', anchorPrice: price, stableSinceMs: nowMs };
  }

  if (!stormActive && nowMs - stableSinceMs >= confirmMs) {
    return { action: 'open' };
  }

  return { action: 'hold' };
}
