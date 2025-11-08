# Android App - Code References and File Locations

## File Structure
```
/Users/vladimirdemidov/AndroidStudioProjects/QuasarBot/
├── app/src/main/java/com/example/quasarbot/
│   ├── data/
│   │   ├── Models.kt              # Data classes for API responses
│   │   ├── ApiService.kt          # Retrofit API interface
│   │   └── Repository.kt          # Data access layer
│   ├── ui/
│   │   ├── screens/
│   │   │   ├── OverviewTab.kt     # Pool analytics & bin display
│   │   │   ├── PositionsTab.kt    # Position list display
│   │   │   ├── ActionsTab.kt      # Create/Deposit/Withdraw forms
│   │   │   └── MainScreen.kt      # Main UI navigation
│   │   └── theme/
│   ├── viewmodel/
│   │   └── MainViewModel.kt       # State management (UiState)
│   └── MainActivity.kt            # App entry point
└── ...
```

## 1. Models.kt - Complete Data Models

### File: `/app/src/main/java/com/example/quasarbot/data/Models.kt`

#### Position Model (Lines 76-83)
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

#### Exposure Model (Lines 67-74)
Contains all positions and aggregate exposure data:
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

#### PositionData Model (Lines 63-65)
```kotlin
data class PositionData(
    @SerializedName("exposure") val exposure: Exposure?
)
```

#### PoolAnalytics Model (Lines 27-38)
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

## 2. ApiService.kt - API Endpoints

### File: `/app/src/main/java/com/example/quasarbot/data/ApiService.kt`

```kotlin
interface ApiService {
    @GET("api/prices")
    suspend fun getPrices(): Response<PriceData>

    @GET("api/pool/analytics")                                    // LINE 13-14
    suspend fun getPoolAnalytics(): Response<PoolAnalytics>       // NO pool parameter!

    @GET("api/pool/bins")                                         // LINE 16-17
    suspend fun getBins(): Response<BinData>                      // NO pool parameter!

    @GET("api/positions")
    suspend fun getPositions(): Response<PositionData>

    @POST("api/positions/create")
    suspend fun createPosition(@Body request: CreatePositionRequest): Response<TransactionResponse>

    @POST("api/positions/deposit")
    suspend fun deposit(@Body request: DepositRequest): Response<TransactionResponse>

    @POST("api/positions/withdraw")
    suspend fun withdraw(@Body request: WithdrawRequest): Response<TransactionResponse>

    @POST("api/positions/claim-fees")
    suspend fun claimFees(): Response<ClaimFeesResponse>

    @POST("api/positions/close")
    suspend fun closePosition(@Body request: ClosePositionRequest): Response<TransactionResponse>
}
```

## 3. PositionsTab.kt - Position Display

### File: `/app/src/main/java/com/example/quasarbot/ui/screens/PositionsTab.kt`

#### Main display logic (Lines 18-122)
```kotlin
@Composable
fun PositionsTab(uiState: UiState, viewModel: MainViewModel) {
    val exposure = uiState.positions?.exposure

    Column(...) {
        if (exposure == null) {
            Text("Loading positions...")
        } else {
            // Display exposure summary (aggregate of all positions)
            
            // Display list of all positions
            exposure.positions.forEachIndexed { index, position ->
                PositionCard(
                    position = position,
                    index = index,
                    viewModel = viewModel,
                    isPerformingAction = uiState.isPerformingAction
                )
            }
        }
    }
}
```

#### PositionCard display (Lines 126-225)
Shows:
- Position index (Position 1, Position 2, etc.) - **NO POOL INDICATOR**
- SOL and USDC amounts
- Value in USD
- Bin range (lowerBinId → upperBinId)
- Position mint (shortened)
- Liquidity distribution widget
- Close position button

**Line 150:** Shows generic position numbering:
```kotlin
Text(
    text = "Position ${index + 1}",  // NO pool context!
    style = MaterialTheme.typography.titleMedium
)
```

## 4. ActionsTab.kt - Position Creation

### File: `/app/src/main/java/com/example/quasarbot/ui/screens/ActionsTab.kt`

#### CreatePositionForm (Lines 50-136)

**Line 55:** Gets current price from SINGLE price oracle:
```kotlin
val currentPrice = uiState.prices?.sol?.usd
```

**Lines 103-114:** Price range calculation (no pool consideration):
```kotlin
if (currentPrice != null && rangePercent.toDoubleOrNull() != null) {
    val range = rangePercent.toDouble()
    val lower = currentPrice * (1 - range / 100)
    val upper = currentPrice * (1 + range / 100)
    
    Text(
        text = "Range: $${String.format("%.2f", lower)} - $${String.format("%.2f", upper)}",
        style = MaterialTheme.typography.bodyMedium,
        color = MaterialTheme.colorScheme.primary
    )
}
```

**Lines 118-125:** Form submission (no pool selection):
```kotlin
Button(
    onClick = {
        val range = rangePercent.toDoubleOrNull() ?: 1.0
        viewModel.createPosition(solAmount, usdcAmount, range)  // NO poolAddress parameter!
        // Clear form
        solAmount = ""
        usdcAmount = "0"
        rangePercent = "1"
    },
    // ...
) {
    Text(if (uiState.isPerformingAction) "Creating..." else "Create Position")
}
```

#### WithdrawForm - Position Selection (Lines 250-392)

