/**
 * Check mainnet wallet balances
 */

import { config } from 'dotenv';
config({ path: '.env.mainnet' });

import { initializeAgentKit, getWalletKeypair, getConnection } from '../src/core/agentKit.js';
import { LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddress, getAccount } from '@solana/spl-token';

const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');

async function checkBalances() {
  await initializeAgentKit();
  const wallet = getWalletKeypair();
  const connection = getConnection();

  console.log('Wallet:', wallet.publicKey.toBase58());
  console.log('');

  // Check SOL
  const solBalance = await connection.getBalance(wallet.publicKey);
  const sol = solBalance / LAMPORTS_PER_SOL;
  console.log('SOL balance:', sol);

  // Check USDC
  try {
    const usdcAta = await getAssociatedTokenAddress(USDC_MINT, wallet.publicKey, false, TOKEN_PROGRAM_ID);
    const usdcAccount = await getAccount(connection, usdcAta, 'confirmed', TOKEN_PROGRAM_ID);
    const usdc = Number(usdcAccount.amount) / 1_000_000;
    console.log('USDC balance:', usdc);
    console.log('USDC account:', usdcAta.toBase58());
  } catch (error) {
    console.log('USDC balance: 0 (no account or error)');
  }

  console.log('');
  console.log('Required for test:');
  console.log('- SOL: 0.2+ (0.1 deposit + 0.1 fees)');
  console.log('- USDC: 10');
  console.log('');

  const hasEnough = sol >= 0.2;
  if (hasEnough) {
    console.log('✅ Sufficient SOL balance');
  } else {
    console.log('❌ Insufficient SOL. Need at least 0.2 SOL');
  }
}

checkBalances()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Error:', error);
    process.exit(1);
  });
