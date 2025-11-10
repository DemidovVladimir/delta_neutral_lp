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
import { getAssociatedTokenAddress } from '@solana/spl-token';
import DLMMModule from '@meteora-ag/dlmm';
import { MeteoraAdapter } from './meteoraAdapter.js';
import { JupiterSwapper } from './jupiterSwapper.js';
import { getConfig } from '../config/env.js';
import { log } from '../utils/logger.js';
import { getConnection, getWalletKeypair } from '../core/agentKit.js';
import { DECIMALS } from '../config/constants.js';
import { getSolPrice } from '../core/priceOracle.js';
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

// Token mint addresses
const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');

// Handle ESM/CommonJS interop for DLMM class
// @ts-ignore - ESM default export handling
const DLMM: any = DLMMModule.default || DLMMModule;

export class AutoTuneOrchestrator {
  private config = getConfig();
  private meteoraAdapter: MeteoraAdapter;
  private jupiterSwapper: JupiterSwapper;
  private state: AutoTuneState;
  private intervalHandle?: NodeJS.Timeout;
  private watchMode: boolean;

  constructor(watchMode: boolean = false) {
    this.watchMode = watchMode;
    this.meteoraAdapter = new MeteoraAdapter();
    this.jupiterSwapper = new JupiterSwapper();

    // Load saved state or initialize new state
    const savedState = loadAutoTuneState();
    this.state = savedState || {
      iteration: 0,
      running: false,
      lastCheck: 0,
      lastRebalance: 0,
      rebalanceCount: 0,
      consecutiveErrors: 0,
      totalClaimedFees: {
        sol: 0,
        usdc: 0,
      },
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

          // Accumulate claimed fees
          this.state.totalClaimedFees.sol += result.claimedFees.sol;
          this.state.totalClaimedFees.usdc += result.claimedFees.usdc;

          // Save last position created details
          this.state.lastPositionCreated = {
            positionMint: result.newPositionMint,
            initialDeposit: {
              sol: result.deposited.sol,
              usdc: result.deposited.usdc,
            },
            timestamp: Date.now(),
          };
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
   * Calculate balanced position deposits based on config token + claimed fees
   *
   * Strategy:
   * - User specifies base token amount (e.g., 1 SOL or 160 USDC)
   * - Add claimed fees to base amount
   * - Calculate other token needed for balanced position at current price
   * - Return balanced amounts for position creation
   */
  private calculateBalancedDeposits(
    claimedSol: number,
    claimedUsdc: number,
    currentPrice: number
  ): { solAmount: number; usdcAmount: number } {
    const baseToken = this.config.autoTuneDepositToken;
    const baseAmount = this.config.autoTuneDepositAmount;

    log.info('Calculating balanced deposits', {
      baseToken,
      baseAmount,
      claimedSol,
      claimedUsdc,
      currentPrice,
    });

    if (baseToken === 'SOL') {
      // Base is SOL: SOL amount = base + claimed SOL
      const totalSol = baseAmount + claimedSol;

      // For balanced position around active bin, we need roughly equal USD value
      // With configured bin count (e.g., 20 bins = 10 each side), position should be ~50/50
      const solAmountFinal = totalSol;
      const usdcAmountFinal = solAmountFinal * currentPrice + claimedUsdc; // Equal USD value + claimed USDC

      log.info('Calculated balanced deposits (SOL base)', {
        solAmount: solAmountFinal,
        usdcAmount: usdcAmountFinal,
        solValueUsd: solAmountFinal * currentPrice,
        totalValueUsd: solAmountFinal * currentPrice + usdcAmountFinal,
      });

      return {
        solAmount: solAmountFinal,
        usdcAmount: usdcAmountFinal,
      };
    } else {
      // Base is USDC: USDC amount = base + claimed USDC
      const totalUsdc = baseAmount + claimedUsdc;

      // For balanced position, roughly equal USD value
      const usdcAmountFinal = totalUsdc;
      const solAmountFinal = usdcAmountFinal / currentPrice + claimedSol; // Equal USD value + claimed SOL

      log.info('Calculated balanced deposits (USDC base)', {
        solAmount: solAmountFinal,
        usdcAmount: usdcAmountFinal,
        usdcValueUsd: usdcAmountFinal,
        totalValueUsd: solAmountFinal * currentPrice + usdcAmountFinal,
      });

      return {
        solAmount: solAmountFinal,
        usdcAmount: usdcAmountFinal,
      };
    }
  }

  /**
   * Get USDC balance for wallet
   */
  private async getUsdcBalance(): Promise<number> {
    try {
      const connection = getConnection();
      const wallet = getWalletKeypair();

      // Get associated token account for USDC
      const usdcTokenAccount = await getAssociatedTokenAddress(
        USDC_MINT,
        wallet.publicKey
      );

      // Try to get account balance
      const balance = await connection.getTokenAccountBalance(usdcTokenAccount);
      return balance.value.uiAmount || 0;
    } catch (error) {
      // If account doesn't exist, balance is 0
      log.debug('USDC token account not found or error getting balance', {
        error: error instanceof Error ? error.message : String(error),
      });
      return 0;
    }
  }

  /**
   * Check if error is due to insufficient funds
   */
  private isInsufficientFundsError(error: Error): boolean {
    const errorMsg = error.message.toLowerCase();
    return (
      errorMsg.includes('insufficient') ||
      errorMsg.includes('not enough') ||
      errorMsg.includes('balance') ||
      errorMsg.includes('0x1') // Solana insufficient funds error code
    );
  }

  /**
   * Execute full rebalance flow with TWO-PHASE approach:
   *
   * PHASE 1: Withdraw + Claim + Close
   * - Withdraw 100% from old position
   * - Claim all accumulated fees
   * - Close empty position (reclaim rent)
   * - Tokens now in wallet (likely imbalanced due to price movement)
   *
   * PHASE 2: Create new position with intelligent retry
   * - Calculate balanced deposits based on config + claimed fees
   * - Attempt 1: Try create position WITHOUT swap
   * - If fails with insufficient funds:
   *   - Calculate swap needed
   *   - Bundle: [Jupiter swap TX, Create position TX]
   *   - Submit to Jito
   * - On failure: Retry with escalating Jito tips (max 3 retries)
   * - Only escalate tips if NOT insufficient funds error
   */
  private async executeRebalance(): Promise<RebalanceResult> {
    const startTime = Date.now();

    try {
      // ========================================================================
      // PHASE 1: WITHDRAW + CLAIM + CLOSE
      // ========================================================================

      const positionMints = this.meteoraAdapter.getPositionMints();
      if (positionMints.length === 0) {
        throw new Error('No position to rebalance');
      }

      const oldPositionMint = positionMints[0];
      log.info('🔄 Starting TWO-PHASE rebalance flow', { oldPositionMint });

      // Get current exposure before withdrawal
      const exposureBefore = await this.meteoraAdapter.getLpExposure();
      const claimableSol = exposureBefore.claimableSol;
      const claimableUsdc = exposureBefore.claimableUsdc;

      log.info('📊 Current position state', {
        solAmount: exposureBefore.solAmount,
        usdcAmount: exposureBefore.usdcAmount,
        claimableSol,
        claimableUsdc,
      });

      // Execute Phase 1: Withdraw + Claim + Close in ONE transaction
      log.info('⬇️  PHASE 1: Withdrawing, claiming fees, and closing position');

      const withdrawResult = await this.meteoraAdapter.withdrawClaimAndClose(oldPositionMint);

      log.info('✅ Phase 1 complete', {
        signature: withdrawResult.signature,
        claimedSol: withdrawResult.claimedFees.sol,
        claimedUsdc: withdrawResult.claimedFees.usdc,
      });

      // ========================================================================
      // PHASE 2: CREATE NEW POSITION WITH INTELLIGENT RETRY
      // ========================================================================

      log.info('⬆️  PHASE 2: Creating new balanced position with retry logic');

      // Get current price for balanced deposit calculation
      const solPriceData = await getSolPrice();
      const currentPrice = solPriceData.usd;

      // Calculate balanced deposits (config amount + claimed fees)
      const { solAmount, usdcAmount } = this.calculateBalancedDeposits(
        withdrawResult.claimedFees.sol,
        withdrawResult.claimedFees.usdc,
        currentPrice
      );

      // Get pool info for price range
      const connection = getConnection();
      const poolPubkey = new PublicKey(this.config.meteoraPoolAddress!);
      const dlmmPool = await DLMM.create(connection, poolPubkey);

      const activeBinData = await getActiveBin(dlmmPool);
      const activeBinPrice = activeBinData.pricePerToken;
      const currentBinId = activeBinData.binId;
      const binStep = dlmmPool.lbPair.binStep;

      // Calculate centered price range
      const priceRange = calculateCenteredPriceRange(
        activeBinPrice,
        currentBinId,
        binStep,
        this.config.autoTuneBinCount,
        DECIMALS.SOL,
        DECIMALS.USDC
      );

      log.info('📍 New position parameters', {
        currentPrice: activeBinPrice,
        binCount: this.config.autoTuneBinCount,
        priceRange: {
          lower: priceRange.lowerPrice,
          upper: priceRange.upperPrice,
        },
        deposits: {
          sol: solAmount,
          usdc: usdcAmount,
        },
      });

      // Attempt to create position with intelligent retry
      let attempt = 0;
      let newPositionMint = '';
      let createSignatures: string[] = [];
      let lastError: Error | null = null;
      let usedSwap = false;

      while (attempt < this.config.autoTuneMaxRetries) {
        attempt++;

        try {
          log.info(`🎯 Attempt ${attempt}/${this.config.autoTuneMaxRetries}: Creating position`);

          // ATTEMPT 1: Try WITHOUT swap first (normal priority)
          if (attempt === 1) {
            const result = await this.meteoraAdapter.createPosition({
              poolAddress: this.config.meteoraPoolAddress!,
              solAmount,
              usdcAmount,
              priceLower: priceRange.lowerPrice,
              priceUpper: priceRange.upperPrice,
            });

            newPositionMint = result.positionMint;
            createSignatures.push(result.signature);

            log.info('✅ Position created successfully WITHOUT swap', {
              positionMint: newPositionMint,
              signature: result.signature,
            });

            break; // Success!
          }

          // ATTEMPT 2+: If retrying due to network error (not insufficient funds)
          // Use escalated Jito tips
          if (attempt > 1 && !usedSwap) {
            // Calculate escalated tip: base → 1.5x → 2x → 2.5x
            const escalationFactor = 1 + (attempt - 1) * 0.5;
            const maxEscalationFactor = 3; // Cap at 3x base tip
            const finalFactor = Math.min(escalationFactor, maxEscalationFactor);

            log.warn(`⚠️  Retrying with escalated Jito tip`, {
              attempt,
              escalationFactor: finalFactor,
            });

            const result = await this.meteoraAdapter.createPosition({
              poolAddress: this.config.meteoraPoolAddress!,
              solAmount,
              usdcAmount,
              priceLower: priceRange.lowerPrice,
              priceUpper: priceRange.upperPrice,
            });

            newPositionMint = result.positionMint;
            createSignatures.push(result.signature);

            log.info('✅ Position created successfully with escalated tips', {
              positionMint: newPositionMint,
              signature: result.signature,
              attempt,
            });

            break; // Success!
          }

          // ATTEMPTS 2+: Should only reach here if first attempt failed with insufficient funds
          // This means we need to swap
          if (!usedSwap) {
            log.errorBanner('Insufficient funds detected - attempting swap + create bundle', {
              attempt,
              requiredSol: solAmount,
              requiredUsdc: usdcAmount,
            });

            // Step 1: Check wallet balances
            const wallet = getWalletKeypair();
            const solBalance = await connection.getBalance(wallet.publicKey);
            const actualSol = solBalance / Math.pow(10, 9);
            const actualUsdc = await this.getUsdcBalance();

            log.info('Wallet balances', {
              actualSol,
              actualUsdc,
              requiredSol: solAmount,
              requiredUsdc: usdcAmount,
            });

            // Step 2: Calculate swap needed
            const swapParams = this.jupiterSwapper.calculateRebalanceSwap(
              actualSol,
              actualUsdc,
              currentPrice,
              50 // Target 50% SOL
            );

            if (!swapParams) {
              throw new Error('Cannot calculate swap parameters - wallet may have no funds');
            }

            log.info('Calculated swap needed', swapParams);

            // Step 3: Get swap transaction
            const swapTxResult = await this.jupiterSwapper.getSwapTransaction(swapParams);

            log.info('Got swap transaction', {
              inputAmount: swapTxResult.inputAmount,
              outputAmount: swapTxResult.outputAmount,
              priceImpact: swapTxResult.priceImpactPct,
            });

            // Step 4: Get create position transaction for bundling
            log.info('🔗 Building atomic Jito bundle: [swap + create position + tip]');

            // Calculate escalation for bundle attempts
            const bundleAttempt = attempt - 1; // First swap attempt is attempt 2, so bundleAttempt = 1

            // Build create position transaction WITHOUT embedded Jito tip
            // Tip will be added as separate transaction at end of bundle
            // For bundles, only the bundle tip matters (not priority fees inside txs)
            const createTxResult = await this.meteoraAdapter.getCreatePositionTransaction({
              poolAddress: this.config.meteoraPoolAddress!,
              solAmount,
              usdcAmount,
              priceLower: priceRange.lowerPrice,
              priceUpper: priceRange.upperPrice,
            }, undefined); // NO jitoConfig - avoid duplicate tips!

            log.info('Got create position transaction', {
              positionMint: createTxResult.positionKeypair.publicKey.toBase58(),
              solAmount: createTxResult.solAmount,
              usdcAmount: createTxResult.usdcAmount,
            });

            // Step 5: Sign both transactions
            swapTxResult.transaction.sign([wallet]);
            createTxResult.transaction.feePayer = wallet.publicKey;
            createTxResult.transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
            createTxResult.transaction.partialSign(wallet, createTxResult.positionKeypair);

            // Step 6: Create Jito tip transaction (REQUIRED for bundles to land!)
            const { submitJitoBundle, getBundleStatus, createBundleTipTransaction } = await import('../utils/jitoUtils.js');

            const tipPriority = bundleAttempt === 1 ? 'normal' : 'high';
            const tipTx = await createBundleTipTransaction(
              wallet,
              {
                priority: tipPriority,
                attempt: bundleAttempt - 1,
              },
              connection
            );

            log.info('Created Jito tip transaction for bundle', {
              priority: tipPriority,
              attempt: bundleAttempt - 1,
            });

            // Step 7: Submit as Jito bundle (swap + create + tip)
            if (this.config.useJito) {
              log.info('📦 Submitting atomic Jito bundle with tip');

              const bundle = await submitJitoBundle([
                Buffer.from(swapTxResult.transaction.serialize()).toString('base64'),
                Buffer.from(createTxResult.transaction.serialize()).toString('base64'),
                Buffer.from(tipTx.serialize()).toString('base64'), // Tip MUST be last
              ], true);

              log.info('Bundle submitted to Jito', { bundleId: bundle.bundleId });

              // Poll bundle status (max 30 seconds)
              let bundleConfirmed = false;
              const maxPollTime = 30000; // 30 seconds
              const pollInterval = 2000; // 2 seconds
              const startPoll = Date.now();

              while (!bundleConfirmed && Date.now() - startPoll < maxPollTime) {
                await new Promise(resolve => setTimeout(resolve, pollInterval));

                const status = await getBundleStatus(bundle.bundleId);

                if (status.status === 'landed') {
                  bundleConfirmed = true;
                  log.info('✅ Jito bundle landed on-chain', {
                    bundleId: bundle.bundleId,
                    slot: status.landedSlot,
                    transactions: status.transactions,
                  });

                  // Extract signatures from bundle status
                  if (status.transactions && status.transactions.length >= 2) {
                    createSignatures.push(...status.transactions);
                  }
                  break;
                } else if (status.status === 'failed') {
                  throw new Error(`Jito bundle failed: ${bundle.bundleId}`);
                }

                log.debug('Bundle status', { status: status.status, elapsed: Date.now() - startPoll });
              }

              if (!bundleConfirmed) {
                throw new Error('Jito bundle confirmation timeout after 30s');
              }
            } else {
              // Fallback: Execute sequentially if Jito disabled
              log.warn('⚠️  Jito disabled, executing swap and create sequentially');

              const swapSig = await connection.sendTransaction(swapTxResult.transaction, {
                skipPreflight: true,
                maxRetries: 3,
              });

              log.info('Swap transaction submitted', { signature: swapSig });
              const swapBlockhash = await connection.getLatestBlockhash();
              await connection.confirmTransaction({
                signature: swapSig,
                ...swapBlockhash,
              });
              log.info('✅ Swap confirmed');

              const createSig = await connection.sendRawTransaction(
                createTxResult.transaction.serialize(),
                {
                  skipPreflight: false,
                  preflightCommitment: 'confirmed',
                }
              );

              log.info('Create position transaction submitted', { signature: createSig });
              const createBlockhash = await connection.getLatestBlockhash();
              await connection.confirmTransaction({
                signature: createSig,
                ...createBlockhash,
              });
              log.info('✅ Position created');

              createSignatures.push(swapSig, createSig);
            }

            newPositionMint = createTxResult.positionKeypair.publicKey.toBase58();

            log.info('✅ Position created successfully WITH swap', {
              positionMint: newPositionMint,
              signatures: createSignatures,
            });

            usedSwap = true;
            break; // Success!
          }

        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));

          // Check if insufficient funds error
          const isInsufficientFunds = this.isInsufficientFundsError(lastError);

          log.errorBanner(`Attempt ${attempt} failed: ${lastError.message}`, {
            attempt,
            maxRetries: this.config.autoTuneMaxRetries,
            isInsufficientFunds,
            willRetry: attempt < this.config.autoTuneMaxRetries,
          });

          // If insufficient funds on first attempt, retry with swap
          if (isInsufficientFunds && attempt === 1) {
            usedSwap = true;
            log.warn('⚠️  Will retry with Jupiter swap bundling');
            continue;
          }

          // If not insufficient funds, escalate Jito tips and retry
          if (!isInsufficientFunds && attempt < this.config.autoTuneMaxRetries) {
            log.info('Non-fund error detected, will retry with escalated tips on next attempt');
            continue;
          }

          // Max retries reached
          if (attempt >= this.config.autoTuneMaxRetries) {
            log.errorBanner('MAX RETRIES REACHED - Rebalance failed', {
              attempts: attempt,
              lastError: lastError.message,
            });
            throw lastError;
          }
        }
      }

      // ========================================================================
      // SUCCESS
      // ========================================================================

      const durationMs = Date.now() - startTime;

      log.info('✅ TWO-PHASE rebalance completed successfully', {
        oldPosition: oldPositionMint,
        newPosition: newPositionMint,
        attempts: attempt,
        usedSwap,
        signatures: [withdrawResult.signature, ...createSignatures],
        durationMs,
      });

      return {
        success: true,
        oldPositionMint,
        newPositionMint,
        claimedFees: withdrawResult.claimedFees,
        deposited: {
          sol: solAmount,
          usdc: usdcAmount,
        },
        signatures: [withdrawResult.signature, ...createSignatures],
        durationMs,
      };

    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      log.errorBanner('REBALANCE FAILED CATASTROPHICALLY', {
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
