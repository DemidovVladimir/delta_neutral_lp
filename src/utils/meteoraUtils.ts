/**
 * Meteora DLMM Utilities
 *
 * Helper functions for working with Meteora DLMM (Dynamic Liquidity Market Maker) pools.
 *
 * Key Functions:
 * - **getPriceFromBinId**: Convert bin ID to price using DLMM formula
 * - **getActiveBin**: Fetch current active bin and price from pool
 * - **calculateTokenPercentages**: Calculate token X/Y composition in price range
 * - **getMeteoraPairInfo**: Derive pool analytics on-chain (DLMM SDK) + indexer volume
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
 * Pool analytics source (BUG-004):
 * - The old off-chain host `dlmm-api.meteora.ag` is dead (404 everywhere).
 * - `getMeteoraPairInfo` now derives TVL, price, bin step, and fee rates ON-CHAIN
 *   via the DLMM SDK; 24h volume/fees/APR (historical, not on-chain) come
 *   best-effort from a live indexer (GeckoTerminal) and degrade to 0 if down.
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
import { PublicKey } from '@solana/web3.js';
import { log } from './logger.js';
import { getConnection } from './solana.js';
import { DLMM } from './dlmm.js';
import { MeteoraPairInfo } from '../types/index.js';

const BASIS_POINT_MAX = 10000;

/** Known mint → symbol (for pool naming). Unknown mints render as the full mint (never abbreviated). */
const KNOWN_SYMBOLS: Record<string, string> = {
  So11111111111111111111111111111111111111112: 'SOL',
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: 'USDC',
};
const symbolOf = (mint: string): string => KNOWN_SYMBOLS[mint] ?? mint;

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
 * Best-effort 24h volume + TVL from GeckoTerminal. These two metrics are
 * historical (not derivable on-chain without an indexer), so we read them from
 * a live public indexer. Returns null on any failure — callers degrade to
 * on-chain TVL with volume/APR = 0 rather than throwing.
 */
