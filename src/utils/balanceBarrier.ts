/**
 * BUG-017 read-your-write barrier.
 *
 * A transaction can be CONFIRMED while a balance read a fraction of a
 * second later — served by a different node behind a load-balanced RPC —
 * still returns the pre-transaction state. Seen live 2026-07-07 18:56Z:
 * the rebalance swap planner read the wallet 0.28s after the Phase-1
 * withdraw confirmed, got the pre-withdraw balances, concluded
 * «Insufficient SOL» and bought 0.41 SOL the wallet already held.
 *
 * `waitForBalanceCredit` polls the wallet until the expected credit is
 * visible (or a timeout passes, in which case the caller proceeds with
 * the freshest reading and logs the anomaly — fail-open, never brick the
 * rebalance over a slow node).
 *
 * Dependencies (reader, sleep, clock) are injectable for unit tests.
 */

export interface BalanceReading {
  sol: number;
  usdc: number;
}

export interface WaitForCreditOptions {
  /** Wallet balances snapshotted BEFORE the transaction was sent. */
  preSol: number;
  preUsdc: number;
  /**
   * Barrier passes when sol >= preSol + minSolDelta. Closing a Meteora
   * position always returns the position rent (~0.057 SOL) in the same
   * transaction, so a floor well below that (e.g. 0.03) is always
   * reachable regardless of which side the principal was on.
   */
  minSolDelta: number;
  /**
   * Additional leg: usdc >= preUsdc + minUsdcDelta. Set > 0 only when the
   * closed position was USDC-heavy (its principal must show up). 0 or
   * negative disables the leg.
   */
  minUsdcDelta: number;
  timeoutMs: number;
  pollIntervalMs: number;
  readBalances: () => Promise<BalanceReading>;
  /** Injectable for tests; defaults to setTimeout. */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable for tests; defaults to Date.now. */
  now?: () => number;
}

export interface WaitForCreditResult extends BalanceReading {
  /** true = every expected credit became visible before the timeout. */
  confirmed: boolean;
  waitedMs: number;
  attempts: number;
}

export async function waitForBalanceCredit(
  opts: WaitForCreditOptions,
): Promise<WaitForCreditResult> {
  const sleep =
    opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = opts.now ?? Date.now;
  const start = now();

  let attempts = 0;
  // The loop always reads at least once, so the caller gets a real
  // balance back even with timeoutMs = 0.
  for (;;) {
    attempts++;
    const reading = await opts.readBalances();
    const solVisible = reading.sol >= opts.preSol + opts.minSolDelta;
    const usdcVisible =
      opts.minUsdcDelta <= 0 || reading.usdc >= opts.preUsdc + opts.minUsdcDelta;

    if (solVisible && usdcVisible) {
      return { ...reading, confirmed: true, waitedMs: now() - start, attempts };
    }
    if (now() - start + opts.pollIntervalMs > opts.timeoutMs) {
      return { ...reading, confirmed: false, waitedMs: now() - start, attempts };
    }
    await sleep(opts.pollIntervalMs);
  }
}
