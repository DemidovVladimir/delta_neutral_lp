# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a delta-neutral liquidity provision bot for Solana that:
- **Automatically creates** Meteora DLMM positions (SOL/USDC) with configurable ranges
- Provides liquidity on **Meteora DLMM** (SOL/USDC pool)
- Maintains a **Drift** perpetual short position to keep delta-neutral (ΔSOL ≈ 0)
- Uses **direct @solana/web3.js SDK** for on-chain execution with priority fees
- Implements sequential transaction flows with intelligent retry logic

The bot aims to earn LP fees while minimizing directional exposure to SOL price movements.

**No manual position setup required** - the bot can create positions automatically on first run.

## Commands

### Installation
```bash
npm install
# or
pnpm install
```

### Running the Bot

**Production Deployment (Recommended):**

**GCP with Pulumi** (⭐ Recommended - FREE tier, fully automated):
- See [deploy/gcp/pulumi/README.md](deploy/gcp/pulumi/README.md) for complete setup guide
- [Billing Setup](deploy/gcp/pulumi/BILLING_SETUP.md) - Protect against charges
- [Troubleshooting](deploy/gcp/pulumi/TROUBLESHOOTING.md) - Common issues

**Quick Deploy (GCP Pulumi):**
```bash
cd deploy/gcp/pulumi
pulumi up --yes  # One command deployment!
```

**Local Docker (Development/Testing):**

```bash
# Build and run in container
docker compose up -d        # Start bot in background
docker compose logs -f      # View real-time logs
docker compose down         # Stop bot
```

**Available Commands (Direct):**

```bash
# Auto-Tune Mode (Automated Position Rebalancing)
pnpm auto-tune           # Start auto-tune orchestrator (REAL FUNDS!)
pnpm auto-tune:watch     # Start with watch mode (visual display)

# API Server (Hono + Bun)
pnpm api                 # Start API server on port 3001

# Testing (recommended workflow)
pnpm test:local          # Test on localnet mainnet-fork
pnpm test:mainnet        # Test on mainnet (REAL FUNDS!)
pnpm test:integration    # Integration tests for utilities

# Utility scripts
pnpm find-pools          # Find SOL/USDC DLMM pools on mainnet

# Localnet development
pnpm localnet:start      # Start mainnet fork validator
pnpm localnet:stop       # Stop validator

# Development
pnpm build              # Compile TypeScript
pnpm lint               # Run ESLint
pnpm format             # Format with Prettier
```

**Planned CLI commands** (not yet implemented):
- `pnpm start` - Main hedge loop
- Manual LP operations (deposit, withdraw, claim fees)
- Manual Drift operations (rebalance, manage collateral)
- Emergency withdrawal flows

## Architecture

The codebase follows a modular adapter pattern:

### Core Modules

**Implemented:**

1. **MeteoraAdapter** (`src/modules/meteoraAdapter.ts`)
   - ✅ Auto-creates LP positions with configured price ranges
   - ✅ Reads LP exposure from position NFTs (SOL/USDC amounts)
   - ✅ Fetches pool analytics from Meteora DLMM API (cached 2.5s)
   - ✅ Calculates position composition (token X/Y percentages)
   - ✅ Persists created position NFT mints to state
   - ✅ **ATOMIC WITHDRAW+CLAIM+CLOSE**: Single transaction using SDK's `shouldClaimAndClose=true`
   - ✅ **TWO-STEP REBALANCE**: TX1 (withdraw+claim+close) + TX2 (create new position)
   - ✅ **Minimal API**: Only `createPosition()` and `withdrawClaimAndClose()` for focused bot functionality

2. **PriceOracle** (`src/core/priceOracle.ts`)
   - ✅ Jupiter API v6 integration with multi-token price fetching
   - ✅ Direct SOL/USDC exchange rate via vsToken parameter
   - ✅ Pyth oracle fallback for price feeds
   - ✅ Price caching with configurable TTL
   - ✅ Multi-source price validation

3. **JupiterSwapper** (`src/modules/jupiterSwapper.ts`)
   - ✅ **Jupiter Ultra API integration** for token swaps (faster, cheaper, better support)
   - ✅ **Simple 2-Step Flow**: Get order → Sign → Execute (no complex bundling)
   - ✅ **95% sub-2s execution**: Jupiter handles transaction optimization internally
   - ✅ **RPC-less architecture**: Jupiter handles broadcasting and polling
   - ✅ Slippage protection with configurable tolerance (default: 50 BPS = 0.5%)
   - ✅ Helper methods for SOL ↔ USDC swaps
   - ✅ **Target-based swapping**: Calculates exact shortfall based on deposit amount
   - ✅ **Intelligent error handling**: Comprehensive logging and retry logic

