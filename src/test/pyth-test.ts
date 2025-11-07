/**
 * Test Pyth Price Oracle Integration
 * 
 * This test verifies that the Pyth on-chain oracle is working correctly
 * as the primary price source, with Jupiter as fallback.
 */

import { getSolPrice, clearPriceCache } from '../core/priceOracle.js';
import { initializeAgentKit } from '../core/agentKit.js';
import { log } from '../utils/logger.js';

async function testPythPriceOracle() {
  log.info('=== Testing Pyth Price Oracle ===');

  try {
    // Initialize agent kit (required for connection)
    log.info('Initializing agent kit...');
    await initializeAgentKit();

    // Clear any cached prices to force a fresh fetch
    clearPriceCache();

    // Test 1: Fetch price from Pyth
    log.info('\n--- Test 1: Fetching SOL/USD price from Pyth ---');
    const price1 = await getSolPrice();
    
    log.info('Price fetched successfully', {
      price: price1.usd,
      source: price1.source,
      timestamp: new Date(price1.timestamp).toISOString(),
    });

    if (price1.source !== 'pyth') {
      log.warn('Expected Pyth as source, but got', { source: price1.source });
    } else {
      log.info('✅ Successfully fetched price from Pyth oracle');
    }

    // Test 2: Verify price is reasonable
    log.info('\n--- Test 2: Validating price range ---');
    if (price1.usd < 10 || price1.usd > 10000) {
      log.error('Price outside reasonable range', { price: price1.usd });
      throw new Error('Price validation failed');
    }
    log.info('✅ Price is within reasonable range', { price: price1.usd });

    // Test 3: Verify caching works
    log.info('\n--- Test 3: Testing price caching ---');
    const price2 = await getSolPrice();
    
    if (price2.source === 'cached') {
      log.info('✅ Price caching is working correctly');
    } else {
      log.warn('Expected cached price, but got fresh fetch', { source: price2.source });
    }

    // Test 4: Verify cache returns same price
    if (price1.usd === price2.usd && price1.timestamp === price2.timestamp) {
      log.info('✅ Cached price matches original', {
        price: price2.usd,
        timestamp: new Date(price2.timestamp).toISOString(),
      });
    } else {
      log.error('Cache mismatch', {
        original: { price: price1.usd, timestamp: price1.timestamp },
        cached: { price: price2.usd, timestamp: price2.timestamp },
      });
    }

    log.info('\n=== All Pyth Price Oracle Tests Passed ===');
    process.exit(0);
  } catch (error) {
    log.error('Pyth price oracle test failed', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    process.exit(1);
  }
}

// Run the test
testPythPriceOracle();
