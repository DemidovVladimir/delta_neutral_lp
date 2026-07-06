/**
 * hedgeController — the PURE decision core of the perps hedge (ADR-017).
 *
 * `decideHedgeAction` maps a snapshot of (LP exposure, both perp sides, market
 * carry, config) to exactly one action. No I/O, no getConfig(), no clocks —
 * every input is a parameter, so the full decision table is unit-testable
 * (pattern: `swapPlanner.ts`).
 *
 * Controller law: drive `error = (lpSol + longSol − shortSol) − targetDeltaSol`
 * to 0, acting only when |error| > bandSol (band rebalancing, ADR-002), one
 * mutation per cycle:
 *
 *   error > band  (too much delta)   → decrease_long first, else increase_short
 *   error < −band (too little delta) → decrease_short first, else increase_long
 *
 * Decrease-first keeps the invariant "never hold both sides"; a residual error
 * after a full close is handled next cycle against fresh on-chain state —
 * deliberately serialized around Jupiter's asynchronous keeper fill (TX2).
 * Decreases are never blocked by guards (they reduce risk); increases must
 * pass the carry cap, the notional cap, the projected collateral ratio, and —
 * for longs, whose collateral is SOL from the wallet — the wallet reserves.
 */

/** Epsilon in SOL below which a residual position is treated as fully closed. */
const EPSILON_SOL = 1e-9;

/**
 * Smallest increase worth sending, USD. Below this the cap headroom is
 * treated as exhausted (Jupiter fees + rent would eat a smaller fill).
 */
const MIN_HEDGE_INCREASE_USD = 10;

export interface HedgeDecisionInput {
  /** SOL held long via the LP (LpExposure.solAmount). */
  lpSol: number;
  /** Open perp sides, positive magnitudes in SOL (0 = side not open). */
  longSol: number;
  shortSol: number;
  /** Current notionals/collateral per side, USD. */
  longNotionalUsd: number;
  shortNotionalUsd: number;
  longCollateralUsd: number;
  shortCollateralUsd: number;
  /** Carry COST per side in bps APR (positive number = the side pays). */
  carryCostBps: { long: number; short: number };
  /** Oracle mark price for SOL, USD. */
  oraclePriceUsd: number;
  /** Wallet native SOL balance (long collateral comes from here). */
  walletSol: number;
  /** SOL that must stay in the wallet (MINIMUM_WALLET_BALANCE_SOL + RENT_RESERVE_SOL). */
  walletReserveSol: number;

  // Config
  targetDeltaSol: number;
  bandSol: number;
  /** 0 disables the carry gate. */
  carryCapBps: number;
  maxHedgeNotionalUsd: number;
  minCollateralRatio: number;
  targetCollateralRatio: number;

  // Keeper-fill cooldown (see ADR-017): block mutations while a previous live
  // request may still be filling.
  nowMs: number;
  lastActionAtMs: number | null;
  cooldownMs: number;
}

export type HedgeDecision =
  | { action: 'none'; reason?: string }
  | { action: 'blocked'; reason: string }
  | {
      action: 'decrease_long' | 'decrease_short';
      /** Notional to reduce, USD (ignored by the venue when entirePosition). */
      sizeUsd: number;
      entirePosition: boolean;
      /** Collateral to withdraw on a partial decrease, USD. */
      withdrawCollateralUsd: number;
      /** Signed change to perp base SOL this action produces. */
      adjustSol: number;
    }
  | {
      action: 'increase_long' | 'increase_short';
      /** Notional to add, USD. */
      sizeUsd: number;
      /** Collateral to post, in the side's collateral token (USDC for short, SOL for long). */
      collateralTokens: number;
      /** Signed change to perp base SOL this action produces. */
      adjustSol: number;
    };