4. **Persistence Layer** (`src/modules/persistence.ts`)
   - ✅ State snapshot management (positions, exposure, timestamps)
   - ✅ Action journal for execution history
   - ✅ Auto-created position NFT tracking
   - ✅ Auto-tune state tracking:
     - Iteration count, rebalance count, timestamps
     - **Aggregated claimed fees** (total SOL/USDC claimed across all rebalances)
     - **Last position created details** (position mint, initial deposits, timestamp)
   - ✅ JSON-based storage in data/ directory

5. **AutoTuneOrchestrator** (`src/modules/autoTuneOrchestrator.ts`)
   - ✅ Monitors position composition at configurable intervals
   - ✅ Detects position imbalance (e.g., >80% in one token)
   - ✅ **Two-Phase Rebalance Flow**:
     - Phase 1: Withdraw 100% + Claim + Close (single atomic TX)
     - Swap Phase (if needed): Execute Jupiter swap BEFORE position creation
     - Phase 2: Create new position with simple retry logic (max 3 attempts)
   - ✅ **Pre-flight Balance Check**: Detects insufficient funds BEFORE any operations
   - ✅ **Sequential Swap Execution**: Swap executed as separate TX before position creation
   - ✅ **Target-Based Swapping**: Calculates exact shortfall based on configured deposit amount
   - ✅ **Dual Reserve System**:
     - `MINIMUM_WALLET_BALANCE_SOL`: Permanent reserve (never touched)
     - `RENT_RESERVE_SOL`: Temporary reserve for rent/fees
   - ✅ **Fee Auto-Compounding**: Claimed fees automatically added to new positions
   - ✅ **User-Controlled Deposits**: Based on `AUTO_TUNE_DEPOSIT_TOKEN` + `AUTO_TUNE_DEPOSIT_AMOUNT`
   - ✅ Tracks total claimed fees across all rebalances
   - ✅ Records initial deposit amounts for each position created
   - ✅ Maintains concentrated liquidity with fixed bin count
   - ✅ State persistence across restarts

6. **Utility Modules:**
   - **meteoraUtils** (`src/utils/meteoraUtils.ts`)
     - ✅ Bin price calculations from bin ID
     - ✅ Token percentage composition calculator
     - ✅ Meteora API client for pool analytics
     - ✅ Position imbalance detection
     - ✅ Centered price range calculation for rebalancing
   - **solana** (`src/utils/solana.ts`)
     - ✅ Direct @solana/web3.js integration
     - ✅ Wallet keypair management and parsing
     - ✅ Connection initialization and validation
     - ✅ No wrapper libraries - simple and direct
   - **logger** (`src/utils/logger.ts`)
     - ✅ Console-only logging (no file output)
     - ✅ Simplified timestamp format (HH:mm:ss)
     - ✅ Error banner for critical failures
     - ✅ Reduced verbosity for cleaner output

7. **API Server** (`src/api/hono-server.ts`)
   - ✅ Hono framework with Bun runtime
   - ✅ RESTful endpoints for LP operations
   - ✅ Pool analytics and bin data endpoints
   - ✅ Price oracle endpoints (Jupiter + Pyth)
   - ✅ CORS enabled for web UI integration

**API Endpoints:**
- `GET /api/health` - Health check
- `GET /api/prices` - Oracle prices (Jupiter + Pyth)
- `GET /api/pool/analytics` - Pool APR, APY, volume, fees
- `GET /api/pool/bins` - Bin distribution and liquidity data
- `GET /api/positions` - User's LP positions and exposure
- `POST /api/positions/create` - Create new LP position
- `POST /api/positions/withdraw-claim-close` - **Atomic operation: Withdraw 100% + Claim + Close in ONE transaction**

**Planned (not yet implemented):**

- 🔜 **DriftEngine** - Perpetual short positions and rebalancing
- 🔜 **RiskController** - Delta thresholds, margin requirements, funding rate caps
- 🔜 **Orchestrator** - Main hedge loop and emergency flows

## Key Technical Details

### Recent Improvements (January 2025)

**Major Simplification & Cleanup:**

1. **Removed External Dependencies**
   - ✅ Removed `solana-agent-kit` - now using direct @solana/web3.js
   - ✅ Removed Jito bundling - simplified to sequential execution with priority fees
   - ✅ Cleaner codebase with fewer layers of abstraction

2. **Jupiter Ultra API Migration**
   - ✅ **Migrated from Jupiter V6 to Ultra API** - faster, cheaper, better support
   - ✅ **Simple 2-step flow**: Get order → Execute (Jupiter handles everything)
   - ✅ **95% sub-2s execution** via Jupiter's proprietary transaction engine
   - ✅ **RPC-less architecture**: No need to maintain blockchain infrastructure
   - ✅ **Pre-flight balance checking** to detect insufficient funds before any operations
   - ✅ **Target-based swap calculation** with dual reserve system (permanent + temporary)
   - ✅ Removed deprecated `getSwapInstructions` and `getSwapTransaction` methods
   - ✅ Updated helper methods: `swapSolToUsdc()`, `swapUsdcToSol()`

