/**
 * Tests for waitForBalanceCredit (BUG-017 read-your-write barrier).
 *
 * The barrier is what stands between «Phase-1 withdraw confirmed» and
 * «plan the alignment swap»: it must not let the planner see a stale
 * pre-withdraw wallet (the 2026-07-07 18:56Z incident bought 0.41 SOL
 * the wallet already held), and it must fail OPEN on a slow node so a
 * rebalance can never brick on RPC lag alone.
 */
import { describe, it, expect } from 'vitest';
import { waitForBalanceCredit, type BalanceReading } from './balanceBarrier.js';

/** Reader that replays a scripted sequence, repeating the last frame. */
function scriptedReader(frames: BalanceReading[]): {
  read: () => Promise<BalanceReading>;
  calls: () => number;
} {
  let i = 0;
  return {
    read: async () => frames[Math.min(i++, frames.length - 1)],
    calls: () => i,
  };
}

/** Fake clock advanced by the fake sleep — no real timers in tests. */
function fakeTime() {
  let t = 0;
  return {
    now: () => t,
    sleep: async (ms: number) => {
      t += ms;
    },
  };
}

const BASE = { preSol: 0.5104, preUsdc: 184.21, minSolDelta: 0.03, timeoutMs: 12_000, pollIntervalMs: 500 };

describe('waitForBalanceCredit', () => {
  it('passes immediately when the credit is already visible', async () => {
    const { now, sleep } = fakeTime();
    const reader = scriptedReader([{ sol: 1.7377, usdc: 184.21 }]);
    const res = await waitForBalanceCredit({
      ...BASE,
      minUsdcDelta: 0,
      readBalances: reader.read,
      now,
      sleep,
    });
    expect(res.confirmed).toBe(true);
    expect(res.sol).toBeCloseTo(1.7377, 9);
    expect(res.attempts).toBe(1);
    expect(res.waitedMs).toBe(0);
  });

  it('polls through stale readings until the credit appears (the 18:56Z incident shape)', async () => {
    const { now, sleep } = fakeTime();
    // Two stale frames (pre-withdraw), then the node catches up.
    const reader = scriptedReader([
      { sol: 0.5104, usdc: 184.21 },
      { sol: 0.5104, usdc: 184.21 },
      { sol: 1.7377, usdc: 184.21 },
    ]);
    const res = await waitForBalanceCredit({
      ...BASE,
      minUsdcDelta: 0,
      readBalances: reader.read,
      now,
      sleep,
    });
    expect(res.confirmed).toBe(true);
    expect(res.attempts).toBe(3);
    expect(res.waitedMs).toBe(1000); // two sleeps of 500ms
    expect(res.sol).toBeCloseTo(1.7377, 9);
  });

  it('fails open on timeout: confirmed=false, returns the freshest reading', async () => {
    const { now, sleep } = fakeTime();
    const reader = scriptedReader([{ sol: 0.5104, usdc: 184.21 }]); // never catches up
    const res = await waitForBalanceCredit({
      ...BASE,
      minUsdcDelta: 0,
      timeoutMs: 2_000,
      readBalances: reader.read,
      now,
      sleep,
    });
    expect(res.confirmed).toBe(false);
    expect(res.sol).toBeCloseTo(0.5104, 9);
    // 2000ms budget / 500ms polls: reads at t=0,500,1000,1500 and one final
    // read exactly at the t=2000 deadline, then stops.
    expect(res.attempts).toBe(5);
  });

  it('requires the USDC leg too when the closed position was USDC-heavy', async () => {
    const { now, sleep } = fakeTime();
    // SOL rent credit shows first (frame 2), USDC principal only later.
    const reader = scriptedReader([
      { sol: 0.5104, usdc: 100.0 },
      { sol: 0.5704, usdc: 100.0 },
      { sol: 0.5704, usdc: 191.2 },
    ]);
    const res = await waitForBalanceCredit({
      preSol: 0.5104,
      preUsdc: 100.0,
      minSolDelta: 0.03,
      minUsdcDelta: 0.5,
      timeoutMs: 12_000,
      pollIntervalMs: 500,
      readBalances: reader.read,
      now,
      sleep,
    });
    expect(res.confirmed).toBe(true);
    expect(res.attempts).toBe(3);
    expect(res.usdc).toBeCloseTo(191.2, 9);
  });

  it('minUsdcDelta <= 0 disables the USDC leg entirely', async () => {
    const { now, sleep } = fakeTime();
    // USDC DROPS (irrelevant flows) — must not block the barrier.
    const reader = scriptedReader([{ sol: 1.7377, usdc: 10.0 }]);
    const res = await waitForBalanceCredit({
      ...BASE,
      minUsdcDelta: 0,
      readBalances: reader.read,
      now,
      sleep,
    });
    expect(res.confirmed).toBe(true);
  });

  it('always reads at least once even with timeoutMs=0', async () => {
    const { now, sleep } = fakeTime();
    const reader = scriptedReader([{ sol: 0.5104, usdc: 184.21 }]);
    const res = await waitForBalanceCredit({
      ...BASE,
      minUsdcDelta: 0,
      timeoutMs: 0,
      readBalances: reader.read,
      now,
      sleep,
    });
    expect(res.attempts).toBe(1);
    expect(res.confirmed).toBe(false);
    expect(res.sol).toBeCloseTo(0.5104, 9);
  });
});
