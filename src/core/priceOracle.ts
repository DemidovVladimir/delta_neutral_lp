/**
 * Price Oracle
 *
 * Multi-source price fetching with caching, fallbacks, and validation.
 *
 * Features:
 * - **Dual-Source Fetching**: Queries both Pyth and Jupiter in parallel
 * - **Price Comparison**: Logs divergence when prices differ significantly (>0.5%)
 * - **Pyth Hermes API**: Primary price source with decentralized oracle data
 * - **Jupiter API v6**: Secondary source for validation and fallback
 * - **Direct SOL/USDC Rate**: Uses vsToken parameter for accurate exchange rates
 * - **Price Caching**: Configurable TTL to reduce API calls
 * - **Multi-source Validation**: Automatic price sanity checks and divergence detection
 *
 * Price Fetching Strategy:
 * - **Parallel Fetching**: Queries both Pyth and Jupiter simultaneously
 * - **Primary Source**: Pyth Hermes API (used when both succeed)
 * - **Fallback**: Jupiter Lite API v3 (used when Pyth fails)
 * - **Comparison**: Logs price divergence between sources
 * - **Validation**: Warns when difference exceeds 0.5%
 *
 * Price Sources:
 * 1. Pyth Hermes API (https://hermes.pyth.network)
 *    - Decentralized oracle network with off-chain price aggregation
 *    - High-frequency updates (sub-second) from 95+ data providers
 *    - REST API for easy integration without on-chain account parsing
 *    - SOL/USD feed ID: 0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d
 *    - Same feed ID used by Drift Protocol and other major DeFi protocols
 * 2. Jupiter Lite API v3 (https://lite-api.jup.ag/price/v3)
 *    - Multi-token price fetching in single request
 *    - Better DNS reliability than price.jup.ag endpoint
 *    - Direct SOL/USDC exchange rate via vsToken parameter
 *    - Serves as validation and fallback source
 *
 * Caching Strategy:
 * - Default TTL: 30 seconds (configurable via PRICE_ORACLE_CONFIG)
 * - Separate cache for SOL/USD and multi-token prices
 * - Cache invalidation on errors or stale data
 *
 * Technical Notes:
 * - Uses undici's fetch for reliable DNS resolution (Node v24's native fetch has DNS issues on macOS)
 * - Pyth Hermes provides off-chain aggregated prices from 95+ first-party data sources
 * - Hermes API is simpler than on-chain Pyth Lazer account parsing (which requires Drift IDL)
 *
 * @example
 * ```typescript
 * // Get SOL price in USD
 * const solPrice = await getSolPrice();
 * console.log('SOL/USD:', solPrice.usd);
 * console.log('Source:', solPrice.source); // 'pyth', 'jupiter', or 'cached'
 *
 * // Get multiple token prices with direct SOL/USDC rate
 * const prices = await getMultiTokenPrices();
 * console.log('SOL/USDC rate:', prices.solUsdcRate);
 * console.log('Source:', prices.source); // 'jupiter', 'pyth', or 'cached'
 * ```
 */

import { fetch } from 'undici';
import { log } from '../utils/logger.js';
import { Price, OracleError, TokenPrice, MultiTokenPriceResult } from '../types/index.js';
import { PRICE_ORACLE_CONFIG } from '../config/constants.js';

// Token mint addresses (Solana mainnet)
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

/**
 * Price cache to avoid excessive API calls
 */
interface PriceCache {
  price: Price | null;
  expiresAt: number;
}

const priceCache: PriceCache = {
  price: null,
  expiresAt: 0,
};

/**
 * Fetch multiple token prices from Jupiter Lite API v3
 * Uses lite-api.jup.ag which has better DNS reliability than price.jup.ag
 */