**Lines 272-321:** Position selector dropdown:
```kotlin
if (positions.size > 1) {
    val selectedPosition = positions.find { it.mint == selectedPositionMint }
    val displayText = if (selectedPosition != null) {
        "Position: ${selectedPosition.mint.take(8)}...${selectedPosition.mint.takeLast(8)}"
    } else {
        "Select Position"
    }
    
    ExposedDropdownMenuBox(
        expanded = expandedPositions,
        onExpandedChange = { expandedPositions = !expandedPositions }
    ) {
        // Dropdown menu listing positions
        positions.forEachIndexed { index, position ->
            DropdownMenuItem(
                text = {
                    Column {
                        Text("Position ${index + 1}")  // **NO POOL INFO**
                        Text(
                            text = "${position.mint.take(8)}...${position.mint.takeLast(8)} • " +
                                    "SOL: ${String.format("%.4f", position.solAmount)} • " +
                                    "USDC: $${String.format("%.2f", position.usdcAmount)}",
                            // ... NO pool address or pool name shown
                        )
                    }
                },
                onClick = {
                    selectedPositionMint = position.mint
                    expandedPositions = false
                }
            )
        }
    }
}
```

## 5. MainViewModel.kt - State Management

### File: `/app/src/main/java/com/example/quasarbot/viewmodel/MainViewModel.kt`

#### UiState Model (Lines 13-22)
```kotlin
data class UiState(
    val isLoading: Boolean = true,
    val error: String? = null,
    val prices: PriceData? = null,
    val poolAnalytics: PoolAnalytics? = null,        // SINGLE POOL ONLY
    val bins: BinData? = null,                         // SINGLE POOL ONLY
    val positions: PositionData? = null,
    val actionMessage: ActionMessage? = null,
    val isPerformingAction: Boolean = false
)
```

#### fetchAllData() method (Lines 43-85)
```kotlin
fun fetchAllData() {
    viewModelScope.launch {
        try {
            val pricesResult = repository.fetchPrices()
            val analyticsResult = repository.fetchPoolAnalytics()    // Fetches ONE pool
            val binsResult = repository.fetchBins()                  // Fetches ONE pool
            val positionsResult = repository.fetchPositions()        // Fetches ALL positions
            
            // ...
            _uiState.value = _uiState.value.copy(
                isLoading = false,
                error = null,
                prices = pricesResult.getOrNull(),
                poolAnalytics = analyticsResult.getOrNull(),         // Stores single pool
                bins = binsResult.getOrNull(),                       // Stores single pool
                positions = positionsResult.getOrNull()              // Stores all positions
            )
        }
    }
}
```

#### createPosition() method (Lines 97-135)
```kotlin
fun createPosition(solAmount: String, usdcAmount: String, rangePercent: Double) {
    val currentPrice = _uiState.value.prices?.sol?.usd ?: return
    
    viewModelScope.launch {
        val priceLower = currentPrice * (1 - rangePercent / 100)
        val priceUpper = currentPrice * (1 + rangePercent / 100)
        
        val request = CreatePositionRequest(
            solAmount = solAmount,
            usdcAmount = usdcAmount,
            priceLower = priceLower,
            priceUpper = priceUpper
            // NO poolAddress parameter!
        )
        
        val result = repository.createPosition(request)
        // ...
    }
}
```

## 6. OverviewTab.kt - Pool Analytics Display

### File: `/app/src/main/java/com/example/quasarbot/ui/screens/OverviewTab.kt`

#### PoolAnalyticsCard (Lines 131-173)
Displays a SINGLE pool's analytics:
```kotlin
@Composable
fun PoolAnalyticsCard(uiState: UiState) {
    val analytics = uiState.poolAnalytics  // SINGLE POOL
    
    Card(...) {
        Column(...) {
            if (analytics == null) {
                Text("Loading pool analytics...")
            } else {
                Text(
                    text = analytics.name,
                    style = MaterialTheme.typography.titleLarge
                )
                
                Row(...) {
                    Column {
                        InfoRow("Current Price", "$${...}")
                        InfoRow("APR", "${...}%", highlight = true)
                        InfoRow("APY", "${...}%", highlight = true)
                        InfoRow("24h Volume", formatNumber(...))
                    }
                    
                    Column {
                        InfoRow("24h Fees", formatNumber(...))
                        InfoRow("Bin Step", "${analytics.binStep}...")
                        InfoRow("Base Fee", "${...}%")
                        InfoRow("Total Liquidity", formatNumber(...))
                    }
                }
            }
        }
    }
}
```

**Issue:** No pool selector dropdown, displays only one pool.

## Key Bottlenecks for Multi-Pool Support

### 1. Models Lack Pool Identification
- Position has no `poolAddress`
- PoolAnalytics has address but used as single object

### 2. API Endpoints Don't Support Multiple Pools
- `/api/pool/analytics` - no pool parameter
- `/api/pool/bins` - no pool parameter
- No endpoint to fetch multiple pools at once

### 3. ViewModel State Assumes Single Pool
- `poolAnalytics: PoolAnalytics?` - single object, not list/map
- `bins: BinData?` - single object, not list/map
- No `selectedPoolAddress` tracking

### 4. UI Doesn't Show Pool Context
- PositionsTab: No pool grouping or filtering
- ActionsTab: No pool selection dropdown
- OverviewTab: No pool selector
- Position display: Generic numbering (Position 1, 2, 3...)

### 5. API Requests Don't Include Pool Selection
- `createPosition()` doesn't pass pool address
- `getPoolAnalytics()` doesn't take pool parameter
- `getBins()` doesn't take pool parameter

## Integration Points to Modify

```
Backend API Layer
    ↓
Repository (fetch methods)
    ↓
ViewModel (state management & API calls)
    ↓
UI Screens (display & user input)
```

All layers need updates to support multiple pools.
