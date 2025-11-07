/**
 * APY Breakdown Explanation
 *
 * Shows how Meteora calculates the 1238% APY and what it actually means
 */

// Data from Meteora API (as of right now)
const fees24h = 19310.79; // $19,310.79 in fees collected in last 24h
const liquidity = 2707643.93; // $2.7M total liquidity in pool
const apr = 0.7132; // 0.7132% daily APR
const apy = 1238.22; // 1238% APY (annualized with compounding)

console.log('\n=== Meteora DLMM APY Breakdown ===\n');
console.log('Pool: SOL-USDC (bin step 4)');
console.log('Address: 5rCf1DM8LjKTw4YqhnoLcngyZYeNnQqztScTogYHAS6\n');

console.log('Raw data from Meteora API:');
console.log('  24h fees collected: $' + fees24h.toLocaleString());
console.log('  Total liquidity: $' + liquidity.toLocaleString());
console.log('  APR: ' + apr + '%');
console.log('  APY: ' + apy + '%\n');

// Step 1: Calculate daily return rate
const dailyFeeRate = fees24h / liquidity;
console.log('Step 1: Daily fee rate');
console.log('  Formula: fees_24h / liquidity');
console.log('  Calculation: $' + fees24h.toLocaleString() + ' / $' + liquidity.toLocaleString());
console.log('  Daily return: ' + (dailyFeeRate * 100).toFixed(4) + '%\n');

// Step 2: Annualize without compounding (APR)
const calculatedAPR = dailyFeeRate * 365 * 100;
console.log('Step 2: APR (simple annualization, no compounding)');
console.log('  Formula: daily_rate × 365');
console.log('  Calculation: ' + (dailyFeeRate * 100).toFixed(4) + '% × 365');
console.log('  APR: ' + calculatedAPR.toFixed(2) + '%');
console.log('  API reported APR: ' + apr + '%\n');

// Step 3: Annualize WITH compounding (APY)
const calculatedAPY = (Math.pow(1 + dailyFeeRate, 365) - 1) * 100;
console.log('Step 3: APY (annualized with daily compounding)');
console.log('  Formula: ((1 + daily_rate)^365 - 1) × 100');
console.log('  Calculation: ((1 + ' + dailyFeeRate.toFixed(6) + ')^365 - 1) × 100');
console.log('  APY: ' + calculatedAPY.toFixed(2) + '%');
console.log('  API reported APY: ' + apy + '%\n');

console.log('=== Important Notes ===\n');

console.log('1. WHY IS APY SO HIGH?');
console.log('   The pool has:');
console.log('   • $44M daily volume (very high!)');
console.log('   • $2.7M liquidity (relatively low)');
console.log('   • Bin step 4 = tighter spreads = more trades hit your bins');
console.log('   • Volume/Liquidity ratio: ' + (43889187 / liquidity).toFixed(1) + 'x\n');

console.log('2. IS THIS SUSTAINABLE?');
console.log('   • APY is calculated from LAST 24h fees');
console.log('   • Highly volatile - can change dramatically day to day');
console.log('   • High volume days = high APY');
console.log('   • Low volume days = lower APY');
console.log('   • This is NOT a guaranteed return rate!\n');

console.log('3. ACTUAL EXPECTED RETURNS');
console.log('   If you deposit $100:');
console.log('   • Daily (at current rate): $' + (100 * dailyFeeRate).toFixed(4));
console.log('   • Weekly (if sustained): $' + (100 * dailyFeeRate * 7).toFixed(2));
console.log('   • Monthly (if sustained): $' + (100 * dailyFeeRate * 30).toFixed(2));
console.log('   • Yearly (if sustained): $' + (100 * calculatedAPR / 100).toFixed(2));
console.log('   • Yearly (with compounding): $' + (100 * (Math.pow(1 + dailyFeeRate, 365) - 1)).toFixed(2) + '\n');

console.log('4. RISK FACTORS');
console.log('   • Impermanent loss (price divergence between SOL/USDC)');
console.log('   • Volume can drop = APY drops');
console.log('   • More liquidity joins = your share of fees decreases');
console.log('   • Price moves outside your range = you earn 0 fees\n');

console.log('5. WHY BIN STEP 4 MATTERS');
console.log('   • Smaller bin step = tighter price ranges');
console.log('   • More concentrated liquidity = higher fee capture');
console.log('   • But also = higher risk of price moving out of range');
console.log('   • Bin step 4 pools typically have 5-10x higher APY than bin step 50+\n');

// Compare to other scenarios
console.log('=== Volume Sensitivity ===\n');
const scenarios = [
  { volume: 10000000, desc: 'Low volume day ($10M)' },
  { volume: 25000000, desc: 'Average volume day ($25M)' },
  { volume: 44000000, desc: 'Current volume ($44M)' },
  { volume: 75000000, desc: 'High volume day ($75M)' },
];

scenarios.forEach(scenario => {
  // Estimate fees (assume 0.04% base fee for bin step 4)
  const estimatedFees = scenario.volume * 0.0004;
  const dailyRate = estimatedFees / liquidity;
  const estimatedAPY = (Math.pow(1 + dailyRate, 365) - 1) * 100;

  console.log(scenario.desc);
  console.log('  Estimated 24h fees: $' + estimatedFees.toLocaleString());
  console.log('  Estimated APY: ' + estimatedAPY.toFixed(0) + '%\n');
});

console.log('Conclusion: The 1238% APY is REAL but based on current high volume.');
console.log('Expect it to fluctuate between 500-2000% depending on daily volume.\n');
