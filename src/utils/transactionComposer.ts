/**
 * Transaction Composer Utility
 *
 * Modern Solana transaction composition for combining multiple operations
 * (swap + position creation) into a single atomic transaction.
 *
 * Uses VersionedTransaction with functional composition patterns for
 * building complex multi-instruction transactions.
 */

import {
  Connection,
  Transaction,
  VersionedTransaction,
  TransactionMessage,
  TransactionInstruction,
  PublicKey,
  AddressLookupTableAccount,
  Keypair,
} from '@solana/web3.js';
import { log } from './logger.js';
import type { SwapInstructionsResult } from '../modules/jupiterSwapper.js';

export interface ComposedTransactionResult {
  transaction: VersionedTransaction;
  addressLookupTables: AddressLookupTableAccount[];
  additionalSigners: Keypair[];
  blockhash: string;
  lastValidBlockHeight: number;
}

/**
 * Deserialize Jupiter swap instructions into TransactionInstruction objects
 */
function deserializeSwapInstructions(
  swapInstructions: SwapInstructionsResult
): TransactionInstruction[] {
  const instructions: TransactionInstruction[] = [];

  // Setup instructions (token account creation, etc.)
  if (swapInstructions.setupInstructions && swapInstructions.setupInstructions.length > 0) {
    for (const setupIx of swapInstructions.setupInstructions) {
      instructions.push(
        new TransactionInstruction({
          programId: new PublicKey(setupIx.programId),
          keys: setupIx.accounts.map((acc: any) => ({
            pubkey: new PublicKey(acc.pubkey),
            isSigner: acc.isSigner,
            isWritable: acc.isWritable,
          })),
          data: Buffer.from(setupIx.data, 'base64'),
        })
      );
    }
  }

  // Main swap instruction
  const swapIx = swapInstructions.swapInstruction;
  instructions.push(
    new TransactionInstruction({
      programId: new PublicKey(swapIx.programId),
      keys: swapIx.accounts.map((acc: any) => ({
        pubkey: new PublicKey(acc.pubkey),
        isSigner: acc.isSigner,
        isWritable: acc.isWritable,
      })),
      data: Buffer.from(swapIx.data, 'base64'),
    })
  );

  // Cleanup instruction (token account closure, etc.)
  if (swapInstructions.cleanupInstruction) {
    const cleanupIx = swapInstructions.cleanupInstruction;
    instructions.push(
      new TransactionInstruction({
        programId: new PublicKey(cleanupIx.programId),
        keys: cleanupIx.accounts.map((acc: any) => ({
          pubkey: new PublicKey(acc.pubkey),
          isSigner: acc.isSigner,
          isWritable: acc.isWritable,
        })),
        data: Buffer.from(cleanupIx.data, 'base64'),
      })
    );
  }

  return instructions;
}

/**
 * Fetch address lookup table accounts from the network
 */
