import dotenv from 'dotenv';
import { PublicKey } from '@solana/web3.js';
import path from 'path';

// Load .env file based on NODE_ENV
const env = process.env.NODE_ENV || 'development';
const envFile = env === 'local' ? '.env.local' :
                env === 'devnet' ? '.env.devnet' :
                env === 'mainnet' || env === 'production' ? '.env.mainnet' :
                '.env';

dotenv.config({
  path: path.resolve(process.cwd(), envFile),
  override: true, // Override existing environment variables to ensure correct env file is used
});

export interface BotConfig {
  // Core
  rpcUrl: string;
  privateKey: string;
  driftMarketSolPerp: number;

  // Meteora position configuration (two modes)
  autoCreatePositions: boolean;

  // Auto-create mode (used if autoCreatePositions=true)
  meteoraPoolAddress?: string;
  initialDepositSol?: number;
  initialDepositUsdc?: number;
  priceRangeBpsLower?: number;
  priceRangeBpsUpper?: number;

  // Manual mode (used if autoCreatePositions=false)
  lpOwner?: string;
  meteoraPositionMints?: string[];

  // Risk parameters
  deltaThresholdSol: number;
  minCollateralRatio: number;
  maxShortNotionalUsd: number;
  fundingRateCapBps: number;

  // Execution parameters
  useJito: boolean;
  jitoRelayUrl?: string;
  priorityTipLamports: number;
  maxComputeUnits: number;
  priorityFeeMicroLamports: number;

  // Loop parameters
  hedgeLoopIntervalMs: number;
  maxRetries: number;

  // Auto-tune parameters
  autoTuneEnabled: boolean;
  autoTuneBinCount: number;
  autoTuneCheckIntervalMs: number;
  autoTuneImbalanceThreshold: number;
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

export function loadConfig(): BotConfig {
  // Parse core config
  const rpcUrl = parseEnvString('RPC_URL', true);
  const privateKey = parseEnvString('PRIVATE_KEY', true);
  const driftMarketSolPerp = parseEnvNumber('DRIFT_MARKET_SOL_PERP', 0);

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
      // Validate at least one deposit is specified
      if (initialDepositSol === 0 && initialDepositUsdc === 0) {
        throw new Error(
          'At least one of INITIAL_DEPOSIT_SOL or INITIAL_DEPOSIT_USDC must be greater than 0'
        );
      }

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

  // Parse risk parameters with defaults from PRD
  const deltaThresholdSol = parseEnvNumber('DELTA_THRESHOLD_SOL', 2);
  const minCollateralRatio = parseEnvNumber('MIN_COLLATERAL_RATIO', 0.15);
  const maxShortNotionalUsd = parseEnvNumber('MAX_SHORT_NOTIONAL_USD', 12000);
  const fundingRateCapBps = parseEnvNumber('FUNDING_RATE_CAP_BPS', 80);

  // Parse execution parameters
  const useJito = parseEnvBoolean('USE_JITO', true);
  const jitoRelayUrl = parseEnvString('JITO_RELAY_URL', false, '');
  const priorityTipLamports = parseEnvNumber('PRIORITY_TIP_LAMPORTS', 80000);
  const maxComputeUnits = parseEnvNumber('MAX_COMPUTE_UNITS', 200000);
  const priorityFeeMicroLamports = parseEnvNumber('PRIORITY_FEE_MICRO_LAMPORTS', 1000); // 1 microlamport per CU

  // Parse loop parameters
  const hedgeLoopIntervalMs = parseEnvNumber('HEDGE_LOOP_INTERVAL_MS', 15000); // 15s default
  const maxRetries = parseEnvNumber('MAX_RETRIES', 3);

  // Parse auto-tune parameters
  const autoTuneEnabled = parseEnvBoolean('AUTO_TUNE_ENABLED', false);
  const autoTuneBinCount = parseEnvNumber('AUTO_TUNE_BIN_COUNT', 20); // Default 20 bins
  const autoTuneCheckIntervalMs = parseEnvNumber('AUTO_TUNE_CHECK_INTERVAL_MS', 30000); // 30s default
  const autoTuneImbalanceThreshold = parseEnvNumber('AUTO_TUNE_IMBALANCE_THRESHOLD', 0.8); // 80% default

  // Validate Jito config
  if (useJito && !jitoRelayUrl) {
    throw new Error('JITO_RELAY_URL is required when USE_JITO=true');
  }

  // Validate risk parameters
  if (deltaThresholdSol <= 0) {
    throw new Error('DELTA_THRESHOLD_SOL must be positive');
  }
  if (minCollateralRatio <= 0 || minCollateralRatio >= 1) {
    throw new Error('MIN_COLLATERAL_RATIO must be between 0 and 1');
  }
  if (maxShortNotionalUsd <= 0) {
    throw new Error('MAX_SHORT_NOTIONAL_USD must be positive');
  }
  if (fundingRateCapBps < 0) {
    throw new Error('FUNDING_RATE_CAP_BPS must be non-negative');
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
    if (!meteoraPoolAddress) {
      throw new Error('METEORA_POOL_ADDRESS is required when AUTO_TUNE_ENABLED=true');
    }
  }

  return {
    rpcUrl,
    privateKey,
    driftMarketSolPerp,
    autoCreatePositions,
    meteoraPoolAddress,
    initialDepositSol,
    initialDepositUsdc,
    priceRangeBpsLower,
    priceRangeBpsUpper,
    lpOwner,
    meteoraPositionMints,
    deltaThresholdSol,
    minCollateralRatio,
    maxShortNotionalUsd,
    fundingRateCapBps,
    useJito,
    jitoRelayUrl: jitoRelayUrl || undefined,
    priorityTipLamports,
    maxComputeUnits,
    priorityFeeMicroLamports,
    hedgeLoopIntervalMs,
    maxRetries,
    autoTuneEnabled,
    autoTuneBinCount,
    autoTuneCheckIntervalMs,
    autoTuneImbalanceThreshold,
  };
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
