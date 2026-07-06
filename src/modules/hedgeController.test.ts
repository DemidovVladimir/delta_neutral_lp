import { describe, expect, it } from 'vitest';
import { computeAutoNotionalCapUsd, computeLpHedgeDelta, computeLpMidpointSol, decideHedgeAction, type HedgeDecisionInput } from './hedgeController.js';

/**
 * Table-driven tests over the pure hedge decision core (ADR-017).
 * Price is pinned at $100 so USD sizes read directly as SOL × 100.
 */
function baseInput(overrides: Partial<HedgeDecisionInput> = {}): HedgeDecisionInput {
  return {
    lpSol: 0,
    longSol: 0,
    shortSol: 0,
    longNotionalUsd: 0,
    shortNotionalUsd: 0,
    longCollateralUsd: 0,
    shortCollateralUsd: 0,
    carryCostBps: { long: 1200, short: 1200 }, // ~12% APR, under the 50% cap
    oraclePriceUsd: 100,
    walletSol: 10,
    walletReserveSol: 0.3,
    targetDeltaSol: 0,
    bandSol: 0.5,
    carryCapBps: 5000,
    maxHedgeNotionalUsd: 12_000,
    minCollateralRatio: 0.15,
    targetCollateralRatio: 1.0,
    nowMs: 1_000_000,
    lastActionAtMs: null,
    cooldownMs: 120_000,
    ...overrides,
  };
}

describe('decideHedgeAction — band + cooldown gates', () => {
  it('returns blocked when there is no oracle price', () => {
    const d = decideHedgeAction(baseInput({ lpSol: 5, oraclePriceUsd: 0 }));
    expect(d.action).toBe('blocked');
  });

  it('returns blocked on a NaN price', () => {
    const d = decideHedgeAction(baseInput({ lpSol: 5, oraclePriceUsd: NaN }));
    expect(d.action).toBe('blocked');
  });

  it('returns none when |error| is within the band', () => {
    const d = decideHedgeAction(baseInput({ lpSol: 0.4 }));
    expect(d).toEqual({ action: 'none', reason: 'in band' });
  });

  it('returns none exactly at the band edge (<=)', () => {
    const d = decideHedgeAction(baseInput({ lpSol: 0.5 }));
    expect(d.action).toBe('none');
  });

  it('suppresses an out-of-band mutation during the cooldown window', () => {
    const d = decideHedgeAction(
      baseInput({ lpSol: 5, lastActionAtMs: 1_000_000 - 30_000, cooldownMs: 120_000 })
    );
    expect(d.action).toBe('none');
    expect((d as { reason?: string }).reason).toContain('cooldown');
  });

  it('acts again once the cooldown has elapsed', () => {
    const d = decideHedgeAction(
      baseInput({ lpSol: 5, lastActionAtMs: 1_000_000 - 120_001, cooldownMs: 120_000 })
    );
    expect(d.action).toBe('increase_short');
  });

  it('in-band reads report none (not cooldown) even while cooling down', () => {
    const d = decideHedgeAction(baseInput({ lpSol: 0.1, lastActionAtMs: 1_000_000 - 1_000 }));
    expect(d).toEqual({ action: 'none', reason: 'in band' });
  });
});

describe('decideHedgeAction — reduce delta (error > band)', () => {
  it('increases the short when no long is open, sized to the full error', () => {
    const d = decideHedgeAction(baseInput({ lpSol: 5 }));
    expect(d).toEqual({
      action: 'increase_short',
      sizeUsd: 500,
      collateralTokens: 500, // 1× target ratio, USDC
      adjustSol: -5,
    });
  });

  it('sizes short collateral by the target collateral ratio', () => {
    const d = decideHedgeAction(baseInput({ lpSol: 5, targetCollateralRatio: 0.33 }));
    expect(d.action).toBe('increase_short');
    if (d.action === 'increase_short') {
      expect(d.collateralTokens).toBeCloseTo(165, 6); // 500 * 0.33
    }
  });

  it('decreases an open long FIRST instead of opening a short', () => {
    // lp 1 + long 5 = net 6 → error 6; long absorbs 5 of it (full close).
    const d = decideHedgeAction(
      baseInput({ lpSol: 1, longSol: 5, longNotionalUsd: 500, longCollateralUsd: 500 })
    );
    expect(d.action).toBe('decrease_long');
    if (d.action === 'decrease_long') {
      expect(d.entirePosition).toBe(true);
      expect(d.adjustSol).toBe(-5);
      expect(d.withdrawCollateralUsd).toBe(0); // full close returns everything anyway
    }
  });

  it('partially decreases the long when the error is smaller than the long', () => {
    // long 5 vs target 3 → error 2 → shave 2 SOL off the long.
    const d = decideHedgeAction(
      baseInput({ longSol: 5, longNotionalUsd: 500, longCollateralUsd: 500, targetDeltaSol: 3 })
    );
    expect(d.action).toBe('decrease_long');
    if (d.action === 'decrease_long') {
      expect(d.entirePosition).toBe(false);
      expect(d.sizeUsd).toBeCloseTo(200, 6);
      expect(d.withdrawCollateralUsd).toBeCloseTo(200, 6);
      expect(d.adjustSol).toBeCloseTo(-2, 9);
    }
  });

  it('treats a residual within epsilon as a full close', () => {
    const d = decideHedgeAction(
      baseInput({ lpSol: 5 - 1e-12, longSol: 5, longNotionalUsd: 500, targetDeltaSol: 5 })
    );
    // error = (5-1e-12+5) - 5 = 5 - 1e-12 → adjust ≈ longSol within epsilon.
    expect(d.action).toBe('decrease_long');
    if (d.action === 'decrease_long') expect(d.entirePosition).toBe(true);
  });
});

