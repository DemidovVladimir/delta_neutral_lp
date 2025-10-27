/**
 * Transfer USDC from the cloned whale account to our test wallet
 *
 * Prerequisites:
 * - Localnet running with whale account cloned
 * - Run: npm run localnet:start
 *
 * Usage: NODE_ENV=local npx tsx scripts/transfer-usdc-from-whale.ts [amount]
 */

import { Connection, PublicKey, Transaction, Keypair } from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  getAssociatedTokenAddress,
  getAccount,
} from '@solana/spl-token';
import { getConnection, getWalletKeypair, initializeAgentKit } from '../core/agentKit.js';
import { log } from '../utils/logger.js';

const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const WHALE_TOKEN_ACCOUNT = new PublicKey('GJcYN2khvAaq8KM2TqAw3HZcdQwvChmvPcUh8SUpump7');

// Get amount from command line or default to 200 USDC
const amountUsdc = process.argv[2] ? parseFloat(process.argv[2]) : 200;

async function transferUsdcFromWhale() {
  console.log('💸 Transferring USDC from whale account...\n');

  try {
    await initializeAgentKit();
    const connection = getConnection();
    const wallet = getWalletKeypair();

    console.log('Target wallet:', wallet.publicKey.toBase58());
    console.log('Amount to transfer:', amountUsdc, 'USDC');
    console.log('');

    // Get or create ATA for our wallet
    const userUsdc = await getAssociatedTokenAddress(
      USDC_MINT,
      wallet.publicKey,
      false,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    console.log('User USDC account:', userUsdc.toBase58());

    // Check if ATA exists
    let ataExists = false;
    try {
      await getAccount(connection, userUsdc, 'confirmed', TOKEN_PROGRAM_ID);
      ataExists = true;
      console.log('✓ USDC account already exists');
    } catch (error) {
      console.log('✓ Will create USDC account');
    }

    const transaction = new Transaction();

    // Add create ATA instruction if needed
    if (!ataExists) {
      transaction.add(
        createAssociatedTokenAccountInstruction(
          wallet.publicKey,
          userUsdc,
          wallet.publicKey,
          USDC_MINT,
          TOKEN_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID
        )
      );
    }

    // Add transfer instruction
    const amount = Math.floor(amountUsdc * 1_000_000); // USDC has 6 decimals
    transaction.add(
      createTransferInstruction(
        WHALE_TOKEN_ACCOUNT,
        userUsdc,
        wallet.publicKey, // We control the whale account on localnet!
        amount,
        [],
        TOKEN_PROGRAM_ID
      )
    );

    console.log('');
    console.log('Sending transaction...');

    const signature = await connection.sendTransaction(transaction, [wallet], {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
    });

    await connection.confirmTransaction(signature, 'confirmed');

    console.log('✅ Transfer successful!');
    console.log('Signature:', signature);
    console.log('');

    // Check new balance
    const accountInfo = await getAccount(connection, userUsdc, 'confirmed', TOKEN_PROGRAM_ID);
    const balance = Number(accountInfo.amount) / 1_000_000;

    console.log('New USDC balance:', balance, 'USDC');

  } catch (error) {
    console.error('❌ Error:', error instanceof Error ? error.message : error);
    console.error('');
    console.error('Note: Make sure the whale account is cloned in localnet.');
    console.error('Restart localnet with: npm run localnet:stop && npm run localnet:start');
    process.exit(1);
  }
}

transferUsdcFromWhale()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