export function decideHedgeAction(input: HedgeDecisionInput): HedgeDecision {
  const {
    lpSol,
    longSol,
    shortSol,
    oraclePriceUsd: price,
    targetDeltaSol,
    bandSol,
  } = input;

  if (!(price > 0) || !Number.isFinite(price)) {
    return { action: 'blocked', reason: 'no oracle SOL price available' };
  }

  const netDeltaSol = lpSol + longSol - shortSol;
  const error = netDeltaSol - targetDeltaSol;

  if (Math.abs(error) <= bandSol) {
    return { action: 'none', reason: 'in band' };
  }

  // Cooldown gate AFTER the band check so an in-band read still reports 'none'
  // with the honest reason, and only actual mutations get suppressed.
  if (input.lastActionAtMs !== null && input.cooldownMs > 0) {
    const elapsed = input.nowMs - input.lastActionAtMs;
    if (elapsed < input.cooldownMs) {
      return {
        action: 'none',
        reason: `cooldown: previous hedge request may still be filling (${Math.max(0, input.cooldownMs - elapsed)}ms remaining)`,
      };
    }
  }

  if (error > 0) {
    // Too much delta → reduce it. Decrease the long first; only when flat on
    // the long side do we grow the short.
    if (longSol > EPSILON_SOL) {
      const adjustSol = Math.min(error, longSol);
      const entirePosition = adjustSol >= longSol - EPSILON_SOL;
      const sizeUsd = adjustSol * price;
      return {
        action: 'decrease_long',
        sizeUsd,
        entirePosition,
        withdrawCollateralUsd: entirePosition ? 0 : sizeUsd * input.targetCollateralRatio,
        adjustSol: -adjustSol,
      };
    }
    return guardIncrease(input, 'short', error, price);
  }

  // Too little delta → add some. Decrease the short first; only when flat on
  // the short side do we open a long.
  const deficit = -error;
  if (shortSol > EPSILON_SOL) {
    const adjustSol = Math.min(deficit, shortSol);
    const entirePosition = adjustSol >= shortSol - EPSILON_SOL;
    const sizeUsd = adjustSol * price;
    return {
      action: 'decrease_short',
      sizeUsd,
      entirePosition,
      withdrawCollateralUsd: entirePosition ? 0 : sizeUsd * input.targetCollateralRatio,
      adjustSol,
    };
  }
  return guardIncrease(input, 'long', deficit, price);
}

/** Common guard block for growing either side by `adjustSol` (positive SOL). */
function guardIncrease(
  input: HedgeDecisionInput,
  side: 'long' | 'short',
  adjustSol: number,
  price: number,
): HedgeDecision {
  const carryCostBps = input.carryCostBps[side];
  if (input.carryCapBps > 0 && carryCostBps > input.carryCapBps) {
    return {
      action: 'blocked',
      reason: `${side} carry ${(carryCostBps / 100).toFixed(2)}% APR exceeds cap ${(input.carryCapBps / 100).toFixed(2)}%`,
    };
  }

  // BUG-012: an increase that would overshoot the notional cap fills the
  // remaining headroom instead of blocking outright — all-or-nothing blocking
  // left the book pinned under-hedged for hours when the clamped full-bag
  // target exceeded the cap by a few percent.
  const currentNotional = side === 'long' ? input.longNotionalUsd : input.shortNotionalUsd;
  let sizeUsd = adjustSol * price;
  const headroomUsd = input.maxHedgeNotionalUsd - currentNotional;
  if (sizeUsd > headroomUsd) {
    if (headroomUsd < MIN_HEDGE_INCREASE_USD) {
      return {
        action: 'blocked',
        reason: `projected ${side} notional $${(currentNotional + sizeUsd).toFixed(2)} exceeds max $${input.maxHedgeNotionalUsd.toFixed(2)} and headroom $${Math.max(0, headroomUsd).toFixed(2)} is below the $${MIN_HEDGE_INCREASE_USD} minimum increase`,
      };
    }
    sizeUsd = headroomUsd;
    adjustSol = sizeUsd / price;
  }
  const projectedNotional = currentNotional + sizeUsd;

  const collateralUsd = sizeUsd * input.targetCollateralRatio;
  const currentCollateral = side === 'long' ? input.longCollateralUsd : input.shortCollateralUsd;
  const projectedRatio =
    projectedNotional > 0 ? (currentCollateral + collateralUsd) / projectedNotional : Infinity;
  if (projectedRatio < input.minCollateralRatio) {
    return {
      action: 'blocked',
      reason: `projected collateral ratio ${projectedRatio.toFixed(3)} below min ${input.minCollateralRatio}`,
    };
  }

  if (side === 'long') {
    // Long collateral is native SOL from the wallet — never dip into reserves.
    const collateralSol = collateralUsd / price;
    const availableSol = input.walletSol - input.walletReserveSol;
    if (collateralSol > availableSol) {
      return {
        action: 'blocked',
        reason: `long collateral ${collateralSol.toFixed(4)} SOL exceeds available wallet SOL ${availableSol.toFixed(4)} (balance ${input.walletSol.toFixed(4)} − reserves ${input.walletReserveSol.toFixed(4)})`,
      };
    }
    return { action: 'increase_long', sizeUsd, collateralTokens: collateralSol, adjustSol };
  }

  return { action: 'increase_short', sizeUsd, collateralTokens: collateralUsd, adjustSol: -adjustSol };
}

