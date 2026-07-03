/**
 * Meteora DLMM Adapter
 *
 * Handles all interactions with Meteora DLMM (Dynamic Liquidity Market Maker) pools.
 *
 * Key Features:
 * - **Auto-creation**: Automatically creates LP positions with configurable price ranges
 * - **Exposure Tracking**: Reads real-time LP exposure (SOL/USDC amounts) from position NFTs
 * - **Pool Analytics**: Fetches pool metrics (APR, APY, volume, fees, TVL) from Meteora API
 * - **Position Composition**: Calculates token X/Y percentages within price ranges
 * - **Deposits/Withdrawals**: Supports single-sided and balanced liquidity operations
 * - **Fee Claiming**: Claims accumulated trading fees from all positions
 * - **State Persistence**: Saves created position NFT mints to data/state.json
 *
 * Implementation Status:
 * ✅ Auto-create positions with price range validation
 * ✅ Read LP exposure from position NFTs
 * ✅ Pool analytics with 2.5s caching
 * ✅ Position composition calculations
 * ✅ Deposit/withdrawal operations
 * ✅ Fee claiming from multiple positions
 *
 * @example
 * ```typescript
 * const adapter = new MeteoraAdapter();
 *
 * // Auto-create position if needed
 * await adapter.autoCreatePositionIfNeeded();
 *
 * // Get pool analytics
 * const poolInfo = await adapter.getPoolAnalytics();
 * console.log('Pool APR:', poolInfo.apr);
 *
 * // Read LP exposure
 * const exposure = await adapter.getLpExposure();
 * console.log('SOL in LP:', exposure.solAmount);
 * ```
 */

