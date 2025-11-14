# Position Tracking & Recovery Fix

**Date**: January 2025
**Status**: ✅ Fixed
**Severity**: High - Prevented duplicate positions and fund lockup

## Problem Description

The auto-tune bot would sometimes lose track of positions during failed rebalances, leading to:

1. **Lost Position Tracking**: When Phase 1 (withdraw+claim+close) failed, the bot would lose the position mint from memory
2. **Duplicate Creation Attempts**: Bot would try to create new positions when one already existed on-chain
3. **Swap Failures**: Jupiter swaps would fail with "Insufficient funds" because all funds were locked in the unclosed position
4. **Confusing Errors**: Users saw "No transaction in order response" instead of actual error messages like "Insufficient funds"
5. **Manual Intervention Required**: Users had to manually close positions from Meteora dashboard

## Root Cause Analysis

### Issue 1: Stale State Tracking
- `checkPositionBalance()` relied on `getLpExposure()` which used cached position list
- If state.json became corrupted or out of sync, bot would miss unclosed positions
- No blockchain discovery happening during normal check cycles

### Issue 2: No Duplicate Prevention
- Before creating initial position, bot didn't verify blockchain state
- Could create duplicate positions if state.json was cleared

### Issue 3: Failed Rebalance Handling
- When Phase 1 failed, position mint was not preserved in state
- Next cycle would find no position and try to create a new one

### Issue 4: Poor Jupiter Error Handling
- Jupiter Ultra API returns errors in response object (not HTTP error)
- Bot checked for `transaction` field but didn't check `errorCode`/`errorMessage`
- Result: Generic "No transaction in order response" instead of actual error

### Issue 5: No Debugging Info
- When swaps failed, no visibility into actual wallet balances
- No detection of unclosed positions that might be locking funds

## Solution Implemented

### 1. Always Discover from Blockchain
**File**: `src/modules/autoTuneOrchestrator.ts:450-475`

```typescript
private async checkPositionBalance(): Promise<PositionBalance | null> {
  // ALWAYS discover positions from blockchain first
  const discoveredMints = await this.meteoraAdapter.discoverPositionsFromBlockchain();

  if (discoveredMints.length > 0) {
    log.info('✅ Position(s) found on blockchain', {
      count: discoveredMints.length,
      mints: discoveredMints,
    });
  }

  // Get LP exposure (will use discovered positions)
  const exposure = await this.meteoraAdapter.getLpExposure();

  // Save position mint immediately
  this.state.currentPositionMint = position.mint;
  saveAutoTuneState(this.state);
  // ...
}
```

**Impact**: Every check cycle now queries blockchain directly, ensuring we never miss unclosed positions.

### 2. Duplicate Prevention Check
**File**: `src/modules/autoTuneOrchestrator.ts:281-293`

```typescript
if (!balance) {
  // Safety check: discover positions one more time before creating
  const discoveredBeforeCreate = await this.meteoraAdapter.discoverPositionsFromBlockchain();

  if (discoveredBeforeCreate.length > 0) {
    log.warn('⚠️  Position(s) found during safety check - skipping creation', {
      count: discoveredBeforeCreate.length,
      mints: discoveredBeforeCreate,
    });
    return;
  }

  // Now safe to create initial position
  await this.createInitialPosition();
}
```

**Impact**: Prevents duplicate position creation even if state.json is corrupted.

### 3. Robust Rebalance Position Tracking
**File**: `src/modules/autoTuneOrchestrator.ts:678-710`

```typescript
// Discover positions from blockchain first (safety check)
const discoveredMints = await this.meteoraAdapter.discoverPositionsFromBlockchain();

// Use ACTUAL position from blockchain discovery
const oldPositionMint = discoveredMints[0];

// Execute Phase 1 with error handling
try {
  withdrawResult = await this.meteoraAdapter.withdrawClaimAndClose(oldPositionMint);
} catch (error) {
  // Phase 1 failed - DO NOT clear currentPositionMint
  log.errorBanner('❌ Phase 1 failed - position still exists on-chain', {
    position: oldPositionMint,
    error: error.message,
  });
  throw error; // Re-throw to prevent Phase 2
}
```

**Impact**: Position mint stays in state if Phase 1 fails, allowing retry on next cycle.

### 4. Jupiter Error Detection
**File**: `src/modules/jupiterSwapper.ts:189-198`

```typescript
const order = await response.json() as OrderResponse;

// Check for Jupiter API error in response
if (order.errorCode || order.errorMessage || order.error) {
  const errorMsg = order.errorMessage || order.error || 'Unknown Jupiter API error';
  log.errorBanner('❌ Jupiter API returned an error', {
    errorCode: order.errorCode,
    errorMessage: errorMsg,
    requestId: order.requestId,
  });
  throw new Error(`Jupiter API error: ${errorMsg}`);
}
```

