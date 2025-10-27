/**
 * Type Definitions
 *
 * Shared TypeScript type definitions for the delta-neutral liquidity provision bot.
 *
 * Type Categories:
 * - **Core Types**: Prices, token amounts, base data structures
 * - **Meteora LP Types**: Position data, exposure tracking, pool analytics
 * - **Drift Types**: Perpetual positions, collateral, margin (planned)
 * - **Risk Types**: Delta thresholds, margin ratios, limits (planned)
 * - **Transaction Types**: Bundle params, execution results
 * - **State Types**: Persistence, snapshots, action journal
 *
 * Naming Conventions:
 * - Interfaces use PascalCase (e.g., `LpExposure`, `CreatePositionParams`)
 * - Params interfaces end with `Params` (e.g., `DepositParams`)
 * - Result interfaces end with `Result` (e.g., `CreatePositionResult`)
 * - Detail interfaces end with `Detail` (e.g., `PositionDetail`)
 *
 * Units and Precision:
 * - **SOL amounts**: Human-readable decimals (e.g., 1.5 SOL, not lamports)
 * - **USDC amounts**: Human-readable decimals (e.g., 1000 USDC, not micro-USDC)
 * - **Prices**: USD denominated (e.g., 200.5 for SOL/USD)
 * - **Basis Points**: Integer BPS (e.g., 50 = 0.5%, 10000 = 100%)
 * - **Timestamps**: Unix milliseconds (Date.now())
 *
 * @example
 * ```typescript
 * // Creating a position
 * const params: CreatePositionParams = {
 *   poolAddress: '5rCf1DM8...',
 *   solAmount: 10,
 *   usdcAmount: 1000,
 *   priceLower: 195,
 *   priceUpper: 205,
 * };
 *
 * // Reading LP exposure
 * const exposure: LpExposure = await adapter.getLpExposure();
 * console.log(`SOL: ${exposure.solAmount}, USDC: ${exposure.usdcAmount}`);
 * ```
 */

import { Transaction, VersionedTransaction } from '@solana/web3.js';

// =============================================================================
// CORE TYPES
// =============================================================================

export interface Price {
  usd: number;
  timestamp: number;
  source: 'jupiter' | 'pyth' | 'cached' | 'fallback';
}

export interface TokenPrice {
  id: string; // Mint address
  mintSymbol: string;
  vsToken?: string; // vs token mint (e.g., USDC)
  vsTokenSymbol?: string;
  price: number;
  timestamp: number;
}

export interface MultiTokenPriceResult {
  sol: TokenPrice;
  usdc?: TokenPrice;
  solUsdcRate?: number; // SOL/USDC exchange rate
  timestamp: number;
  source: 'jupiter' | 'pyth' | 'cached' | 'fallback';
}

export interface TokenAmount {
  amount: number; // In human-readable units (e.g., 1.5 SOL, 1000 USDC)
  decimals: number;
  mint?: string;
}

// =============================================================================
// METEORA LP TYPES
// =============================================================================

export interface LpExposure {
  solAmount: number; // Human-readable SOL amount
  usdcAmount: number; // Human-readable USDC amount
  totalUsd: number; // Total value in USD
  claimableSol: number; // Claimable fee in SOL
  claimableUsdc: number; // Claimable fee in USDC
  positions: PositionDetail[]; // Individual position details
}

export interface PositionDetail {
  mint: string; // Position NFT mint
  solAmount: number;
  usdcAmount: number;
  valueUsd: number;
  claimableSol: number;
  claimableUsdc: number;
  lowerBinId: number;
  upperBinId: number;
}

export interface MeteoraPairInfo {
  address: string;
  name: string;
  mintX: string;
  mintY: string;
  reserveX: string;
  reserveY: string;
  reserveXAmount: number;
  reserveYAmount: number;
  binStep: number;
  baseFeePercentage: string;
  maxFeePercentage: string;
  protocolFeePercentage: string;
  liquidity: string;
  fees24h: number;
  todayFees: number;
  tradeVolume24h: number;
  cumulativeTradeVolume: string;
  cumulativeFeeVolume: string;
  currentPrice: number;
  apr: number;
  apy: number;
  farmApr: number;
  farmApy: number;
  hide: boolean;
}

export interface CreatePositionParams {
  poolAddress: string; // Meteora DLMM pool address
  solAmount: number; // SOL to deposit
  usdcAmount: number; // USDC to deposit
  priceLower: number; // Lower price bound (in USD)
  priceUpper: number; // Upper price bound (in USD)
  slippageBps?: number; // Slippage tolerance in basis points
}

export interface CreatePositionResult {
  positionMint: string; // NFT mint address for created position
  signature: string; // Transaction signature
  solDeposited: number; // Actual SOL deposited
  usdcDeposited: number; // Actual USDC deposited
}

export interface DepositParams {
  usdc?: number;
  sol?: number;
  singleSided?: 'sol' | 'usdc';
}