3. **Position Tracking & Recovery** (Latest!)
   - ✅ **Always discover positions from blockchain** - never lose track of unclosed positions
   - ✅ **Duplicate position prevention** - safety checks before creating new positions
   - ✅ **Robust rebalance flow** - keeps position in state if Phase 1 fails
   - ✅ **Enhanced error handling** - detects Jupiter API errors (e.g., "Insufficient funds")
   - ✅ **Wallet balance debugging** - logs balances + checks for unclosed positions on swap failure
   - ✅ **Improved watch mode** - shows last known position when not found on-chain

4. **Logging Improvements**
   - Console-only output (no file logging)
   - Simplified timestamp format (HH:mm:ss)
   - Reduced verbosity (~40% fewer log lines)
   - Error banners for critical failures

5. **Jupiter API v6 Upgrade** (Price Oracle)
   - Multi-token price fetching in single request
   - Direct SOL/USDC rate via `vsToken` parameter
   - Better rate limiting and error handling

6. **Meteora DLMM API Integration**
   - Real-time pool analytics (APR, APY, volume, fees, TVL)
   - 2.5-second cache to prevent stale data
   - Complete pool metadata (bin step, active bin, reserves)

7. **Enhanced Price Utilities**
   - Precise bin price calculations using Decimal.js
   - Position composition calculator (token X/Y percentages)
   - Support for pools with different decimals

See [INTEGRATION_SUMMARY.md](INTEGRATION_SUMMARY.md) for detailed changelog.

### Transaction Execution Strategy

**Current implementation:**
- Uses `skipPreflight: false` with `preflightCommitment: 'confirmed'`
- Priority fees via ComputeBudget instructions (50,000 µL/CU default)
- **No Jito bundling** - simplified to sequential execution
- **Three-Phase Rebalance Flow**:
  1. **Phase 1**: Withdraw+Claim+Close (single atomic TX)
  2. **Swap Phase** (if needed): Execute Jupiter swap, wait for confirmation (2s settle time)
  3. **Phase 2**: Create new position with updated balance
- **Pre-flight Balance Check**: Determines if swap is needed BEFORE any operations
- **Sequential Execution**: All transactions execute one after another with confirmations
- **Target-Based Swapping**:
  - Calculates exact shortfall based on `AUTO_TUNE_DEPOSIT_AMOUNT` + claimed fees
  - Respects dual reserves: `MINIMUM_WALLET_BALANCE_SOL` (permanent) + `RENT_RESERVE_SOL` (temporary)
  - Adds 2% slippage buffer for price impact
- **Simple Retry Logic**:
  - Position creation retries up to 3 times with exponential backoff
  - Swap already executed if needed, so retries are for network errors only
  - Max 3 retries before giving up

**Design philosophy:**
- Simplicity over complexity - sequential execution is more reliable
- No Jito dependency - reduces external dependencies and DNS issues
- Direct @solana/web3.js usage - no wrapper libraries

### Configuration (.env)

**Core Configuration:**
- `RPC_URL`: Solana RPC endpoint
- `PRIVATE_KEY`: Wallet private key (base58 or comma-separated bytes)

**Meteora Position Setup (choose one approach):**

*Option 1: Auto-create positions (recommended)*
- `AUTO_CREATE_POSITIONS=true`: Enable automatic position creation
- `METEORA_POOL_ADDRESS`: Meteora DLMM pool address (e.g., SOL/USDC pool)
- `INITIAL_DEPOSIT_SOL`: Initial SOL deposit amount (e.g., 10)
- `INITIAL_DEPOSIT_USDC`: Initial USDC deposit amount (e.g., 1000)
- `PRICE_RANGE_BPS_LOWER`: Lower price bound in basis points from current (e.g., -100 = -1%)
- `PRICE_RANGE_BPS_UPPER`: Upper price bound in basis points from current (e.g., 100 = +1%)
- `METEORA_STRATEGY_TYPE`: Liquidity distribution strategy (default: "spot")
  - `spot`: Balanced liquidity distribution across bins
  - `curve`: Weighted distribution (concentrated in center)
  - `bidask`: One-sided liquidity provision

**Note on Balanced Deposits:**
- Meteora DLMM automatically distributes deposits across the price range based on current price
- For localnet testing with mainnet-fork: Use single-sided SOL deposits (set `INITIAL_DEPOSIT_USDC=0`)
- For production/mainnet: Use balanced deposits with both SOL and USDC
- Tighter ranges (±1-2%) work better with pools that have small bin steps (like bin step = 4)

*Option 2: Use existing positions*
- `AUTO_CREATE_POSITIONS=false` (or omit)
- `METEORA_POSITION_MINTS`: Comma-separated existing position NFT addresses
- `LP_OWNER`: Owner address for LP positions