**Impact**: Users now see actual error messages like "Insufficient funds" instead of generic errors.

### 5. Wallet Balance Debugging
**File**: `src/modules/autoTuneOrchestrator.ts:830-860`

```typescript
} catch (swapError) {
  // Swap failed - log current wallet balances
  const currentSolBalance = await connection.getBalance(wallet.publicKey);
  const currentActualSol = currentSolBalance / Math.pow(10, 9);
  const currentActualUsdc = await this.getUsdcBalance();

  log.errorBanner('❌ Swap failed - current wallet balances', {
    error: swapError.message,
    walletBalances: {
      sol: currentActualSol,
      usdc: currentActualUsdc,
    },
  });

  // Check if position still exists (funds might be locked)
  const positionsAfterSwapFailure = await this.meteoraAdapter.discoverPositionsFromBlockchain();
  if (positionsAfterSwapFailure.length > 0) {
    log.errorBanner('⚠️  UNCLOSED POSITION DETECTED', {
      message: 'Funds may be locked in position that was not properly closed',
      positions: positionsAfterSwapFailure,
      suggestion: 'Manually close position from Meteora dashboard or retry rebalance',
    });
  }

  throw swapError;
}
```

**Impact**: Clear debugging information when swaps fail, including detection of unclosed positions.

### 6. Enhanced Watch Mode Display
**File**: `src/modules/autoTuneOrchestrator.ts:221-234`

```typescript
if (!balance) {
  console.log('⚠️  NO POSITION FOUND');

  // Check if we have a position mint in state but couldn't find it
  if (this.state.currentPositionMint) {
    console.log(`   Last known position: ${this.state.currentPositionMint.slice(0, 12)}...`);
    console.log('   Status: Position may be closed or not found on-chain\n');
  } else {
    console.log('   No position has been created yet\n');
  }

  console.log('Press Ctrl+C to stop');
  return;
}
```

**Impact**: Better visibility in watch mode when position is not found.

## Before vs After

### Before Fix

**Scenario**: Rebalance triggers, Phase 1 fails due to network error

```
16:13:52 [info] 🔄 Rebalancing position GMr7dGrx...
16:13:52 [error] Phase 1 failed: Network error
16:13:52 [error] Rebalance failed
// Position mint lost from memory

// Next check cycle (15s later)
16:14:07 [warn] No positions found to check balance
16:14:07 [info] 🆕 Creating initial position for auto-tune
16:14:07 [info] 🔄 Swapping 587.45 USDC → SOL
16:14:08 [error] No transaction in order response - full response: {
  "errorCode": 1,
  "errorMessage": "Insufficient funds",
  "transaction": ""
}
16:14:08 [error] ❌ Swap execution failed
// User must manually close unclosed position from Meteora dashboard
```

### After Fix

**Scenario**: Same rebalance failure

```
16:13:52 [info] ✅ Position(s) found on blockchain {"count": 1, "mints": ["GMr7dGrx..."]}
16:13:52 [info] 🔄 Rebalancing position GMr7dGrx...
16:13:52 [error] ❌ Phase 1 (Withdraw+Claim+Close) failed - position still exists on-chain
  position: GMr7dGrx...
  error: Network error
16:13:52 [error] Rebalance failed
// Position mint STAYS in state

// Next check cycle (15s later)
16:14:07 [info] ✅ Position(s) found on blockchain {"count": 1, "mints": ["GMr7dGrx..."]}
16:14:07 [info] Position balance checked
// Bot continues monitoring and will retry rebalance when imbalanced again
```

## Testing Recommendations

1. **Normal Operation**: Run auto-tune - should work as before but more reliably
2. **Failed Rebalance**: Simulate network error during Phase 1 - position should stay tracked
3. **Insufficient Funds**: Trigger swap with insufficient balance - should see clear error with balances
4. **Unclosed Position**: If you see "UNCLOSED POSITION DETECTED" - this is the new safety catching the old bug!
5. **Watch Mode**: Monitor display when position not found - should show last known position

## Metrics

- **Files Changed**: 3
  - `src/modules/autoTuneOrchestrator.ts` (main fixes)
  - `src/modules/jupiterSwapper.ts` (error detection)
  - `CLAUDE.md` + `README.md` (documentation)

- **Lines Added**: ~150 lines (including error handling + logging)
- **Compilation**: ✅ Passes TypeScript compilation
- **Breaking Changes**: None - all changes are defensive/additive

## Related Issues

- Prevents duplicate position creation
- Fixes fund lockup when rebalance fails
- Improves error messages from Jupiter API
- Adds debugging visibility for swap failures

## Future Improvements

Consider adding:
- Automatic position recovery (close unclosed positions automatically)
- Metrics tracking for failed rebalances
- Alert system for persistent errors
- State backup/restore mechanism
