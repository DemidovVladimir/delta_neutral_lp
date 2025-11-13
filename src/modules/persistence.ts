/**
 * State Persistence Module
 *
 * Handles saving and loading bot state to/from JSON files:
 * - data/state.json: Latest state snapshot
 * - data/journal.jsonl: Append-only action log
 */

import * as fs from 'fs';
import * as path from 'path';
import { StateSnapshot, JournalEntry, AutoTuneState } from '../types/index.js';
import { log } from '../utils/logger.js';
import { PERSISTENCE_CONFIG } from '../config/constants.js';

// Ensure data directory exists
const dataDir = path.dirname(PERSISTENCE_CONFIG.stateFile);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
  log.info('Created data directory', { path: dataDir });
}

/**
 * Save current state snapshot to disk
 */
export function saveState(snapshot: StateSnapshot): void {
  try {
    const json = JSON.stringify(snapshot, null, 2);
    fs.writeFileSync(PERSISTENCE_CONFIG.stateFile, json, 'utf-8');

    log.debug('State saved', {
      file: PERSISTENCE_CONFIG.stateFile,
      timestamp: snapshot.timestamp,
    });
  } catch (error) {
    log.error('Failed to save state', {
      error: error instanceof Error ? error.message : String(error),
      file: PERSISTENCE_CONFIG.stateFile,
    });
    // Don't throw - state saving is not critical
  }
}

/**
 * Load last saved state from disk
 * Returns null if no state file exists
 */
export function loadState(): StateSnapshot | null {
  try {
    if (!fs.existsSync(PERSISTENCE_CONFIG.stateFile)) {
      log.info('No existing state file found');
      return null;
    }

    const json = fs.readFileSync(PERSISTENCE_CONFIG.stateFile, 'utf-8');
    const state = JSON.parse(json) as StateSnapshot;

    log.info('State loaded', {
      file: PERSISTENCE_CONFIG.stateFile,
      timestamp: state.timestamp,
      hasPositionMints: !!state.createdPositionMints,
      positionCount: state.createdPositionMints?.length || 0,
    });

    return state;
  } catch (error) {
    log.error('Failed to load state', {
      error: error instanceof Error ? error.message : String(error),
      file: PERSISTENCE_CONFIG.stateFile,
    });
    return null;
  }
}

/**
 * Append action to journal
 */
export function appendToJournal(entry: JournalEntry): void {
  try {
    const line = JSON.stringify(entry) + '\n';
    fs.appendFileSync(PERSISTENCE_CONFIG.journalFile, line, 'utf-8');

    log.debug('Journal entry appended', {
      action: entry.action,
      success: entry.success,
      durationMs: entry.durationMs,
    });
  } catch (error) {
    log.error('Failed to append to journal', {
      error: error instanceof Error ? error.message : String(error),
      file: PERSISTENCE_CONFIG.journalFile,
    });
    // Don't throw - journal is not critical
  }
}

/**
 * Load created position mints from saved state
 * Returns empty array if no state or no mints
 */
export function loadCreatedPositionMints(): string[] {
  const state = loadState();
  if (!state || !state.createdPositionMints) {
    return [];
  }

  log.info('Loaded created position mints from state', {
    count: state.createdPositionMints.length,
    mints: state.createdPositionMints,
  });

  return state.createdPositionMints;
}

/**
 * Save created position mints to state
 * Creates a minimal state snapshot if none exists
 */
export function saveCreatedPositionMints(mints: string[]): void {
  const existingState = loadState();

  const snapshot: StateSnapshot = existingState || {
    timestamp: Date.now(),
    lpExposure: {
      solAmount: 0,
      usdcAmount: 0,
      totalUsd: 0,
      claimableSol: 0,
      claimableUsdc: 0,
      positions: [],
    },
    price: {
      usd: 0,
      timestamp: Date.now(),
      source: 'cached',
    },
  };

  // Update with new mints
  snapshot.createdPositionMints = mints;
  snapshot.timestamp = Date.now();

  saveState(snapshot);

  log.info('Saved created position mints to state', {
    count: mints.length,
    mints,
  });
}

/**
 * Clear state file (useful for testing)
 */
