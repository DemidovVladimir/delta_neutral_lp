/**
 * Find Meteora DLMM SOL/USDC pools on mainnet
 *
 * Usage:
 *   NODE_ENV=mainnet npx tsx scripts/find-mainnet-pools.ts
 */

import { config } from 'dotenv';
import { Connection, PublicKey } from '@solana/web3.js';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const DLMMModule = require('@meteora-ag/dlmm');

// Load environment variables
const env = process.env.NODE_ENV || 'mainnet';
config({ path: `.env.${env}` });

const DLMM: any = DLMMModule.default || DLMMModule;

// Get RPC URL from environment
const MAINNET_RPC = process.env.RPC_URL;
if (!MAINNET_RPC) {
  console.error('❌ Error: RPC_URL not found in environment');
  console.error('Please set RPC_URL in .env.mainnet');
  process.exit(1);
}

const METEORA_DLMM_PROGRAM_ID = 'LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo';
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

async function findSolUsdcPools() {
  console.log('🔍 Finding Meteora DLMM SOL/USDC pools on mainnet...\n');

  const connection = new Connection(MAINNET_RPC!, 'confirmed');

  try {
    const version = await connection.getVersion();
    console.log(`✅ Connected to mainnet (version: ${version['solana-core']})`);
    console.log('');

    const programId = new PublicKey(METEORA_DLMM_PROGRAM_ID);
    console.log('Fetching all DLMM pool accounts...');

    // Get all program accounts
    const accounts = await connection.getProgramAccounts(programId, {
      filters: [
        {
          dataSize: 904, // LbPair account size
        },
      ],
    });

    console.log(`Found ${accounts.length} DLMM pool accounts`);
    console.log('');

    // Check each account to see if it's a SOL/USDC pool
    const solUsdcPools = [];

    console.log('Checking for SOL/USDC pools...');

    for (const account of accounts) {
      try {
        const dlmmPool = await DLMM.create(connection, account.pubkey);

        const tokenXMint = dlmmPool.lbPair.tokenXMint.toBase58();
        const tokenYMint = dlmmPool.lbPair.tokenYMint.toBase58();

        // Check if this is a SOL/USDC pool (in either order)
        const isSolUsdcPool =
          (tokenXMint === SOL_MINT && tokenYMint === USDC_MINT) ||
          (tokenXMint === USDC_MINT && tokenYMint === SOL_MINT);

        if (isSolUsdcPool) {
          const activeBin = await dlmmPool.getActiveBin();

          solUsdcPools.push({
            address: account.pubkey.toBase58(),
            tokenX: tokenXMint,
            tokenY: tokenYMint,
            binStep: dlmmPool.lbPair.binStep,
            activeId: dlmmPool.lbPair.activeId,
            price: parseFloat(activeBin.price),
            reserveX: dlmmPool.lbPair.reserveX.toBase58(),
            reserveY: dlmmPool.lbPair.reserveY.toBase58(),
          });

          console.log(`  ✓ Found pool: ${account.pubkey.toBase58()}`);
        }
      } catch (error) {
        // Skip invalid accounts
        continue;
      }
    }

    console.log('');
    console.log('='.repeat(80));
    console.log('SOL/USDC DLMM POOLS ON MAINNET');
    console.log('='.repeat(80));
    console.log('');

    if (solUsdcPools.length === 0) {
      console.log('❌ No SOL/USDC pools found');
      return;
    }

    solUsdcPools.forEach((pool, idx) => {
      console.log(`${idx + 1}. Pool Address: ${pool.address}`);
      console.log(`   Bin Step: ${pool.binStep} (${(pool.binStep / 100).toFixed(2)}% per bin)`);
      console.log(`   Active Bin ID: ${pool.activeId}`);
      console.log(`   Price: ${pool.price.toFixed(6)}`);
      console.log(`   Token X: ${pool.tokenX}`);
      console.log(`   Token Y: ${pool.tokenY}`);
      console.log(`   Reserve X: ${pool.reserveX}`);
      console.log(`   Reserve Y: ${pool.reserveY}`);
      console.log('');
    });

    console.log('='.repeat(80));
    console.log('');
    console.log('💡 Recommendation:');
    console.log('');
    console.log('Choose a pool based on your strategy:');
    console.log('- Smaller bin step (1-10) = tighter price ranges, more capital efficient, more rebalancing');
    console.log('- Larger bin step (25-100) = wider price ranges, less capital efficient, less rebalancing');
    console.log('');
    console.log('For a ±1% range, pools with bin step 1-10 work best.');
    console.log('');

    if (solUsdcPools.length > 0) {
      const recommended = solUsdcPools.sort((a, b) => a.binStep - b.binStep)[0];
      console.log(`Recommended pool (smallest bin step): ${recommended.address}`);
      console.log(`  Bin Step: ${recommended.binStep}`);
      console.log('');
      console.log('Update .env.mainnet:');
      console.log(`  METEORA_POOL_ADDRESS=${recommended.address}`);
    }

  } catch (error) {
    console.error('❌ Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

findSolUsdcPools()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
