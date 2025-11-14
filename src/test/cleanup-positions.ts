/**
 * Cleanup Positions Script
 *
 * This script helps clean up state.json when auto-tune mode has accumulated
 * multiple position mints. It will keep only the FIRST (most recent) position
 * and remove the rest.
 *
 * Usage:
 *   pnpm tsx src/test/cleanup-positions.ts
 */

import { loadState, saveState } from '../modules/persistence.js';

async function cleanupPositions() {
  console.log('\n=== Position Cleanup Utility ===\n');

  const state = loadState();

  if (!state) {
    console.log('❌ No state file found at data/state.json');
    return;
  }

  if (!state.createdPositionMints || state.createdPositionMints.length === 0) {
    console.log('✅ No positions in state - nothing to clean up');
    return;
  }

  console.log('Current positions in state:', {
    count: state.createdPositionMints.length,
    mints: state.createdPositionMints,
  });

  if (state.createdPositionMints.length === 1) {
    console.log('\n✅ Only 1 position found - state is clean!');
    return;
  }

  // For auto-tune mode, we only need the FIRST position (most recent)
  const keepPosition = state.createdPositionMints[0];
  const removedPositions = state.createdPositionMints.slice(1);

  console.log('\n🧹 Cleaning up state.json...');
  console.log('  Keeping:', keepPosition);
  console.log('  Removing:', removedPositions);

  // Update state
  state.createdPositionMints = [keepPosition];
  state.timestamp = Date.now();

  // Save updated state
  saveState(state);

  console.log('\n✅ State cleaned successfully!');
  console.log('  New position count:', state.createdPositionMints.length);
  console.log('  Active position:', state.createdPositionMints[0]);
  console.log('\nℹ️  Note: The removed positions may still exist on-chain.');
  console.log('   You can manually close them to reclaim rent (~0.057 SOL each).');
  console.log('   Use: https://app.meteora.ag/dlmm or the API /api/positions/close endpoint\n');
}

cleanupPositions();