**Drift Configuration:**
- `DRIFT_MARKET_SOL_PERP`: Drift market index for SOL-PERP (typically 0)

**Auto-Tune Configuration (NEW!):**
- `AUTO_TUNE_ENABLED`: Enable automatic position rebalancing (default: false)
- `AUTO_TUNE_BIN_COUNT`: Number of bins for concentrated liquidity (default: 20)
- `AUTO_TUNE_CHECK_INTERVAL_MS`: Check interval in milliseconds (default: 30000 = 30s)
- `AUTO_TUNE_IMBALANCE_THRESHOLD`: Trigger threshold as decimal (default: 0.8 = 80%)
- `AUTO_TUNE_DEPOSIT_TOKEN`: Base token for position sizing (SOL or USDC, default: SOL)
- `AUTO_TUNE_DEPOSIT_AMOUNT`: Amount of deposit token to use (default: 1.0)
- `AUTO_TUNE_MAX_RETRIES`: Maximum retries for position creation (default: 3)

**Swap Configuration (Jupiter Integration - NEW!):**
- `SWAP_ENABLED`: Enable Jupiter swap functionality (default: true)
- `SWAP_SLIPPAGE_BPS`: Slippage tolerance in basis points (default: 50 = 0.5%)

**Wallet Reserve Configuration (NEW!):**
- `MINIMUM_WALLET_BALANCE_SOL`: Permanent reserve that never gets touched (default: 0.2)
- `RENT_RESERVE_SOL`: Temporary reserve for rent/fees during position creation (default: 0.1)

**Risk parameters:**
- `DELTA_THRESHOLD_SOL`: Maximum delta before rebalancing (default: 2)
- `MIN_COLLATERAL_RATIO`: Minimum collateral ratio (default: 0.15)
- `MAX_SHORT_NOTIONAL_USD`: Maximum short position size (default: 12000)
- `FUNDING_RATE_CAP_BPS`: Maximum acceptable funding rate in basis points (default: 80)

**Note on Transaction Fees:**
- **Meteora SDK:** Handles priority fees automatically in all position operations
- **Jupiter Ultra API:** Handles priority fees automatically in swap transactions
- No manual fee configuration needed - both SDKs optimize fees internally

### State Management

- Structured JSON logs for all operations
- Action journal persists execution history
- State snapshot includes: LP exposure, short position, collateral, delta, timestamps
- **Auto-created position mints** are saved to `data/state.json` for persistence across restarts
- **Auto-tune state** is saved to `data/auto-tune-state.json` with iteration count, rebalance history, and error tracking

## Auto-Tune Feature (NEW!)

The **Auto-Tune Orchestrator** provides fully automated position rebalancing for Meteora DLMM positions:

### How It Works

1. **Monitors** position composition at configurable intervals (default: every 30s)
2. **Detects** when position becomes imbalanced (e.g., >80% in one token)
3. **Executes** three-phase rebalance flow:
   - **Phase 1**: Withdraw 100% + Claim + Close (single atomic TX)
   - **Swap Phase** (if needed): Execute Jupiter swap, wait for confirmation
   - **Phase 2**: Create new position centered at current price

**Sequential execution with pre-flight checks for reliability!**

### Key Features

- **Concentrated Liquidity**: Maintains fixed bin count (default: 20 bins) for capital efficiency
- **Auto-Compounding**: Claimed fees automatically added to new position
- **Sequential Execution**: Phase 1 (withdraw+claim+close) → Swap (if needed) → Phase 2 (create)
- **Pre-flight Balance Check**: Detects insufficient funds before any operations
- **Target-Based Swapping**: Calculates exact shortfall, respects dual reserve system
- **State Persistence**: Survives restarts with full state recovery
- **Error Handling**: Simple retry with exponential backoff (max 3 attempts)

### Configuration

```bash
# Enable auto-tune
AUTO_TUNE_ENABLED=true

# Concentrated liquidity (20 bins = tight range, high capital efficiency)
AUTO_TUNE_BIN_COUNT=20

# Check position balance every 10 seconds
AUTO_TUNE_CHECK_INTERVAL_MS=10000

# Trigger rebalance when position becomes 80% or more in one token
AUTO_TUNE_IMBALANCE_THRESHOLD=0.8

# Deposit token for position sizing
AUTO_TUNE_DEPOSIT_TOKEN=SOL

# Amount of deposit token (e.g., 0.5 SOL)
AUTO_TUNE_DEPOSIT_AMOUNT=0.5

# Wallet reserves (permanent + temporary)
MINIMUM_WALLET_BALANCE_SOL=0.2
RENT_RESERVE_SOL=0.1
```

### Running Auto-Tune

