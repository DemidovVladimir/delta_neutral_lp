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
 * Fetch multiple token prices from Jupiter API v6
 */
async function fetchTokenPricesFromJupiter(
  mints: string[],
  vsToken?: string
): Promise<Record<string, TokenPrice>> {
  try {
    const ids = mints.join(',');
    let url = `https://price.jup.ag/v6/price?ids=${ids}`;
    if (vsToken) {
      url += `&vsToken=${vsToken}`;
    }

    log.debug('Fetching token prices from Jupiter v6', { url, mints, vsToken });

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Jupiter API returned ${response.status}`);
    }

    const data = (await response.json()) as any;

    if (!data.data) {
      throw new Error('Invalid response from Jupiter API v6');
    }

    const result: Record<string, TokenPrice> = {};
    const timestamp = Date.now();

    for (const mint of mints) {
      const tokenData = data.data[mint];
      if (!tokenData) {
        log.warn(`Token ${mint} not found in Jupiter response`);
        continue;
      }

      result[mint] = {
        id: tokenData.id || mint,
        mintSymbol: tokenData.mintSymbol || 'UNKNOWN',
        vsToken: tokenData.vsToken,
        vsTokenSymbol: tokenData.vsTokenSymbol,
        price: tokenData.price,
        timestamp,
      };
    }

    log.debug('Fetched token prices from Jupiter v6', {
      tokens: Object.keys(result).length,
      prices: result
    });

    return result;
  } catch (error) {
    log.error('Failed to fetch token prices from Jupiter v6', {
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
 * Fetch SOL/USD price from Pyth via solana-agent-kit
 * Note: This is a placeholder implementation
 * The actual implementation depends on solana-agent-kit's Pyth integration
 */
async function fetchPriceFromPyth(): Promise<number> {
  try {
    // TODO: Implement Pyth price fetching via agent-kit
    // This will depend on agent-kit's API for Pyth integration
    // For now, we'll use a placeholder

    log.debug('Pyth integration not yet implemented, using Jupiter fallback');
    throw new Error('Pyth integration pending');
  } catch (error) {
    log.debug('Pyth price fetch failed', {
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
 * Uses cache if available and not stale
 * Falls back from Jupiter -> Pyth -> cached
 */
export async function getSolPrice(): Promise<Price> {
  const now = Date.now();

  // Return cached price if still fresh
  if (priceCache.price && now < priceCache.expiresAt) {
    log.debug('Using cached price', {
      price: priceCache.price.usd,
      age: now - priceCache.price.timestamp,
    });
    return priceCache.price;
  }

  // Try Jupiter first (primary source)
  try {
    const price = await fetchPriceWithRetry(fetchPriceFromJupiter, 'jupiter');

    // Update cache
    priceCache.price = price;
    priceCache.expiresAt = now + PRICE_ORACLE_CONFIG.staleThresholdMs;

    log.info('Fetched SOL price', {
      price: price.usd,
      source: price.source,
    });

    return price;
  } catch (jupiterError) {
    log.warn('Jupiter price fetch failed, trying Pyth', {
      error: jupiterError instanceof Error ? jupiterError.message : String(jupiterError),
    });

    // Try Pyth as fallback
    try {
      const price = await fetchPriceWithRetry(fetchPriceFromPyth, 'pyth');

      // Update cache
      priceCache.price = price;
      priceCache.expiresAt = now + PRICE_ORACLE_CONFIG.staleThresholdMs;

      log.info('Fetched SOL price from Pyth fallback', {
        price: price.usd,
        source: price.source,
      });

      return price;
    } catch (pythError) {
      log.error('All price sources failed', {
        jupiterError: jupiterError instanceof Error ? jupiterError.message : String(jupiterError),
        pythError: pythError instanceof Error ? pythError.message : String(pythError),
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
        jupiterError: jupiterError instanceof Error ? jupiterError.message : String(jupiterError),
        pythError: pythError instanceof Error ? pythError.message : String(pythError),
      });
    }
  }
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