describe('decideHedgeAction — add delta (error < −band)', () => {
  it('decreases an open short FIRST instead of opening a long', () => {
    // lp 1 − short 3 = net −2 → deficit 2 < short 3 → partial decrease.
    const d = decideHedgeAction(
      baseInput({ lpSol: 1, shortSol: 3, shortNotionalUsd: 300, shortCollateralUsd: 300 })
    );
    expect(d.action).toBe('decrease_short');
    if (d.action === 'decrease_short') {
      expect(d.entirePosition).toBe(false);
      expect(d.sizeUsd).toBeCloseTo(200, 6);
      expect(d.adjustSol).toBeCloseTo(2, 9);
    }
  });

  it('fully closes the short when the deficit consumes it', () => {
    const d = decideHedgeAction(baseInput({ shortSol: 2, shortNotionalUsd: 200 }));
    expect(d.action).toBe('decrease_short');
    if (d.action === 'decrease_short') {
      expect(d.entirePosition).toBe(true);
      expect(d.adjustSol).toBeCloseTo(2, 9);
    }
  });

  it('opens a long when flat and the target demands positive delta', () => {
    const d = decideHedgeAction(baseInput({ targetDeltaSol: 5 }));
    expect(d.action).toBe('increase_long');
    if (d.action === 'increase_long') {
      expect(d.sizeUsd).toBeCloseTo(500, 6);
      expect(d.collateralTokens).toBeCloseTo(5, 9); // 500 USD × 1.0 ratio / $100 = 5 SOL
      expect(d.adjustSol).toBeCloseTo(5, 9);
    }
  });

  it('blocks a long increase that would dip into wallet reserves', () => {
    const d = decideHedgeAction(baseInput({ targetDeltaSol: 5, walletSol: 5, walletReserveSol: 0.3 }));
    expect(d.action).toBe('blocked');
    expect((d as { reason: string }).reason).toContain('reserves');
  });
});

describe('decideHedgeAction — increase guards', () => {
  it('blocks a short increase when short carry exceeds the cap', () => {
    const d = decideHedgeAction(baseInput({ lpSol: 5, carryCostBps: { long: 0, short: 6000 } }));
    expect(d.action).toBe('blocked');
    expect((d as { reason: string }).reason).toContain('carry');
  });

  it('uses the LONG side carry for long increases', () => {
    const d = decideHedgeAction(
      baseInput({ targetDeltaSol: 5, carryCostBps: { long: 6000, short: 0 } })
    );
    expect(d.action).toBe('blocked');
    expect((d as { reason: string }).reason).toContain('long carry');
  });

  it('carry cap 0 disables the carry gate', () => {
    const d = decideHedgeAction(
      baseInput({ lpSol: 5, carryCapBps: 0, carryCostBps: { long: 99999, short: 99999 } })
    );
    expect(d.action).toBe('increase_short');
  });

  it('fills the remaining cap headroom instead of blocking outright (BUG-012)', () => {
    // Wants 130 SOL × $100 = $13,000 > $12,000 cap → takes the $12,000 headroom.
    const d = decideHedgeAction(baseInput({ lpSol: 130 }));
    expect(d.action).toBe('increase_short');
    if (d.action === 'increase_short') {
      expect(d.sizeUsd).toBeCloseTo(12_000, 6);
      expect(d.adjustSol).toBeCloseTo(-120, 9);
      expect(d.collateralTokens).toBeCloseTo(12_000, 6); // ratio 1.0, USDC
    }
  });

  it('blocks when the cap headroom is below the minimum viable increase', () => {
    // Short already $11,995 → headroom $5 < $10 minimum.
    const d = decideHedgeAction(
      baseInput({ lpSol: 130, shortSol: 119.95, shortNotionalUsd: 11_995, shortCollateralUsd: 11_995 })
    );
    expect(d.action).toBe('blocked');
    expect((d as { reason: string }).reason).toContain('headroom');
  });

  it('blocks when the projected collateral ratio would sink below the floor', () => {
    const d = decideHedgeAction(baseInput({ lpSol: 5, targetCollateralRatio: 0.1 }));
    expect(d.action).toBe('blocked');
    expect((d as { reason: string }).reason).toContain('collateral ratio');
  });

  it('never blocks a decrease on carry (risk-reducing)', () => {
    const d = decideHedgeAction(
      baseInput({
        shortSol: 2,
        shortNotionalUsd: 200,
        carryCostBps: { long: 99999, short: 99999 },
      })
    );
    expect(d.action).toBe('decrease_short');
  });
});

