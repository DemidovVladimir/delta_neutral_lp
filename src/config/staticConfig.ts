/**
 * Static Configuration for Auto-Tune Bot
 *
 * This module contains all configuration values that are hardcoded for mainnet deployment.
 * Only RPC_URL and PRIVATE_KEY are loaded from environment variables/secrets.
 *
 * Benefits:
 * - Reduces GCP Secret Manager usage to 2 secrets
 * - Simplifies deployment (no need to manage 20+ secrets)
 * - Version-controlled configuration
 * - Easy to update via code deploys
 */

import { PublicKey } from '@solana/web3.js';

export interface StaticBotConfig {
  // Meteora position configuration
  meteoraPoolAddress: string;
  lpOwner: string;
  priceRangeBpsLower: number;
  priceRangeBpsUpper: number;

  // Execution parameters
  useJito: boolean;
  jitoRelayUrl: string;
  jupiterPriorityFeeLamports: number;
  maxComputeUnits: number;
  priorityFeeMicroLamports: number;

  // Retry configuration
  maxRetries: number;

  // Auto-tune parameters
  autoTuneEnabled: boolean;
  autoTuneBinCount: number;
  autoTuneCheckIntervalMs: number;
  autoTuneImbalanceThreshold: number;
  autoTuneDepositToken: 'SOL' | 'USDC';
  autoTuneDepositAmount: number;
  autoTuneMaxRetries: number;

  // Swap parameters
  swapEnabled: boolean;
  swapSlippageBps: number;

  // Wallet reserves
  rentReserveSol: number;
  minimumWalletBalanceSol: number;

  // Auto-create positions (disabled for mainnet - start with manual control)
  autoCreatePositions: boolean;
  initialDepositSol: number;
  initialDepositUsdc: number;
}

/**
 * Static configuration for mainnet deployment
 * Based on .env.mainnet values
 */
export const STATIC_CONFIG: StaticBotConfig = {
  // Meteora DLMM Pool: SOL/USDC (bin step 4)
  meteoraPoolAddress: '5rCf1DM8LjKTw4YqhnoLcngyZYeNnQqztScTogYHAS6',
  lpOwner: 'F3YvPiLdniRPGpeKrbeGWR2zg2wPpzVuvqBA5BBJBQ5S',

  // Price range ±1% (~51 bins within 70-bin limit)
  // At $163: range $161.30 - $164.56
  priceRangeBpsLower: -100, // -1%
  priceRangeBpsUpper: 100,  // +1%

  // Jito configuration (MEV protection)
  useJito: true,
  jitoRelayUrl: 'https://mainnet.block-engine.jito.wtf/api/v1/bundles',

  // Priority fees (optimized for 2025 fee market)
  // Priority fee: 50,000 µL/CU = moderate priority
  // With 600k CUs: ~30,000 lamports (~$0.0048) per tx
  priorityFeeMicroLamports: 50000,
  maxComputeUnits: 600000,

  // Jupiter swap priority fee: 80,000 lamports (~$0.013)
  jupiterPriorityFeeLamports: 80000,

  // Retry configuration
  maxRetries: 3,

  // Auto-tune parameters (ENABLED for mainnet)
  autoTuneEnabled: true,
  autoTuneBinCount: 20,                 // Concentrated liquidity (20 bins)
  autoTuneCheckIntervalMs: 10000,       // Check every 10s
  autoTuneImbalanceThreshold: 0.9,      // Trigger at 90% imbalance
  autoTuneDepositToken: 'SOL',          // Use SOL for position sizing
  autoTuneDepositAmount: 0.2,           // 0.2 SOL per position (~$32 at $160/SOL)
  autoTuneMaxRetries: 3,                // Max 3 retries with swap + tip escalation

  // Jupiter swap (ENABLED for auto-balancing)
  swapEnabled: true,
  swapSlippageBps: 50,                  // 0.5% slippage tolerance

  // Wallet reserves
  rentReserveSol: 0.1,                  // 0.1 SOL for rent/fees (~$16 at $160/SOL)
  minimumWalletBalanceSol: 0.2,         // 0.2 SOL minimum balance (~$32 at $160/SOL)

  // Auto-create positions (ENABLED for initial testing)
  autoCreatePositions: true,
  initialDepositSol: 0,
  initialDepositUsdc: 0,
};

/**
 * Validate static configuration
 * Called during config initialization to catch errors early
 */
export function validateStaticConfig(config: StaticBotConfig): void {
  // Validate public keys
  try {
    new PublicKey(config.meteoraPoolAddress);
    new PublicKey(config.lpOwner);
  } catch (error) {
    throw new Error(`Invalid public key in static config: ${error}`);
  }

  // Validate auto-tune parameters
  if (config.autoTuneEnabled) {
    if (config.autoTuneBinCount <= 0) {
      throw new Error('autoTuneBinCount must be positive');
    }
    if (config.autoTuneCheckIntervalMs <= 0) {
      throw new Error('autoTuneCheckIntervalMs must be positive');
    }
    if (config.autoTuneImbalanceThreshold <= 0 || config.autoTuneImbalanceThreshold > 1) {
      throw new Error('autoTuneImbalanceThreshold must be between 0 and 1');
    }
    if (config.autoTuneDepositAmount <= 0) {
      throw new Error('autoTuneDepositAmount must be positive');
    }
    if (config.autoTuneMaxRetries < 1 || config.autoTuneMaxRetries > 10) {
      throw new Error('autoTuneMaxRetries must be between 1 and 10');
    }
    if (config.autoTuneDepositToken !== 'SOL' && config.autoTuneDepositToken !== 'USDC') {
      throw new Error('autoTuneDepositToken must be SOL or USDC');
    }
  }

  // Validate Jito config
  if (config.useJito && !config.jitoRelayUrl) {
    throw new Error('jitoRelayUrl is required when useJito=true');
  }

  // Validate price range
  if (config.priceRangeBpsLower >= config.priceRangeBpsUpper) {
    throw new Error('priceRangeBpsLower must be less than priceRangeBpsUpper');
  }
}
