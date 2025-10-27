/**
 * Find Meteora DLMM pools on devnet
 *
 * This script provides instructions for finding or creating Meteora DLMM pools on devnet
 *
 * Usage: pnpm tsx scripts/find-devnet-pools.ts
 */

import { Connection, PublicKey } from '@solana/web3.js';

const DEVNET_RPC = 'https://api.devnet.solana.com';
const METEORA_DLMM_PROGRAM_ID = 'LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo';

async function findPools() {
  console.log('🔍 Finding Meteora DLMM pools on devnet...');
  console.log('');

  const connection = new Connection(DEVNET_RPC, 'confirmed');

  try {
    // Check if we can connect to devnet
    const version = await connection.getVersion();
    console.log(`✅ Connected to devnet (version: ${version['solana-core']})`);
    console.log(`   RPC: ${DEVNET_RPC}`);
    console.log(`   DLMM Program: ${METEORA_DLMM_PROGRAM_ID}`);
    console.log('');

    // Try to get program accounts count
    const programId = new PublicKey(METEORA_DLMM_PROGRAM_ID);
    console.log('Checking for DLMM pools on devnet...');

    const accounts = await connection.getProgramAccounts(programId, {
      dataSlice: { offset: 0, length: 0 }, // Just count, don't fetch data
    });

    console.log(`Found ${accounts.length} total DLMM accounts on devnet`);
    console.log('');

    if (accounts.length === 0) {
      console.log('⚠️  No DLMM pools found on devnet.');
      console.log('');
      console.log('Devnet pools may be limited or non-existent.');
      console.log('');
    } else {
      console.log('📋 Pool addresses found:');
      console.log('='.repeat(80));

      // Show first 10 account addresses
      for (let i = 0; i < Math.min(accounts.length, 10); i++) {
        console.log(`${i + 1}. ${accounts[i].pubkey.toBase58()}`);
      }

      if (accounts.length > 10) {
        console.log(`... and ${accounts.length - 10} more accounts`);
      }

      console.log('');
      console.log('⚠️  Note: These are raw program accounts. To find actual pool addresses,');
      console.log('          use the Meteora UI or create a test pool.');
      console.log('');
    }

    console.log('='.repeat(80));
    console.log('📝 RECOMMENDED APPROACH');
    console.log('='.repeat(80));
    console.log('');
    console.log('Option 1: Create Your Own Test Pool (Recommended)');
    console.log('--------------------------------------------------');
    console.log('1. Visit: https://devnet.meteora.ag/');
    console.log('2. Connect your devnet wallet');
    console.log('3. Click "Create Pool" or "Launch Pool"');
    console.log('4. Create a SOL/USDC DLMM pool');
    console.log('5. Copy the pool address from the URL or pool details');
    console.log('6. Add to .env.devnet: METEORA_POOL_ADDRESS=<your_pool_address>');
    console.log('');

    console.log('Option 2: Use Mainnet-Fork for Testing');
    console.log('---------------------------------------');
    console.log('If devnet pools are unavailable, consider using a local validator');
    console.log('with mainnet-fork to test against real mainnet pools:');
    console.log('');
    console.log('   solana-test-validator --clone <mainnet-pool-address> \\');
    console.log('                         --url https://api.mainnet-beta.solana.com');
    console.log('');

    console.log('Option 3: Known Mainnet Pools (for reference)');
    console.log('----------------------------------------------');
    console.log('SOL-USDC DLMM Pool (mainnet):');
    console.log('   5rCf1DM8LjKTw4YqhnoLcngyZYeNnQqztScTogYHAS6');
    console.log('');
    console.log('⚠️  Do NOT use mainnet pools with devnet RPC!');
    console.log('');

    console.log('='.repeat(80));
    console.log('');
    console.log('After getting a pool address, update your .env.devnet:');
    console.log('   METEORA_POOL_ADDRESS=<pool_address_here>');
    console.log('');
    console.log('Then run: pnpm run test:devnet');
    console.log('');

  } catch (error) {
    console.error('❌ Error connecting to devnet:', error instanceof Error ? error.message : error);
    console.log('');
    console.log('This might happen because:');
    console.log('1. Devnet RPC is down or rate limiting');
    console.log('2. Network connectivity issues');
    console.log('');
    console.log('Try visiting https://devnet.meteora.ag/ directly in your browser');
  }
}

// Run the script
findPools()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
