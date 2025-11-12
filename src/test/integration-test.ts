/**
 * Integration Test for New Utilities
 *
 * Tests the improvements from meteora-lp-army-bot integration:
 * - Jupiter Lite API v3 multi-token price fetching (updated from v6)
 * - Meteora DLMM API pool analytics
 * - Position composition calculations
 * - Meteora price utilities
 * - Jito dynamic tips (enhanced with real-time pricing)
 *
 * Usage:
 *   NODE_ENV=mainnet npx tsx src/test/integration-test.ts
 *   # Or for localnet:
 *   NODE_ENV=localnet npx tsx src/test/integration-test.ts
 */

import { config } from 'dotenv';
import { PublicKey } from '@solana/web3.js';
import { getSolPrice, getMultiTokenPrices } from '../core/priceOracle.js';
import {
  getMeteoraPairInfo,
  calculateTokenPercentages,
  getPriceFromBinId,
  formatNumber,
} from '../utils/meteoraUtils.js';
import { createEnhancedJitoTipInstruction, calculateRecommendedTip } from '../utils/jitoUtils.js';
import { initializeAgentKit, getWalletKeypair } from '../core/agentKit.js';
import { getConfig } from '../config/env.js';

// Load environment based on NODE_ENV
const env = process.env.NODE_ENV || 'localnet';
config({ path: `.env.${env}` });

async function initializeTest() {
  console.log('Initializing agent kit and loading config...');

  try {
    await initializeAgentKit();
    const cfg = getConfig();
    const wallet = getWalletKeypair();

    console.log(`Environment: ${env}`);
    console.log(`Wallet: ${wallet.publicKey.toBase58()}`);
    console.log(`Pool: ${cfg.meteoraPoolAddress || 'Not configured'}\n`);

    return { cfg, wallet, initialized: true };
  } catch (error) {
    console.warn(`⚠️  Could not initialize agent kit: ${error instanceof Error ? error.message : String(error)}`);
    console.warn('Some tests requiring RPC connection may fail.\n');

    const cfg = getConfig();
    // Create a dummy wallet for tests that don't need RPC
    const dummyWallet = {
      publicKey: new PublicKey('11111111111111111111111111111111')
    };

    return { cfg, wallet: dummyWallet as any, initialized: false };
  }
}

async function testJupiterV6() {
  console.log('\n🧪 Testing Jupiter Lite API v3...\n');

  try {
    // Test single token price (backward compatible)
    console.log('1. Testing single token price (SOL)...');
    const solPrice = await getSolPrice();
    console.log(`✅ SOL Price: $${solPrice.usd.toFixed(2)}`);
    console.log(`   Source: ${solPrice.source}`);
    console.log(`   Timestamp: ${new Date(solPrice.timestamp).toISOString()}`);

    // Test multi-token prices
    console.log('\n2. Testing multi-token prices (SOL + USDC)...');
    const multiPrices = await getMultiTokenPrices();
    console.log(`✅ SOL Price: $${multiPrices.sol.price.toFixed(2)} (${multiPrices.sol.mintSymbol})`);
    console.log(`   USDC Price: $${multiPrices.usdc?.price.toFixed(4)} (${multiPrices.usdc?.mintSymbol})`);
    console.log(`   SOL/USDC Rate: ${multiPrices.solUsdcRate?.toFixed(2)}`);
    console.log(`   Source: ${multiPrices.source}`);

    return true;
  } catch (error) {
    console.error('❌ Jupiter Lite API v3 test failed:', error);
    return false;
  }
}

async function testMeteoraDLMMAPI(poolAddress: string) {
  console.log('\n🧪 Testing Meteora DLMM API...\n');

  try {
    console.log(`Fetching pool info for: ${poolAddress}...`);
    const poolInfo = await getMeteoraPairInfo(poolAddress);

    console.log(`\n✅ Pool Info Retrieved:`);
    console.log(`   Name: ${poolInfo.name}`);
    console.log(`   Current Price: $${poolInfo.currentPrice.toFixed(2)}`);
    console.log(`   24h Volume: ${formatNumber(poolInfo.tradeVolume24h)}`);
    console.log(`   24h Fees: ${formatNumber(poolInfo.fees24h)}`);
    console.log(`   APR: ${poolInfo.apr.toFixed(2)}%`);
    console.log(`   APY: ${poolInfo.apy.toFixed(2)}%`);
    console.log(`   Bin Step: ${poolInfo.binStep}`);
    console.log(`   Liquidity: ${formatNumber(parseFloat(poolInfo.liquidity))}`);

    return true;
  } catch (error) {
    console.error('❌ Meteora DLMM API test failed:', error);
    return false;
  }
}

