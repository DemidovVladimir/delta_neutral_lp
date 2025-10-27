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

import { PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js';
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

// Jito tip account (mainnet)
const JITO_TIP_ACCOUNT = new PublicKey('ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49');

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

  log.info('Enhanced Jito tip created', {
    priority: config.priority,
    attempt,
    baseTip,
    escalationMultiplier: escalationMultiplier.toFixed(2),
    finalTip,
    finalTipSol: (finalTip / 1e9).toFixed(6),
    txValueUsd: config.transactionValueUsd,
    capped: config.transactionValueUsd && config.maxTipBps ? 'yes' : 'no',
  });

  return SystemProgram.transfer({
    fromPubkey,
    toPubkey: JITO_TIP_ACCOUNT,
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

  log.debug('Creating static Jito tip instruction (legacy)', {
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
