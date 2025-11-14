/**
 * Explore what methods Meteora SDK provides for bin/price conversions
 * This will help us understand if we should use SDK methods instead of manual calculations
 */

import { PublicKey } from '@solana/web3.js';
import DLMMModule from '@meteora-ag/dlmm';
import { getConnection } from '../utils/solana.js';
import { getConfig } from '../config/env.js';

// @ts-ignore - ESM default export handling
const DLMM: any = DLMMModule.default || DLMMModule;

const config = getConfig();

async function exploreDLMMSDK() {
  console.log('\n=== Exploring Meteora DLMM SDK Methods ===\n');

  try {
    const connection = getConnection();
    const poolPubkey = new PublicKey(config.meteoraPoolAddress!);

    console.log('Creating DLMM pool instance...');
    const dlmmPool = await DLMM.create(connection, poolPubkey);

    console.log('\n--- Pool Instance Properties ---');
    console.log('Pool address:', dlmmPool.pubkey.toBase58());
    console.log('Token X mint:', dlmmPool.tokenX.publicKey.toBase58());
    console.log('Token Y mint:', dlmmPool.tokenY.publicKey.toBase58());
    console.log('Token X decimals:', dlmmPool.tokenX.decimal);
    console.log('Token Y decimals:', dlmmPool.tokenY.decimal);
    console.log('Bin step:', dlmmPool.lbPair.binStep);

    console.log('\n--- Active Bin Methods ---');
    const activeBin = await dlmmPool.getActiveBin();
    console.log('getActiveBin() returns:');
    console.log('  binId:', activeBin.binId);
    console.log('  price (raw):', activeBin.price);
    console.log('  xAmount:', activeBin.xAmount);
    console.log('  yAmount:', activeBin.yAmount);

    console.log('\n--- Price Conversion Methods ---');
    console.log('Available methods on dlmmPool:');

    // Check what methods exist
    const methods = [
      'fromPricePerLamport',
      'toPricePerLamport',
      'getPriceFromBinId',
      'getBinIdFromPrice',
      'getBinFromBinId',
      'getBinArrays',
    ];

    methods.forEach(method => {
      if (typeof (dlmmPool as any)[method] === 'function') {
        console.log(`  ✅ ${method}() - EXISTS`);
      } else {
        console.log(`  ❌ ${method}() - NOT FOUND`);
      }
    });

    // Test fromPricePerLamport
    if (typeof dlmmPool.fromPricePerLamport === 'function') {
      console.log('\n--- Testing fromPricePerLamport() ---');
      const pricePerToken = dlmmPool.fromPricePerLamport(Number(activeBin.price));
      console.log('fromPricePerLamport(' + activeBin.price + ') =', pricePerToken);
      console.log('This converts raw price to human-readable price per token');
    }

    // Test toPricePerLamport
    if (typeof dlmmPool.toPricePerLamport === 'function') {
      console.log('\n--- Testing toPricePerLamport() ---');
      const currentPrice = 162; // Example SOL price
      const pricePerLamport = dlmmPool.toPricePerLamport(currentPrice);
      console.log('toPricePerLamport(' + currentPrice + ') =', pricePerLamport);
      console.log('This converts human price to raw lamport price');
    }

    // Look at the actual object structure
    console.log('\n--- Examining dlmmPool Object ---');
    console.log('dlmmPool keys:', Object.keys(dlmmPool).slice(0, 20));

    // Check if there are static methods on DLMM class
    console.log('\n--- Checking DLMM Static Methods ---');
    console.log('DLMM static methods:', Object.getOwnPropertyNames(DLMM).slice(0, 20));

    // Try to find bin calculation utilities
    console.log('\n--- Looking for Bin Calculation Utilities ---');
    const allMethods = Object.getOwnPropertyNames(Object.getPrototypeOf(dlmmPool));
    const binMethods = allMethods.filter(m =>
      m.toLowerCase().includes('bin') ||
      m.toLowerCase().includes('price')
    );
    console.log('Methods containing "bin" or "price":', binMethods);

    // Test actual conversion with our manual calculation
    console.log('\n--- Comparing Manual vs SDK Calculations ---');

    const testPrice = 162; // $162 per SOL

    // Manual calculation (what we're doing now)
    const binStep = dlmmPool.lbPair.binStep;
    const tokenXDecimal = dlmmPool.tokenX.decimal;
    const tokenYDecimal = dlmmPool.tokenY.decimal;
    const stepSize = 1 + binStep / 10000;
    const decimalAdjustment = Math.pow(10, tokenXDecimal - tokenYDecimal);
    const adjustedPrice = testPrice / decimalAdjustment;
    const manualBinId = Math.round(Math.log(adjustedPrice) / Math.log(stepSize));

    console.log('Test price: $' + testPrice);
    console.log('Manual calculation:');
    console.log('  Decimal adjustment:', decimalAdjustment);
    console.log('  Adjusted price:', adjustedPrice);
    console.log('  Calculated binId:', manualBinId);

    // Check if SDK has a method to do this
    if (typeof dlmmPool.toPricePerLamport === 'function') {
      const sdkPrice = dlmmPool.toPricePerLamport(testPrice);
      console.log('\nSDK toPricePerLamport(' + testPrice + '):', sdkPrice);
      console.log('Compare to active bin price:', activeBin.price);
    }

  } catch (error) {
    console.error('Error:', error);
  }
}

exploreDLMMSDK();