import { PublicKey, Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js';
import BN from 'bn.js';
import { getSolPrice } from '../core/priceOracle.js';
import { getConfig } from '../config/env.js';
import { log } from '../utils/logger.js';
import { getConnection, getWalletKeypair } from '../utils/solana.js';
import { DLMM, StrategyType } from '../utils/dlmm.js';
import {
  loadCreatedPositionMints,
  saveCreatedPositionMints,
} from './persistence.js';
import {
  recordPositionOpened,
  recordPositionClosed,
  recordTransaction,
} from './pnlDb.js';
import {
  LpExposure,
  CreatePositionParams,
  CreatePositionResult,
  MeteoraPairInfo,
} from '../types/index.js';
import { DECIMALS, SLIPPAGE_BPS, METEORA_LIMITS } from '../config/constants.js';
import {
  getActiveBin,
  getPriceFromBinId,
  calculateTokenPercentages,
  getMeteoraPairInfo,
} from '../utils/meteoraUtils.js';
import { getTransactionFees, logTransactionFees } from '../utils/transactionUtils.js';
import { sendOptimized } from '../utils/sendOptimized.js';

export class MeteoraAdapter {
  private config = getConfig();
  private positionMints: string[] = [];
  private poolInfo: MeteoraPairInfo | null = null;
  private poolInfoLastFetched: number = 0;
  private readonly POOL_INFO_CACHE_MS = 2500; // Cache for 2.5 seconds
  /**
   * Read-only adapters (dashboard, hodl CLI) must never write state.json:
   * they can run alongside the live auto-tune loop, and a discovery/prune
   * write from an observer would race the owner process's writes (e.g. an
   * empty read during a rebalance's close→create window clobbering the
   * freshly created mint).
   */
  private readonly readOnly: boolean;

  constructor(options: { readOnly?: boolean } = {}) {
    this.readOnly = options.readOnly ?? false;
    // Initialize position mints based on config mode
    if (this.config.autoCreatePositions) {
      // Auto-create mode: Try to load positions from state.json
      const savedMints = loadCreatedPositionMints();
      if (savedMints.length > 0) {
        this.positionMints = savedMints;
        log.info('MeteoraAdapter initialized in auto-create mode (positions loaded from state)', {
          count: savedMints.length,
          mints: savedMints,
        });
      } else {
        log.info('MeteoraAdapter initialized in auto-create mode (no saved positions - will discover from blockchain on first API call)');
      }
    } else {
      // Manual mode: Check if user provided existing position mints
      if (this.config.meteoraPositionMints && this.config.meteoraPositionMints.length > 0) {
        // User has existing positions they want to track
        this.positionMints = this.config.meteoraPositionMints;
        log.info('MeteoraAdapter initialized with existing positions', {
          count: this.positionMints.length,
          mints: this.positionMints,
        });
      } else {
        // User wants to start with zero positions and create them manually via UI
        this.positionMints = [];
        log.info('MeteoraAdapter initialized with no positions (manual creation mode)', {
          note: 'Use the UI or API to create positions when ready',
        });
      }
    }
  }

  /** Persist tracked mints to state.json — no-op for read-only adapters. */
  private persistPositionMints(mints: string[]): void {
    if (this.readOnly) return;
    saveCreatedPositionMints(mints);
  }

  /**
   * Set position mints (used when loading from state.json)
   */
  setPositionMints(mints: string[]): void {
    this.positionMints = mints;
    log.info('Position mints updated', {
      count: mints.length,
      mints,
    });
  }

  /**
   * Get current position mints
   */
  getPositionMints(): string[] {
    return this.positionMints;
  }

  /**
   * Discover all positions owned by the wallet from the blockchain
   * Merges discovered positions with saved positions in state.json
   * This ensures positions are not lost if state.json is corrupted or deleted
   *
   * NOTE: In auto-tune mode, only returns the FIRST position found since auto-tune
   * manages a single position at a time (old positions should be closed during rebalance)
   */
  async discoverPositionsFromBlockchain(): Promise<string[]> {
    try {
      log.info('Discovering positions from blockchain...');

      const connection = getConnection();
      const wallet = getWalletKeypair();
      const poolPubkey = new PublicKey(this.config.meteoraPoolAddress!);
      const dlmmPool = await DLMM.create(connection, poolPubkey);

      // Query all positions for this wallet and pool
      const { userPositions } = await dlmmPool.getPositionsByUserAndLbPair(wallet.publicKey);

      if (!userPositions || userPositions.length === 0) {
        log.info('No positions found on blockchain');
        // Auto-heal: if we were tracking mints (e.g. a phantom in state.json, or
        // a position closed elsewhere) but the chain shows none, clear the stale
        // mints + state so the bot stops trusting a position it doesn't have and
        // re-discovers cleanly. Safe: position creation re-checks the chain to
        // avoid duplicates, so a transient empty read self-corrects next cycle.
        if (this.positionMints.length > 0) {
          log.warn('Clearing stale tracked LP mints (none exist on-chain)', {
            staleMints: this.positionMints,
          });
          this.positionMints = [];
          this.persistPositionMints([]);
        }
        return [];
      }

      // Extract position mints from discovered positions
      const discoveredMints = userPositions.map((pos: any) => pos.publicKey.toBase58());

      log.info('Positions discovered from blockchain', {
        count: discoveredMints.length,
        mints: discoveredMints,
      });

      // For auto-tune mode, only use the FIRST position (should be only one active)
      // Auto-tune manages a single position, old ones should be closed
      if (this.config.autoTuneEnabled) {
        if (discoveredMints.length > 1) {
          log.warn('Multiple positions found in auto-tune mode - using only the first one', {
            found: discoveredMints.length,
            using: discoveredMints[0],
            ignored: discoveredMints.slice(1),
          });
        }
        this.positionMints = [discoveredMints[0]];
        this.persistPositionMints(this.positionMints);
        return [discoveredMints[0]];
      }

      // For non-auto-tune mode, merge with saved positions (avoid duplicates)
      const mergedMints = Array.from(new Set([...this.positionMints, ...discoveredMints]));

      // Update in-memory positions
      this.positionMints = mergedMints;

      // Save merged positions to state for future startups
      if (mergedMints.length > this.positionMints.length) {
        this.persistPositionMints(mergedMints);
        log.info('State updated with newly discovered positions', {
          previousCount: this.positionMints.length,
          newCount: mergedMints.length,
        });
      }

      return discoveredMints;
    } catch (error) {
      log.error('Failed to discover positions from blockchain', {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Ensure positions are loaded from either state or blockchain
   * Called on first API request to guarantee positions are available
   */
  async ensurePositionsLoaded(): Promise<void> {
    // If positions already loaded, skip discovery
    if (this.positionMints.length > 0) {
      log.info('✅ Positions already loaded in memory', {
        count: this.positionMints.length,
        mints: this.positionMints,
      });
      return;
    }

    // No saved positions, try to discover from blockchain
    log.warn('⚠️  Position list is EMPTY - attempting blockchain discovery...');
    const discovered = await this.discoverPositionsFromBlockchain();
    log.info('Blockchain discovery complete', {
      found: discovered.length,
      mints: discovered,
      currentPositionMints: this.positionMints,
    });
  }

  /**
   * Get pool analytics from Meteora API (cached)
   * Returns pool info including volume, fees, APR/APY
   */
  async getPoolAnalytics(): Promise<MeteoraPairInfo> {
    const now = Date.now();

    // Return cached data if still fresh
    if (this.poolInfo && now - this.poolInfoLastFetched < this.POOL_INFO_CACHE_MS) {
      log.debug('Using cached pool info', {
        age: now - this.poolInfoLastFetched,
        cache: this.POOL_INFO_CACHE_MS,
      });
      return this.poolInfo;
    }

    // Fetch fresh data
    if (!this.config.meteoraPoolAddress) {
      throw new Error('METEORA_POOL_ADDRESS not configured');
    }

    this.poolInfo = await getMeteoraPairInfo(this.config.meteoraPoolAddress);
    this.poolInfoLastFetched = now;

    return this.poolInfo;
  }

  /**
   * Create a new Meteora DLMM position
   * Only called when AUTO_CREATE_POSITIONS=true and no positions exist yet
   */
  async createPosition(params: CreatePositionParams): Promise<CreatePositionResult> {
    log.info('Creating Meteora DLMM position', params);

    try {
      const connection = getConnection();
      const wallet = getWalletKeypair();
      const poolPubkey = new PublicKey(params.poolAddress);

      // Check wallet balance
      const balance = await connection.getBalance(wallet.publicKey);
      const requiredSol = params.solAmount + 0.1; // Extra 0.1 SOL for rent and fees
      if (balance / LAMPORTS_PER_SOL < requiredSol) {
        throw new Error(
          `Insufficient SOL balance. Required: ${requiredSol}, Available: ${balance / LAMPORTS_PER_SOL}`
        );
      }

      // Initialize DLMM pool instance
      const dlmmPool = await DLMM.create(connection, poolPubkey);

      // Get current active bin for price reference
      const activeBin = await dlmmPool.getActiveBin();
      const currentPrice = parseFloat(activeBin.price);

      log.info('Current pool state', {
        activeBinId: activeBin.binId,
        currentPrice,
      });

      // Validate and adjust price range to fit within DLMM limits
      const { adjustedLower, adjustedUpper, minBinId, maxBinId } =
        this.validateAndAdjustPriceRange(
          dlmmPool,
          params.priceLower,
          params.priceUpper,
          currentPrice
        );

      log.info('Validated bin range', {
        minBinId,
        maxBinId,
        width: maxBinId - minBinId + 1,
        priceLower: adjustedLower,
        priceUpper: adjustedUpper,
        originalPriceLower: params.priceLower,
        originalPriceUpper: params.priceUpper,
      });

      // Create position keypair
      const positionKeypair = Keypair.generate();

      // Convert amounts to BN with proper decimals
      const totalXAmount = new BN(params.solAmount * 10 ** DECIMALS.SOL);
      const totalYAmount = new BN(params.usdcAmount * 10 ** DECIMALS.USDC);

      // Create strategy parameters based on config
      // Map config string to StrategyType enum
      const strategyTypeMap = {
        'spot': StrategyType.Spot,
        'curve': StrategyType.Curve,
        'bidask': StrategyType.BidAsk,
      };
      const strategyType = strategyTypeMap[this.config.meteoraStrategyType];

      const strategyParameters = {
        maxBinId,
        minBinId,
        strategyType, // Configurable via METEORA_STRATEGY_TYPE env var
      };

      // Build position initialization and liquidity add transaction
      const tx = await dlmmPool.initializePositionAndAddLiquidityByStrategy({
        positionPubKey: positionKeypair.publicKey,
        totalXAmount,
        totalYAmount,
        strategy: strategyParameters,
        user: wallet.publicKey,
        slippage: SLIPPAGE_BPS.default / 10000, // Convert BPS to decimal (50 BPS = 0.005)
      });

      // Build → simulate-for-CU-limit → Helius-priority-fee → sign → send.
      // When SEND_OPTIMIZED=false the wrapper falls through to a plain
      // sign+send so this site's behaviour matches the pre-wrapper code path.
      // The wrapper also returns the blockhash it used so we can confirm
      // against the matching pair (the previous implementation fetched a
      // fresh blockhash for confirmation, which could falsely time out if
      // the build blockhash had already expired).
      const sendResult = await sendOptimized({
        connection,
        tx,
        wallet,
        additionalSigners: [positionKeypair],
        label: 'createPosition',
      });
      const signature = sendResult.signature;

      log.info('Position creation transaction submitted', {
        signature,
        solscan: `https://solscan.io/tx/${signature}`,
        optimized: sendResult.optimized,
        ...(sendResult.optimized
          ? {
              cuLimit: sendResult.cuLimit,
              cuPriceMicroLamports: sendResult.cuPriceMicroLamports,
            }
          : {}),
      });

      // Wait for confirmation against the build-time blockhash.
      await connection.confirmTransaction({
        signature,
        blockhash: sendResult.blockhash,
        lastValidBlockHeight: sendResult.lastValidBlockHeight,
      });

      const positionMint = positionKeypair.publicKey.toBase58();

      log.info('✅ Position created successfully', {
        positionMint,
        signature,
        solscan: `https://solscan.io/tx/${signature}`,
      });

      // Fetch and log transaction fees
      const feeDetails = await getTransactionFees(connection, signature);
      logTransactionFees(signature, feeDetails, 'Position Creation');

      // Track fees in state (async, don't wait)
      const solPriceData = await getSolPrice();
      const { trackTransactionFee } = await import('../utils/transactionUtils.js');
      trackTransactionFee(connection, signature, 'createPosition', solPriceData.usd).catch(err => {
        log.warn('Failed to track transaction fee in state', { error: err.message });
      });

      // Add to our position list and save to state
      // For auto-tune mode, we only manage one position at a time
      // Replace the array instead of appending to avoid accumulating closed positions
      if (this.config.autoTuneEnabled) {
        this.positionMints = [positionMint];
      } else {
        this.positionMints.push(positionMint);
      }
      saveCreatedPositionMints(this.positionMints);

      log.info('Position mint saved to state', {
        positionMint,
        totalPositions: this.positionMints.length,
      });

      // ────────────────────────────────────────────────────────────────────
      // PnL DB: record the freshly-opened position + transaction.
      //
      // We use solPriceData.usd (already fetched above for trackTransactionFee)
      // as the entry price — it's the same price the position was sized
      // around, so the HODL baselines line up with the operator's intent.
      // We also pass binCount = maxBinId − minBinId + 1 so the snapshot
      // matches the actual on-chain range (which validateAndAdjustPriceRange
      // may have shrunk from the requested range).
      // ────────────────────────────────────────────────────────────────────
      const positionId = recordPositionOpened({
        positionMint,
        poolAddress: params.poolAddress,
        signature,
        depositSol: params.solAmount,
        depositUsdc: params.usdcAmount,
        priceSolUsdAtOpen: solPriceData.usd,
        rangeLowerPrice: adjustedLower,
        rangeUpperPrice: adjustedUpper,
        binCount: maxBinId - minBinId + 1,
        strategyType: this.config.meteoraStrategyType,
      });
      recordTransaction({
        signature,
        kind: 'create_position',
        positionId,
        rawMeta: {
          requestedLower: params.priceLower,
          requestedUpper: params.priceUpper,
          adjustedLower,
          adjustedUpper,
        },
      });

      return {
        positionMint,
        signature,
        solDeposited: params.solAmount,
        usdcDeposited: params.usdcAmount,
      };
    } catch (error) {
      log.error('Failed to create Meteora position', {
        error: error instanceof Error ? error.message : String(error),
        params,
      });
      throw error;
    }
  }

  /**
   * Helper: Convert price to nearest bin ID
   * Uses SDK's built-in getBinIdFromPrice() method for accuracy
   */
  private priceToNearestBinId(dlmmPool: any, price: number): number {
    // Convert human-readable price to lamport format
    const pricePerLamport = dlmmPool.toPricePerLamport(price);

    // Use SDK method to calculate bin ID (false = don't round up)
    const binId = dlmmPool.getBinIdFromPrice(pricePerLamport, false);

    return binId;
  }

  /**
   * Helper: Validate and adjust price range to fit within DLMM position width limits
   * Returns adjusted price bounds that respect the max bin width constraint
   */
  private validateAndAdjustPriceRange(
    dlmmPool: any,
    priceLower: number,
    priceUpper: number,
    activePrice: number
  ): { adjustedLower: number; adjustedUpper: number; minBinId: number; maxBinId: number } {
    // Calculate initial bin IDs
    const minBinId = this.priceToNearestBinId(dlmmPool, priceLower);
    const maxBinId = this.priceToNearestBinId(dlmmPool, priceUpper);
    const activeBinId = this.priceToNearestBinId(dlmmPool, activePrice);

    const requestedWidth = maxBinId - minBinId + 1;

    log.debug('Price range validation', {
      priceLower,
      priceUpper,
      activePrice,
      minBinId,
      maxBinId,
      activeBinId,
      requestedWidth,
      maxAllowed: METEORA_LIMITS.MAX_POSITION_WIDTH_BINS,
    });

    // If within limits, return as-is
    if (requestedWidth <= METEORA_LIMITS.MAX_POSITION_WIDTH_BINS) {
      return {
        adjustedLower: priceLower,
        adjustedUpper: priceUpper,
        minBinId,
        maxBinId,
      };
    }

    // Position too wide - need to adjust
    log.warn('Position width exceeds maximum, adjusting range', {
      requestedWidth,
      maxAllowed: METEORA_LIMITS.MAX_POSITION_WIDTH_BINS,
      originalRange: { priceLower, priceUpper },
    });

    // Strategy: Center the range around the active bin with max allowed width
    const halfWidth = Math.floor(METEORA_LIMITS.MAX_POSITION_WIDTH_BINS / 2);
    const adjustedMinBinId = activeBinId - halfWidth;
    const adjustedMaxBinId = activeBinId + halfWidth;

    // Convert bin IDs back to prices using our utility
    // Note: SDK doesn't provide binIdToPrice(), so we use our getPriceFromBinId utility
    const adjustedLower = getPriceFromBinId(
      adjustedMinBinId,
      dlmmPool.lbPair.binStep,
      DECIMALS.SOL,
      DECIMALS.USDC
    ).toNumber();
    const adjustedUpper = getPriceFromBinId(
      adjustedMaxBinId,
      dlmmPool.lbPair.binStep,
      DECIMALS.SOL,
      DECIMALS.USDC
    ).toNumber();

    log.info('Adjusted price range to fit within limits', {
      original: { priceLower, priceUpper, width: requestedWidth },
      adjusted: {
        priceLower: adjustedLower,
        priceUpper: adjustedUpper,
        width: adjustedMaxBinId - adjustedMinBinId + 1,
      },
      bins: { minBinId: adjustedMinBinId, maxBinId: adjustedMaxBinId },
    });

    return {
      adjustedLower,
      adjustedUpper,
      minBinId: adjustedMinBinId,
      maxBinId: adjustedMaxBinId,
    };
  }

  /**
   * Auto-create position if needed (called on initialization)
   * Returns true if position was created, false if already exists
   */
  async autoCreatePositionIfNeeded(): Promise<boolean> {
    if (!this.config.autoCreatePositions) {
      log.debug('Auto-create disabled, skipping position creation');
      return false;
    }

    // Check if positions already exist (loaded from state.json)
    if (this.positionMints.length > 0) {
      log.info('Positions already exist, skipping auto-creation', {
        count: this.positionMints.length,
        mints: this.positionMints,
      });
      return false;
    }

    log.info('No existing positions found, will create new position');

    // Get current SOL price for price range calculation
    const priceData = await getSolPrice();
    const currentPrice = priceData.usd;

    // Calculate price bounds from BPS offsets
    const lowerBps = this.config.priceRangeBpsLower || -500;
    const upperBps = this.config.priceRangeBpsUpper || 500;

    const priceLower = currentPrice * (1 + lowerBps / 10000);
    const priceUpper = currentPrice * (1 + upperBps / 10000);

    log.info('Calculated price range', {
      currentPrice,
      priceLower,
      priceUpper,
      lowerBps,
      upperBps,
    });

    // Create position with configured parameters
    const result = await this.createPosition({
      poolAddress: this.config.meteoraPoolAddress!,
      solAmount: this.config.initialDepositSol || 0,
      usdcAmount: this.config.initialDepositUsdc || 0,
      priceLower,
      priceUpper,
    });

    // Save created position mint
    this.positionMints = [result.positionMint];

    // Persist to state.json for future runs
    saveCreatedPositionMints(this.positionMints);

    log.info('Position created successfully and saved to state', {
      positionMint: result.positionMint,
      signature: result.signature,
      solDeposited: result.solDeposited,
      usdcDeposited: result.usdcDeposited,
    });

    return true;
  }

  /**
   * Get total LP exposure across all positions
   */
  async getLpExposure(): Promise<LpExposure> {
    // Ensure positions are loaded from state or blockchain
    await this.ensurePositionsLoaded();

    log.info('📊 Reading LP exposure', {
      positionCount: this.positionMints.length,
      mints: this.positionMints,
    });

    if (this.positionMints.length === 0) {
      log.warn('⚠️  No position mints available after ensurePositionsLoaded()');
      return {
        solAmount: 0,
        usdcAmount: 0,
        totalUsd: 0,
        claimableSol: 0,
        claimableUsdc: 0,
        positions: [],
      };
    }

    try {
      const connection = getConnection();
      const wallet = getWalletKeypair();

      // We need to get the pool address from config
      const poolPubkey = new PublicKey(this.config.meteoraPoolAddress!);
      const dlmmPool = await DLMM.create(connection, poolPubkey);

      // Get all positions for this user and pool
      const { userPositions } = await dlmmPool.getPositionsByUserAndLbPair(wallet.publicKey);

      // Filter positions to only those in our positionMints list.
      // Read-only observers skip the filter: their local state.json goes stale
      // every time the owner process rebalances (new position mint), and an
      // equity read filtered on stale mints would report $0 while funds sit in
      // the pool. For an observer the on-chain set IS the truth.
      const ourPositions = this.readOnly
        ? userPositions
        : userPositions.filter((pos: any) => this.positionMints.includes(pos.publicKey.toBase58()));

      if (ourPositions.length === 0) {
        log.warn('No positions found matching configured mints', {
          expectedMints: this.positionMints,
        });
        // On-chain truth says none of our tracked mints exist → prune the stale
        // state here too (the chain query above is authoritative for this pool),
        // so a phantom mint can't survive across cycles even if ensurePositionsLoaded
        // short-circuited on it. Mirrors discoverPositionsFromBlockchain's auto-heal.
        if (this.positionMints.length > 0) {
          log.warn('Pruning stale tracked LP mints (no on-chain match)', {
            staleMints: this.positionMints,
          });
          this.positionMints = [];
          this.persistPositionMints([]);
        }
        return {
          solAmount: 0,
          usdcAmount: 0,
          totalUsd: 0,
          claimableSol: 0,
          claimableUsdc: 0,
          positions: [],
        };
      }

      // Aggregate exposure across all positions
      let totalSol = 0;
      let totalUsdc = 0;
      let totalClaimableSol = 0;
      let totalClaimableUsdc = 0;

      // Get current SOL price to calculate total USD value
      const priceData = await getSolPrice();

      // Get active bin for price reference
      const activeBinData = await getActiveBin(dlmmPool);
      const currentPrice = activeBinData.pricePerToken;

      const positionDetails = ourPositions.map((pos: any) => {
        // Convert BN amounts to numbers with proper decimals
        const solAmount = parseFloat(pos.positionData.totalXAmount) / 10 ** DECIMALS.SOL;
        const usdcAmount = parseFloat(pos.positionData.totalYAmount) / 10 ** DECIMALS.USDC;

        // Use parseFloat for fees to avoid BN precision issues
        const claimableSol = parseFloat(pos.positionData.feeX.toString()) / 10 ** DECIMALS.SOL;
        const claimableUsdc = parseFloat(pos.positionData.feeY.toString()) / 10 ** DECIMALS.USDC;

        totalSol += solAmount;
        totalUsdc += usdcAmount;
        totalClaimableSol += claimableSol;
        totalClaimableUsdc += claimableUsdc;

        // Calculate position range prices
        const binStep = dlmmPool.lbPair.binStep;
        const lowerBinPrice = getPriceFromBinId(
          pos.positionData.lowerBinId,
          binStep,
          DECIMALS.SOL,
          DECIMALS.USDC
        ).toNumber();
        const upperBinPrice = getPriceFromBinId(
          pos.positionData.upperBinId,
          binStep,
          DECIMALS.SOL,
          DECIMALS.USDC
        ).toNumber();

        // Calculate token composition percentages
        const composition = calculateTokenPercentages(
          currentPrice,
          lowerBinPrice,
          upperBinPrice
        );

        log.debug('Position composition', {
          mint: pos.publicKey.toBase58(),
          currentPrice,
          lowerBinPrice,
          upperBinPrice,
          solPercent: composition.tokenX,
          usdcPercent: composition.tokenY,
        });

        return {
          mint: pos.publicKey.toBase58(),
          solAmount,
          usdcAmount,
          valueUsd: solAmount * priceData.usd + usdcAmount,
          claimableSol,
          claimableUsdc,
          lowerBinId: pos.positionData.lowerBinId,
          upperBinId: pos.positionData.upperBinId,
        };
      });

      const totalUsd = totalSol * priceData.usd + totalUsdc;

      log.info('LP exposure calculated', {
        totalSol,
        totalUsdc,
        totalUsd,
        totalClaimableSol,
        totalClaimableUsdc,
        positionCount: ourPositions.length,
      });

      return {
        solAmount: totalSol,
        usdcAmount: totalUsdc,
        totalUsd,
        claimableSol: totalClaimableSol,
        claimableUsdc: totalClaimableUsdc,
        positions: positionDetails,
      };
    } catch (error) {
      log.error('Failed to read LP exposure', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Withdraw 100%, claim fees, and close position in a SINGLE ATOMIC transaction
   *
   * This uses the Meteora SDK's `shouldClaimAndClose=true` parameter which ensures
   * all three operations execute atomically within ONE transaction:
   * 1. Withdraw 100% liquidity
   * 2. Claim all accumulated fees
   * 3. Close position and reclaim rent
   *
   * @param positionMint - Position NFT public key as string
   * @returns Object containing signature and claimed fees
   */
  async withdrawClaimAndClose(positionMint: string): Promise<{
    signature: string;
    claimedFees: {
      sol: number;
      usdc: number;
    };
  }> {
    log.info('Withdraw + Claim + Close (SINGLE ATOMIC TRANSACTION)', { positionMint });

    try {
      const connection = getConnection();
      const wallet = getWalletKeypair();

      log.info('Step 1: Creating DLMM pool instance...');
      const positionPubkey = new PublicKey(positionMint);
      const poolPubkey = new PublicKey(this.config.meteoraPoolAddress!);
      const dlmmPool = await DLMM.create(connection, poolPubkey);
      log.info('✅ DLMM pool instance created');

      // Get position data
      log.info('Step 2: Fetching user positions...');
      const { userPositions } = await dlmmPool.getPositionsByUserAndLbPair(wallet.publicKey);
      log.info('✅ User positions fetched', { count: userPositions.length });

      log.info('Step 3: Finding position in user positions...');
      const position = userPositions.find((p: any) => p.publicKey.equals(positionPubkey));

      if (!position) {
        log.error('❌ Position not found!', {
          searchingFor: positionMint,
          availablePositions: userPositions.map((p: any) => p.publicKey.toBase58()),
        });
        throw new Error('Position not found');
      }
      log.info('✅ Position found');

      // Calculate claimable fees before withdrawal
      log.info('Step 4: Calculating claimable fees...');
      // Use parseFloat with toString() to avoid BN precision issues
      const claimableSol = parseFloat(position.positionData.feeX.toString()) / 10 ** DECIMALS.SOL;
      const claimableUsdc = parseFloat(position.positionData.feeY.toString()) / 10 ** DECIMALS.USDC;
      log.info('✅ Fees calculated');

      // Snapshot principal token amounts BEFORE the SDK call. After
      // `shouldClaimAndClose=true` the position account is closed and we lose
      // visibility into what was inside; we need these for recordPositionClosed
      // PnL math. Same parseFloat(toString()) trick getLpExposure uses to
      // dodge BN precision issues.
      const exitSolAmount =
        parseFloat(position.positionData.totalXAmount.toString()) / 10 ** DECIMALS.SOL;
      const exitUsdcAmount =
        parseFloat(position.positionData.totalYAmount.toString()) / 10 ** DECIMALS.USDC;

      log.info('Position details', {
        lowerBinId: position.positionData.lowerBinId,
        upperBinId: position.positionData.upperBinId,
        claimableFees: { sol: claimableSol, usdc: claimableUsdc },
      });

      log.info('🔄 Calling Meteora SDK removeLiquidity...', {
        fromBinId: position.positionData.lowerBinId,
        toBinId: position.positionData.upperBinId,
        withdrawPercentage: '100%',
      });

      // SDK's removeLiquidity with shouldClaimAndClose=true creates ONE TRANSACTION
      // that includes all instructions for withdraw + claim + close atomically.
      //
      // The previous implementation wrapped this in a 30s Promise.race timeout.
      // That was too aggressive — the SDK does several RPC reads to build the
      // transaction (getPositionsByUserAndLbPair, getMultipleAccountsInfo,
      // ALT lookups) and on a slow RPC these legitimately take >30s. False
      // timeouts here propagated up as failures even when nothing was actually
      // wrong, burning a Phase 1 retry slot every cycle.
      //
      // We extend the ceiling to 90s and rely on:
      //   1. The Phase 1 retry loop in autoTuneOrchestrator for the loud
      //      cases (real RPC failures, SDK errors).
      //   2. The defensive on-chain check in this function's catch block
      //      below — if a transaction did somehow settle despite a local
      //      error, we surface that as a successful close instead of a
      //      retry-able failure.
      const removeLiquidityPromise = dlmmPool.removeLiquidity({
        user: wallet.publicKey,
        position: positionPubkey,
        fromBinId: position.positionData.lowerBinId,
        toBinId: position.positionData.upperBinId,
        bps: new BN(10000), // 100%
        shouldClaimAndClose: true, // ATOMIC: withdraw + claim + close in ONE TX
        skipUnwrapSOL: false,
      });

      const REMOVE_LIQUIDITY_TIMEOUT_MS = 90_000;
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error(`removeLiquidity timeout after ${REMOVE_LIQUIDITY_TIMEOUT_MS / 1000}s — usually indicates RPC slowness, not on-chain failure`)),
          REMOVE_LIQUIDITY_TIMEOUT_MS
        )
      );

      const withdrawTxs = await Promise.race([removeLiquidityPromise, timeoutPromise]) as any[];

      log.info('✅ SDK removeLiquidity returned', { txCount: withdrawTxs.length });

      if (withdrawTxs.length === 0) {
        throw new Error('No withdraw transactions returned from SDK');
      }

      // Use the first transaction (SDK already added compute budget — the
      // sendOptimized wrapper strips and replaces them with adaptive values
      // when SEND_OPTIMIZED=true).
      const tx = withdrawTxs[0];

      // Build → simulate-for-CU-limit → Helius-priority-fee → sign → send.
      // Single signer (wallet); no additionalSigners. The wrapper returns
      // the build-time blockhash so confirmation matches — preserving the
      // existing on-chain race-recovery semantics in the catch block below.
      const sendResult = await sendOptimized({
        connection,
        tx,
        wallet,
        label: 'withdrawClaimAndClose',
      });
      const signature = sendResult.signature;

      log.info('SINGLE TRANSACTION submitted: Withdraw + Claim + Close', {
        signature,
        solscan: `https://solscan.io/tx/${signature}`,
        optimized: sendResult.optimized,
        ...(sendResult.optimized
          ? {
              cuLimit: sendResult.cuLimit,
              cuPriceMicroLamports: sendResult.cuPriceMicroLamports,
            }
          : {}),
      });

      // Wait for confirmation using the SAME blockhash we used when building the transaction
      await connection.confirmTransaction({
        signature,
        blockhash: sendResult.blockhash,
        lastValidBlockHeight: sendResult.lastValidBlockHeight,
      });

      log.info('✅ Withdraw + Claim + Close completed successfully (1 TX)', {
        signature,
        claimedFees: { sol: claimableSol, usdc: claimableUsdc },
        solscan: `https://solscan.io/tx/${signature}`,
      });

      // Fetch and log transaction fees
      const feeDetails = await getTransactionFees(connection, signature);
      logTransactionFees(signature, feeDetails, 'Withdraw + Claim + Close');

      // Track fees in state (async, don't wait)
      const solPriceData = await getSolPrice();
      const { trackTransactionFee } = await import('../utils/transactionUtils.js');
      trackTransactionFee(connection, signature, 'withdrawClaimClose', solPriceData.usd).catch(err => {
        log.warn('Failed to track transaction fee in state', { error: err.message });
      });

      // ────────────────────────────────────────────────────────────────────
      // PnL DB: close the position row + record the close transaction.
      //
      // recordPositionClosed will look up the open position by mint, compute
      // PnL vs each HODL benchmark from the persisted entry-time amounts, and
      // mark it closed. If no open row matches (position was opened before
      // the DB existed), the helper logs and returns null without throwing.
      // ────────────────────────────────────────────────────────────────────
      const closedDbId = recordPositionClosed({
        positionMint,
        signature,
        exitSol: exitSolAmount,
        exitUsdc: exitUsdcAmount,
        priceSolUsdAtClose: solPriceData.usd,
        claimedFeesSol: claimableSol,
        claimedFeesUsdc: claimableUsdc,
      });
      recordTransaction({
        signature,
        kind: 'withdraw_claim_close',
        positionId: closedDbId,
        rawMeta: {
          claimedFeesSol: claimableSol,
          claimedFeesUsdc: claimableUsdc,
          exitSol: exitSolAmount,
          exitUsdc: exitUsdcAmount,
          priceSolUsdAtClose: solPriceData.usd,
        },
      });

      // Remove from our position list (in-memory only, don't save to disk yet!)
      // We'll save the new position mint when createPosition() is called during rebalance
      // This prevents a race condition where state.json briefly contains an empty array
      this.positionMints = this.positionMints.filter(mint => mint !== positionMint);

      // DO NOT save empty array to disk here - it creates a race condition!
      // The orchestrator will call createPosition() next, which will save the new position mint
      log.info('Position removed from in-memory list (not saved to disk yet)', {
        removedMint: positionMint,
        remainingCount: this.positionMints.length,
      });

      return {
        signature,
        claimedFees: {
          sol: claimableSol,
          usdc: claimableUsdc,
        },
      };
    } catch (error) {
      log.error('Failed to withdraw + claim + close position', {
        error: error instanceof Error ? error.message : String(error),
        positionMint,
      });

      // Defensive on-chain re-check: even with a local error, the transaction
      // may have settled on-chain. The most common case is `confirmTransaction`
      // returning an error because `lastValidBlockHeight` expired — but the
      // transaction actually landed in a slot before expiry. Re-throwing here
      // would cause the Phase 1 retry layer to attempt a withdraw on a
      // position that no longer exists, which fails noisily with a confusing
      // "position not found" further down the line.
      //
      // If the position is no longer on-chain, treat the operation as
      // successful (with a placeholder result — we lost visibility into the
      // exact claimed-fee amounts because we caught the error before parsing
      // them, but Phase 2 reads live wallet balances and doesn't depend on
      // those numbers).
      try {
        const stillOpen = await this.isPositionStillOnChain(positionMint);
        if (!stillOpen) {
          log.warn(
            '⚠️  Position is no longer on-chain despite local error — treating as a successful close',
            {
              positionMint,
              originalError: error instanceof Error ? error.message : String(error),
              note:
                'Lost visibility into exact claimed-fee amounts (caught before parse). ' +
                'Phase 2 reads live wallet balance, so no functional impact.',
            }
          );

          // Mirror the in-memory cleanup the success path does so the
          // caller sees a consistent post-close state.
          this.positionMints = this.positionMints.filter((mint) => mint !== positionMint);

          return {
            signature: 'unknown-after-error-recovery',
            claimedFees: { sol: 0, usdc: 0 },
          };
        }
      } catch (checkError) {
        // The on-chain check itself failed (e.g. RPC down). Don't swallow
        // the original error — re-throw it so the operator sees the actual
        // problem, not a confusing "check failed" message.
        log.warn('On-chain re-check failed, re-throwing original error', {
          checkError: checkError instanceof Error ? checkError.message : String(checkError),
        });
      }

      throw error;
    }
  }

  /**
   * Read-only check: is the given position mint still owned by the wallet
   * on-chain? Returns `true` if it exists, `false` if it doesn't.
   *
   * Unlike `discoverPositionsFromBlockchain`, this method does NOT mutate
   * `this.positionMints` or write state — it's safe to call defensively
   * inside error-handling paths without surprising side effects.
   */
  private async isPositionStillOnChain(positionMint: string): Promise<boolean> {
    const connection = getConnection();
    const wallet = getWalletKeypair();
    const poolPubkey = new PublicKey(this.config.meteoraPoolAddress!);
    const dlmmPool = await DLMM.create(connection, poolPubkey);
    const { userPositions } = await dlmmPool.getPositionsByUserAndLbPair(wallet.publicKey);
    return userPositions.some((p: any) => p.publicKey.toBase58() === positionMint);
  }

}
