/**
 * Jito Bundle Utilities
 *
 * Helper functions for working with Jito bundles:
 * - Dynamic tip escalation based on retry attempts
 * - Bundle submission to Jito block engine
 * - Transaction packaging
 */

import { PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js';
import { log } from './logger.js';

// Jito tip account (mainnet)
const JITO_TIP_ACCOUNT = new PublicKey('ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49');

// Jito block engine endpoint
const JITO_BLOCK_ENGINE_URL = 'https://mainnet.block-engine.jito.wtf/api/v1/transactions';

/**
 * Create Jito tip instruction with dynamic escalation
 *
 * Tip amounts escalate based on retry attempts:
 * - 1st attempt: 4,000 lamports (~$0.0008)
 * - 2nd-3rd attempts: 6,000 lamports (~$0.0012)
 * - 4+ attempts: 8,000 lamports (~$0.0016)
 *
 * @param fromPubkey - Wallet paying the tip
 * @param attempt - Retry attempt number (0-indexed)
 * @returns Jito tip instruction
 */
export function createJitoTipInstruction(
  fromPubkey: PublicKey,
  attempt: number = 0
): TransactionInstruction {
  let tipAmountLamports: number;

  if (attempt < 1) {
    tipAmountLamports = 4000;
  } else if (attempt < 3) {
    tipAmountLamports = 6000;
  } else {
    tipAmountLamports = 8000;
  }

  log.debug('Creating Jito tip instruction', {
    attempt,
    tipLamports: tipAmountLamports,
    tipSol: tipAmountLamports / 1e9,
  });

  return SystemProgram.transfer({
    fromPubkey,
    toPubkey: JITO_TIP_ACCOUNT,
    lamports: tipAmountLamports,
  });
}

/**
 * Send transaction to Jito block engine
 *
 * @param serializedTx - Base58-encoded serialized transaction
 * @param bundleOnly - Only submit via bundle (default: true)
 * @returns Transaction signature
 */
export async function sendJitoTransaction(
  serializedTx: string,
  bundleOnly: boolean = true
): Promise<string> {
  try {
    const endpoint = bundleOnly
      ? `${JITO_BLOCK_ENGINE_URL}?bundleOnly=true`
      : JITO_BLOCK_ENGINE_URL;

    log.debug('Sending transaction to Jito', {
      endpoint,
      bundleOnly,
      txLength: serializedTx.length,
    });

    const payload = {
      jsonrpc: '2.0',
      id: 1,
      method: 'sendTransaction',
      params: [serializedTx],
    };

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`Jito API returned ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();

    if (data.error) {
      throw new Error(`Jito error: ${JSON.stringify(data.error)}`);
    }

    const signature = data.result;

    if (!signature) {
      throw new Error('No signature in Jito response');
    }

    log.info('Jito transaction sent successfully', {
      signature,
      bundleOnly,
    });

    return signature;
  } catch (error) {
    log.error('Failed to send Jito transaction', {
      error: error instanceof Error ? error.message : String(error),
      bundleOnly,
    });
    throw error;
  }
}

/**
 * Calculate recommended tip amount based on network conditions
 *
 * @param baseTip - Base tip amount in lamports
 * @param priorityMultiplier - Multiplier for urgent transactions (1.0 = normal, 2.0 = urgent)
 * @returns Recommended tip in lamports
 */
export function calculateRecommendedTip(
  baseTip: number = 4000,
  priorityMultiplier: number = 1.0
): number {
  const recommendedTip = Math.floor(baseTip * priorityMultiplier);

  log.debug('Calculated recommended tip', {
    baseTip,
    priorityMultiplier,
    recommendedTip,
  });

  return recommendedTip;
}
