# Android App - Pool and Position Handling Analysis

## Location
Android app is located at: `/Users/vladimirdemidov/AndroidStudioProjects/QuasarBot`

## Key Findings

### 1. Models.kt - Data Structure Analysis

**Location:** `/app/src/main/java/com/example/quasarbot/data/Models.kt`

#### Position Model - NO poolAddress field
```kotlin
data class Position(
    @SerializedName("mint") val mint: String,
    @SerializedName("solAmount") val solAmount: Double,
    @SerializedName("usdcAmount") val usdcAmount: Double,
    @SerializedName("valueUsd") val valueUsd: Double,
    @SerializedName("lowerBinId") val lowerBinId: Int,
    @SerializedName("upperBinId") val upperBinId: Int
)
```

**Key observation:** Position does NOT contain `poolAddress`. It only has:
- mint (NFT address)
- solAmount, usdcAmount (liquidity amounts)
- valueUsd (total USD value)
- lowerBinId, upperBinId (price range in bin IDs)

#### Exposure Model (Parent container)
```kotlin
data class Exposure(
    @SerializedName("solAmount") val solAmount: Double,
    @SerializedName("usdcAmount") val usdcAmount: Double,
    @SerializedName("totalUsd") val totalUsd: Double,
    @SerializedName("claimableSol") val claimableSol: Double,
    @SerializedName("claimableUsdc") val claimableUsdc: Double,
    @SerializedName("positions") val positions: List<Position>?
)
```

#### PoolAnalytics Model
```kotlin
data class PoolAnalytics(
    @SerializedName("address") val address: String,
    @SerializedName("name") val name: String,
    @SerializedName("currentPrice") val currentPrice: String,
    @SerializedName("apr") val apr: Double,
    @SerializedName("apy") val apy: Double,
    @SerializedName("tradeVolume24h") val tradeVolume24h: Double,
    @SerializedName("fees24h") val fees24h: Double,
    @SerializedName("binStep") val binStep: Int,
    @SerializedName("baseFeePercentage") val baseFeePercentage: String,
    @SerializedName("liquidity") val liquidity: String
)
```

### 2. API Service - Endpoint Analysis

**Location:** `/app/src/main/java/com/example/quasarbot/data/ApiService.kt`

Current endpoints:
- `GET /api/prices` - Returns PriceData
- `GET /api/pool/analytics` - Returns PoolAnalytics (SINGLE POOL ONLY)
- `GET /api/pool/bins` - Returns BinData (SINGLE POOL ONLY)
- `GET /api/positions` - Returns PositionData with list of Position objects
- Action endpoints for create/deposit/withdraw/claim/close

**Critical issue:** Pool analytics and bins endpoints fetch data for ONE pool only. They don't support pool selection or listing multiple pools.

### 3. UI Screens - Display and Selection

#### OverviewTab.kt
Displays pool analytics for a SINGLE pool:
- Shows PoolAnalyticsCard (one pool only)
- Shows BinInfoCard (one pool only)
- No pool selection dropdown

#### PositionsTab.kt
Displays all positions aggregated together:
```kotlin
exposure.positions.forEachIndexed { index, position ->
    PositionCard(
        position = position,
        index = index,
        viewModel = viewModel,
        isPerformingAction = uiState.isPerformingAction
    )
}
```

**Issue:** Positions are NOT grouped by pool. They're just numbered Position 1, Position 2, etc.

#### ActionsTab.kt - CreatePositionForm

```kotlin
fun CreatePositionForm(uiState: UiState, viewModel: MainViewModel) {
    var solAmount by remember { mutableStateOf("") }
    var usdcAmount by remember { mutableStateOf("0") }
    var rangePercent by remember { mutableStateOf("1") }
    
    // ... uses current price from oracle
    val currentPrice = uiState.prices?.sol?.usd
    
    // No pool selection dropdown
}
```

**Issue:** CreatePositionForm does NOT have pool selection. It assumes single pool.

### 4. ViewModel - State Management

**Location:** `/app/src/main/java/com/example/quasarbot/viewmodel/MainViewModel.kt`

