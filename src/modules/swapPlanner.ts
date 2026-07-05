/**
 * planSwapForDeposit — pure helper that decides whether a swap is required
 * to bring wallet balances up to a target deposit, and if so, in which
 * direction and for what amount.
 *
 * Lives in its own file so it can be unit-tested in isolation. Both
 * `createInitialPosition` and `executeRebalance` in AutoTuneOrchestrator
 * call this helper instead of inlining swap-decision logic; before the
 * extraction the two paths had drifted apart and the initial-position
 * branch was missing a balance guard, which is what caused the
 * 566.81-USDC-with-9.43-USDC-on-hand bug.
 *
 * Pure: no logging, no I/O, no clock. Throws on unfixable inputs.
 */

const SOL_MINT = 'So11111111111111111111111111111111111111112';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

export type SwapDirection = 'SOL_TO_USDC' | 'USDC_TO_SOL';

export type SwapPlanContext = 'initial-position' | 'rebalance';

export interface SwapPlanInput {
  /** Live wallet balances in human-readable units (SOL, USDC), not lamports/raw. */
  walletSol: number;
  walletUsdc: number;

  /** Target deposit amounts the position wants in human-readable units. */
  targetSol: number;
  targetUsdc: number;

  /** Permanent SOL floor — never spent on swap input or position deposit. */
  permanentMinimumSol: number;

  /** Temporary SOL reserve held back for rent + transaction fees during position creation. */
  rentReserveSol: number;

  /** Current SOL/USD price for shortfall valuation. */
  currentPrice: number;

  /**
   * Slippage buffer applied to the swap input amount, expressed as a fraction
   * (0.02 == 2%). Caller is responsible for converting from any percent-based
   * config knob.
   */
  slippageBufferPct: number;

  /** Where this plan is being built — used in error messages so logs are unambiguous. */
  context: SwapPlanContext;

  /**
   * Optional: shown in user-facing errors so the operator knows which env var
   * to tune. Plain number, in whatever units the config uses.
   */
  autoTuneDepositAmount?: number;
}

export interface SwapPlanShortfall {
  /** SOL needed beyond what's available after reserves (zero if covered). */
  sol: number;
  /** USDC needed beyond what the wallet holds (zero if covered). */
  usdc: number;
}

export interface SwapPlanSwap {
  direction: SwapDirection;
  inputMint: string;
  outputMint: string;
  /** Amount of input token to swap (human-readable units), with slippage buffer applied. */
  amount: number;
  /** Bare expected output (no slippage adjustment) — useful for logging. */
  expectedOutput: number;
}

export interface SwapPlan {
  /** True when the wallet needs a swap to reach the target deposits. */
  needed: boolean;

  /**
   * Reserve-aware available SOL for any operation that doesn't dip into the
   * permanent minimum or the rent reserve. Always populated, even when no swap
   * is needed — callers commonly want to log this regardless.
   */
  availableSolForSwap: number;

  /** Per-token shortfall against target. Both zero when needed === false. */
  shortfall: SwapPlanShortfall;

  /** Set when needed === true. Undefined otherwise. */
  swap?: SwapPlanSwap;
}

/**
 * Plan a swap (if any) to bring wallet balances up to the target deposit
 * amounts.
 *
 * Throws plain `Error` (with a descriptive message) when the request is
 * impossible — i.e. when:
 *   1. the wallet's total USD value (after reserves) is below the position's
 *      required value — no swap can fix that, or
 *   2. the wallet doesn't hold enough of the swap-input token to fund the swap
 *      we'd otherwise plan.
 *
 * Returns `{ needed: false, … }` when the wallet already covers the target.
 *
 * Callers do all logging and the actual `executeSwap` call. This helper is
 * pure and side-effect-free.
 */
