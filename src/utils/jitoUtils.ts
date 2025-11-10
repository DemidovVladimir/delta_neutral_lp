/**
 * Jito Bundle Utilities
 *
 * Enhanced Jito integration with dynamic tip pricing based on real-time network conditions.
 *
 * Jito Overview:
 * - Jito is a block engine that provides MEV (Maximal Extractable Value) protection
 * - Allows submitting transaction bundles with guaranteed ordering
 * - Validators receive tips for including bundles in blocks
 * - Critical for atomic multi-transaction operations (emergency exits, arbitrage)
 *
 * Key Features:
 * - **Dynamic Tip Pricing**: Fetches real-time tip floors from Jito API
 * - **Priority Levels**: Low/Normal/High/Urgent/Critical based on percentiles
 * - **Retry Escalation**: Exponential tip increases on failed attempts
 * - **Cost-Aware Capping**: Prevents overpaying on large transactions
 * - **Bundle Submission**: Send ordered transaction bundles to Jito block engine
 * - **MEV Protection**: Prevents sandwich attacks and front-running
 *
 * Dynamic Tip Strategy:
 * - Uses Jito's bundle tips API for real-time floor prices
 * - Priority levels map to percentiles (p25/p50/p75/p95/p99)
 * - Exponential escalation on retries: 1.0x → 1.5x → 2.25x → 3.38x
 * - 5-second cache to prevent excessive API calls
 * - Fallback to static tips if API unavailable
 *
 * Priority Mapping:
 * - low: p25 (fee claims, non-urgent)
 * - normal: p50 (standard operations)
 * - high: p75 (rebalancing, user withdrawals)
 * - urgent: p95 (emergency operations)
 * - critical: p99 (must land immediately)
 *
 * Bundle Mechanics:
 * - Bundles guarantee transaction ordering within a block
 * - All transactions in bundle execute atomically or all fail
 * - Ideal for emergency flows: withdraw → claim → swap → hedge
 * - bundleOnly=true ensures tx only included if entire bundle succeeds
 *
 * Use Cases:
 * 1. Emergency exits (critical priority, must land immediately)
 * 2. Time-sensitive rebalancing (high priority, prevent front-running)
 * 3. Fee claims (low priority, can wait for cheap inclusion)
 * 4. Multi-step atomic operations requiring ordering guarantees
 *
 * @example
 * ```typescript
 * import { createEnhancedJitoTipInstruction, sendJitoTransaction } from './jitoUtils.js';
 *
 * // Emergency exit with critical priority
 * const tipIx = await createEnhancedJitoTipInstruction(wallet.publicKey, {
 *   priority: 'critical',
 *   attempt: 0,
 *   transactionValueUsd: 10000, // $10k exit
 *   maxTipBps: 50, // Max 0.5% of tx value
 * });
 *
 * transaction.add(tipIx);
 * const signature = await sendJitoTransaction(
 *   transaction.serialize().toString('base64'),
 *   true
 * );
 *
 * // Normal rebalancing with high priority
 * const rebalanceTip = await createEnhancedJitoTipInstruction(wallet.publicKey, {
 *   priority: 'high',
 *   attempt: 0,
 * });
 *
 * // Retry with exponential escalation
 * const retryTip = await createEnhancedJitoTipInstruction(wallet.publicKey, {
 *   priority: 'urgent',
 *   attempt: 2, // 2.25x multiplier
 * });
 * ```
 */

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction
} from '@solana/web3.js';
import { log } from './logger.js';

/**
 * Jito bundle tip percentiles from API
 * Represents distribution of tips that successfully landed
 */
export interface JitoBundleTips {
  p25: number;  // 25th percentile (low priority)
  p50: number;  // 50th percentile (median)
  p75: number;  // 75th percentile (high priority)
  p95: number;  // 95th percentile (urgent)
  p99: number;  // 99th percentile (critical)
}

/**
 * Configuration for creating a Jito tip instruction
 */
export interface JitoTipConfig {
  /** Priority level determines base tip amount */
  priority: 'low' | 'normal' | 'high' | 'urgent' | 'critical';
  /** Retry attempt number (0-indexed), used for exponential escalation */
  attempt?: number;
  /** Transaction value in USD for cost-aware capping (optional) */
  transactionValueUsd?: number;
  /** Maximum tip as basis points of transaction value (optional) */
  maxTipBps?: number;
}

