/**
 * System-wide Configuration Constants
 *
 * Centralized configuration for transaction execution, retry logic, RPC settings,
 * and bot-wide parameters.
 *
 * Usage:
 * - Import specific configs: `import { RPC_CONFIG, SLIPPAGE_BPS } from './constants.js'`
 * - All values are immutable (readonly) via `as const`
 * - Update values here rather than hardcoding in modules
 *
 * @module constants
 */

/**
 * Transaction Retry Configuration
 *
 * Controls retry behavior for failed transactions.
 *
 * Exponential backoff formula:
 * - Delay = initialDelayMs * (backoffMultiplier ^ attempt)
 * - Capped at maxDelayMs
 *
 * Example retry delays:
 * - Attempt 1: 1000ms
 * - Attempt 2: 2000ms
 * - Attempt 3: 4000ms
 */
export const TX_RETRY_CONFIG = {
  /** Maximum number of retry attempts before giving up */
  maxRetries: 3,
  /** Initial retry delay in milliseconds */
  initialDelayMs: 1000,
  /** Maximum retry delay (caps exponential backoff) */
  maxDelayMs: 10000,
  /** Multiplier for exponential backoff (2 = double delay each retry) */
  backoffMultiplier: 2,
} as const;

/**
 * RPC Configuration
 *
 * Solana RPC client settings for transaction submission and confirmation.
 *
 * **skipPreflight Explanation**:
 * - `true`: Skip transaction simulation before submission
 *   - Pros: Faster submission (~100-200ms saved)
 *   - Pros: Useful for time-sensitive txs (MEV, arbitrage)
 *   - Cons: May submit invalid txs that fail on-chain (wasting fees)
 *   - Cons: Less helpful error messages
 * - `false`: Simulate transaction first (default, safer)
 *   - Pros: Catches errors before submitting (saves SOL on failed txs)
 *   - Pros: Better error diagnostics
 *   - Cons: Slower submission
 *   - Cons: Simulation can fail even if tx would succeed (false negatives)
 *
 * **Current Setting**: `false` (safe mode)
 * - For production: Consider `true` for emergency exits and rebalancing
 * - For testing: Keep `false` to catch errors early
 *
 * **Commitment Levels**:
 * - `processed`: Fastest, but can be rolled back (use with caution)
 * - `confirmed`: Default, good balance of speed and finality (~400ms)
 * - `finalized`: Slowest but guaranteed finality (~13s)
 */
export const RPC_CONFIG = {
  /** Timeout for transaction confirmation in milliseconds */
  confirmationTimeout: 60000, // 60s
  /** Commitment level for transaction confirmation */
  commitment: 'confirmed' as const,
  /**
   * Skip transaction simulation before submission
   *
   * WARNING: Setting to `true` means transactions are submitted without
   * validation, which can result in failed transactions and wasted SOL.
   * Only enable for time-critical operations where speed > safety.
   *
   * Current: `false` (safe mode - simulates before submitting)
   *
   * Note: Some modules override this (e.g., meteoraAdapter.ts uses
   * skipPreflight:false for position creation to catch errors early)
   */
  skipPreflight: false,
  /** Maximum transaction version supported (0 for legacy, undefined for all) */
  maxSupportedTransactionVersion: 0,
} as const;

// Price oracle configuration
export const PRICE_ORACLE_CONFIG = {
  staleThresholdMs: 30000, // 30s - reject prices older than this
  maxRetries: 3,
  retryDelayMs: 1000,
} as const;

// Simulation configuration
export const SIMULATION_CONFIG = {
  replaceRecentBlockhash: true,
  commitment: 'confirmed' as const,
} as const;

// Emergency flow triggers
export const EMERGENCY_TRIGGERS = {
  marginRatioThreshold: 0.2, // Trigger emergency if margin drops below 20%
  priceShockPercentage: 15, // Trigger if price moves >15% in one interval
  rpcFailureCount: 3, // Trigger if RPC fails 3 times consecutively
} as const;

// Bundle configuration
export const BUNDLE_CONFIG = {
  maxTransactionsPerBundle: 5,
  bundleStatusPollIntervalMs: 1000,
  bundleStatusMaxAttempts: 60,
} as const;

// Slippage configuration (basis points)
export const SLIPPAGE_BPS = {
  default: 50, // 0.5%
  aggressive: 100, // 1%
  conservative: 25, // 0.25%
  emergency: 200, // 2% for emergency exits
} as const;

// Token decimals (Solana standard)
export const DECIMALS = {
  SOL: 9,
  USDC: 6,
} as const;

// Minimum SOL balance for rent and fees
export const MIN_SOL_BALANCE = 0.05; // 0.05 SOL reserve

// State persistence
export const PERSISTENCE_CONFIG = {
  stateFile: 'data/state.json',
  snapshotIntervalMs: 60000, // Save state every 60s
} as const;

// Logging
export const LOG_CONFIG = {
  maxFileSize: 10 * 1024 * 1024, // 10MB
  maxFiles: 5,
  logDir: 'logs',
} as const;

// Health check
export const HEALTH_CHECK = {
  intervalMs: 30000, // Check health every 30s
  maxConsecutiveFailures: 5,
} as const;

// Meteora DLMM position limits
export const METEORA_LIMITS = {
  MAX_POSITION_WIDTH_BINS: 70, // Maximum number of bins a position can span
  MIN_POSITION_WIDTH_BINS: 1, // Minimum position width
  DEFAULT_POSITION_WIDTH_BINS: 40, // Safe default width for most cases
} as const;
