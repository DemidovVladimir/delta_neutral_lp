# Android App - LP Position Withdraw Functionality

**Project Location:** `/Users/vladimirdemidov/AndroidStudioProjects/QuasarBot`

---

## 1. Overview

The Android app uses Kotlin with Jetpack Compose for UI and connects to a backend API server (bun-server.ts or hono-server.ts) located in the delta_neutral_bot project. The withdraw functionality allows users to withdraw a percentage of their liquidity from Meteora DLMM LP positions.

---

## 2. Architecture Layers

```
┌─────────────────────────────────────────────────────┐
│   UI Layer (Jetpack Compose)                        │
│   - WithdrawForm (ActionsTab.kt)                    │
│   - PositionCard (PositionsTab.kt)                  │
└────────────────────────────────────────────────────┬┘
                           │
┌────────────────────────────────────────────────────┴┘
│   ViewModel Layer                                   │
│   - MainViewModel.withdraw()                        │
│   - Handles state management with StateFlow        │
└────────────────────────────────────────────────────┬┘
                           │
┌────────────────────────────────────────────────────┴┘
│   Repository Layer                                  │
│   - Repository.withdraw()                           │
│   - Delegates to API service                        │
└────────────────────────────────────────────────────┬┘
                           │
┌────────────────────────────────────────────────────┴┘
│   Network Layer (Retrofit)                          │
│   - ApiService.withdraw() (HTTP POST)               │
│   - Sends to backend: /api/positions/withdraw       │
└────────────────────────────────────────────────────┬┘
                           │
                    Backend Server
                  (bun-server.ts / hono-server.ts)
                  MeteoraAdapter.withdrawFromLp()
```

---

## 3. UI Implementation

### 3.1 Withdraw Form (`ActionsTab.kt` - Lines 248-315)

```kotlin
@Composable
fun WithdrawForm(uiState: UiState, viewModel: MainViewModel) {
    var percent by remember { mutableStateOf("100") }  // Default 100% withdrawal

    Card(
        modifier = Modifier.fillMaxWidth(),
        elevation = CardDefaults.cardElevation(defaultElevation = 4.dp)
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            Text(
                text = "Withdraw from Position",
                style = MaterialTheme.typography.headlineSmall
            )

            // Percent Slider (1-100%)
            Text(
                text = "Withdrawal Percentage: ${percent}%",
                style = MaterialTheme.typography.bodyLarge
            )

            Slider(
                value = percent.toFloatOrNull() ?: 100f,
                onValueChange = { percent = it.toInt().toString() },
                valueRange = 1f..100f,
                steps = 99,  // 99 steps for 1-100%
                modifier = Modifier.fillMaxWidth()
            )

            // Manual percentage input
            OutlinedTextField(
                value = percent,
                onValueChange = {
                    val value = it.toIntOrNull()
                    if (value != null && value in 1..100) {
                        percent = it  // Only allow 1-100
                    }
                },
                label = { Text("Enter Percentage") },
                placeholder = { Text("e.g., 100") },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                modifier = Modifier.fillMaxWidth(),
                singleLine = true
            )

            Text(
                text = "Enter 100 for full withdrawal",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )

            // Withdraw Button
            Button(
                onClick = {
                    val percentValue = percent.toDoubleOrNull() ?: 100.0
                    viewModel.withdraw(percentValue)  // Call ViewModel
                },
                modifier = Modifier.fillMaxWidth(),
                enabled = !uiState.isPerformingAction &&
                        percent.toIntOrNull() in 1..100  // Only enabled if 1-100%
            ) {
                Text(if (uiState.isPerformingAction) "Withdrawing..." else "Withdraw")
            }
        }
    }
}
```

**Key Features:**
- Slider for quick percentage selection (1-100%)
- Manual text input field with validation (1-100% only)
- Real-time percentage display
- Button disabled during withdrawal operation
- Default value: 100% (full withdrawal)

---

### 3.2 Positions Tab Display (`PositionsTab.kt`)

Shows position data and allows closing empty positions:

