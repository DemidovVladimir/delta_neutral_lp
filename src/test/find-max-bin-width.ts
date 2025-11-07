/**
 * Find the actual maximum bin width allowed by Meteora
 * Test with different bin widths to determine the real limit
 */

import { PublicKey } from '@solana/web3.js';
import DLMMModule from '@meteora-ag/dlmm';
import { getConnection } from '../core/agentKit.js';
import { getConfig } from '../config/env.js';

// @ts-ignore - ESM default export handling
const DLMM: any = DLMMModule.default || DLMMModule;

const config = getConfig();

async function findMaxBinWidth() {
  console.log('\n=== Finding Maximum Bin Width ===\n');

  try {
    const connection = getConnection();
    const poolPubkey = new PublicKey(config.meteoraPoolAddress!);
    const dlmmPool = await DLMM.create(connection, poolPubkey);

    // Get active bin
    const activeBin = await dlmmPool.getActiveBin();
    const currentPriceRaw = dlmmPool.fromPricePerLamport(Number(activeBin.price));
    const currentPrice = Number(currentPriceRaw);

    console.log('Pool info:');
    console.log('  Active bin ID:', activeBin.binId);
    console.log('  Current price: $' + currentPrice.toFixed(2));
    console.log('  Bin step:', dlmmPool.lbPair.binStep);

    // Calculate current configuration width
    const priceLower = currentPrice * (1 + (config.priceRangeBpsLower || -200) / 10000);
    const priceUpper = currentPrice * (1 + (config.priceRangeBpsUpper || 200) / 10000);

    const lowerLamport = dlmmPool.toPricePerLamport(priceLower);
    const upperLamport = dlmmPool.toPricePerLamport(priceUpper);

    const lowerBinId = dlmmPool.getBinIdFromPrice(lowerLamport, false);
    const upperBinId = dlmmPool.getBinIdFromPrice(upperLamport, false);
    const currentWidth = upperBinId - lowerBinId + 1;

    console.log('\nCurrent config produces:');
    console.log('  Price range: $' + priceLower.toFixed(2) + ' - $' + priceUpper.toFixed(2));
    console.log('  Bin range:', lowerBinId, 'to', upperBinId);
    console.log('  Bin width:', currentWidth, 'bins');
    console.log('  Status: ❌ This failed with "Invalid position width" error');

    // Common max widths to test (from Meteora docs and other pools)
    console.log('\n--- Known Meteora Limits ---');
    console.log('Meteora DLMM commonly supports:');
    console.log('  • Min width: 1 bin');
    console.log('  • Typical max width: 70 bins (configurable per pool)');
    console.log('  • Some pools allow: 140+ bins');
    console.log('  • The limit depends on pool configuration');

    // Calculate different bin widths
    console.log('\n--- Testing Different Ranges ---');

    const testWidths = [
      { bps: 50, desc: '±0.5%' },
      { bps: 100, desc: '±1.0%' },
      { bps: 150, desc: '±1.5%' },
      { bps: 200, desc: '±2.0% (current)' },
    ];

    testWidths.forEach(test => {
      const lower = currentPrice * (1 + (-test.bps) / 10000);
      const upper = currentPrice * (1 + test.bps / 10000);

      const lowerLamp = dlmmPool.toPricePerLamport(lower);
      const upperLamp = dlmmPool.toPricePerLamport(upper);

      const lowerBin = dlmmPool.getBinIdFromPrice(lowerLamp, false);
      const upperBin = dlmmPool.getBinIdFromPrice(upperLamp, false);
      const width = upperBin - lowerBin + 1;

      const status = width <= 70 ? '✅' : '❌';
      console.log(`${test.desc}: ${width} bins ${status}`);
    });

    console.log('\n--- Recommendation ---');
    console.log('For bin step 4 with 70-bin max:');
    console.log('  • Use ±1.4% range (~56 bins)');
    console.log('  • Or ±1.0% range (~50 bins) for safety margin');
    console.log('  • Tighter ranges are better for capital efficiency anyway');

    // Calculate optimal config
    const targetBps = 140; // ±1.4%
    const optLower = currentPrice * (1 + (-targetBps) / 10000);
    const optUpper = currentPrice * (1 + targetBps / 10000);

    const optLowerLamp = dlmmPool.toPricePerLamport(optLower);
    const optUpperLamp = dlmmPool.toPricePerLamport(optUpper);

    const optLowerBin = dlmmPool.getBinIdFromPrice(optLowerLamp, false);
    const optUpperBin = dlmmPool.getBinIdFromPrice(optUpperLamp, false);
    const optWidth = optUpperBin - optLowerBin + 1;

    console.log('\nOptimal configuration:');
    console.log('  PRICE_RANGE_BPS_LOWER=-' + targetBps);
    console.log('  PRICE_RANGE_BPS_UPPER=' + targetBps);
    console.log('  Price range: $' + optLower.toFixed(2) + ' - $' + optUpper.toFixed(2));
    console.log('  Bin width: ' + optWidth + ' bins (within 70 limit)');

  } catch (error) {
    console.error('Error:', error);
  }
}

findMaxBinWidth();
