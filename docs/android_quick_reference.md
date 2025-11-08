# Android App - Quick Reference for Multi-Pool Support

## Location
- **Android Project:** `/Users/vladimirdemidov/AndroidStudioProjects/QuasarBot`
- **Main Source:** `app/src/main/java/com/example/quasarbot/`

## Current Architecture: Single Pool Assumption

```
Question 1: Is poolAddress in Position or PositionDetail?
Answer: NO - Position model does NOT have poolAddress field
        Position only has: mint, solAmount, usdcAmount, valueUsd, lowerBinId, upperBinId

Question 2: What about API responses?
Answer: API returns single PoolAnalytics, single BinData, and list of Positions
        - /api/pool/analytics returns ONE PoolAnalytics (no pool parameter)
        - /api/pool/bins returns ONE BinData (no pool parameter)
        - /api/positions returns PositionData with list of positions (no pool filtering)

Question 3: How are positions displayed?
Answer: Flat list, numbered generically as "Position 1", "Position 2", etc.
        No pool context shown. No pool grouping.
        Location: PositionsTab.kt, lines 112-119

Question 4: Is there pool selection UI?
Answer: NO
        - OverviewTab: Only shows ONE pool's analytics (no selector)
        - ActionsTab/CreatePositionForm: No pool dropdown
        - Position withdrawal form: Can select position by mint only (lines 272-321)

Question 5: How does CreatePositionForm handle pool selection?
Answer: It DOESN'T - assumes single pool
        - Uses current price from single oracle: uiState.prices?.sol?.usd
        - Calculates price range: lower = currentPrice * (1 - range/100)
        - No poolAddress parameter in createPosition() call (line 120)
        - No pool selection dropdown

## Quick Search Results

### poolAddress mentions: NONE FOUND
```
Grep search for "pool", "Pool", "poolAddress" in .kt files
Result: No files matched the pattern
This confirms poolAddress is NOT in the codebase.
```

### Position class location
File: `/app/src/main/java/com/example/quasarbot/data/Models.kt` (lines 76-83)

### Pool selection UI: NONE EXISTS
- No dropdown for pool selection in any screen
- No pool selector in OverviewTab
- No pool selector in ActionsTab
- No pool context in PositionsTab

## Files Modified for Multi-Pool Support

### 1. Models.kt - ADD poolAddress to Position
```kotlin
// BEFORE (line 76)
data class Position(
    @SerializedName("mint") val mint: String,
    @SerializedName("solAmount") val solAmount: Double,
    @SerializedName("usdcAmount") val usdcAmount: Double,
    @SerializedName("valueUsd") val valueUsd: Double,
    @SerializedName("lowerBinId") val lowerBinId: Int,
    @SerializedName("upperBinId") val upperBinId: Int
)

// AFTER
data class Position(
    @SerializedName("poolAddress") val poolAddress: String,  // NEW
    @SerializedName("mint") val mint: String,
    @SerializedName("solAmount") val solAmount: Double,
    @SerializedName("usdcAmount") val usdcAmount: Double,
    @SerializedName("valueUsd") val valueUsd: Double,
    @SerializedName("lowerBinId") val lowerBinId: Int,
    @SerializedName("upperBinId") val upperBinId: Int
)
```

### 2. ApiService.kt - ADD pool parameters
```kotlin
// BEFORE (line 13)
@GET("api/pool/analytics")
suspend fun getPoolAnalytics(): Response<PoolAnalytics>

// AFTER
@GET("api/pool/analytics/{poolAddress}")
suspend fun getPoolAnalytics(@Path("poolAddress") poolAddress: String): Response<PoolAnalytics>

// Or add method to get all pools
@GET("api/pools")
suspend fun getAllPools(): Response<List<PoolAnalytics>>
```

### 3. MainViewModel.kt - Change state to support multiple pools
```kotlin
// BEFORE (lines 17-18)
val poolAnalytics: PoolAnalytics? = null,        // SINGLE
val bins: BinData? = null,                       // SINGLE