async function fetchTokenPricesFromJupiter(
  mints: string[],
  vsToken?: string
): Promise<Record<string, TokenPrice>> {
  try {
    const ids = mints.join(',');
    // Use lite-api v3 endpoint (more reliable DNS resolution)
    let url = `https://lite-api.jup.ag/price/v3?ids=${ids}`;
    if (vsToken) {
      url += `&vsToken=${vsToken}`;
    }

    log.debug('Fetching token prices from Jupiter Lite API v3', { url, mints, vsToken });

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Jupiter API returned ${response.status}`);
    }

    const data = (await response.json()) as any;

    // Lite API v3 has different response format - direct object with mint keys
    if (!data || typeof data !== 'object') {
      throw new Error('Invalid response from Jupiter Lite API v3');
    }

    const result: Record<string, TokenPrice> = {};
    const timestamp = Date.now();

    for (const mint of mints) {
      const tokenData = data[mint];
      if (!tokenData) {
        log.warn(`Token ${mint} not found in Jupiter response`);
        continue;
      }

      result[mint] = {
        id: mint,
        mintSymbol: mint === SOL_MINT ? 'SOL' : mint === USDC_MINT ? 'USDC' : 'UNKNOWN',
        vsToken: vsToken,
        vsTokenSymbol: vsToken === USDC_MINT ? 'USDC' : undefined,
        price: tokenData.usdPrice || tokenData.price,
        timestamp,
      };
    }

    log.debug('Fetched token prices from Jupiter Lite API v3', {
      tokens: Object.keys(result).length,
      prices: result
    });

    return result;
  } catch (error) {
    log.error('Failed to fetch token prices from Jupiter Lite API v3', {
      error: error instanceof Error ? error.message : String(error),
      mints,
      vsToken,
    });
    throw error;
  }
}

/**
 * Fetch SOL/USD price from Jupiter API (backward compatible)
 */
async function fetchPriceFromJupiter(): Promise<number> {
  try {
    const prices = await fetchTokenPricesFromJupiter([SOL_MINT]);

    const solPrice = prices[SOL_MINT];
    if (!solPrice || typeof solPrice.price !== 'number' || solPrice.price <= 0) {
      throw new Error(`Invalid SOL price from Jupiter: ${solPrice?.price}`);
    }

    log.debug('Fetched SOL price from Jupiter v6', { price: solPrice.price });
    return solPrice.price;
  } catch (error) {
    log.error('Failed to fetch SOL price from Jupiter', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Fetch SOL/USD price from Pyth Hermes API
 * Uses Pyth's off-chain price service for easier integration
 * Feed ID: 0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d
 */
async function fetchPriceFromPyth(): Promise<number> {
  try {
    const PYTH_HERMES_URL = 'https://hermes.pyth.network';
    const SOL_USD_FEED_ID = '0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d';

    const url = `${PYTH_HERMES_URL}/v2/updates/price/latest?ids[]=${SOL_USD_FEED_ID}`;

    log.debug('Fetching SOL/USD price from Pyth Hermes API', {
      url,
      feedId: SOL_USD_FEED_ID,
    });

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Pyth Hermes API returned ${response.status}`);
    }

    const data = (await response.json()) as any;

    if (!data.parsed || !Array.isArray(data.parsed) || data.parsed.length === 0) {
      throw new Error('Invalid response from Pyth Hermes API');
    }

    const priceData = data.parsed[0].price;

    if (!priceData || typeof priceData.price !== 'string' || typeof priceData.expo !== 'number') {
      throw new Error('Invalid price data structure from Pyth');
    }

    // Convert price: price * 10^expo
    const priceValue = parseFloat(priceData.price);
    const expo = priceData.expo;
    const price = priceValue * Math.pow(10, expo);

    log.debug('Fetched SOL/USD price from Pyth Hermes', {
      price,
      conf: priceData.conf,
      expo,
      publishTime: priceData.publish_time,
    });

    if (price <= 0) {
      throw new Error(`Invalid SOL price from Pyth: ${price}`);
    }

    return price;
  } catch (error) {
    log.error('Failed to fetch SOL price from Pyth Hermes', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Fetch SOL/USD price with retry logic
 */
async function fetchPriceWithRetry(
  fetcher: () => Promise<number>,
  source: 'jupiter' | 'pyth',
  retries = PRICE_ORACLE_CONFIG.maxRetries
): Promise<Price> {
  let lastError: Error | null = null;

  for (let i = 0; i < retries; i++) {
    try {
      const price = await fetcher();
      return {
        usd: price,
        timestamp: Date.now(),
        source,
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (i < retries - 1) {
        const delay = PRICE_ORACLE_CONFIG.retryDelayMs * Math.pow(2, i);
        log.debug(`Price fetch attempt ${i + 1} failed, retrying in ${delay}ms`, {
          source,
          error: lastError.message,
        });
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw new OracleError(`Failed to fetch price from ${source} after ${retries} attempts`, {
    source,
    error: lastError?.message,
  });
}

/**
 * Get current SOL/USD price
 * Fetches from both Pyth and Jupiter, compares them, and uses the primary source
 * Logs price divergence if difference exceeds threshold
 */
export async function getSolPrice(): Promise<Price> {
  const now = Date.now();

  // Return cached price if still fresh
  if (priceCache.price && now < priceCache.expiresAt) {
    log.debug('Using cached price', {
      price: priceCache.price.usd,
      age: now - priceCache.price.timestamp,
      source: priceCache.price.source,
    });
    return priceCache.price;
  }

  // Fetch from both sources in parallel for comparison
  const results = await Promise.allSettled([
    fetchPriceWithRetry(fetchPriceFromPyth, 'pyth'),
    fetchPriceWithRetry(fetchPriceFromJupiter, 'jupiter'),
  ]);

  const pythResult = results[0];
  const jupiterResult = results[1];

  // Extract successful prices
  const pythPrice = pythResult.status === 'fulfilled' ? pythResult.value : null;
  const jupiterPrice = jupiterResult.status === 'fulfilled' ? jupiterResult.value : null;

  // If both succeeded, compare prices and log divergence
  if (pythPrice && jupiterPrice) {
    const priceDiff = Math.abs(pythPrice.usd - jupiterPrice.usd);
    const priceDiffPct = (priceDiff / pythPrice.usd) * 100;

    log.info('Fetched prices from both sources', {
      pyth: pythPrice.usd,
      jupiter: jupiterPrice.usd,
      diffUsd: priceDiff.toFixed(4),
      diffPct: priceDiffPct.toFixed(4),
    });

    // Warn if price divergence exceeds 0.5%
    if (priceDiffPct > 0.5) {
      log.warn('Price divergence detected between oracles', {
        pyth: pythPrice.usd,
        jupiter: jupiterPrice.usd,
        diffPct: priceDiffPct.toFixed(4),
        threshold: '0.5%',
      });
    }

    // Use Pyth as primary source
    priceCache.price = pythPrice;
    priceCache.expiresAt = now + PRICE_ORACLE_CONFIG.staleThresholdMs;

    return pythPrice;
  }

  // If only Pyth succeeded
  if (pythPrice) {
    log.warn('Jupiter price fetch failed, using Pyth only', {
      price: pythPrice.usd,
      jupiterError:
        jupiterResult.status === 'rejected' ? jupiterResult.reason.message : 'Unknown error',
    });

    priceCache.price = pythPrice;
    priceCache.expiresAt = now + PRICE_ORACLE_CONFIG.staleThresholdMs;

    return pythPrice;
  }

  // If only Jupiter succeeded
  if (jupiterPrice) {
    log.warn('Pyth price fetch failed, using Jupiter only', {
      price: jupiterPrice.usd,
      pythError:
        pythResult.status === 'rejected' ? pythResult.reason.message : 'Unknown error',
    });

    priceCache.price = jupiterPrice;
    priceCache.expiresAt = now + PRICE_ORACLE_CONFIG.staleThresholdMs;

    return jupiterPrice;
  }

  // Both failed - try to use stale cache or fallback
  log.error('All price sources failed', {
    pythError:
      pythResult.status === 'rejected' ? pythResult.reason.message : 'Unknown error',
    jupiterError:
      jupiterResult.status === 'rejected' ? jupiterResult.reason.message : 'Unknown error',
  });

  // Last resort: use stale cached price if available
  if (priceCache.price) {
    const age = now - priceCache.price.timestamp;
    log.warn('Using stale cached price', {
      price: priceCache.price.usd,
      age,
      staleness: age - PRICE_ORACLE_CONFIG.staleThresholdMs,
    });

    return {
      ...priceCache.price,
      source: 'cached',
    };
  }

  // For local testing, use a fallback price if configured
  const fallbackPrice = process.env.FALLBACK_SOL_PRICE;
  if (fallbackPrice) {
    const price = parseFloat(fallbackPrice);
    if (!isNaN(price) && price > 0) {
      log.warn('Using fallback SOL price for local testing', { price });
      const fallbackPriceData: Price = {
        usd: price,
        source: 'fallback',
        timestamp: Date.now(),
      };

      // Cache the fallback price (5 minute TTL)
      priceCache.price = fallbackPriceData;
      priceCache.expiresAt = Date.now() + 300000; // 5 minutes

      return fallbackPriceData;
    }
  }

  throw new OracleError('All price sources failed and no cached price available', {
    pythError:
      pythResult.status === 'rejected' ? pythResult.reason.message : 'Unknown error',
    jupiterError:
      jupiterResult.status === 'rejected' ? jupiterResult.reason.message : 'Unknown error',
  });
}

/**
 * Check if cached price is stale
 */
export function isCachedPriceStale(): boolean {
  if (!priceCache.price) return true;
  const age = Date.now() - priceCache.price.timestamp;
  return age > PRICE_ORACLE_CONFIG.staleThresholdMs;
}

/**
 * Get cached price without fetching
 */
export function getCachedPrice(): Price | null {
  return priceCache.price;
}

/**
 * Clear price cache (useful for testing)
 */
export function clearPriceCache(): void {
  priceCache.price = null;
  priceCache.expiresAt = 0;
}

/**
 * Manually set price (useful for testing/dry-run)
 */
export function setPrice(price: number, source: 'jupiter' | 'pyth' | 'cached' = 'cached'): void {
  priceCache.price = {
    usd: price,
    timestamp: Date.now(),
    source,
  };
  priceCache.expiresAt = Date.now() + PRICE_ORACLE_CONFIG.staleThresholdMs;

  log.info('Price manually set', {
    price,
    source,
  });
}

/**
 * Get multiple token prices including SOL/USDC exchange rate
 * Uses Jupiter v6 API for efficient multi-token fetching
 */
export async function getMultiTokenPrices(): Promise<MultiTokenPriceResult> {
  try {
    // Fetch SOL and USDC prices in a single call, with SOL priced vs USDC
    const prices = await fetchTokenPricesFromJupiter(
      [SOL_MINT, USDC_MINT],
      USDC_MINT // Price SOL vs USDC
    );

    const solPrice = prices[SOL_MINT];
    const usdcPrice = prices[USDC_MINT];

    if (!solPrice) {
      throw new Error('Failed to fetch SOL price from Jupiter v6');
    }

    const result: MultiTokenPriceResult = {
      sol: solPrice,
      usdc: usdcPrice,
      solUsdcRate: solPrice.price, // When vsToken=USDC, this is SOL/USDC rate
      timestamp: Date.now(),
      source: 'jupiter',
    };

    log.info('Fetched multi-token prices', {
      solUsd: solPrice.price,
      solUsdcRate: result.solUsdcRate,
      usdcPrice: usdcPrice?.price,
    });

    return result;
  } catch (error) {
    log.error('Failed to fetch multi-token prices', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw new OracleError('Failed to fetch multi-token prices', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
