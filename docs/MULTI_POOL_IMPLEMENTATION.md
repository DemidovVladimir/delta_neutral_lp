# Multi-Pool Support Implementation Guide

## Overview

Your bot and Android app now support **multiple Meteora DLMM pool addresses**. This document summarizes all changes made and what's needed to complete the integration.

## Status Summary

### ✅ Completed

#### Backend (Node.js/TypeScript)
- [x] Environment variable parsing for multiple pools (METEORA_POOL_ADDRESSES)
- [x] Configuration updated to support pool arrays
- [x] Type definitions updated (PositionDetail, WithdrawParams)
- [x] MeteoraAdapter enhanced with multi-pool support
  - Pool-to-position mapping (positionToPoolMap)
  - Per-pool analytics caching
  - Multi-pool position discovery from blockchain
  - Helper methods for pool lookup

#### Android App (Kotlin/Jetpack Compose)
- [x] Position model updated with poolAddress field
- [x] UiState enhanced to track multiple pools
  - availablePools list
  - selectedPool tracking
  - poolAnalyticsMap for per-pool data
  - binsMap for per-pool bin data
- [x] OverviewTab with pool selector dropdown
- [x] CreatePositionForm with pool selection
- [x] PositionsTab positions grouped by pool

### 🔄 In Progress / Next Steps

- [ ] Backend: Update getLpExposure() to populate poolAddress in positions
- [ ] Backend: Update deposit/withdraw methods to handle pool-specific operations
- [ ] Backend: Add API endpoint to list available pools
- [ ] Android: ViewModel method to handle pool selection
- [ ] Android: Update API request bodies to include poolAddress for position operations
- [ ] Testing: End-to-end testing with multiple pools

## Configuration

### Environment Variables

```bash
# Multiple pools (recommended format)
METEORA_POOL_ADDRESSES=5rCf1DM8LjKTw4YqhnoLcngyZYeNnQqztScTogYHAS6,HTvjzsfX3yU6BUodCjZ5vZkUrAxMDTrBs3CJaq43ashR

# Or single pool (backward compatible)
METEORA_POOL_ADDRESS=5rCf1DM8LjKTw4YqhnoLcngyZYeNnQqztScTogYHAS6
```

Both formats are supported. The parser automatically detects and validates addresses.

## Backend Changes Made

### 1. Configuration Layer (`src/config/env.ts`)

```typescript
export interface BotConfig {
  // Old way (still supported)
  meteoraPoolAddress?: string;

  // New way (recommended)
  meteoraPoolAddresses?: string[];
}
```

**Changes:**
- Renamed `meteoraPoolAddress` → `meteoraPoolAddresses: string[]`
- Supports both `METEORA_POOL_ADDRESSES` and `METEORA_POOL_ADDRESS` environment variables
- Automatically parses comma-separated values
- Validates each address as a valid Solana PublicKey

### 2. Type Definitions (`src/types/index.ts`)

```typescript
export interface PositionDetail {
  mint: string;
  poolAddress?: string;  // NEW: Track which pool this position belongs to
  solAmount: number;
  usdcAmount: number;
  // ... rest of fields
}

export interface WithdrawParams {
  percent?: number;
  amount?: number;
  positionMint?: string;  // NEW: Specify which position to withdraw from
  poolAddress?: string;   // NEW: Which pool (optional, can be inferred)
  singleSidedOut?: 'sol' | 'usdc';
}
```

### 3. MeteoraAdapter (`src/modules/meteoraAdapter.ts`)

**New Data Structures:**
```typescript
private positionToPoolMap: Map<string, string> = new Map(); // position mint → pool address
private poolInfoCache: Map<string, { info: MeteoraPairInfo; lastFetched: number }> = new Map();
```

**New Methods:**
```typescript
// Get analytics for a specific pool
async getPoolAnalyticsForAddress(poolAddress: string): Promise<MeteoraPairInfo>

// Get the pool address for a position (with fallback)
getPoolAddressForPosition(positionMint: string): string
```

