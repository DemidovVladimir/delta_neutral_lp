/**
 * Auto-Tune Orchestrator
 *
 * Manages automatic position rebalancing for Meteora DLMM positions.
 *
 * Strategy:
 * 1. Monitor position composition every interval (e.g., 10s)
 * 2. Detect when position becomes imbalanced (e.g., > 90% in one token)
 * 3. Trigger rebalance flow:
 *    - Withdraw 100% from current position
 *    - Claim all accumulated fees
 *    - Close empty position (reclaim rent)
 *    - Create new position centered at current price with:
 *      - Fixed bin count (e.g., 20 bins)
 *      - Original funds + claimed fees (auto-compounding)
 *
 * User Configuration (via .env):
 * - AUTO_TUNE_ENABLED: Enable/disable auto-tune mode
 * - AUTO_TUNE_BIN_COUNT: Number of bins (default: 20)
 * - AUTO_TUNE_CHECK_INTERVAL_MS: Check frequency (default: 10000 = 10s)
 * - AUTO_TUNE_IMBALANCE_THRESHOLD: Trigger threshold (default: 0.9 = 90%)
 *
 * @example
 * ```typescript
 * const orchestrator = new AutoTuneOrchestrator();
 *
 * // Start auto-tune loop
 * await orchestrator.start();
 *
 * // Stop gracefully
 * await orchestrator.stop();
 * ```
 */

import { PublicKey } from '@solana/web3.js';
import DLMMModule from '@meteora-ag/dlmm';
import { MeteoraAdapter } from './meteoraAdapter.js';
import { getConfig } from '../config/env.js';
import { log } from '../utils/logger.js';
import { getConnection } from '../core/agentKit.js';
import { DECIMALS } from '../config/constants.js';
import {
  checkPositionImbalance,
  calculateCenteredPriceRange,
  getActiveBin,
  getPriceFromBinId,
} from '../utils/meteoraUtils.js';
import {
  AutoTuneState,
  PositionBalance,
  RebalanceResult,
} from '../types/index.js';
import { saveAutoTuneState, loadAutoTuneState } from './persistence.js';

// Handle ESM/CommonJS interop for DLMM class
// @ts-ignore - ESM default export handling
const DLMM: any = DLMMModule.default || DLMMModule;

export class AutoTuneOrchestrator {
  private config = getConfig();
  private meteoraAdapter: MeteoraAdapter;
  private state: AutoTuneState;
  private intervalHandle?: NodeJS.Timeout;
  private watchMode: boolean;

  constructor(watchMode: boolean = false) {
    this.watchMode = watchMode;
    this.meteoraAdapter = new MeteoraAdapter();

    // Load saved state or initialize new state
    const savedState = loadAutoTuneState();
    this.state = savedState || {
      iteration: 0,
      running: false,
      lastCheck: 0,
      lastRebalance: 0,
      rebalanceCount: 0,
      consecutiveErrors: 0,
    };

    log.info('AutoTuneOrchestrator initialized', {
      enabled: this.config.autoTuneEnabled,
      binCount: this.config.autoTuneBinCount,
      checkIntervalMs: this.config.autoTuneCheckIntervalMs,
      imbalanceThreshold: this.config.autoTuneImbalanceThreshold,
      watchMode: this.watchMode,
      state: this.state,
    });
  }

  /**
   * Start the auto-tune loop
   */
  async start(): Promise<void> {
    if (!this.config.autoTuneEnabled) {
      throw new Error('Auto-tune is not enabled. Set AUTO_TUNE_ENABLED=true in .env');
    }

    if (this.state.running) {
      log.warn('Auto-tune loop already running');
      return;
    }

    log.info('Starting auto-tune loop', {
      checkIntervalMs: this.config.autoTuneCheckIntervalMs,
      binCount: this.config.autoTuneBinCount,
      imbalanceThreshold: this.config.autoTuneImbalanceThreshold,
    });

    this.state.running = true;
    saveAutoTuneState(this.state);

    // Run first check immediately
    await this.runCheckCycle();

    // Schedule periodic checks
    this.intervalHandle = setInterval(async () => {
      await this.runCheckCycle();
    }, this.config.autoTuneCheckIntervalMs);
  }

