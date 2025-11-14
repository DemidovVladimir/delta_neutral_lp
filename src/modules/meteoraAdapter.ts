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
import DLMMModule from '@meteora-ag/dlmm';
import { StrategyType } from '@meteora-ag/dlmm';

// Handle ESM/CommonJS interop for DLMM class
// @ts-ignore - ESM default export handling
const DLMM: any = DLMMModule.default || DLMMModule;
import { getSolPrice } from '../core/priceOracle.js';
import { getConfig } from '../config/env.js';
import { log } from '../utils/logger.js';
import { getConnection, getWalletKeypair } from '../utils/solana.js';
import {
  loadCreatedPositionMints,
  saveCreatedPositionMints,
} from './persistence.js';
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

export class MeteoraAdapter {
  private config = getConfig();
  private positionMints: string[] = [];
  private poolInfo: MeteoraPairInfo | null = null;
  private poolInfoLastFetched: number = 0;
  private readonly POOL_INFO_CACHE_MS = 2500; // Cache for 2.5 seconds

  constructor() {
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
        saveCreatedPositionMints(this.positionMints);
        return [discoveredMints[0]];
      }

      // For non-auto-tune mode, merge with saved positions (avoid duplicates)
      const mergedMints = Array.from(new Set([...this.positionMints, ...discoveredMints]));

      // Update in-memory positions
      this.positionMints = mergedMints;

      // Save merged positions to state for future startups
      if (mergedMints.length > this.positionMints.length) {
        saveCreatedPositionMints(mergedMints);
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

      // Add priority fees
      // TODO: Consider bringing this back if needed, just trying without to save fees
      // await this.enhanceTransaction(tx);

      // Sign and send transaction
      tx.partialSign(wallet);
      tx.partialSign(positionKeypair);
      const signature = await connection.sendRawTransaction(tx.serialize(), {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
      });

      log.info('Position creation transaction submitted', {
        signature,
        solscan: `https://solscan.io/tx/${signature}`,
      });

      // Wait for confirmation
      const latestBlockhash = await connection.getLatestBlockhash();
      await connection.confirmTransaction({
        signature,
        ...latestBlockhash,
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

      // Filter positions to only those in our positionMints list
      const ourPositions = userPositions.filter((pos: any) =>
        this.positionMints.includes(pos.publicKey.toBase58())
      );

      if (ourPositions.length === 0) {
        log.warn('No positions found matching configured mints', {
          expectedMints: this.positionMints,
        });
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
      // that includes all instructions for withdraw + claim + close atomically
      // Add timeout to prevent hanging forever
      const removeLiquidityPromise = dlmmPool.removeLiquidity({
        user: wallet.publicKey,
        position: positionPubkey,
        fromBinId: position.positionData.lowerBinId,
        toBinId: position.positionData.upperBinId,
        bps: new BN(10000), // 100%
        shouldClaimAndClose: true, // ATOMIC: withdraw + claim + close in ONE TX
        skipUnwrapSOL: false,
      });

      // Add 30 second timeout
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('removeLiquidity timeout after 30s')), 30000)
      );

      const withdrawTxs = await Promise.race([removeLiquidityPromise, timeoutPromise]) as any[];

      log.info('✅ SDK removeLiquidity returned', { txCount: withdrawTxs.length });

      if (withdrawTxs.length === 0) {
        throw new Error('No withdraw transactions returned from SDK');
      }

      // Use the first transaction (SDK already added compute budget)
      const tx = withdrawTxs[0];


      // Sign and send transaction
      tx.feePayer = wallet.publicKey;
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.sign(wallet);

      const signature = await connection.sendRawTransaction(tx.serialize(), {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
        maxRetries: 3,
      });

      log.info('SINGLE TRANSACTION submitted: Withdraw + Claim + Close', {
        signature,
        solscan: `https://solscan.io/tx/${signature}`,
      });

      // Wait for confirmation using the SAME blockhash we used when building the transaction
      await connection.confirmTransaction({
        signature,
        blockhash,
        lastValidBlockHeight,
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
      throw error;
    }
  }

}
