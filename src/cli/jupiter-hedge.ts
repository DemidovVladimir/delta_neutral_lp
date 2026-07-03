#!/usr/bin/env node
/**
 * Jupiter Perps Hedge Mutations CLI (ADR-015/017 write side) — DRY-RUN by default.
 *
 * Builds and simulates the on-chain request transaction and sends NOTHING.
 * Pass --live to actually submit (real collateral is escrowed and a Jupiter
 * keeper fills the request shortly after — TX2, asynchronous).
 *
 * Open / increase a SOL position on either side:
 *   pnpm hedge:open --size-usd=10 --collateral=5                    SHORT (collateral = USDC)
 *   pnpm hedge:open --side=long --size-usd=10 --collateral=0.1      LONG (collateral = SOL, wrapped)
 *   pnpm hedge:open --size-usd=10 --collateral=5 --live             LIVE: submit the request
 *
 * Decrease / close:
 *   pnpm hedge:close                                Simulate a FULL close of the SHORT
 *   pnpm hedge:close --side=long                    Simulate a FULL close of the LONG
 *   pnpm hedge:close --size-usd=5 [--collateral=2]  Partial decrease (dry-run)
 *
 * Controller / emergency / wSOL:
 *   pnpm hedge:rebalance --lp-sol=12.5              Run the target-delta controller (dry-run)
 *   pnpm hedge:rebalance --lp-sol=0 --target-delta=5   Long-side branch (steer to +5 ΔSOL)
 *   pnpm hedge:emergency                            Full close of ALL sides at any price (dry-run)
 *   tsx src/cli/jupiter-hedge.ts --unwrap           Close the wSOL ATA back to native SOL (dry-run)
 */

import { JupiterPerpsEngine, type PositionSide } from '../modules/jupiterPerpsEngine.js';
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
      longSol: r.deltaBefore.longSol,
      shortSol: r.deltaBefore.shortSol,
      netDeltaSol: r.deltaBefore.netDeltaSol,
      targetDeltaSol: r.deltaBefore.targetDeltaSol,
      outOfBand: r.deltaBefore.outOfBand,
    },
  });
  if (r.action === 'blocked') {
    log.errorBanner(`⛔ BLOCKED — ${r.blockedReason}`);
  } else if (r.action === 'none') {
    log.info(`✅ No action — ${r.blockedReason ?? 'in band'} (nothing sent)`);
  }
  if (r.mutation) report(r.mutation);
}

function parseNumberFlag(args: string[], name: string): number | undefined {
  const arg = args.find((a) => a.startsWith(`--${name}=`));
  if (!arg) return undefined;
  const n = Number(arg.split('=')[1]);
  return Number.isFinite(n) ? n : NaN;
}

function parseSideFlag(args: string[]): PositionSide | null {
  const arg = args.find((a) => a.startsWith('--side='));
  if (!arg) return 'short';
  const v = arg.split('=')[1];
  return v === 'long' || v === 'short' ? v : null;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h') || args.length === 0) {
    console.log(`
Jupiter Perps Hedge Mutations CLI (ADR-015/017 write side) — DRY-RUN by default

  pnpm hedge:open --size-usd=10 --collateral=5              Simulate opening a SHORT (nothing sent)
  pnpm hedge:open --side=long --size-usd=10 --collateral=0.1  Simulate opening a LONG (SOL collateral)
  pnpm hedge:open --size-usd=10 --collateral=5 --live       LIVE: submit the request (escrows collateral)
  pnpm hedge:close [--side=long]                            Simulate a FULL close (nothing sent)
  pnpm hedge:close --size-usd=5 [--collateral=2]            Partial decrease (dry-run)

  pnpm hedge:rebalance --lp-sol=12.5                        Run the target-delta controller (dry-run)
  pnpm hedge:rebalance --lp-sol=0 --target-delta=5          Steer toward +5 ΔSOL (long branch)
  pnpm hedge:emergency [--live]                             Emergency unwind: close ALL sides at any price
  tsx src/cli/jupiter-hedge.ts --unwrap [--live]            Close the wSOL ATA back to native SOL

  --open / --close / --rebalance / --emergency / --unwrap   Action to run.
  --side             long | short (default short) for --open / --close.
  --lp-sol           rebalance: current LP SOL exposure to hedge against (required, >= 0).
  --target-delta     rebalance: override HEDGE_TARGET_DELTA_SOL for this run.
  --size-usd         open: notional to ADD (required, > 0).
                     close: notional to REDUCE; omit for a full close.
  --collateral       open: collateral to post (required, > 0) — USDC for a short, SOL for a long.
                     close: collateral (USD) to withdraw on a partial decrease (default 0).
  --slippage-bps     Keeper fill bound. Default 50.

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
  const doUnwrap = args.includes('--unwrap');

  if ([doOpen, doClose, doRebalance, doEmergency, doUnwrap].filter(Boolean).length > 1) {
    log.error('Pass only one of --open / --close / --rebalance / --emergency / --unwrap.');
    process.exit(1);
  }
  if (!doOpen && !doClose && !doRebalance && !doEmergency && !doUnwrap) {
    log.error('Nothing to do. Use --open, --close, --rebalance, --emergency, or --unwrap. See --help.');
    process.exit(1);
  }

  const sizeUsd = parseNumberFlag(args, 'size-usd');
  const collateral = parseNumberFlag(args, 'collateral');
  const slippageBps = parseNumberFlag(args, 'slippage-bps');
  const lpSol = parseNumberFlag(args, 'lp-sol');
  const targetDelta = parseNumberFlag(args, 'target-delta');
  const side = parseSideFlag(args);

  if (side === null) {
    log.error('Invalid --side (must be long or short)');
    process.exit(1);
  }
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
      report(await hedge.openOrIncrease({ side, sizeUsd, collateralTokens: collateral, slippageBps, dryRun }));
    } else if (doRebalance) {
      if (!(typeof lpSol === 'number' && lpSol >= 0)) {
        log.error('Invalid or missing --lp-sol (must be a number >= 0)');
        process.exit(1);
      }
      if (targetDelta !== undefined && !Number.isFinite(targetDelta)) {
        log.error('Invalid --target-delta (must be a finite number)');
        process.exit(1);
      }
      const result = await hedge.rebalanceHedge(
        { solAmount: lpSol, usdcAmount: 0, totalUsd: 0, claimableSol: 0, claimableUsdc: 0, positions: [] },
        { dryRun, slippageBps, targetDeltaSol: targetDelta, lastActionAtMs: null }
      );
      reportRebalance(result);
    } else if (doEmergency) {
      report(await hedge.emergencyUnwind({ dryRun }));
    } else if (doUnwrap) {
      report(await hedge.unwrapWsol({ dryRun }));
    } else {
      // --close: full close unless --size-usd is given (then a partial decrease).
      const entirePosition = sizeUsd === undefined;
      if (!entirePosition && !(typeof sizeUsd === 'number' && sizeUsd > 0)) {
        log.error('Invalid --size-usd for partial decrease (must be a positive number, or omit for a full close)');
        process.exit(1);
      }
      report(
        await hedge.decreaseOrClose({
          side,
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
