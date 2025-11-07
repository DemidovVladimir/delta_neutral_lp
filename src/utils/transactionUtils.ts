/**
 * Transaction Utilities
 *
 * Helper functions for working with Solana transactions, including fee calculation
 * and transaction analysis.
 */

import { Connection, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { log } from './logger.js';

/**
 * Fetch transaction details and calculate fees
 *
 * @param connection - Solana connection
 * @param signature - Transaction signature
 * @returns Transaction fee details
 */
export async function getTransactionFees(
  connection: Connection,
  signature: string
): Promise<{
  feeLamports: number;
  feeSol: number;
  computeUnitsConsumed: number | null;
}> {
  try {
    // Fetch transaction details
    const txDetails = await connection.getTransaction(signature, {
      maxSupportedTransactionVersion: 0,
      commitment: 'confirmed',
    });

    if (!txDetails) {
      log.warn('Transaction details not found', { signature });
      return {
        feeLamports: 0,
        feeSol: 0,
        computeUnitsConsumed: null,
      };
    }

    // Get fee from transaction metadata
    const feeLamports = txDetails.meta?.fee || 0;
    const feeSol = feeLamports / LAMPORTS_PER_SOL;

    // Extract compute units from log messages
    let computeUnitsConsumed: number | null = null;
    if (txDetails.meta?.logMessages) {
      for (const log of txDetails.meta.logMessages) {
        // Look for compute unit consumption in logs
        // Example: "Program consumed 123456 of 200000 compute units"
        const match = log.match(/consumed (\d+) of \d+ compute units/);
        if (match) {
          computeUnitsConsumed = parseInt(match[1]);
          break;
        }
      }
    }

    return {
      feeLamports,
      feeSol,
      computeUnitsConsumed,
    };
  } catch (error) {
    log.error('Failed to fetch transaction fees', {
      error: error instanceof Error ? error.message : String(error),
      signature,
    });
    return {
      feeLamports: 0,
      feeSol: 0,
      computeUnitsConsumed: null,
    };
  }
}

/**
 * Log transaction fee details in a formatted way
 *
 * @param signature - Transaction signature
 * @param feeDetails - Fee details from getTransactionFees
 * @param operationType - Type of operation (e.g., "Position Creation", "Fee Claim")
 */
export function logTransactionFees(
  signature: string,
  feeDetails: {
    feeLamports: number;
    feeSol: number;
    computeUnitsConsumed: number | null;
  },
  operationType: string
): void {
  const feeUsd = feeDetails.feeSol * 163; // Approximate SOL price, could be fetched dynamically

  log.info(`💰 Transaction fees - ${operationType}`, {
    signature,
    feeLamports: feeDetails.feeLamports,
    feeSol: feeDetails.feeSol.toFixed(6),
    feeUsd: feeUsd.toFixed(4),
    computeUnitsConsumed: feeDetails.computeUnitsConsumed,
    solscan: `https://solscan.io/tx/${signature}`,
  });
}

/**
 * Batch calculate fees for multiple transactions
 *
 * @param connection - Solana connection
 * @param signatures - Array of transaction signatures
 * @returns Total fees and breakdown
 */
export async function getBatchTransactionFees(
  connection: Connection,
  signatures: string[]
): Promise<{
  totalFeeLamports: number;
  totalFeeSol: number;
  totalComputeUnits: number;
  breakdown: Array<{
    signature: string;
    feeLamports: number;
    feeSol: number;
    computeUnitsConsumed: number | null;
  }>;
}> {
  let totalFeeLamports = 0;
  let totalComputeUnits = 0;
  const breakdown = [];

  for (const signature of signatures) {
    const fees = await getTransactionFees(connection, signature);
    totalFeeLamports += fees.feeLamports;
    if (fees.computeUnitsConsumed) {
      totalComputeUnits += fees.computeUnitsConsumed;
    }
    breakdown.push({
      signature,
      ...fees,
    });
  }

  return {
    totalFeeLamports,
    totalFeeSol: totalFeeLamports / LAMPORTS_PER_SOL,
    totalComputeUnits,
    breakdown,
  };
}
