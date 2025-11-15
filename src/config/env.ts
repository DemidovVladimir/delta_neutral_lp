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
  rentReserveSol: number;
  minimumWalletBalanceSol: number;
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
    priceRangeBpsLower = parseEnvNumber('PRICE_RANGE_BPS_LOWER', -500); // -5% default
    priceRangeBpsUpper = parseEnvNumber('PRICE_RANGE_BPS_UPPER', 500); // +5% default

    // Validate deposits and price range only if pool address is provided
    if (meteoraPoolAddress) {
      // Note: INITIAL_DEPOSIT_SOL and INITIAL_DEPOSIT_USDC are optional now
      // Auto-tune mode uses AUTO_TUNE_DEPOSIT_TOKEN and AUTO_TUNE_DEPOSIT_AMOUNT instead
      // Only validate if both are 0 (backward compatibility check)

      // Validate price range
      if (priceRangeBpsLower >= priceRangeBpsUpper) {
        throw new Error('PRICE_RANGE_BPS_LOWER must be less than PRICE_RANGE_BPS_UPPER');
      }
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
  const swapSlippageBufferPct = parseEnvNumber('SWAP_SLIPPAGE_BUFFER_PCT', 0.5); // Default 0.5% buffer for price impact

  // Parse wallet reserve parameters
  const rentReserveSol = parseEnvNumber('RENT_RESERVE_SOL', 0.1); // Default 0.1 SOL for rent/fees
  const minimumWalletBalanceSol = parseEnvNumber('MINIMUM_WALLET_BALANCE_SOL', 0.2); // Default 0.2 SOL minimum balance

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
    rentReserveSol,
    minimumWalletBalanceSol,
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