```bash
# Start auto-tune mode
pnpm auto-tune

# The bot will:
# 1. Load or create initial position
# 2. Monitor position composition every 10s
# 3. Automatically rebalance when imbalanced
# 4. Auto-compound fees into new positions
# 5. Log all operations to data/auto-tune-state.json
```

### Example Workflow

**Initial State:**
- SOL price: $160
- Position: 20 bins centered at $160 (range: $158-$162)
- Composition: 50% SOL, 50% USDC

**Price Moves to $180:**
- Position composition becomes: 15% SOL, 85% USDC ❌ (exceeds 80% threshold)
- Auto-tune detects imbalance
- **Three-phase rebalance executes:**
  1. **Phase 1**: Withdraws all liquidity + claims fees + closes position (0.5 SOL + 85 USDC + fees)
  2. **Pre-flight check**: Wallet has 0.557 SOL + 86 USDC, needs 0.5 SOL + 90 USDC for target
  3. **Swap phase**: Swaps 0.022 SOL → 4 USDC to cover USDC shortfall
  4. **Phase 2**: Creates new position at $180 with 0.535 SOL + 90 USDC (fees compounded!)
- New position: 20 bins centered at $180 (range: $178-$182)
- Composition: 50% SOL, 50% USDC ✅

**Sequential execution with target-based swapping!**

## Jupiter Swapper Integration (Jupiter Ultra API!)

The **Jupiter Swapper** module enables intelligent token swaps for automatic position balancing using **Jupiter Ultra API**:

### Purpose

Handles scenarios where wallet has insufficient token balance for position creation. Instead of requiring manual token acquisition, the bot automatically swaps tokens to achieve the target balance based on `AUTO_TUNE_DEPOSIT_AMOUNT`.

### Jupiter Ultra API Flow

The swapper now uses Jupiter's **Ultra API** for faster, cheaper, and more reliable swaps:

**Step 1: Get Order**
```
Request order from Jupiter Ultra API:
├─ Input mint (SOL or USDC)
├─ Output mint (USDC or SOL)
├─ Amount in human-readable units
├─ Slippage tolerance (default: 50 BPS = 0.5%)
└─ Taker address (wallet public key)

Response contains:
├─ Unsigned transaction (base64-encoded)
├─ Request ID for execution
├─ Expected input/output amounts
└─ Order ID for tracking
```

**Step 2: Sign Transaction**
```
Deserialize transaction from order response
Sign with wallet keypair
Serialize back to base64
```

**Step 3: Execute Order**
```
Submit signed transaction to Jupiter Ultra API:
├─ Jupiter handles broadcasting
├─ Jupiter polls for confirmation
├─ 95% complete in <2 seconds
└─ Returns transaction signature + status
```

### Sequential Three-Phase Rebalance Flow

**Phase 1: Withdraw + Claim + Close (Single Atomic Transaction)**
- Withdraw 100% liquidity from old position
- Claim all accumulated fees (auto-compounded into new position)
- Close position and reclaim rent (~0.057 SOL)

**Pre-flight Balance Check**
- Calculate target deposits: `AUTO_TUNE_DEPOSIT_AMOUNT` (base) + claimed fees
- Check actual wallet balances (SOL + USDC)
- Determine if swap is needed BEFORE any position creation attempts

**Swap Phase (if needed) - Using Jupiter Ultra!**
```
IF insufficient balance detected:
├─ Calculate exact shortfall for missing token
├─ Respect dual reserves:
│  ├─ MINIMUM_WALLET_BALANCE_SOL (permanent, never touched)
│  └─ RENT_RESERVE_SOL (temporary for rent/fees)
├─ Calculate swap amount with 2% slippage buffer
├─ Execute Jupiter Ultra swap (3 steps above)
├─ Jupiter handles confirmation (95% < 2s)
└─ Continue to Phase 2 with updated balance
```

**Phase 2: Create New Position (Simple Retry)**
```
Attempt 1, 2, 3:
├─ Try to create position with current balance
├─ If FAIL: Wait (1s, 2s, 3s exponential backoff)
└─ Max 3 retries, then give up
```

### Key Features

- **Jupiter Ultra API Integration**: Faster, cheaper, better support than legacy V6
- **RPC-less Architecture**: Jupiter handles broadcasting and polling
- **95% sub-2s execution**: Jupiter's proprietary transaction engine
- **Pre-flight Balance Check**: Detects insufficient funds BEFORE any operations
- **Target-Based Swapping**: Calculates exact shortfall, not generic 50/50 rebalancing
- **Dual Reserve System**:
  - `MINIMUM_WALLET_BALANCE_SOL`: Permanent reserve (e.g., 0.2 SOL, never touched)
  - `RENT_RESERVE_SOL`: Temporary reserve for rent/fees (e.g., 0.1 SOL)