```kotlin
@Composable
fun PositionCard(
    position: com.example.quasarbot.data.Position,
    index: Int,
    viewModel: MainViewModel,
    isPerformingAction: Boolean
) {
    var showCloseDialog by remember { mutableStateOf(false) }
    val isEmpty = position.solAmount == 0.0 && position.usdcAmount == 0.0  // Check if empty

    Card(...) {
        Column(...) {
            Text("Position ${index + 1}")
            
            // Display position data
            InfoRow("SOL", String.format("%.4f", position.solAmount))
            InfoRow("USDC", "$${String.format("%.2f", position.usdcAmount)}")
            InfoRow("Value", "$${String.format("%.2f", position.valueUsd)}")
            InfoRow("Bins", "${position.lowerBinId} → ${position.upperBinId}")
            
            // Position NFT mint address (shortened)
            Text(
                text = "${position.mint.take(8)}...${position.mint.takeLast(8)}",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )

            // Close Position button (only visible if position is empty)
            if (isEmpty) {
                Button(
                    onClick = { showCloseDialog = true },
                    modifier = Modifier.fillMaxWidth(),
                    enabled = !isPerformingAction,
                    colors = ButtonDefaults.buttonColors(
                        containerColor = MaterialTheme.colorScheme.error
                    )
                ) {
                    Text(if (isPerformingAction) "Closing..." else "🔒 Close Position (Reclaim ~0.057 SOL)")
                }
            }
        }
    }

    // Close position confirmation dialog
    if (showCloseDialog) {
        AlertDialog(
            onDismissRequest = { showCloseDialog = false },
            title = { Text("Close Position") },
            text = {
                Text(
                    "Close this position and reclaim position NFT rent (~0.057 SOL)?\n\n" +
                    "NOTE: Bin array rent (~0.14 SOL) is NON-REFUNDABLE.\n\n" +
                    "WARNING: Position must be fully withdrawn (0 liquidity) first!"
                )
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        showCloseDialog = false
                        viewModel.closePosition(position.mint)  // Pass position mint
                    }
                ) {
                    Text("Close")
                }
            },
            dismissButton = {
                TextButton(onClick = { showCloseDialog = false }) {
                    Text("Cancel")
                }
            }
        )
    }
}
```

**Key Information Displayed:**
- Position number (index + 1)
- SOL amount with 4 decimal precision
- USDC amount with 2 decimal precision
- Position value in USD
- Bin range (lowerBinId → upperBinId)
- Position NFT mint address (first 8 + last 8 characters)
- Close button (red, only for empty positions)

---

## 4. ViewModel Implementation

**File:** `MainViewModel.kt`

### 4.1 Withdraw Function (Lines 167-195)

```kotlin
fun withdraw(percent: Double) {
    viewModelScope.launch {
        // Set UI state to loading
        _uiState.value = _uiState.value.copy(
            isPerformingAction = true,  // Disables button
            actionMessage = null
        )

        // Create request with withdrawal percentage
        val request = WithdrawRequest(percent)
        
        // Call repository method
        val result = repository.withdraw(request)

        result.fold(
            onSuccess = { response ->
                // On success: update UI with transaction signature
                _uiState.value = _uiState.value.copy(
                    isPerformingAction = false,
                    actionMessage = ActionMessage(
                        "Withdrawal successful! TX: ${response.signature}"
                    )
                )
                // Wait 2 seconds, then refresh data
                delay(2000)
                fetchAllData()
                clearActionMessage()
            },
            onFailure = { error ->
                // On error: show error message
                _uiState.value = _uiState.value.copy(
                    isPerformingAction = false,
                    actionMessage = ActionMessage(
                        error.message ?: "Failed to withdraw",
                        isError = true  // Show as error (red color)
                    )
                )
            }
        )
    }
}
```

**State Management:**
- Uses `viewModelScope.launch` for coroutine
- `isPerformingAction: Boolean` - disables UI during operation
- `actionMessage: ActionMessage?` - displays success/error messages
- Auto-refreshes positions after 2 seconds on success

### 4.2 UI State Definition (Lines 13-27)

```kotlin
data class UiState(
    val isLoading: Boolean = true,
    val error: String? = null,
    val prices: PriceData? = null,
    val poolAnalytics: PoolAnalytics? = null,
    val bins: BinData? = null,
    val positions: PositionData? = null,
    val actionMessage: ActionMessage? = null,
    val isPerformingAction: Boolean = false  // Withdrawal in progress
)

data class ActionMessage(
    val message: String,
    val isError: Boolean = false  // false = success, true = error
)
```

---

## 5. Repository Layer

**File:** `Repository.kt` (Lines 88-100)

