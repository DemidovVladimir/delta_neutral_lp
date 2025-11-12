/**
 * Meteora DLMM Utilities
 *
 * Helper functions for working with Meteora DLMM (Dynamic Liquidity Market Maker) pools.
 *
 * Key Functions:
 * - **getPriceFromBinId**: Convert bin ID to price using DLMM formula
 * - **getActiveBin**: Fetch current active bin and price from pool
 * - **calculateTokenPercentages**: Calculate token X/Y composition in price range
 * - **getMeteoraPairInfo**: Fetch pool analytics from Meteora API
 *
 * DLMM Bin Mechanics:
 * - Bins are discrete price ranges in a DLMM pool
 * - Each bin has a unique ID and corresponding price level
 * - Price formula: `price = (1 + binStep/10000)^binId * 10^(decimalsX - decimalsY)`
 * - Bin step determines price granularity (e.g., binStep=4 means 0.04% price steps)
 *
 * Position Composition:
 * - When price is below range: 100% token X (SOL), 0% token Y (USDC)
 * - When price is in range: Mix of both tokens
 * - When price is above range: 0% token X, 100% token Y
 *
 * Meteora API:
 * - Provides real-time pool analytics (APR, APY, volume, fees, TVL)
 * - Endpoint: https://dlmm-api.meteora.ag/pair/{poolAddress}
 * - Returns comprehensive pool metadata including reserves, bin data, and fee stats
 *
 * @example
 * ```typescript
 * // Get price from bin ID
 * const price = getPriceFromBinId(12345, 4, 9, 6); // SOL (9 decimals), USDC (6 decimals)
 * console.log('Price:', price.toNumber());
 *
 * // Get active bin from pool
 * const activeBin = await getActiveBin(dlmmPool);
 * console.log('Active bin ID:', activeBin.binId);
 * console.log('Current price:', activeBin.pricePerToken);
 *
 * // Calculate token composition
 * const composition = calculateTokenPercentages(120, 100, 150);
 * console.log('SOL:', composition.tokenX + '%', 'USDC:', composition.tokenY + '%');
 *
 * // Fetch pool analytics
 * const poolInfo = await getMeteoraPairInfo('5rCf1DM8LjKTw4YqhnoLcngyZYeNnQqztScTogYHAS6');
 * console.log('Pool APR:', poolInfo.apr, 'Volume 24h:', poolInfo.trade_volume_24h);
 * ```
 */

import Decimal from 'decimal.js';
import { log } from './logger.js';
import { MeteoraPairInfo } from '../types/index.js';

const BASIS_POINT_MAX = 10000;

/**
 * Calculate price from bin ID using DLMM formula
 * Formula: price = (1 + binStep/10000)^binId * 10^(tokenXDecimal - tokenYDecimal)
 */
export function getPriceFromBinId(
  binId: number,
  binStep: number,
  tokenXDecimal: number,
  tokenYDecimal: number
): Decimal {
  const binStepNum = new Decimal(binStep).div(new Decimal(BASIS_POINT_MAX));
  const base = new Decimal(1).plus(binStepNum);
  return base.pow(binId).mul(Math.pow(10, tokenXDecimal - tokenYDecimal));
}

/**
 * Get active bin information from a DLMM pool
 * Returns active bin data including price conversions
 */
export async function getActiveBin(dlmmPool: any): Promise<{
  binId: number;
  price: string;
  pricePerToken: number;
}> {
  const activeBin = await dlmmPool.getActiveBin();

  const activeBinPriceLamport = activeBin.price;
  const activeBinPricePerToken = dlmmPool.fromPricePerLamport(
    Number(activeBin.price)
  );

  log.debug('Active bin fetched', {
    binId: activeBin.binId,
    priceLamport: activeBinPriceLamport,
    pricePerToken: activeBinPricePerToken,
  });

  return {
    binId: activeBin.binId,
    price: activeBinPriceLamport,
    pricePerToken: Number(activeBinPricePerToken),
  };
}

/**
 * Calculate token composition percentages within a position range
 *
 * Returns what percentage of the position is in tokenX vs tokenY
 * based on where the current price sits within the position range
 *
 * @param currentPrice - Current price
 * @param startBinPrice - Lower bound of position range
 * @param endBinPrice - Upper bound of position range
 * @returns Percentage of tokenX and tokenY
 */
export function calculateTokenPercentages(
  currentPrice: number,
  startBinPrice: number,
  endBinPrice: number
): { tokenX: number; tokenY: number } {
  if (currentPrice >= startBinPrice && currentPrice <= endBinPrice) {
    // Price is within range - calculate position
    const rangeSize = endBinPrice - startBinPrice;
    const positionInRange = currentPrice - startBinPrice;

    // Percentage of each token
    const percentageTokenX = (1 - positionInRange / rangeSize) * 100;
    const percentageTokenY = (positionInRange / rangeSize) * 100;

    return {
      tokenX: Number(percentageTokenX.toFixed(2)),
      tokenY: Number(percentageTokenY.toFixed(2)),
    };
  } else if (currentPrice < startBinPrice) {
    // Price below range - everything is in tokenX (SOL)
    return {
      tokenX: 100,
      tokenY: 0,
    };
  } else {
    // Price above range - everything is in tokenY (USDC)
    return {
      tokenX: 0,
      tokenY: 100,
    };
  }
}

/**
 * Fetch pool data from Meteora DLMM API
 *
 * Provides rich analytics including:
 * - 24h volume and fees
 * - APR/APY metrics
 * - Reserve amounts
 * - Current price
 */
