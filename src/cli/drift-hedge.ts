#!/usr/bin/env node
/**
 * Hedge Mutations CLI (ADR-014, Step 5b) — create sub-account + deposit collateral.
 *
 * DRY-RUN BY DEFAULT: builds and simulates the transaction on-chain and sends
 * NOTHING. Pass --live to actually submit (real rent / real funds).
 *
 * Usage:
 *   pnpm hedge --init                 Dry-run: simulate creating the Drift sub-account
 *   pnpm hedge --init --live          LIVE: create the sub-account (~SOL rent, reclaimable)
 *   pnpm hedge --deposit=25           Dry-run: simulate depositing 25 USDC collateral
 *   pnpm hedge --deposit=25 --live    LIVE: deposit 25 USDC (needs USDC in the wallet)
 *   pnpm hedge --init --deposit=25    Run both (init first, then deposit)
 *   pnpm hedge --help
 *
 * The sub-account must exist before a deposit — run --init first.
 */

import { DriftEngine, type MutationResult } from '../modules/driftEngine.js';
import { log } from '../utils/logger.js';

function report(r: MutationResult): void {
  if (r.detail && !r.simulated && !r.signature) {
    log.info(`${r.action}: ${r.detail}`);
  }
  if (r.simulated) {
    const s = r.simulated;
    if (s.success) {
      log.info(`✅ DRY-RUN ok — ${r.action} would succeed (nothing sent)`, {
        unitsConsumed: s.unitsConsumed,
        detail: r.detail,
      });
    } else {
      log.errorBanner(`❌ DRY-RUN — ${r.action} simulation reverted`, { err: s.err, detail: r.detail });
      if (s.logs?.length) {
        console.log('--- last simulation logs ---');
        console.log(s.logs.slice(-15).join('\n'));
      }
    }
  }
  if (r.signature) {
    log.info(`✅ LIVE — ${r.action} transaction sent`, { signature: r.signature });
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h') || args.length === 0) {
    console.log(`
Hedge Mutations CLI (ADR-014, Step 5b) — DRY-RUN by default

  pnpm hedge --init                 Simulate creating the Drift sub-account
  pnpm hedge --init --live          LIVE: create the sub-account (~SOL rent, reclaimable)
  pnpm hedge --deposit=25           Simulate depositing 25 USDC collateral
  pnpm hedge --deposit=25 --live    LIVE: deposit 25 USDC (needs USDC in wallet)
  pnpm hedge --init --deposit=25    Both (init first, then deposit)

Without --live, every action is simulated on-chain and NOTHING is sent.
`);
    process.exit(0);
  }

  const live = args.includes('--live');
  const dryRun = !live;
  const doInit = args.includes('--init');
  const depArg = args.find((a) => a.startsWith('--deposit='));
  const depAmount = depArg ? Number(depArg.split('=')[1]) : undefined;

  if (!doInit && depArg === undefined) {
    log.error('Nothing to do. Use --init and/or --deposit=<usdc>. See --help.');
    process.exit(1);
  }
  if (depArg !== undefined && !(typeof depAmount === 'number' && depAmount > 0)) {
    log.error('Invalid --deposit amount (must be a positive number)');
    process.exit(1);
  }

  log.info(
    `🔧 Hedge mutations — ${dryRun ? 'DRY-RUN (simulate only, nothing sent)' : '⚠️  LIVE (transactions WILL be sent)'}`
  );

  const drift = new DriftEngine();
  let failed = false;
  try {
    if (doInit) {
      report(await drift.ensureSubAccount({ dryRun }));
    }
    if (depAmount !== undefined) {
      report(await drift.depositCollateral(depAmount, { dryRun }));
    }
  } catch (e) {
    failed = true;
    log.error('Hedge mutation failed', { error: e instanceof Error ? e.message : String(e) });
  } finally {
    await drift.shutdown().catch(() => {});
  }

  // Explicit exit — Drift's polling loader keeps timers alive otherwise.
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  log.error('Unhandled error in hedge CLI', {
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
  process.exit(1);
});
