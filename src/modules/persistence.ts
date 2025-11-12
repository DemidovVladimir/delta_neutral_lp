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
