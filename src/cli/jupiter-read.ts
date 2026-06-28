#!/usr/bin/env node
/**
 * Jupiter Perps Read-Only Smoke CLI (ADR-015) — no funds touched.
 *
 * Reads the hedge state from Jupiter Perpetuals: the SHORT SOL position (if
 * any), the SOL custody borrow rate (carry cost), oracle price, collateral,
 * and — with --lp-sol — the net ΔSOL vs the rebalance band. Sends nothing.
 *
 * Usage:
 *   pnpm jupiter:read                 Print current hedge state
 *   pnpm jupiter:read --lp-sol=12.5   Also print net ΔSOL vs 12.5 SOL LP exposure
 *   pnpm jupiter:read --help
 */

import { JupiterPerpsEngine } from '../modules/jupiterPerpsEngine.js';
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
Jupiter Perps read-only smoke CLI (ADR-015) — no funds touched

  pnpm jupiter:read                 Print current hedge state
  pnpm jupiter:read --lp-sol=12.5   Also print net ΔSOL vs 12.5 SOL LP exposure

carryRateBps: annualised carry in bps; NEGATIVE = the short PAYS (borrow fee).
`);
    process.exit(0);
  }

  const lpSol = parseLpSol(args);
  log.info('🔭 Jupiter Perps read-only smoke check (no funds touched)');

  const hedge = new JupiterPerpsEngine();
  let failed = false;
  try {
    await hedge.initialize();
    const state = await hedge.getHedgeState();
    log.info('Hedge state', state);
    log.info('Carry cost (annualised)', {
      carryRateBps: state.carryRateBps,
      approxAprPct: (state.carryRateBps / 100).toFixed(2) + '% (negative = short pays borrow fee)',
    });

    if (lpSol !== undefined) {
      const delta = await hedge.computeDelta({
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
    log.error('Jupiter Perps read smoke check failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    await hedge.shutdown();
  }
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  log.error('Unhandled error in jupiter:read CLI', {
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
  process.exit(1);
});