export function clearState(): void {
  try {
    if (fs.existsSync(PERSISTENCE_CONFIG.stateFile)) {
      fs.unlinkSync(PERSISTENCE_CONFIG.stateFile);
      log.info('State file cleared');
    }
  } catch (error) {
    log.error('Failed to clear state', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Clear journal file (useful for testing)
 */
export function clearJournal(): void {
  try {
    if (fs.existsSync(PERSISTENCE_CONFIG.journalFile)) {
      fs.unlinkSync(PERSISTENCE_CONFIG.journalFile);
      log.info('Journal file cleared');
    }
  } catch (error) {
    log.error('Failed to clear journal', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Auto-tune state file path
 */
const AUTO_TUNE_STATE_FILE = path.join(dataDir, 'auto-tune-state.json');

/**
 * Save auto-tune state to disk
 */
export function saveAutoTuneState(state: AutoTuneState): void {
  try {
    const json = JSON.stringify(state, null, 2);
    fs.writeFileSync(AUTO_TUNE_STATE_FILE, json, 'utf-8');

    log.debug('Auto-tune state saved', {
      file: AUTO_TUNE_STATE_FILE,
      iteration: state.iteration,
      rebalanceCount: state.rebalanceCount,
    });
  } catch (error) {
    log.error('Failed to save auto-tune state', {
      error: error instanceof Error ? error.message : String(error),
      file: AUTO_TUNE_STATE_FILE,
    });
  }
}

/**
 * Load auto-tune state from disk
 * Returns null if no state file exists
 */
export function loadAutoTuneState(): AutoTuneState | null {
  try {
    if (!fs.existsSync(AUTO_TUNE_STATE_FILE)) {
      log.info('No existing auto-tune state file found');
      return null;
    }

    const json = fs.readFileSync(AUTO_TUNE_STATE_FILE, 'utf-8');
    const state = JSON.parse(json) as AutoTuneState;

    // Ensure all required properties exist with defaults (for backward compatibility)
    if (!state.totalClaimedFees) {
      state.totalClaimedFees = { sol: 0, usdc: 0 };
      log.info('Added missing totalClaimedFees property to loaded state');
    }
    if (!state.unclaimedFees) {
      state.unclaimedFees = { sol: 0, usdc: 0 };
      log.info('Added missing unclaimedFees property to loaded state');
    }

    log.info('Auto-tune state loaded', {
      file: AUTO_TUNE_STATE_FILE,
      iteration: state.iteration,
      rebalanceCount: state.rebalanceCount,
      lastCheck: state.lastCheck,
      lastRebalance: state.lastRebalance,
    });

    return state;
  } catch (error) {
    log.error('Failed to load auto-tune state', {
      error: error instanceof Error ? error.message : String(error),
      file: AUTO_TUNE_STATE_FILE,
    });
    return null;
  }
}

/**
 * Clear auto-tune state file (useful for testing)
 */
export function clearAutoTuneState(): void {
  try {
    if (fs.existsSync(AUTO_TUNE_STATE_FILE)) {
      fs.unlinkSync(AUTO_TUNE_STATE_FILE);
      log.info('Auto-tune state file cleared');
    }
  } catch (error) {
    log.error('Failed to clear auto-tune state', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Add transaction fee to state tracking
 *
 * @param signature - Transaction signature
 * @param feeSol - Fee paid in SOL
 * @param feeUsd - Fee paid in USD (approximate)
 * @param operation - Operation type (e.g., "createPosition", "withdraw", "claim", "swap")
 */
export function addTransactionFee(
  signature: string,
  feeSol: number,
  feeUsd: number,
  operation: string
): void {
  try {
    const state = loadState();

    // Initialize state if not exists
    const snapshot: StateSnapshot = state || {
      timestamp: Date.now(),
      lpExposure: {
        solAmount: 0,
        usdcAmount: 0,
        totalUsd: 0,
        claimableSol: 0,
        claimableUsdc: 0,
        positions: [],
      },
      price: {
        usd: 0,
        timestamp: Date.now(),
        source: 'cached',
      },
    };

    // Initialize transactionFees if not exists
    if (!snapshot.transactionFees) {
      snapshot.transactionFees = {
        totalFeeSol: 0,
        totalFeeUsd: 0,
        operationCount: 0,
        breakdown: {},
      };
    }

    // Update totals
    snapshot.transactionFees.totalFeeSol += feeSol;
    snapshot.transactionFees.totalFeeUsd += feeUsd;
    snapshot.transactionFees.operationCount += 1;

    // Update breakdown for this operation type
    if (!snapshot.transactionFees.breakdown[operation]) {
      snapshot.transactionFees.breakdown[operation] = {
        count: 0,
        totalFeeSol: 0,
        totalFeeUsd: 0,
        signatures: [],
      };
    }

    snapshot.transactionFees.breakdown[operation].count += 1;
    snapshot.transactionFees.breakdown[operation].totalFeeSol += feeSol;
    snapshot.transactionFees.breakdown[operation].totalFeeUsd += feeUsd;
    snapshot.transactionFees.breakdown[operation].signatures.push(signature);

    // Update timestamp
    snapshot.timestamp = Date.now();

    // Save updated state
    saveState(snapshot);

    log.debug('Transaction fee added to state', {
      operation,
      feeSol: feeSol.toFixed(6),
      feeUsd: feeUsd.toFixed(4),
      signature: signature.slice(0, 8) + '...',
    });
  } catch (error) {
    log.error('Failed to add transaction fee to state', {
      error: error instanceof Error ? error.message : String(error),
      operation,
    });
    // Don't throw - fee tracking is not critical
  }
}

/**
 * Get total transaction fees from state
 * Returns summary of all tracked transaction fees
 */
export function getTransactionFees(): {
  totalFeeSol: number;
  totalFeeUsd: number;
  operationCount: number;
  breakdown: Record<string, {
    count: number;
    totalFeeSol: number;
    totalFeeUsd: number;
    signatures: string[];
  }>;
} | null {
  try {
    const state = loadState();
    if (!state || !state.transactionFees) {
      return null;
    }

    return state.transactionFees;
  } catch (error) {
    log.error('Failed to get transaction fees from state', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Log transaction fee summary
 * Displays total fees and breakdown by operation type
 */
export function logTransactionFeeSummary(): void {
  const fees = getTransactionFees();

  if (!fees) {
    log.info('📊 No transaction fees tracked yet');
    return;
  }

  log.info('📊 Transaction Fee Summary', {
    totalFeeSol: fees.totalFeeSol.toFixed(6),
    totalFeeUsd: fees.totalFeeUsd.toFixed(2),
    operationCount: fees.operationCount,
  });

  // Log breakdown by operation type
  for (const [operation, details] of Object.entries(fees.breakdown)) {
    log.info(`  └─ ${operation}`, {
      count: details.count,
      totalFeeSol: details.totalFeeSol.toFixed(6),
      totalFeeUsd: details.totalFeeUsd.toFixed(2),
      avgFeeSol: (details.totalFeeSol / details.count).toFixed(6),
    });
  }
}

/**
 * Add claimed LP fees to state tracking
 *
 * @param solFees - SOL fees claimed
 * @param usdcFees - USDC fees claimed
 * @param signature - Optional transaction signature
 */
export function addClaimedLpFees(
  solFees: number,
  usdcFees: number,
  signature?: string
): void {
  try {
    const state = loadState();

    // Initialize state if not exists
    const snapshot: StateSnapshot = state || {
      timestamp: Date.now(),
      lpExposure: {
        solAmount: 0,
        usdcAmount: 0,
        totalUsd: 0,
        claimableSol: 0,
        claimableUsdc: 0,
        positions: [],
      },
      price: {
        usd: 0,
        timestamp: Date.now(),
        source: 'cached',
      },
    };

    // Initialize lpFees if not exists
    if (!snapshot.lpFees) {
      snapshot.lpFees = {
        totalClaimedFees: { sol: 0, usdc: 0 },
        currentUnclaimedFees: { sol: 0, usdc: 0 },
        claimHistory: [],
      };
    }

    // Update totals
    snapshot.lpFees.totalClaimedFees.sol += solFees;
    snapshot.lpFees.totalClaimedFees.usdc += usdcFees;

    // Add to claim history
    snapshot.lpFees.claimHistory.push({
      timestamp: Date.now(),
      sol: solFees,
      usdc: usdcFees,
      signature,
    });

    // Reset unclaimed fees (fees were just claimed)
    snapshot.lpFees.currentUnclaimedFees = { sol: 0, usdc: 0 };

    // Update timestamp
    snapshot.timestamp = Date.now();

    // Save updated state
    saveState(snapshot);

    log.debug('LP fees added to state', {
      solFees: solFees.toFixed(6),
      usdcFees: usdcFees.toFixed(2),
      signature: signature ? signature.slice(0, 8) + '...' : 'N/A',
    });
  } catch (error) {
    log.error('Failed to add LP fees to state', {
      error: error instanceof Error ? error.message : String(error),
    });
    // Don't throw - fee tracking is not critical
  }
}

/**
 * Update current unclaimed LP fees
 * Called when getLpExposure() is run to update current claimable amounts
 *
 * @param solFees - Current unclaimed SOL fees
 * @param usdcFees - Current unclaimed USDC fees
 */
export function updateUnclaimedLpFees(solFees: number, usdcFees: number): void {
  try {
    const state = loadState();

    if (!state) {
      log.debug('No state to update unclaimed fees');
      return;
    }

    // Initialize lpFees if not exists
    if (!state.lpFees) {
      state.lpFees = {
        totalClaimedFees: { sol: 0, usdc: 0 },
        currentUnclaimedFees: { sol: 0, usdc: 0 },
        claimHistory: [],
      };
    }

    // Update current unclaimed fees
    state.lpFees.currentUnclaimedFees = {
      sol: solFees,
      usdc: usdcFees,
    };

    // Update timestamp
    state.timestamp = Date.now();

    // Save updated state
    saveState(state);

    log.debug('Unclaimed LP fees updated', {
      solFees: solFees.toFixed(6),
      usdcFees: usdcFees.toFixed(2),
    });
  } catch (error) {
    log.error('Failed to update unclaimed LP fees', {
      error: error instanceof Error ? error.message : String(error),
    });
    // Don't throw - fee tracking is not critical
  }
}

/**
 * Get LP fees summary from state
 */
export function getLpFees(): {
  totalClaimedFees: { sol: number; usdc: number };
  currentUnclaimedFees: { sol: number; usdc: number };
  claimHistory: Array<{ timestamp: number; sol: number; usdc: number; signature?: string }>;
} | null {
  try {
    const state = loadState();
    if (!state || !state.lpFees) {
      return null;
    }

    return state.lpFees;
  } catch (error) {
    log.error('Failed to get LP fees from state', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
