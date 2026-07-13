/**
 * Table-driven tests for the re-entry gate (BACKLOG A15).
 *
 * Corridor in these tests: anchor 80, tolPriceFrac 0.003 (= 0.15 × a 2%
 * range width) → calm corridor 79.76–80.24. Confirm window 120 min.
 */

import { describe, it, expect } from 'vitest';
import { evaluateReentryGate, type ReentryGateInput } from './reentryGate.js';

const MIN = 60_000;

function makeInput(overrides: Partial<ReentryGateInput> = {}): ReentryGateInput {
  return {
    nowMs: 1_000_000,
    price: 80,
    anchorPrice: 80,
    stableSinceMs: 1_000_000 - 60 * MIN, // held for 60 min
    tolPriceFrac: 0.003,
    confirmMs: 120 * MIN,
    stormActive: false,
    ...overrides,
  };
}

describe('evaluateReentryGate', () => {
  it('holds while the calm window has not elapsed', () => {
    expect(evaluateReentryGate(makeInput())).toEqual({ action: 'hold' });
  });

  it('opens once the price has been calm for the full window', () => {
    expect(
      evaluateReentryGate(makeInput({ stableSinceMs: 1_000_000 - 120 * MIN }))
    ).toEqual({ action: 'open' });
  });

  it('opens exactly at the boundary (>=, not >)', () => {
    const since = 1_000_000 - 120 * MIN;
    expect(evaluateReentryGate(makeInput({ stableSinceMs: since }))).toEqual({
      action: 'open',
    });
    expect(
      evaluateReentryGate(makeInput({ stableSinceMs: since + 1 }))
    ).toEqual({ action: 'hold' });
  });

  it('re-arms on an upward breakout, anchoring at the new price', () => {
    const d = evaluateReentryGate(makeInput({ price: 80.5 }));
    expect(d).toEqual({ action: 'rearm', anchorPrice: 80.5, stableSinceMs: 1_000_000 });
  });

  it('re-arms on a downward breakout', () => {
    const d = evaluateReentryGate(makeInput({ price: 79.5 }));
    expect(d).toEqual({ action: 'rearm', anchorPrice: 79.5, stableSinceMs: 1_000_000 });
  });

  it('stays put just inside the corridor', () => {
    // 80 × 1.003 = 80.24 is the edge; 80.23 is inside.
    expect(evaluateReentryGate(makeInput({ price: 80.23 }))).toEqual({
      action: 'hold',
    });
  });

  it('a storm blocks the open but not the wait', () => {
    expect(
      evaluateReentryGate(
        makeInput({ stableSinceMs: 1_000_000 - 180 * MIN, stormActive: true })
      )
    ).toEqual({ action: 'hold' });
  });

  it('a storm does not block re-arming on breakout', () => {
    const d = evaluateReentryGate(makeInput({ price: 82, stormActive: true }));
    expect(d).toEqual({ action: 'rearm', anchorPrice: 82, stableSinceMs: 1_000_000 });
  });

  it('confirmMs 0 opens immediately (feature off / rollback mid-wait)', () => {
    expect(
      evaluateReentryGate(makeInput({ confirmMs: 0, stableSinceMs: 1_000_000 }))
    ).toEqual({ action: 'open' });
  });

  it('never opens or re-arms on a garbage price', () => {
    for (const price of [NaN, 0, -5, Infinity]) {
      expect(
        evaluateReentryGate(
          makeInput({ price, stableSinceMs: 1_000_000 - 500 * MIN })
        )
      ).toEqual({ action: 'hold' });
    }
  });

  it('never opens with a garbage anchor', () => {
    expect(
      evaluateReentryGate(
        makeInput({ anchorPrice: NaN, stableSinceMs: 1_000_000 - 500 * MIN })
      )
    ).toEqual({ action: 'hold' });
  });
});