- **Smart Shortfall Calculation**:
  - Available SOL = Actual SOL - (Minimum Balance + Rent Reserve)
  - Swap only the exact amount needed to reach target
- **Slippage Protection**: Configurable slippage tolerance (default: 50 BPS)
- **Simple Retry Logic**: Position creation retries up to 3 times with exponential backoff
- **Helper Methods**: `swapSolToUsdc()`, `swapUsdcToSol()`, `executeSwap()`

### Example: Real-World Rebalance Scenario

**Starting State:**
- User config: `AUTO_TUNE_DEPOSIT_TOKEN=SOL`, `AUTO_TUNE_DEPOSIT_AMOUNT=0.5`
- Reserves: `MINIMUM_WALLET_BALANCE_SOL=0.2`, `RENT_RESERVE_SOL=0.1`
- Old position at $180: 0.01 SOL + 85 USDC (95% USDC, imbalanced!)
- Current price: $180/SOL

**Phase 1: Withdraw + Claim + Close**
```
Withdrawn: 0.01 SOL + 85 USDC
Claimed fees: 0.005 SOL + 0.5 USDC
Reclaimed rent: 0.057 SOL
Total in wallet: 0.072 SOL + 85.5 USDC
```

**Pre-flight Balance Check**
```
Target deposits:
- SOL: 0.5 (base) + 0.005 (fees) = 0.505 SOL
- USDC: 0.505 * $180 = 90.9 USDC (for balanced position)

Available balance:
- Actual SOL: 0.072
- Reserves: 0.2 (permanent) + 0.1 (rent) = 0.3 total
- Available SOL: 0.072 - 0.3 = -0.228 (INSUFFICIENT!)
- Actual USDC: 85.5
- Needed USDC: 90.9 (INSUFFICIENT!)

Result: Need USDC swap!
```

**Swap Phase**
```
USDC shortfall: 90.9 - 85.5 = 5.4 USDC
But we can't swap SOL (no available SOL after reserves)
ERROR: Insufficient balance for both tokens!

Alternative: User needs to deposit more funds or reduce AUTO_TUNE_DEPOSIT_AMOUNT
```

**Realistic scenario with sufficient wallet balance:**
```
Wallet after Phase 1: 0.5 SOL + 85.5 USDC
Target: 0.505 SOL + 90.9 USDC
Available SOL: 0.5 - 0.3 = 0.2 SOL
USDC shortfall: 90.9 - 85.5 = 5.4 USDC

Swap calculation:
- Need 5.4 USDC
- SOL to swap: (5.4 / 180) * 1.02 = 0.0306 SOL (with 2% buffer)
- Available SOL: 0.2 (sufficient!)

Execute swap: 0.0306 SOL → ~5.5 USDC
New balance: 0.4694 SOL + 91 USDC
Create position: 0.505 SOL + 90.9 USDC ✅ SUCCESS!
```

### Position Tracking & Recovery

The bot now includes robust position tracking to prevent losing track of positions when errors occur:

**How it works:**
1. **Blockchain Discovery**: Every check cycle queries blockchain for positions (not just state.json)
2. **Safety Checks**: Before creating new position, double-checks blockchain to prevent duplicates
3. **State Persistence**: Position mints saved to state immediately after discovery/creation
4. **Failed Rebalance Handling**: If Phase 1 fails, position mint stays in state for retry

**Error Detection:**
- Jupiter API errors (e.g., "Insufficient funds") detected and displayed clearly
- Swap failures trigger wallet balance logging + unclosed position detection
- Watch mode shows last known position when not found on-chain

**What this prevents:**
- ❌ Creating duplicate positions when one already exists
- ❌ Losing track of position after failed rebalance
- ❌ Confusing "No transaction in order response" errors
- ❌ Silent failures where funds get locked in unclosed positions

**Example error output:**
```
╔════════════════════════════════════════════════════════════════╗
║                        ERROR BANNER                            ║
╚════════════════════════════════════════════════════════════════╝
❌ Jupiter API returned an error
  errorCode: 1
  errorMessage: Insufficient funds
  requestId: 019a82ee-1718-73c4-bbcb-937242e07fdb

❌ Swap failed - current wallet balances
  walletBalances:
    sol: 0.258867567
    usdc: 9.436356
  swapParams:
    inputMint: USDC
    outputMint: SOL
    amount: 587.445237

⚠️  UNCLOSED POSITION DETECTED
  message: Funds may be locked in position that was not properly closed
  positions: ["GMr7dGrxdPRc1pgaKYgbGaMe5vXPpR6VLozwrvnx25Pm"]
  suggestion: Manually close position from Meteora dashboard or retry rebalance
```

### Configuration

