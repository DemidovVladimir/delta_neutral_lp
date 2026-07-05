/**
 * PnL Database
 *
 * Append-only SQLite store for everything the bot does that has financial
 * consequences:
 *   • positions opened and closed (with deposits, range, exit values)
 *   • on-chain transactions and the network fees they consumed
 *   • Jupiter swaps (direction, amounts, price impact, slippage cap)
 *   • rebalance events (trigger composition, claimed fees, success/error)
 *   • per-tick position snapshots with HODL benchmarks
 *
 * Every row is stamped with a strategy_version (git short hash, see
 * utils/strategyVersion.ts) so the operator can group performance by code
 * lineage and roll back via git when a strategy underperforms.
 *
 * Design choices:
 *   • Single SQLite file at data/pnl.db, opened in WAL mode so the running
 *     auto-tune writer doesn't block a separate read-only `pnpm pnl` reader.
 *   • Schema is created/upgraded idempotently in initPnlDb(); no separate
 *     migration tool to maintain.
 *   • All numeric columns are stored as REAL (human-readable units like SOL
 *     and USDC, not lamports), matching the convention the rest of the codebase
 *     uses. We don't store BigInt — lossy precision for the satoshi-scale
 *     amounts at play here is fine.
 *   • All write helpers are wrapped in try/catch and never throw — PnL is a
 *     reporting layer, never the critical path. If the DB is unavailable, the
 *     bot keeps running and just loses analytics fidelity for that period.
 *   • JSON state.json remains the source of truth for hot runtime state
 *     (current position mint, iteration counter). This DB is only
 *     append-history.
 */

import * as path from 'path';
import * as fs from 'fs';
import Database, { type Database as DatabaseT } from 'better-sqlite3';
import { log } from '../utils/logger.js';
import { getStrategyVersion } from '../utils/strategyVersion.js';

// ──────────────────────────────────────────────────────────────────────────
// CONNECTION
// ──────────────────────────────────────────────────────────────────────────

const DB_DIR = path.resolve(process.cwd(), 'data');
const DB_PATH = path.join(DB_DIR, 'pnl.db');

let dbInstance: DatabaseT | null = null;

/**
 * Lazy-open the DB on first use. Idempotent — repeated calls return the same
 * connection. Survives the lifetime of the process; we don't close it on
 * graceful shutdown because the SQLite WAL journal flushes on every commit
 * already and there's nothing extra a Close() would buy.
 */
function openDb(): DatabaseT {
  if (dbInstance) return dbInstance;

  if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
  }

  const db = new Database(DB_PATH);
  // WAL journal mode lets readers (e.g. `pnpm pnl`) coexist with the writer
  // (the running auto-tune loop) without lock contention. NORMAL synchronous
  // mode is the SQLite-recommended pairing with WAL — durable on crash, fast
  // on the hot path.
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');

  initSchema(db);
  recordCurrentStrategyVersion(db);

  dbInstance = db;
  log.info('📈 PnL database opened', { path: DB_PATH });
  return db;
}

/**
 * Test-only escape hatch — close + null the cached handle so a test can
 * re-open against a fresh file. Production code does not call this.
 */
export function _closePnlDbForTests(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}

// ──────────────────────────────────────────────────────────────────────────
// SCHEMA
// ──────────────────────────────────────────────────────────────────────────

