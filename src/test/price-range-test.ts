/**
 * Price Range Verification Test
 *
 * Verifies that the configured price range BPS settings produce the expected
 * bin width and price ranges for the SOL/USDC pool with bin step 10
 */

// Wrap in IIFE to avoid global scope conflicts
(function() {
// Configuration from .env
const PRICE_RANGE_BPS_LOWER = -340; // -3.4%
const PRICE_RANGE_BPS_UPPER = 340;  // +3.4%
const BIN_STEP = 10; // Pool bin step
const CURRENT_SOL_PRICE = 197; // Approximate current SOL price

// Calculate price bounds from BPS
const priceLower = CURRENT_SOL_PRICE * (1 + PRICE_RANGE_BPS_LOWER / 10000);
const priceUpper = CURRENT_SOL_PRICE * (1 + PRICE_RANGE_BPS_UPPER / 10000);

console.log('\n=== Price Range Configuration Verification ===\n');
console.log('Configuration:');
console.log(`  Current SOL price: $${CURRENT_SOL_PRICE}`);
console.log(`  Bin step: ${BIN_STEP}`);
console.log(`  Price range BPS: ${PRICE_RANGE_BPS_LOWER} to ${PRICE_RANGE_BPS_UPPER}`);
console.log(`  Price range %: ${PRICE_RANGE_BPS_LOWER / 100}% to ${PRICE_RANGE_BPS_UPPER / 100}%`);

console.log('\nCalculated price range:');
console.log(`  Lower bound: $${priceLower.toFixed(2)}`);
console.log(`  Upper bound: $${priceUpper.toFixed(2)}`);
console.log(`  Range width: $${(priceUpper - priceLower).toFixed(2)}`);

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
console.log(`  Current bin ID: ${currentBinId}`);
console.log(`  Lower bin ID: ${lowerBinId}`);
console.log(`  Upper bin ID: ${upperBinId}`);
console.log(`  Bin width: ${binWidth} bins`);

console.log('\nVerification (converting bin IDs back to prices):');
console.log(`  Current price from bin: $${binIdToPrice(currentBinId).toFixed(2)} (should be ~$${CURRENT_SOL_PRICE})`);
console.log(`  Lower price from bin: $${binIdToPrice(lowerBinId).toFixed(2)} (should be ~$${priceLower.toFixed(2)})`);
console.log(`  Upper price from bin: $${binIdToPrice(upperBinId).toFixed(2)} (should be ~$${priceUpper.toFixed(2)})`);

console.log('\nConfiguration assessment:');
if (binWidth <= 70) {
  console.log(`  ✅ Bin width (${binWidth}) is within optimal range for bin step ${BIN_STEP}`);
} else {
  console.log(`  ⚠️  Bin width (${binWidth}) might be too wide for bin step ${BIN_STEP}`);
}

console.log(`  Price range: ${((priceUpper - priceLower) / CURRENT_SOL_PRICE * 100).toFixed(2)}% of current price`);

// Test at different price points
console.log('\n=== Testing at different SOL prices ===\n');
const testPrices = [150, 175, 200, 225, 250];

testPrices.forEach(price => {
  const lower = price * (1 + PRICE_RANGE_BPS_LOWER / 10000);
  const upper = price * (1 + PRICE_RANGE_BPS_UPPER / 10000);
  const lowerBin = priceToBinId(lower);
  const upperBin = priceToBinId(upper);
  const width = upperBin - lowerBin + 1;

  console.log(`SOL = $${price.toString().padStart(3)}: range $${lower.toFixed(2).padStart(6)} - $${upper.toFixed(2).padStart(6)} | bins ${lowerBin.toString().padStart(5)} to ${upperBin.toString().padStart(5)} | width ${width.toString().padStart(2)}`);
});

console.log('\n');
})(); // Close IIFE