export async function getMeteoraPairInfo(poolKey: string): Promise<MeteoraPairInfo> {
  try {
    const url = `https://dlmm-api.meteora.ag/pair/${poolKey}`;
    log.debug('Fetching Meteora pair info', { poolKey, url });

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Meteora API returned ${response.status}`);
    }

    const data = await response.json() as any;

    const pairInfo: MeteoraPairInfo = {
      address: data.address,
      name: data.name,
      mintX: data.mint_x,
      mintY: data.mint_y,
      reserveX: data.reserve_x,
      reserveY: data.reserve_y,
      reserveXAmount: data.reserve_x_amount,
      reserveYAmount: data.reserve_y_amount,
      binStep: data.bin_step,
      baseFeePercentage: data.base_fee_percentage,
      maxFeePercentage: data.max_fee_percentage,
      protocolFeePercentage: data.protocol_fee_percentage,
      liquidity: data.liquidity,
      fees24h: data.fees_24h || 0,
      todayFees: data.today_fees || 0,
      tradeVolume24h: data.trade_volume_24h || 0,
      cumulativeTradeVolume: data.cumulative_trade_volume || '0',
      cumulativeFeeVolume: data.cumulative_fee_volume || '0',
      currentPrice: data.current_price,
      apr: data.apr || 0,
      apy: data.apy || 0,
      farmApr: data.farm_apr || 0,
      farmApy: data.farm_apy || 0,
      hide: data.hide || false,
    };

    log.info('Fetched Meteora pair info', {
      pool: poolKey,
      name: pairInfo.name,
      volume24h: pairInfo.tradeVolume24h,
      fees24h: pairInfo.fees24h,
      apr: pairInfo.apr,
      apy: pairInfo.apy,
    });

    return pairInfo;
  } catch (error) {
    log.error('Failed to fetch Meteora pair info', {
      error: error instanceof Error ? error.message : String(error),
      poolKey,
    });
    throw error;
  }
}

/**
 * Format number for display (K/M suffixes)
 */
export function formatNumber(num: number): string {
  if (typeof num !== 'number' || isNaN(num)) {
    log.warn('Invalid number passed to formatNumber', { num });
    return '$0.0';
  }

  if (num >= 1_000_000) {
    return `$${(num / 1_000_000).toFixed(1)}M`;
  } else if (num >= 1_000) {
    return `$${(num / 1_000).toFixed(1)}K`;
  } else {
    return `$${num.toFixed(1)}`;
  }
}

/**
 * Check if a position is imbalanced based on token composition
 *
 * A position is imbalanced when one token comprises more than the threshold percentage
 * (e.g., 80% SOL or 80% USDC indicates price has moved significantly)
 *
 * @param currentPrice - Current price
 * @param lowerBinPrice - Position lower bound price
 * @param upperBinPrice - Position upper bound price
 * @param imbalanceThreshold - Threshold as decimal (e.g., 0.8 for 80%)
 * @returns Object with imbalance status and composition details
 */
export function checkPositionImbalance(
  currentPrice: number,
  lowerBinPrice: number,
  upperBinPrice: number,
  imbalanceThreshold: number
): {
  isImbalanced: boolean;
  solPercent: number;
  usdcPercent: number;
  reason?: string;
} {
  const composition = calculateTokenPercentages(currentPrice, lowerBinPrice, upperBinPrice);

  const thresholdPercent = imbalanceThreshold * 100;

  const isImbalanced =
    composition.tokenX >= thresholdPercent ||
    composition.tokenY >= thresholdPercent;

  let reason: string | undefined;
  if (isImbalanced) {
    if (composition.tokenX >= thresholdPercent) {
      reason = `SOL concentration ${composition.tokenX}% exceeds ${thresholdPercent}% threshold`;
    } else {
      reason = `USDC concentration ${composition.tokenY}% exceeds ${thresholdPercent}% threshold`;
    }
  }

  return {
    isImbalanced,
    solPercent: composition.tokenX,
    usdcPercent: composition.tokenY,
    reason,
  };
}

/**
 * Calculate price range for a centered position with fixed bin count
 *
 * Creates a symmetric range around the current price using the pool's bin step
 * and a fixed number of bins (e.g., 20 bins = 10 below + 10 above current price)
 *
 * @param currentPrice - Current market price
 * @param currentBinId - Current active bin ID
 * @param binStep - Pool's bin step (price granularity)
 * @param binCount - Total number of bins for the position
 * @param tokenXDecimal - Token X decimals (e.g., SOL = 9)
 * @param tokenYDecimal - Token Y decimals (e.g., USDC = 6)
 * @returns Price range bounds and bin IDs
 */
export function calculateCenteredPriceRange(
  currentPrice: number,
  currentBinId: number,
  binStep: number,
  binCount: number,
  tokenXDecimal: number,
  tokenYDecimal: number
): {
  lowerPrice: number;
  upperPrice: number;
  minBinId: number;
  maxBinId: number;
} {
  // Calculate bin offsets (symmetric around current bin)
  // Bin width is inclusive: maxBinId - minBinId + 1 = binCount
  // So for binCount = 20, we want maxBinId - minBinId = 19
  const halfBins = Math.floor(binCount / 2);
  const minBinId = currentBinId - halfBins;
  const maxBinId = minBinId + binCount - 1; // Ensures exactly binCount bins

  // Calculate prices from bin IDs
  const lowerPrice = getPriceFromBinId(minBinId, binStep, tokenXDecimal, tokenYDecimal).toNumber();
  const upperPrice = getPriceFromBinId(maxBinId, binStep, tokenXDecimal, tokenYDecimal).toNumber();

  log.debug('Calculated centered price range', {
    currentPrice,
    currentBinId,
    binCount,
    halfBins,
    minBinId,
    maxBinId,
    lowerPrice,
    upperPrice,
    rangeWidth: upperPrice - lowerPrice,
  });

  return {
    lowerPrice,
    upperPrice,
    minBinId,
    maxBinId,
  };
}