async function testMeteoraUtilities() {
  console.log('\n🧪 Testing Meteora Utilities...\n');

  try {
    // Test getPriceFromBinId
    console.log('1. Testing getPriceFromBinId...');
    const binId = 0; // Active bin ID (example)
    const binStep = 4; // Typical bin step for SOL/USDC
    const price = getPriceFromBinId(binId, binStep, 9, 6); // SOL (9 decimals) / USDC (6 decimals)
    console.log(`✅ Bin ${binId} (step ${binStep}): Price = ${price.toFixed(6)}`);

    // Test calculateTokenPercentages
    console.log('\n2. Testing calculateTokenPercentages...');

    // Test case 1: Price in middle of range
    const currentPrice = 150;
    const lowerPrice = 100;
    const upperPrice = 200;
    const composition1 = calculateTokenPercentages(currentPrice, lowerPrice, upperPrice);
    console.log(`✅ Price $${currentPrice} in range [$${lowerPrice}-$${upperPrice}]:`);
    console.log(`   SOL: ${composition1.tokenX}%, USDC: ${composition1.tokenY}%`);

    // Test case 2: Price below range (all SOL)
    const composition2 = calculateTokenPercentages(90, lowerPrice, upperPrice);
    console.log(`✅ Price $90 below range [$${lowerPrice}-$${upperPrice}]:`);
    console.log(`   SOL: ${composition2.tokenX}%, USDC: ${composition2.tokenY}%`);

    // Test case 3: Price above range (all USDC)
    const composition3 = calculateTokenPercentages(250, lowerPrice, upperPrice);
    console.log(`✅ Price $250 above range [$${lowerPrice}-$${upperPrice}]:`);
    console.log(`   SOL: ${composition3.tokenX}%, USDC: ${composition3.tokenY}%`);

    // Test formatNumber
    console.log('\n3. Testing formatNumber...');
    console.log(`✅ formatNumber(1500000): ${formatNumber(1500000)}`);
    console.log(`✅ formatNumber(45000): ${formatNumber(45000)}`);
    console.log(`✅ formatNumber(500): ${formatNumber(500)}`);

    return true;
  } catch (error) {
    console.error('❌ Meteora utilities test failed:', error);
    return false;
  }
}

async function testJitoUtilities(walletPubkey: PublicKey) {
  console.log('\n🧪 Testing Jito Utilities...\n');

  try {
    // Test enhanced dynamic tip escalation with different priorities
    console.log('1. Testing enhanced dynamic tip escalation...');

    const priorities: Array<'low' | 'normal' | 'high' | 'urgent' | 'critical'> = ['low', 'normal', 'high', 'urgent', 'critical'];

    for (const priority of priorities) {
      const tipIx = await createEnhancedJitoTipInstruction(walletPubkey, {
        priority,
        attempt: 0,
      });
      console.log(`✅ Priority ${priority}: Tip = ${tipIx.data.readBigUInt64LE(4)} lamports`);
    }

    // Test retry escalation
    console.log('\n2. Testing retry escalation (normal priority)...');
    for (let attempt = 0; attempt < 3; attempt++) {
      const tipIx = await createEnhancedJitoTipInstruction(walletPubkey, {
        priority: 'normal',
        attempt,
      });
      console.log(`✅ Attempt ${attempt}: Tip = ${tipIx.data.readBigUInt64LE(4)} lamports`);
    }

    // Test recommended tip calculation
    console.log('\n3. Testing recommended tip calculation...');
    const normalTip = calculateRecommendedTip(4000, 1.0);
    const urgentTip = calculateRecommendedTip(4000, 2.0);
    console.log(`✅ Normal priority (1.0x): ${normalTip} lamports`);
    console.log(`✅ Urgent priority (2.0x): ${urgentTip} lamports`);

    return true;
  } catch (error) {
    console.error('❌ Jito utilities test failed:', error);
    return false;
  }
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  Integration Test: Meteora LP Army Bot Improvements');
  console.log('═══════════════════════════════════════════════════════════\n');

  // Initialize and load config
  const { cfg, wallet } = await initializeTest();

  const results = {
    jupiterV6: false,
    meteoraAPI: false,
    meteoraUtils: false,
    jitoUtils: false,
  };

  // Run all tests
  results.jupiterV6 = await testJupiterV6();

  // Only run Meteora API test if pool is configured
  if (cfg.meteoraPoolAddress) {
    results.meteoraAPI = await testMeteoraDLMMAPI(cfg.meteoraPoolAddress);
  } else {
    console.log('\n⚠️  Skipping Meteora DLMM API test (METEORA_POOL_ADDRESS not configured)\n');
  }

  results.meteoraUtils = await testMeteoraUtilities();
  results.jitoUtils = await testJitoUtilities(wallet.publicKey);

  // Summary
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  Test Summary');
  console.log('═══════════════════════════════════════════════════════════\n');

  const passed = Object.values(results).filter(Boolean).length;
  const total = Object.keys(results).length;

  console.log(`Jupiter API v6:        ${results.jupiterV6 ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Meteora DLMM API:      ${results.meteoraAPI ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Meteora Utilities:     ${results.meteoraUtils ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Jito Utilities:        ${results.jitoUtils ? '✅ PASS' : '❌ FAIL'}`);

  console.log(`\n${passed}/${total} tests passed\n`);

  if (passed === total) {
    console.log('🎉 All integration tests passed!\n');
    process.exit(0);
  } else {
    console.log('⚠️  Some tests failed. Check logs above.\n');
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
