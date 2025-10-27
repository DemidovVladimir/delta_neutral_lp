/**
 * System-wide constants for the delta-neutral LP bot
 */

// Transaction retry configuration
export const TX_RETRY_CONFIG = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 10000,
  backoffMultiplier: 2,
} as const;

// RPC configuration
export const RPC_CONFIG = {
  confirmationTimeout: 60000, // 60s
  commitment: 'confirmed' as const,
  skipPreflight: false,
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
  journalFile: 'data/journal.jsonl',
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

// Known program IDs (for reference)
export const PROGRAM_IDS = {
  METEORA_DLMM: 'LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo',
  DRIFT: 'dRiftyHA39MWEi3m9aunc5MzRF1JYuBsbn6VPcn33UH',
  JUPITER_V6: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
} as const;

// Meteora DLMM position limits
export const METEORA_LIMITS = {
  MAX_POSITION_WIDTH_BINS: 70, // Maximum number of bins a position can span
  MIN_POSITION_WIDTH_BINS: 1, // Minimum position width
  DEFAULT_POSITION_WIDTH_BINS: 40, // Safe default width for most cases
} as const;
