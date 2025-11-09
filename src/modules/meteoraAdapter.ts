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

import { PublicKey, Keypair, LAMPORTS_PER_SOL, ComputeBudgetProgram, Transaction } from '@solana/web3.js';
import BN from 'bn.js';
import DLMMModule from '@meteora-ag/dlmm';
import { StrategyType } from '@meteora-ag/dlmm';

// Handle ESM/CommonJS interop for DLMM class
// @ts-ignore - ESM default export handling
const DLMM: any = DLMMModule.default || DLMMModule;
import { getSolPrice } from '../core/priceOracle.js';
import { getConfig } from '../config/env.js';
import { log } from '../utils/logger.js';
import { getConnection, getWalletKeypair } from '../core/agentKit.js';
import {
  loadCreatedPositionMints,
  saveCreatedPositionMints,
} from './persistence.js';
import {
  LpExposure,
  DepositParams,
  WithdrawParams,
  ClaimResult,
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
import { getTransactionFees, logTransactionFees, getBatchTransactionFees } from '../utils/transactionUtils.js';
import { createEnhancedJitoTipInstruction, JitoTipConfig } from '../utils/jitoUtils.js';

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

      // Merge with saved positions (avoid duplicates)
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
      log.debug('Positions already loaded', { count: this.positionMints.length });
      return;
    }

    // No saved positions, try to discover from blockchain
    log.info('No saved positions found, attempting blockchain discovery...');
    await this.discoverPositionsFromBlockchain();
  }

  /**
   * Add priority fees and optional Jito tip to a transaction
   *
   * @param tx - Transaction to enhance
   * @param jitoConfig - Optional Jito tip configuration
   */
  private async enhanceTransaction(tx: Transaction, jitoConfig?: JitoTipConfig): Promise<void> {
    const wallet = getWalletKeypair();

    // Check if transaction already has ComputeBudget instructions
    const hasComputeBudgetInstructions = tx.instructions.some(
      (ix) => ix.programId.equals(ComputeBudgetProgram.programId)
    );

    if (hasComputeBudgetInstructions) {
      log.warn('Transaction already contains ComputeBudget instructions, skipping addition to avoid duplicates');
    } else {
      // 1. Add ComputeBudget instructions (priority fees)
      const computeUnitPrice = ComputeBudgetProgram.setComputeUnitPrice({
        microLamports: this.config.priorityFeeMicroLamports,
      });

      const computeUnitLimit = ComputeBudgetProgram.setComputeUnitLimit({
        units: this.config.maxComputeUnits,
      });

      // Add at beginning of transaction (order matters!)
      tx.instructions.unshift(computeUnitLimit);
      tx.instructions.unshift(computeUnitPrice);

      log.debug('Added priority fee instructions', {
        priorityFeeMicroLamports: this.config.priorityFeeMicroLamports,
        maxComputeUnits: this.config.maxComputeUnits,
      });
    }

    // 2. Add Jito tip if enabled and config provided
    if (this.config.useJito && jitoConfig) {
      const jitoTipIx = await createEnhancedJitoTipInstruction(wallet.publicKey, jitoConfig);
      tx.add(jitoTipIx);

      log.debug('Added Jito tip instruction', {
        priority: jitoConfig.priority,
        attempt: jitoConfig.attempt || 0,
      });
    }
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

      // Create strategy parameters for balanced deposit
      const strategyParameters = {
        maxBinId,
        minBinId,
        strategyType: StrategyType.Spot, // Spot strategy for balanced liquidity
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

      // Add priority fees and Jito tip (normal priority for position creation)
      await this.enhanceTransaction(tx, {
        priority: 'normal',
        attempt: 0,
      });

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

      // Add to our position list and save to state
      this.positionMints.push(positionMint);
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

    log.debug('Reading LP exposure', {
      positionCount: this.positionMints.length,
    });

    if (this.positionMints.length === 0) {
      log.warn('No position mints available');
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
        const claimableSol = pos.positionData.feeX.toNumber() / 10 ** DECIMALS.SOL;
        const claimableUsdc = pos.positionData.feeY.toNumber() / 10 ** DECIMALS.USDC;

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
   * Deposit to LP position
   */
  async depositToLp(params: DepositParams): Promise<string> {
    log.info('Depositing to LP', params);

    try {
      const connection = getConnection();
      const wallet = getWalletKeypair();

      // Get the first position (or specified position)
      if (this.positionMints.length === 0) {
        throw new Error('No positions available to deposit to');
      }

      const positionPubkey = new PublicKey(this.positionMints[0]);
      const poolPubkey = new PublicKey(this.config.meteoraPoolAddress!);
      const dlmmPool = await DLMM.create(connection, poolPubkey);

      // Determine amounts based on parameters
      let totalXAmount = new BN(0);
      let totalYAmount = new BN(0);

      if (params.singleSided === 'sol' && params.sol) {
        totalXAmount = new BN(params.sol * 10 ** DECIMALS.SOL);
      } else if (params.singleSided === 'usdc' && params.usdc) {
        totalYAmount = new BN(params.usdc * 10 ** DECIMALS.USDC);
      } else if (!params.singleSided) {
        // Balanced deposit
        if (params.sol) totalXAmount = new BN(params.sol * 10 ** DECIMALS.SOL);
        if (params.usdc) totalYAmount = new BN(params.usdc * 10 ** DECIMALS.USDC);
      } else {
        throw new Error('Invalid deposit parameters');
      }

      // Get position data to determine bin range
      const { userPositions } = await dlmmPool.getPositionsByUserAndLbPair(wallet.publicKey);
      const position = userPositions.find((p: any) => p.publicKey.equals(positionPubkey));

      if (!position) {
        throw new Error('Position not found');
      }

      // Create strategy based on deposit mode
      const strategyParameters = {
        minBinId: position.positionData.lowerBinId,
        maxBinId: position.positionData.upperBinId,
        strategyType: StrategyType.Spot,
      };

      // Build add liquidity transaction
      const tx = await dlmmPool.addLiquidityByStrategy({
        positionPubKey: positionPubkey,
        totalXAmount,
        totalYAmount,
        strategy: strategyParameters,
        user: wallet.publicKey,
        slippage: SLIPPAGE_BPS.default / 10000,
      });

      // Add priority fees and Jito tip (normal priority for deposits)
      await this.enhanceTransaction(tx, {
        priority: 'normal',
        attempt: 0,
      });

      // Sign and send
      tx.partialSign(wallet);
      const signature = await connection.sendRawTransaction(tx.serialize(), {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
      });

      log.info('Deposit transaction submitted', {
        signature,
        solscan: `https://solscan.io/tx/${signature}`,
      });

      const latestBlockhash = await connection.getLatestBlockhash();
      await connection.confirmTransaction({
        signature,
        ...latestBlockhash,
      });

      log.info('✅ Deposit successful', {
        signature,
        solscan: `https://solscan.io/tx/${signature}`,
        params,
      });

      // Fetch and log transaction fees
      const feeDetails = await getTransactionFees(connection, signature);
      logTransactionFees(signature, feeDetails, 'Deposit');

      return signature;
    } catch (error) {
      log.error('Failed to deposit to LP', {
        error: error instanceof Error ? error.message : String(error),
        params,
      });
      throw error;
    }
  }

  /**
   * Withdraw from LP position
   */
  async withdrawFromLp(params: WithdrawParams): Promise<string> {
    log.info('Withdrawing from LP', params);

    try {
      const connection = getConnection();
      const wallet = getWalletKeypair();

      if (this.positionMints.length === 0) {
        throw new Error('No positions available to withdraw from');
      }

      // Determine which position to withdraw from
      let selectedPositionMint: string;
      if (params.positionMint) {
        // Use the specified position
        if (!this.positionMints.includes(params.positionMint)) {
          throw new Error(`Position mint ${params.positionMint} not found in managed positions`);
        }
        selectedPositionMint = params.positionMint;
      } else {
        // Default to first position for backward compatibility
        selectedPositionMint = this.positionMints[0];
      }

      const positionPubkey = new PublicKey(selectedPositionMint);
      const poolPubkey = new PublicKey(this.config.meteoraPoolAddress!);
      const dlmmPool = await DLMM.create(connection, poolPubkey);

      // Get position data
      const { userPositions } = await dlmmPool.getPositionsByUserAndLbPair(wallet.publicKey);
      const position = userPositions.find((p: any) => p.publicKey.equals(positionPubkey));

      if (!position) {
        throw new Error('Position not found');
      }

      // Calculate basis points for withdrawal
      let bps: BN;
      if (params.percent !== undefined) {
        // Convert percent to basis points (1% = 100 BPS, 100% = 10000 BPS)
        bps = new BN(params.percent * 100);
      } else if (params.amount !== undefined) {
        // For amount-based withdrawal, we need to calculate what percentage this represents
        // This is approximate - would need position value calculation
        throw new Error('Amount-based withdrawal not yet supported, use percent mode');
      } else {
        throw new Error('Invalid withdrawal parameters - must specify percent or amount');
      }

      // Remove liquidity transaction
      const txs = await dlmmPool.removeLiquidity({
        user: wallet.publicKey,
        position: positionPubkey,
        fromBinId: position.positionData.lowerBinId,
        toBinId: position.positionData.upperBinId,
        bps,
        shouldClaimAndClose: false, // Don't auto-close position
        skipUnwrapSOL: params.singleSidedOut !== 'usdc', // Unwrap SOL unless single-sided USDC out
      });

      // Sign and send all transactions
      const signatures: string[] = [];
      for (let i = 0; i < txs.length; i++) {
        const tx = txs[i];

        // Add priority fees and Jito tip (high priority for withdrawals)
        await this.enhanceTransaction(tx, {
          priority: 'high',
          attempt: 0,
        });

        tx.partialSign(wallet);
        const signature = await connection.sendRawTransaction(tx.serialize(), {
          skipPreflight: false,
          preflightCommitment: 'confirmed',
        });

        log.info(`Withdrawal transaction ${i + 1}/${txs.length} submitted`, {
          signature,
          solscan: `https://solscan.io/tx/${signature}`,
        });

        const latestBlockhash = await connection.getLatestBlockhash();
        await connection.confirmTransaction({
          signature,
          ...latestBlockhash,
        });

        signatures.push(signature);
      }

      const finalSignature = signatures[signatures.length - 1];

      log.info('✅ Withdrawal successful', {
        transactionCount: signatures.length,
        signatures,
        finalSignature,
        viewOnSolscan: signatures.map(sig => `https://solscan.io/tx/${sig}`),
        params,
      });

      // Calculate total transaction fees for all withdrawal transactions
      const batchFees = await getBatchTransactionFees(connection, signatures);
      log.info('💰 Total transaction fees - Withdrawal', {
        transactionCount: signatures.length,
        totalFeeLamports: batchFees.totalFeeLamports,
        totalFeeSol: batchFees.totalFeeSol.toFixed(6),
        totalFeeUsd: (batchFees.totalFeeSol * 163).toFixed(4),
        totalComputeUnits: batchFees.totalComputeUnits,
      });

      return finalSignature;
    } catch (error) {
      log.error('Failed to withdraw from LP', {
        error: error instanceof Error ? error.message : String(error),
        params,
      });
      throw error;
    }
  }

  /**
   * Close an empty position to reclaim position NFT rent (~0.057 SOL)
   *
   * IMPORTANT: Only the position NFT rent is recoverable.
   * Bin array rent (~0.14 SOL) is NON-REFUNDABLE as bin arrays are shared pool infrastructure.
   *
   * NOTE: Position must be fully withdrawn (0 liquidity) before closing
   */
  async closePosition(positionMint: string): Promise<string> {
    log.info('Closing position and reclaiming rent', { positionMint });

    try {
      const connection = getConnection();
      const wallet = getWalletKeypair();

      const positionPubkey = new PublicKey(positionMint);
      const poolPubkey = new PublicKey(this.config.meteoraPoolAddress!);
      const dlmmPool = await DLMM.create(connection, poolPubkey);

      // Get position data to verify it's empty
      const { userPositions } = await dlmmPool.getPositionsByUserAndLbPair(wallet.publicKey);
      const position = userPositions.find((p: any) => p.publicKey.equals(positionPubkey));

      if (!position) {
        throw new Error('Position not found');
      }

      // Check if position is empty (no liquidity left)
      const hasLiquidity = position.positionData.liquidityShares?.gt(new BN(0));
      if (hasLiquidity) {
        throw new Error('Cannot close position with liquidity. Please withdraw 100% first.');
      }

      // Close position using the SDK's closePosition method
      // The position parameter needs to be an LbPosition object with publicKey and positionData
      const closeTx = await dlmmPool.closePosition({
        owner: wallet.publicKey,
        position, // Pass the full position object, not just the public key
      });

      // Add priority fees (low priority for closing, just reclaiming rent)
      await this.enhanceTransaction(closeTx, {
        priority: 'low',
        attempt: 0,
      });

      // Sign and send transaction
      closeTx.partialSign(wallet);
      const signature = await connection.sendRawTransaction(closeTx.serialize(), {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
      });

      log.info('Close position transaction submitted', {
        signature,
        solscan: `https://solscan.io/tx/${signature}`,
      });

      // Wait for confirmation
      const latestBlockhash = await connection.getLatestBlockhash();
      await connection.confirmTransaction({
        signature,
        ...latestBlockhash,
      });

      log.info('✅ Position closed successfully, rent reclaimed (~0.057 SOL)', {
        positionMint,
        signature,
        solscan: `https://solscan.io/tx/${signature}`,
      });

      // Fetch and log transaction fees
      const feeDetails = await getTransactionFees(connection, signature);
      logTransactionFees(signature, feeDetails, 'Close Position');

      // Remove from our position list
      this.positionMints = this.positionMints.filter(mint => mint !== positionMint);
      saveCreatedPositionMints(this.positionMints);

      return signature;
    } catch (error) {
      log.error('Failed to close position', {
        error: error instanceof Error ? error.message : String(error),
        positionMint,
      });
      throw error;
    }
  }

  /**
   * TWO-STEP REBALANCE: Sequential transactions for reliability
   *
   * This method performs rebalancing in two sequential transactions:
   *
   * Transaction 1: Withdraw + Claim + Close
   * - Withdraw 100% from old position
   * - Claim all accumulated fees
   * - Close empty position (reclaim rent)
   *
   * Transaction 2: Create New Position
   * - Create new position with Spot strategy
   * - Centered at current price with 20 bins
   * - Uses original funds + claimed fees (auto-compound)
   *
   * Example:
   * - User invested: 0.1 SOL + 16 USDC
   * - After price drop: 0.01 SOL + 31 USDC (imbalanced)
   * - Auto-tune rebalances
   * - New position: 0.1 SOL + claimed SOL fees + 16 USDC + claimed USDC fees
   *
   * @param params - Rebalance parameters
   * @returns Transaction signatures and new position mint
   */
  async atomicRebalance(params: {
    oldPositionMint: string;
    newPositionParams: {
      solAmount: number;
      usdcAmount: number;
      priceLower: number;
      priceUpper: number;
    };
  }): Promise<{
    signature: string;
    newPositionMint: string;
    claimedFees: { sol: number; usdc: number };
  }> {
    log.info('🔥 Starting TWO-STEP rebalance', {
      oldPosition: params.oldPositionMint,
      newPosition: params.newPositionParams,
    });

    try {
      const connection = getConnection();
      const wallet = getWalletKeypair();
      const poolPubkey = new PublicKey(this.config.meteoraPoolAddress!);
      const dlmmPool = await DLMM.create(connection, poolPubkey);
      const oldPositionPubkey = new PublicKey(params.oldPositionMint);

      // Get position data for withdraw and claim
      const { userPositions } = await dlmmPool.getPositionsByUserAndLbPair(wallet.publicKey);
      const position = userPositions.find((p: any) => p.publicKey.equals(oldPositionPubkey));

      if (!position) {
        throw new Error('Old position not found');
      }

      // Calculate claimable fees before operations
      const claimableSol = position.positionData.feeX.toNumber() / 10 ** DECIMALS.SOL;
      const claimableUsdc = position.positionData.feeY.toNumber() / 10 ** DECIMALS.USDC;

      log.info('Step 1: Withdraw + Claim + Close (shouldClaimAndClose=true)', {
        steps: ['SDK handles: Withdraw 100% → Claim fees → Close position'],
        claimableFees: { sol: claimableSol, usdc: claimableUsdc },
      });

      // ============================================================
      // TRANSACTION 1: Withdraw + Claim + Close
      // ============================================================
      // Use SDK's removeLiquidity with shouldClaimAndClose=true
      // SDK automatically includes compute budget instructions
      const withdrawTxs = await dlmmPool.removeLiquidity({
        user: wallet.publicKey,
        position: oldPositionPubkey,
        fromBinId: position.positionData.lowerBinId,
        toBinId: position.positionData.upperBinId,
        bps: new BN(10000), // 100%
        shouldClaimAndClose: true, // SDK handles withdraw + claim + close atomically
        skipUnwrapSOL: false,
      });

      if (withdrawTxs.length === 0) {
        throw new Error('No withdraw transactions returned from SDK');
      }

      // Use the first transaction directly (SDK already added compute budget)
      const tx1 = withdrawTxs[0];

      // Optional: Add Jito tip (normal priority) - add after SDK instructions
      if (this.config.useJito) {
        const jitoTipIx = await createEnhancedJitoTipInstruction(wallet.publicKey, {
          priority: 'normal',
          attempt: 0,
        });
        tx1.add(jitoTipIx);
      }

      // Sign and send Transaction 1
      tx1.feePayer = wallet.publicKey;
      tx1.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
      tx1.sign(wallet);

      const sig1 = await connection.sendRawTransaction(tx1.serialize(), {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
        maxRetries: 3,
      });

      log.info('Transaction 1 submitted: Withdraw + Claim + Close', {
        signature: sig1,
        solscan: `https://solscan.io/tx/${sig1}`,
      });

      // Wait for confirmation
      const latestBlockhash1 = await connection.getLatestBlockhash();
      await connection.confirmTransaction({
        signature: sig1,
        ...latestBlockhash1,
      });

      log.info('✅ Transaction 1 confirmed', { signature: sig1 });

      // ============================================================
      // TRANSACTION 2: Create New Position
      // ============================================================
      log.info('Step 2: Create new position with Spot strategy', {
        solAmount: params.newPositionParams.solAmount,
        usdcAmount: params.newPositionParams.usdcAmount,
        priceLower: params.newPositionParams.priceLower,
        priceUpper: params.newPositionParams.priceUpper,
      });

      // Create new position with Spot strategy
      const newPositionKeypair = Keypair.generate();
      const totalXAmount = new BN(params.newPositionParams.solAmount * 10 ** DECIMALS.SOL);
      const totalYAmount = new BN(params.newPositionParams.usdcAmount * 10 ** DECIMALS.USDC);

      // Validate and adjust price range
      const activePrice = await dlmmPool.getActiveBin().then((b: any) => parseFloat(b.price));
      const { minBinId, maxBinId } = this.validateAndAdjustPriceRange(
        dlmmPool,
        params.newPositionParams.priceLower,
        params.newPositionParams.priceUpper,
        activePrice
      );

      const strategyParameters = {
        maxBinId,
        minBinId,
        strategyType: StrategyType.Spot,
      };

      // SDK handles compute budget automatically
      const createTx = await dlmmPool.initializePositionAndAddLiquidityByStrategy({
        positionPubKey: newPositionKeypair.publicKey,
        totalXAmount,
        totalYAmount,
        strategy: strategyParameters,
        user: wallet.publicKey,
        slippage: SLIPPAGE_BPS.default / 10000,
      });

      // Use SDK's transaction directly
      const tx2 = createTx;

      // Optional: Add Jito tip after SDK instructions
      if (this.config.useJito) {
        const jitoTipIx = await createEnhancedJitoTipInstruction(wallet.publicKey, {
          priority: 'normal',
          attempt: 0,
        });
        tx2.add(jitoTipIx);
      }

      // Sign and send Transaction 2
      tx2.feePayer = wallet.publicKey;
      tx2.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
      tx2.partialSign(wallet, newPositionKeypair);

      const sig2 = await connection.sendRawTransaction(tx2.serialize(), {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
        maxRetries: 3,
      });

      log.info('Transaction 2 submitted: Create new position', {
        signature: sig2,
        solscan: `https://solscan.io/tx/${sig2}`,
      });

      // Wait for confirmation
      const latestBlockhash2 = await connection.getLatestBlockhash();
      await connection.confirmTransaction({
        signature: sig2,
        ...latestBlockhash2,
      });

      const newPositionMint = newPositionKeypair.publicKey.toBase58();

      log.info('✅ Transaction 2 confirmed', {
        signature: sig2,
        newPosition: newPositionMint,
      });

      // ============================================================
      // Update state and return
      // ============================================================
      log.info('✅ TWO-STEP rebalance completed successfully', {
        tx1: sig1,
        tx2: sig2,
        oldPosition: params.oldPositionMint,
        newPosition: newPositionMint,
        claimedFees: { sol: claimableSol, usdc: claimableUsdc },
      });

      // Update position mints
      this.positionMints = this.positionMints.filter(m => m !== params.oldPositionMint);
      this.positionMints.push(newPositionMint);
      saveCreatedPositionMints(this.positionMints);

      // Fetch and log transaction fees
      const feeDetails1 = await getTransactionFees(connection, sig1);
      logTransactionFees(sig1, feeDetails1, 'Rebalance Step 1 (Withdraw+Claim+Close)');

      const feeDetails2 = await getTransactionFees(connection, sig2);
      logTransactionFees(sig2, feeDetails2, 'Rebalance Step 2 (Create Position)');

      return {
        signature: sig2, // Return the final transaction signature
        newPositionMint,
        claimedFees: {
          sol: claimableSol,
          usdc: claimableUsdc,
        },
      };
    } catch (error) {
      log.error('Failed to execute two-step rebalance', {
        error: error instanceof Error ? error.message : String(error),
        params,
      });
      throw error;
    }
  }

  /**
   * Claim accumulated fees
   */
  async claimFees(): Promise<ClaimResult> {
    // Ensure positions are loaded from state or blockchain
    await this.ensurePositionsLoaded();

    log.info('Claiming fees from all positions');

    try {
      const connection = getConnection();
      const wallet = getWalletKeypair();

      if (this.positionMints.length === 0) {
        log.warn('No positions to claim fees from');
        return { sol: 0, usdc: 0, sig: '' };
      }

      const poolPubkey = new PublicKey(this.config.meteoraPoolAddress!);
      const dlmmPool = await DLMM.create(connection, poolPubkey);

      // Get all positions
      const { userPositions } = await dlmmPool.getPositionsByUserAndLbPair(wallet.publicKey);
      const ourPositions = userPositions.filter((pos: any) =>
        this.positionMints.includes(pos.publicKey.toBase58())
      );

      if (ourPositions.length === 0) {
        log.warn('No matching positions found');
        return { sol: 0, usdc: 0, sig: '' };
      }

      // Calculate total claimable fees
      let totalClaimableSol = 0;
      let totalClaimableUsdc = 0;

      for (const pos of ourPositions) {
        totalClaimableSol += pos.positionData.feeX.toNumber() / 10 ** DECIMALS.SOL;
        totalClaimableUsdc += pos.positionData.feeY.toNumber() / 10 ** DECIMALS.USDC;
      }

      if (totalClaimableSol === 0 && totalClaimableUsdc === 0) {
        log.info('No fees to claim');
        return { sol: 0, usdc: 0, sig: '' };
      }

      // Claim fees from all positions
      const claimTxs = await dlmmPool.claimAllRewards({
        owner: wallet.publicKey,
        positions: ourPositions,
      });

      // Sign and send all claim transactions
      const signatures: string[] = [];
      for (let i = 0; i < claimTxs.length; i++) {
        const tx = claimTxs[i];

        // Add priority fees (low priority for fee claims, not time-sensitive)
        await this.enhanceTransaction(tx, {
          priority: 'low',
          attempt: 0,
        });

        tx.partialSign(wallet);
        const signature = await connection.sendRawTransaction(tx.serialize(), {
          skipPreflight: false,
          preflightCommitment: 'confirmed',
        });

        log.info(`Fee claim transaction ${i + 1}/${claimTxs.length} submitted`, {
          signature,
          solscan: `https://solscan.io/tx/${signature}`,
        });

        const latestBlockhash = await connection.getLatestBlockhash();
        await connection.confirmTransaction({
          signature,
          ...latestBlockhash,
        });

        log.info(`Fee claim transaction ${i + 1}/${claimTxs.length} confirmed`, {
          signature,
        });

        signatures.push(signature);
      }

      const finalSignature = signatures[signatures.length - 1];

      // Calculate total transaction fees for all claim transactions
      const batchFees = await getBatchTransactionFees(connection, signatures);

      log.info('✅ Fees claimed successfully', {
        sol: totalClaimableSol,
        usdc: totalClaimableUsdc,
        transactionCount: signatures.length,
        signatures,
        finalSignature,
        viewOnSolscan: signatures.map(sig => `https://solscan.io/tx/${sig}`),
      });

      log.info('💰 Total transaction fees - Fee Claiming', {
        transactionCount: signatures.length,
        totalFeeLamports: batchFees.totalFeeLamports,
        totalFeeSol: batchFees.totalFeeSol.toFixed(6),
        totalFeeUsd: (batchFees.totalFeeSol * 163).toFixed(4), // Approximate
        totalComputeUnits: batchFees.totalComputeUnits,
        breakdown: batchFees.breakdown.map(b => ({
          signature: b.signature,
          feeSol: b.feeSol.toFixed(6),
          computeUnits: b.computeUnitsConsumed,
        })),
      });

      return {
        sol: totalClaimableSol,
        usdc: totalClaimableUsdc,
        sig: finalSignature,
      };
    } catch (error) {
      log.error('Failed to claim fees', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