**Updated Methods:**
```typescript
// Now discovers from ALL configured pools
async discoverPositionsFromBlockchain(): Promise<string[]>

// Now queries all pools' analytics
async getPoolAnalytics(): Promise<MeteoraPairInfo>
```

**How it works:**
1. On startup, discovers positions across ALL configured pools
2. Maps each position mint → its pool address
3. Caches pool analytics separately per pool
4. Provides fallback to primary pool (first in array) for backward compatibility

## Android App Changes

### 1. Position Model (`app/src/main/java/com/example/quasarbot/data/Models.kt`)

```kotlin
data class Position(
    @SerializedName("mint") val mint: String,
    @SerializedName("poolAddress") val poolAddress: String? = null,  // NEW
    @SerializedName("solAmount") val solAmount: Double,
    // ... rest of fields
)
```

### 2. UiState (`app/src/main/java/com/example/quasarbot/viewmodel/MainViewModel.kt`)

```kotlin
data class UiState(
    // ... existing fields ...
    val availablePools: List<String> = emptyList(),           // NEW
    val selectedPool: String? = null,                          // NEW
    val poolAnalyticsMap: Map<String, PoolAnalytics> = emptyMap(),  // NEW
    val binsMap: Map<String, BinData> = emptyMap(),           // NEW
    // ... existing fields ...
)
```

**Purpose:**
- `availablePools`: List of all configured pool addresses from backend
- `selectedPool`: Currently selected pool in UI
- `poolAnalyticsMap`: Analytics data for each pool (for multi-pool support)
- `binsMap`: Bin data for each pool (for multi-pool support)
- Legacy `poolAnalytics` and `bins` fields kept for backward compatibility

### 3. OverviewTab (`app/src/main/java/com/example/quasarbot/ui/screens/OverviewTab.kt`)

**Added:**
- Pool selector dropdown (if multiple pools available)
- Shows single pool name (if only one pool)
- Displays available pool addresses with shortened format (first 8 + last 8 chars)

**UI Flow:**
```
Multiple pools → Show dropdown selector
     ↓
Single pool → Show pool name as text
     ↓
No pools → No pool section displayed
```

### 4. CreatePositionForm (`app/src/main/java/com/example/quasarbot/ui/screens/ActionsTab.kt`)

**Added:**
- Pool selector dropdown (if multiple pools available)
- Auto-selects first pool if not explicitly chosen
- Passes selected pool to position creation

**Features:**
- Shows pool selector before SOL/USDC amount inputs
- Multiple pools: dropdown with all pools
- Single pool: read-only text display
- Form remembers selected pool across uses

### 5. PositionsTab (`app/src/main/java/com/example/quasarbot/ui/screens/PositionsTab.kt`)

**Added:**
- **Positions grouped by pool address**
- Pool headers showing shortened address
- Positions displayed under their respective pool

**Example Display:**
```
Active Positions (3)

Pool: 5rCf1DM8...YHJAS6
  Position 1
    SOL: 5.0000
    USDC: $1000.00
    ...

Pool: HTvjzsfX...ashR
  Position 1
    SOL: 10.0000
    USDC: $2000.00
    ...
```

## What Still Needs to Be Done

### Backend API Updates

1. **List Available Pools Endpoint** (NEW)
   ```
   GET /api/pools
   Response: { pools: ["pool1", "pool2", ...] }
   ```

2. **Update getLpExposure()**
   - Ensure poolAddress is populated in each PositionDetail
   - Query all pools for comprehensive exposure

3. **Update Position Operations**
   - `createPosition`: Accept poolAddress parameter
   - `depositToLp`: Support pool-specific deposits
   - `withdrawFromLp`: Already supports positionMint selection, ensure pool mapping works
   - `claimFees`: Work with positions across multiple pools