// AFTER
val poolAnalytics: Map<String, PoolAnalytics>? = null,  // MULTIPLE (by poolAddress key)
val bins: Map<String, BinData>? = null,                 // MULTIPLE (by poolAddress key)
val selectedPoolAddress: String? = null,                 // NEW - track selected pool
```

### 4. OverviewTab.kt - ADD pool selector
- Add ExposedDropdownMenu for pool selection above PoolAnalyticsCard
- Update PoolAnalyticsCard to use selected pool from Map

### 5. PositionsTab.kt - Group positions by pool
```kotlin
// Group positions by pool
val positionsByPool = exposure.positions
    ?.groupBy { it.poolAddress }  // Group by poolAddress
    ?.toSortedMap()

// Display positions grouped
positionsByPool?.forEach { (poolAddress, poolPositions) ->
    Text("Pool: ${poolAddress.take(8)}...")
    poolPositions.forEachIndexed { index, position ->
        PositionCard(position, index, viewModel, isPerformingAction)
    }
}
```

### 6. ActionsTab.kt - ADD pool selector to CreatePositionForm
```kotlin
// NEW: Pool selection dropdown
var selectedPoolAddress by remember { mutableStateOf("") }
val availablePools = uiState.poolAnalytics?.values?.toList() ?: emptyList()

ExposedDropdownMenuBox(
    expanded = expandedPools,
    onExpandedChange = { expandedPools = !expandedPools }
) {
    // Show dropdown with list of pools
    availablePools.forEach { pool ->
        DropdownMenuItem(
            text = { Text("${pool.name} - ${pool.address.take(8)}...") },
            onClick = {
                selectedPoolAddress = pool.address
                expandedPools = false
            }
        )
    }
}

// Pass poolAddress to createPosition
viewModel.createPosition(solAmount, usdcAmount, range, selectedPoolAddress)
```

## Data Flow Changes Required

### Current Flow (Single Pool)
```
API /api/pool/analytics (single)
    ↓
UiState.poolAnalytics: PoolAnalytics
    ↓
OverviewTab.PoolAnalyticsCard (display single)
```

### New Flow (Multi-Pool)
```
API /api/pools OR multiple /api/pool/analytics/{address} calls
    ↓
UiState.poolAnalytics: Map<String, PoolAnalytics>
    ↓
OverviewTab + selector ──→ Shows selected pool analytics
```

## Minimum Changes Checklist

For basic multi-pool support:

1. [ ] Add `poolAddress: String` to Position model
2. [ ] Add `poolAddress` field to CreatePositionRequest (backend needs update too)
3. [ ] Update ApiService to accept pool parameter OR add getAllPools endpoint
4. [ ] Update UiState to use Map<String, PoolAnalytics> and Map<String, BinData>
5. [ ] Update MainViewModel fetchAllData() to handle multiple pools
6. [ ] Add pool selector dropdown to OverviewTab
7. [ ] Group positions by poolAddress in PositionsTab
8. [ ] Add pool selector to CreatePositionForm
9. [ ] Update all position display to show pool context

## Backend Coordination

The Android app needs backend support for:

1. **Include poolAddress in Position responses** from `/api/positions`
   - Currently missing in Position model

2. **Update pool analytics endpoints**
   - Option A: Change `/api/pool/analytics` to `/api/pool/analytics/{poolAddress}`
   - Option B: Add `/api/pools` to return List<PoolAnalytics>

3. **Update CreatePositionRequest**
   - Add `poolAddress` field so app can specify which pool
   - Currently only sends: solAmount, usdcAmount, priceLower, priceUpper

4. **Pool-aware position operations**
   - deposit(), withdraw(), claimFees() - may need pool context
   - closePosition() - position mint already identifies pool, but poolAddress would be nice

## Testing Approach

1. Test with single pool first (existing behavior)
2. Add second test pool to backend
3. Verify positions are grouped by pool in UI
4. Verify CreatePositionForm allows selecting between pools
5. Verify OverviewTab allows switching between pools
