/**
 * Meteora DLMM Adapter
 *
 * Handles all interactions with Meteora DLMM pools:
 * - Auto-creation of LP positions
 * - Reading LP exposure from position NFTs
 * - Deposits and withdrawals
 * - Fee claims
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

export class MeteoraAdapter {
  private config = getConfig();
  private positionMints: string[] = [];
  private poolInfo: MeteoraPairInfo | null = null;
  private poolInfoLastFetched: number = 0;
  private readonly POOL_INFO_CACHE_MS = 2500; // Cache for 2.5 seconds

  constructor() {
    // Initialize position mints based on config mode
    if (this.config.autoCreatePositions) {
      // Try to load positions from state.json
      const savedMints = loadCreatedPositionMints();
      if (savedMints.length > 0) {
        this.positionMints = savedMints;
        log.info('MeteoraAdapter initialized in auto-create mode (positions loaded from state)', {
          count: savedMints.length,
          mints: savedMints,
        });
      } else {
        log.info('MeteoraAdapter initialized in auto-create mode (no saved positions)');
      }
    } else {
      // Use manually provided position mints from config
      if (!this.config.meteoraPositionMints || this.config.meteoraPositionMints.length === 0) {
        throw new Error(
          'METEORA_POSITION_MINTS is required when AUTO_CREATE_POSITIONS=false'
        );
      }
      this.positionMints = this.config.meteoraPositionMints;
      log.info('MeteoraAdapter initialized with existing positions', {
        count: this.positionMints.length,
        mints: this.positionMints,
      });
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

      // Sign and send transaction
      tx.partialSign(wallet);
      tx.partialSign(positionKeypair);
      const signature = await connection.sendRawTransaction(tx.serialize(), {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
      });

      // Wait for confirmation
      const latestBlockhash = await connection.getLatestBlockhash();
      await connection.confirmTransaction({
        signature,
        ...latestBlockhash,
      });

      log.info('Position created successfully', {
        positionMint: positionKeypair.publicKey.toBase58(),
        signature,
      });

      return {
        positionMint: positionKeypair.publicKey.toBase58(),
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
   */
  private priceToNearestBinId(dlmmPool: any, price: number): number {
    // Use DLMM's built-in method to convert price to bin ID
    const binStep = dlmmPool.lbPair.binStep;
    // Bin price formula: price = (1 + binStep / 10000) ^ binId
    // Solving for binId: binId = log(price) / log(1 + binStep / 10000)
    const stepSize = 1 + binStep / 10000;
    const binId = Math.round(Math.log(price) / Math.log(stepSize));
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

    // Convert bin IDs back to prices
    const binStep = dlmmPool.lbPair.binStep;
    const stepSize = 1 + binStep / 10000;
    const adjustedLower = Math.pow(stepSize, adjustedMinBinId);
    const adjustedUpper = Math.pow(stepSize, adjustedMaxBinId);

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

      // Sign and send
      tx.partialSign(wallet);
      const signature = await connection.sendRawTransaction(tx.serialize(), {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
      });

      const latestBlockhash = await connection.getLatestBlockhash();
      await connection.confirmTransaction({
        signature,
        ...latestBlockhash,
      });

      log.info('Deposit successful', { signature, params });
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

      const positionPubkey = new PublicKey(this.positionMints[0]);
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
      for (const tx of txs) {
        tx.partialSign(wallet);
        const signature = await connection.sendRawTransaction(tx.serialize(), {
          skipPreflight: false,
          preflightCommitment: 'confirmed',
        });

        const latestBlockhash = await connection.getLatestBlockhash();
        await connection.confirmTransaction({
          signature,
          ...latestBlockhash,
        });

        signatures.push(signature);
      }

      const finalSignature = signatures[signatures.length - 1];
      log.info('Withdrawal successful', {
        signatures,
        finalSignature,
        params,
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
   * Claim accumulated fees
   */
  async claimFees(): Promise<ClaimResult> {
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
      for (const tx of claimTxs) {
        tx.partialSign(wallet);
        const signature = await connection.sendRawTransaction(tx.serialize(), {
          skipPreflight: false,
          preflightCommitment: 'confirmed',
        });

        const latestBlockhash = await connection.getLatestBlockhash();
        await connection.confirmTransaction({
          signature,
          ...latestBlockhash,
        });

        signatures.push(signature);
      }

      const finalSignature = signatures[signatures.length - 1];

      log.info('Fees claimed successfully', {
        sol: totalClaimableSol,
        usdc: totalClaimableUsdc,
        signatures,
        finalSignature,
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