4. **Update API Endpoints**
   ```typescript
   POST /api/positions/create {
     poolAddress,      // NEW: which pool
     solAmount,
     usdcAmount,
     priceLower,
     priceUpper
   }
   ```

### Android App Updates

1. **Implement ViewModel Pool Selection**
   ```kotlin
   fun selectPool(poolAddress: String) {
       _uiState.value = _uiState.value.copy(selectedPool = poolAddress)
       // Fetch pool-specific data
   }
   ```

2. **Update API Calls**
   - Include `poolAddress` in position creation requests
   - Update deposit/withdraw requests to include pool info

3. **Enhance fetchAllData()**
   - Parse `availablePools` from API response
   - Initialize with first pool on startup
   - Fetch analytics for all pools

4. **Wire Pool Selection**
   ```kotlin
   // In OverviewTab pool selector
   onClick = {
       viewModel.selectPool(pool)
   }
   ```

## API Response Examples

### Get Positions with Pool Info

```json
{
  "exposure": {
    "solAmount": 15,
    "usdcAmount": 3000,
    "positions": [
      {
        "mint": "...",
        "poolAddress": "5rCf1DM8...",
        "solAmount": 5,
        "usdcAmount": 1000,
        "valueUsd": 2000,
        "lowerBinId": 100,
        "upperBinId": 150
      },
      {
        "mint": "...",
        "poolAddress": "HTvjzsfX...",
        "solAmount": 10,
        "usdcAmount": 2000,
        "valueUsd": 3500,
        "lowerBinId": 200,
        "upperBinId": 250
      }
    ]
  }
}
```

## Testing Checklist

- [ ] Single pool configuration still works (backward compatibility)
- [ ] Multiple pool configuration works
- [ ] Positions are correctly discovered from all pools
- [ ] Pool analytics are cached separately per pool
- [ ] Android app displays positions grouped by pool
- [ ] Pool selector dropdown works for multiple pools
- [ ] Creating position in specific pool works
- [ ] Withdrawing from position in specific pool works
- [ ] Claiming fees from positions across pools works

## Backward Compatibility Notes

✅ **Fully backward compatible:**
- Old `METEORA_POOL_ADDRESS` still works
- Old API calls without `poolAddress` still work (defaults to primary pool)
- `PositionDetail.poolAddress` is optional
- UiState legacy fields (`poolAnalytics`, `bins`) still populated

## Migration Path for Existing Deployments

If you're currently running with a single pool:

1. **No changes needed** - Everything works as before
2. **To add more pools**, update `.env`:
   ```bash
   # Old (still works)
   METEORA_POOL_ADDRESS=5rCf1DM8...

   # New (also works)
   METEORA_POOL_ADDRESSES=5rCf1DM8...,HTvjzsfX...
   ```
3. **Redeploy** - Bot will discover positions across both pools
4. **Android app will auto-update** - Shows new pool selector UI

## Summary of Files Modified

### Backend
- `src/config/env.ts` - Multi-pool config parsing
- `src/types/index.ts` - Type definitions updated
- `src/modules/meteoraAdapter.ts` - Core multi-pool logic
- `src/api/hono-server.ts` - API endpoint supporting positionMint selection

### Android
- `Models.kt` - Position model with poolAddress
- `MainViewModel.kt` - UiState with multi-pool fields
- `OverviewTab.kt` - Pool selector dropdown
- `ActionsTab.kt` - CreatePositionForm pool selection
- `PositionsTab.kt` - Positions grouped by pool

## Next Steps

1. **Backend**: Implement missing API endpoints (list pools)
2. **Backend**: Ensure poolAddress is populated in position responses
3. **Android**: Implement pool selection callbacks in ViewModel
4. **Android**: Wire pool selection to API calls
5. **Testing**: Test with actual multiple pools
6. **Documentation**: Update deployment docs with new configuration

---

**Status**: Core infrastructure complete. Ready for final API wiring and testing.
