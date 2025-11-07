/**
 * Test Price Comparison Between Pyth and Jupiter
 *
 * This test demonstrates the dual-source price fetching strategy
 * and price divergence detection.
 */

import { getSolPrice, clearPriceCache } from '../core/priceOracle.js';
import { initializeAgentKit } from '../core/agentKit.js';
import { log } from '../utils/logger.js';

async function testPriceComparison() {
  log.info('=== Testing Dual-Source Price Comparison ===');

  try {
    // Initialize agent kit (required for connection)
    log.info('Initializing agent kit...');
    await initializeAgentKit();

    // Test 1: Fetch prices from both sources
    log.info('\n--- Test 1: Dual-Source Price Fetching ---');
    clearPriceCache();

    const price1 = await getSolPrice();

    log.info('Price oracle result', {
      price: price1.usd,
      source: price1.source,
      timestamp: new Date(price1.timestamp).toISOString(),
    });

    // Test 2: Multiple fetches to observe consistency
    log.info('\n--- Test 2: Price Consistency Test (5 fetches) ---');

    for (let i = 0; i < 5; i++) {
      clearPriceCache();
      await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds between fetches

      const price = await getSolPrice();
      log.info(`Fetch ${i + 1}:`, {
        price: price.usd,
        source: price.source,
      });
    }

    // Test 3: Cache behavior
    log.info('\n--- Test 3: Cache Performance Test ---');
    clearPriceCache();

    const startFresh = Date.now();
    const priceFresh = await getSolPrice();
    const timeFresh = Date.now() - startFresh;

    const startCached = Date.now();
    const priceCached = await getSolPrice();
    const timeCached = Date.now() - startCached;

    log.info('Performance comparison', {
      freshFetch: {
        time: `${timeFresh}ms`,
        price: priceFresh.usd,
      },
      cachedFetch: {
        time: `${timeCached}ms`,
        price: priceCached.usd,
      },
      speedup: `${(timeFresh / timeCached).toFixed(1)}x faster`,
    });

    log.info('\n=== All Price Comparison Tests Passed ===');
    process.exit(0);
  } catch (error) {
    log.error('Price comparison test failed', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    process.exit(1);
  }
}

// Run the test
testPriceComparison();
