# API Changes for Multi-Pool Support

## Overview

All API endpoints have been updated to support multiple Meteora pool addresses. The system now allows users/clients to:
1. Query available pools via `GET /api/pools`
2. Create positions in any available pool by specifying `poolAddress` parameter
3. Automatically falls back to primary pool (first in array) if not specified

## Key Principle

**User/Client Must Specify Which Pool** - The backend accepts `poolAddress` as an optional parameter. If not provided, it defaults to the first configured pool. This ensures flexibility for multi-pool scenarios.

## New API Endpoints

### GET /api/pools
Returns the list of available pool addresses configured in the system.

**Request:**
```bash
GET http://localhost:3001/api/pools
```

**Response:**
```json
{
  "pools": [
    "5rCf1DM8LjKTw4YqhnoLcngyZYeNnQqztScTogYHAS6",
    "HTvjzsfX3yU6BUodCjZ5vZkUrAxMDTrBs3CJaq43ashR"
  ],
  "count": 2,
  "timestamp": 1730979870123
}
```

**Use Case**: Android app fetches this on startup to populate pool selector dropdown.

---

## Updated API Endpoints

### POST /api/positions/create
Create a new LP position in a specified pool.

**Request:**
```json
{
  "solAmount": "10",
  "usdcAmount": "1000",
  "priceLower": 150,
  "priceUpper": 200,
  "poolAddress": "5rCf1DM8LjKTw4YqhnoLcngyZYeNnQqztScTogYHAS6"
}
```

**Parameters:**
- `solAmount` (required): SOL to deposit
- `usdcAmount` (optional): USDC to deposit
- `priceLower` (required): Lower price bound
- `priceUpper` (required): Upper price bound
- `poolAddress` (optional): Which pool to use. Defaults to first pool if not specified.

**Response:**
```json
{
  "positionMint": "...",
  "signature": "...",
  "solDeposited": 10,
  "usdcDeposited": 1000
}
```

**Error (Invalid Pool):**
```json
{
  "error": "Invalid pool address",
  "message": "Pool ... is not in configured pools",
  "availablePools": ["pool1", "pool2"]
}
```

---

### POST /api/positions/withdraw
Withdraw liquidity from a specific position.

**Request:**
```json
{
  "percent": 50,
  "positionMint": "...",
  "poolAddress": "5rCf1DM8..."
}
```

**Parameters:**
- `percent` (required): Withdrawal percentage (0-100)
- `positionMint` (optional): Which position to withdraw from. Uses first position if not specified.
- `poolAddress` (optional): For multi-pool scenarios (not yet used, reserved for future)

**Response:**
```json
{
  "signature": "..."
}
```

---

## Implementation Details

### Backend Changes

**Configuration (env.ts)**:
- Changed `meteoraPoolAddress?: string` → `meteoraPoolAddresses?: string[]`
- Supports both `METEORA_POOL_ADDRESSES=pool1,pool2` and `METEORA_POOL_ADDRESS=pool1` formats
- Auto-parses comma-separated values

**API Endpoints (hono-server.ts, bun-server.ts)**:
1. **GET /api/pools** - Returns list of available pools
2. **POST /api/positions/create** - Accepts optional `poolAddress` parameter
   - Validates pool is in configured pools
   - Defaults to primary pool if not specified
3. **GET /api/pool/bins** - Uses primary pool (backward compatible)
4. **GET /api/pool/analytics** - Uses primary pool (backward compatible)

### Android App Integration

The Android app needs to:

1. **Fetch available pools on startup**:
   ```kotlin
   val poolsResponse = apiService.getPools()
   _uiState.value = _uiState.value.copy(availablePools = poolsResponse.pools)
   ```

2. **Show pool selector in CreatePositionForm**:
   - Dropdown showing all available pools
   - Allow user to select which pool to create in

3. **Pass poolAddress when creating position**:
   ```kotlin
   fun createPosition(solAmount: String, usdcAmount: String, range: Double, poolAddress: String) {
       val request = CreatePositionRequest(
           solAmount = solAmount,
           usdcAmount = usdcAmount,
           priceLower = ...,
           priceUpper = ...,
           poolAddress = poolAddress  // NEW
       )
       // ...
   }
   ```

4. **Update UI form to include poolAddress**:
   ```kotlin
   data class CreatePositionRequest(
       @SerializedName("solAmount") val solAmount: String,
       @SerializedName("usdcAmount") val usdcAmount: String,
       @SerializedName("priceLower") val priceLower: Double,
       @SerializedName("priceUpper") val priceUpper: Double,
       @SerializedName("poolAddress") val poolAddress: String? = null  // NEW
   )
   ```

---

## Bug Fixes Included

### 1. BN Conversion Error (FIXED)
**Problem**: Using `parseFloat()` on BN objects in `getLpExposure()`
**Solution**: Changed to `.toNumber()` method