UiState model:
```kotlin
data class UiState(
    val isLoading: Boolean = true,
    val error: String? = null,
    val prices: PriceData? = null,
    val poolAnalytics: PoolAnalytics? = null,  // SINGLE POOL
    val bins: BinData? = null,                   // SINGLE POOL
    val positions: PositionData? = null,         // ALL POSITIONS
    val actionMessage: ActionMessage? = null,
    val isPerformingAction: Boolean = false
)
```

Auto-refreshes all data every 10 seconds:
```kotlin
private fun startAutoRefresh() {
    autoRefreshJob?.cancel()
    autoRefreshJob = viewModelScope.launch {
        while (true) {
            delay(10_000) // 10 seconds
            fetchAllData()
        }
    }
}
```

## Summary of Issues for Multi-Pool Support

| Aspect | Current Status | Issue |
|--------|----------------|-------|
| **Position Model** | No poolAddress | Positions can't be grouped/filtered by pool |
| **API Endpoints** | Single pool only | /api/pool/analytics and /api/pool/bins don't accept pool ID |
| **UI Display** | No pool grouping | Positions displayed as flat list (Position 1, 2, 3...) |
| **Pool Selection** | No dropdown | CreatePositionForm assumes single pool |
| **Data Structure** | Single pool analytics | UiState.poolAnalytics is a single PoolAnalytics object |
| **Overview Tab** | Single pool display | Can only show one pool's APR/APY/bins/volume/fees |

## Required Changes for Multi-Pool Support

### 1. Update Models.kt
```kotlin
// Add poolAddress to Position
data class Position(
    @SerializedName("poolAddress") val poolAddress: String,  // NEW
    @SerializedName("mint") val mint: String,
    @SerializedName("solAmount") val solAmount: Double,
    @SerializedName("usdcAmount") val usdcAmount: Double,
    @SerializedName("valueUsd") val valueUsd: Double,
    @SerializedName("lowerBinId") val lowerBinId: Int,
    @SerializedName("upperBinId") val upperBinId: Int
)

// Add poolAddress to PoolAnalytics
data class PoolAnalytics(
    @SerializedName("poolAddress") val poolAddress: String,  // NEW - make this the key
    @SerializedName("address") val address: String,
    @SerializedName("name") val name: String,
    // ... rest unchanged
)
```

### 2. Update API Service
```kotlin
// Add pool ID parameter
@GET("api/pool/analytics/{poolAddress}")
suspend fun getPoolAnalytics(@Path("poolAddress") poolAddress: String): Response<PoolAnalytics>

@GET("api/pool/bins/{poolAddress}")
suspend fun getBins(@Path("poolAddress") poolAddress: String): Response<BinData>

// Or add endpoint to list all pools
@GET("api/pools")
suspend fun getAllPools(): Response<List<PoolAnalytics>>
```

### 3. Update ViewModel State
```kotlin
data class UiState(
    val isLoading: Boolean = true,
    val error: String? = null,
    val prices: PriceData? = null,
    val poolAnalytics: Map<String, PoolAnalytics>? = null,  // CHANGED: Map by poolAddress
    val bins: Map<String, BinData>? = null,                  // CHANGED: Map by poolAddress
    val positions: PositionData? = null,
    val selectedPoolAddress: String? = null,                 // NEW
    val actionMessage: ActionMessage? = null,
    val isPerformingAction: Boolean = false
)
```

### 4. Update UI Screens
- Add pool selector dropdown in OverviewTab
- Group positions by pool in PositionsTab
- Add pool selection to CreatePositionForm
- Update display to show pool context for positions

## Current Architecture (Single Pool)
```
Backend API
    ↓
PoolAnalytics (single) ──→ OverviewTab (display single pool)
BinData (single) ────────┘
Positions (multiple)  ──→ PositionsTab (flat list, no pool context)
    ↓
CreatePositionForm (assumes single pool, no selection)
```

## Proposed Architecture (Multi-Pool)
```
Backend API
    ↓
PoolAnalytics (multiple) ──┐
BinData (multiple)         ├→ UiState.poolAnalytics[poolAddress]
                           │
Positions (multiple)  ──→ Group by poolAddress ──→ PositionsTab (grouped display)
    ↓
Pool Selector Dropdown ──→ CreatePositionForm (select which pool)
```