async function fetchLookupTables(
  connection: Connection,
  addresses: string[]
): Promise<AddressLookupTableAccount[]> {
  if (!addresses || addresses.length === 0) {
    return [];
  }

  const lookupTables: AddressLookupTableAccount[] = [];

  for (const address of addresses) {
    try {
      const lookupTableAccount = await connection.getAddressLookupTable(
        new PublicKey(address)
      );
      if (lookupTableAccount.value) {
        lookupTables.push(lookupTableAccount.value);
      }
    } catch (error) {
      log.warn('Failed to fetch lookup table', {
        address,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return lookupTables;
}

/**
 * Compose swap instructions with Meteora position creation into a single atomic transaction
 *
 * This function implements functional composition for building complex transactions:
 * 1. Deserialize Jupiter swap instructions from API response
 * 2. Extract Meteora position creation instructions
 * 3. Combine all instructions in proper order
 * 4. Build VersionedTransaction with address lookup tables
 *
 * Instruction ordering is critical:
 * - Swap setup → Swap → Swap cleanup
 * - Position initialization → Add liquidity
 *
 * All operations succeed atomically or all fail.
 *
 * @param connection - Solana RPC connection
 * @param payer - Wallet keypair (transaction fee payer and signer)
 * @param swapInstructions - Jupiter swap instructions from getSwapInstructions()
 * @param positionTransaction - Meteora position creation transaction
 * @param positionKeypair - Position keypair (additional signer)
 * @returns Composed VersionedTransaction ready to sign and send
 */
export async function composeSwapAndCreatePosition(
  connection: Connection,
  payer: Keypair,
  swapInstructions: SwapInstructionsResult,
  positionTransaction: Transaction,
  positionKeypair: Keypair
): Promise<ComposedTransactionResult> {
  log.info('🔧 Composing atomic swap + position creation transaction');

  try {
    // Step 1: Deserialize Jupiter swap instructions
    const swapIxs = deserializeSwapInstructions(swapInstructions);
    log.info(`✅ Deserialized ${swapIxs.length} swap instructions`);

    // Step 2: Extract Meteora position creation instructions
    const positionIxs = positionTransaction.instructions;
    log.info(`✅ Extracted ${positionIxs.length} position instructions`);

    // Step 3: Combine all instructions in proper order
    // This follows a functional composition pattern where operations are chained
    const allInstructions: TransactionInstruction[] = [
      ...swapIxs,        // Setup → Swap → Cleanup
      ...positionIxs,    // Position init → Add liquidity
    ];

    log.info(`✅ Combined ${allInstructions.length} total instructions`, {
      breakdown: {
        swap: swapIxs.length,
        position: positionIxs.length,
      },
    });

    // Step 4: Fetch address lookup tables for transaction compression
    const lookupTables = await fetchLookupTables(
      connection,
      swapInstructions.addressLookupTableAddresses || []
    );

    if (lookupTables.length > 0) {
      log.info(`✅ Fetched ${lookupTables.length} address lookup tables`);
    }

    // Step 5: Get recent blockhash for transaction lifetime
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');

    // Step 6: Build versioned transaction message (v0 format)
    // This is the modern approach for composing multiple operations
    const messageV0 = new TransactionMessage({
      payerKey: payer.publicKey,
      recentBlockhash: blockhash,
      instructions: allInstructions,
    }).compileToV0Message(lookupTables);

    // Step 7: Create versioned transaction
    const versionedTx = new VersionedTransaction(messageV0);

    log.info('✅ Composed atomic transaction', {
      totalInstructions: allInstructions.length,
      swapInstructions: swapIxs.length,
      positionInstructions: positionIxs.length,
      lookupTables: lookupTables.length,
      additionalSigners: 1,
      blockhash: blockhash.slice(0, 8) + '...',
      lastValidBlockHeight,
    });

    return {
      transaction: versionedTx,
      addressLookupTables: lookupTables,
      additionalSigners: [positionKeypair],
      blockhash,
      lastValidBlockHeight,
    };
  } catch (error) {
    log.error('❌ Failed to compose transaction', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    throw error;
  }
}

/**
 * Sign and send a composed versioned transaction
 *
 * @param connection - Solana RPC connection
 * @param transaction - Composed versioned transaction
 * @param signers - All required signers [wallet, positionKeypair]
 * @param blockhash - Blockhash used when building the transaction
 * @param lastValidBlockHeight - Last valid block height for the transaction
 * @returns Transaction signature on success
 */
export async function signAndSendComposedTransaction(
  connection: Connection,
  transaction: VersionedTransaction,
  signers: Keypair[],
  blockhash: string,
  lastValidBlockHeight: number
): Promise<string> {
  log.info('📤 Signing and sending composed transaction', {
    signerCount: signers.length,
    blockhash: blockhash.slice(0, 8) + '...',
    lastValidBlockHeight,
  });

  try {
    // Sign with all required signers
    transaction.sign(signers);

    log.info('✅ Transaction signed');

    // Send transaction
    const signature = await connection.sendRawTransaction(transaction.serialize(), {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
      maxRetries: 3,
    });

    log.info('✅ Transaction sent', { signature });

    // Wait for confirmation using the CORRECT blockhash from composition time
    const confirmation = await connection.confirmTransaction({
      signature,
      blockhash,
      lastValidBlockHeight,
    }, 'confirmed');

    if (confirmation.value.err) {
      throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
    }

    log.info('✅ Transaction confirmed', {
      signature,
      solscan: `https://solscan.io/tx/${signature}`,
    });

    return signature;
  } catch (error) {
    log.error('❌ Failed to send composed transaction', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    throw error;
  }
}
