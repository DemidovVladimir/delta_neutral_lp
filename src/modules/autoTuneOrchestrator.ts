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
import { MeteoraAdapter } from './meteoraAdapter.js';
import { JupiterSwapper } from './jupiterSwapper.js';
import { JupiterPerpsEngine } from './jupiterPerpsEngine.js';
import { planSwapForDeposit, type SwapPlan } from './swapPlanner.js';
import { getConfig } from '../config/env.js';
import { log } from '../utils/logger.js';
import { getConnection, getWalletKeypair } from '../utils/solana.js';
import { closeEmptyTokenAccounts } from './walletJanitor.js';
import { computeLpHedgeDelta, type LpHedgeRegime } from './hedgeController.js';
import { DLMM } from '../utils/dlmm.js';
import { DECIMALS } from '../config/constants.js';
import { getSolPrice } from '../core/priceOracle.js';
import {
  checkPositionImbalance,
  calculateCenteredPriceRange,
  getActiveBin,
  getPriceFromBinId,
  isWalletBalancedFor5050,
} from '../utils/meteoraUtils.js';
import {
  AutoTuneState,
  LpExposure,
  PositionBalance,
  RebalanceResult,
} from '../types/index.js';
import {
  saveAutoTuneState,
  loadAutoTuneState,
  addClaimedLpFees,
  updateUnclaimedLpFees,
} from './persistence.js';
import { trackBatchTransactionFees } from '../utils/transactionUtils.js';
import {
  recordPositionSnapshot,
  recordRebalanceTriggered,
  recordRebalanceCompleted,
  recordHedgeAction,
  findOpenPositionIdByMint,
} from './pnlDb.js';

// Token mint addresses
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const USDC_MINT_ADDRESS = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const USDC_MINT = new PublicKey(USDC_MINT_ADDRESS);

export class AutoTuneOrchestrator {
  private config = getConfig();
  private meteoraAdapter: MeteoraAdapter;
  private jupiterSwapper: JupiterSwapper;
  /** Perps hedge (ADR-017). Null = disabled (HEDGE_ENABLED=false or init/error kill switch). */
  private hedgeEngine: JupiterPerpsEngine | null = null;
  /**
   * Hedge failures are isolated: they must never kill the LP loop, so they get
   * their own counter (NOT state.consecutiveErrors, which stops the bot at 5).
   * At 5 consecutive hedge errors the hedge alone is disabled for the session.
   */
  private hedgeConsecutiveErrors = 0;
  /**
   * Consecutive cycles the controller WANTED to act but a guard refused
   * (action 'blocked'). BUG-012 sat blocked-at-cap for 5.5h with nothing
   * louder than debug-level rows in pnl.db — escalate to a banner instead.
   */
  private hedgeBlockedStreak = 0;
  private state: AutoTuneState;
  private intervalHandle?: NodeJS.Timeout;
  private watchMode: boolean;