async function fetchPoolVolumeUsd(
  poolKey: string
): Promise<{ tvlUsd: number; volume24hUsd: number; name?: string } | null> {
  try {
    const url = `https://api.geckoterminal.com/api/v2/networks/solana/pools/${poolKey}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'delta-neutral-bot', Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const j = (await res.json()) as any;
    const a = j?.data?.attributes;
    if (!a) return null;
    return {
      tvlUsd: Number(a.reserve_in_usd) || 0,
      volume24hUsd: Number(a.volume_usd?.h24) || 0,
      name: typeof a.name === 'string' ? a.name : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Pool analytics for a Meteora DLMM pair.
 *
 * Derived primarily ON-CHAIN via the DLMM SDK (the old off-chain
 * `dlmm-api.meteora.ag` host is dead — see BUG-004): bin step, base/max/protocol
 * fee rates, active-bin price, reserves, and TVL (priced at the pool's own
 * active price — no external oracle). The genuinely historical metrics — 24h
 * volume, fees, APR/APY — are not on-chain, so they come best-effort from a live
 * indexer (GeckoTerminal); if it's unavailable they degrade to 0 and the
 * on-chain fields still return.
 */
export async function getMeteoraPairInfo(poolKey: string): Promise<MeteoraPairInfo> {
  try {
    const connection = getConnection();
    const dlmm = await DLMM.create(connection, new PublicKey(poolKey));
    const lb = dlmm.lbPair;

    const binStep = Number(lb.binStep);
    const mintX = lb.tokenXMint.toBase58();
    const mintY = lb.tokenYMint.toBase58();
    const decX = dlmm.tokenX.mint.decimals;
    const decY = dlmm.tokenY.mint.decimals;
    const reserveXAmount = Number(dlmm.tokenX.amount.toString()) / Math.pow(10, decX);
    const reserveYAmount = Number(dlmm.tokenY.amount.toString()) / Math.pow(10, decY);

    // Fee rates from the live pool (percent, e.g. 0.04 / 10).
    const fi = dlmm.getFeeInfo();
    const baseFeePct = Number(fi.baseFeeRatePercentage?.toString?.() ?? fi.baseFeeRatePercentage ?? 0);
    const maxFeePct = Number(fi.maxFeeRatePercentage?.toString?.() ?? fi.maxFeeRatePercentage ?? 0);
    const protocolFeePct = Number(fi.protocolFeePercentage?.toString?.() ?? fi.protocolFeePercentage ?? 0);

    // Active-bin price = tokenY per tokenX (USDC per SOL). Also the SOL price we
    // use to value the SOL reserve — keeps TVL fully self-contained on-chain.
    const active = await getActiveBin(dlmm);
    const currentPrice = active.pricePerToken;
    const onChainTvlUsd = reserveYAmount + reserveXAmount * currentPrice;

    // Historical metrics (best-effort, off-chain indexer).
    const gt = await fetchPoolVolumeUsd(poolKey);
    const liquidity = gt && gt.tvlUsd > 0 ? gt.tvlUsd : onChainTvlUsd;
    const tradeVolume24h = gt?.volume24hUsd ?? 0;
    const fees24h = tradeVolume24h * (baseFeePct / 100);
    const apr = liquidity > 0 ? (fees24h / liquidity) * 365 * 100 : 0;
    const apy = liquidity > 0 ? (Math.pow(1 + fees24h / liquidity, 365) - 1) * 100 : 0;

    const pairInfo: MeteoraPairInfo = {
      address: poolKey,
      name: gt?.name ?? `${symbolOf(mintX)}-${symbolOf(mintY)}`,
      mintX,
      mintY,
      reserveX: dlmm.tokenX.reserve.toBase58(),
      reserveY: dlmm.tokenY.reserve.toBase58(),
      reserveXAmount,
      reserveYAmount,
      binStep,
      baseFeePercentage: String(baseFeePct),
      maxFeePercentage: String(maxFeePct),
      protocolFeePercentage: String(protocolFeePct),
      liquidity: String(liquidity),
      fees24h,
      todayFees: fees24h,
      tradeVolume24h,
      cumulativeTradeVolume: '0',
      cumulativeFeeVolume: '0',
      currentPrice,
      apr,
      apy,
      farmApr: 0,
      farmApy: 0,
      hide: false,
    };

    log.info('Derived Meteora pair info (on-chain SDK + indexer volume)', {
      pool: poolKey,
      name: pairInfo.name,
      currentPrice,
      tvlUsd: Number(liquidity.toFixed(0)),
      volume24h: Number(tradeVolume24h.toFixed(0)),
      baseFeePct,
      apr: Number(apr.toFixed(1)),
      volumeSource: gt ? 'geckoterminal' : 'unavailable(0)',
    });

    return pairInfo;
  } catch (error) {
    log.error('Failed to derive Meteora pair info', {
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
 * Check whether the wallet's USD-weighted SOL/USDC composition is close enough
 * to 50/50 to skip the alignment swap during a rebalance.
 *
 * The alignment swap is normally MANDATORY on every rebalance: when the
 * imbalance trigger fires (e.g. at 92%), the pool composition has already
 * shifted heavily to one side. After Phase 1 the wallet inherits that
 * lopsided mix. Re-depositing without a swap means the new position starts
 * already off-centre, taking on inverse exposure that compounds impermanent
 * loss if the trend continues. So the swap-to-50/50 is the only thing that
 * locks in the current price and resets the IL exposure clock.
 *
 * The ONE legitimate case to skip the swap is if the wallet is somehow
 * already balanced post-Phase-1 — surprising given the trigger threshold,
 * usually a sign of stale snapshot data, manual external rebalance, or
 * threshold misconfiguration. This helper is the gate that detects that
 * case so we can log it loudly rather than silently churn fees.
 *
 * Reserve handling: the permanent-minimum SOL floor and rent reserve are
 * subtracted from `walletSol` BEFORE computing the ratio. Reserves aren't
 * available for the position, so they shouldn't count toward composition.
 *
 * @param walletSol      Current wallet SOL balance (human-readable)
 * @param walletUsdc     Current wallet USDC balance (human-readable)
 * @param currentPrice   SOL/USD price for USD-weighting
 * @param totalReserveSol Permanent-min + rent reserve (subtracted from walletSol)
 * @param toleranceFraction How far either side of 0.5 still counts as balanced. Default 0.10 == 50/50 ±10%.
 */
export function isWalletBalancedFor5050(
  walletSol: number,
  walletUsdc: number,
  currentPrice: number,
  totalReserveSol: number,
  toleranceFraction: number = 0.10,
): {
  balanced: boolean;
  walletSolRatio: number;
  walletTotalUsd: number;
} {
  const availableSol = Math.max(0, walletSol - totalReserveSol);
  const solUsd = availableSol * currentPrice;
  const usdcUsd = walletUsdc;
  const totalUsd = solUsd + usdcUsd;

  // Empty / zero-value wallet: report as balanced (ratio 0.5) so the gate
  // doesn't trigger an unnecessary swap that has nothing to swap with —
  // the planner's pre-flight will throw a clear error downstream.
  if (totalUsd <= 0) {
    return { balanced: true, walletSolRatio: 0.5, walletTotalUsd: 0 };
  }

  const walletSolRatio = solUsd / totalUsd;
  // Use Math.abs(ratio - 0.5) form with a tiny FP epsilon. Comparing
  // (0.9 - 0.3) * 100 = 60.00000000000001 against 0.5 + 0.1 = 0.6 directly
  // can produce off-by-an-ulp surprises at the exact boundary; the
  // operator's intent is "within ±tolerance", so we honour it numerically.
  const FP_EPSILON = 1e-9;
  const balanced =
    Math.abs(walletSolRatio - 0.5) <= toleranceFraction + FP_EPSILON;

  return { balanced, walletSolRatio, walletTotalUsd: totalUsd };
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
