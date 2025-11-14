/**
 * Test transaction fee calculation
 *
 * This demonstrates how transaction fees are calculated and logged
 */

import { getConnection } from '../utils/solana.js';
import { getTransactionFees } from '../utils/transactionUtils.js';

// Example: Test with a recent mainnet transaction
// Replace with an actual transaction signature from your wallet
const EXAMPLE_SIGNATURE = '5w...'; // Replace with actual signature

async function testFeeCalculation() {
  console.log('\n=== Testing Transaction Fee Calculation ===\n');

  const connection = getConnection();

  console.log('This test shows how transaction fees are calculated and logged.');
  console.log('When you create positions, claim fees, or perform other operations,');
  console.log('the bot will automatically log detailed fee information.\n');

  console.log('Fee information includes:');
  console.log('  • Transaction signature (for verification on Solscan)');
  console.log('  • Fee in lamports (raw Solana units)');
  console.log('  • Fee in SOL (human-readable)');
  console.log('  • Fee in USD (approximate)');
  console.log('  • Compute units consumed (transaction complexity)');
  console.log('  • Direct Solscan link\n');

  console.log('Example log output for a Position Creation:');
  console.log('---');
  console.log('2025-11-07 20:30:15 [info] 💰 Transaction fees - Position Creation {');
  console.log('  "signature": "5w8k...",');
  console.log('  "feeLamports": 5000,');
  console.log('  "feeSol": "0.000005",');
  console.log('  "feeUsd": "0.0008",');
  console.log('  "computeUnitsConsumed": 45231,');
  console.log('  "solscan": "https://solscan.io/tx/5w8k..."');
  console.log('}\n');

  console.log('Example log output for Fee Claiming (multiple transactions):');
  console.log('---');
  console.log('2025-11-07 20:30:20 [info] 💰 Total transaction fees - Fee Claiming {');
  console.log('  "transactionCount": 2,');
  console.log('  "totalFeeLamports": 10000,');
  console.log('  "totalFeeSol": "0.000010",');
  console.log('  "totalFeeUsd": "0.0016",');
  console.log('  "totalComputeUnits": 87542,');
  console.log('  "breakdown": [');
  console.log('    {');
  console.log('      "signature": "5w8k...",');
  console.log('      "feeSol": "0.000005",');
  console.log('      "computeUnits": 45231');
  console.log('    },');
  console.log('    {');
  console.log('      "signature": "3Xy9...",');
  console.log('      "feeSol": "0.000005",');
  console.log('      "computeUnits": 42311');
  console.log('    }');
  console.log('  ]');
  console.log('}\n');

  console.log('Transaction Fee Tracking Benefits:');
  console.log('  ✅ Monitor costs per operation type');
  console.log('  ✅ Calculate profitability (fees earned vs tx costs)');
  console.log('  ✅ Optimize gas usage over time');
  console.log('  ✅ Budget for future operations');
  console.log('  ✅ Audit transaction history\n');

  console.log('Typical Transaction Costs on Solana:');
  console.log('  • Simple transfer: ~0.000005 SOL ($0.0008)');
  console.log('  • Create position: ~0.000010-0.000020 SOL ($0.0016-$0.0032)');
  console.log('  • Claim fees: ~0.000005 SOL per tx ($0.0008)');
  console.log('  • Deposit/Withdraw: ~0.000010 SOL ($0.0016)');
  console.log('  • Close position: ~0.000005 SOL ($0.0008)\n');

  console.log('Note: Actual fees vary based on:');
  console.log('  • Transaction complexity (compute units)');
  console.log('  • Network congestion');
  console.log('  • Priority fees set');
  console.log('  • Number of accounts accessed\n');

  // If an example signature is provided, fetch real data
  if (EXAMPLE_SIGNATURE !== '5w...') {
    console.log('Fetching real transaction data for example signature...\n');
    try {
      const feeDetails = await getTransactionFees(connection, EXAMPLE_SIGNATURE);
      console.log('Real transaction fee data:');
      console.log('  Signature:', EXAMPLE_SIGNATURE);
      console.log('  Fee (lamports):', feeDetails.feeLamports);
      console.log('  Fee (SOL):', feeDetails.feeSol.toFixed(6));
      console.log('  Fee (USD):', (feeDetails.feeSol * 163).toFixed(4));
      console.log('  Compute units:', feeDetails.computeUnitsConsumed || 'N/A');
      console.log('  Solscan:', `https://solscan.io/tx/${EXAMPLE_SIGNATURE}\n`);
    } catch (error) {
      console.error('Error fetching transaction:', error);
    }
  }
}

testFeeCalculation();
