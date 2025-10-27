/**
 * Swap SOL for USDC on localnet using Jupiter
 *
 * This script swaps SOL for USDC so we can create balanced LP positions.
 * Works on mainnet-forked localnet where USDC mint exists but we can't mint directly.
 *
 * Usage: NODE_ENV=local npx tsx scripts/swap-sol-for-usdc.ts [amount_in_sol]
 */

import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { getConnection, getWalletKeypair, initializeAgentKit } from '../core/agentKit.js';
import { log } from '../utils/logger.js';

const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const SOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');

// Get amount from command line or default to 1 SOL
const amountInSol = process.argv[2] ? parseFloat(process.argv[2]) : 1;

async function swapSolForUsdc() {
  console.log('🔄 Swapping SOL for USDC on localnet...\n');

  try {
    await initializeAgentKit();
    const connection = getConnection();
    const wallet = getWalletKeypair();

    console.log('Wallet:', wallet.publicKey.toBase58());
    console.log('Amount to swap:', amountInSol, 'SOL');
    console.log('');

    // Check SOL balance
    const balance = await connection.getBalance(wallet.publicKey);
    const balanceSol = balance / LAMPORTS_PER_SOL;
    console.log('Current SOL balance:', balanceSol);

    if (balanceSol < amountInSol) {
      throw new Error(`Insufficient SOL. Have: ${balanceSol}, Need: ${amountInSol}`);
    }

    console.log('');
    console.log('⚠️  Note: Jupiter swap requires mainnet RPC and may not work on localnet.');
    console.log('');
    console.log('Alternative approach for localnet:');
    console.log('1. Use a whale USDC account clone from mainnet');
    console.log('2. Or use single-sided SOL deposits (which is what we currently do)');
    console.log('');
    console.log('For a balanced position on localnet, we need to:');
    console.log('- Clone a USDC whale account from mainnet');
    console.log('- Transfer USDC to our test wallet');
    console.log('');
    console.log('Command to clone whale account:');
    console.log('  solana-test-validator \\');
    console.log('    --clone-upgradeable-program LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo \\');
    console.log('    --clone 5rCf1DM8LjKTw4YqhnoLcngyZYeNnQqztScTogYHAS6 \\');
    console.log('    --clone <USDC_WHALE_TOKEN_ACCOUNT> \\  # Add a mainnet USDC whale');
    console.log('    --url https://api.mainnet-beta.solana.com');

  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

swapSolForUsdc()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