```bash
# Enable swaps (default: true)
SWAP_ENABLED=true

# Slippage tolerance: 50 basis points = 0.5%
SWAP_SLIPPAGE_BPS=50

# Deposit token for position sizing (SOL or USDC)
AUTO_TUNE_DEPOSIT_TOKEN=SOL

# Amount of deposit token to use (default: 1.0)
AUTO_TUNE_DEPOSIT_AMOUNT=1.0

# Maximum retries for position creation (default: 3)
AUTO_TUNE_MAX_RETRIES=3

# Wallet reserves
MINIMUM_WALLET_BALANCE_SOL=0.2
RENT_RESERVE_SOL=0.1
```

### Use Cases

1. **Position Creation**: When wallet lacks one token, swap automatically before creating position
2. **Rebalancing**: When position becomes imbalanced, swap to achieve target balance
3. **Target-Based Sizing**: User controls position size via `AUTO_TUNE_DEPOSIT_AMOUNT`
4. **Reserve Protection**: Maintains minimum wallet balance for operational safety

### Technical Details

- **Jupiter Ultra API**: Faster, cheaper, better support than legacy V6
- **RPC-less Architecture**: Jupiter handles broadcasting and polling
- **95% sub-2s execution**: Jupiter's proprietary transaction engine
- **Simple 3-Step Flow**: Get order → Sign → Execute
- **Target-Based Calculation**: Calculates exact shortfall, not generic rebalancing
- **Dual Reserve System**: Protects permanent minimum + temporary rent reserves
- **Slippage Protection**: Configurable tolerance (default: 50 BPS = 0.5%)
- **Status Tracking**: Returns transaction signature and execution status

## Development Workflow

The project is structured around epics (K-P) outlined in the PRD:

- **Epic K**: Bootstrap & Agent Kit wiring (config, logger, price oracle)
- **Epic L**: Meteora DLMM adapter implementation
- **Epic M**: Drift hedge engine
- **Epic N**: Bundle & priority fee execution
- **Epic O**: Risk limits & persistence layer
- **Epic P**: Main orchestrator & emergency flows

When implementing features, follow the module interfaces defined in the PRD (agent-kit-mvp-prd.md sections 6-7).

## Important Notes

- **Auto-position creation**: Set `AUTO_CREATE_POSITIONS=true` to have the bot create Meteora positions automatically on first run. No manual wallet/UI steps needed.
- **Auto-tune rebalancing**: Set `AUTO_TUNE_ENABLED=true` to enable fully automated position rebalancing. The bot will monitor positions and automatically rebalance when they become imbalanced (>80% in one token).
- **Jupiter swapper integration**: The bot automatically swaps tokens when wallet has insufficient balance for position creation. Swap is executed as separate transaction BEFORE position creation.
- **Sequential execution**: Auto-tune uses three-phase flow: Phase 1 (withdraw+claim+close) → Swap (if needed) → Phase 2 (create new position).
- **Target-based swapping**: Swap calculations are based on `AUTO_TUNE_DEPOSIT_AMOUNT` target, not generic 50/50 rebalancing. Respects dual reserve system (permanent + temporary).
- **Pre-flight checks**: Balance check runs BEFORE any operations to determine if swap is needed, avoiding wasted gas on failed transactions.
- **Direct Solana SDK**: All execution uses direct @solana/web3.js - no wrapper libraries or external dependencies
- **Simplified architecture**: Removed Jito bundling and solana-agent-kit for cleaner, more maintainable code
- **Console-only logging**: All logs go to terminal (no file output) with simplified format
- Test emergency flows thoroughly with dry-run flag before mainnet
- Monitor funding rates closely - high sustained funding can erode profitability
- The bot maintains delta neutrality via band rebalancing, not continuous hedging
- **Always update** `progress.md` after every run, add bug reports to `bugs.md`, and document architectural decisions in `decisions.md`