### 2. Config Property Error (FIXED)
**Problem**: API endpoints were using old `meteoraPoolAddress` (singular) property
**Solution**: Updated to use `meteoraPoolAddresses` (plural) from config

---

## Backward Compatibility

✅ **Fully backward compatible:**
- Single pool configuration still works
- `poolAddress` parameter is optional (defaults to first pool)
- Legacy API contracts unchanged
- Old `.env` file format still supported

**Example - Single Pool Setup:**
```bash
# Old format still works
METEORA_POOL_ADDRESS=5rCf1DM8...

# Create position without specifying pool (uses default)
POST /api/positions/create
{
  "solAmount": "10",
  "usdcAmount": "1000",
  "priceLower": 150,
  "priceUpper": 200
  // poolAddress not specified - uses first pool
}
```

---

## Testing

### Manual API Testing

```bash
# 1. Get available pools
curl http://localhost:3001/api/pools

# 2. Create position in first pool (default)
curl -X POST http://localhost:3001/api/positions/create \
  -H "Content-Type: application/json" \
  -d '{
    "solAmount": "10",
    "usdcAmount": "1000",
    "priceLower": 150,
    "priceUpper": 200
  }'

# 3. Create position in specific pool
curl -X POST http://localhost:3001/api/positions/create \
  -H "Content-Type: application/json" \
  -d '{
    "solAmount": "10",
    "usdcAmount": "1000",
    "priceLower": 150,
    "priceUpper": 200,
    "poolAddress": "HTvjzsfX3yU6BUodCjZ5vZkUrAxMDTrBs3CJaq43ashR"
  }'

# 4. Try invalid pool (should error)
curl -X POST http://localhost:3001/api/positions/create \
  -H "Content-Type: application/json" \
  -d '{
    "solAmount": "10",
    "usdcAmount": "1000",
    "priceLower": 150,
    "priceUpper": 200,
    "poolAddress": "INVALID_POOL_ADDRESS"
  }'
```

---

## Android App Updates Required

### In Models.kt:
```kotlin
data class CreatePositionRequest(
    @SerializedName("solAmount") val solAmount: String,
    @SerializedName("usdcAmount") val usdcAmount: String,
    @SerializedName("priceLower") val priceLower: Double,
    @SerializedName("priceUpper") val priceUpper: Double,
    @SerializedName("poolAddress") val poolAddress: String? = null  // ADD THIS
)
```

### In ApiService.kt:
```kotlin
interface ApiService {
    // Add this endpoint
    @GET("api/pools")
    suspend fun getPools(): Response<PoolsResponse>
}

data class PoolsResponse(
    @SerializedName("pools") val pools: List<String>,
    @SerializedName("count") val count: Int,
    @SerializedName("timestamp") val timestamp: Long
)
```

### In MainViewModel.kt:
```kotlin
fun fetchAllData() {
    viewModelScope.launch {
        // ... existing code ...
        val poolsResult = repository.fetchPools()  // ADD THIS

        _uiState.value = _uiState.value.copy(
            // ... existing code ...
            availablePools = poolsResult.getOrNull()?.pools ?: emptyList()
        )
    }
}

fun createPosition(solAmount: String, usdcAmount: String, rangePercent: Double, poolAddress: String? = null) {
    val currentPrice = _uiState.value.prices?.sol?.usd ?: return

    viewModelScope.launch {
        val priceLower = currentPrice * (1 - rangePercent / 100)
        val priceUpper = currentPrice * (1 + rangePercent / 100)

        val request = CreatePositionRequest(
            solAmount = solAmount,
            usdcAmount = usdcAmount,
            priceLower = priceLower,
            priceUpper = priceUpper,
            poolAddress = poolAddress  // PASS POOL ADDRESS
        )
        // ... rest of implementation ...
    }
}
```

### In ActionsTab.kt:
Update the CreatePositionForm button to pass `selectedPool`:
```kotlin
Button(
    onClick = {
        val range = rangePercent.toDoubleOrNull() ?: 1.0
        viewModel.createPosition(solAmount, usdcAmount, range, selectedPool)  // PASS POOL
    },
    // ... rest of button config ...
)
```

---

## Summary

The backend is now fully ready for multi-pool support:
- ✅ Configuration updated
- ✅ New `/api/pools` endpoint
- ✅ Position creation accepts pool selection
- ✅ Validation for pool addresses
- ✅ Backward compatible with single pool setup
- ✅ Error handling for invalid pools

The Android app needs to:
- [ ] Add Models.kt updates
- [ ] Add ApiService updates
- [ ] Add ViewModel updates to fetch pools
- [ ] Update CreatePositionForm to pass poolAddress
- [ ] Update PositionsTab to display poolAddress

Once these are done, users can create and manage positions across multiple pools!
