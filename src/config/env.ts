import dotenv from 'dotenv';
import { PublicKey } from '@solana/web3.js';
import path from 'path';

// Always load .env file (works locally and in GCP with env vars)
// In GCP, environment variables are set directly (no .env file needed)
// Locally, .env file is loaded
dotenv.config({
  path: path.resolve(process.cwd(), '.env'),
  override: false, // Don't override existing env vars (GCP Secret Manager takes precedence)
});

export interface BotConfig {
  // Secrets (loaded from env/GCP Secret Manager)
  rpcUrl: string;
  privateKey: string;

  // All other config (from staticConfig.ts in production, or .env in development)
  autoCreatePositions: boolean;
  meteoraPoolAddress?: string;
  initialDepositSol?: number;
  initialDepositUsdc?: number;
  priceRangeBpsLower?: number;
  priceRangeBpsUpper?: number;
  meteoraStrategyType: 'spot' | 'curve' | 'bidask';
  lpOwner?: string;
  meteoraPositionMints?: string[];
  maxRetries: number;
  autoTuneEnabled: boolean;
  autoTuneBinCount: number;
  autoTuneCheckIntervalMs: number;
  autoTuneImbalanceThreshold: number;
  autoTuneDepositToken: 'SOL' | 'USDC';
  autoTuneDepositAmount: number;
  autoTuneMaxRetries: number;
  swapEnabled: boolean;
  swapSlippageBps: number;
  swapSlippageBufferPct: number;
  /**
   * Threshold (percentage points, e.g. 1 for 1%) above which the orchestrator
   * emits a loud warning when Jupiter reports the actual price impact of a
   * swap. Helps the operator notice when the buffer is being eaten by
   * volatility or thin liquidity, before it causes downstream balance shortfalls.
   */
  swapHighImpactWarningPct: number;
  rentReserveSol: number;
  minimumWalletBalanceSol: number;

  // API server (Hono) — fund-affecting POST endpoints are guarded by these.
  /**
   * Shared secret required on POST /api/positions/* via X-API-Key header.
   * When undefined the API server fail-closes mutating endpoints (returns
   * 503) so an exposed port can never move funds without explicit auth.
   * GET endpoints (read-only) remain available either way.
   */
  apiKey?: string;
  /**
   * Allowed Origin values for CORS. Empty array == no cross-origin requests
   * accepted (same-origin only). Defaults to common local dev ports so the
   * paired UI keeps working out of the box.
   */
  apiAllowedOrigins: string[];
  /** Max mutating POST requests per remote IP per minute. */
  apiRateLimitPerMin: number;

  /**
   * Enables the `sendOptimized` wrapper around Meteora SDK transaction sends.
   * When true, every Meteora write tx is simulated to set a tight
   * `setComputeUnitLimit`, and Helius `getPriorityFeeEstimate` drives the
   * `setComputeUnitPrice` — replacing the static SDK-injected priority-fee
   * default with adaptive per-tx pricing. Both changes are latency-preserving
   * (or net-faster). Default off so operators can A/B against the legacy path
   * before flipping over.
   */
  sendOptimizedEnabled: boolean;

  // Drift hedge engine (ADR-014) — a SOL-PERP short on Drift that neutralises
  // the LP's directional SOL exposure (net ΔSOL ≈ 0). The engine is gated by
  // `driftHedgeEnabled`; when false the bot runs LP-only (current production
  // behaviour) and none of the fields below have any effect. The remaining
  // fields size and risk-bound the short; DriftEngine reads them via
  // `getDriftConfig()`. Defaults mirror the "Risk parameters" block in CLAUDE.md.
  /** Master switch for the hedge. False = LP-only, full directional exposure. */
  driftHedgeEnabled: boolean;
  /** Drift market index for SOL-PERP (typically 0). Env: DRIFT_MARKET_SOL_PERP */
  driftMarketSolPerp: number;
  /** Drift sub-account id used for the hedge (default 0). Env: DRIFT_SUBACCOUNT_ID */
  driftSubAccountId: number;
  /** Max net ΔSOL tolerated before a rebalance fires (band, ADR-002). Env: DELTA_THRESHOLD_SOL */
  deltaThresholdSol: number;
  /** Minimum collateral ratio (free collateral / short notional). Env: MIN_COLLATERAL_RATIO */
  minCollateralRatio: number;
  /** Hard ceiling on short notional in USD. Env: MAX_SHORT_NOTIONAL_USD */
  maxShortNotionalUsd: number;
  /** Funding-rate cap (bps) above which we refuse to add/keep the short. Env: FUNDING_RATE_CAP_BPS */
  fundingRateCapBps: number;
}