export function planSwapForDeposit(input: SwapPlanInput): SwapPlan {
  const {
    walletSol,
    walletUsdc,
    targetSol,
    targetUsdc,
    permanentMinimumSol,
    rentReserveSol,
    currentPrice,
    slippageBufferPct,
    context,
    autoTuneDepositAmount,
  } = input;

  // Defensive sanity checks — these should never trigger from real config but
  // catching here gives a much better error than a downstream NaN.
  if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
    throw new Error(`planSwapForDeposit: currentPrice must be a positive finite number (got ${currentPrice})`);
  }
  if (slippageBufferPct < 0) {
    throw new Error(`planSwapForDeposit: slippageBufferPct must be >= 0 (got ${slippageBufferPct})`);
  }

  const totalReserve = permanentMinimumSol + rentReserveSol;
  const availableSolForSwap = Math.max(0, walletSol - totalReserve);

  const solShortfall = Math.max(0, targetSol - availableSolForSwap);
  const usdcShortfall = Math.max(0, targetUsdc - walletUsdc);

  // Fast-path: no swap needed.
  if (solShortfall === 0 && usdcShortfall === 0) {
    return {
      needed: false,
      availableSolForSwap,
      shortfall: { sol: 0, usdc: 0 },
    };
  }

  // ────────────────────────────────────────────────────────────────────────
  // TOTAL-VALUE PRE-FLIGHT
  // No amount of swapping can fund a position larger than the wallet's
  // available USD value. Catch this first so the operator gets a clear,
  // actionable error instead of a downstream "Insufficient funds" from
  // Jupiter's order-response error code.
  // ────────────────────────────────────────────────────────────────────────
  const walletValueUsd = availableSolForSwap * currentPrice + walletUsdc;
  const requiredValueUsd = targetSol * currentPrice + targetUsdc;
  if (walletValueUsd < requiredValueUsd) {
    throw new Error(
      `Wallet does not have enough total value for ${context}. ` +
      `Available: $${walletValueUsd.toFixed(2)} ` +
      `(${availableSolForSwap.toFixed(4)} SOL after ${totalReserve.toFixed(2)} SOL reserves + ${walletUsdc.toFixed(2)} USDC @ $${currentPrice.toFixed(2)}/SOL). ` +
      `Required: $${requiredValueUsd.toFixed(2)} ` +
      `(${targetSol.toFixed(4)} SOL + ${targetUsdc.toFixed(2)} USDC). ` +
      `No swap can resolve this. ${formatTunableHint(autoTuneDepositAmount, 'funds')}`
    );
  }

  const bufferMultiplier = 1 + slippageBufferPct;

  // ────────────────────────────────────────────────────────────────────────
  // DIRECTION
  // Swap the surplus token to cover the larger shortfall. When only one side
  // is short, that side trivially wins (the other shortfall is zero, so its
  // USD value is zero). When both are short — only possible when total value
  // is sufficient (we passed the pre-flight) — pick the larger one in USD.
  // ────────────────────────────────────────────────────────────────────────
  const solShortfallUsd = solShortfall * currentPrice;

  if (usdcShortfall >= solShortfallUsd) {
    // Need more USDC — swap SOL → USDC.
    const expectedOutput = usdcShortfall;
    const amount = (usdcShortfall / currentPrice) * bufferMultiplier;

    if (availableSolForSwap < amount) {
      throw new Error(
        `Insufficient SOL for ${context} swap. Need ${amount.toFixed(4)} SOL ` +
        `to swap for ${expectedOutput.toFixed(2)} USDC, but only have ${availableSolForSwap.toFixed(4)} SOL ` +
        `available (after ${totalReserve.toFixed(2)} SOL reserves: ${permanentMinimumSol} permanent + ${rentReserveSol} rent). ` +
        `Wallet: ${walletSol.toFixed(4)} SOL, ${walletUsdc.toFixed(2)} USDC. ` +
        `${formatTunableHint(autoTuneDepositAmount, 'SOL')}`
      );
    }

    return {
      needed: true,
      availableSolForSwap,
      shortfall: { sol: solShortfall, usdc: usdcShortfall },
      swap: {
        direction: 'SOL_TO_USDC',
        inputMint: SOL_MINT,
        outputMint: USDC_MINT,
        amount,
        expectedOutput,
      },
    };
  }

  // Need more SOL — swap USDC → SOL.
  const expectedOutput = solShortfall;
  const amount = solShortfall * currentPrice * bufferMultiplier;

  if (walletUsdc < amount) {
    throw new Error(
      `Insufficient USDC for ${context} swap. Need ${amount.toFixed(2)} USDC ` +
      `to swap for ${expectedOutput.toFixed(4)} SOL, but only have ${walletUsdc.toFixed(2)} USDC. ` +
      `Wallet: ${walletSol.toFixed(4)} SOL, ${walletUsdc.toFixed(2)} USDC. ` +
      `${formatTunableHint(autoTuneDepositAmount, 'USDC')}`
    );
  }

  return {
    needed: true,
    availableSolForSwap,
    shortfall: { sol: solShortfall, usdc: usdcShortfall },
    swap: {
      direction: 'USDC_TO_SOL',
      inputMint: USDC_MINT,
      outputMint: SOL_MINT,
      amount,
      expectedOutput,
    },
  };
}