Fetching SOL/USD price from Pyth Hermes API {"url":"https://hermes.pyth.network/v2/updates/price/latest?ids[]=0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d","feedId":"0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d"}
16:13:52 [debug] Fetching token prices from Jupiter Lite API v3 {"url":"https://lite-api.jup.ag/price/v3?ids=So11111111111111111111111111111111111111112","mints":["So11111111111111111111111111111111111111112"]}
16:13:52 [debug] Fetched token prices from Jupiter Lite API v3 {"tokens":1,"prices":{"So11111111111111111111111111111111111111112":{"id":"So11111111111111111111111111111111111111112","mintSymbol":"SOL","price":140.45447269381415,"timestamp":1763133232794}}}
16:13:52 [debug] Fetched SOL price from Jupiter v6 {"price":140.45447269381415}
16:13:52 [debug] Fetched SOL/USD price from Pyth Hermes {"price":140.55050014,"conf":"8496961","expo":-8,"publishTime":1763133231}
16:13:52 [info] Fetched prices from both sources {"pyth":140.55050014,"jupiter":140.45447269381415,"diffUsd":"0.0960","diffPct":"0.0683"}
16:13:52 [info] Swapping USDC → SOL to cover shortfall {"missingSol":3.953704077,"swapAmountUsdc":566.8089871364652}
16:13:52 [info] 🔄 Swapping 566.81 USDC → SOL
16:13:52 [info] 🔄 Executing swap (Jupiter Ultra) {"inputMint":"EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v","outputMint":"So11111111111111111111111111111111111111112","amount":566.8089871364652}
16:13:52 [info] 🔄 Requesting Jupiter Ultra order {"inputMint":"EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v","outputMint":"So11111111111111111111111111111111111111112","amount":566.8089871364652,"amountRaw":566808987,"slippageBps":200,"taker":"F3YvPiLdniRPGpeKrbeGWR2zg2wPpzVuvqBA5BBJBQ5S"}
16:13:53 [debug] Jupiter Ultra order response {"responseKeys":["inAmount","outAmount","otherAmountThreshold","swapMode","slippageBps","priceImpactPct","routePlan","feeMint","feeBps","platformFee","taker","gasless","signatureFeeLamports","signatureFeePayer","prioritizationFeeLamports","prioritizationFeePayer","rentFeeLamports","rentFeePayer","transaction","errorCode","errorMessage","inputMint","outputMint","swapType","router","requestId","inUsdValue","outUsdValue","swapUsdValue","priceImpact","mode","error","totalTime"],"hasTransaction":false,"requestId":"019a82ee-1718-73c4-bbcb-937242e07fdb"}
16:13:53 [error] No transaction in order response - full response: {"order":"{\n  \"inAmount\": \"566808987\",\n  \"outAmount\": \"4031467333\",\n  \"otherAmountThreshold\": \"3991152659\",\n  \"swapMode\": \"ExactIn\",\n  \"slippageBps\": 100,\n  \"priceImpactPct\": \"-0.0007154577850814085\",\n  \"routePlan\": [\n    {\n      \"swapInfo\": {\n        \"ammKey\": \"4uWuh9fC7rrZKrN8ZdJf69MN1e2S7FPpMqcsyY1aof6K\",\n        \"label\": \"GoonFi\",\n        \"inputMint\": \"EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v\",\n        \"outputMint\": \"So11111111111111111111111111111111111111112\",\n        \"inAmount\": \"566808987\",\n        \"outAmount\": \"4032273787\",\n        \"feeAmount\": \"0\",\n        \"feeMint\": \"11111111111111111111111111111111\",\n        \"marketIncurredSlippageBpsF64\": \"0.5674725955083124\"\n      },\n      \"percent\": 100,\n      \"bps\": 10000,\n      \"usdValue\": 566.6430276043139\n    }\n  ],\n  \"feeMint\": \"So11111111111111111111111111111111111111112\",\n  \"feeBps\": 2,\n  \"platformFee\": {\n    \"feeBps\": 2\n  },\n  \"taker\": \"F3YvPiLdniRPGpeKrbeGWR2zg2wPpzVuvqBA5BBJBQ5S\",\n  \"gasless\": false,\n  \"signatureFeeLamports\": 0,\n  \"signatureFeePayer\": null,\n  \"prioritizationFeeLamports\": 0,\n  \"prioritizationFeePayer\": null,\n  \"rentFeeLamports\": 0,\n  \"rentFeePayer\": null,\n  \"transaction\": \"\",\n  \"errorCode\": 1,\n  \"errorMessage\": \"Insufficient funds\",\n  \"inputMint\": \"EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v\",\n  \"outputMint\": \"So11111111111111111111111111111111111111112\",\n  \"swapType\": \"aggregator\",\n  \"router\": \"iris\",\n  \"requestId\": \"019a82ee-1718-73c4-bbcb-937242e07fdb\",\n  \"inUsdValue\": 566.6430276043139,\n  \"outUsdValue\": 566.2376184388523,\n  \"swapUsdValue\": 566.6430276043139,\n  \"priceImpact\": -0.07154577850814085,\n  \"mode\": \"ultra\",\n  \"error\": \"Insufficient funds\",\n  \"totalTime\": 186\n}"}
16:13:53 [error] ❌ Failed to get Jupiter Ultra order {"error":"No transaction found in order response","params":{"inputMint":"EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v","outputMint":"So11111111111111111111111111111111111111112","amount":566.8089871364652}}
16:13:53 [error] ❌ Swap execution failed {"error":"Failed to fetch swap order","params":{"inputMint":"EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v","outputMint":"So11111111111111111111111111111111111111112","amount":566.8089871364652},"durationMs":247}
16:13:53 [error] Failed to create initial position {"error":"Swap execution failed","durationMs":900}
16:13:53 [error] Failed to create initial position {"error":"Swap execution failed"}
16:13:53 [debug] Auto-tune state saved {"file":"data/auto-tune-state.json","iteration":9258,"rebalanceCount":62}