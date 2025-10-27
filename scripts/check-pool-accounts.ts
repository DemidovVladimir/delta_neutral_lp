/**
 * Check what accounts a Meteora pool references
 */

import { Connection, PublicKey } from '@solana/web3.js';
import DLMMModule from '@meteora-ag/dlmm';

// Handle ESM/CommonJS interop
// @ts-ignore
const DLMM: any = DLMMModule.default || DLMMModule;

const MAINNET_RPC = 'https://api.mainnet-beta.solana.com';
const POOL_ADDRESS = '5rCf1DM8LjKTw4YqhnoLcngyZYeNnQqztScTogYHAS6';

async function checkPoolAccounts() {
  console.log('🔍 Checking Meteora pool accounts on mainnet...\n');

  const connection = new Connection(MAINNET_RPC, 'confirmed');
  const poolPubkey = new PublicKey(POOL_ADDRESS);

  try {
    // Load pool from mainnet
    const dlmmPool = await DLMM.create(connection, poolPubkey);

    console.log('✅ Pool loaded successfully!\n');
    console.log('Pool Details:');
    console.log('='.repeat(80));
    console.log('Pool Address:', POOL_ADDRESS);
    console.log('Token X Mint:', dlmmPool.lbPair.tokenXMint.toBase58());
    console.log('Token Y Mint:', dlmmPool.lbPair.tokenYMint.toBase58());
    console.log('Reserve X:', dlmmPool.lbPair.reserveX.toBase58());
    console.log('Reserve Y:', dlmmPool.lbPair.reserveY.toBase58());
    console.log('Oracle:', dlmmPool.lbPair.oracle.toBase58());
    console.log('Active Bin:', dlmmPool.lbPair.activeId);
    console.log('Bin Step:', dlmmPool.lbPair.binStep);
    console.log('='.repeat(80));

    console.log('\n📝 Accounts to clone for localnet:\n');
    console.log(`--clone ${POOL_ADDRESS} \\  # Pool`);
    console.log(`--clone ${dlmmPool.lbPair.tokenXMint.toBase58()} \\  # Token X Mint`);
    console.log(`--clone ${dlmmPool.lbPair.tokenYMint.toBase58()} \\  # Token Y Mint`);
    console.log(`--clone ${dlmmPool.lbPair.reserveX.toBase58()} \\  # Reserve X`);
    console.log(`--clone ${dlmmPool.lbPair.reserveY.toBase58()} \\  # Reserve Y`);
    console.log(`--clone ${dlmmPool.lbPair.oracle.toBase58()} \\  # Oracle`);
    console.log(`--clone LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo  # DLMM Program`);

  } catch (error) {
    console.error('❌ Error loading pool:', error instanceof Error ? error.message : error);
    console.error('\nFull error:', error);
  }
}

checkPoolAccounts()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