function parseEnvString(key: string, required: true): string;
function parseEnvString(key: string, required: false, defaultValue: string): string;
function parseEnvString(key: string, required: boolean, defaultValue?: string): string | undefined {
  const value = process.env[key];
  if (!value) {
    if (required) {
      throw new Error(`Missing required environment variable: ${key}`);
    }
    return defaultValue;
  }
  return value;
}

function parseEnvNumber(key: string, defaultValue: number): number {
  const value = process.env[key];
  if (!value) return defaultValue;

  const parsed = Number(value);
  if (isNaN(parsed)) {
    throw new Error(`Invalid number for ${key}: ${value}`);
  }
  return parsed;
}

function parseEnvBoolean(key: string, defaultValue: boolean): boolean {
  const value = process.env[key];
  if (!value) return defaultValue;

  const lower = value.toLowerCase();
  if (lower === 'true' || lower === '1' || lower === 'yes') return true;
  if (lower === 'false' || lower === '0' || lower === 'no') return false;

  throw new Error(`Invalid boolean for ${key}: ${value}. Use true/false, 1/0, or yes/no`);
}

function parseEnvStringArray(key: string, required: true): string[];
function parseEnvStringArray(key: string, required: false, defaultValue: string[]): string[];
function parseEnvStringArray(key: string, required: boolean, defaultValue?: string[]): string[] {
  const value = process.env[key];
  if (!value) {
    if (required) {
      throw new Error(`Missing required environment variable: ${key}`);
    }
    return defaultValue || [];
  }

  return value.split(',').map(s => s.trim()).filter(s => s.length > 0);
}

function validatePublicKey(key: string, value: string): void {
  try {
    new PublicKey(value);
  } catch (error) {
    throw new Error(`Invalid public key for ${key}: ${value}`);
  }
}

function validatePublicKeys(key: string, values: string[]): void {
  values.forEach(value => validatePublicKey(key, value));
}

/**
 * Load configuration from environment variables
 * Works for both local (.env file) and production (GCP environment variables)
 */