function initSchema(db: DatabaseT): void {
  // Order matters because of FK references.
  db.exec(`
    CREATE TABLE IF NOT EXISTS strategy_versions (
      git_hash    TEXT NOT NULL PRIMARY KEY,
      label       TEXT,
      is_dirty    INTEGER NOT NULL DEFAULT 0,
      first_seen  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS positions (
      id                          INTEGER PRIMARY KEY AUTOINCREMENT,
      position_mint               TEXT NOT NULL,
      pool_address                TEXT NOT NULL,
      opened_at                   TEXT NOT NULL,
      opened_strategy_version     TEXT NOT NULL,
      open_signature              TEXT,
      deposit_sol                 REAL NOT NULL,
      deposit_usdc                REAL NOT NULL,
      deposit_price_sol_usd       REAL NOT NULL,
      deposit_total_usd           REAL NOT NULL,
      range_lower_price           REAL NOT NULL,
      range_upper_price           REAL NOT NULL,
      bin_count                   INTEGER NOT NULL,
      strategy_type               TEXT NOT NULL,

      -- HODL baselines fixed at open. Comparing position value against these at
      -- close (and per-tick) tells us whether the LP+fees beat each strategy.
      -- All three are USD-denominated and computed in recordPositionOpened().
      hodl_only_sol_amount        REAL NOT NULL,
      hodl_only_usdc_amount       REAL NOT NULL,
      hodl_5050_sol_amount        REAL NOT NULL,
      hodl_5050_usdc_amount       REAL NOT NULL,

      -- Closing fields, NULL until withdrawClaimAndClose runs.
      closed_at                   TEXT,
      closed_strategy_version     TEXT,
      close_signature             TEXT,
      exit_sol                    REAL,
      exit_usdc                   REAL,
      exit_price_sol_usd          REAL,
      claimed_fees_sol            REAL,
      claimed_fees_usdc           REAL,
      pnl_usd                     REAL,
      hodl_only_sol_pnl_usd       REAL,
      hodl_only_usdc_pnl_usd      REAL,
      hodl_5050_pnl_usd           REAL,

      FOREIGN KEY (opened_strategy_version) REFERENCES strategy_versions(git_hash),
      FOREIGN KEY (closed_strategy_version) REFERENCES strategy_versions(git_hash)
    );
    CREATE INDEX IF NOT EXISTS idx_positions_mint  ON positions(position_mint);
    CREATE INDEX IF NOT EXISTS idx_positions_open  ON positions(opened_at);

    CREATE TABLE IF NOT EXISTS transactions (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      signature         TEXT NOT NULL UNIQUE,
      kind              TEXT NOT NULL,    -- create_position | withdraw_claim_close | swap | claim_fees | other
      position_id       INTEGER,          -- nullable: not every tx is tied to one position (swaps may not be)
      strategy_version  TEXT NOT NULL,
      timestamp         TEXT NOT NULL,
      fee_lamports      INTEGER,
      fee_sol           REAL,
      fee_usd           REAL,
      success           INTEGER NOT NULL DEFAULT 1,
      error_message     TEXT,
      raw_meta          TEXT,             -- JSON blob for arbitrary context

      FOREIGN KEY (position_id) REFERENCES positions(id),
      FOREIGN KEY (strategy_version) REFERENCES strategy_versions(git_hash)
    );
    CREATE INDEX IF NOT EXISTS idx_transactions_kind ON transactions(kind);
    CREATE INDEX IF NOT EXISTS idx_transactions_pos  ON transactions(position_id);

    CREATE TABLE IF NOT EXISTS swaps (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      signature             TEXT NOT NULL UNIQUE,
      strategy_version      TEXT NOT NULL,
      timestamp             TEXT NOT NULL,
      direction             TEXT NOT NULL,    -- SOL_TO_USDC | USDC_TO_SOL
      input_mint            TEXT NOT NULL,
      output_mint           TEXT NOT NULL,
      input_amount          REAL NOT NULL,
      expected_output       REAL,
      actual_output         REAL,
      price_impact_pct      REAL,             -- positive percentage as reported by Jupiter Ultra
      slippage_bps          INTEGER,
      slippage_buffer_pct   REAL,
      price_sol_usd         REAL,
      context               TEXT NOT NULL,    -- initial-position | rebalance | retry-rebalance
      success               INTEGER NOT NULL DEFAULT 1,
      error_message         TEXT,

      FOREIGN KEY (strategy_version) REFERENCES strategy_versions(git_hash)
    );
    CREATE INDEX IF NOT EXISTS idx_swaps_context ON swaps(context);
    CREATE INDEX IF NOT EXISTS idx_swaps_when    ON swaps(timestamp);

    CREATE TABLE IF NOT EXISTS rebalances (
      id                          INTEGER PRIMARY KEY AUTOINCREMENT,
      triggered_at                TEXT NOT NULL,
      completed_at                TEXT,
      strategy_version            TEXT NOT NULL,
      old_position_id             INTEGER,
      new_position_id             INTEGER,
      trigger_sol_pct             REAL,
      trigger_usdc_pct            REAL,
      trigger_reason              TEXT,
      trigger_price_sol_usd       REAL,
      claimed_fees_sol            REAL,
      claimed_fees_usdc           REAL,
      withdraw_signature          TEXT,
      create_signature            TEXT,
      swap_signature              TEXT,
      success                     INTEGER NOT NULL DEFAULT 0,
      error_message               TEXT,
      duration_ms                 INTEGER,

      FOREIGN KEY (old_position_id) REFERENCES positions(id),
      FOREIGN KEY (new_position_id) REFERENCES positions(id),
      FOREIGN KEY (strategy_version) REFERENCES strategy_versions(git_hash)
    );
    CREATE INDEX IF NOT EXISTS idx_rebalances_when ON rebalances(triggered_at);

    CREATE TABLE IF NOT EXISTS position_snapshots (
      id                       INTEGER PRIMARY KEY AUTOINCREMENT,
      position_id              INTEGER NOT NULL,
      taken_at                 TEXT NOT NULL,
      strategy_version         TEXT NOT NULL,
      current_price_sol_usd    REAL NOT NULL,
      position_sol_amount      REAL NOT NULL,
      position_usdc_amount     REAL NOT NULL,
      position_value_usd       REAL NOT NULL,
      unclaimed_fees_sol       REAL NOT NULL,
      unclaimed_fees_usdc      REAL NOT NULL,
      composition_sol_pct      REAL,
      composition_usdc_pct     REAL,

      -- HODL benchmark VALUES (USD) at this snapshot. Calculated against the
      -- amounts captured at open (in positions.hodl_*_amount). Persisting them
      -- denormalized makes time-series charting trivial — one query, no joins.
      hodl_only_sol_value_usd  REAL NOT NULL,
      hodl_only_usdc_value_usd REAL NOT NULL,
      hodl_5050_value_usd      REAL NOT NULL,

      FOREIGN KEY (position_id)      REFERENCES positions(id),
      FOREIGN KEY (strategy_version) REFERENCES strategy_versions(git_hash)
    );
    CREATE INDEX IF NOT EXISTS idx_snapshots_position ON position_snapshots(position_id, taken_at);

    CREATE TABLE IF NOT EXISTS hedge_actions (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      taken_at            TEXT NOT NULL,
      strategy_version    TEXT NOT NULL,
      venue               TEXT NOT NULL,
      -- increase_short / decrease_short / increase_long / decrease_long / blocked
      action              TEXT NOT NULL,
      dry_run             INTEGER NOT NULL,
      lp_sol              REAL NOT NULL,
      perp_base_sol       REAL NOT NULL,
      target_delta_sol    REAL NOT NULL,
      net_delta_sol       REAL NOT NULL,
      adjusted_sol        REAL NOT NULL,
      size_usd            REAL,
      oracle_price_usd    REAL,
      blocked_reason      TEXT,
      signature           TEXT,
      detail              TEXT,

      FOREIGN KEY (strategy_version) REFERENCES strategy_versions(git_hash)
    );
    CREATE INDEX IF NOT EXISTS idx_hedge_actions_when ON hedge_actions(taken_at);
  `);
}

