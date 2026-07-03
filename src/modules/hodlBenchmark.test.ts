/**
 * Tests for the campaign-level HODL benchmark math.
 *
 * The verdict this module produces is what decides whether the bot keeps
 * running, so the important cases are the counterfactual valuations under
 * price moves (up/down/flat) and the verdict classification — a sign error
 * here would tell the operator to keep a losing strategy alive (or kill a
 * winning one).
 */

import { describe, it, expect } from 'vitest';
import {
  buildBaseline,
  compareToHodl,
  computeEquityUsd,
  type EquityBreakdown,
  type HodlBaseline,
} from './hodlBenchmark.js';

/** Small builder so each test only specifies what it cares about. */
function makeBreakdown(overrides: Partial<EquityBreakdown> = {}): EquityBreakdown {
  return {
    solPriceUsd: 100,
    walletSol: 1,
    walletWsol: 0.5,
    walletUsdc: 200,
    lpSol: 10,
    lpUsdc: 1000,
    lpClaimableSol: 0.1,
    lpClaimableUsdc: 5,
    perpCollateralUsd: 500,
    perpUnrealizedPnlUsd: 0,
    perpAccruedBorrowFeeUsd: 0,
    ...overrides,
  };
}

function makeBaseline(overrides: Partial<HodlBaseline> = {}): HodlBaseline {
  return {
    capturedAt: '2026-07-01T00:00:00.000Z',
    solPriceUsd: 100,
    solSideAmount: 10,
    usdcSideAmount: 1000,
    totalUsd: 2000,
    source: 'manual',
    ...overrides,
  };
}

describe('computeEquityUsd', () => {
  it('sums SOL-side at price, USDC-side flat, and perp equity', () => {
    // SOL side: 1 + 0.5 + 10 + 0.1 = 11.6 SOL @ $100 = $1160
    // USDC side: 200 + 1000 + 5 = $1205
    // Perp: 500 + 0 − 0 = $500
    expect(computeEquityUsd(makeBreakdown())).toBeCloseTo(1160 + 1205 + 500, 6);
  });

  it('subtracts accrued borrow fees and adds negative price PnL', () => {
    const equity = computeEquityUsd(
      makeBreakdown({ perpUnrealizedPnlUsd: -75, perpAccruedBorrowFeeUsd: 12.5 }),
    );
    expect(equity).toBeCloseTo(1160 + 1205 + 500 - 75 - 12.5, 6);
  });
});

describe('buildBaseline', () => {
  it('books SOL-denominated holdings on the SOL side and perp equity on the USDC side', () => {
    const b = buildBaseline(
      makeBreakdown({ perpUnrealizedPnlUsd: -50, perpAccruedBorrowFeeUsd: 10 }),
      '2026-07-01T00:00:00.000Z',
    );
    expect(b.solSideAmount).toBeCloseTo(11.6, 9);
    expect(b.usdcSideAmount).toBeCloseTo(1205 + 440, 9); // perp equity 500−50−10
    expect(b.totalUsd).toBeCloseTo(11.6 * 100 + 1645, 6);
    expect(b.source).toBe('captured');
    // Baseline total must equal equity — the two must never drift apart.
    expect(b.totalUsd).toBeCloseTo(
      computeEquityUsd(makeBreakdown({ perpUnrealizedPnlUsd: -50, perpAccruedBorrowFeeUsd: 10 })),
      9,
    );
  });
});

describe('compareToHodl — counterfactual valuations', () => {
  // Baseline: $2000 total (10 SOL + $1000) at $100/SOL.
  const nowIso = '2026-07-11T00:00:00.000Z'; // 10 days later

  it('price up 50%: HODL-SOL scales fully, HODL-as-is scales its SOL half, HODL-USDC is flat', () => {
    const cmp = compareToHodl(makeBaseline(), 2500, 150, nowIso);
    expect(cmp.benchmarks[0]).toMatchObject({ name: 'HODL-SOL' });
    expect(cmp.benchmarks[0].valueUsd).toBeCloseTo(3000, 6); // 20 SOL-equivalent * 150
    expect(cmp.benchmarks[1].valueUsd).toBeCloseTo(2000, 6); // flat
    expect(cmp.benchmarks[2].valueUsd).toBeCloseTo(10 * 150 + 1000, 6); // 2500
    expect(cmp.elapsedDays).toBeCloseTo(10, 6);
  });

  it('price down 50%: HODL-SOL halves', () => {
    const cmp = compareToHodl(makeBaseline(), 1500, 50, nowIso);
    expect(cmp.benchmarks[0].valueUsd).toBeCloseTo(1000, 6);
    expect(cmp.benchmarks[2].valueUsd).toBeCloseTo(10 * 50 + 1000, 6); // 1500
  });

  it('flat price: strategy edge over every benchmark is pure earned fees', () => {
    const cmp = compareToHodl(makeBaseline(), 2040, 100, nowIso);
    for (const row of cmp.benchmarks) {
      expect(row.valueUsd).toBeCloseTo(2000, 6);
      expect(row.edgeUsd).toBeCloseTo(40, 6);
      expect(row.edgePct).toBeCloseTo(2, 6);
      // 2% over 10 days → 73% APR
      expect(row.edgeAprPct).toBeCloseTo(73, 6);
    }
    expect(cmp.strategyPnlUsd).toBeCloseTo(40, 6);
    expect(cmp.strategyAprPct).toBeCloseTo(73, 6);
  });
});

describe('compareToHodl — verdicts', () => {
  const nowIso = '2026-07-11T00:00:00.000Z';

  it.each([
    // [strategyUsd, price, expected] — HODL-SOL value = 20*price, HODL-USDC = 2000
    [2600, 120, 'beats-both'], // sol=2400, usdc=2000, strategy above both
    [2100, 120, 'beats-usdc-only'], // sol=2400 wins over strategy
    [1900, 80, 'beats-sol-only'], // sol=1600, usdc=2000: below stables, above sol
    [1500, 80, 'loses-to-both'], // below 1600 and 2000
  ] as const)('equity $%d at $%d/SOL → %s', (strategyUsd, price, expected) => {
    const cmp = compareToHodl(makeBaseline(), strategyUsd, price, nowIso);
    expect(cmp.verdict).toBe(expected);
  });
});

describe('compareToHodl — time guards', () => {
  it('zero elapsed time never divides by zero and marks APR meaningless', () => {
    const cmp = compareToHodl(
      makeBaseline(),
      2100,
      100,
      makeBaseline().capturedAt, // same instant
    );
    expect(cmp.elapsedDays).toBe(0);
    expect(cmp.strategyAprPct).toBe(0);
    expect(cmp.benchmarks.every((b) => b.edgeAprPct === 0)).toBe(true);
    expect(cmp.aprMeaningful).toBe(false);
  });

  it('windows of 3+ days mark APR as meaningful', () => {
    const cmp = compareToHodl(makeBaseline(), 2100, 100, '2026-07-04T00:00:00.000Z');
    expect(cmp.aprMeaningful).toBe(true);
  });
});