describe('decideHedgeAction — anomaly: both sides open', () => {
  it('reduces the opposing side first (decrease-first invariant)', () => {
    // long 2, short 1, lp 0 → net +1 → error 1 > band → decrease the long.
    const d = decideHedgeAction(
      baseInput({ longSol: 2, shortSol: 1, longNotionalUsd: 200, shortNotionalUsd: 100 })
    );
    expect(d.action).toBe('decrease_long');
  });
});

describe('computeLpMidpointSol (ADR-019)', () => {
  it('freshly centered position → midpoint equals the SOL deposit', () => {
    // 0.61 SOL + 50.03 USDC at $82 ≈ 0.61 both sides
    expect(computeLpMidpointSol(0.61, 50.02, 82)).toBeCloseTo(0.61, 2);
  });

  it('stays ~constant as composition swings across the range', () => {
    const atBottom = computeLpMidpointSol(1.22, 0, 82); // all SOL
    const atTop = computeLpMidpointSol(0, 100.04, 82); // all USDC
    expect(atBottom).toBeCloseTo(0.61, 2);
    expect(atTop).toBeCloseTo(0.61, 2);
  });

  it('empty exposure → 0 (leftover perp unwinds like in live mode)', () => {
    expect(computeLpMidpointSol(0, 0, 82)).toBe(0);
  });

  it('non-positive price falls back to the live SOL amount', () => {
    expect(computeLpMidpointSol(0.7, 50, 0)).toBe(0.7);
    expect(computeLpMidpointSol(0.7, 50, NaN)).toBe(0.7);
  });
});

describe('computeLpHedgeDelta (ADR-021, HOLE-2 + storm mode)', () => {
  it('in range → midpoint approximation', () => {
    const r = computeLpHedgeDelta(0.61, 50.02, 82);
    expect(r.regime).toBe('in');
    expect(r.deltaSol).toBeCloseTo(0.61, 2);
  });

  it('out of range below (pure SOL bag) → FULL SOL amount', () => {
    const r = computeLpHedgeDelta(1.22, 0, 82);
    expect(r.regime).toBe('below');
    expect(r.deltaSol).toBeCloseTo(1.22, 9);
  });

  it('out of range above (pure USDC) → zero delta', () => {
    const r = computeLpHedgeDelta(0, 100.04, 82);
    expect(r.regime).toBe('above');
    expect(r.deltaSol).toBe(0);
  });

  it('hysteresis: stays clamped below until composition falls under 90%', () => {
    // 94% SOL: not enough to ENTER the clamp fresh...
    expect(computeLpHedgeDelta(1.15, 6, 82, 'in').regime).toBe('in');
    // ...but keeps an existing clamp (exit threshold is 90%)
    expect(computeLpHedgeDelta(1.15, 6, 82, 'below').regime).toBe('below');
    // 85% SOL releases it
    expect(computeLpHedgeDelta(1.0, 14.5, 82, 'below').regime).toBe('in');
  });

  it('empty exposure → 0; bad price falls back to live amount', () => {
    expect(computeLpHedgeDelta(0, 0, 82).deltaSol).toBe(0);
    expect(computeLpHedgeDelta(0.7, 50, 0).deltaSol).toBe(0.7);
  });
});

describe('computeAutoNotionalCapUsd (ADR-022)', () => {
  it('derives the cap from the bag: mult × bagSol × price', () => {
    // The BUG-012 night: bag 2.63 SOL @ $80.5 → auto cap ≈ $264.6 (old static 200 pinned it).
    expect(computeAutoNotionalCapUsd(2.63, 80.5, 1.25, 0)).toBeCloseTo(264.64, 1);
  });

  it('an explicit absolute ceiling still wins when lower', () => {
    expect(computeAutoNotionalCapUsd(2.63, 80.5, 1.25, 200)).toBe(200);
    expect(computeAutoNotionalCapUsd(2.63, 80.5, 1.25, 10_000)).toBeCloseTo(264.64, 1);
  });

  it('degenerate bag/price falls back to the ceiling, else 0', () => {
    expect(computeAutoNotionalCapUsd(0, 80.5, 1.25, 500)).toBe(500);
    expect(computeAutoNotionalCapUsd(0, 80.5, 1.25, 0)).toBe(0);
    expect(computeAutoNotionalCapUsd(2.63, NaN, 1.25, 500)).toBe(500);
  });
});