function loadConfigFromEnv(): BotConfig {
  const env = process.env.NODE_ENV || 'development';
  console.log(`🔧 Loading config from environment variables (${env})`);

  // Parse core config
  const rpcUrl = parseEnvString('RPC_URL', true);
  const privateKey = parseEnvString('PRIVATE_KEY', true);

  // Parse Meteora position mode
  const autoCreatePositions = parseEnvBoolean('AUTO_CREATE_POSITIONS', false);

  // Conditional parsing based on mode
  let meteoraPoolAddress: string | undefined;
  let initialDepositSol: number | undefined;
  let initialDepositUsdc: number | undefined;
  let priceRangeBpsLower: number | undefined;
  let priceRangeBpsUpper: number | undefined;
  let lpOwner: string | undefined;
  let meteoraPositionMints: string[] | undefined;

  if (autoCreatePositions) {
    // Auto-create mode: pool address is optional (for testing)
    meteoraPoolAddress = parseEnvString('METEORA_POOL_ADDRESS', false, '');

    // Only validate if provided
    if (meteoraPoolAddress) {
      validatePublicKey('METEORA_POOL_ADDRESS', meteoraPoolAddress);
    }

    initialDepositSol = parseEnvNumber('INITIAL_DEPOSIT_SOL', 0);
    initialDepositUsdc = parseEnvNumber('INITIAL_DEPOSIT_USDC', 0);

    // Validate deposits and price range only if pool address is provided
    if (meteoraPoolAddress) {
      // Note: INITIAL_DEPOSIT_SOL and INITIAL_DEPOSIT_USDC are optional now
      // Auto-tune mode uses AUTO_TUNE_DEPOSIT_TOKEN and AUTO_TUNE_DEPOSIT_AMOUNT instead
      // Only validate if both are 0 (backward compatibility check)
    }
  } else {
    // Manual mode: optionally use existing positions
    // If LP_OWNER and METEORA_POSITION_MINTS are provided, use them
    // Otherwise, start with zero positions (user will create via UI)
    lpOwner = parseEnvString('LP_OWNER', false, '');
    meteoraPositionMints = parseEnvStringArray('METEORA_POSITION_MINTS', false, []);

    // Validate public keys only if provided
    if (lpOwner) {
      validatePublicKey('LP_OWNER', lpOwner);
    }
    if (meteoraPositionMints && meteoraPositionMints.length > 0) {
      validatePublicKeys('METEORA_POSITION_MINTS', meteoraPositionMints);
    }

    // Note: Pool address still needed for UI to work
    meteoraPoolAddress = parseEnvString('METEORA_POOL_ADDRESS', false, '');
    if (meteoraPoolAddress) {
      validatePublicKey('METEORA_POOL_ADDRESS', meteoraPoolAddress);
    }
  }

  // Parse retry configuration
  const maxRetries = parseEnvNumber('MAX_RETRIES', 3);

  // Parse auto-tune parameters
  const autoTuneEnabled = parseEnvBoolean('AUTO_TUNE_ENABLED', false);
  const autoTuneBinCount = parseEnvNumber('AUTO_TUNE_BIN_COUNT', 20); // Default 20 bins
  const autoTuneCheckIntervalMs = parseEnvNumber('AUTO_TUNE_CHECK_INTERVAL_MS', 30000); // 30s default
  const autoTuneImbalanceThreshold = parseEnvNumber('AUTO_TUNE_IMBALANCE_THRESHOLD', 0.9); // 90% default
  const autoTuneDepositTokenStr = parseEnvString('AUTO_TUNE_DEPOSIT_TOKEN', false, 'SOL');
  const autoTuneDepositAmount = parseEnvNumber('AUTO_TUNE_DEPOSIT_AMOUNT', 1.0); // Default 1 token
  const autoTuneMaxRetries = parseEnvNumber('AUTO_TUNE_MAX_RETRIES', 3); // Default 3 retries

  // Validate auto-tune deposit token
  if (autoTuneDepositTokenStr !== 'SOL' && autoTuneDepositTokenStr !== 'USDC') {
    throw new Error('AUTO_TUNE_DEPOSIT_TOKEN must be either SOL or USDC');
  }
  const autoTuneDepositToken = autoTuneDepositTokenStr as 'SOL' | 'USDC';

  // Parse Meteora strategy type
  const meteoraStrategyTypeStr = parseEnvString('METEORA_STRATEGY_TYPE', false, 'spot');
  if (meteoraStrategyTypeStr !== 'spot' && meteoraStrategyTypeStr !== 'curve' && meteoraStrategyTypeStr !== 'bidask') {
    throw new Error('METEORA_STRATEGY_TYPE must be one of: spot, curve, bidask');
  }
  const meteoraStrategyType = meteoraStrategyTypeStr as 'spot' | 'curve' | 'bidask';

  // Parse swap parameters
  const swapEnabled = parseEnvBoolean('SWAP_ENABLED', true); // Default enabled
  const swapSlippageBps = parseEnvNumber('SWAP_SLIPPAGE_BPS', 50); // Default 0.5% slippage
  // Default bumped from 0.5 → 3 (per audit recommendation): under volatile
  // conditions or thin liquidity, real Jupiter impact can exceed 0.5% and the
  // post-swap output falls short of the target, forcing a Phase 2 retry. 3% is
  // a conservative ceiling for SOL/USDC; the surplus is absorbed by the next
  // rebalance and not lost. Operators can lower this when they have a clear
  // picture of the pool's typical impact profile.
  const swapSlippageBufferPct = parseEnvNumber('SWAP_SLIPPAGE_BUFFER_PCT', 3);
  // Threshold above which a high-impact warning fires. Defaults to 1% — high
  // enough that normal SOL/USDC trades won't trip it, low enough that anything
  // approaching the 3% buffer ceiling gets surfaced.
  const swapHighImpactWarningPct = parseEnvNumber('SWAP_HIGH_IMPACT_WARNING_PCT', 1);
  if (swapHighImpactWarningPct < 0) {
    throw new Error('SWAP_HIGH_IMPACT_WARNING_PCT must be >= 0');
  }

  // Parse wallet reserve parameters
  const rentReserveSol = parseEnvNumber('RENT_RESERVE_SOL', 0.1); // Default 0.1 SOL for rent/fees
  const minimumWalletBalanceSol = parseEnvNumber('MINIMUM_WALLET_BALANCE_SOL', 0.2); // Default 0.2 SOL minimum balance

  // Parse API server security parameters
  const apiKey = parseEnvString('API_KEY', false, '');
  // Default to common local dev ports so the paired UI works without extra
  // setup. Production should set this explicitly to a known-frontend origin.
  const apiAllowedOrigins = parseEnvStringArray(
    'API_ALLOWED_ORIGINS',
    false,
    ['http://localhost:5173', 'http://localhost:3000']
  );
  const apiRateLimitPerMin = parseEnvNumber('API_RATE_LIMIT_PER_MIN', 10);
  if (apiRateLimitPerMin <= 0) {
    throw new Error('API_RATE_LIMIT_PER_MIN must be > 0');
  }

  // Default false — operators flip to true after validating in `pnpm pnl`
  // that the per-tx fee column has dropped without confirms suffering. Once
  // a few rebalance cycles look good, set SEND_OPTIMIZED=true permanently.
  const sendOptimizedEnabled = parseEnvBoolean('SEND_OPTIMIZED', false);

  // Parse Drift hedge engine parameters (ADR-014). All optional with
  // production-safe defaults; only validated when the hedge is enabled.
  const driftHedgeEnabled = parseEnvBoolean('DRIFT_HEDGE_ENABLED', false);
  const driftMarketSolPerp = parseEnvNumber('DRIFT_MARKET_SOL_PERP', 0);
  const driftSubAccountId = parseEnvNumber('DRIFT_SUBACCOUNT_ID', 0);
  const deltaThresholdSol = parseEnvNumber('DELTA_THRESHOLD_SOL', 2);
  const minCollateralRatio = parseEnvNumber('MIN_COLLATERAL_RATIO', 0.15);
  const maxShortNotionalUsd = parseEnvNumber('MAX_SHORT_NOTIONAL_USD', 12000);
  const fundingRateCapBps = parseEnvNumber('FUNDING_RATE_CAP_BPS', 80);

  // Validate Drift parameters only when the hedge is actually engaged, so an
  // LP-only operator is never blocked by hedge config they don't use. When it
  // IS engaged these guards fail fast at boot rather than mid-rebalance.
  if (driftHedgeEnabled) {
    if (!Number.isInteger(driftMarketSolPerp) || driftMarketSolPerp < 0) {
      throw new Error('DRIFT_MARKET_SOL_PERP must be a non-negative integer');
    }
    if (!Number.isInteger(driftSubAccountId) || driftSubAccountId < 0) {
      throw new Error('DRIFT_SUBACCOUNT_ID must be a non-negative integer');
    }
    if (deltaThresholdSol <= 0) {
      throw new Error('DELTA_THRESHOLD_SOL must be positive');
    }
    if (minCollateralRatio <= 0 || minCollateralRatio >= 1) {
      throw new Error('MIN_COLLATERAL_RATIO must be between 0 and 1 (exclusive)');
    }
    if (maxShortNotionalUsd <= 0) {
      throw new Error('MAX_SHORT_NOTIONAL_USD must be positive');
    }
    if (fundingRateCapBps < 0) {
      throw new Error('FUNDING_RATE_CAP_BPS must be >= 0');
    }
  }

  // Validate auto-tune parameters
  if (autoTuneEnabled) {
    if (autoTuneBinCount <= 0) {
      throw new Error('AUTO_TUNE_BIN_COUNT must be positive');
    }
    if (autoTuneCheckIntervalMs <= 0) {
      throw new Error('AUTO_TUNE_CHECK_INTERVAL_MS must be positive');
    }
    if (autoTuneImbalanceThreshold <= 0 || autoTuneImbalanceThreshold > 1) {
      throw new Error('AUTO_TUNE_IMBALANCE_THRESHOLD must be between 0 and 1');
    }
    if (autoTuneDepositAmount <= 0) {
      throw new Error('AUTO_TUNE_DEPOSIT_AMOUNT must be positive');
    }
    if (autoTuneMaxRetries < 1 || autoTuneMaxRetries > 10) {
      throw new Error('AUTO_TUNE_MAX_RETRIES must be between 1 and 10');
    }
    if (!meteoraPoolAddress) {
      throw new Error('METEORA_POOL_ADDRESS is required when AUTO_TUNE_ENABLED=true');
    }
  }

  return {
    rpcUrl,
    privateKey,
    autoCreatePositions,
    meteoraPoolAddress,
    initialDepositSol,
    initialDepositUsdc,
    priceRangeBpsLower,
    priceRangeBpsUpper,
    meteoraStrategyType,
    lpOwner,
    meteoraPositionMints,
    maxRetries,
    autoTuneEnabled,
    autoTuneBinCount,
    autoTuneCheckIntervalMs,
    autoTuneImbalanceThreshold,
    autoTuneDepositToken,
    autoTuneDepositAmount,
    autoTuneMaxRetries,
    swapEnabled,
    swapSlippageBps,
    swapSlippageBufferPct,
    swapHighImpactWarningPct,
    rentReserveSol,
    minimumWalletBalanceSol,
    apiKey: apiKey || undefined,
    apiAllowedOrigins,
    apiRateLimitPerMin,
    sendOptimizedEnabled,
    driftHedgeEnabled,
    driftMarketSolPerp,
    driftSubAccountId,
    deltaThresholdSol,
    minCollateralRatio,
    maxShortNotionalUsd,
    fundingRateCapBps,
  };
}

export function loadConfig(): BotConfig {
  return loadConfigFromEnv();
}

// Singleton config instance
let configInstance: BotConfig | null = null;

export function getConfig(): BotConfig {
  if (!configInstance) {
    configInstance = loadConfig();
  }
  return configInstance;
}

// For testing: reset config
export function resetConfig(): void {
  configInstance = null;
}
