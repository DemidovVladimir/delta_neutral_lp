/**
 * Verify the new configuration with bin step 4 and ±2% range
 */

// Wrap in IIFE to avoid global scope conflicts
(function() {
// New configuration
const BIN_STEP = 4;
const PRICE_RANGE_BPS_LOWER = -200; // -2%
const PRICE_RANGE_BPS_UPPER = 200;  // +2%
const CURRENT_SOL_PRICE = 161.76; // Current price from pool

// Calculate price bounds
const priceLower = CURRENT_SOL_PRICE * (1 + PRICE_RANGE_BPS_LOWER / 10000);
const priceUpper = CURRENT_SOL_PRICE * (1 + PRICE_RANGE_BPS_UPPER / 10000);

console.log('\n=== Updated Configuration Verification ===\n');
console.log('Pool details:');
console.log('  Name: SOL-USDC');
console.log('  Bin step: 4');
console.log('  Current price: $' + CURRENT_SOL_PRICE);
console.log('  Liquidity: $2.7M');
console.log('  APY: 1262%');

console.log('\nNew configuration:');
console.log('  Price range BPS: ' + PRICE_RANGE_BPS_LOWER + ' to ' + PRICE_RANGE_BPS_UPPER);
console.log('  Price range %: ' + (PRICE_RANGE_BPS_LOWER / 100) + '% to ' + (PRICE_RANGE_BPS_UPPER / 100) + '%');

console.log('\nCalculated price range:');
console.log('  Lower bound: $' + priceLower.toFixed(2));
console.log('  Upper bound: $' + priceUpper.toFixed(2));
console.log('  Range width: $' + (priceUpper - priceLower).toFixed(2));

// Calculate bin IDs (with decimal adjustment for SOL/USDC)
const decimalsSOL = 9;
const decimalsUSDC = 6;
const decimalAdjustment = Math.pow(10, decimalsSOL - decimalsUSDC);
const stepSize = 1 + BIN_STEP / 10000;

function priceToBinId(price: number): number {
  const adjustedPrice = price / decimalAdjustment;
  return Math.round(Math.log(adjustedPrice) / Math.log(stepSize));
}

function binIdToPrice(binId: number): number {
  return Math.pow(stepSize, binId) * decimalAdjustment;
}

const currentBinId = priceToBinId(CURRENT_SOL_PRICE);
const lowerBinId = priceToBinId(priceLower);
const upperBinId = priceToBinId(priceUpper);
const binWidth = upperBinId - lowerBinId + 1;

console.log('\nBin calculations:');
console.log('  Current bin ID: ' + currentBinId);
console.log('  Lower bin ID: ' + lowerBinId);
console.log('  Upper bin ID: ' + upperBinId);
console.log('  Bin width: ' + binWidth + ' bins');

console.log('\nVerification (converting bin IDs back to prices):');
console.log('  Current price from bin: $' + binIdToPrice(currentBinId).toFixed(2) + ' (should be ~$' + CURRENT_SOL_PRICE + ')');
console.log('  Lower price from bin: $' + binIdToPrice(lowerBinId).toFixed(2) + ' (should be ~$' + priceLower.toFixed(2) + ')');
console.log('  Upper price from bin: $' + binIdToPrice(upperBinId).toFixed(2) + ' (should be ~$' + priceUpper.toFixed(2) + ')');

console.log('\nConfiguration assessment:');
if (binWidth >= 80 && binWidth <= 120) {
  console.log('  ✅ Bin width (' + binWidth + ') is OPTIMAL for bin step ' + BIN_STEP);
} else if (binWidth < 80) {
  console.log('  ℹ️  Bin width (' + binWidth + ') is on the lower side (acceptable but could be wider)');
} else {
  console.log('  ⚠️  Bin width (' + binWidth + ') might be too wide');
}

console.log('  ✅ Price range: ' + ((priceUpper - priceLower) / CURRENT_SOL_PRICE * 100).toFixed(2) + '% of current price');
console.log('  ✅ Tighter range = better capital efficiency for bin step 4');

// Compare to old configuration
const oldBpsLower = -340;
const oldBpsUpper = 340;
const oldPriceLower = CURRENT_SOL_PRICE * (1 + oldBpsLower / 10000);
const oldPriceUpper = CURRENT_SOL_PRICE * (1 + oldBpsUpper / 10000);
const oldLowerBinId = priceToBinId(oldPriceLower);
const oldUpperBinId = priceToBinId(oldPriceUpper);
const oldBinWidth = oldUpperBinId - oldLowerBinId + 1;

console.log('\nComparison to old configuration:');
console.log('  Old: ±3.4% = ' + oldBinWidth + ' bins (too wide for bin step 4)');
console.log('  New: ±2.0% = ' + binWidth + ' bins (optimal for bin step 4)');
console.log('  Improvement: ' + (oldBinWidth - binWidth) + ' fewer bins = better capital efficiency');

console.log('\n');
})();