function recordCurrentStrategyVersion(db: DatabaseT): void {
  const version = getStrategyVersion();
  // INSERT OR IGNORE: if we already saw this hash in a previous boot, leave
  // the existing row alone (preserves the original first_seen and label).
  db.prepare(
    `INSERT OR IGNORE INTO strategy_versions (git_hash, label, is_dirty, first_seen)
     VALUES (?, ?, ?, ?)`,
  ).run(version.gitHash, version.label ?? null, version.isDirty ? 1 : 0, version.detectedAt);
}

// ──────────────────────────────────────────────────────────────────────────
// HELPERS — every public helper is fail-safe (try/catch, no rethrow)
// ──────────────────────────────────────────────────────────────────────────

/**
 * Wrap a write helper with try/catch + the current strategy_version, so
 * callers don't have to repeat boilerplate at every call site. Returns
 * `null` if the DB write blows up — the bot keeps running.
 */
function safe<T>(fn: () => T, label: string): T | null {
  try {
    return fn();
  } catch (err) {
    log.warn(`PnL DB write failed: ${label}`, {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

// ──────────────────────────────────────────────────────────────────────────
// POSITIONS
// ──────────────────────────────────────────────────────────────────────────

export interface RecordPositionOpenedInput {
  positionMint: string;
  poolAddress: string;
  signature: string;
  depositSol: number;
  depositUsdc: number;
  priceSolUsdAtOpen: number;
  rangeLowerPrice: number;
  rangeUpperPrice: number;
  binCount: number;
  strategyType: string;
}

/**
 * Record a freshly-opened position. Computes and persists HODL baselines:
 *
 *   hold-only-SOL  = total deposit value in USD, expressed as SOL at entry
 *                    (compares "what if we'd just held SOL" later)
 *   hold-only-USDC = total deposit value in USD, kept as USDC
 *                    (compares "what if we'd just held stables")
 *   hold-5050      = the actual deposit amounts as-deposited
 *                    (the impermanent-loss reference: "what if we never
 *                    rebalanced and just held the deposit composition")
 *
 * Returns the inserted row's id (or null on failure).
 */
export function recordPositionOpened(
  input: RecordPositionOpenedInput,
): number | null {
  return safe(() => {
    const db = openDb();
    const version = getStrategyVersion();
    const depositTotalUsd =
      input.depositSol * input.priceSolUsdAtOpen + input.depositUsdc;

    // Convert the total deposit value into "all-SOL" / "all-USDC" amounts.
    const hodlOnlySolAmount = depositTotalUsd / input.priceSolUsdAtOpen;
    const hodlOnlyUsdcAmount = depositTotalUsd;

    const result = db
      .prepare(
        `INSERT INTO positions (
          position_mint, pool_address, opened_at, opened_strategy_version, open_signature,
          deposit_sol, deposit_usdc, deposit_price_sol_usd, deposit_total_usd,
          range_lower_price, range_upper_price, bin_count, strategy_type,
          hodl_only_sol_amount, hodl_only_usdc_amount,
          hodl_5050_sol_amount, hodl_5050_usdc_amount
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.positionMint,
        input.poolAddress,
        nowIso(),
        version.gitHash,
        input.signature,
        input.depositSol,
        input.depositUsdc,
        input.priceSolUsdAtOpen,
        depositTotalUsd,
        input.rangeLowerPrice,
        input.rangeUpperPrice,
        input.binCount,
        input.strategyType,
        hodlOnlySolAmount,
        hodlOnlyUsdcAmount,
        input.depositSol,
        input.depositUsdc,
      );
    return Number(result.lastInsertRowid);
  }, 'recordPositionOpened');
}

export interface RecordPositionClosedInput {
  positionMint: string;
  signature: string;
  exitSol: number;
  exitUsdc: number;
  priceSolUsdAtClose: number;
  claimedFeesSol: number;
  claimedFeesUsdc: number;
}

/**
 * Mark a position closed and compute final PnL vs each HODL benchmark.
 *
 * pnl_usd            = (exit + claimed fees) − initial deposit
 * hodl_only_sol_pnl  = (exit + claimed fees) − hodl_only_sol_amount * exit_price
 * hodl_only_usdc_pnl = (exit + claimed fees) − hodl_only_usdc_amount
 * hodl_5050_pnl      = (exit + claimed fees) − (hodl_5050_sol_amount * exit_price + hodl_5050_usdc_amount)
 *
 * Negative values mean the strategy underperformed that benchmark.
 */
export function recordPositionClosed(
  input: RecordPositionClosedInput,
): number | null {
  return safe(() => {
    const db = openDb();
    const version = getStrategyVersion();

    // Find the most recent open row for this mint (a mint *can* be reused if
    // the wallet recreates a position with the same NFT, but we open a new
    // row per createPosition, so most recent is correct).
    const open = db
      .prepare(
        `SELECT id, deposit_total_usd, deposit_price_sol_usd,
                hodl_only_sol_amount, hodl_only_usdc_amount,
                hodl_5050_sol_amount, hodl_5050_usdc_amount
         FROM positions
         WHERE position_mint = ? AND closed_at IS NULL
         ORDER BY id DESC LIMIT 1`,
      )
      .get(input.positionMint) as
      | {
          id: number;
          deposit_total_usd: number;
          deposit_price_sol_usd: number;
          hodl_only_sol_amount: number;
          hodl_only_usdc_amount: number;
          hodl_5050_sol_amount: number;
          hodl_5050_usdc_amount: number;
        }
      | undefined;

    if (!open) {
      // No matching open row — likely a position created before the DB existed.
      // Don't fabricate a row; just log and return.
      log.warn('PnL DB: close event for unknown open position', {
        positionMint: input.positionMint,
      });
      return null;
    }

    const exitValueUsd =
      input.exitSol * input.priceSolUsdAtClose + input.exitUsdc;
    const claimedValueUsd =
      input.claimedFeesSol * input.priceSolUsdAtClose + input.claimedFeesUsdc;
    const totalRealized = exitValueUsd + claimedValueUsd;

    const pnlUsd = totalRealized - open.deposit_total_usd;
    const hodlOnlySolValue =
      open.hodl_only_sol_amount * input.priceSolUsdAtClose;
    const hodlOnlyUsdcValue = open.hodl_only_usdc_amount;
    const hodl5050Value =
      open.hodl_5050_sol_amount * input.priceSolUsdAtClose +
      open.hodl_5050_usdc_amount;

    const hodlOnlySolPnl = totalRealized - hodlOnlySolValue;
    const hodlOnlyUsdcPnl = totalRealized - hodlOnlyUsdcValue;
    const hodl5050Pnl = totalRealized - hodl5050Value;

    db.prepare(
      `UPDATE positions
         SET closed_at = ?,
             closed_strategy_version = ?,
             close_signature = ?,
             exit_sol = ?,
             exit_usdc = ?,
             exit_price_sol_usd = ?,
             claimed_fees_sol = ?,
             claimed_fees_usdc = ?,
             pnl_usd = ?,
             hodl_only_sol_pnl_usd = ?,
             hodl_only_usdc_pnl_usd = ?,
             hodl_5050_pnl_usd = ?
       WHERE id = ?`,
    ).run(
      nowIso(),
      version.gitHash,
      input.signature,
      input.exitSol,
      input.exitUsdc,
      input.priceSolUsdAtClose,
      input.claimedFeesSol,
      input.claimedFeesUsdc,
      pnlUsd,
      hodlOnlySolPnl,
      hodlOnlyUsdcPnl,
      hodl5050Pnl,
      open.id,
    );
    return open.id;
  }, 'recordPositionClosed');
}

/**
 * Find the DB id of a currently-open position by its on-chain mint. Used by
 * snapshot + rebalance helpers that need the FK. Returns null if not found
 * (e.g. position pre-existed the DB).
 */
export function findOpenPositionIdByMint(positionMint: string): number | null {
  return safe(() => {
    const db = openDb();
    const row = db
      .prepare(
        `SELECT id FROM positions
         WHERE position_mint = ? AND closed_at IS NULL
         ORDER BY id DESC LIMIT 1`,
      )
      .get(positionMint) as { id: number } | undefined;
    return row ? row.id : null;
  }, 'findOpenPositionIdByMint');
}

// ──────────────────────────────────────────────────────────────────────────
// TRANSACTIONS
// ──────────────────────────────────────────────────────────────────────────

export interface RecordTransactionInput {
  signature: string;
  kind:
    | 'create_position'
    | 'withdraw_claim_close'
    | 'swap'
    | 'claim_fees'
    | 'other';
  positionId?: number | null;
  feeLamports?: number;
  feeSol?: number;
  feeUsd?: number;
  success?: boolean;
  errorMessage?: string;
  rawMeta?: Record<string, any>;
}

/**
 * Record an on-chain transaction. Idempotent on `signature` — if the row
 * already exists (because another code path beat us to it), we update fee
 * fields rather than inserting a duplicate. This matters because
 * trackTransactionFee runs async and may complete after the orchestrator
 * has already inserted the row.
 */
export function recordTransaction(input: RecordTransactionInput): number | null {
  return safe(() => {
    const db = openDb();
    const version = getStrategyVersion();
    const meta = input.rawMeta ? JSON.stringify(input.rawMeta) : null;

    const existing = db
      .prepare(`SELECT id FROM transactions WHERE signature = ?`)
      .get(input.signature) as { id: number } | undefined;

    if (existing) {
      // Refresh fee fields and any newly-known position_id; don't clobber
      // a non-null with a null.
      db.prepare(
        `UPDATE transactions
           SET fee_lamports     = COALESCE(?, fee_lamports),
               fee_sol          = COALESCE(?, fee_sol),
               fee_usd          = COALESCE(?, fee_usd),
               position_id      = COALESCE(?, position_id),
               error_message    = COALESCE(?, error_message),
               success          = ?
         WHERE id = ?`,
      ).run(
        input.feeLamports ?? null,
        input.feeSol ?? null,
        input.feeUsd ?? null,
        input.positionId ?? null,
        input.errorMessage ?? null,
        input.success === false ? 0 : 1,
        existing.id,
      );
      return existing.id;
    }

    const result = db
      .prepare(
        `INSERT INTO transactions (
          signature, kind, position_id, strategy_version, timestamp,
          fee_lamports, fee_sol, fee_usd, success, error_message, raw_meta
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.signature,
        input.kind,
        input.positionId ?? null,
        version.gitHash,
        nowIso(),
        input.feeLamports ?? null,
        input.feeSol ?? null,
        input.feeUsd ?? null,
        input.success === false ? 0 : 1,
        input.errorMessage ?? null,
        meta,
      );
    return Number(result.lastInsertRowid);
  }, 'recordTransaction');
}

// ──────────────────────────────────────────────────────────────────────────
// SWAPS
// ──────────────────────────────────────────────────────────────────────────

export interface RecordSwapInput {
  signature: string;
  direction: 'SOL_TO_USDC' | 'USDC_TO_SOL';
  inputMint: string;
  outputMint: string;
  inputAmount: number;
  expectedOutput?: number;
  actualOutput?: number;
  priceImpactPct?: number;
  slippageBps?: number;
  slippageBufferPct?: number;
  priceSolUsd?: number;
  context: 'initial-position' | 'rebalance' | 'retry-rebalance';
  success?: boolean;
  errorMessage?: string;
}

export function recordSwap(input: RecordSwapInput): number | null {
  return safe(() => {
    const db = openDb();
    const version = getStrategyVersion();
    const result = db
      .prepare(
        `INSERT INTO swaps (
          signature, strategy_version, timestamp, direction,
          input_mint, output_mint, input_amount, expected_output, actual_output,
          price_impact_pct, slippage_bps, slippage_buffer_pct, price_sol_usd,
          context, success, error_message
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.signature,
        version.gitHash,
        nowIso(),
        input.direction,
        input.inputMint,
        input.outputMint,
        input.inputAmount,
        input.expectedOutput ?? null,
        input.actualOutput ?? null,
        input.priceImpactPct ?? null,
        input.slippageBps ?? null,
        input.slippageBufferPct ?? null,
        input.priceSolUsd ?? null,
        input.context,
        input.success === false ? 0 : 1,
        input.errorMessage ?? null,
      );
    return Number(result.lastInsertRowid);
  }, 'recordSwap');
}

// ──────────────────────────────────────────────────────────────────────────
// REBALANCES
// ──────────────────────────────────────────────────────────────────────────

export interface RecordRebalanceTriggerInput {
  oldPositionId: number | null;
  triggerSolPct: number;
  triggerUsdcPct: number;
  triggerReason?: string;
  triggerPriceSolUsd: number;
}

/** Insert the rebalance row at trigger time. Returns the new row id. */
export function recordRebalanceTriggered(
  input: RecordRebalanceTriggerInput,
): number | null {
  return safe(() => {
    const db = openDb();
    const version = getStrategyVersion();
    const result = db
      .prepare(
        `INSERT INTO rebalances (
          triggered_at, strategy_version, old_position_id,
          trigger_sol_pct, trigger_usdc_pct, trigger_reason, trigger_price_sol_usd
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        nowIso(),
        version.gitHash,
        input.oldPositionId,
        input.triggerSolPct,
        input.triggerUsdcPct,
        input.triggerReason ?? null,
        input.triggerPriceSolUsd,
      );
    return Number(result.lastInsertRowid);
  }, 'recordRebalanceTriggered');
}

export interface RecordRebalanceCompletedInput {
  rebalanceId: number;
  newPositionId?: number | null;
  claimedFeesSol?: number;
  claimedFeesUsdc?: number;
  withdrawSignature?: string;
  swapSignature?: string;
  createSignature?: string;
  success: boolean;
  errorMessage?: string;
  durationMs: number;
}

export function recordRebalanceCompleted(
  input: RecordRebalanceCompletedInput,
): void {
  safe(() => {
    const db = openDb();
    db.prepare(
      `UPDATE rebalances
         SET completed_at        = ?,
             new_position_id     = COALESCE(?, new_position_id),
             claimed_fees_sol    = COALESCE(?, claimed_fees_sol),
             claimed_fees_usdc   = COALESCE(?, claimed_fees_usdc),
             withdraw_signature  = COALESCE(?, withdraw_signature),
             swap_signature      = COALESCE(?, swap_signature),
             create_signature    = COALESCE(?, create_signature),
             success             = ?,
             error_message       = ?,
             duration_ms         = ?
       WHERE id = ?`,
    ).run(
      nowIso(),
      input.newPositionId ?? null,
      input.claimedFeesSol ?? null,
      input.claimedFeesUsdc ?? null,
      input.withdrawSignature ?? null,
      input.swapSignature ?? null,
      input.createSignature ?? null,
      input.success ? 1 : 0,
      input.errorMessage ?? null,
      input.durationMs,
      input.rebalanceId,
    );
    return null;
  }, 'recordRebalanceCompleted');
}

// ──────────────────────────────────────────────────────────────────────────
// SNAPSHOTS
// ──────────────────────────────────────────────────────────────────────────

export interface RecordPositionSnapshotInput {
  positionMint: string;
  currentPriceSolUsd: number;
  positionSol: number;
  positionUsdc: number;
  unclaimedFeesSol: number;
  unclaimedFeesUsdc: number;
  compositionSolPct?: number;
  compositionUsdcPct?: number;
}

/**
 * Record a per-tick snapshot. Looks up the open position row by mint, computes
 * the three HODL benchmark values from the persisted entry-time amounts, and
 * inserts. Skipped silently when the position isn't tracked (positions opened
 * before the DB existed).
 */
export function recordPositionSnapshot(
  input: RecordPositionSnapshotInput,
): void {
  safe(() => {
    const db = openDb();
    const version = getStrategyVersion();
    const open = db
      .prepare(
        `SELECT id,
                hodl_only_sol_amount, hodl_only_usdc_amount,
                hodl_5050_sol_amount, hodl_5050_usdc_amount
         FROM positions
         WHERE position_mint = ? AND closed_at IS NULL
         ORDER BY id DESC LIMIT 1`,
      )
      .get(input.positionMint) as
      | {
          id: number;
          hodl_only_sol_amount: number;
          hodl_only_usdc_amount: number;
          hodl_5050_sol_amount: number;
          hodl_5050_usdc_amount: number;
        }
      | undefined;
    if (!open) return null;

    const positionValueUsd =
      input.positionSol * input.currentPriceSolUsd +
      input.positionUsdc +
      // Unclaimed fees are part of position-equivalent value: they belong to
      // the LP and will land in the wallet on next claim. Including them here
      // makes the snapshot a fair "position MTM" rather than pretending fees
      // don't exist until they're claimed.
      input.unclaimedFeesSol * input.currentPriceSolUsd +
      input.unclaimedFeesUsdc;

    const hodlOnlySolValueUsd =
      open.hodl_only_sol_amount * input.currentPriceSolUsd;
    const hodlOnlyUsdcValueUsd = open.hodl_only_usdc_amount;
    const hodl5050ValueUsd =
      open.hodl_5050_sol_amount * input.currentPriceSolUsd +
      open.hodl_5050_usdc_amount;

    db.prepare(
      `INSERT INTO position_snapshots (
        position_id, taken_at, strategy_version, current_price_sol_usd,
        position_sol_amount, position_usdc_amount, position_value_usd,
        unclaimed_fees_sol, unclaimed_fees_usdc,
        composition_sol_pct, composition_usdc_pct,
        hodl_only_sol_value_usd, hodl_only_usdc_value_usd, hodl_5050_value_usd
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      open.id,
      nowIso(),
      version.gitHash,
      input.currentPriceSolUsd,
      input.positionSol,
      input.positionUsdc,
      positionValueUsd,
      input.unclaimedFeesSol,
      input.unclaimedFeesUsdc,
      input.compositionSolPct ?? null,
      input.compositionUsdcPct ?? null,
      hodlOnlySolValueUsd,
      hodlOnlyUsdcValueUsd,
      hodl5050ValueUsd,
    );
    return null;
  }, 'recordPositionSnapshot');
}

// ──────────────────────────────────────────────────────────────────────────
// HEDGE ACTIONS (ADR-017)
// ──────────────────────────────────────────────────────────────────────────

export interface RecordHedgeActionInput {
  venue: string;
  action: string;
  dryRun: boolean;
  lpSol: number;
  perpBaseSol: number;
  targetDeltaSol: number;
  netDeltaSol: number;
  adjustedSol: number;
  sizeUsd?: number;
  oraclePriceUsd?: number;
  blockedReason?: string;
  signature?: string;
  detail?: string;
}

/**
 * Record one hedge-controller decision (every non-`none` outcome: increases,
 * decreases, and blocked — dry-run included, flagged as such). `none` is
 * deliberately not recorded: it fires every check cycle and would swamp the
 * table without adding information.
 */
export function recordHedgeAction(input: RecordHedgeActionInput): void {
  safe(() => {
    const db = openDb();
    const version = getStrategyVersion();
    db.prepare(
      `INSERT INTO hedge_actions (
        taken_at, strategy_version, venue, action, dry_run,
        lp_sol, perp_base_sol, target_delta_sol, net_delta_sol, adjusted_sol,
        size_usd, oracle_price_usd, blocked_reason, signature, detail
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      nowIso(),
      version.gitHash,
      input.venue,
      input.action,
      input.dryRun ? 1 : 0,
      input.lpSol,
      input.perpBaseSol,
      input.targetDeltaSol,
      input.netDeltaSol,
      input.adjustedSol,
      input.sizeUsd ?? null,
      input.oraclePriceUsd ?? null,
      input.blockedReason ?? null,
      input.signature ?? null,
      input.detail ?? null,
    );
    return null;
  }, 'recordHedgeAction');
}

// ──────────────────────────────────────────────────────────────────────────
// READ-SIDE HELPERS — used by `pnpm pnl` CLI
// ──────────────────────────────────────────────────────────────────────────

export interface PnlSummary {
  rebalanceCount: number;
  swapCount: number;
  swapVolumeUsd: number;
  positionsOpened: number;
  positionsClosed: number;
  totalNetworkFeesSol: number;
  totalNetworkFeesUsd: number;
  totalClaimedFeesSol: number;
  totalClaimedFeesUsdc: number;
  realizedPnlUsd: number;
  realizedHodlOnlySolPnlUsd: number;
  realizedHodlOnlyUsdcPnlUsd: number;
  realizedHodl5050PnlUsd: number;
}

export function getLifetimeSummary(): PnlSummary {
  const db = openDb();
  const num = (sql: string, defaultVal = 0): number => {
    const row = db.prepare(sql).get() as { v: number | null } | undefined;
    return row?.v ?? defaultVal;
  };

  return {
    rebalanceCount: num(`SELECT COUNT(*) AS v FROM rebalances WHERE success = 1`),
    swapCount: num(`SELECT COUNT(*) AS v FROM swaps WHERE success = 1`),
    swapVolumeUsd: num(
      `SELECT COALESCE(SUM(input_amount * COALESCE(price_sol_usd, 1)), 0) AS v
       FROM swaps WHERE success = 1 AND direction = 'SOL_TO_USDC'`,
    ) +
      num(
        `SELECT COALESCE(SUM(input_amount), 0) AS v
         FROM swaps WHERE success = 1 AND direction = 'USDC_TO_SOL'`,
      ),
    positionsOpened: num(`SELECT COUNT(*) AS v FROM positions`),
    positionsClosed: num(`SELECT COUNT(*) AS v FROM positions WHERE closed_at IS NOT NULL`),
    totalNetworkFeesSol: num(`SELECT COALESCE(SUM(fee_sol), 0) AS v FROM transactions`),
    totalNetworkFeesUsd: num(`SELECT COALESCE(SUM(fee_usd), 0) AS v FROM transactions`),
    totalClaimedFeesSol: num(`SELECT COALESCE(SUM(claimed_fees_sol), 0) AS v FROM positions`),
    totalClaimedFeesUsdc: num(`SELECT COALESCE(SUM(claimed_fees_usdc), 0) AS v FROM positions`),
    realizedPnlUsd: num(`SELECT COALESCE(SUM(pnl_usd), 0) AS v FROM positions WHERE closed_at IS NOT NULL`),
    realizedHodlOnlySolPnlUsd: num(
      `SELECT COALESCE(SUM(hodl_only_sol_pnl_usd), 0) AS v FROM positions WHERE closed_at IS NOT NULL`,
    ),
    realizedHodlOnlyUsdcPnlUsd: num(
      `SELECT COALESCE(SUM(hodl_only_usdc_pnl_usd), 0) AS v FROM positions WHERE closed_at IS NOT NULL`,
    ),
    realizedHodl5050PnlUsd: num(
      `SELECT COALESCE(SUM(hodl_5050_pnl_usd), 0) AS v FROM positions WHERE closed_at IS NOT NULL`,
    ),
  };
}

export interface FeeBreakdownRow {
  kind: string;
  count: number;
  totalFeeSol: number;
  totalFeeUsd: number;
}

export function getFeeBreakdownByKind(): FeeBreakdownRow[] {
  const db = openDb();
  return db
    .prepare(
      `SELECT kind,
              COUNT(*) AS count,
              COALESCE(SUM(fee_sol), 0) AS totalFeeSol,
              COALESCE(SUM(fee_usd), 0) AS totalFeeUsd
       FROM transactions
       GROUP BY kind
       ORDER BY totalFeeUsd DESC`,
    )
    .all() as FeeBreakdownRow[];
}

export interface OpenPositionView {
  id: number;
  positionMint: string;
  openedAt: string;
  depositTotalUsd: number;
  hodlOnlySolAmount: number;
  hodlOnlyUsdcAmount: number;
  hodl5050SolAmount: number;
  hodl5050UsdcAmount: number;
  strategyVersion: string;
}

export function getOpenPositions(): OpenPositionView[] {
  const db = openDb();
  return db
    .prepare(
      `SELECT id, position_mint AS positionMint, opened_at AS openedAt,
              deposit_total_usd AS depositTotalUsd,
              hodl_only_sol_amount AS hodlOnlySolAmount,
              hodl_only_usdc_amount AS hodlOnlyUsdcAmount,
              hodl_5050_sol_amount AS hodl5050SolAmount,
              hodl_5050_usdc_amount AS hodl5050UsdcAmount,
              opened_strategy_version AS strategyVersion
       FROM positions
       WHERE closed_at IS NULL
       ORDER BY opened_at DESC`,
    )
    .all() as OpenPositionView[];
}

export interface RecentRebalanceView {
  id: number;
  triggeredAt: string;
  completedAt: string | null;
  triggerSolPct: number | null;
  triggerUsdcPct: number | null;
  triggerReason: string | null;
  success: number;
  durationMs: number | null;
  claimedFeesSol: number | null;
  claimedFeesUsdc: number | null;
  strategyVersion: string;
  errorMessage: string | null;
}

export function getRecentRebalances(limit = 10): RecentRebalanceView[] {
  const db = openDb();
  return db
    .prepare(
      `SELECT id,
              triggered_at AS triggeredAt,
              completed_at AS completedAt,
              trigger_sol_pct AS triggerSolPct,
              trigger_usdc_pct AS triggerUsdcPct,
              trigger_reason AS triggerReason,
              success,
              duration_ms AS durationMs,
              claimed_fees_sol AS claimedFeesSol,
              claimed_fees_usdc AS claimedFeesUsdc,
              strategy_version AS strategyVersion,
              error_message AS errorMessage
       FROM rebalances
       ORDER BY triggered_at DESC
       LIMIT ?`,
    )
    .all(limit) as RecentRebalanceView[];
}

export interface RecentSwapView {
  id: number;
  timestamp: string;
  direction: string;
  inputAmount: number;
  expectedOutput: number | null;
  actualOutput: number | null;
  priceImpactPct: number | null;
  context: string;
  success: number;
  strategyVersion: string;
}

export function getRecentSwaps(limit = 10): RecentSwapView[] {
  const db = openDb();
  return db
    .prepare(
      `SELECT id, timestamp, direction,
              input_amount AS inputAmount,
              expected_output AS expectedOutput,
              actual_output AS actualOutput,
              price_impact_pct AS priceImpactPct,
              context, success,
              strategy_version AS strategyVersion
       FROM swaps
       ORDER BY timestamp DESC
       LIMIT ?`,
    )
    .all(limit) as RecentSwapView[];
}

// ────────────────────────────────────────────────────────────────────────────
// Per-rebalance net-return decomposition (ADR-020, Kamino-style): for each
// closed position, split the lifetime result into fees earned, realized IL
// (composition drift vs holding the deposit, valued at exit price), the
// closing rebalance's swap cost, and its network fees. `net = fees + il −
// swapCost − networkFee` — the same "net return = fees − rebalance costs −
// IL" definition Kamino's docs use, computed from data we already record.
// Swaps are attached by time window (swap_signature was never populated on
// rebalances rows); network fees rely on the BUG-010 fee backfill, so rows
// that predate it undercount network costs by ~$0.001 each.
// ────────────────────────────────────────────────────────────────────────────

export interface RebalanceDecompositionRow {
  positionId: number;
  positionMint: string;
  openedAt: string;
  closedAt: string;
  lifetimeMinutes: number | null;
  exitPriceSolUsd: number;
  feesUsd: number;
  ilUsd: number;
  swapCostUsd: number;
  networkFeeUsd: number;
  netUsd: number;
}

export function getRebalanceDecomposition(limit = 15): RebalanceDecompositionRow[] {
  return (
    safe(() => {
      const db = openDb();
      const rows = db
        .prepare(
          `SELECT p.id AS positionId,
                  p.position_mint AS positionMint,
                  p.opened_at AS openedAt,
                  p.closed_at AS closedAt,
                  ROUND((julianday(p.closed_at) - julianday(p.opened_at)) * 1440, 1) AS lifetimeMinutes,
                  p.exit_price_sol_usd AS exitPriceSolUsd,
                  COALESCE(p.claimed_fees_sol, 0) * p.exit_price_sol_usd
                    + COALESCE(p.claimed_fees_usdc, 0) AS feesUsd,
                  (COALESCE(p.exit_sol, 0) - p.deposit_sol) * p.exit_price_sol_usd
                    + (COALESCE(p.exit_usdc, 0) - p.deposit_usdc) AS ilUsd,
                  COALESCE((SELECT SUM(CASE WHEN s.direction = 'USDC_TO_SOL'
                                THEN s.input_amount - s.actual_output * s.price_sol_usd
                                ELSE s.input_amount * s.price_sol_usd - s.actual_output END)
                            FROM swaps s
                            WHERE s.success = 1
                              AND s.actual_output IS NOT NULL
                              AND s.price_sol_usd IS NOT NULL
                              AND s.timestamp >= r.triggered_at
                              AND s.timestamp <= COALESCE(r.completed_at, r.triggered_at)), 0) AS swapCostUsd,
                  COALESCE((SELECT SUM(t.fee_usd) FROM transactions t
                            WHERE t.signature IN (r.withdraw_signature, r.create_signature)
                               OR (t.kind = 'swap'
                                   AND t.timestamp >= r.triggered_at
                                   AND t.timestamp <= COALESCE(r.completed_at, r.triggered_at))), 0) AS networkFeeUsd
           FROM positions p
           LEFT JOIN rebalances r ON r.old_position_id = p.id AND r.success = 1
           WHERE p.closed_at IS NOT NULL AND p.exit_price_sol_usd IS NOT NULL
           ORDER BY p.closed_at DESC
           LIMIT ?`,
        )
        .all(limit) as Omit<RebalanceDecompositionRow, 'netUsd'>[];
      return rows.map((row) => ({
        ...row,
        netUsd: row.feesUsd + row.ilUsd - row.swapCostUsd - row.networkFeeUsd,
      }));
    }, 'getRebalanceDecomposition') ?? []
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Position lifetime buckets — the "trend-tax" measurement behind the
// range-geometry check (strategy-analyzer). Sub-15-minute positions are the
// signature of recentering into a still-moving price: fees have no time to
// accrue while the recenter locks a full traversal's IL. A healthy narrow
// range shows fees/|IL| ≈ 1 in the longer buckets and few short-lived rows.
// ────────────────────────────────────────────────────────────────────────────

export interface PositionLifetimeBucketRow {
  bucket: '<15min' | '15-45min' | '>45min';
  positions: number;
  avgLifeMin: number;
  feesUsd: number;
  ilUsd: number;
  /** feesUsd + ilUsd — LP-side net before rebalance tx costs. */
  netUsd: number;
}

export function getPositionLifetimeBuckets(sinceIso?: string): PositionLifetimeBucketRow[] {
  return (
    safe(() => {
      const db = openDb();
      const rows = db
        .prepare(
          `SELECT CASE WHEN lifeMin < 15 THEN '<15min'
                       WHEN lifeMin < 45 THEN '15-45min'
                       ELSE '>45min' END AS bucket,
                  COUNT(*) AS positions,
                  ROUND(AVG(lifeMin), 1) AS avgLifeMin,
                  SUM(feesUsd) AS feesUsd,
                  SUM(ilUsd) AS ilUsd,
                  SUM(feesUsd + ilUsd) AS netUsd
           FROM (
             SELECT (julianday(p.closed_at) - julianday(p.opened_at)) * 1440 AS lifeMin,
                    COALESCE(p.claimed_fees_sol, 0) * p.exit_price_sol_usd
                      + COALESCE(p.claimed_fees_usdc, 0) AS feesUsd,
                    (COALESCE(p.exit_sol, 0) - p.deposit_sol) * p.exit_price_sol_usd
                      + (COALESCE(p.exit_usdc, 0) - p.deposit_usdc) AS ilUsd
             FROM positions p
             WHERE p.closed_at IS NOT NULL
               AND p.exit_price_sol_usd IS NOT NULL
               AND (? IS NULL OR p.opened_at >= ?)
           )
           GROUP BY bucket
           ORDER BY CASE bucket WHEN '<15min' THEN 0 WHEN '15-45min' THEN 1 ELSE 2 END`,
        )
        .all(sinceIso ?? null, sinceIso ?? null) as PositionLifetimeBucketRow[];
      return rows;
    }, 'getPositionLifetimeBuckets') ?? []
  );
}

export interface LatestSnapshotForPosition {
  positionId: number;
  takenAt: string;
  positionValueUsd: number;
  hodlOnlySolValueUsd: number;
  hodlOnlyUsdcValueUsd: number;
  hodl5050ValueUsd: number;
  unclaimedFeesSol: number;
  unclaimedFeesUsdc: number;
  currentPriceSolUsd: number;
}

export function getLatestSnapshotForPosition(
  positionId: number,
): LatestSnapshotForPosition | null {
  const db = openDb();
  const row = db
    .prepare(
      `SELECT position_id AS positionId, taken_at AS takenAt,
              position_value_usd AS positionValueUsd,
              hodl_only_sol_value_usd AS hodlOnlySolValueUsd,
              hodl_only_usdc_value_usd AS hodlOnlyUsdcValueUsd,
              hodl_5050_value_usd AS hodl5050ValueUsd,
              unclaimed_fees_sol AS unclaimedFeesSol,
              unclaimed_fees_usdc AS unclaimedFeesUsdc,
              current_price_sol_usd AS currentPriceSolUsd
       FROM position_snapshots
       WHERE position_id = ?
       ORDER BY taken_at DESC
       LIMIT 1`,
    )
    .get(positionId) as LatestSnapshotForPosition | undefined;
  return row ?? null;
}
