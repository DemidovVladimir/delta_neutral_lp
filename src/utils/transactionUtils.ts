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

/**
 * Track transaction fee and save to state
 * This is a convenience wrapper that fetches fees and saves to persistence layer
 *
 * @param connection - Solana connection
 * @param signature - Transaction signature
 * @param operation - Operation type (e.g., "createPosition", "withdraw", "claim", "swap")
 * @param solPrice - Current SOL price in USD (for USD conversion)
 */
export async function trackTransactionFee(
  connection: Connection,
  signature: string,
  operation: string,
  solPrice: number
): Promise<void> {
  try {
    // Fetch transaction fees
    const feeDetails = await getTransactionFees(connection, signature);

    if (feeDetails.feeSol === 0) {
      log.warn('Transaction fee not found or is zero', { signature, operation });
      return;
    }

    const feeUsd = feeDetails.feeSol * solPrice;

    // Import persistence module dynamically to avoid circular dependencies
    const { addTransactionFee } = await import('../modules/persistence.js');

    // Save to state
    addTransactionFee(signature, feeDetails.feeSol, feeUsd, operation);

    // Log the fee
    log.info(`💰 ${operation} fee tracked`, {
      signature: signature.slice(0, 8) + '...',
      feeSol: feeDetails.feeSol.toFixed(6),
      feeUsd: feeUsd.toFixed(4),
      computeUnits: feeDetails.computeUnitsConsumed || 'N/A',
    });
  } catch (error) {
    log.error('Failed to track transaction fee', {
      error: error instanceof Error ? error.message : String(error),
      signature,
      operation,
    });
    // Don't throw - fee tracking is not critical
  }
}

/**
 * Track multiple transaction fees and save to state
 *
 * @param connection - Solana connection
 * @param signatures - Array of transaction signatures
 * @param operation - Operation type (e.g., "rebalance", "batchClaim")
 * @param solPrice - Current SOL price in USD
 */
export async function trackBatchTransactionFees(
  connection: Connection,
  signatures: string[],
  operation: string,
  solPrice: number
): Promise<void> {
  try {
    const batchFees = await getBatchTransactionFees(connection, signatures);

    if (batchFees.totalFeeSol === 0) {
      log.warn('No transaction fees found for batch', { signatures, operation });
      return;
    }

    const totalFeeUsd = batchFees.totalFeeSol * solPrice;

    // Import persistence module dynamically to avoid circular dependencies
    const { addTransactionFee } = await import('../modules/persistence.js');

    // Save to state (aggregate multiple signatures under one operation)
    for (const detail of batchFees.breakdown) {
      const feeUsd = detail.feeSol * solPrice;
      addTransactionFee(detail.signature, detail.feeSol, feeUsd, operation);
    }

    // Log summary
    log.info(`💰 ${operation} batch fees tracked`, {
      transactionCount: signatures.length,
      totalFeeSol: batchFees.totalFeeSol.toFixed(6),
      totalFeeUsd: totalFeeUsd.toFixed(4),
      totalComputeUnits: batchFees.totalComputeUnits,
    });
  } catch (error) {
    log.error('Failed to track batch transaction fees', {
      error: error instanceof Error ? error.message : String(error),
      signatures,
      operation,
    });
    // Don't throw - fee tracking is not critical
  }
}
