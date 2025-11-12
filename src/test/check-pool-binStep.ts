/**
 * Check the actual bin step of the configured Meteora pool
 */

import { getMeteoraPairInfo } from '../utils/meteoraUtils.js';
import { getConfig } from '../config/env.js';

const config = getConfig();

console.log('\n=== Checking Pool Configuration ===\n');
console.log('Pool address:', config.meteoraPoolAddress);

async function checkPool() {
  try {
    const poolInfo = await getMeteoraPairInfo(config.meteoraPoolAddress!);

    console.log('\nPool details:');
    console.log('  Name:', poolInfo.name);
    console.log('  Bin Step:', poolInfo.binStep);
    console.log('  Current Price:', poolInfo.currentPrice);
    console.log('  Liquidity:', poolInfo.liquidity);
    console.log('  APR:', poolInfo.apr + '%');
    console.log('  APY:', poolInfo.apy + '%');
    console.log('  24h Volume:', poolInfo.tradeVolume24h);
    console.log('  24h Fees:', poolInfo.fees24h);

    // Calculate optimal bin width based on actual bin step
    const binStep = poolInfo.binStep;
    const priceRangeBpsLower = config.priceRangeBpsLower || -340;
    const priceRangeBpsUpper = config.priceRangeBpsUpper || 340;

    const currentPrice = typeof poolInfo.currentPrice === 'number'
      ? poolInfo.currentPrice
      : parseFloat(poolInfo.currentPrice);
    const priceLower = currentPrice * (1 + priceRangeBpsLower / 10000);
    const priceUpper = currentPrice * (1 + priceRangeBpsUpper / 10000);

    // Calculate bin IDs with decimal adjustment
    const decimalsSOL = 9;
    const decimalsUSDC = 6;
    const decimalAdjustment = Math.pow(10, decimalsSOL - decimalsUSDC);
    const stepSize = 1 + binStep / 10000;

    const lowerBinId = Math.round(Math.log(priceLower / decimalAdjustment) / Math.log(stepSize));
    const upperBinId = Math.round(Math.log(priceUpper / decimalAdjustment) / Math.log(stepSize));
    const binWidth = upperBinId - lowerBinId + 1;

    console.log('\nConfigured price range:');
    console.log('  BPS range:', priceRangeBpsLower, 'to', priceRangeBpsUpper);
    console.log('  Percentage:', (priceRangeBpsLower / 100) + '% to', (priceRangeBpsUpper / 100) + '%');
    console.log('  Price range:', '$' + priceLower.toFixed(2), '-', '$' + priceUpper.toFixed(2));
    console.log('  Bin range:', lowerBinId, 'to', upperBinId);
    console.log('  Bin width:', binWidth, 'bins');

    // Recommendations based on bin step
    console.log('\nRecommendations for bin step', binStep + ':');

    if (binStep === 4) {
      console.log('  • Tighter ranges work well (±1-2% = ~50-100 bins)');
      console.log('  • Current ±3.4% gives', binWidth, 'bins');
      if (binWidth > 120) {
        console.log('  ⚠️  Consider tighter range (±200 BPS = ±2%)');
        const tighterBinWidth = Math.round(binWidth * (200 / 340));
        console.log('     This would give ~' + tighterBinWidth + ' bins');
      } else {
        console.log('  ✅ Bin width looks reasonable');
      }
    } else if (binStep === 10) {
      console.log('  • Moderate ranges recommended (±3-5% = ~60-100 bins)');
      console.log('  • Current ±3.4% gives', binWidth, 'bins');
      console.log('  ✅ This looks optimal');
    } else if (binStep >= 25) {
      console.log('  • Wider ranges work better (±5-10%)');
      console.log('  • Current ±3.4% gives', binWidth, 'bins');
      console.log('  • Consider wider range for better capital efficiency');
    }

    console.log('\n');
  } catch (error) {
    console.error('Error fetching pool info:', error);
  }
}

checkPool();
