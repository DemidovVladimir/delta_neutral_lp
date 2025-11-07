/**
 * Test bin ID calculation
 *
 * This test verifies the correctness of the priceToNearestBinId calculation
 * against the actual Meteora DLMM formula
 */

import { getPriceFromBinId } from '../utils/meteoraUtils.js';

// Test parameters
const binStep = 4; // SOL/USDC pool typically uses bin step 4
const decimalsSOL = 9;
const decimalsUSDC = 6;

/**
 * Current implementation (INCORRECT)
 * Missing the decimal adjustment factor
 */
function priceToNearestBinIdWRONG(price: number, binStep: number): number {
  const stepSize = 1 + binStep / 10000;
  const binId = Math.round(Math.log(price) / Math.log(stepSize));
  return binId;
}

/**
 * Corrected implementation
 * Accounts for decimal differences between tokens
 */
function priceToNearestBinIdCORRECT(
  price: number,
  binStep: number,
  decimalsX: number,
  decimalsY: number
): number {
  const stepSize = 1 + binStep / 10000;
  const decimalAdjustment = Math.pow(10, decimalsX - decimalsY);

  // Solve: price = (1 + binStep/10000)^binId * 10^(decimalsX - decimalsY)
  // binId = log(price / decimalAdjustment) / log(stepSize)
  const adjustedPrice = price / decimalAdjustment;
  const binId = Math.round(Math.log(adjustedPrice) / Math.log(stepSize));

  return binId;
}

// Test with a realistic SOL price
const testPrice = 250; // $250 per SOL

console.log('\n=== Bin ID Calculation Test ===\n');
console.log('Test parameters:');
console.log(`  Price: $${testPrice}`);
console.log(`  Bin step: ${binStep}`);
console.log(`  Decimals: SOL=${decimalsSOL}, USDC=${decimalsUSDC}`);
console.log(`  Decimal adjustment factor: 10^(${decimalsSOL}-${decimalsUSDC}) = ${Math.pow(10, decimalsSOL - decimalsUSDC)}`);

console.log('\n--- Wrong calculation (missing decimal adjustment) ---');
const wrongBinId = priceToNearestBinIdWRONG(testPrice, binStep);
console.log(`Bin ID: ${wrongBinId}`);
const wrongPriceBack = getPriceFromBinId(wrongBinId, binStep, decimalsSOL, decimalsUSDC);
console.log(`Price from bin ID: $${wrongPriceBack.toNumber()}`);
console.log(`Error: ${Math.abs(testPrice - wrongPriceBack.toNumber())} (${Math.abs((testPrice - wrongPriceBack.toNumber()) / testPrice * 100).toFixed(2)}%)`);

console.log('\n--- Correct calculation (with decimal adjustment) ---');
const correctBinId = priceToNearestBinIdCORRECT(testPrice, binStep, decimalsSOL, decimalsUSDC);
console.log(`Bin ID: ${correctBinId}`);
const correctPriceBack = getPriceFromBinId(correctBinId, binStep, decimalsSOL, decimalsUSDC);
console.log(`Price from bin ID: $${correctPriceBack.toNumber()}`);
console.log(`Error: ${Math.abs(testPrice - correctPriceBack.toNumber())} (${Math.abs((testPrice - correctPriceBack.toNumber()) / testPrice * 100).toFixed(4)}%)`);

console.log('\n--- Bin ID range analysis ---');
console.log(`Wrong bin ID: ${wrongBinId}`);
console.log(`Correct bin ID: ${correctBinId}`);
console.log(`Difference: ${Math.abs(wrongBinId - correctBinId)} bins`);

// Test with different price ranges
console.log('\n=== Testing with different prices ===\n');
const testPrices = [50, 100, 150, 200, 250, 300];

testPrices.forEach(price => {
  const wrongId = priceToNearestBinIdWRONG(price, binStep);
  const correctId = priceToNearestBinIdCORRECT(price, binStep, decimalsSOL, decimalsUSDC);
  console.log(`Price: $${price.toString().padStart(3)} | Wrong binId: ${wrongId.toString().padStart(6)} | Correct binId: ${correctId.toString().padStart(4)} | Diff: ${(wrongId - correctId).toString().padStart(6)}`);
});

console.log('\n');
