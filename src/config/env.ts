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
   * Oracle gate for swaps (ADR-020): refuse to execute when the quote's
   * implied price deviates from the cross-validated oracle by more than this
   * many bps. 0 disables the gate. Env: SWAP_ORACLE_GATE_BPS (default 50)
   */
  swapOracleGateBps: number;
  /**
   * Threshold (percentage points, e.g. 1 for 1%) above which the orchestrator
   * emits a loud warning when Jupiter reports the actual price impact of a
   * swap. Helps the operator notice when the buffer is being eaten by
   * volatility or thin liquidity, before it causes downstream balance shortfalls.
   */
  swapHighImpactWarningPct: number;
  rentReserveSol: number;
  minimumWalletBalanceSol: number;

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

  // Perps hedge controller (ADR-015/017, Jupiter Perps backend). The hedge
  // steers net ΔSOL (LP long + perp long − perp short) toward
  // `hedgeTargetDeltaSol` inside a band, one mutation per loop cycle.
  /** Master switch. False = LP-only, full directional exposure. Env: HEDGE_ENABLED */
  hedgeEnabled: boolean;
  /**
   * When true (the default) the loop's hedge mutations are SIMULATED only —
   * nothing is sent. Flip to false to trade for real. Env: HEDGE_DRY_RUN
   */
  hedgeDryRun: boolean;
  /**
   * The net ΔSOL the controller steers toward. 0 = delta-neutral. A positive
   * value keeps a deliberate long tilt (can exceed LP exposure → perp long);
   * negative = deliberate net short. Env: HEDGE_TARGET_DELTA_SOL
   */
  hedgeTargetDeltaSol: number;
  /**
   * Max |netΔ − target| tolerated before a rebalance fires. Since ADR-025 this
   * is the FLOOR under the auto-derived band (see hedgeBandBins); with
   * HEDGE_BAND_BINS=0 it is the whole fixed band (pre-ADR-025 behavior).
   * Env: DELTA_THRESHOLD_SOL
   */
  deltaThresholdSol: number;
  /**
   * ADR-025: the hedge dead-band auto-derives = this many bins' worth of LP
   * delta (LP full value in SOL / AUTO_TUNE_BIN_COUNT × bins), recomputed
   * every cycle, floored by DELTA_THRESHOLD_SOL — capital scales, the band
   * follows (ADR-018 sizing rule made automatic). 0 disables (fixed band).
   * Env: HEDGE_BAND_BINS
   */
  hedgeBandBins: number;
  /** Minimum collateral ratio (collateral / notional) on the side being grown. Env: MIN_COLLATERAL_RATIO */
  minCollateralRatio: number;
  /**
   * OPTIONAL absolute ceiling on hedge notional (per side) in USD; 0 disables
   * it (default). Since ADR-022 the working cap auto-derives from portfolio
   * size (see hedgeNotionalCapMult) — set this only as a paranoid hard bound.
   * Env: MAX_HEDGE_NOTIONAL_USD (legacy fallback: MAX_SHORT_NOTIONAL_USD).
   */
  maxHedgeNotionalUsd: number;
  /**
   * ADR-022: per-side notional cap = this × (idle wallet SOL + LP full value
   * in SOL + |target tilt|) × price, recomputed from on-chain state every
   * cycle — capital scales, the cap follows. Env: HEDGE_NOTIONAL_CAP_MULT
   */
  hedgeNotionalCapMult: number;
  /**
   * Minimum ms between LIVE hedge mutations. Jupiter fills requests via an
   * async keeper TX seconds after ours; acting again before the fill lands
   * would double-hedge off stale position state. Env: HEDGE_COOLDOWN_MS
   */
  hedgeCooldownMs: number;
  /**
   * Auto-close zero-balance token accounts (legacy dust ATAs) to reclaim
   * rent — at startup and every 6h. wSOL/USDC are never touched.
   * Env: WALLET_JANITOR_ENABLED (default true)
   */
  walletJanitorEnabled: boolean;
  /**
   * What LP figure the hedge controller sees (ADR-019). 'live' = the actual
   * current LP SOL amount (hedge chases bin-composition swings and every LP
   * recenter). 'midpoint' = the SOL-denominated half of LP total value
   * (~constant per position → near-zero hedge churn; intra-range delta up to
   * ± half the position rides unhedged until the next LP recenter).
   * Env: HEDGE_LP_INPUT (default 'live')
   */
  hedgeLpInput: 'live' | 'midpoint';
  /**
   * ADR-021 full-portfolio neutrality: add idle wallet SOL (native balance
   * above MINIMUM_WALLET_BALANCE_SOL + RENT_RESERVE_SOL) to the hedge
   * target, so a SOL drawdown cannot make HODL-USDC beat the strategy.
   * wSOL is excluded (transient keeper-fill lifecycle, auto-unwrapped).
   * Env: HEDGE_INCLUDE_WALLET_SOL (default false)
   */
  hedgeIncludeWalletSol: boolean;
  /**
   * ADR-021 storm mode: when |5-minute price move| exceeds this percentage,
   * LP recentering PAUSES (no new positions into a falling knife) while the
   * hedge keeps running — with the out-of-range clamp the position's full
   * SOL bag gets shorted (synthetic USDC exit, reversible). 0 = disabled.
   * Env: LP_VOL_PAUSE_PCT_5M (default 0)
   */
  lpVolPausePct5m: number;
  /**
   * ADR-023 («выдержка»): a price move must PERSIST this long before the bot
   * believes it. Two consumers: (1) the LP recenter fires only after the
   * composition imbalance holds continuously for this window; (2) the hedge's
   * out-of-range clamp commits a regime change only after the candidate
   * regime holds this long — EXCEPT during a volatility storm, where the
   * clamp reacts immediately (crash protection unchanged). Filters whipsaw
   * (the measured sell-low-buy-high round trips); real moves pass because
   * the price does not come back. 0 = disabled (react on first sight).
   * Env: TREND_CONFIRM_MS (default 0; production 300000 = 5 min)
   */
  trendConfirmMs: number;
  /**
   * Target collateral ratio (collateral / notional) the controller sizes
   * collateral to on an increase. 1.0 = fully collateralized (~1x); ADR-016
   * chose 0.33 (~3x) for capital efficiency — set it in .env.
   * Env: HEDGE_TARGET_COLLATERAL_RATIO. Must be >= minCollateralRatio.
   */
  hedgeTargetCollateralRatio: number;
  /**
   * Annualised borrow-APR cap in bps. The controller refuses to INCREASE a
   * side when its carry exceeds this (decreases/closes always allowed).
   * 0 = disabled. Env: HEDGE_CARRY_CAP_BPS.
   */
  hedgeCarryCapBps: number;
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
  const swapOracleGateBps = parseEnvNumber('SWAP_ORACLE_GATE_BPS', 50);
  if (swapOracleGateBps < 0) {
    throw new Error('SWAP_ORACLE_GATE_BPS must be >= 0 (0 disables the gate)');
  }
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

  // Default false — operators flip to true after validating in `pnpm pnl`
  // that the per-tx fee column has dropped without confirms suffering. Once
  // a few rebalance cycles look good, set SEND_OPTIMIZED=true permanently.
  const sendOptimizedEnabled = parseEnvBoolean('SEND_OPTIMIZED', false);

  // Parse hedge controller parameters (ADR-015/017). All optional with
  // production-safe defaults; the risk bounds are validated only when the
  // hedge is enabled so an LP-only operator is never blocked by them.
  const hedgeEnabled = parseEnvBoolean('HEDGE_ENABLED', false);
  const hedgeDryRun = parseEnvBoolean('HEDGE_DRY_RUN', true);
  const hedgeTargetDeltaSol = parseEnvNumber('HEDGE_TARGET_DELTA_SOL', 0);
  // Default 10 min: fill safety needs only ~2 min, but the cooldown doubles
  // as the hedge-churn throttle (ADR-018).
  const hedgeCooldownMs = parseEnvNumber('HEDGE_COOLDOWN_MS', 600_000);
  const walletJanitorEnabled = parseEnvBoolean('WALLET_JANITOR_ENABLED', true);
  const hedgeLpInputRaw = parseEnvString('HEDGE_LP_INPUT', false, 'live');
  if (hedgeLpInputRaw !== 'live' && hedgeLpInputRaw !== 'midpoint') {
    throw new Error(`HEDGE_LP_INPUT must be 'live' or 'midpoint', got '${hedgeLpInputRaw}'`);
  }
  const hedgeLpInput = hedgeLpInputRaw as 'live' | 'midpoint';
  const hedgeIncludeWalletSol = parseEnvBoolean('HEDGE_INCLUDE_WALLET_SOL', false);
  const lpVolPausePct5m = parseEnvNumber('LP_VOL_PAUSE_PCT_5M', 0);
  if (lpVolPausePct5m < 0) {
    throw new Error('LP_VOL_PAUSE_PCT_5M must be >= 0 (0 disables storm mode)');
  }
  const trendConfirmMs = parseEnvNumber('TREND_CONFIRM_MS', 0);
  if (trendConfirmMs < 0) {
    throw new Error('TREND_CONFIRM_MS must be >= 0 (0 disables the confirmation delay)');
  }
  const deltaThresholdSol = parseEnvNumber('DELTA_THRESHOLD_SOL', 2);
  const minCollateralRatio = parseEnvNumber('MIN_COLLATERAL_RATIO', 0.15);
  // Renamed from MAX_SHORT_NOTIONAL_USD when the hedge gained the long side;
  // the legacy var still works so existing .env files don't silently lose it.
  // ADR-022: 0 = no absolute ceiling (the auto-cap below governs instead).
  const maxHedgeNotionalUsd = parseEnvNumber(
    'MAX_HEDGE_NOTIONAL_USD',
    parseEnvNumber('MAX_SHORT_NOTIONAL_USD', 0)
  );
  const hedgeNotionalCapMult = parseEnvNumber('HEDGE_NOTIONAL_CAP_MULT', 1.25);
  if (!(hedgeNotionalCapMult >= 1)) {
    throw new Error('HEDGE_NOTIONAL_CAP_MULT must be >= 1 (margin above the measured hedge bag)');
  }
  const hedgeBandBins = parseEnvNumber('HEDGE_BAND_BINS', 4);
  if (!(hedgeBandBins >= 0)) {
    throw new Error('HEDGE_BAND_BINS must be >= 0 (0 disables the auto-derived band)');
  }

  const hedgeTargetCollateralRatio = parseEnvNumber('HEDGE_TARGET_COLLATERAL_RATIO', 1.0);
  const hedgeCarryCapBps = parseEnvNumber('HEDGE_CARRY_CAP_BPS', 5000);
  if (!(hedgeTargetCollateralRatio > 0)) {
    throw new Error('HEDGE_TARGET_COLLATERAL_RATIO must be positive');
  }
  if (hedgeTargetCollateralRatio < minCollateralRatio) {
    throw new Error(
      `HEDGE_TARGET_COLLATERAL_RATIO (${hedgeTargetCollateralRatio}) must be >= MIN_COLLATERAL_RATIO (${minCollateralRatio})`
    );
  }
  if (hedgeCarryCapBps < 0) {
    throw new Error('HEDGE_CARRY_CAP_BPS must be >= 0');
  }

  if (hedgeEnabled) {
    if (deltaThresholdSol <= 0) {
      throw new Error('DELTA_THRESHOLD_SOL must be positive');
    }
    if (minCollateralRatio <= 0 || minCollateralRatio >= 1) {
      throw new Error('MIN_COLLATERAL_RATIO must be between 0 and 1 (exclusive)');
    }
    if (maxHedgeNotionalUsd < 0) {
      throw new Error('MAX_HEDGE_NOTIONAL_USD must be >= 0 (0 = no absolute ceiling, ADR-022)');
    }
    if (hedgeCooldownMs < 0) {
      throw new Error('HEDGE_COOLDOWN_MS must be >= 0');
    }
    if (!Number.isFinite(hedgeTargetDeltaSol)) {
      throw new Error('HEDGE_TARGET_DELTA_SOL must be a finite number');
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
    swapOracleGateBps,
    swapHighImpactWarningPct,
    rentReserveSol,
    minimumWalletBalanceSol,
    sendOptimizedEnabled,
    hedgeEnabled,
    hedgeDryRun,
    hedgeTargetDeltaSol,
    hedgeCooldownMs,
    walletJanitorEnabled,
    hedgeLpInput,
    hedgeIncludeWalletSol,
    lpVolPausePct5m,
    trendConfirmMs,
    deltaThresholdSol,
    hedgeBandBins,
    minCollateralRatio,
    maxHedgeNotionalUsd,
    hedgeNotionalCapMult,
    hedgeTargetCollateralRatio,
    hedgeCarryCapBps,
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
