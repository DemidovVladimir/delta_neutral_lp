/**
 * Find a USDC whale account on mainnet to clone
 */

import { Connection, PublicKey } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';

const MAINNET_RPC = 'https://api.mainnet-beta.solana.com';
const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');

async function findUsdcWhale() {
  console.log('🔍 Finding USDC whale accounts on mainnet...\n');

  const connection = new Connection(MAINNET_RPC, 'confirmed');

  try {
    // Get largest token accounts for USDC
    const largestAccounts = await connection.getTokenLargestAccounts(USDC_MINT);

    console.log('Top 5 USDC holders:\n');

    for (let i = 0; i < Math.min(5, largestAccounts.value.length); i++) {
      const account = largestAccounts.value[i];
      const balance = Number(account.amount) / 1_000_000; // USDC has 6 decimals

      console.log(`${i + 1}. Address: ${account.address.toBase58()}`);
      console.log(`   Balance: ${balance.toLocaleString()} USDC`);
      console.log('');
    }

    if (largestAccounts.value.length > 0) {
      const whaleAccount = largestAccounts.value[0];
      console.log('Recommended whale account to clone:');
      console.log(whaleAccount.address.toBase58());
      console.log('');
      console.log('Add this to start-localnet-mainnet-fork.sh:');
      console.log(`--clone ${whaleAccount.address.toBase58()} \\  # USDC whale account`);
    }

  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

findUsdcWhale()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
