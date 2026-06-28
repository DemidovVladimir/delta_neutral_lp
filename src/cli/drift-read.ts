#!/usr/bin/env node
/**
 * Drift Read-Only Smoke CLI (ADR-014, Step 4)
 *
 * Read-only validation of the DriftEngine hedge read-side. Touches NO funds —
 * it subscribes to Drift in polling mode, prints the current hedge state, and
 * (optionally) the net-delta view against a hypothetical LP SOL exposure, then
 * unsubscribes. Use this to confirm that position / collateral / funding /
 * liquidation-price / oracle reads line up with Drift's UI BEFORE any
 * fund-handling code (collateral deposit, rebalance) is enabled.
 *
 * Usage:
 *   pnpm drift:read                 # print current hedge state
 *   pnpm drift:read --lp-sol=12.5   # also print net ΔSOL vs 12.5 SOL of LP exposure
 *   pnpm drift:read --help
 *
 * Prerequisites:
 *   - RPC_URL + PRIVATE_KEY set in .env
 *   - A Drift sub-account (DRIFT_SUBACCOUNT_ID, default 0) that already exists
 *     on-chain for this wallet. If it doesn't exist yet the engine throws a
 *     clear message — creating/funding it is a later (fund-handling) step.
 */

import { DriftEngine } from '../modules/driftEngine.js';
import { log } from '../utils/logger.js';

function parseLpSol(args: string[]): number | undefined {
  const arg = args.find((a) => a.startsWith('--lp-sol='));
  if (!arg) return undefined;
  const n = Number(arg.split('=')[1]);
  if (Number.isNaN(n)) {
    log.error('Invalid --lp-sol value (must be a number)');
    process.exit(1);
  }
  return n;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Drift Read-Only Smoke CLI (ADR-014, Step 4) — no funds touched

Usage:
  pnpm drift:read                 Print current hedge state from Drift
  pnpm drift:read --lp-sol=12.5   Also print net ΔSOL vs 12.5 SOL of LP exposure
  pnpm drift:read --help          Show this help

Reads (all read-only):
  perpBaseSol        Current SOL-PERP base position (negative = short)
  perpNotionalUsd    Notional value of the perp position, USD
  total/freeCollateralUsd, collateralRatio
  fundingRateBps     Annualised funding for the short (sign TBD — confirm vs UI)
  liquidationPrice   Estimated liq price, USD (null when no position)
  oraclePriceUsd     Drift oracle SOL mark price

Prerequisites:
  RPC_URL + PRIVATE_KEY in .env, and a Drift sub-account
  (DRIFT_SUBACCOUNT_ID, default 0) that already exists on-chain.
    `);
    process.exit(0);
  }

  const lpSol = parseLpSol(args);

  log.info('🔭 Drift read-only smoke check (no funds touched)');

  const drift = new DriftEngine();
  let failed = false;

  try {
    await drift.initialize();

    const state = await drift.getHedgeState();
    log.info('Hedge state', state);

    if (lpSol !== undefined) {
      const delta = await drift.computeDelta({
        solAmount: lpSol,
        usdcAmount: 0,
        totalUsd: 0,
        claimableSol: 0,
        claimableUsdc: 0,
        positions: [],
      });
      log.info('Delta view (vs hypothetical LP SOL exposure)', delta);
    }
  } catch (error) {
    failed = true;
    log.error('Drift read smoke check failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    await drift.shutdown();
  }

  // Explicit exit — Drift's polling loader keeps timers alive otherwise.
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  log.error('Unhandled error in drift:read CLI', {
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
  process.exit(1);
});