/**
 * Cache for Jito bundle tips to reduce API calls
 */
interface TipCache {
  tips: JitoBundleTips;
  fetchedAt: number;
}

// Jito tip accounts (mainnet) - 8 static tip accounts for parallel bundle processing
// Pick randomly from these to reduce write-locking contention
// Source: https://jito-foundation.gitbook.io/mev/mev-payment-and-distribution/on-chain-addresses
const JITO_TIP_ACCOUNTS = [
  new PublicKey('96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5'),
  new PublicKey('HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe'),
  new PublicKey('Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY'),
  new PublicKey('ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49'),
  new PublicKey('DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh'),
  new PublicKey('ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt'),
  new PublicKey('DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL'),
  new PublicKey('3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT'),
];

// Legacy single tip account (deprecated, use JITO_TIP_ACCOUNTS instead)
const JITO_TIP_ACCOUNT = JITO_TIP_ACCOUNTS[3]; // ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49

// Jito block engine endpoint
const JITO_BLOCK_ENGINE_URL = 'https://mainnet.block-engine.jito.wtf/api/v1/transactions';

// Jito bundle tips API endpoint
const JITO_BUNDLE_TIPS_URL = 'https://bundles-api-rest.jito.wtf/api/v1/bundles/tip_floor';

// Tip cache with 5-second TTL
let tipCache: TipCache | null = null;
const TIP_CACHE_TTL_MS = 5000; // 5 seconds

// Fallback tips if API is unavailable (conservative but reasonable defaults)
// Based on real-world usage and Jito minimum of 1000 lamports
const FALLBACK_TIPS: JitoBundleTips = {
  p25: 1000,    // 1k lamports (Jito minimum, ~$0.0002 at $200/SOL)
  p50: 5000,    // 5k lamports (~$0.001 at $200/SOL)
  p75: 10000,   // 10k lamports (~$0.002 at $200/SOL)
  p95: 50000,   // 50k lamports (~$0.01 at $200/SOL)
  p99: 100000,  // 100k lamports (~$0.02 at $200/SOL)
};

// Minimum tip required by Jito
const MIN_TIP_LAMPORTS = 1000;

/**
 * Fetch current bundle tip floors from Jito API
 * Returns percentiles of tips that successfully landed
 *
 * @returns Bundle tip percentiles in lamports
 * @throws Error if API request fails
 */
