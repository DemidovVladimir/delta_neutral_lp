#!/usr/bin/env node
/**
 * Auto-Tune CLI
 *
 * Command-line interface for running the auto-tune orchestrator.
 *
 * Usage:
 *   pnpm auto-tune              # Start auto-tune loop
 *   pnpm auto-tune --watch      # Start with watch mode (clear screen updates)
 *   pnpm auto-tune --help       # Show help
 *
 * The auto-tune mode will:
 * 1. Monitor LP position composition every interval (default: 30s)
 * 2. Detect when position becomes imbalanced (default: >80% in one token)
 * 3. Automatically rebalance using ATOMIC transaction with:
 *    - Withdraw 100% from current position
 *    - Claim all fees
 *    - Close empty position
 *    - Create new position centered at current price with claimed fees auto-compounded
 *
 * Configuration (via .env):
 * - AUTO_TUNE_ENABLED=true             # Enable auto-tune
 * - AUTO_TUNE_BIN_COUNT=20             # Number of bins (default: 20)
 * - AUTO_TUNE_CHECK_INTERVAL_MS=30000  # Check interval (default: 30s)
 * - AUTO_TUNE_IMBALANCE_THRESHOLD=0.8  # Imbalance threshold (default: 80%)
 */

import { AutoTuneOrchestrator } from '../modules/autoTuneOrchestrator.js';
import { log } from '../utils/logger.js';
import { getConfig } from '../config/env.js';

async function main() {
  const args = process.argv.slice(2);
  const watchMode = args.includes('--watch') || args.includes('-w');

  // Handle help flag
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Auto-Tune CLI - Automated Meteora LP Position Rebalancing

Usage:
  pnpm auto-tune              Start auto-tune loop
  pnpm auto-tune --watch      Start with watch mode (clear screen updates)
  pnpm auto-tune --help       Show this help message

Configuration (via .env):
  AUTO_TUNE_ENABLED=true                    Enable auto-tune mode
  AUTO_TUNE_BIN_COUNT=20                    Number of bins for concentrated liquidity
  AUTO_TUNE_CHECK_INTERVAL_MS=30000         Check interval in milliseconds (30s)
  AUTO_TUNE_IMBALANCE_THRESHOLD=0.9         Trigger threshold (0.9 = 90% in one token)

  METEORA_POOL_ADDRESS=<pool_address>      Meteora DLMM pool to manage
  AUTO_CREATE_POSITIONS=true                Auto-create initial position if needed

How it works:
  1. Monitors position composition every interval
  2. Detects when position becomes imbalanced (e.g., > 90% SOL or > 90% USDC)
  3. Triggers ATOMIC rebalance transaction:
     ✓ Withdraw 100% from position
     ✓ Claim accumulated fees
     ✓ Close empty position (reclaim rent)
     ✓ Create new position:
       • Centered at current price
       • Fixed bin count (e.g., 20 bins)
       • Original funds + claimed fees (auto-compounding)

  ALL OPERATIONS EXECUTE IN A SINGLE TRANSACTION for atomicity and cost savings!

Example:
  If SOL price moves from $160 to $180, and position becomes 85% USDC:
  → Auto-tune executes atomic rebalance in 1 transaction
  → Claimed fees are automatically compounded into new position
  → New position is centered at $180 with 20 bins
  → Maintains concentrated liquidity with optimal capital efficiency
    `);
    process.exit(0);
  }

  log.info('🚀 Starting Auto-Tune CLI');

  const config = getConfig();

  if (!config.autoTuneEnabled) {
    log.error('Auto-tune is not enabled. Set AUTO_TUNE_ENABLED=true in .env');
    process.exit(1);
  }

  if (watchMode) {
    console.log('🔍 Watch mode enabled - screen will refresh with each update\n');
  }

  log.info('Auto-tune configuration', {
    enabled: config.autoTuneEnabled,
    binCount: config.autoTuneBinCount,
    checkIntervalMs: config.autoTuneCheckIntervalMs,
    imbalanceThreshold: config.autoTuneImbalanceThreshold,
    poolAddress: config.meteoraPoolAddress,
    watchMode,
  });

  // Create orchestrator
  const orchestrator = new AutoTuneOrchestrator(watchMode);

  // Handle graceful shutdown
  const shutdown = async (signal: string) => {
    log.info(`Received ${signal}, shutting down gracefully...`);
    await orchestrator.stop();
    log.info('Auto-tune stopped. Goodbye!');
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  try {
    // Start auto-tune loop
    await orchestrator.start();

    log.info('✅ Auto-tune loop started successfully');
    log.info('Press Ctrl+C to stop');

    // Keep process alive
    await new Promise(() => {});
  } catch (error) {
    log.error('Failed to start auto-tune', {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  }
}

main().catch((error) => {
  log.error('Unhandled error in auto-tune CLI', {
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
  process.exit(1);
});
