/**
 * View Transaction Fee Summary
 *
 * This script displays the cumulative transaction fees tracked in state.json
 *
 * Usage:
 *   pnpm tsx src/test/view-transaction-fees.ts
 */

import {
  getTransactionFees,
  getLpFees,
  logTransactionFeeSummary,
} from '../modules/persistence.js';

async function viewTransactionFees() {
  console.log('\n=== 📊 Delta-Neutral Bot - Financial Summary ===\n');

  // Get transaction fees from state
  const txFees = getTransactionFees();
  const lpFees = getLpFees();

  // Transaction fees (costs)
  if (!txFees) {
    console.log('ℹ️  No transaction fees tracked yet.');
    console.log('\nTransaction fees will be automatically tracked when you:');
    console.log('  • Create positions');
    console.log('  • Rebalance positions (auto-tune)');
    console.log('  • Withdraw, claim, or close positions\n');
  } else {
    console.log('💸 TRANSACTION FEES (COSTS)\n');
    logTransactionFeeSummary();
  }

  // LP fees (revenue)
  if (!lpFees) {
    console.log('\n💰 LP FEES (REVENUE)\n');
    console.log('ℹ️  No LP fees tracked yet.');
    console.log('\nLP fees will be automatically tracked when you:');
    console.log('  • Claim fees during rebalancing');
    console.log('  • Manually claim fees from positions\n');
  } else {
    console.log('\n💰 LP FEES (REVENUE)\n');

    const totalClaimedSol = lpFees.totalClaimedFees.sol;
    const totalClaimedUsdc = lpFees.totalClaimedFees.usdc;
    const currentUnclaimedSol = lpFees.currentUnclaimedFees.sol;
    const currentUnclaimedUsdc = lpFees.currentUnclaimedFees.usdc;

    console.log('Total Claimed Fees:', {
      sol: totalClaimedSol.toFixed(6),
      usdc: totalClaimedUsdc.toFixed(2),
      claimCount: lpFees.claimHistory.length,
    });

    console.log('\nCurrent Unclaimed Fees:', {
      sol: currentUnclaimedSol.toFixed(6),
      usdc: currentUnclaimedUsdc.toFixed(2),
    });

    if (lpFees.claimHistory.length > 0) {
      console.log('\nRecent Claims:');
      // Show last 5 claims
      const recentClaims = lpFees.claimHistory.slice(-5);
      for (const claim of recentClaims) {
        const date = new Date(claim.timestamp).toLocaleString();
        console.log(`  └─ ${date}: ${claim.sol.toFixed(6)} SOL + ${claim.usdc.toFixed(2)} USDC`);
      }
    }
  }

  // Net profit calculation
  if (txFees && lpFees) {
    console.log('\n📈 NET PROFIT CALCULATION\n');

    // Convert SOL fees to USD (use a recent price estimate)
    // Note: This is approximate - actual USD value depends on SOL price at time of claim
    const solPriceEstimate = 142; // Approximate SOL price
    const lpFeesUsd = (lpFees.totalClaimedFees.sol * solPriceEstimate) + lpFees.totalClaimedFees.usdc;
    const txFeesUsd = txFees.totalFeeUsd;

    console.log('Revenue (LP fees earned):    $' + lpFeesUsd.toFixed(2));
    console.log('Costs (transaction fees):   -$' + txFeesUsd.toFixed(2));
    console.log('─'.repeat(40));
    console.log('Gross Profit:                $' + (lpFeesUsd - txFeesUsd).toFixed(2));

    console.log('\n⚠️  Note: This does NOT include impermanent loss/gain.');
    console.log('For complete profit calculation, also account for:');
    console.log('  • Impermanent Loss (IL) from price movements');
    console.log('  • Change in position value (SOL + USDC)');
    console.log('\n  True Net Profit = LP Fees - TX Fees - IL\n');
  }
}

viewTransactionFees();
