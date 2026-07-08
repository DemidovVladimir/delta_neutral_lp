/**
 * Tests for VitalsLatch («двойной порог»).
 *
 * The contract: one 🚨 per episode, silence inside the fire↔release gap,
 * one ✅ on release, re-armed after. The Jul-7 flapping (metric breathing
 * on the fire line) must produce exactly one fire.
 */
import { describe, it, expect } from 'vitest';
import { VitalsLatch } from './vitalsLatch.js';

function clock(start = 0) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

const THROTTLE = 10 * 60 * 1000;

describe('VitalsLatch', () => {
  it('fires once, stays silent while the metric breathes on the fire line', () => {
    const c = clock();
    const latch = new VitalsLatch(THROTTLE, c.now);
    // churn 441.83 vs 3×cap oscillating 441.65 ↔ 441.82: breached flips,
    // cleared (below 2.7×cap = 397) never true.
    expect(latch.update('churn', true, false)).toBe('fire');
    c.advance(20 * 60 * 1000);
    expect(latch.update('churn', false, false)).toBe(null); // inside the gap
    expect(latch.update('churn', true, false)).toBe(null); // breached again — still latched
    expect(latch.isLatched('churn')).toBe(true);
  });

  it('recovers once when cleared, then re-arms', () => {
    const c = clock();
    const latch = new VitalsLatch(THROTTLE, c.now);
    expect(latch.update('churn', true, false)).toBe('fire');
    c.advance(11 * 60 * 1000);
    expect(latch.update('churn', false, true)).toBe('recover');
    expect(latch.isLatched('churn')).toBe(false);
    expect(latch.update('churn', false, true)).toBe(null); // no repeat recover
    expect(latch.update('churn', true, false)).toBe('fire'); // re-armed
  });

  it('throttle backstops full-gap flip-flopping', () => {
    const c = clock(1_000_000);
    const latch = new VitalsLatch(THROTTLE, c.now);
    expect(latch.update('x', true, false)).toBe('fire');
    c.advance(60_000);
    expect(latch.update('x', false, true)).toBe('recover');
    // Immediately breaches again — inside the 10-min throttle → silent.
    c.advance(60_000);
    expect(latch.update('x', true, false)).toBe(null);
    expect(latch.isLatched('x')).toBe(false); // not latched: fire was suppressed
    c.advance(THROTTLE);
    expect(latch.update('x', true, false)).toBe('fire'); // throttle expired
  });

  it('kinds are independent', () => {
    const c = clock();
    const latch = new VitalsLatch(THROTTLE, c.now);
    expect(latch.update('a', true, false)).toBe('fire');
    expect(latch.update('b', true, false)).toBe('fire');
    expect(latch.update('a', false, true)).toBe('recover');
    expect(latch.isLatched('b')).toBe(true);
  });

  it('never recovers when it never fired', () => {
    const c = clock();
    const latch = new VitalsLatch(THROTTLE, c.now);
    expect(latch.update('a', false, true)).toBe(null);
    expect(latch.update('a', false, false)).toBe(null);
  });
});
