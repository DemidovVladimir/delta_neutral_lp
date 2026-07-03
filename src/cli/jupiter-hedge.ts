#!/usr/bin/env node
/**
 * Jupiter Perps Hedge Mutations CLI (ADR-015 write side) — DRY-RUN by default.
 *
 * Builds and simulates the on-chain request transaction and sends NOTHING.
 * Pass --live to actually submit (real USDC collateral is escrowed and a
 * Jupiter keeper fills the short shortly after — TX2, asynchronous).
 *
 * Open / increase a SHORT SOL position (collateral = USDC):
 *   pnpm hedge:open --size-usd=10 --collateral=5                 Dry-run: simulate the request
 *   pnpm hedge:open --size-usd=10 --collateral=5 --live          LIVE: submit the request
 *   pnpm hedge:open --size-usd=10 --collateral=5 --slippage-bps=80
 *   pnpm hedge:open --help
 *
 *   --size-usd       Short notional to ADD, in USD (required, > 0).
 *   --collateral     USDC collateral to post for this request (required, > 0).
 *   --slippage-bps   Keeper fill bound; short open uses a price floor
 *                    oracle*(1 - bps/1e4). Default 50.
 *
 * Decrease / close a SHORT SOL position (collateral returned as USDC):
 *   pnpm hedge:close                                             Dry-run: simulate a FULL close
 *   pnpm hedge:close --live                                      LIVE: submit a full-close request
 *   pnpm hedge:close --size-usd=5 [--collateral=2]               Dry-run: partial decrease
 *   pnpm hedge:close --size-usd=5 --slippage-bps=80 --live       LIVE: partial decrease
 *
 *   --size-usd       Notional to REDUCE, USD. Omit for a full close (entirePosition).
 *   --collateral     USDC collateral to withdraw on a partial decrease (default 0).
 *   --slippage-bps   Partial fill bound; close uses a price ceiling
 *                    oracle*(1 + bps/1e4). Full close fills at any price. Default 50.
 */

import { JupiterPerpsEngine } from '../modules/jupiterPerpsEngine.js';
import type { HedgeRebalanceResult, MutationResult } from '../modules/hedgeEngine.js';
import { log } from '../utils/logger.js';

function report(r: MutationResult): void {
  if (r.detail && !r.simulated && !r.signatures) {
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
        console.log(s.logs.slice(-20).join('\n'));
      }
    }
  }
  if (r.signatures?.length) {
    log.info(`✅ LIVE — ${r.action} transaction sent`, { signatures: r.signatures, detail: r.detail });
  }
}

/** Report a controller (rebalanceHedge) decision + its underlying mutation. */
function reportRebalance(r: HedgeRebalanceResult): void {
  log.info('🎯 Rebalance decision', {
    action: r.action,
    adjustedSol: r.adjustedSol,
    blockedReason: r.blockedReason,
    delta: {
      lpSolExposure: r.deltaBefore.lpSolExposure,
      shortSol: r.deltaBefore.shortSol,
      netDeltaSol: r.deltaBefore.netDeltaSol,
      outOfBand: r.deltaBefore.outOfBand,
    },
  });
  if (r.action === 'blocked') {
    log.errorBanner(`⛔ BLOCKED — ${r.blockedReason}`);
  } else if (r.action === 'none') {
    log.info('✅ In band — no rebalance needed (nothing sent)');
  }
  if (r.mutation) report(r.mutation);
}