  constructor(watchMode: boolean = false) {
    this.watchMode = watchMode;
    this.meteoraAdapter = new MeteoraAdapter();
    this.jupiterSwapper = new JupiterSwapper();
    this.hedgeEngine = this.config.hedgeEnabled ? new JupiterPerpsEngine() : null;

    // Load saved state or initialize new state
    const savedState = loadAutoTuneState();
    if (savedState) {
      // `running` is a runtime flag. A process that died without stop() leaves
      // it persisted as true, which made start() bail on every subsequent boot
      // (BUG-008: container restart-looped for hours doing nothing).
      savedState.running = false;
    }
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

    // Guard on the actual interval handle, not the persisted flag: only a
    // second start() within THIS process is a real double-start (BUG-008).
    if (this.intervalHandle) {
      log.warn('Auto-tune loop already running');
      return;
    }

    log.info('Starting auto-tune loop', {
      checkIntervalMs: this.config.autoTuneCheckIntervalMs,
      binCount: this.config.autoTuneBinCount,
      imbalanceThreshold: this.config.autoTuneImbalanceThreshold,
    });

    // Bring up the hedge engine before the first cycle. Init failure disables
    // the hedge for the session but never blocks the LP loop.
    if (this.hedgeEngine) {
      try {
        await this.hedgeEngine.initialize();
        if (!this.config.hedgeDryRun) {
          log.errorBanner('⚠️  HEDGE IS LIVE — perp mutations WILL be sent', {
            targetDeltaSol: this.config.hedgeTargetDeltaSol,
            bandSol: this.config.deltaThresholdSol,
            notionalCap: `auto: ${this.config.hedgeNotionalCapMult}× bag (ADR-022)`,
            absoluteCeilingUsd: this.config.maxHedgeNotionalUsd || 'none',
            targetCollateralRatio: this.config.hedgeTargetCollateralRatio,
          });
        } else {
          log.info('Hedge enabled in DRY-RUN mode — decisions simulated, nothing sent', {
            targetDeltaSol: this.config.hedgeTargetDeltaSol,
            bandSol: this.config.deltaThresholdSol,
          });
        }
      } catch (error) {
        log.errorBanner('❌ Hedge engine failed to initialize — running LP-only this session', {
          error: error instanceof Error ? error.message : String(error),
        });
        this.hedgeEngine = null;
      }
    }

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

    await this.hedgeEngine?.shutdown().catch(() => {});

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
      console.log('⚠️  NO POSITION FOUND');

      // Check if we have a position mint in state but couldn't find it
      if (this.state.currentPositionMint) {
        console.log(`   Last known position: ${this.state.currentPositionMint.slice(0, 12)}...`);
        console.log('   Status: Position may be closed or not found on-chain\n');
      } else {
        console.log('   No position has been created yet\n');
      }

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
   * Run a single check cycle. Guarded against overlap: setInterval keeps
   * firing while a long rebalance is still awaiting, and overlapping cycles
   * race on position discovery and shared state (BUG-009, seen live at
   * 2026-07-04T04:33Z). A tick that arrives mid-cycle is skipped.
   */
  private cycleInFlight = false;

  /**
   * Cycles in a row with NO LP position on-chain. Guards the hedge unwind
   * (BUG-011): the perp may only be unwound after the no-LP state persists
   * for a full grace window — a transient gap between "old position closed"
   * and "new position created" must never strip the hedge while the LP's
   * funds sit in the wallet, least of all during the fast move that made
   * the re-creation fail.
   */
  private consecutiveNoLpCycles = 0;
  private static readonly NO_LP_HEDGE_GRACE_CYCLES = 20; // ≈5 min at 15s cycles

  /**
   * ADR-021 storm mode: rolling ~6-minute window of oracle prices (one
   * sample per cycle). When the |5-minute move| exceeds LP_VOL_PAUSE_PCT_5M
   * the LP recenter pauses (no fresh positions into a falling knife) while
   * the hedge, via the out-of-range clamp, shorts the position's full SOL
   * bag — a reversible synthetic exit to USDC. Hysteresis: the storm ends
   * only when the move drops below half the threshold.
   */
  private priceSamples: { t: number; p: number }[] = [];
  private lastMove5mPct = 0;
  private volStormActive = false;
  /** Sticky out-of-range clamp regime for the hedge input (ADR-021). */
  private lpHedgeRegime: LpHedgeRegime = 'in';

  private recordPriceSample(price: number): void {
    const now = Date.now();
    if (price > 0) this.priceSamples.push({ t: now, p: price });
    const cutoff = now - 6 * 60 * 1000;
    while (this.priceSamples.length > 0 && this.priceSamples[0].t < cutoff) {
      this.priceSamples.shift();
    }
    const threshold = this.config.lpVolPausePct5m;
    if (!threshold) {
      this.volStormActive = false;
      return;
    }
    const ref = this.priceSamples.find((sample) => now - sample.t >= 4 * 60 * 1000);
    if (!ref || !(ref.p > 0)) {
      this.lastMove5mPct = 0;
      return; // not enough history — keep current storm state
    }
    this.lastMove5mPct = Math.abs(price / ref.p - 1) * 100;
    if (this.volStormActive) {
      if (this.lastMove5mPct < threshold / 2) {
        this.volStormActive = false;
        log.info('🌤  Storm over — LP recentering resumes', { move5mPct: this.lastMove5mPct });
      }
    } else if (this.lastMove5mPct > threshold) {
      this.volStormActive = true;
      log.warn('🌩  Volatility storm detected — LP recentering paused', {
        move5mPct: this.lastMove5mPct,
        thresholdPct: threshold,
      });
    }
  }

  private isVolStormActive(_currentPrice: number): boolean {
    return this.volStormActive;
  }

  private async runCheckCycle(): Promise<void> {
    if (this.cycleInFlight) {
      log.info('⏭️  Skipping check cycle — previous cycle still in flight');
      return;
    }
    this.cycleInFlight = true;
    try {
      await this.runCheckCycleInner();
      await this.maybeRunJanitor();
    } finally {
      this.cycleInFlight = false;
    }
  }

  /**
   * Wallet hygiene (operator standing order 2026-07-04): reclaim rent from
   * empty legacy token accounts — at startup and every 6h after. Protected
   * mints (wSOL/USDC) are excluded inside the janitor; failures never touch
   * the trading loop.
   */
  private lastJanitorRunMs = 0;
  private static readonly JANITOR_INTERVAL_MS = 6 * 60 * 60 * 1000;

  private async maybeRunJanitor(): Promise<void> {
    if (!this.config.walletJanitorEnabled) return;
    const now = Date.now();
    if (now - this.lastJanitorRunMs < AutoTuneOrchestrator.JANITOR_INTERVAL_MS) return;
    this.lastJanitorRunMs = now;
    await closeEmptyTokenAccounts(getConnection(), getWalletKeypair(), false);
  }

  private async runCheckCycleInner(): Promise<void> {
    const startTime = Date.now();
    this.state.iteration++;
    this.state.lastCheck = startTime;

    if (!this.watchMode) {
      log.infoSampled('🔍 Auto-tune check cycle started', {
        iteration: this.state.iteration,
        rebalanceCount: this.state.rebalanceCount,
      });
    }

    try {
      // Fetch price once for entire check cycle (shared across rebalance + fee tracking)
      const solPriceData = await getSolPrice();
      const currentPrice = solPriceData.usd;
      this.recordPriceSample(currentPrice);
      log.debug('Using SOL price for check cycle', { price: currentPrice, source: solPriceData.source });

      // 1. Check position balance (also yields the LpExposure the hedge needs)
      const { balance, exposure } = await this.checkPositionBalance();

      if (!balance) {
        const elapsed = Date.now() - startTime;
        this.displayWatchMode(null, elapsed);
        // No LP position. The hedge must still see this (exposure ≈ 0): a
        // leftover perp with no LP is naked directional risk to unwind. Skip
        // only when we create a position below (exposure would be stale).
        let lpMutatedThisCycle = false;

        // Auto-create initial position if enabled
        if (this.config.autoCreatePositions && this.config.meteoraPoolAddress) {
          // Safety check: discover positions one more time before creating
          // This prevents duplicate position creation if position exists but wasn't found
          const discoveredBeforeCreate = await this.meteoraAdapter.discoverPositionsFromBlockchain();

          if (discoveredBeforeCreate.length > 0) {
            log.warn('⚠️  Position(s) found on blockchain during safety check - skipping creation', {
              count: discoveredBeforeCreate.length,
              mints: discoveredBeforeCreate,
            });
            this.state.consecutiveErrors = 0;
            saveAutoTuneState(this.state);
            return;
          }

          if (!this.watchMode) {
            log.info('🆕 No position found - auto-creating initial position');
          }

          try {
            await this.createInitialPosition();
            lpMutatedThisCycle = true;
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

        // Safety (BUG-011, 2026-07-05): a rebalance that closed the old
        // position but FAILED to create the new one leaves the LP's SOL in
        // the wallet while exposure reads 0 — and the controller would then
        // UNWIND the protective short (decreases are never guard-blocked) in
        // the middle of exactly the kind of fast move that makes creations
        // fail. Defer hedge decisions until the no-LP state has persisted a
        // full grace window and is therefore real (operator wind-down), not
        // a mid-rebalance gap. A created-this-cycle position skips the hedge
        // anyway (stale exposure), so only the failed-creation path defers.
        this.consecutiveNoLpCycles++;
        if (
          lpMutatedThisCycle ||
          this.consecutiveNoLpCycles >= AutoTuneOrchestrator.NO_LP_HEDGE_GRACE_CYCLES
        ) {
          await this.maybeRebalanceHedge(exposure, lpMutatedThisCycle);
        } else {
          log.warn('⏳ Hedge decision deferred — no LP position, funds may be mid-rebalance', {
            noLpCycles: this.consecutiveNoLpCycles,
            graceCycles: AutoTuneOrchestrator.NO_LP_HEDGE_GRACE_CYCLES,
          });
        }

        this.state.consecutiveErrors = 0;
        saveAutoTuneState(this.state);
        return;
      }

      // An LP position exists again — the no-LP grace counter starts over.
      this.consecutiveNoLpCycles = 0;

      if (!this.watchMode) {
        // ALWAYS log at INFO (not sampled) — this is the precondition state
        // for every rebalance-trigger decision below. If executeRebalance
        // fails on iteration N, the operator needs to know the exact
        // composition + price + range that caused the trigger. With sampling
        // we'd lose that context 90% of the time in GCP. Heartbeat-style
        // logs (cycle start/end, "balanced — no action needed") remain
        // sampled because they don't carry causal information.
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

      // 2. Trigger rebalance if imbalanced — unless a storm is raging
      // (ADR-021). Recentering into a fast one-way move recreates the
      // position straight into the falling knife and realizes a fresh
      // traversal's IL every few minutes (the measured trend tax); during a
      // storm we hold the one-sided position instead, and the hedge's
      // out-of-range clamp shorts the full SOL bag — a reversible synthetic
      // exit to USDC. Recentering resumes when the 5-minute move calms.
      if (balance.isImbalanced && this.isVolStormActive(currentPrice)) {
        log.warn('🌩  Storm mode: LP recenter PAUSED, hedge clamps to full position delta', {
          move5mPct: this.lastMove5mPct,
          thresholdPct: this.config.lpVolPausePct5m,
          solPercent: balance.solPercent,
          usdcPercent: balance.usdcPercent,
        });
      } else if (balance.isImbalanced) {
        if (!this.watchMode) {
          log.warn('⚠️  Position imbalanced - triggering rebalance', {
            reason: balance.reason,
            solPercent: balance.solPercent,
            usdcPercent: balance.usdcPercent,
          });
        }

        const result = await this.executeRebalance(currentPrice, balance);

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

          // Accumulate claimed fees (for backward compatibility with auto-tune-state.json)
          this.state.totalClaimedFees.sol += result.claimedFees.sol;
          this.state.totalClaimedFees.usdc += result.claimedFees.usdc;

          // Reset unclaimed fees to zero (fees were just claimed and compounded)
          this.state.unclaimedFees = {
            sol: 0,
            usdc: 0,
          };

          // Track claimed fees in state.json for unified profit calculation
          addClaimedLpFees(
            result.claimedFees.sol,
            result.claimedFees.usdc,
            result.signatures[0] // Use first signature (withdraw+claim+close tx)
          );

          // Save last position created details
          this.state.lastPositionCreated = {
            positionMint: result.newPositionMint,
            initialDeposit: {
              sol: result.deposited.sol,
              usdc: result.deposited.usdc,
            },
            timestamp: Date.now(),
          };

          // Track transaction fees for rebalance operations
          // Using price fetched at start of check cycle
          if (result.signatures.length > 0) {
            const connection = getConnection();

            // Track fees asynchronously (don't wait for it to complete)
            trackBatchTransactionFees(
              connection,
              result.signatures,
              'rebalance',
              currentPrice
            ).catch(err => {
              log.warn('Failed to track rebalance transaction fees', {
                error: err instanceof Error ? err.message : String(err),
              });
            });
          }

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
          log.infoSampled('✓ Position balanced - no action needed', {
            solPercent: balance.solPercent,
            usdcPercent: balance.usdcPercent,
          });
        }
        this.state.consecutiveErrors = 0;
      }

      // 3. Hedge controller (ADR-017). Runs every cycle EXCEPT when the LP was
      // rebalanced above — then `exposure` predates the new position and the
      // next 30s cycle will see fresh on-chain state instead.
      await this.maybeRebalanceHedge(exposure, balance.isImbalanced);

      saveAutoTuneState(this.state);

      const elapsed = Date.now() - startTime;

      // Display watch mode or log
      this.displayWatchMode(balance, elapsed);

      if (!this.watchMode) {
        log.infoSampled('Auto-tune check cycle completed', {
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
   * Check current position balance. Also returns the LpExposure it fetched —
   * the hedge controller consumes `exposure.solAmount` every cycle (ADR-017),
   * and reusing this read avoids a second RPC round-trip. `exposure` is a
   * zeroed object (not null) when there is simply no LP position: "no LP" is a
   * real exposure of 0 that the hedge must still see (to unwind a stale perp).
   */
  private async checkPositionBalance(): Promise<{
    balance: PositionBalance | null;
    exposure: LpExposure | null;
  }> {
    try {
      // ALWAYS discover positions from blockchain first to ensure we don't miss unclosed positions
      const discoveredMints = await this.meteoraAdapter.discoverPositionsFromBlockchain();

      if (discoveredMints.length > 0) {
        log.info('✅ Position(s) found on blockchain', {
          count: discoveredMints.length,
          mints: discoveredMints,
        });
      }

      // Get LP exposure from MeteoraAdapter (will use discovered positions)
      const exposure = await this.meteoraAdapter.getLpExposure();

      if (exposure.positions.length === 0) {
        log.warn('No positions found to check balance');
        return { balance: null, exposure };
      }

      // Use the first position (auto-tune manages single position)
      const position = exposure.positions[0];
      this.state.currentPositionMint = position.mint;

      // Save position mint to state immediately to prevent loss
      saveAutoTuneState(this.state);

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

      // Update unclaimed fees in auto-tune state (for backward compatibility)
      this.state.unclaimedFees = {
        sol: position.claimableSol,
        usdc: position.claimableUsdc,
      };

      // Update unclaimed fees in state.json for unified tracking
      updateUnclaimedLpFees(position.claimableSol, position.claimableUsdc);

      // PnL DB: per-tick snapshot. We have everything we need in scope —
      // current price, principal token amounts, unclaimed fees, composition.
      // The DB helper computes the three HODL benchmark values from the
      // open-position row (no extra orchestrator math needed). Skipped
      // silently when the position pre-existed the DB.
      recordPositionSnapshot({
        positionMint: position.mint,
        currentPriceSolUsd: currentPrice,
        positionSol: position.solAmount,
        positionUsdc: position.usdcAmount,
        unclaimedFeesSol: position.claimableSol,
        unclaimedFeesUsdc: position.claimableUsdc,
        compositionSolPct: imbalanceCheck.solPercent,
        compositionUsdcPct: imbalanceCheck.usdcPercent,
      });

      return {
        balance: {
          solPercent: imbalanceCheck.solPercent,
          usdcPercent: imbalanceCheck.usdcPercent,
          isImbalanced: imbalanceCheck.isImbalanced,
          currentPrice,
          lowerPrice: lowerBinPrice,
          upperPrice: upperBinPrice,
          reason: imbalanceCheck.reason,
        },
        exposure,
      };
    } catch (error) {
      log.error('Failed to check position balance', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Run the perps hedge controller once for this cycle (ADR-017).
   *
   * Isolation contract: NOTHING thrown here may kill the LP loop. Hedge
   * failures increment their own counter; at 5 consecutive failures the hedge
   * alone is disabled for the session (loud banner) while LP keeps running.
   *
   * Skips when: the hedge is disabled/dead, the exposure read failed (never
   * act on a transient failure — it would look like "LP gone → close the
   * hedge"), or the LP was mutated this cycle (exposure is stale; the next
   * cycle sees fresh state). The keeper-fill cooldown itself lives in the
   * decision core and is fed from persisted state, so a restart right after a
   * live TX1 cannot double-hedge.
   */
  private async maybeRebalanceHedge(
    exposure: LpExposure | null,
    lpMutatedThisCycle: boolean,
  ): Promise<void> {
    if (!this.hedgeEngine) return;
    if (!exposure) {
      log.debug('Hedge skipped: no LP exposure reading this cycle');
      return;
    }
    if (lpMutatedThisCycle) {
      log.debug('Hedge skipped: LP mutated this cycle — exposure is stale until next cycle');
      return;
    }

    const dryRun = this.config.hedgeDryRun;
    try {
      // ADR-019: in 'midpoint' mode the controller sees the SOL half of the
      // LP's value (~constant per position) instead of the live composition,
      // so bin wiggle and LP recenters stop generating hedge churn. Price
      // read is cached; on failure we fall back to the live reading rather
      // than skip the cycle.
      let hedgeExposure = exposure;
      if (this.config.hedgeLpInput === 'midpoint') {
        try {
          const price = (await getSolPrice()).usd;
          const clamp = computeLpHedgeDelta(
            exposure.solAmount,
            exposure.usdcAmount,
            price,
            this.lpHedgeRegime,
          );
          if (clamp.regime !== this.lpHedgeRegime) {
            log.warn('Hedge input regime changed (ADR-021 out-of-range clamp)', {
              from: this.lpHedgeRegime,
              to: clamp.regime,
              deltaSol: clamp.deltaSol,
              liveSol: exposure.solAmount,
            });
            this.lpHedgeRegime = clamp.regime;
          }
          hedgeExposure = { ...exposure, solAmount: clamp.deltaSol };
          log.debug('Hedge input: LP delta', {
            liveSol: exposure.solAmount,
            hedgeSol: clamp.deltaSol,
            regime: clamp.regime,
            price,
          });
        } catch (priceError) {
          log.warn('Hedge delta price read failed — using live LP exposure this cycle', {
            error: priceError instanceof Error ? priceError.message : String(priceError),
          });
        }
      }

      const result = await this.hedgeEngine.rebalanceHedge(hedgeExposure, {
        dryRun,
        lastActionAtMs: this.state.hedge?.lastActionAt ?? null,
        rawLpExposure: exposure, // ADR-022: auto-cap sizes off the unclamped LP value
      });

      if (result.action === 'none') {
        // Sampled INFO (1-in-10) so production logs show a periodic heartbeat
        // that the hedge is alive and in band — debug is invisible at the
        // default server LOG_LEVEL, and a line every cycle would be noise.
        log.infoSampled('Hedge: no action', {
          reason: result.blockedReason ?? 'in band',
          netDeltaSol: result.deltaBefore.netDeltaSol,
          targetDeltaSol: result.deltaBefore.targetDeltaSol,
        });
      } else {
        const logFn = result.action === 'blocked' ? log.warn : log.info;
        logFn(`🎯 Hedge ${dryRun ? '[DRY-RUN] ' : ''}${result.action}`, {
          adjustedSol: result.adjustedSol,
          blockedReason: result.blockedReason,
          delta: result.deltaBefore,
          detail: result.mutation?.detail,
          signatures: result.signatures,
          simulated: result.mutation?.simulated?.success,
        });
        recordHedgeAction({
          venue: this.hedgeEngine.venue,
          action: result.action,
          dryRun,
          lpSol: result.deltaBefore.lpSolExposure,
          perpBaseSol: result.deltaBefore.longSol - result.deltaBefore.shortSol,
          targetDeltaSol: result.deltaBefore.targetDeltaSol,
          netDeltaSol: result.deltaBefore.netDeltaSol,
          adjustedSol: result.adjustedSol,
          sizeUsd: result.oraclePriceUsd
            ? Math.abs(result.adjustedSol) * result.oraclePriceUsd
            : undefined,
          oraclePriceUsd: result.oraclePriceUsd,
          blockedReason: result.blockedReason,
          signature: result.signatures[0],
          detail: result.mutation?.detail,
        });
      }

      // Escalate a stuck guard: one blocked read is routine, a streak means
      // netΔ is sitting out of band unhedged (BUG-012 was 5.5h of silence).
      // Banner at ~10 min (40 cycles × 15s), then hourly (240).
      if (result.action === 'blocked') {
        this.hedgeBlockedStreak++;
        if (this.hedgeBlockedStreak === 40 || this.hedgeBlockedStreak % 240 === 0) {
          log.errorBanner('🚧 Hedge blocked for a sustained streak — netΔ is out of band and NOT being corrected', {
            consecutiveBlockedCycles: this.hedgeBlockedStreak,
            blockedReason: result.blockedReason,
            netDeltaSol: result.deltaBefore.netDeltaSol,
            targetDeltaSol: result.deltaBefore.targetDeltaSol,
          });
        }
      } else {
        this.hedgeBlockedStreak = 0;
      }

      // Start the keeper-fill cooldown ONLY after a real send.
      if (!dryRun && result.signatures.length > 0) {
        this.state.hedge = {
          lastActionAt: Date.now(),
          lastAction: result.action,
          lastSignatures: result.signatures,
        };
      } else if (!dryRun && result.action === 'none') {
        // Housekeeping while idle and live: a past long decrease leaves its
        // proceeds as wSOL (the receiving ATA must outlive the keeper fill);
        // fold them back into native SOL. No-ops when there is no wSOL ATA.
        const unwrap = await this.hedgeEngine.unwrapWsol({ dryRun: false });
        if (unwrap.signatures?.length) {
          log.info('♻️ Unwrapped idle wSOL back to native SOL', {
            detail: unwrap.detail,
            signatures: unwrap.signatures,
          });
        }
      }

      this.hedgeConsecutiveErrors = 0;
    } catch (error) {
      this.hedgeConsecutiveErrors++;
      log.error('Hedge rebalance failed (LP loop unaffected)', {
        error: error instanceof Error ? error.message : String(error),
        hedgeConsecutiveErrors: this.hedgeConsecutiveErrors,
      });
      if (this.hedgeConsecutiveErrors >= 5) {
        log.errorBanner('🛑 Hedge disabled for this session after 5 consecutive failures', {
          hint: 'LP loop continues WITHOUT a hedge — directional SOL exposure is unhedged. Investigate and restart.',
        });
        await this.hedgeEngine.shutdown().catch(() => {});
        this.hedgeEngine = null;
      }
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
   * Log a successful swap and emit a loud warning when Jupiter's reported
   * price impact exceeds the configured threshold. Used by all three
   * swap-execute call sites (initial-position, rebalance, Phase 2 retry) so
   * impact warnings fire consistently regardless of swap direction or context.
   *
   * The high-impact warning is the operational signal the audit asked for —
   * the buffer multiplier alone is a passive defence (it sizes swap input
   * conservatively), but it gives no visibility when actual impact starts
   * creeping toward the buffer ceiling. Surfacing impact loudly lets the
   * operator notice pool liquidity thinning before it manifests as Phase 2
   * retries chasing missing output tokens.
   */
  private logSwapOutcome(
    swapResult: { outputAmount: number; priceImpactPct?: number; signature: string },
    contextLabel: 'Swap' | 'Retry swap' = 'Swap'
  ): void {
    const impact = swapResult.priceImpactPct;
    const impactStr = impact !== undefined ? ` (impact: ${impact.toFixed(2)}%)` : '';
    log.info(`✅ ${contextLabel} complete: ${swapResult.outputAmount.toFixed(4)} received${impactStr}`);

    if (impact === undefined) return;

    const warnThreshold = this.config.swapHighImpactWarningPct;
    if (impact > warnThreshold) {
      const buffer = this.config.swapSlippageBufferPct;
      const exceededBuffer = impact > buffer;
      log.errorBanner('⚠️  HIGH PRICE IMPACT on swap', {
        contextLabel,
        impactPct: `${impact.toFixed(2)}%`,
        warningThreshold: `${warnThreshold}%`,
        configuredBuffer: `${buffer}%`,
        bufferExceeded: exceededBuffer,
        consequence: exceededBuffer
          ? 'Actual impact exceeded the configured slippage buffer. The swap output will fall short of target — Phase 2 retry will likely re-swap to top up.'
          : 'Above warning threshold but still within buffer. No immediate functional impact, but pool liquidity may be thinning.',
        recommendedAction: exceededBuffer
          ? `Raise SWAP_SLIPPAGE_BUFFER_PCT (currently ${buffer}) or reduce AUTO_TUNE_DEPOSIT_AMOUNT to ship smaller swaps.`
          : 'Monitor; bump SWAP_SLIPPAGE_BUFFER_PCT if this warning recurs across cycles.',
        signature: swapResult.signature,
      });
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
  private async executeRebalance(
    currentPrice: number,
    triggerBalance?: PositionBalance,
  ): Promise<RebalanceResult> {
    const startTime = Date.now();
    log.debug('Using SOL price for rebalance cycle', { price: currentPrice });

    // ──────────────────────────────────────────────────────────────────────
    // PnL DB: open the rebalance row at trigger time. We update it as we
    // make progress so a crash mid-rebalance still leaves a row with
    // success=0 and the trigger context — useful for post-mortem.
    // ──────────────────────────────────────────────────────────────────────
    const oldPositionDbIdEarly = this.state.currentPositionMint
      ? findOpenPositionIdByMint(this.state.currentPositionMint)
      : null;
    const rebalanceDbId = recordRebalanceTriggered({
      oldPositionId: oldPositionDbIdEarly,
      triggerSolPct: triggerBalance?.solPercent ?? 0,
      triggerUsdcPct: triggerBalance?.usdcPercent ?? 0,
      triggerPriceSolUsd: currentPrice,
      triggerReason: triggerBalance?.reason ?? 'imbalance_threshold_crossed',
    });

    try {

      // ========================================================================
      // PHASE 1: WITHDRAW + CLAIM + CLOSE
      // ========================================================================

      // Discover positions from blockchain first (safety check)
      const discoveredMints = await this.meteoraAdapter.discoverPositionsFromBlockchain();

      if (discoveredMints.length === 0) {
        throw new Error('No position found on blockchain to rebalance');
      }

      if (discoveredMints.length > 1) {
        log.warn('⚠️  Multiple positions found during rebalance - using first one', {
          count: discoveredMints.length,
          using: discoveredMints[0],
          ignored: discoveredMints.slice(1),
        });
      }

      // Use the ACTUAL position from blockchain discovery
      const oldPositionMint = discoveredMints[0];
      log.info(`🔄 Rebalancing position ${oldPositionMint.slice(0, 8)}...`);

      // Execute Phase 1: Withdraw + Claim + Close in ONE transaction.
      //
      // Wrapped in a retry loop matching Phase 2's pattern. RPC congestion or
      // Meteora SDK timeouts are common transient failures, and without retry
      // the old position stays open on-chain — the next rebalance cycle has to
      // re-discover it from scratch (and the bot is in a broken state in the
      // meantime).
      //
      // Retry budget reuses `autoTuneMaxRetries` so both phases respect the
      // same operator-tunable limit.
      //
      // KNOWN LIMITATION: `withdrawClaimAndClose` has a 30s hard timeout
      // (meteoraAdapter.ts:803) that can race with on-chain success — the
      // SDK call may reject locally while the transaction still settles.
      // Before each retry we re-check the blockchain so we don't double-close
      // a position that the previous attempt actually finalized.
      let withdrawResult: { signature: string; claimedFees: { sol: number; usdc: number } } | undefined;
      let phase1LastError: Error | null = null;
      const phase1MaxAttempts = this.config.autoTuneMaxRetries;

      for (let phase1Attempt = 1; phase1Attempt <= phase1MaxAttempts; phase1Attempt++) {
        try {
          if (phase1Attempt > 1) {
            log.info(`🔄 Phase 1 retry ${phase1Attempt}/${phase1MaxAttempts}`);

            // Race-with-on-chain check: if the previous attempt's transaction
            // actually settled despite the local rejection, the position is
            // already closed. Treat that as success (we lose visibility into
            // claimed-fee amounts, but the funds are back in the wallet and
            // Phase 2 will pick them up from the live balance).
            const stillThere = await this.meteoraAdapter.discoverPositionsFromBlockchain();
            if (!stillThere.includes(oldPositionMint)) {
              log.warn('⚠️  Position no longer on-chain — previous attempt likely succeeded after local timeout. Treating Phase 1 as complete.', {
                position: oldPositionMint,
                priorAttempts: phase1Attempt - 1,
              });
              withdrawResult = {
                signature: 'unknown-prior-success',
                claimedFees: { sol: 0, usdc: 0 },
              };
              break;
            }
          }

          withdrawResult = await this.meteoraAdapter.withdrawClaimAndClose(oldPositionMint);
          log.info(`✅ Phase 1: Claimed ${withdrawResult.claimedFees.sol.toFixed(4)} SOL + ${withdrawResult.claimedFees.usdc.toFixed(2)} USDC`);
          break;
        } catch (error) {
          phase1LastError = error instanceof Error ? error : new Error(String(error));

          if (phase1Attempt >= phase1MaxAttempts) {
            // Final failure — position still on-chain. DO NOT clear
            // currentPositionMint; the next rebalance cycle will rediscover it
            // and retry from scratch.
            log.errorBanner('❌ Phase 1 (Withdraw+Claim+Close) failed - position still exists on-chain', {
              position: oldPositionMint,
              attempts: phase1Attempt,
              error: phase1LastError.message,
            });
            throw phase1LastError;
          }

          // Linear backoff schedule (1s, 2s, …) — same as Phase 2. The Phase 2
          // comment calls this "exponential" but the implementation is linear;
          // we match it here so both phases behave identically. If we ever
          // switch to true exponential backoff, change both at once.
          const waitMs = 1000 * phase1Attempt;
          log.warn(`❌ Phase 1 attempt ${phase1Attempt}/${phase1MaxAttempts} failed: ${phase1LastError.message.substring(0, 80)}... (retry in ${waitMs}ms)`);
          await new Promise(resolve => setTimeout(resolve, waitMs));
        }
      }

      if (!withdrawResult) {
        // Defensive: the loop either sets withdrawResult or throws, but TS
        // narrowing doesn't see that.
        throw phase1LastError ?? new Error('Phase 1 exited loop without a result');
      }

      // ========================================================================
      // PHASE 2: CREATE NEW POSITION WITH INTELLIGENT RETRY
      // ========================================================================

      // ========================================================================
      // CALCULATE BALANCED DEPOSITS RESPECTING WALLET RESERVES
      // ========================================================================
      // Get actual wallet balances first
      const connection = getConnection();
      const wallet = getWalletKeypair();
      const solBalance = await connection.getBalance(wallet.publicKey);
      const actualSol = solBalance / Math.pow(10, 9);
      const actualUsdc = await this.getUsdcBalance();

      // Calculate maximum depositable SOL (respecting reserves)
      const totalReserve = this.config.minimumWalletBalanceSol + this.config.rentReserveSol;
      const maxDepositableSol = Math.max(0, actualSol - totalReserve);

      // Check if we have enough balance to cover reserves
      if (maxDepositableSol <= 0) {
        throw new Error(
          `Insufficient SOL balance to cover reserves. Have ${actualSol.toFixed(4)} SOL, need ${totalReserve.toFixed(4)} for reserves. ` +
          `Please deposit at least ${(totalReserve - actualSol + 0.1).toFixed(4)} SOL to continue.`
        );
      }

      // Calculate desired deposits (config amount + claimed fees)
      const { solAmount: desiredSol, usdcAmount: desiredUsdc } = this.calculateBalancedDeposits(
        withdrawResult.claimedFees.sol,
        withdrawResult.claimedFees.usdc,
        currentPrice
      );

      // Target position sizes (will swap to reach these if needed)
      let solAmount = desiredSol;
      let usdcAmount = desiredUsdc;

      // Calculate total wallet value (respecting reserves)
      const totalWalletValueUsd = (maxDepositableSol * currentPrice) + actualUsdc;
      const desiredPositionValueUsd = (desiredSol * currentPrice) + desiredUsdc;

      // If desired position exceeds total wallet value, scale down proportionally.
      // The bot continues with a smaller position rather than failing, but the
      // operator MUST notice — silently shipping a position 1/3 the size they
      // configured is the kind of bug nobody catches until weeks later when
      // they wonder why their fees are tiny. Use errorBanner so it's
      // impossible to miss in the log stream, even though the bot is not
      // actually erroring out.
      if (desiredPositionValueUsd > totalWalletValueUsd) {
        const scaleFactor = totalWalletValueUsd / desiredPositionValueUsd;
        solAmount = desiredSol * scaleFactor;
        usdcAmount = desiredUsdc * scaleFactor;

        const recommendedDepositAmount = (this.config.autoTuneDepositAmount * scaleFactor).toFixed(2);
        log.errorBanner('⚠️  POSITION SCALED DOWN to fit wallet balance — configured size NOT used', {
          configuredDepositAmount: this.config.autoTuneDepositAmount,
          configuredDepositToken: this.config.autoTuneDepositToken,
          desired: {
            sol: desiredSol.toFixed(4),
            usdc: desiredUsdc.toFixed(2),
            totalUsd: desiredPositionValueUsd.toFixed(2),
          },
          actual: {
            sol: solAmount.toFixed(4),
            usdc: usdcAmount.toFixed(2),
            totalUsd: (solAmount * currentPrice + usdcAmount).toFixed(2),
          },
          scaleFactor: `${(scaleFactor * 100).toFixed(1)}% of configured size`,
          wallet: {
            sol: actualSol.toFixed(4),
            usdc: actualUsdc.toFixed(2),
            totalUsd: totalWalletValueUsd.toFixed(2),
          },
          consequence:
            'This will recur EVERY rebalance cycle until the wallet is topped up or AUTO_TUNE_DEPOSIT_AMOUNT is reduced. Earned LP fees will be smaller than the configured deposit suggests.',
          recommendedAction: `Either deposit more funds, OR reduce AUTO_TUNE_DEPOSIT_AMOUNT from ${this.config.autoTuneDepositAmount} to ${recommendedDepositAmount} to avoid scaling`,
        });
      }

      log.info('Target position sizes', {
        desired: { sol: desiredSol, usdc: desiredUsdc },
        final: { sol: solAmount, usdc: usdcAmount },
        wallet: { sol: actualSol, usdc: actualUsdc },
        maxDepositableSol,
      });

      // Get pool info for price range (reuse connection from above)
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
      // ALIGNMENT TO 50/50 — mandatory second leg of the rebalance
      // ========================================================================
      //
      // Phase 1 just emptied a position that was 92%+ on one side (that's
      // the trigger threshold). The wallet now inherits that lopsided mix.
      // Re-depositing without first swapping back to 50/50 means the new
      // position starts already off-centre — taking on inverse exposure
      // that compounds impermanent loss every minute the trend continues.
      // The swap-to-50/50 is the only thing that locks in the current
      // price and resets the IL clock.
      //
      // So: at this point in the rebalance flow, the alignment swap is
      // mandatory. The ONLY case for skipping it is the validation gate
      // below — and if that gate ever fires in production it's a signal
      // that something is wrong with the trigger or the snapshot, not
      // a fee-saving optimization.
      //
      // The actual `executeSwap` still relies on planSwapForDeposit to
      // compute direction + amount + apply per-token guards. Inside the
      // skewed branch, planSwapForDeposit may STILL return `needed: false`
      // — that happens when the orchestrator already scaled the target
      // down proportionally (preserving 50/50 ratio) so the existing
      // wallet covers the scaled target. In that case Phase 2 deposits
      // a smaller-but-balanced position from current wallet, which is
      // semantically equivalent to "swap to 50/50" with zero swap input.
      // ========================================================================

      // `totalReserve` was already computed upstream alongside maxDepositableSol.
      const balanceCheck = isWalletBalancedFor5050(
        actualSol,
        actualUsdc,
        currentPrice,
        totalReserve,
      );

      let availableSolForSwap = 0;
      let usedSwap = false;

      if (balanceCheck.balanced) {
        // ────────────────────────────────────────────────────────────────────
        // VALIDATION GATE: imbalance trigger fired but wallet is already
        // 50/50 ±10% post-Phase-1. This contradicts the trigger's premise.
        // Log it loudly and skip the swap; Phase 2 proceeds with current
        // wallet (which is already balanced — no IL gain from a swap).
        //
        // Use errorBanner severity so this never gets sampled out of GCP
        // logs — it's a "your assumptions don't match reality" event the
        // operator must see.
        // ────────────────────────────────────────────────────────────────────
        log.errorBanner(
          '⚠️  Imbalance trigger fired but wallet is already 50/50 ±10% — skipping alignment swap',
          {
            walletSolRatio: balanceCheck.walletSolRatio.toFixed(3),
            walletTotalUsd: balanceCheck.walletTotalUsd.toFixed(2),
            walletSol: actualSol.toFixed(4),
            walletUsdc: actualUsdc.toFixed(2),
            triggerSolPct:
              triggerBalance?.solPercent?.toFixed(1) ?? 'unknown',
            triggerUsdcPct:
              triggerBalance?.usdcPercent?.toFixed(1) ?? 'unknown',
            diagnostic:
              'Validation gate hit. Expected behaviour: trigger fires but wallet does ' +
              'not actually reflect imbalance. Likely causes: stale position-balance ' +
              'snapshot between check and rebalance, manual external rebalance, ' +
              'imbalance threshold misconfigured (' +
              `${(this.config.autoTuneImbalanceThreshold * 100).toFixed(0)}% currently), ` +
              'or position closed externally. If this recurs across cycles, investigate.',
          },
        );
      } else {
        // ────────────────────────────────────────────────────────────────────
        // SKEWED WALLET — execute the alignment swap (the normal post-92%
        // trigger path). planSwapForDeposit picks direction + amount + runs
        // total-value pre-flight + per-token guards. May still return
        // needed=false if the target was scaled down enough that the
        // existing skewed wallet covers it; that is OK and intentional.
        // ────────────────────────────────────────────────────────────────────
        log.info('🎯 Wallet skewed — executing alignment swap', {
          walletSolRatio: balanceCheck.walletSolRatio.toFixed(3),
          walletSol: actualSol.toFixed(4),
          walletUsdc: actualUsdc.toFixed(2),
        });

        const swapPlan: SwapPlan = planSwapForDeposit({
          walletSol: actualSol,
          walletUsdc: actualUsdc,
          targetSol: solAmount,
          targetUsdc: usdcAmount,
          permanentMinimumSol: this.config.minimumWalletBalanceSol,
          rentReserveSol: this.config.rentReserveSol,
          currentPrice,
          slippageBufferPct: this.config.swapSlippageBufferPct / 100,
          context: 'rebalance',
          autoTuneDepositAmount: this.config.autoTuneDepositAmount,
        });

        availableSolForSwap = swapPlan.availableSolForSwap;
        usedSwap = swapPlan.needed;

        if (swapPlan.needed && swapPlan.swap) {
          const { swap, shortfall } = swapPlan;
          const missingToken = shortfall.sol > 0 ? 'SOL' : 'USDC';
          const missingAmount = shortfall.sol > 0 ? shortfall.sol : shortfall.usdc;
          log.warn(`⚠️  Insufficient ${missingToken} (need ${missingAmount.toFixed(4)} more) - executing swap`);

          if (swap.direction === 'SOL_TO_USDC') {
            log.info('Calculating SOL → USDC swap', {
              usdcShortfall: shortfall.usdc,
              currentPrice,
              bufferMultiplier: 1 + this.config.swapSlippageBufferPct / 100,
              solToSwap: swap.amount,
              availableSolForSwap,
            });
            log.info(`🔄 Swapping ${swap.amount.toFixed(4)} SOL → ${swap.expectedOutput.toFixed(2)} USDC`);
          } else {
            log.info('Calculating USDC → SOL swap', {
              solShortfall: shortfall.sol,
              currentPrice,
              bufferMultiplier: 1 + this.config.swapSlippageBufferPct / 100,
              usdcToSwap: swap.amount,
              actualUsdc,
            });
            log.info(`🔄 Swapping ${swap.amount.toFixed(2)} USDC → ${swap.expectedOutput.toFixed(4)} SOL`);
          }

          const swapParams = {
            inputMint: swap.inputMint,
            outputMint: swap.outputMint,
            amount: swap.amount,
            context: 'rebalance' as const,
            priceSolUsd: currentPrice,
          };

          // Execute swap
          try {
            const swapResult = await this.jupiterSwapper.executeSwap(swapParams);
            this.logSwapOutcome(swapResult);

            // Wait for balance to update
            await new Promise(resolve => setTimeout(resolve, 2000));
          } catch (swapError) {
            // Swap failed - log current wallet balances to help debug
            const currentSolBalance = await connection.getBalance(wallet.publicKey);
            const currentActualSol = currentSolBalance / Math.pow(10, 9);
            const currentActualUsdc = await this.getUsdcBalance();

            log.errorBanner('❌ Swap failed - current wallet balances', {
              error: swapError instanceof Error ? swapError.message : String(swapError),
              walletBalances: {
                sol: currentActualSol,
                usdc: currentActualUsdc,
              },
              swapParams: {
                inputMint: swapParams.inputMint === SOL_MINT ? 'SOL' : 'USDC',
                outputMint: swapParams.outputMint === SOL_MINT ? 'SOL' : 'USDC',
                amount: swapParams.amount,
              },
            });

            // Check if position still exists on blockchain (funds might be locked)
            const positionsAfterSwapFailure = await this.meteoraAdapter.discoverPositionsFromBlockchain();
            if (positionsAfterSwapFailure.length > 0) {
              log.errorBanner('⚠️  UNCLOSED POSITION DETECTED', {
                message: 'Funds may be locked in position that was not properly closed',
                positions: positionsAfterSwapFailure,
                suggestion: 'Manually close position from Meteora dashboard or retry rebalance',
              });
            }

            throw swapError; // Re-throw to prevent position creation
          }
        } else {
          // Skewed wallet but planSwapForDeposit returned needed=false —
          // means scaling already produced a target the existing skewed
          // wallet can fund. Phase 2 will deposit a (smaller, balanced)
          // position. This is the "scale-down covered the gap" path.
          log.info(
            'Wallet skewed but post-scale target fits without a swap — proceeding to Phase 2',
            {
              walletSolRatio: balanceCheck.walletSolRatio.toFixed(3),
              targetSol: solAmount,
              targetUsdc: usdcAmount,
            },
          );
        }
      }

      // ========================================================================
      // POSITION CREATION: Now create position with updated balance
      // ========================================================================

      // Attempt to create position with intelligent retry
      let attempt = 0;
      let newPositionMint = '';
      let createSignatures: string[] = [];
      let lastError: Error | null = null;
      // `usedSwap` was declared upstream alongside the alignment-gate
      // branches; it's true if the alignment swap fired, false if either
      // the validation gate skipped it or the planner returned needed=false
      // after scaling. Phase-2-retry-swap may flip it true later in the
      // loop below.

      while (attempt < this.config.autoTuneMaxRetries) {
        attempt++;

        // ────────────────────────────────────────────────────────────────
        // RETRY PRE-FLIGHT: re-check wallet state on attempts >= 2
        // ────────────────────────────────────────────────────────────────
        // The first attempt operates on the balance state we evaluated
        // upstream. Subsequent attempts re-fetch and re-plan because:
        //   • The previous attempt likely paid network fees, shifting SOL.
        //   • A previous swap may have partially settled — the output we
        //     counted on may not be fully present yet.
        //   • Long retry loops can outlive a swap settle window.
        //
        // We deliberately keep `currentPrice` and the (solAmount, usdcAmount)
        // targets stable across retries — chasing a moving price target
        // mid-rebalance would create internal inconsistency. We just check
        // whether the wallet at this instant still covers those targets.
        if (attempt > 1) {
          log.info(`🔄 Retry ${attempt}/${this.config.autoTuneMaxRetries} — re-checking wallet state`);

          const retrySolBalance = await connection.getBalance(wallet.publicKey);
          const retryActualSol = retrySolBalance / Math.pow(10, 9);
          const retryActualUsdc = await this.getUsdcBalance();

          let retrySwapPlan: SwapPlan;
          try {
            retrySwapPlan = planSwapForDeposit({
              walletSol: retryActualSol,
              walletUsdc: retryActualUsdc,
              targetSol: solAmount,
              targetUsdc: usdcAmount,
              permanentMinimumSol: this.config.minimumWalletBalanceSol,
              rentReserveSol: this.config.rentReserveSol,
              currentPrice,
              slippageBufferPct: this.config.swapSlippageBufferPct / 100,
              context: 'rebalance',
              autoTuneDepositAmount: this.config.autoTuneDepositAmount,
            });
          } catch (planError) {
            // Planner errors are deterministic ("wallet doesn't have enough
            // total value", "not enough USDC for swap input"). Retrying
            // won't resolve them. Propagate immediately so the operator
            // gets the actionable error message instead of more retry
            // slots burned on an unfixable state.
            log.errorBanner(
              'Retry pre-flight failed — wallet state can no longer fund the position',
              {
                attempt,
                walletSol: retryActualSol,
                walletUsdc: retryActualUsdc,
                error: planError instanceof Error ? planError.message : String(planError),
              }
            );
            throw planError;
          }

          if (retrySwapPlan.needed && retrySwapPlan.swap) {
            const { swap } = retrySwapPlan;
            log.warn(`⚠️  Retry ${attempt}: wallet shifted — additional swap required`, {
              direction: swap.direction,
              amount: swap.amount,
              expectedOutput: swap.expectedOutput,
              walletSol: retryActualSol,
              walletUsdc: retryActualUsdc,
            });
            try {
              const swapResult = await this.jupiterSwapper.executeSwap({
                inputMint: swap.inputMint,
                outputMint: swap.outputMint,
                amount: swap.amount,
                context: 'retry-rebalance',
                priceSolUsd: currentPrice,
              });
              this.logSwapOutcome(swapResult, 'Retry swap');
              // Wait for balance to update — same settle window as the
              // initial swap path above.
              await new Promise(resolve => setTimeout(resolve, 2000));
              usedSwap = true;
            } catch (retrySwapError) {
              // The retry-swap itself failed (Jupiter error, network blip).
              // Don't bail here — the shortfall might be small enough that
              // position creation succeeds anyway, and if not, the error
              // from createPosition below will be more informative than
              // swallowing this one.
              log.warn('Retry swap failed; proceeding to position creation anyway', {
                error: retrySwapError instanceof Error ? retrySwapError.message : String(retrySwapError),
              });
            }
          } else {
            log.info('Retry pre-flight: wallet still covers target — no additional swap needed');
          }
        }

        try {
          // Create position with current wallet state
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

          // Wait before retry. Linear backoff (1s, 2s, …) — the comment
          // above says "exponential" but the implementation is linear,
          // matching Phase 1 retry behaviour. Both will change together
          // if/when we move to true exponential.
          const waitMs = 1000 * attempt;
          log.warn(`❌ Failed: ${lastError.message.substring(0, 80)}... (retry in ${waitMs}ms)`);
          await new Promise(resolve => setTimeout(resolve, waitMs));
        }
      }

      // ========================================================================
      // SUCCESS
      // ========================================================================

      const durationMs = Date.now() - startTime;
      log.info(`✅ Rebalance complete in ${(durationMs / 1000).toFixed(1)}s${usedSwap ? ' (with swap)' : ''}`);

      // PnL DB: close out the rebalance row with the new-position FK and
      // the three signatures. The new-position FK lookup is best-effort —
      // recordPositionOpened ran inside meteoraAdapter.createPosition, so by
      // the time we reach here the row exists (synchronous code path).
      if (rebalanceDbId !== null) {
        recordRebalanceCompleted({
          rebalanceId: rebalanceDbId,
          newPositionId: findOpenPositionIdByMint(newPositionMint),
          claimedFeesSol: withdrawResult.claimedFees.sol,
          claimedFeesUsdc: withdrawResult.claimedFees.usdc,
          withdrawSignature: withdrawResult.signature,
          createSignature: createSignatures[0],
          // swap_signature is not threaded through in the success path's local
          // scope — would require capturing the swap-result signature when
          // logSwapOutcome runs. Could revisit if/when we want signature-
          // level rebalance ↔ swap joins; the swaps table already groups by
          // context='rebalance' which gets us most of the way there.
          success: true,
          durationMs,
        });
      }

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

      // PnL DB: record the failure with the error message and duration.
      // Even on failure we want a row to exist so the operator's "rebalance
      // count" matches reality and so error patterns can be aggregated by
      // strategy_version.
      if (rebalanceDbId !== null) {
        recordRebalanceCompleted({
          rebalanceId: rebalanceDbId,
          success: false,
          errorMessage,
          durationMs,
        });
      }

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

      // Fetch current wallet balances for the pre-flight + swap decision below.
      const wallet = getWalletKeypair();
      const solBalance = await connection.getBalance(wallet.publicKey);
      const actualSol = solBalance / Math.pow(10, 9);
      const actualUsdc = await this.getUsdcBalance();

      // ========================================================================
      // PRE-FLIGHT + SWAP DECISION
      // ========================================================================
      // Delegated to planSwapForDeposit() — same pure helper used by
      // executeRebalance. Throws with a descriptive error when the wallet's
      // total value can't fund the position, or when it can't fund the swap
      // input itself. Keeps the two paths in lock-step so they can't drift
      // apart again (the original 566.81-USDC-with-9.43-USDC bug came from
      // exactly that drift).
      //
      // Uses activeBinPrice (already in scope) for shortfall valuation,
      // avoiding an extra getSolPrice() network round-trip on each entry.
      log.info('💰 Pre-flight wallet balance check', {
        actualSol,
        actualUsdc,
        depositSol: solAmount,
        depositUsdc: usdcAmount,
        rentReserve: this.config.rentReserveSol,
        permanentMinimum: this.config.minimumWalletBalanceSol,
      });

      const swapPlan: SwapPlan = planSwapForDeposit({
        walletSol: actualSol,
        walletUsdc: actualUsdc,
        targetSol: solAmount,
        targetUsdc: usdcAmount,
        permanentMinimumSol: this.config.minimumWalletBalanceSol,
        rentReserveSol: this.config.rentReserveSol,
        currentPrice: activeBinPrice,
        slippageBufferPct: this.config.swapSlippageBufferPct / 100,
        context: 'initial-position',
        autoTuneDepositAmount: this.config.autoTuneDepositAmount,
      });

      if (swapPlan.needed && swapPlan.swap) {
        const { swap, shortfall } = swapPlan;
        log.warn('⚠️  Insufficient balance detected - swap will be required', {
          missingToken: shortfall.sol > 0 ? 'SOL' : 'USDC',
          shortfall: shortfall.sol > 0
            ? { token: 'SOL', missing: shortfall.sol }
            : { token: 'USDC', missing: shortfall.usdc },
        });

        if (swap.direction === 'USDC_TO_SOL') {
          log.info('Swapping USDC → SOL to cover shortfall', {
            missingSol: swap.expectedOutput,
            swapAmountUsdc: swap.amount,
          });
        } else {
          log.info('Swapping SOL → USDC to cover shortfall', {
            missingUsdc: swap.expectedOutput,
            swapAmountSol: swap.amount,
          });
        }

        const swapParams = {
          inputMint: swap.inputMint,
          outputMint: swap.outputMint,
          amount: swap.amount,
          context: 'initial-position' as const,
          priceSolUsd: activeBinPrice,
        };

        log.info(`🔄 Swapping ${swap.direction === 'USDC_TO_SOL' ? swap.amount.toFixed(2) + ' USDC → SOL' : swap.amount.toFixed(4) + ' SOL → USDC'}`);

        // Execute swap sequentially (same as rebalance flow)
        try {
          const swapResult = await this.jupiterSwapper.executeSwap(swapParams);
          this.logSwapOutcome(swapResult);

          // Wait for balance to update
          await new Promise(resolve => setTimeout(resolve, 2000));
        } catch (swapError) {
          // Swap failed - log current wallet balances to help debug
          const currentSolBalance = await connection.getBalance(wallet.publicKey);
          const currentActualSol = currentSolBalance / Math.pow(10, 9);
          const currentActualUsdc = await this.getUsdcBalance();

          log.errorBanner('❌ Initial position swap failed - current wallet balances', {
            error: swapError instanceof Error ? swapError.message : String(swapError),
            walletBalances: {
              sol: currentActualSol,
              usdc: currentActualUsdc,
            },
            swapParams: {
              inputMint: swapParams.inputMint === SOL_MINT ? 'SOL' : 'USDC',
              outputMint: swapParams.outputMint === SOL_MINT ? 'SOL' : 'USDC',
              amount: swapParams.amount,
            },
          });

          // Check if position exists on blockchain (funds might be locked)
          const positionsAfterSwapFailure = await this.meteoraAdapter.discoverPositionsFromBlockchain();
          if (positionsAfterSwapFailure.length > 0) {
            log.errorBanner('⚠️  UNCLOSED POSITION DETECTED', {
              message: 'Funds may be locked in position that was not properly closed',
              positions: positionsAfterSwapFailure,
              suggestion: 'Manually close position from Meteora dashboard or skip auto-creation',
            });
          }

          throw swapError; // Re-throw to prevent position creation
        }

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