function formatTunableHint(autoTuneDepositAmount: number | undefined, missing: string): string {
  if (autoTuneDepositAmount === undefined) {
    return `Deposit more ${missing}.`;
  }
  return `Reduce AUTO_TUNE_DEPOSIT_AMOUNT (currently ${autoTuneDepositAmount}) or deposit more ${missing}.`;
}

// ────────────────────────────────────────────────────────────────────────────
// Oracle gate (ADR-020, borrowed from Kamino's creator-vault rebalancing):
// a rebalance swap executes ONLY when the quoted execution price agrees with
// the cross-validated oracle fair price. A quote outside the tolerance —
// stale route, thin liquidity, or a manipulated pool — is refused; the
// rebalance retries on a later cycle instead of eating the bad price.
// ────────────────────────────────────────────────────────────────────────────

export interface SwapOracleGateInput {
  direction: 'SOL_TO_USDC' | 'USDC_TO_SOL';
  /** Human-unit input amount (SOL for SOL_TO_USDC, USDC for USDC_TO_SOL). */
  inputAmount: number;
  /** Human-unit quoted output amount from the order. */
  outputAmount: number;
  /** Fair SOL/USD price from the cross-validated oracle. */
  oraclePriceUsd: number;
  /** Max |implied − oracle| deviation in bps; the quote's implied price
   * already includes DEX fees + impact, so leave room for normal spread. */
  toleranceBps: number;
}

export interface SwapOracleGateResult {
  ok: boolean;
  /** SOL/USD price implied by the quote. */
  impliedPriceUsd: number;
  /** Absolute deviation from oracle, in bps. */
  deviationBps: number;
}

export function checkSwapOracleGate(input: SwapOracleGateInput): SwapOracleGateResult {
  const { direction, inputAmount, outputAmount, oraclePriceUsd, toleranceBps } = input;
  if (!(inputAmount > 0) || !(outputAmount > 0) || !(oraclePriceUsd > 0)) {
    // Not evaluable — treat as failing so callers never trade on garbage.
    return { ok: false, impliedPriceUsd: NaN, deviationBps: Infinity };
  }
  const impliedPriceUsd =
    direction === 'SOL_TO_USDC'
      ? outputAmount / inputAmount // USDC received per SOL sold
      : inputAmount / outputAmount; // USDC paid per SOL bought
  const deviationBps = (Math.abs(impliedPriceUsd - oraclePriceUsd) / oraclePriceUsd) * 10_000;
  return { ok: deviationBps <= toleranceBps, impliedPriceUsd, deviationBps };
}