export interface WithdrawParams {
  percent?: number; // 0-100
  amount?: number; // In USD
  singleSidedOut?: 'sol' | 'usdc';
}

export interface ClaimResult {
  sol: number;
  usdc: number;
  sig: string;
}

// =============================================================================
// DRIFT PERP TYPES
// =============================================================================

export interface DriftState {
  shortSol: number; // Current short position size (negative for short)
  collateralUsd: number; // Total collateral in USD
  marginRatio: number; // Collateral / Notional
  fundingBpsDay: number; // Funding rate in basis points per day
  unrealizedPnl: number; // Unrealized P&L in USD
  liquidationPrice?: number; // Estimated liquidation price
}

export interface RebalanceParams {
  targetSol: number; // Target short position size
  price: number; // Current SOL price
  maxSlippageBps: number; // Maximum slippage in basis points
}

export interface CollateralParams {
  usdc: number; // Amount in USDC
}

// =============================================================================
// BUNDLE & TRANSACTION TYPES
// =============================================================================

export interface PlanStep {
  label: string; // Human-readable description
  ix: any; // TransactionInstruction (using any to avoid circular deps)
  estimatedCu?: number; // Estimated compute units
}

export interface Plan {
  steps: PlanStep[];
  totalCu?: number; // Total estimated compute units
}

export interface SimulationResult {
  ok: boolean;
  errors?: string[];
  logs?: string[];
  unitsConsumed?: number;
}

export interface BundleResult {
  bundleId?: string;
  signatures: string[];
  success: boolean;
  error?: string;
}

export interface TransactionResult {
  signature: string;
  success: boolean;
  error?: string;
  slot?: number;
}

// =============================================================================
// RISK TYPES
// =============================================================================

export interface RiskParams {
  lpSol: number;
  price: number;
  shortSol: number;
  collateralUsd: number;
  fundingBpsDay: number;
}

export interface RiskMetrics {
  delta: number; // lpSol - shortSol
  collat: number; // Collateral ratio
  notional: number; // Position notional in USD
  exposure: number; // USD exposure
  marginBuffer: number; // Distance to liquidation
}

export interface RiskLimits {
  deltaThresholdSol: number;
  minCollateralRatio: number;
  maxShortNotionalUsd: number;
  fundingRateCapBps: number;
}

export enum RiskLevel {
  SAFE = 'SAFE',
  WARNING = 'WARNING',
  DANGER = 'DANGER',
  CRITICAL = 'CRITICAL',
}

// =============================================================================
// STATE PERSISTENCE TYPES
// =============================================================================

export interface StateSnapshot {
  timestamp: number;
  lpExposure: LpExposure;
  driftState: DriftState;
  price: Price;
  riskMetrics: RiskMetrics;
  riskLevel: RiskLevel;
  createdPositionMints?: string[]; // Auto-created position NFT mints (for persistence)
}

export interface JournalEntry {
  timestamp: number;
  action: string; // e.g., 'rebalance', 'deposit', 'withdraw', 'emergency'
  inputs: Record<string, any>;
  outputs: Record<string, any>;
  txSigs: string[];
  success: boolean;
  error?: string;
  durationMs: number;
}

// =============================================================================
// ORCHESTRATOR TYPES
// =============================================================================

export interface HedgeLoopState {
  iteration: number;
  running: boolean;
  lastRun: number;
  consecutiveErrors: number;
}

export interface EmergencyTrigger {
  reason: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  timestamp: number;
  data?: Record<string, any>;
}

export interface EmergencyFlowParams {
  withdrawPercent?: number; // 0-100, default 100 (full withdrawal)
  skipSwap?: boolean; // Skip SOL->USDC swap
  dryRun?: boolean; // Simulate only, don't execute
}

// =============================================================================
// UTILITY TYPES
// =============================================================================

export type Awaitable<T> = T | Promise<T>;

export type SolanaTransaction = Transaction | VersionedTransaction;

export interface RetryConfig {
  maxRetries: number;
  delayMs: number;
  backoffMultiplier?: number;
}

// =============================================================================
// ERROR TYPES
// =============================================================================

export class BotError extends Error {
  constructor(
    message: string,
    public code: string,
    public context?: Record<string, any>
  ) {
    super(message);
    this.name = 'BotError';
  }
}

export class ConfigError extends BotError {
  constructor(message: string, context?: Record<string, any>) {
    super(message, 'CONFIG_ERROR', context);
    this.name = 'ConfigError';
  }
}

export class RiskError extends BotError {
  constructor(message: string, context?: Record<string, any>) {
    super(message, 'RISK_ERROR', context);
    this.name = 'RiskError';
  }
}

export class TransactionError extends BotError {
  constructor(message: string, context?: Record<string, any>) {
    super(message, 'TRANSACTION_ERROR', context);
    this.name = 'TransactionError';
  }
}

export class OracleError extends BotError {
  constructor(message: string, context?: Record<string, any>) {
    super(message, 'ORACLE_ERROR', context);
    this.name = 'OracleError';
  }
}