```kotlin
suspend fun withdraw(request: WithdrawRequest): Result<TransactionResponse> =
    withContext(Dispatchers.IO) {  // Coroutine on IO thread
        try {
            // Call API service with HTTP POST
            val response = apiService.withdraw(request)
            
            // Check if response is successful
            if (response.isSuccessful && response.body() != null) {
                Result.success(response.body()!!)
            } else {
                // HTTP error (e.g., 400, 500)
                Result.failure(Exception("Failed to withdraw: ${response.code()}"))
            }
        } catch (e: Exception) {
            // Network error, parse error, etc.
            Result.failure(e)
        }
    }
```

**Key Points:**
- Uses `withContext(Dispatchers.IO)` for network operations
- Returns `Result<TransactionResponse>` for success/failure handling
- Wraps HTTP errors and exceptions in Result

---

## 6. API Service (Retrofit)

**File:** `ApiService.kt` (Line 28-29)

```kotlin
@POST("api/positions/withdraw")
suspend fun withdraw(@Body request: WithdrawRequest): Response<TransactionResponse>
```

**Configuration:**
- Retrofit HTTP client
- Base URL from `BuildConfig.API_BASE_URL`
- GsonConverterFactory for JSON serialization
- Suspend function for coroutine support

---

## 7. Data Models

**File:** `Models.kt`

### 7.1 Request Model (Lines 99-101)
```kotlin
data class WithdrawRequest(
    @SerializedName("percent") val percent: Double  // 1-100
)
```

### 7.2 Response Models (Lines 107-120)
```kotlin
data class TransactionResponse(
    @SerializedName("signature") val signature: String,
    @SerializedName("message") val message: String? = null
)

data class ClaimFeesResponse(
    @SerializedName("signature") val signature: String,
    @SerializedName("sol") val sol: Double,
    @SerializedName("usdc") val usdc: Double
)

data class ErrorResponse(
    @SerializedName("message") val message: String
)
```

### 7.3 Position Data Models (Lines 62-83)
```kotlin
data class PositionData(
    @SerializedName("exposure") val exposure: Exposure?
)

data class Exposure(
    @SerializedName("solAmount") val solAmount: Double,
    @SerializedName("usdcAmount") val usdcAmount: Double,
    @SerializedName("totalUsd") val totalUsd: Double,
    @SerializedName("claimableSol") val claimableSol: Double,
    @SerializedName("claimableUsdc") val claimableUsdc: Double,
    @SerializedName("positions") val positions: List<Position>?
)

data class Position(
    @SerializedName("mint") val mint: String,              // NFT mint address
    @SerializedName("solAmount") val solAmount: Double,
    @SerializedName("usdcAmount") val usdcAmount: Double,
    @SerializedName("valueUsd") val valueUsd: Double,
    @SerializedName("lowerBinId") val lowerBinId: Int,
    @SerializedName("upperBinId") val upperBinId: Int
)
```

---

## 8. Position Mint Storage & Tracking

**How Position Mints Are Stored:**

1. **In Backend** (`meteoraAdapter.ts`):
   - Position mints stored in `data/state.json`
   - Loaded on startup via `loadCreatedPositionMints()`
   - Updated with new positions via `saveCreatedPositionMints()`

2. **In Android App**:
   - Position mints come from API response: `GET /api/positions`
   - Returned in `Exposure.positions[].mint`
   - Displayed as shortened string: `${mint.take(8)}...${mint.takeLast(8)}`
   - Used for closing position: `viewModel.closePosition(position.mint)`

3. **Position Mint Purpose**:
   - Unique identifier for Meteora DLMM position NFT
   - Required to close position and reclaim rent
   - Displayed to user for verification

---

## 9. Data Flow for Withdrawal

```
User Action: Enters 50% and taps "Withdraw"
                │
                ▼
WithdrawForm: Creates WithdrawRequest(percent = 50.0)
                │
                ▼
MainViewModel.withdraw(): 
  - Sets isPerformingAction = true
  - Calls repository.withdraw(request)
                │
                ▼
Repository.withdraw():
  - Calls apiService.withdraw(request)
  - Handles success/failure
                │
                ▼
Retrofit HTTP POST: POST /api/positions/withdraw
Body: { "percent": 50.0 }
                │
                ▼
Backend Server: Calls MeteoraAdapter.withdrawFromLp()
  - Queries position data from blockchain
  - Executes withdrawal transaction
  - Returns transaction signature
                │
                ▼
Response: TransactionResponse(signature = "...")
                │
                ▼
UI State Update:
  - isPerformingAction = false
  - actionMessage = "Withdrawal successful! TX: ..."
                │
                ▼
Auto-Refresh: Wait 2s, then fetchAllData()
  - GET /api/positions (gets updated position data)
  - Updates positions in UI
```