function parseNumberFlag(args: string[], name: string): number | undefined {
  const arg = args.find((a) => a.startsWith(`--${name}=`));
  if (!arg) return undefined;
  const n = Number(arg.split('=')[1]);
  return Number.isFinite(n) ? n : NaN;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h') || args.length === 0) {
    console.log(`
Jupiter Perps Hedge Mutations CLI (ADR-015 write side) — DRY-RUN by default

  pnpm hedge:open --size-usd=10 --collateral=5            Simulate opening a SHORT (nothing sent)
  pnpm hedge:open --size-usd=10 --collateral=5 --live     LIVE: submit the request (escrows USDC)
  pnpm hedge:open  --size-usd=10 --collateral=5 --slippage-bps=80
  pnpm hedge:close                                       Simulate a FULL close (nothing sent)
  pnpm hedge:close --live                                LIVE: full-close request
  pnpm hedge:close --size-usd=5 [--collateral=2]         Partial decrease (dry-run)

  tsx src/cli/jupiter-hedge.ts --rebalance --lp-sol=12.5 Run the controller for 12.5 SOL LP exposure (dry-run)
  tsx src/cli/jupiter-hedge.ts --emergency               Emergency unwind: full close at any price (dry-run)
  tsx src/cli/jupiter-hedge.ts --emergency --live        LIVE: emergency full-close request

  --open / --close / --rebalance / --emergency   Action to run.
  --lp-sol           rebalance: current LP SOL exposure to hedge toward (required, >= 0).
  --size-usd         open: short notional to ADD (required, > 0).
                     close: notional to REDUCE; omit for a full close.
  --collateral       open: USDC collateral to post (required, > 0).
                     close: USDC collateral to withdraw on a partial decrease (default 0).
  --slippage-bps     Keeper fill bound (open = price floor, close = price ceiling). Default 50.

Without --live, the request is built + simulated on-chain and NOTHING is sent.
`);
    process.exit(0);
  }

  const live = args.includes('--live');
  const dryRun = !live;
  const doOpen = args.includes('--open');
  const doClose = args.includes('--close');
  const doRebalance = args.includes('--rebalance');
  const doEmergency = args.includes('--emergency');

  if ([doOpen, doClose, doRebalance, doEmergency].filter(Boolean).length > 1) {
    log.error('Pass only one of --open / --close / --rebalance / --emergency.');
    process.exit(1);
  }
  if (!doOpen && !doClose && !doRebalance && !doEmergency) {
    log.error('Nothing to do. Use --open, --close, --rebalance, or --emergency. See --help.');
    process.exit(1);
  }

  const sizeUsd = parseNumberFlag(args, 'size-usd');
  const collateral = parseNumberFlag(args, 'collateral');
  const slippageBps = parseNumberFlag(args, 'slippage-bps');
  const lpSol = parseNumberFlag(args, 'lp-sol');

  if (slippageBps !== undefined && !(slippageBps >= 0 && slippageBps < 10_000)) {
    log.error('Invalid --slippage-bps (must be in [0, 10000))');
    process.exit(1);
  }

  log.info(
    `🔧 Jupiter Perps hedge — ${dryRun ? 'DRY-RUN (simulate only, nothing sent)' : '⚠️  LIVE (a transaction WILL be sent)'}`
  );

  const hedge = new JupiterPerpsEngine();
  let failed = false;
  try {
    await hedge.initialize();

    if (doOpen) {
      if (!(typeof sizeUsd === 'number' && sizeUsd > 0)) {
        log.error('Invalid or missing --size-usd (must be a positive number)');
        process.exit(1);
      }
      if (!(typeof collateral === 'number' && collateral > 0)) {
        log.error('Invalid or missing --collateral (must be a positive number)');
        process.exit(1);
      }
      report(await hedge.openOrIncreaseShort({ sizeUsd, collateralUsdc: collateral, slippageBps, dryRun }));
    } else if (doRebalance) {
      if (!(typeof lpSol === 'number' && lpSol >= 0)) {
        log.error('Invalid or missing --lp-sol (must be a number >= 0)');
        process.exit(1);
      }
      const result = await hedge.rebalanceHedge(
        { solAmount: lpSol, usdcAmount: 0, totalUsd: 0, claimableSol: 0, claimableUsdc: 0, positions: [] },
        { dryRun, slippageBps }
      );
      reportRebalance(result);
    } else if (doEmergency) {
      report(await hedge.emergencyUnwind({ dryRun }));
    } else {
      // --close: full close unless --size-usd is given (then a partial decrease).
      const entirePosition = sizeUsd === undefined;
      if (!entirePosition && !(typeof sizeUsd === 'number' && sizeUsd > 0)) {
        log.error('Invalid --size-usd for partial decrease (must be a positive number, or omit for a full close)');
        process.exit(1);
      }
      report(
        await hedge.decreaseOrCloseShort({
          entirePosition,
          sizeUsd: entirePosition ? undefined : sizeUsd,
          collateralUsd: collateral,
          slippageBps,
          dryRun,
        })
      );
    }
  } catch (e) {
    failed = true;
    log.error('Jupiter Perps hedge mutation failed', { error: e instanceof Error ? e.message : String(e) });
  } finally {
    await hedge.shutdown().catch(() => {});
  }
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  log.error('Unhandled error in jupiter-hedge CLI', {
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
  process.exit(1);
});
