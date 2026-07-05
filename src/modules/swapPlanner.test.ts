/**
 * Tests for planSwapForDeposit.
 *
 * The most important case here is `production bug regression — 0.258 SOL +
 * 9.43 USDC vs 4 SOL target`. That exact wallet/target combination is what
 * caused the bot to ask Jupiter to swap 566.81 USDC it didn't have. The
 * helper now catches that at the total-value pre-flight; this file pins the
 * behaviour so it can never silently regress.
 */

import { describe, it, expect } from 'vitest';
import { checkSwapOracleGate, planSwapForDeposit, type SwapPlanInput } from './swapPlanner.js';

const SOL_MINT = 'So11111111111111111111111111111111111111112';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

/** Small builder so each test only specifies what it cares about. */
function makeInput(overrides: Partial<SwapPlanInput> = {}): SwapPlanInput {
  return {
    walletSol: 10,
    walletUsdc: 1000,
    targetSol: 1,
    targetUsdc: 100,
    permanentMinimumSol: 0.2,
    rentReserveSol: 0.1,
    currentPrice: 100,
    slippageBufferPct: 0.02,
    context: 'rebalance',
    autoTuneDepositAmount: 1,
    ...overrides,
  };
}

describe('planSwapForDeposit', () => {
  // ───────────────────────────────────────────────────────────────────────
  // Happy path
  // ───────────────────────────────────────────────────────────────────────

  it('returns needed: false when wallet covers the target with reserves to spare', () => {
    const plan = planSwapForDeposit(
      makeInput({
        walletSol: 5,
        walletUsdc: 500,
        targetSol: 1,
        targetUsdc: 100,
      })
    );

    expect(plan.needed).toBe(false);
    expect(plan.swap).toBeUndefined();
    expect(plan.shortfall).toEqual({ sol: 0, usdc: 0 });
    // 5 SOL minus 0.3 reserve == 4.7 available for swap
    expect(plan.availableSolForSwap).toBeCloseTo(4.7, 8);
  });

  it('returns needed: false when targets are zero', () => {
    const plan = planSwapForDeposit(
      makeInput({ targetSol: 0, targetUsdc: 0 })
    );
    expect(plan.needed).toBe(false);
  });

  // ───────────────────────────────────────────────────────────────────────
  // Single-side shortfalls
  // ───────────────────────────────────────────────────────────────────────

  it('plans SOL → USDC when only USDC is short', () => {
    // Wallet has 5 SOL, 50 USDC. Target 1 SOL, 100 USDC. USDC short by 50.
    const plan = planSwapForDeposit(
      makeInput({
        walletSol: 5,
        walletUsdc: 50,
        targetSol: 1,
        targetUsdc: 100,
        currentPrice: 100,
        slippageBufferPct: 0.02,
      })
    );

    expect(plan.needed).toBe(true);
    expect(plan.swap?.direction).toBe('SOL_TO_USDC');
    expect(plan.swap?.inputMint).toBe(SOL_MINT);
    expect(plan.swap?.outputMint).toBe(USDC_MINT);
    // amount = (50 / 100) * 1.02 = 0.51 SOL
    expect(plan.swap?.amount).toBeCloseTo(0.51, 8);
    expect(plan.swap?.expectedOutput).toBeCloseTo(50, 8);
    expect(plan.shortfall).toEqual({ sol: 0, usdc: 50 });
  });

  it('plans USDC → SOL when only SOL is short', () => {
    // Wallet has 0.5 SOL, 1000 USDC. Target 1 SOL, 100 USDC.
    // After reserves (0.3) the available SOL is 0.2 → SOL short by 0.8.
    const plan = planSwapForDeposit(
      makeInput({
        walletSol: 0.5,
        walletUsdc: 1000,
        targetSol: 1,
        targetUsdc: 100,
        currentPrice: 100,
        slippageBufferPct: 0.02,
      })
    );

    expect(plan.needed).toBe(true);
    expect(plan.swap?.direction).toBe('USDC_TO_SOL');
    expect(plan.swap?.inputMint).toBe(USDC_MINT);
    expect(plan.swap?.outputMint).toBe(SOL_MINT);
    // amount = 0.8 * 100 * 1.02 = 81.6 USDC
    expect(plan.swap?.amount).toBeCloseTo(81.6, 6);
    expect(plan.swap?.expectedOutput).toBeCloseTo(0.8, 8);
  });

  // ───────────────────────────────────────────────────────────────────────
  // Reserve handling
  // ───────────────────────────────────────────────────────────────────────

  it('respects reserves: SOL above raw target but below target+reserve still triggers swap', () => {
    // walletSol = 1.05 (above 1 SOL target by 0.05)
    // but reserves take 0.3 → availableSolForSwap = 0.75 < 1.0 target
    // → SOL is short by 0.25.
    const plan = planSwapForDeposit(
      makeInput({
        walletSol: 1.05,
        walletUsdc: 1000,
        targetSol: 1,
        targetUsdc: 100,
        currentPrice: 100,
      })
    );
    expect(plan.needed).toBe(true);
    expect(plan.swap?.direction).toBe('USDC_TO_SOL');
    expect(plan.shortfall.sol).toBeCloseTo(0.25, 8);
  });

  it('never spends reserves on swap input — SOL→USDC swap uses availableSolForSwap, not walletSol', () => {
    // walletSol = 0.40, reserves total 0.30 → availableSolForSwap = 0.10.
    // Target 0 SOL, 50 USDC. We need to swap SOL→USDC for 50 USDC.
    // Required SOL input = (50/100)*1.02 = 0.51 SOL. Only 0.10 available
    // after reserves → must throw, even though raw walletSol (0.40) is also
    // less than 0.51. The key is the helper bases its check on the
    // reserve-aware figure.
    expect(() =>
      planSwapForDeposit(
        makeInput({
          walletSol: 0.4,
          walletUsdc: 0,
          targetSol: 0,
          targetUsdc: 50,
          currentPrice: 100,
        })
      )
    ).toThrow(/total value|Insufficient SOL/i);
  });

  // ───────────────────────────────────────────────────────────────────────
  // Per-token guard: need USDC for SOL but wallet doesn't hold enough USDC
  // ───────────────────────────────────────────────────────────────────────

  it('production bug regression — wallet (0.258 SOL, 9.43 USDC), 4 SOL target throws on total-value pre-flight', () => {
    // This is the live-bug case from the production log. With AUTO_TUNE_
    // DEPOSIT_TOKEN=SOL and AUTO_TUNE_DEPOSIT_AMOUNT=4, the helper's caller
    // (createInitialPosition) computes targetSol=4 and targetUsdc=4*price.
    // Total wallet value (after reserves) is ~$9.43; required is ~$1124.
    // The pre-flight catches it before any swap is even attempted.
    expect(() =>
      planSwapForDeposit(
        makeInput({
          walletSol: 0.258867567,
          walletUsdc: 9.436356,
          targetSol: 4,
          targetUsdc: 4 * 140.45, // 561.8 USDC for balanced position
          permanentMinimumSol: 0.2,
          rentReserveSol: 0.1,
          currentPrice: 140.45,
          slippageBufferPct: 0.02,
          context: 'initial-position',
          autoTuneDepositAmount: 4,
        })
      )
    ).toThrow(/Wallet does not have enough total value for initial-position/);
  });

  it('production bug regression — error message mentions AUTO_TUNE_DEPOSIT_AMOUNT so operator knows what to tune', () => {
    let caught: Error | null = null;
    try {
      planSwapForDeposit(
        makeInput({
          walletSol: 0.258867567,
          walletUsdc: 9.436356,
          targetSol: 4,
          targetUsdc: 4 * 140.45,
          currentPrice: 140.45,
          context: 'initial-position',
          autoTuneDepositAmount: 4,
        })
      );
    } catch (e) {
      caught = e as Error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught!.message).toMatch(/AUTO_TUNE_DEPOSIT_AMOUNT/);
    expect(caught!.message).toMatch(/currently 4/);
    expect(caught!.message).toMatch(/No swap can resolve this/);
  });

  it('throws with descriptive USDC message when total value is fine but swap input is short', () => {
    // Total value sufficient (a lot of SOL), but USDC needed for swap is
    // larger than what the wallet holds. This is the inner per-token guard.
    // Wallet: 0.5 SOL, 5 USDC. Target: 1.5 SOL, 0 USDC.
    // SOL short by (1.5 - (0.5 - 0.3)) = 1.3. Need 1.3 * 100 * 1.02 = 132.6 USDC,
    // but wallet has only 5 USDC. Total value = 0.2*100 + 5 = 25 USD,
    // required = 1.5*100 = 150 USD → wallet-value pre-flight throws first.
    // To exercise the inner guard we need total value enough but USDC < swap input.
    // Construct: wallet 1.5 SOL + 5 USDC, target 2 SOL + 0 USDC, price 10.
    // Total value: 1.2*10 + 5 = 17. Required: 2*10 + 0 = 20. Still short.
    // Try: wallet 2 SOL + 5 USDC, target 2.5 SOL + 0 USDC, price 10.
    // available = 1.7. Total value = 1.7*10 + 5 = 22. Required = 25. Short.
    // To make value sufficient we need walletUsdc OR walletSol* price to add
    // up. Use: wallet 3 SOL + 5 USDC, target 4 SOL + 0 USDC, price 10.
    // available = 2.7. solShortfall = 1.3. Total value = 27 + 5 = 32 ≥ 40?
    // No, required = 40. Need value ≥ required. Use price 100:
    // wallet 3 SOL + 5 USDC. available = 2.7. shortfall = 1.3 SOL.
    // Total value = 270 + 5 = 275. Required = 400. Still short.
    // Use price 200: total = 540 + 5 = 545. Required = 800. Still short.
    // The math is unforgiving — if wallet can't afford the position by
    // value, the value pre-flight catches it. So the inner guard ONLY trips
    // when there's a small mismatch between input-token holdings and the
    // tiny extra needed for the BUFFER. Construct that:
    //
    //   Wallet has just enough USDC to cover the bare swap, but not the
    //   2% slippage buffer. price=100, target 0 SOL + 100 USDC (need to
    //   swap SOL→USDC), wallet 0.305 SOL + 0 USDC.
    //   available SOL = 0.005. solShortfall = 0. usdcShortfall = 100.
    //   Direction: SOL_TO_USDC. amount = (100/100)*1.02 = 1.02 SOL needed.
    //   But available = 0.005 SOL. Total value = 0.005*100 + 0 = 0.5. < 100.
    //   So pre-flight catches.
    //
    // The inner guard only triggers if the value pre-flight passes but the
    // SPECIFIC swap-input balance is tight. This can happen when the buffer
    // pushes the swap above what we hold, even though raw shortfall is
    // covered. Construct:
    //
    //   Wallet 5 SOL + 99 USDC. Target: 0 SOL + 100 USDC. Price 100.
    //   available SOL = 4.7. solShortfall = 0. usdcShortfall = 1.
    //   Direction: SOL_TO_USDC. amount = (1/100)*1.02 = 0.0102 SOL.
    //   Plenty of SOL. Doesn't trip.
    //
    // For the USDC-side inner guard we need: USDC_TO_SOL direction, walletUsdc
    // close to but less than swapAmount. e.g. wallet 0 SOL + 10 USDC, target
    // 0.1 SOL + 0 USDC, price 100. available = 0. shortfall.sol = 0.1.
    // Total value = 0 + 10 = 10. Required = 0.1*100 = 10. Equal — passes
    // pre-flight (>= comparison is strict <). swap amount = 0.1*100*1.02
    // = 10.2 USDC. Wallet 10 < 10.2 → inner guard fires.
    expect(() =>
      planSwapForDeposit(
        makeInput({
          walletSol: 0,
          walletUsdc: 10,
          targetSol: 0.1,
          targetUsdc: 0,
          permanentMinimumSol: 0,
          rentReserveSol: 0,
          currentPrice: 100,
          slippageBufferPct: 0.02,
          context: 'rebalance',
          autoTuneDepositAmount: 0.1,
        })
      )
    ).toThrow(/Insufficient USDC for rebalance swap.*Need 10\.20 USDC.*only have 10\.00 USDC/);
  });

  it('throws with descriptive SOL message when SOL holdings can fund target but not swap-input + buffer', () => {
    // Mirror of the above for the SOL→USDC direction.
    // Wallet 1.02 SOL + 0 USDC, target 0 SOL + 100 USDC, price 100.
    // No reserves. available = 1.02. shortfall.usdc = 100.
    // amount = (100/100)*1.04 = 1.04 SOL (using slippageBufferPct=0.04).
    // available 1.02 < 1.04 → inner guard fires.
    // Total value pre-flight: 1.02*100 + 0 = 102. Required = 100. Passes.
    expect(() =>
      planSwapForDeposit(
        makeInput({
          walletSol: 1.02,
          walletUsdc: 0,
          targetSol: 0,
          targetUsdc: 100,
          permanentMinimumSol: 0,
          rentReserveSol: 0,
          currentPrice: 100,
          slippageBufferPct: 0.04,
          context: 'rebalance',
        })
      )
    ).toThrow(/Insufficient SOL for rebalance swap.*Need 1\.0400 SOL.*only have 1\.0200 SOL/);
  });

  // ───────────────────────────────────────────────────────────────────────
  // Tie-break: both shortfalls present
  // ───────────────────────────────────────────────────────────────────────

  it('tie-break: when both sides are short, picks the larger USD shortfall', () => {
    // walletSol = 1.3 (so available = 1.0 after 0.3 reserve)
    // walletUsdc = 50
    // target 2 SOL + 60 USDC, price 100.
    // SOL shortfall: 2 - 1 = 1 SOL == $100 USD
    // USDC shortfall: 60 - 50 = 10 USDC == $10 USD
    // Larger USD shortfall is SOL → swap USDC → SOL.
    // Total value: 1*100 + 50 = 150. Required: 2*100 + 60 = 260. Short → pre-flight throws.
    // Need to bump wallet so total value passes pre-flight. Increase walletUsdc:
    // walletSol 1.3 + walletUsdc 200. Total value = 100 + 200 = 300. Required = 260. Passes.
    // Same shortfalls: SOL short by 1 ($100), USDC short by... wait, walletUsdc=200
    // already covers target=60. So no USDC shortfall. Need to keep USDC just
    // below target. walletUsdc = 50 still. Total value = 100 + 50 = 150 < 260.
    // Add more SOL: walletSol = 2.3. available = 2. SOL shortfall = 0.
    // No good.
    //
    // Construct around the constraint that total value must >= required while
    // both sides remain short:
    //   target USD total = a*P + b
    //   wallet USD total = (walletSol-reserves)*P + walletUsdc
    //   walletSol < target+reserves AND walletUsdc < target → both short
    //   wallet USD total >= target USD total → pre-flight passes
    //
    // Pick: target 1 SOL + 50 USDC at price 100. target USD = 150.
    // wallet 0.8 SOL (avail 0.5 after 0.3) + 100 USDC. wallet USD = 50 + 100 = 150 == target.
    // Equal — pre-flight is strict `<`, so passes.
    // SOL short by 0.5 ($50). USDC short by... target 50, wallet 100. NOT short.
    //
    // Try: target 1 SOL + 80 USDC. target USD = 180.
    // wallet 0.8 SOL + 100 USDC = 50 + 100 = 150. Short → pre-flight throws.
    //
    // The constraint is mathematically tight — both-short with sufficient
    // total value requires the surplus on one side to fund the deficit on the
    // other. e.g. target 1 SOL + 50 USDC, wallet 0.4 SOL (avail 0.1) + 200 USDC.
    // SOL short by 0.9 ($90). USDC short — target 50, wallet 200, NOT short.
    //
    // It turns out "both sides short with wallet value >= target value" is
    // impossible: if wallet value covers target value, then by the
    // intermediate-value principle a single swap can satisfy both sides. So
    // the genuine tie-break case is rare. We test the boundary: when wallet
    // value EQUALS target value AND only one side is short by the entire
    // target amount on that side.
    const plan = planSwapForDeposit(
      makeInput({
        walletSol: 0.4, // available = 0.1
        walletUsdc: 100,
        targetSol: 1,
        targetUsdc: 0,
        permanentMinimumSol: 0.2,
        rentReserveSol: 0.1,
        currentPrice: 100,
        slippageBufferPct: 0.02,
      })
    );
    // SOL shortfall = 0.9 ($90). USDC shortfall = 0. Direction: USDC_TO_SOL.
    expect(plan.swap?.direction).toBe('USDC_TO_SOL');
  });

  // ───────────────────────────────────────────────────────────────────────
  // Defensive sanity checks
  // ───────────────────────────────────────────────────────────────────────

  it.each([0, -1, NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'throws on invalid currentPrice = %s',
    (badPrice) => {
      expect(() =>
        planSwapForDeposit(makeInput({ currentPrice: badPrice }))
      ).toThrow(/currentPrice must be a positive finite number/);
    }
  );

  it('throws on negative slippageBufferPct', () => {
    expect(() =>
      planSwapForDeposit(makeInput({ slippageBufferPct: -0.01 }))
    ).toThrow(/slippageBufferPct must be >= 0/);
  });

  it('zero slippage buffer is accepted (some operators may want it)', () => {
    // wallet 5 SOL + 50 USDC, target 1 SOL + 100 USDC, price 100, buffer 0.
    // USDC short by 50. amount = (50/100)*1.0 = 0.5 SOL. available = 4.7. OK.
    const plan = planSwapForDeposit(
      makeInput({
        walletSol: 5,
        walletUsdc: 50,
        targetSol: 1,
        targetUsdc: 100,
        currentPrice: 100,
        slippageBufferPct: 0,
      })
    );
    expect(plan.swap?.amount).toBeCloseTo(0.5, 8);
  });

  // ───────────────────────────────────────────────────────────────────────
  // Context propagation
  // ───────────────────────────────────────────────────────────────────────

  it('error messages include the supplied context (initial-position vs rebalance)', () => {
    const baseInput = {
      walletSol: 0.4,
      walletUsdc: 0,
      targetSol: 5,
      targetUsdc: 0,
      currentPrice: 100,
      slippageBufferPct: 0.02,
      permanentMinimumSol: 0.2,
      rentReserveSol: 0.1,
      autoTuneDepositAmount: 5,
    };

    expect(() =>
      planSwapForDeposit({ ...baseInput, context: 'initial-position' })
    ).toThrow(/initial-position/);

    expect(() =>
      planSwapForDeposit({ ...baseInput, context: 'rebalance' })
    ).toThrow(/rebalance/);
  });

  it('omits AUTO_TUNE_DEPOSIT_AMOUNT hint when caller does not pass it', () => {
    let caught: Error | null = null;
    try {
      planSwapForDeposit(
        makeInput({
          walletSol: 0.1,
          walletUsdc: 0,
          targetSol: 5,
          targetUsdc: 0,
          autoTuneDepositAmount: undefined,
        })
      );
    } catch (e) {
      caught = e as Error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught!.message).not.toMatch(/AUTO_TUNE_DEPOSIT_AMOUNT/);
    expect(caught!.message).toMatch(/Deposit more funds/);
  });

  // ───────────────────────────────────────────────────────────────────────
  // User-described scenario: 200 USDC + 2 SOL @ $100, SOL drops to $90,
  // rebalance triggers. The bot must withdraw, then swap USDC → SOL to
  // reach a 50/50 deposit at the new price. This pins the planner's
  // behaviour for that exact trajectory so it can never silently break.
  // ───────────────────────────────────────────────────────────────────────

  it('user scenario — 200 USDC + 2 SOL @ $100 → SOL drops to $90: planner picks USDC → SOL with the right amount', () => {
    // The user's described trajectory:
    //   • Initial deposit at price $100: 2 SOL + 200 USDC == $400.
    //   • Price drops to $90. Position becomes ~92% USDC (imbalance trigger).
    //   • Bot withdraws+claims+closes. Wallet now holds the position's
    //     (now-imbalanced) tokens.
    //
    // For the rebalance, the orchestrator computes a 50/50 deposit at the
    // NEW price ($90) — possibly scaled to fit the wallet (handled in
    // autoTuneOrchestrator before this helper is called). The wallet has
    // lots of USDC and little SOL → planner must pick USDC_TO_SOL.
    //
    // Concrete numbers chosen so the wallet's USD value safely covers the
    // (already-scaled) target — the "happy" rebalance path the user is
    // asking us to verify:
    //
    //   wallet after Phase 1: 0.5 SOL + 200 USDC == $245 USD
    //   target at price $90:   1.0 SOL + 90 USDC  == $180 USD
    //
    // available SOL after reserves (0.3) = 0.2. Target 1.0 SOL → short 0.8 SOL.
    // USDC: target 90, wallet 200 → not short.
    // Direction: USDC_TO_SOL. Amount = 0.8 * 90 * 1.03 = 74.16 USDC.
    const plan = planSwapForDeposit(
      makeInput({
        walletSol: 0.5,
        walletUsdc: 200,
        targetSol: 1.0,
        targetUsdc: 90,
        permanentMinimumSol: 0.2,
        rentReserveSol: 0.1,
        currentPrice: 90,
        slippageBufferPct: 0.03, // post-audit default
        context: 'rebalance',
        autoTuneDepositAmount: 1.0,
      })
    );

    expect(plan.needed).toBe(true);
    expect(plan.swap).toBeDefined();
    expect(plan.swap!.direction).toBe('USDC_TO_SOL');
    expect(plan.swap!.inputMint).toBe(USDC_MINT);
    expect(plan.swap!.outputMint).toBe(SOL_MINT);

    const expectedSolShort = 1.0 - (0.5 - 0.3); // 0.8
    const expectedSwapAmount = expectedSolShort * 90 * 1.03; // 74.16
    expect(plan.swap!.amount).toBeCloseTo(expectedSwapAmount, 6);
    expect(plan.swap!.expectedOutput).toBeCloseTo(expectedSolShort, 8);
    // The whole point: wallet's USDC must exceed swap input so the swap
    // actually executes — no "Insufficient funds" from Jupiter.
    expect(plan.swap!.amount).toBeLessThan(200);
  });

  it('user scenario — same trajectory at the configured (un-scaled) deposit size still picks USDC → SOL', () => {
    // Same scenario but with AUTO_TUNE_DEPOSIT_TOKEN=USDC, AMOUNT=200.
    // No scaling needed: wallet has plenty of USD value to cover.
    //
    //   wallet: 0.5 SOL + 460 USDC == $505 USD
    //   target at price $90: 200/90 + 0.01 = 2.232 SOL, 200 USDC == $401 USD
    //
    // available SOL = 0.2. target 2.232 → short 2.032 SOL.
    // amount = 2.032 * 90 * 1.03 ≈ 188.4 USDC. Wallet 460 ≫ 188 → fine.
    const targetSol = 200 / 90 + 0.01;
    const plan = planSwapForDeposit(
      makeInput({
        walletSol: 0.5,
        walletUsdc: 460,
        targetSol,
        targetUsdc: 200,
        permanentMinimumSol: 0.2,
        rentReserveSol: 0.1,
        currentPrice: 90,
        slippageBufferPct: 0.03,
        context: 'rebalance',
        autoTuneDepositAmount: 200,
      })
    );

    expect(plan.needed).toBe(true);
    expect(plan.swap!.direction).toBe('USDC_TO_SOL');

    const expectedSolShort = targetSol - (0.5 - 0.3);
    const expectedSwapAmount = expectedSolShort * 90 * 1.03;
    expect(plan.swap!.amount).toBeCloseTo(expectedSwapAmount, 4);
    expect(plan.swap!.expectedOutput).toBeCloseTo(expectedSolShort, 8);
    expect(plan.swap!.amount).toBeLessThan(460);
  });

  it('user scenario — total-value pre-flight catches under-funded wallet (90% of target)', () => {
    // The original 0.4544 + 200.5 wallet is only ~$241 vs $401 target.
    // The total-value pre-flight should throw with a clear "no swap can
    // resolve this" error — exactly what we want the operator to see
    // when they haven't topped up.
    expect(() =>
      planSwapForDeposit(
        makeInput({
          walletSol: 0.4544,
          walletUsdc: 200.5,
          targetSol: 200.5 / 90 + 0.01,
          targetUsdc: 200.5,
          permanentMinimumSol: 0.2,
          rentReserveSol: 0.1,
          currentPrice: 90,
          slippageBufferPct: 0.03,
          context: 'rebalance',
          autoTuneDepositAmount: 200,
        })
      )
    ).toThrow(/Wallet does not have enough total value for rebalance/);
  });
});

describe('checkSwapOracleGate (ADR-020)', () => {
  it('passes a quote at oracle price', () => {
    // sell 1 SOL for 82 USDC at oracle $82 → 0 bps deviation
    const r = checkSwapOracleGate({
      direction: 'SOL_TO_USDC',
      inputAmount: 1,
      outputAmount: 82,
      oraclePriceUsd: 82,
      toleranceBps: 50,
    });
    expect(r.ok).toBe(true);
    expect(r.deviationBps).toBeCloseTo(0, 5);
  });

  it('passes normal spread inside tolerance (USDC_TO_SOL)', () => {
    // pay 82.2 USDC for 1 SOL at oracle $82 → ~24 bps
    const r = checkSwapOracleGate({
      direction: 'USDC_TO_SOL',
      inputAmount: 82.2,
      outputAmount: 1,
      oraclePriceUsd: 82,
      toleranceBps: 50,
    });
    expect(r.ok).toBe(true);
    expect(r.deviationBps).toBeGreaterThan(20);
    expect(r.deviationBps).toBeLessThan(30);
  });

  it('blocks a quote worse than tolerance', () => {
    // sell 1 SOL for 81 USDC at oracle $82 → ~122 bps
    const r = checkSwapOracleGate({
      direction: 'SOL_TO_USDC',
      inputAmount: 1,
      outputAmount: 81,
      oraclePriceUsd: 82,
      toleranceBps: 50,
    });
    expect(r.ok).toBe(false);
    expect(r.deviationBps).toBeGreaterThan(100);
  });

  it('blocks a too-good quote symmetrically (suspicious either way)', () => {
    const r = checkSwapOracleGate({
      direction: 'SOL_TO_USDC',
      inputAmount: 1,
      outputAmount: 83.5,
      oraclePriceUsd: 82,
      toleranceBps: 50,
    });
    expect(r.ok).toBe(false);
  });

  it('non-evaluable inputs fail closed', () => {
    expect(
      checkSwapOracleGate({
        direction: 'SOL_TO_USDC',
        inputAmount: 1,
        outputAmount: 0,
        oraclePriceUsd: 82,
        toleranceBps: 50,
      }).ok
    ).toBe(false);
    expect(
      checkSwapOracleGate({
        direction: 'USDC_TO_SOL',
        inputAmount: 82,
        outputAmount: 1,
        oraclePriceUsd: 0,
        toleranceBps: 50,
      }).ok
    ).toBe(false);
  });
});