  /**
   * Stop the auto-tune loop
   */
  async stop(): Promise<void> {
    log.info('Stopping auto-tune loop');

    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = undefined;
    }

    this.state.running = false;
    saveAutoTuneState(this.state);

    log.info('Auto-tune loop stopped', {
      totalIterations: this.state.iteration,
      totalRebalances: this.state.rebalanceCount,
    });
  }

  /**
   * Display watch mode status (clear screen and show current state)
   */
  private displayWatchMode(balance: PositionBalance | null, elapsed: number): void {
    if (!this.watchMode) return;

    // Clear screen
    console.clear();

    // Header
    console.log('╔════════════════════════════════════════════════════════════════╗');
    console.log('║           AUTO-TUNE POSITION MONITOR (Watch Mode)             ║');
    console.log('╚════════════════════════════════════════════════════════════════╝\n');

    // Timestamp
    const now = new Date().toLocaleString();
    console.log(`⏰ Last Update: ${now}`);
    console.log(`🔄 Check Interval: ${this.config.autoTuneCheckIntervalMs / 1000}s\n`);

    // Session stats
    console.log('📊 SESSION STATISTICS');
    console.log('─'.repeat(64));
    console.log(`   Iteration:        #${this.state.iteration}`);
    console.log(`   Rebalances:       ${this.state.rebalanceCount}`);
    console.log(`   Consecutive Errors: ${this.state.consecutiveErrors}`);
    console.log(`   Check Duration:   ${elapsed}ms\n`);

    if (!balance) {
      console.log('⚠️  NO POSITION FOUND\n');
      console.log('Press Ctrl+C to stop');
      return;
    }

    // Position status
    console.log('📍 POSITION STATUS');
    console.log('─'.repeat(64));
    console.log(`   Current Price:    $${balance.currentPrice.toFixed(2)}`);
    console.log(`   Position Range:   $${balance.lowerPrice.toFixed(2)} - $${balance.upperPrice.toFixed(2)}`);
    console.log(`   Threshold:        ${(this.config.autoTuneImbalanceThreshold * 100).toFixed(0)}%\n`);

    // Composition visual
    console.log('💰 COMPOSITION');
    console.log('─'.repeat(64));

    const solBar = '█'.repeat(Math.round(balance.solPercent / 2));
    const usdcBar = '█'.repeat(Math.round(balance.usdcPercent / 2));

    console.log(`   SOL:  [${solBar.padEnd(50, '░')}] ${balance.solPercent.toFixed(1)}%`);
    console.log(`   USDC: [${usdcBar.padEnd(50, '░')}] ${balance.usdcPercent.toFixed(1)}%\n`);

    // Status indicator
    if (balance.isImbalanced) {
      console.log('🔴 STATUS: IMBALANCED - REBALANCE TRIGGERED!');
      console.log(`   Reason: ${balance.reason}\n`);
    } else {
      console.log('🟢 STATUS: BALANCED - NO ACTION NEEDED\n');
    }

    console.log('─'.repeat(64));
    console.log('Press Ctrl+C to stop');
  }

  /**
   * Run a single check cycle
   */
  private async runCheckCycle(): Promise<void> {
    const startTime = Date.now();
    this.state.iteration++;
    this.state.lastCheck = startTime;

    if (!this.watchMode) {
      log.info('🔍 Auto-tune check cycle started', {
        iteration: this.state.iteration,
        rebalanceCount: this.state.rebalanceCount,
      });
    }

    try {
      // 1. Check position balance
      const balance = await this.checkPositionBalance();

      if (!balance) {
        const elapsed = Date.now() - startTime;
        this.displayWatchMode(null, elapsed);
        if (!this.watchMode) {
          log.warn('No position found to monitor - will create on next cycle if AUTO_CREATE_POSITIONS=true');
        }
        this.state.consecutiveErrors = 0;
        saveAutoTuneState(this.state);
        return;
      }

      if (!this.watchMode) {
        log.info('Position balance checked', {
          solPercent: balance.solPercent,
          usdcPercent: balance.usdcPercent,
          isImbalanced: balance.isImbalanced,
          currentPrice: balance.currentPrice,
          lowerPrice: balance.lowerPrice,
          upperPrice: balance.upperPrice,
          reason: balance.reason,
        });
      }

      // 2. Trigger rebalance if imbalanced
      if (balance.isImbalanced) {
        if (!this.watchMode) {
          log.warn('⚠️  Position imbalanced - triggering rebalance', {
            reason: balance.reason,
            solPercent: balance.solPercent,
            usdcPercent: balance.usdcPercent,
          });
        }

        const result = await this.executeRebalance();

        if (result.success) {
          if (!this.watchMode) {
            log.info('✅ Rebalance completed successfully', {
              oldPosition: result.oldPositionMint,
              newPosition: result.newPositionMint,
              claimedFees: result.claimedFees,
              deposited: result.deposited,
              signatures: result.signatures,
              durationMs: result.durationMs,
            });
          }

          this.state.rebalanceCount++;
          this.state.lastRebalance = Date.now();
          this.state.currentPositionMint = result.newPositionMint;
          this.state.consecutiveErrors = 0;
        } else {
          if (!this.watchMode) {
            log.error('❌ Rebalance failed', {
              error: result.error,
              durationMs: result.durationMs,
            });
          }
          this.state.consecutiveErrors++;
        }
      } else {
        if (!this.watchMode) {
          log.info('✓ Position balanced - no action needed', {
            solPercent: balance.solPercent,
            usdcPercent: balance.usdcPercent,
          });
        }
        this.state.consecutiveErrors = 0;
      }

      saveAutoTuneState(this.state);

      const elapsed = Date.now() - startTime;

      // Display watch mode or log
      this.displayWatchMode(balance, elapsed);

      if (!this.watchMode) {
        log.info('Auto-tune check cycle completed', {
          iteration: this.state.iteration,
          durationMs: elapsed,
          nextCheckIn: this.config.autoTuneCheckIntervalMs,
        });
      }
    } catch (error) {
      log.error('Auto-tune check cycle failed', {
        error: error instanceof Error ? error.message : String(error),
        iteration: this.state.iteration,
      });

      this.state.consecutiveErrors++;
      saveAutoTuneState(this.state);

      // Stop if too many consecutive errors
      if (this.state.consecutiveErrors >= 5) {
        log.error('Too many consecutive errors - stopping auto-tune', {
          consecutiveErrors: this.state.consecutiveErrors,
        });
        await this.stop();
      }
    }
  }

  /**
   * Check current position balance
   */
  private async checkPositionBalance(): Promise<PositionBalance | null> {
    try {
      // Get LP exposure from MeteoraAdapter
      const exposure = await this.meteoraAdapter.getLpExposure();

      if (exposure.positions.length === 0) {
        log.warn('No positions found to check balance');
        return null;
      }

      // Use the first position (auto-tune manages single position)
      const position = exposure.positions[0];
      this.state.currentPositionMint = position.mint;

      // Get pool info to fetch bin data
      const connection = getConnection();
      const poolPubkey = new PublicKey(this.config.meteoraPoolAddress!);
      const dlmmPool = await DLMM.create(connection, poolPubkey);

      // Get current active bin
      const activeBinData = await getActiveBin(dlmmPool);
      const currentPrice = activeBinData.pricePerToken;

      // Calculate position price bounds
      const binStep = dlmmPool.lbPair.binStep;
      const lowerBinPrice = getPriceFromBinId(
        position.lowerBinId,
        binStep,
        DECIMALS.SOL,
        DECIMALS.USDC
      ).toNumber();
      const upperBinPrice = getPriceFromBinId(
        position.upperBinId,
        binStep,
        DECIMALS.SOL,
        DECIMALS.USDC
      ).toNumber();

      // Check for imbalance
      const imbalanceCheck = checkPositionImbalance(
        currentPrice,
        lowerBinPrice,
        upperBinPrice,
        this.config.autoTuneImbalanceThreshold
      );

      return {
        solPercent: imbalanceCheck.solPercent,
        usdcPercent: imbalanceCheck.usdcPercent,
        isImbalanced: imbalanceCheck.isImbalanced,
        currentPrice,
        lowerPrice: lowerBinPrice,
        upperPrice: upperBinPrice,
        reason: imbalanceCheck.reason,
      };
    } catch (error) {
      log.error('Failed to check position balance', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Execute full rebalance flow as a SINGLE atomic operation:
   * 1. Withdraw 100% from position
   * 2. Claim fees
   * 3. Close position
   * 4. Create new position with original + fees
   *
   * All operations are bundled into a single transaction for atomicity
   */
  private async executeRebalance(): Promise<RebalanceResult> {
    const startTime = Date.now();

    try {
      // Get current position mint
      const positionMints = this.meteoraAdapter.getPositionMints();
      if (positionMints.length === 0) {
        throw new Error('No position to rebalance');
      }

      const oldPositionMint = positionMints[0];
      log.info('Starting ATOMIC rebalance flow', { oldPositionMint });

      // Get current exposure before withdrawal
      const exposureBefore = await this.meteoraAdapter.getLpExposure();
      const totalSolBefore = exposureBefore.solAmount;
      const totalUsdcBefore = exposureBefore.usdcAmount;
      const claimableSol = exposureBefore.claimableSol;
      const claimableUsdc = exposureBefore.claimableUsdc;

      log.info('Current position state', {
        solAmount: totalSolBefore,
        usdcAmount: totalUsdcBefore,
        claimableSol,
        claimableUsdc,
      });

      // Calculate new position parameters FIRST (before closing old one)
      const connection = getConnection();
      const poolPubkey = new PublicKey(this.config.meteoraPoolAddress!);
      const dlmmPool = await DLMM.create(connection, poolPubkey);

      // Get current price and bin
      const activeBinData = await getActiveBin(dlmmPool);
      const currentPrice = activeBinData.pricePerToken;
      const currentBinId = activeBinData.binId;
      const binStep = dlmmPool.lbPair.binStep;

      // Calculate centered price range for new position
      const priceRange = calculateCenteredPriceRange(
        currentPrice,
        currentBinId,
        binStep,
        this.config.autoTuneBinCount,
        DECIMALS.SOL,
        DECIMALS.USDC
      );

      log.info('New position range calculated', {
        currentPrice,
        binCount: this.config.autoTuneBinCount,
        lowerPrice: priceRange.lowerPrice,
        upperPrice: priceRange.upperPrice,
        minBinId: priceRange.minBinId,
        maxBinId: priceRange.maxBinId,
      });

      // Calculate total funds for new position (original + fees)
      const totalSol = totalSolBefore + claimableSol;
      const totalUsdc = totalUsdcBefore + claimableUsdc;

      log.info('Executing ATOMIC rebalance with bundled operations', {
        oldPosition: oldPositionMint,
        withdrawPercent: 100,
        claimFees: { sol: claimableSol, usdc: claimableUsdc },
        closePosition: true,
        createNewPosition: {
          solAmount: totalSol,
          usdcAmount: totalUsdc,
          priceLower: priceRange.lowerPrice,
          priceUpper: priceRange.upperPrice,
        },
      });

      // Execute ATOMIC rebalance in a single transaction
      // All operations bundled: withdraw → claim → close → create
      const result = await this.meteoraAdapter.atomicRebalance({
        oldPositionMint,
        newPositionParams: {
          solAmount: totalSol,
          usdcAmount: totalUsdc,
          priceLower: priceRange.lowerPrice,
          priceUpper: priceRange.upperPrice,
        },
      });

      const durationMs = Date.now() - startTime;

      log.info('✅ ATOMIC rebalance completed successfully', {
        oldPosition: oldPositionMint,
        newPosition: result.newPositionMint,
        signature: result.signature,
        durationMs,
      });

      return {
        success: true,
        oldPositionMint,
        newPositionMint: result.newPositionMint,
        claimedFees: result.claimedFees,
        deposited: {
          sol: totalSol,
          usdc: totalUsdc,
        },
        signatures: [result.signature],
        durationMs,
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      log.error('❌ ATOMIC rebalance failed', {
        error: errorMessage,
        durationMs,
      });

      return {
        success: false,
        oldPositionMint: this.state.currentPositionMint || '',
        newPositionMint: '',
        claimedFees: { sol: 0, usdc: 0 },
        deposited: { sol: 0, usdc: 0 },
        signatures: [],
        error: errorMessage,
        durationMs,
      };
    }
  }

  /**
   * Get current auto-tune state
   */
  getState(): AutoTuneState {
    return { ...this.state };
  }

  /**
   * Check if auto-tune is running
   */
  isRunning(): boolean {
    return this.state.running;
  }
}