async function fetchJitoBundleTips(): Promise<JitoBundleTips> {
  try {
    log.debug('Fetching Jito bundle tip floors', { url: JITO_BUNDLE_TIPS_URL });

    const response = await fetch(JITO_BUNDLE_TIPS_URL);

    if (!response.ok) {
      throw new Error(`Jito tips API returned ${response.status}`);
    }

    const data = await response.json();

    if (!Array.isArray(data) || data.length === 0) {
      throw new Error('Invalid response from Jito tips API');
    }

    const tipData = data[0];

    // Convert from SOL to lamports
    const tips: JitoBundleTips = {
      p25: Math.floor((tipData.landed_tips_25th_percentile || 0.000005) * 1e9),
      p50: Math.floor((tipData.landed_tips_50th_percentile || 0.00001) * 1e9),
      p75: Math.floor((tipData.landed_tips_75th_percentile || 0.000025) * 1e9),
      p95: Math.floor((tipData.landed_tips_95th_percentile || 0.0001) * 1e9),
      p99: Math.floor((tipData.landed_tips_99th_percentile || 0.00025) * 1e9),
    };

    log.debug('Fetched Jito bundle tips', {
      p25: `${tips.p25} lamports`,
      p50: `${tips.p50} lamports`,
      p75: `${tips.p75} lamports`,
      p95: `${tips.p95} lamports`,
      p99: `${tips.p99} lamports`,
    });

    return tips;
  } catch (error) {
    log.error('Failed to fetch Jito bundle tips', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Get cached bundle tips or fetch fresh data
 * Implements 5-second caching to reduce API calls
 * Falls back to static tips if API is unavailable
 *
 * @returns Bundle tip percentiles in lamports
 */
async function getCachedBundleTips(): Promise<JitoBundleTips> {
  const now = Date.now();

  // Return cached tips if still fresh
  if (tipCache && now - tipCache.fetchedAt < TIP_CACHE_TTL_MS) {
    log.debug('Using cached Jito tips', {
      age: now - tipCache.fetchedAt,
      maxAge: TIP_CACHE_TTL_MS,
    });
    return tipCache.tips;
  }

  // Fetch fresh tips
  try {
    const tips = await fetchJitoBundleTips();
    tipCache = { tips, fetchedAt: now };
    return tips;
  } catch (error) {
    log.warn('Using fallback Jito tips due to API failure', {
      error: error instanceof Error ? error.message : String(error),
      fallbackTips: FALLBACK_TIPS,
    });
    return FALLBACK_TIPS;
  }
}

/**
 * Select base tip amount based on priority level
 * Maps priority to percentile of landed tips
 *
 * @param tips - Bundle tip percentiles
 * @param priority - Priority level
 * @returns Base tip amount in lamports
 */
function selectBaseTip(tips: JitoBundleTips, priority: JitoTipConfig['priority']): number {
  switch (priority) {
    case 'low':
      return tips.p25;      // 25th percentile (cheapest)
    case 'normal':
      return tips.p50;      // 50th percentile (median)
    case 'high':
      return tips.p75;      // 75th percentile (high priority)
    case 'urgent':
      return tips.p95;      // 95th percentile (urgent)
    case 'critical':
      return tips.p99;      // 99th percentile (critical)
  }
}

/**
 * Calculate cost-aware tip cap
 * Prevents paying excessive tips on large transactions
 *
 * @param transactionValueUsd - Transaction value in USD
 * @param currentTip - Current calculated tip in lamports
 * @param maxTipBps - Maximum tip as basis points of tx value
 * @param solPriceUsd - Current SOL price (default: $200)
 * @returns Capped tip amount in lamports
 */
function calculateCostAwareTip(
  transactionValueUsd: number,
  currentTip: number,
  maxTipBps: number,
  solPriceUsd: number = 200
): number {
  // Calculate max tip in USD based on transaction value
  const maxTipUsd = transactionValueUsd * (maxTipBps / 10000);

  // Convert to lamports
  const maxTipLamports = Math.floor((maxTipUsd / solPriceUsd) * 1e9);

  // Return minimum of current tip and max allowed tip
  return Math.min(currentTip, maxTipLamports);
}

/**
 * Create enhanced Jito tip instruction with dynamic pricing
 *
 * Uses real-time tip data from Jito API to determine optimal tip amount.
 * Supports priority levels, retry escalation, and cost-aware capping.
 *
 * @param fromPubkey - Wallet paying the tip
 * @param config - Tip configuration (priority, attempt, tx value)
 * @returns Jito tip transfer instruction
 *
 * @example
 * ```typescript
 * // Emergency exit with critical priority
 * const tipIx = await createEnhancedJitoTipInstruction(wallet.publicKey, {
 *   priority: 'critical',
 *   attempt: 0,
 *   transactionValueUsd: 10000,
 *   maxTipBps: 50, // Max 0.5% of tx value
 * });
 *
 * // Normal operation with default priority
 * const normalTip = await createEnhancedJitoTipInstruction(wallet.publicKey, {
 *   priority: 'normal',
 * });
 * ```
 */
export async function createEnhancedJitoTipInstruction(
  fromPubkey: PublicKey,
  config: JitoTipConfig
): Promise<TransactionInstruction> {
  const attempt = config.attempt ?? 0;

  // 1. Fetch current tip floors (cached, 5s TTL)
  const tips = await getCachedBundleTips();

  // 2. Select base tip based on priority
  const baseTip = selectBaseTip(tips, config.priority);

  // 3. Apply exponential retry escalation: 1.0x → 1.5x → 2.25x → 3.38x → 5.06x
  const escalationMultiplier = Math.pow(1.5, attempt);
  let finalTip = Math.floor(baseTip * escalationMultiplier);

  // 4. Apply cost-aware cap if transaction value provided
  if (config.transactionValueUsd && config.maxTipBps) {
    const cappedTip = calculateCostAwareTip(
      config.transactionValueUsd,
      finalTip,
      config.maxTipBps
    );

    if (cappedTip < finalTip) {
      log.debug('Tip capped by cost-aware limit', {
        originalTip: finalTip,
        cappedTip,
        txValueUsd: config.transactionValueUsd,
        maxTipBps: config.maxTipBps,
      });
      finalTip = cappedTip;
    }
  }

  // 5. Enforce minimum tip (Jito requirement)
  finalTip = Math.max(finalTip, MIN_TIP_LAMPORTS);

  // Select random tip account to reduce contention
  const tipAccount = JITO_TIP_ACCOUNTS[Math.floor(Math.random() * JITO_TIP_ACCOUNTS.length)];

  log.info('Enhanced Jito tip created', {
    priority: config.priority,
    attempt,
    baseTip,
    escalationMultiplier: escalationMultiplier.toFixed(2),
    finalTip,
    finalTipSol: (finalTip / 1e9).toFixed(6),
    tipAccount: tipAccount.toBase58(),
    txValueUsd: config.transactionValueUsd,
    capped: config.transactionValueUsd && config.maxTipBps ? 'yes' : 'no',
  });

  return SystemProgram.transfer({
    fromPubkey,
    toPubkey: tipAccount,
    lamports: finalTip,
  });
}

/**
 * Create Jito tip instruction with static escalation (legacy)
 *
 * @deprecated Use createEnhancedJitoTipInstruction for dynamic pricing
 *
 * Simple static tip escalation strategy:
 * - 1st attempt: 4,000 lamports
 * - 2nd-3rd attempts: 6,000 lamports
 * - 4+ attempts: 8,000 lamports
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

  // Select random tip account to reduce contention
  const tipAccount = JITO_TIP_ACCOUNTS[Math.floor(Math.random() * JITO_TIP_ACCOUNTS.length)];

  log.debug('Creating static Jito tip instruction (legacy)', {
    attempt,
    tipLamports: tipAmountLamports,
    tipSol: tipAmountLamports / 1e9,
    tipAccount: tipAccount.toBase58(),
  });

  return SystemProgram.transfer({
    fromPubkey,
    toPubkey: tipAccount,
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

/**
 * Create a standalone Jito tip transaction for bundle submission
 *
 * Creates a simple transaction with just a tip transfer to a randomly selected
 * Jito tip account. This transaction should be included as the LAST transaction
 * in a Jito bundle to ensure the bundle is prioritized by validators.
 *
 * @param fromKeypair - Keypair paying the tip (must sign the transaction)
 * @param tipConfig - Tip configuration (priority, attempt, etc.)
 * @returns Signed transaction ready for bundle submission
 *
 * @example
 * ```typescript
 * const tipTx = await createBundleTipTransaction(wallet, {
 *   priority: 'high',
 *   attempt: 0,
 * });
 *
 * const bundle = await submitJitoBundle([
 *   swapTx.serialize().toString('base64'),
 *   createTx.serialize().toString('base64'),
 *   tipTx.serialize().toString('base64'), // Tip as last transaction
 * ], true);
 * ```
 */
export async function createBundleTipTransaction(
  fromKeypair: Keypair,
  tipConfig: JitoTipConfig,
  connection: Connection
): Promise<Transaction> {
  // Create tip instruction
  const tipInstruction = await createEnhancedJitoTipInstruction(
    fromKeypair.publicKey,
    tipConfig
  );

  // Build transaction
  const transaction = new Transaction();
  transaction.add(tipInstruction);

  // Set recent blockhash and fee payer
  const { blockhash } = await connection.getLatestBlockhash();
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = fromKeypair.publicKey;

  // Sign transaction
  transaction.sign(fromKeypair);

  log.info('Bundle tip transaction created', {
    tipAmount: tipConfig.priority,
    tipAccount: 'random',
  });

  return transaction;
}

/**
 * Submit Jito bundle with multiple transactions
 *
 * Atomically submits multiple transactions as a single bundle to Jito block engine.
 * All transactions will execute in order or all fail together.
 *
 * IMPORTANT: Bundles MUST include a tip payment to a Jito tip account or they may not land!
 * The tip transaction should be the LAST transaction in the bundle.
 *
 * Key Features:
 * - Atomic execution: All transactions succeed or all fail
 * - Guaranteed ordering: Transactions execute in the order provided
 * - MEV protection: Bundle only lands if all transactions succeed
 * - Fast inclusion: Tips prioritize bundle for validators
 *
 * @param serializedTransactions - Array of base64-encoded serialized transactions (MUST include tip tx as last item)
 * @param bundleOnly - Only submit via bundle (default: true)
 * @returns Bundle ID and transaction signatures
 *
 * @example
 * ```typescript
 * // Atomic swap + create position bundle WITH TIP
 * const swapTxSerialized = swapTx.serialize().toString('base64');
 * const createTxSerialized = createTx.serialize().toString('base64');
 * const tipTx = await createBundleTipTransaction(wallet, { priority: 'high', attempt: 0 }, connection);
 * const tipTxSerialized = tipTx.serialize().toString('base64');
 *
 * const result = await submitJitoBundle([swapTxSerialized, createTxSerialized, tipTxSerialized], true);
 * log.info('Bundle submitted', { bundleId: result.bundleId });
 * ```
 */
export async function submitJitoBundle(
  serializedTransactions: string[],
  bundleOnly: boolean = true
): Promise<{
  bundleId: string;
  signatures: string[];
}> {
  try {
    const JITO_BUNDLE_URL = 'https://mainnet.block-engine.jito.wtf/api/v1/bundles';

    log.info('Submitting Jito bundle', {
      transactionCount: serializedTransactions.length,
      bundleOnly,
    });

    const payload = {
      jsonrpc: '2.0',
      id: 1,
      method: 'sendBundle',
      params: [
        serializedTransactions,
        {
          encoding: 'base64',
        },
      ],
    };

    const response = await fetch(JITO_BUNDLE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Jito bundle API returned ${response.status}: ${errorText}`);
    }

    const data = await response.json();

    if (data.error) {
      throw new Error(`Jito bundle error: ${JSON.stringify(data.error)}`);
    }

    const bundleId = data.result;

    if (!bundleId) {
      throw new Error('No bundle ID in Jito response');
    }

    log.info('✅ Jito bundle submitted successfully', {
      bundleId,
      transactionCount: serializedTransactions.length,
      bundleOnly,
    });

    // Note: Actual transaction signatures are not returned immediately by Jito
    // They will be available after bundle lands on-chain
    return {
      bundleId,
      signatures: [], // Filled in after bundle confirmation
    };
  } catch (error) {
    log.error('Failed to submit Jito bundle', {
      error: error instanceof Error ? error.message : String(error),
      transactionCount: serializedTransactions.length,
      bundleOnly,
    });
    throw error;
  }
}

/**
 * Get bundle status from Jito
 *
 * Checks if a bundle has been included in a block
 *
 * @param bundleId - Bundle UUID returned from submitJitoBundle
 * @returns Bundle status information
 */
export async function getBundleStatus(bundleId: string): Promise<{
  status: 'pending' | 'landed' | 'failed';
  landedSlot?: number;
  transactions?: string[];
}> {
  try {
    const JITO_BUNDLE_STATUS_URL = `https://mainnet.block-engine.jito.wtf/api/v1/bundles`;

    log.debug('Checking Jito bundle status', { bundleId });

    const payload = {
      jsonrpc: '2.0',
      id: 1,
      method: 'getBundleStatuses',
      params: [[bundleId]],
    };

    const response = await fetch(JITO_BUNDLE_STATUS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`Jito status API returned ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();

    if (data.error) {
      throw new Error(`Jito status error: ${JSON.stringify(data.error)}`);
    }

    const statuses = data.result?.value;

    if (!statuses || statuses.length === 0) {
      return { status: 'pending' };
    }

    const bundleStatus = statuses[0];

    if (bundleStatus.confirmation_status === 'confirmed' || bundleStatus.confirmation_status === 'finalized') {
      log.info('Bundle landed on-chain', {
        bundleId,
        slot: bundleStatus.slot,
        status: bundleStatus.confirmation_status,
      });

      return {
        status: 'landed',
        landedSlot: bundleStatus.slot,
        transactions: bundleStatus.transactions || [],
      };
    }

    if (bundleStatus.err) {
      log.warn('Bundle failed', {
        bundleId,
        error: bundleStatus.err,
      });

      return { status: 'failed' };
    }

    return { status: 'pending' };
  } catch (error) {
    log.error('Failed to check bundle status', {
      error: error instanceof Error ? error.message : String(error),
      bundleId,
    });
    throw error;
  }
}
