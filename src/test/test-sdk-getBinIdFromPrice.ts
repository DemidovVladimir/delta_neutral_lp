/**
 * Test the SDK's getBinIdFromPrice() method vs our manual calculation
 */

import { PublicKey } from '@solana/web3.js';
import DLMMModule from '@meteora-ag/dlmm';
import { getConnection } from '../core/agentKit.js';
import { getConfig } from '../config/env.js';
import { getPriceFromBinId } from '../utils/meteoraUtils.js';

// @ts-ignore - ESM default export handling
const DLMM: any = DLMMModule.default || DLMMModule;

const config = getConfig();

async function testSDKBinConversion() {
  console.log('\n=== Testing SDK getBinIdFromPrice() ===\n');

  try {
    const connection = getConnection();
    const poolPubkey = new PublicKey(config.meteoraPoolAddress!);

    const dlmmPool = await DLMM.create(connection, poolPubkey);

    // Get active bin for reference
    const activeBin = await dlmmPool.getActiveBin();
    const currentPriceRaw = dlmmPool.fromPricePerLamport(Number(activeBin.price));
    const currentPrice = Number(currentPriceRaw);

    console.log('Active bin info:');
    console.log('  Bin ID:', activeBin.binId);
    console.log('  Price:', '$' + currentPrice.toFixed(2));
    console.log('  Bin step:', dlmmPool.lbPair.binStep);

    // Test SDK method: getBinIdFromPrice
    console.log('\n--- Testing SDK getBinIdFromPrice() ---');

    const testPrices = [150, 160, 162, 165, 170, 180];

    testPrices.forEach(price => {
      // Convert price to lamport format for SDK
      const pricePerLamport = dlmmPool.toPricePerLamport(price);

      // SDK method
      const sdkBinId = dlmmPool.getBinIdFromPrice(pricePerLamport, false); // false = don't round up

      // Verify by converting bin ID back to price
      const verifyPrice = getPriceFromBinId(
        sdkBinId,
        dlmmPool.lbPair.binStep,
        9, // SOL decimals
        6  // USDC decimals
      );

      console.log(`Price $${price.toString().padStart(3)}:`);
      console.log(`  → pricePerLamport: ${pricePerLamport}`);
      console.log(`  → SDK binId: ${sdkBinId}`);
      console.log(`  → Verify price: $${verifyPrice.toFixed(2)}`);
      console.log(`  → Error: $${Math.abs(price - verifyPrice.toNumber()).toFixed(4)}`);
    });

    // Test our manual calculation vs SDK
    console.log('\n--- Manual Calculation vs SDK ---');

    function manualPriceToBinId(dlmmPool: any, price: number): number {
      const binStep = dlmmPool.lbPair.binStep;
      const tokenXDecimal = 9; // SOL decimals - hardcoded since dlmmPool doesn't have it
      const tokenYDecimal = 6; // USDC decimals
      const stepSize = 1 + binStep / 10000;
      const decimalAdjustment = Math.pow(10, tokenXDecimal - tokenYDecimal);
      const adjustedPrice = price / decimalAdjustment;
      return Math.round(Math.log(adjustedPrice) / Math.log(stepSize));
    }

    testPrices.forEach(price => {
      const pricePerLamport = dlmmPool.toPricePerLamport(price);
      const sdkBinId = dlmmPool.getBinIdFromPrice(pricePerLamport, false);
      const manualBinId = manualPriceToBinId(dlmmPool, price);

      const match = sdkBinId === manualBinId ? '✅' : '❌';
      console.log(`Price $${price}: SDK=${sdkBinId}, Manual=${manualBinId} ${match}`);
    });

    // Test with current price range from config
    console.log('\n--- Testing With Config Price Range ---');

    const priceLower = currentPrice * (1 + (config.priceRangeBpsLower || -200) / 10000);
    const priceUpper = currentPrice * (1 + (config.priceRangeBpsUpper || 200) / 10000);

    console.log('Config range: ±' + Math.abs(config.priceRangeBpsLower || 200) / 100 + '%');
    console.log('Price range: $' + priceLower.toFixed(2) + ' - $' + priceUpper.toFixed(2));

    const lowerLamport = dlmmPool.toPricePerLamport(priceLower);
    const upperLamport = dlmmPool.toPricePerLamport(priceUpper);

    const lowerBinId = dlmmPool.getBinIdFromPrice(lowerLamport, false);
    const upperBinId = dlmmPool.getBinIdFromPrice(upperLamport, false);
    const binWidth = upperBinId - lowerBinId + 1;

    console.log('\nSDK results:');
    console.log('  Lower bin ID:', lowerBinId);
    console.log('  Upper bin ID:', upperBinId);
    console.log('  Bin width:', binWidth);

    console.log('\n✅ RECOMMENDATION: Use dlmmPool.getBinIdFromPrice() instead of manual calculation!');

  } catch (error) {
    console.error('Error:', error);
  }
}

testSDKBinConversion();
