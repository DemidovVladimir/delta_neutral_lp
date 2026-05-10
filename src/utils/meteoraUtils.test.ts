/**
 * Tests for isWalletBalancedFor5050.
 *
 * The helper is the validation gate that decides whether a rebalance
 * should skip the alignment swap. False here means "wallet is skewed,
 * the swap is mandatory" — which should be the case ~100% of the time
 * after a 92% imbalance trigger fires. True means "wallet is somehow
 * already balanced, log loudly and skip the swap" — should be rare.
 *
 * These tests pin the logic so future edits can't silently move the
 * tolerance band or break reserve handling.
 */

import { describe, it, expect } from 'vitest';
import { isWalletBalancedFor5050 } from './meteoraUtils.js';

describe('isWalletBalancedFor5050', () => {
  // ─────────────────────────────────────────────────────────────────────
  // The common case: 92% imbalance trigger fired → wallet heavily skewed
  // ─────────────────────────────────────────────────────────────────────

  it('returns balanced=false when wallet is heavily USDC-skewed (post-92%-trigger)', () => {
    // Position was 92% USDC at the moment of trigger. After Phase 1, the
    // wallet inherits that mix. Tiny SOL amount remaining vs. lots of USDC.
    //
    //   wallet: 0.05 SOL + 200 USDC at price $90
    //   reserves: 0.3 SOL → available SOL = 0 (drained by reserve)
    //   solUsd = 0, usdcUsd = 200, totalUsd = 200, ratio = 0
    //   ratio 0 is way below 0.5 - 0.10 = 0.4 → NOT balanced (mandate swap).
    const result = isWalletBalancedFor5050(0.05, 200, 90, 0.3);
    expect(result.balanced).toBe(false);
    expect(result.walletSolRatio).toBe(0);
    expect(result.walletTotalUsd).toBeCloseTo(200, 6);
  });

  it('returns balanced=false when wallet is heavily SOL-skewed (mirror case)', () => {
    // Symmetric: trigger fired the other way — pool was 92% SOL.
    //   wallet: 5 SOL + 5 USDC at $90 → avail SOL = 4.7 → solUsd 423 + usdcUsd 5 = 428
    //   ratio ≈ 0.988 → not balanced.
    const result = isWalletBalancedFor5050(5, 5, 90, 0.3);
    expect(result.balanced).toBe(false);
    expect(result.walletSolRatio).toBeGreaterThan(0.9);
  });

  // ─────────────────────────────────────────────────────────────────────
  // The rare/unexpected case: wallet IS already 50/50 — gate fires
  // ─────────────────────────────────────────────────────────────────────

  it('returns balanced=true when wallet is exactly 50/50', () => {
    // wallet: 1 SOL + 90 USDC at $90 → avail SOL = 0.7 → solUsd 63 + usdcUsd 90 = 153
    // Wait — that's 0.41, not 0.5. Let me make it 50/50:
    //   wallet: 1.3 SOL + 90 USDC at $90, reserves 0.3
    //   avail SOL = 1.0 → solUsd 90, usdcUsd 90, total 180, ratio 0.5
    const result = isWalletBalancedFor5050(1.3, 90, 90, 0.3);
    expect(result.balanced).toBe(true);
    expect(result.walletSolRatio).toBeCloseTo(0.5, 6);
  });

  it('returns balanced=true at the lower edge of tolerance (40/60)', () => {
    // ratio exactly 0.40 — should be inclusive (>= 0.4).
    // solUsd / total = 0.4 → solUsd = 40, usdcUsd = 60, totalUsd = 100
    // avail SOL at $100/SOL = 0.4 SOL → wallet = 0.4 + 0.3 reserve = 0.7 SOL
    const result = isWalletBalancedFor5050(0.7, 60, 100, 0.3);
    expect(result.balanced).toBe(true);
    expect(result.walletSolRatio).toBeCloseTo(0.4, 6);
  });

  it('returns balanced=true at the upper edge of tolerance (60/40)', () => {
    // ratio 0.60 — solUsd 60, usdcUsd 40, total 100, price $100
    // avail SOL = 0.6 → wallet = 0.9 SOL
    const result = isWalletBalancedFor5050(0.9, 40, 100, 0.3);
    expect(result.balanced).toBe(true);
    expect(result.walletSolRatio).toBeCloseTo(0.6, 6);
  });

  it('returns balanced=false just past the lower edge (39%)', () => {
    // 39 SOL USD vs 61 USDC → ratio 0.39, just outside 0.4 tolerance
    // avail SOL = 0.39 at $100/SOL → wallet 0.69 SOL + 61 USDC
    const result = isWalletBalancedFor5050(0.69, 61, 100, 0.3);
    expect(result.balanced).toBe(false);
    expect(result.walletSolRatio).toBeCloseTo(0.39, 6);
  });

  it('returns balanced=false just past the upper edge (61%)', () => {
    // 61 SOL USD vs 39 USDC at $100 → avail SOL = 0.61 → wallet = 0.91
    const result = isWalletBalancedFor5050(0.91, 39, 100, 0.3);
    expect(result.balanced).toBe(false);
    expect(result.walletSolRatio).toBeCloseTo(0.61, 6);
  });

  // ─────────────────────────────────────────────────────────────────────
  // Reserve handling
  // ─────────────────────────────────────────────────────────────────────

  it('subtracts reserves from walletSol before computing the ratio', () => {
    // wallet: 0.3 SOL + 100 USDC at $90, reserves 0.3 → avail SOL = 0.
    // Despite 0.3 SOL on hand the ratio is 0 because every drop is reserved.
    // The position cannot use any SOL from this wallet, so the gate must
    // treat it as unbalanced (mandate swap to get USDC → SOL).
    const result = isWalletBalancedFor5050(0.3, 100, 90, 0.3);
    expect(result.balanced).toBe(false);
    expect(result.walletSolRatio).toBe(0);
  });

  it('handles reserves > walletSol without going negative', () => {
    // wallet: 0.1 SOL, reserves 0.3 — already underwater on reserves.
    // available SOL clamps to 0; solUsd = 0; totalUsd = whatever USDC is.
    const result = isWalletBalancedFor5050(0.1, 100, 90, 0.3);
    expect(result.balanced).toBe(false);
    expect(result.walletSolRatio).toBe(0);
    expect(result.walletTotalUsd).toBeCloseTo(100, 6);
  });

  // ─────────────────────────────────────────────────────────────────────
  // Edge cases
  // ─────────────────────────────────────────────────────────────────────

  it('returns balanced=true for an empty wallet so we do not "swap" with nothing', () => {
    // Zero-value wallet — there's nothing to swap. Return balanced=true so
    // the orchestrator skips the swap and lets the planner's pre-flight
    // throw a clear "wallet has no value" error downstream rather than
    // attempt a Jupiter swap with no input tokens.
    const result = isWalletBalancedFor5050(0, 0, 90, 0.3);
    expect(result.balanced).toBe(true);
    expect(result.walletSolRatio).toBe(0.5);
    expect(result.walletTotalUsd).toBe(0);
  });

  it('returns balanced=true when reserves drain wallet to zero value', () => {
    // wallet: 0.3 SOL + 0 USDC, reserves 0.3. avail SOL = 0, no USDC.
    // totalUsd = 0 → empty-wallet branch.
    const result = isWalletBalancedFor5050(0.3, 0, 90, 0.3);
    expect(result.balanced).toBe(true);
    expect(result.walletTotalUsd).toBe(0);
  });

  it('respects a custom toleranceFraction', () => {
    // A tighter tolerance (5%) should reject a 56% ratio that the default
    // 10% would accept.
    const ratioInput = isWalletBalancedFor5050(0.86, 44, 100, 0.3); // ratio 0.56
    expect(ratioInput.walletSolRatio).toBeCloseTo(0.56, 6);

    expect(isWalletBalancedFor5050(0.86, 44, 100, 0.3, 0.10).balanced).toBe(true);
    expect(isWalletBalancedFor5050(0.86, 44, 100, 0.3, 0.05).balanced).toBe(false);
  });
});