---

## 10. File Structure Summary

```
/Users/vladimirdemidov/AndroidStudioProjects/QuasarBot/
├── app/src/main/java/com/example/quasarbot/
│   ├── data/
│   │   ├── ApiService.kt         # Retrofit endpoints (withdraw at line 28-29)
│   │   ├── Repository.kt         # Withdraw method (lines 88-100)
│   │   └── Models.kt             # WithdrawRequest, Position, etc.
│   ├── viewmodel/
│   │   └── MainViewModel.kt      # withdraw() function (lines 167-195)
│   └── ui/screens/
│       ├── ActionsTab.kt         # WithdrawForm component (lines 248-315)
│       ├── PositionsTab.kt       # PositionCard with close button
│       ├── OverviewTab.kt        # General overview
│       └── MainScreen.kt         # Main app screen
```

---

## 11. API Communication Details

### Request
```
POST /api/positions/withdraw
Content-Type: application/json

{
  "percent": 50.0
}
```

### Success Response
```json
{
  "signature": "4x5Y9z...",
  "success": true
}
```

### Error Response
```json
{
  "error": "Failed to withdraw",
  "message": "No positions available to withdraw from"
}
```

---

## 12. Related Features

### 12.1 Position Display
- **Tab**: "Positions" tab in main navigation
- **Component**: `PositionsTab.kt`
- **Data**: Fetched via `GET /api/positions`
- **Update**: Every 10 seconds (auto-refresh in ViewModel)

### 12.2 Close Position
- **Triggered**: After 100% withdrawal (position becomes empty)
- **Function**: `viewModel.closePosition(position.mint)`
- **API**: `POST /api/positions/close`
- **Reclaim**: ~0.057 SOL (position NFT rent)
- **Note**: ~0.14 SOL bin array rent is non-refundable

### 12.3 Claim Fees
- **Function**: `viewModel.claimFees()`
- **API**: `POST /api/positions/claim-fees`
- **Returns**: SOL and USDC accumulated from trading fees

### 12.4 Deposit
- **Function**: `viewModel.deposit(sol, usdc, singleSided)`
- **API**: `POST /api/positions/deposit`
- **Types**: Balanced or single-sided (SOL only or USDC only)

---

## 13. Error Handling

**UI Error Display:**
```kotlin
if (uiState.actionMessage != null) {
    Text(
        text = uiState.actionMessage!!.message,
        color = if (uiState.actionMessage!!.isError) 
            MaterialTheme.colorScheme.error 
        else 
            MaterialTheme.colorScheme.primary
    )
}
```

**Common Errors:**
- "No positions available to withdraw from" - No positions loaded
- "Failed to withdraw: 400" - Invalid parameters
- "Failed to withdraw: 500" - Backend error
- Network timeout - Connection issue

---

## 14. Configuration

**Base URL Setup:**
- `BuildConfig.API_BASE_URL` (typically set in build.gradle or local properties)
- Example: `http://192.168.1.100:3001/`
- Must point to backend server running bun-server.ts or hono-server.ts

---

## 15. Key Implementation Notes

1. **Percentage Input**: Only accepts 1-100, validated on UI and sent to API
2. **Default Value**: 100% (full withdrawal)
3. **Loading State**: Button disabled during withdrawal
4. **Auto-Refresh**: Automatically fetches updated positions after 2 seconds
5. **Position Tracking**: NFT mints displayed to user for transparency
6. **Empty Position Detection**: Checks if `solAmount == 0 && usdcAmount == 0`
7. **Error Messages**: Displayed with red color styling
8. **Success Messages**: Includes transaction signature for verification

---

## Summary

The Android app implements withdraw functionality through a clean layered architecture:
- **UI**: Slider + text input for percentage (1-100%)
- **ViewModel**: Manages state and delegates to repository
- **Repository**: Handles HTTP communication
- **API**: Retrofit calls backend `/api/positions/withdraw`
- **Backend**: MeteoraAdapter executes blockchain transaction

Position NFT mints are displayed to users and tracked for close operations.