/**
 * ADR-019: the hedge input in 'midpoint' mode — the SOL-denominated HALF of
 * the LP's total value. For a freshly centered position this equals the SOL
 * deposit and stays ~constant across the position's range lifetime, so LP
 * recenters stop forcing hedge corrections and bin-composition wiggle never
 * reaches the controller. Empty exposure (no position) still yields 0 → a
 * leftover perp unwinds exactly as in 'live' mode.
 */
export function computeLpMidpointSol(
  lpSolAmount: number,
  lpUsdcAmount: number,
  solPriceUsd: number
): number {
  if (!(solPriceUsd > 0)) return lpSolAmount; // defensive: fall back to live
  return (lpSolAmount + lpUsdcAmount / solPriceUsd) / 2;
}

/**
 * ADR-021 (HOLE-2 fix + storm mode): the TRUE SOL delta of the LP for
 * hedging. In range → the midpoint approximation (ADR-019). Out of range
 * BELOW (composition ≈ pure SOL) → the FULL SOL amount: the position has
 * stopped converting and is a spot SOL bag; hedging half of it leaves real
 * downside exposure exactly while price falls. Fully shorting the bag is a
 * synthetic exit to USDC — cheaper than spot-swapping out (6bps perp fee vs
 * swap spread × 2) and instantly reversible. Out of range ABOVE (pure USDC)
 * → zero delta.
 *
 * Hysteresis: enter the clamp at 98%/2% composition, leave it at 90%/10%
 * (pass the previous regime via `sticky`) — otherwise price chopping around
 * a range edge would flip the hedge target by ±half the position every
 * cooldown window. Enter thresholds sit past the auto-tune trigger (0.92),
 * so with recentering active the clamp rarely engages; it matters when
 * rebalancing is paused (storm mode) or failing.
 */
export type LpHedgeRegime = 'below' | 'in' | 'above';

export function computeLpHedgeDelta(
  lpSolAmount: number,
  lpUsdcAmount: number,
  solPriceUsd: number,
  sticky: LpHedgeRegime = 'in'
): { deltaSol: number; regime: LpHedgeRegime } {
  if (!(solPriceUsd > 0)) return { deltaSol: lpSolAmount, regime: sticky }; // defensive
  const solValueUsd = lpSolAmount * solPriceUsd;
  const totalUsd = solValueUsd + lpUsdcAmount;
  if (totalUsd <= 0) return { deltaSol: 0, regime: 'in' };
  const solShare = solValueUsd / totalUsd;

  const enterBelow = 0.98;
  const exitBelow = 0.9;
  const enterAbove = 0.02;
  const exitAbove = 0.1;

  let regime: LpHedgeRegime;
  if (sticky === 'below') {
    regime = solShare >= exitBelow ? 'below' : solShare <= enterAbove ? 'above' : 'in';
  } else if (sticky === 'above') {
    regime = solShare <= exitAbove ? 'above' : solShare >= enterBelow ? 'below' : 'in';
  } else {
    regime = solShare >= enterBelow ? 'below' : solShare <= enterAbove ? 'above' : 'in';
  }

  const deltaSol =
    regime === 'below'
      ? lpSolAmount
      : regime === 'above'
        ? 0
        : computeLpMidpointSol(lpSolAmount, lpUsdcAmount, solPriceUsd);
  return { deltaSol, regime };
}

/**
 * ADR-022 (BUG-012): the per-side notional cap auto-derives from the measured
 * portfolio instead of a hand-tuned constant, so adding/removing capital never
 * requires the operator to re-size it. `capBagSol` is the largest SOL amount
 * the controller could ever legitimately hedge: idle wallet SOL + the LP's
 * full value in SOL (the below-range clamp shorts the whole bag) + any
 * deliberate |target| tilt. `capMult` (HEDGE_NOTIONAL_CAP_MULT, default 1.25)
 * is the blast-radius margin above that. `absoluteCapUsd` > 0 re-enables the
 * old MAX_HEDGE_NOTIONAL_USD as an optional hard ceiling on top; 0 disables
 * it. A runaway increase is independently bounded by physics regardless: the
 * venue rejects any increase whose collateral (targetRatio × size) is not
 * actually present in the wallet.
 */
export function computeAutoNotionalCapUsd(
  capBagSol: number,
  solPriceUsd: number,
  capMult: number,
  absoluteCapUsd: number,
): number {
  const autoUsd = capBagSol * solPriceUsd * capMult;
  if (!Number.isFinite(autoUsd) || autoUsd <= 0) {
    return absoluteCapUsd > 0 ? absoluteCapUsd : 0;
  }
  return absoluteCapUsd > 0 ? Math.min(autoUsd, absoluteCapUsd) : autoUsd;
}
