/**
 * Auto-Tune Orchestrator
 *
 * Manages automatic position rebalancing for Meteora DLMM positions.
 *
 * Strategy:
 * 1. Monitor position composition every interval (e.g., 30s)
 * 2. Detect when position becomes imbalanced (e.g., > 80% in one token)
 * 3. Trigger three-phase rebalance flow:
 *    PHASE 1: Withdraw + Claim + Close (atomic TX)
 *    - Withdraw 100% from current position
 *    - Claim all accumulated fees
 *    - Close empty position (reclaim rent ~0.057 SOL)
 *
 *    PRE-FLIGHT CHECK:
 *    - Calculate target deposits (AUTO_TUNE_DEPOSIT_AMOUNT + claimed fees)
 *    - Check actual wallet balances
 *    - Determine if swap needed BEFORE position creation
 *
 *    SWAP PHASE (if needed):
 *    - Calculate exact shortfall for missing token
 *    - Respect dual reserves (MINIMUM_WALLET_BALANCE_SOL + RENT_RESERVE_SOL)
 *    - Execute Jupiter swap with 2% slippage buffer
 *    - Wait for confirmation (2s settle time)
 *
 *    PHASE 2: Create new position
 *    - Create new position centered at current price with:
 *      - Fixed bin count (e.g., 20 bins)
 *      - Target deposit amount + claimed fees (auto-compounding)
 *    - Simple retry logic: max 3 attempts with exponential backoff
 *
 * User Configuration (via .env):
 * - AUTO_TUNE_ENABLED: Enable/disable auto-tune mode
 * - AUTO_TUNE_BIN_COUNT: Number of bins (default: 20)
 * - AUTO_TUNE_CHECK_INTERVAL_MS: Check frequency (default: 30000 = 30s)
 * - AUTO_TUNE_IMBALANCE_THRESHOLD: Trigger threshold (default: 0.8 = 80%)
 * - AUTO_TUNE_DEPOSIT_TOKEN: Base token (SOL or USDC, default: SOL)
 * - AUTO_TUNE_DEPOSIT_AMOUNT: Amount of deposit token (default: 1.0)
 * - MINIMUM_WALLET_BALANCE_SOL: Permanent reserve (default: 0.2)
 * - RENT_RESERVE_SOL: Temporary reserve for rent/fees (default: 0.1)
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
      unclaimedFees: {
        sol: 0,
        usdc: 0,
      },
    };

    // Ensure backward compatibility: add unclaimedFees if missing from saved state
    if (this.state && !this.state.unclaimedFees) {
      this.state.unclaimedFees = {
        sol: 0,
        usdc: 0,
      };
    }

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
    console.log(`   Check Duration:   ${elapsed}ms`);
    const unclaimedSol = this.state.unclaimedFees?.sol ?? 0;
    const unclaimedUsdc = this.state.unclaimedFees?.usdc ?? 0;
    console.log(`   Unclaimed Fees:   ${unclaimedSol.toFixed(6)} SOL + ${unclaimedUsdc.toFixed(2)} USDC\n`);

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

        // Auto-create initial position if enabled
        if (this.config.autoCreatePositions && this.config.meteoraPoolAddress) {
          if (!this.watchMode) {
            log.info('🆕 No position found - auto-creating initial position');
          }

          try {
            await this.createInitialPosition();
            if (!this.watchMode) {
              log.info('✅ Initial position created successfully - will monitor on next cycle');
            }
          } catch (error) {
            log.error('Failed to create initial position', {
              error: error instanceof Error ? error.message : String(error),
            });
            this.state.consecutiveErrors++;
          }
        } else {
          if (!this.watchMode) {
            log.warn('No position found to monitor (AUTO_CREATE_POSITIONS not enabled)');
          }
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

          // Reset unclaimed fees to zero (fees were just claimed and compounded)
          this.state.unclaimedFees = {
            sol: 0,
            usdc: 0,
          };

          // Save last position created details
          this.state.lastPositionCreated = {
            positionMint: result.newPositionMint,
            initialDeposit: {
              sol: result.deposited.sol,
              usdc: result.deposited.usdc,
            },
            timestamp: Date.now(),
          };

          // Save state immediately after successful rebalance
          saveAutoTuneState(this.state);
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

      // Update unclaimed fees in state
      this.state.unclaimedFees = {
        sol: position.claimableSol,
        usdc: position.claimableUsdc,
      };

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
   * Execute full rebalance flow with THREE-PHASE approach:
   *
   * PHASE 1: Withdraw + Claim + Close
   * - Withdraw 100% from old position
   * - Claim all accumulated fees
   * - Close empty position (reclaim rent)
   * - Tokens now in wallet (likely imbalanced due to price movement)
   *
   * PRE-FLIGHT CHECK:
   * - Calculate target deposits: AUTO_TUNE_DEPOSIT_AMOUNT + claimed fees
   * - Check actual wallet balances (SOL + USDC)
   * - Determine if swap is needed BEFORE any position creation attempts
   *
   * SWAP PHASE (if needed):
   * - Calculate exact shortfall for missing token
   * - Respect dual reserves:
   *   - MINIMUM_WALLET_BALANCE_SOL (permanent, never touched)
   *   - RENT_RESERVE_SOL (temporary for rent/fees)
   * - Execute Jupiter swap with 2% slippage buffer
   * - Wait for confirmation (2s settle time)
   *
   * PHASE 2: Create new position
   * - Create new position centered at current price
   * - Simple retry logic: max 3 attempts with exponential backoff
   * - Retries are for network errors only (swap already executed if needed)
   */
  private async executeRebalance(): Promise<RebalanceResult> {
    const startTime = Date.now();

    try {
      // ========================================================================
      // PHASE 1: WITHDRAW + CLAIM + CLOSE
      // ========================================================================

      // Get current exposure before withdrawal
      const exposureBefore = await this.meteoraAdapter.getLpExposure();

      if (exposureBefore.positions.length === 0) {
        throw new Error('No position to rebalance');
      }

      // Use the ACTUAL position from on-chain data, not from stale list
      const oldPositionMint = exposureBefore.positions[0].mint;
      log.info(`🔄 Rebalancing position ${oldPositionMint.slice(0, 8)}...`);

      // Execute Phase 1: Withdraw + Claim + Close in ONE transaction
      const withdrawResult = await this.meteoraAdapter.withdrawClaimAndClose(oldPositionMint);
      log.info(`✅ Phase 1: Claimed ${withdrawResult.claimedFees.sol.toFixed(4)} SOL + ${withdrawResult.claimedFees.usdc.toFixed(2)} USDC`);

      // ========================================================================
      // PHASE 2: CREATE NEW POSITION WITH INTELLIGENT RETRY
      // ========================================================================

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

      // ========================================================================
      // PRE-FLIGHT CHECK: Determine if we need to swap before position creation
      // ========================================================================
      const wallet = getWalletKeypair();
      const solBalance = await connection.getBalance(wallet.publicKey);
      const actualSol = solBalance / Math.pow(10, 9);
      const actualUsdc = await this.getUsdcBalance();

      // Determine if swap is needed BEFORE any attempts
      const needsSwap = actualSol < solAmount || actualUsdc < usdcAmount;

      // ========================================================================
      // SWAP EXECUTION (if needed): Execute BEFORE position creation
      // ========================================================================
      if (needsSwap) {
        const missingToken = actualSol < solAmount ? 'SOL' : 'USDC';
        const shortfall = actualSol < solAmount ? solAmount - actualSol : usdcAmount - actualUsdc;
        log.warn(`⚠️  Insufficient ${missingToken} (need ${shortfall.toFixed(4)} more) - executing swap`);

        // Calculate swap needed with reserves
        const totalReserve = this.config.minimumWalletBalanceSol + this.config.rentReserveSol;
        const availableSol = Math.max(0, actualSol - totalReserve);

        // Calculate shortfall for each token
        const solShortfall = Math.max(0, solAmount - availableSol);
        const usdcShortfall = Math.max(0, usdcAmount - actualUsdc);

        let swapParams: any = null;

        // Determine swap direction based on shortfall
        if (solShortfall > 0 && usdcShortfall === 0) {
          // Need more SOL, have enough USDC - swap USDC → SOL
          const usdcToSwap = solShortfall * currentPrice * 1.02; // +2% buffer for slippage
          if (actualUsdc >= usdcToSwap) {
            swapParams = {
              inputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
              outputMint: 'So11111111111111111111111111111111111111112', // SOL
              amount: usdcToSwap,
            };
            log.info(`🔄 Swapping ${usdcToSwap.toFixed(2)} USDC → SOL`);
          } else {
            throw new Error(`Insufficient USDC for swap. Need ${usdcToSwap}, have ${actualUsdc}`);
          }
        } else if (usdcShortfall > 0 && solShortfall === 0) {
          // Need more USDC, have enough SOL - swap SOL → USDC
          const solToSwap = (usdcShortfall / currentPrice) * 1.02; // +2% buffer for slippage
          if (availableSol >= solToSwap) {
            swapParams = {
              inputMint: 'So11111111111111111111111111111111111111112', // SOL
              outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
              amount: solToSwap,
            };
            log.info(`🔄 Swapping ${solToSwap.toFixed(4)} SOL → USDC`);
          } else {
            throw new Error(`Insufficient SOL for swap. Need ${solToSwap}, have ${availableSol}`);
          }
        } else if (solShortfall > 0 && usdcShortfall > 0) {
          throw new Error(`Insufficient balance for both SOL and USDC. Need ${solShortfall} more SOL and ${usdcShortfall} more USDC`);
        }

        if (!swapParams) {
          throw new Error('Could not calculate swap parameters');
        }

        // Execute swap
        const swapResult = await this.jupiterSwapper.executeSwap(swapParams);
        log.info(`✅ Swap complete: ${swapResult.outputAmount.toFixed(4)} received (impact: ${swapResult.priceImpactPct.toFixed(2)}%)`);

        // Wait for balance to update
        await new Promise(resolve => setTimeout(resolve, 2000));
      }

      // ========================================================================
      // POSITION CREATION: Now create position with updated balance
      // ========================================================================

      // Attempt to create position with intelligent retry
      let attempt = 0;
      let newPositionMint = '';
      let createSignatures: string[] = [];
      let lastError: Error | null = null;
      let usedSwap = needsSwap; // Track if we used swap

      while (attempt < this.config.autoTuneMaxRetries) {
        attempt++;

        try {
          if (attempt > 1) {
            log.info(`🔄 Retry ${attempt}/${this.config.autoTuneMaxRetries}`);
          }

          // Create position directly (swap already executed if needed)
          const result = await this.meteoraAdapter.createPosition({
            poolAddress: this.config.meteoraPoolAddress!,
            solAmount,
            usdcAmount,
            priceLower: priceRange.lowerPrice,
            priceUpper: priceRange.upperPrice,
          });

          newPositionMint = result.positionMint;
          createSignatures.push(result.signature);

          log.info(`✅ Position created: ${newPositionMint.slice(0, 8)}...`);
          break; // Success - exit retry loop

        } catch (error) {
          lastError = error as Error;

          if (attempt >= this.config.autoTuneMaxRetries) {
            log.errorBanner(`Position creation failed after ${attempt} attempts`, {
              error: lastError.message,
            });
            throw lastError;
          }

          // Wait before retry
          const waitMs = 1000 * attempt; // Exponential backoff
          log.warn(`❌ Failed: ${lastError.message.substring(0, 80)}... (retry in ${waitMs}ms)`);
          await new Promise(resolve => setTimeout(resolve, waitMs));
        }
      }

      // ========================================================================
      // SUCCESS
      // ========================================================================

      const durationMs = Date.now() - startTime;
      log.info(`✅ Rebalance complete in ${(durationMs / 1000).toFixed(1)}s${usedSwap ? ' (with swap)' : ''}`);

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

      log.errorBanner('Rebalance failed', {
        error: errorMessage,
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
   * Create initial position when auto-tune starts with no existing positions
   * Uses configuration from .env (INITIAL_DEPOSIT_SOL, INITIAL_DEPOSIT_USDC, PRICE_RANGE_BPS)
   * Includes pre-flight balance check and automatic swap if needed
   */
  private async createInitialPosition(): Promise<void> {
    const startTime = Date.now();

    log.info('🆕 Creating initial position for auto-tune', {
      poolAddress: this.config.meteoraPoolAddress,
      depositSol: this.config.initialDepositSol,
      depositUsdc: this.config.initialDepositUsdc,
      binCount: this.config.autoTuneBinCount,
    });

    try {
      // Get current price and pool info
      const connection = getConnection();
      const poolPubkey = new PublicKey(this.config.meteoraPoolAddress!);
      const dlmmPool = await DLMM.create(connection, poolPubkey);

      const activeBinData = await getActiveBin(dlmmPool);
      const activeBinPrice = activeBinData.pricePerToken;
      const currentBinId = activeBinData.binId;
      const binStep = dlmmPool.lbPair.binStep;

      log.info('Pool state', {
        currentPrice: activeBinPrice,
        activeBinId: currentBinId,
        binStep,
      });

      // Calculate centered price range for initial position
      const priceRange = calculateCenteredPriceRange(
        activeBinPrice,
        currentBinId,
        binStep,
        this.config.autoTuneBinCount,
        DECIMALS.SOL,
        DECIMALS.USDC
      );

      log.info('Calculated price range for initial position', {
        lowerPrice: priceRange.lowerPrice,
        upperPrice: priceRange.upperPrice,
        binCount: this.config.autoTuneBinCount,
      });

      // Use AUTO_TUNE_DEPOSIT_TOKEN and AUTO_TUNE_DEPOSIT_AMOUNT (same as rebalance)
      // Calculate balanced deposits for the centered price range
      const baseToken = this.config.autoTuneDepositToken;
      const baseAmount = this.config.autoTuneDepositAmount;

      let solAmount: number;
      let usdcAmount: number;

      if (baseToken === 'SOL') {
        // Base is SOL: calculate USDC needed for balanced position
        solAmount = baseAmount;
        // For balanced position around active bin, we need roughly equal USD value
        usdcAmount = solAmount * activeBinPrice;
      } else {
        // Base is USDC: calculate SOL needed for balanced position
        usdcAmount = baseAmount;
        // For balanced position, roughly equal USD value
        solAmount = usdcAmount / activeBinPrice;
      }

      log.info('Calculated initial deposit amounts (balanced for centered range)', {
        baseToken,
        baseAmount,
        sol: solAmount,
        usdc: usdcAmount,
        activeBinPrice,
        totalValueUsd: solAmount * activeBinPrice + usdcAmount,
      });

      // ========================================================================
      // PRE-FLIGHT CHECK: Determine if we need to swap before position creation
      // ========================================================================
      const wallet = getWalletKeypair();
      const solBalance = await connection.getBalance(wallet.publicKey);
      const actualSol = solBalance / Math.pow(10, 9);
      const actualUsdc = await this.getUsdcBalance();

      log.info('💰 Pre-flight wallet balance check', {
        actualSol,
        actualUsdc,
        requiredSol: solAmount,
        requiredUsdc: usdcAmount,
        hasSufficientSol: actualSol >= solAmount,
        hasSufficientUsdc: actualUsdc >= usdcAmount,
      });

      // Determine if swap is needed BEFORE any attempts
      const needsSwap = actualSol < solAmount || actualUsdc < usdcAmount;

      if (needsSwap) {
        log.warn('⚠️  Insufficient balance detected - swap will be required', {
          missingToken: actualSol < solAmount ? 'SOL' : 'USDC',
          shortfall: actualSol < solAmount
            ? { token: 'SOL', need: solAmount, have: actualSol, missing: solAmount - actualSol }
            : { token: 'USDC', need: usdcAmount, have: actualUsdc, missing: usdcAmount - actualUsdc },
        });

        // Get current price for swap calculation
        const solPriceData = await getSolPrice();
        const currentPrice = solPriceData.usd;

        // Calculate exact swap needed to cover the shortfall
        let swapParams: { inputMint: string; outputMint: string; amount: number };

        if (actualSol < solAmount) {
          // Need more SOL: swap USDC → SOL
          const missingSol = solAmount - actualSol;
          const missingUsdValue = missingSol * currentPrice;
          // Add 1% buffer for price impact and fees
          const swapAmount = missingUsdValue * 1.01;

          swapParams = {
            inputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
            outputMint: 'So11111111111111111111111111111111111111112', // SOL
            amount: swapAmount,
          };

          log.info('Swapping USDC → SOL to cover shortfall', {
            missingSol,
            swapAmountUsdc: swapAmount,
          });
        } else {
          // Need more USDC: swap SOL → USDC
          const missingUsdc = usdcAmount - actualUsdc;
          const missingSolEquiv = missingUsdc / currentPrice;
          // Add 1% buffer for price impact and fees
          const swapAmount = missingSolEquiv * 1.01;

          swapParams = {
            inputMint: 'So11111111111111111111111111111111111111112', // SOL
            outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
            amount: swapAmount,
          };

          log.info('Swapping SOL → USDC to cover shortfall', {
            missingUsdc,
            swapAmountSol: swapAmount,
          });
        }

        log.info(`🔄 Swapping ${actualSol < solAmount ? swapParams.amount.toFixed(2) + ' USDC → SOL' : swapParams.amount.toFixed(4) + ' SOL → USDC'}`);

        // Execute swap sequentially (same as rebalance flow)
        const swapResult = await this.jupiterSwapper.executeSwap(swapParams);
        log.info(`✅ Swap complete: ${swapResult.outputAmount.toFixed(4)} received (impact: ${swapResult.priceImpactPct.toFixed(2)}%)`);

        // Wait for balance to update
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Now create position with updated balance
        const result = await this.meteoraAdapter.createPosition({
          poolAddress: this.config.meteoraPoolAddress!,
          solAmount,
          usdcAmount,
          priceLower: priceRange.lowerPrice,
          priceUpper: priceRange.upperPrice,
        });

        log.info('✅ Initial position created with swap', {
          positionMint: result.positionMint,
          signature: result.signature,
        });

        // Save position mint to state
        this.state.currentPositionMint = result.positionMint;
        this.state.lastPositionCreated = {
          positionMint: result.positionMint,
          initialDeposit: { sol: solAmount, usdc: usdcAmount },
          timestamp: Date.now(),
        };
        saveAutoTuneState(this.state);
      } else {
        // No swap needed - create position directly
        log.info('✅ Wallet has sufficient balance - creating position without swap');

        const result = await this.meteoraAdapter.createPosition({
          poolAddress: this.config.meteoraPoolAddress!,
          solAmount,
          usdcAmount,
          priceLower: priceRange.lowerPrice,
          priceUpper: priceRange.upperPrice,
        });

        log.info('✅ Initial position created successfully', {
          positionMint: result.positionMint,
          signature: result.signature,
        });

        // Save position mint to state
        this.state.currentPositionMint = result.positionMint;
        this.state.lastPositionCreated = {
          positionMint: result.positionMint,
          initialDeposit: { sol: solAmount, usdc: usdcAmount },
          timestamp: Date.now(),
        };
        saveAutoTuneState(this.state);
      }

      const durationMs = Date.now() - startTime;
      log.info('✅ Initial position creation completed', {
        positionMint: this.state.currentPositionMint,
        durationMs,
      });

    } catch (error) {
      const durationMs = Date.now() - startTime;
      log.error('Failed to create initial position', {
        error: error instanceof Error ? error.message : String(error),
        durationMs,
      });
      throw error;
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
