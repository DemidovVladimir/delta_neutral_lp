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

See deployment guides:
- **[GCP with Pulumi](docs/GCP_PULUMI_DEPLOYMENT.md)** - FREE, already configured! (⭐ Recommended)
- **[Deployment Options](docs/DEPLOYMENT_SUMMARY.md)** - Compare all options (Hetzner, DigitalOcean, Fly.io, etc.)
- **[Docker Guide](docs/DOCKER_GUIDE.md)** - Local Docker setup

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
   - ✅ Deposits/withdrawals with single-sided support
   - ✅ Fee claiming functionality
   - ✅ **ATOMIC WITHDRAW+CLAIM+CLOSE**: Single transaction using SDK's `shouldClaimAndClose=true`
   - ✅ **TWO-STEP REBALANCE**: TX1 (withdraw+claim+close) + TX2 (create new position)

2. **PriceOracle** (`src/core/priceOracle.ts`)
   - ✅ Jupiter API v6 integration with multi-token price fetching
   - ✅ Direct SOL/USDC exchange rate via vsToken parameter
   - ✅ Pyth oracle fallback for price feeds
   - ✅ Price caching with configurable TTL
   - ✅ Multi-source price validation

3. **JupiterSwapper** (`src/modules/jupiterSwapper.ts`)
   - ✅ Jupiter V6 API integration for token swaps
   - ✅ **Sequential Execution**: Execute swap, wait for confirmation, then create position
   - ✅ **Swap Quote**: Fetches optimal routes with price impact analysis
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
- `POST /api/positions/deposit` - Deposit to existing position
- `POST /api/positions/withdraw` - Withdraw from position
- `POST /api/positions/claim-fees` - Claim accumulated fees
- `POST /api/positions/close` - Close empty position (reclaim rent)
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

2. **Jupiter Swap Integration**
   - **Pre-flight balance checking** to detect insufficient funds before any operations
   - **Target-based swap calculation** with dual reserve system (permanent + temporary)
   - **Sequential execution**: Swap → Wait for confirmation → Create position
   - 2% slippage buffer for price impact protection

3. **Logging Improvements**
   - Console-only output (no file logging)
   - Simplified timestamp format (HH:mm:ss)
   - Reduced verbosity (~40% fewer log lines)
   - Error banners for critical failures

4. **Jupiter API v6 Upgrade**
   - Multi-token price fetching in single request
   - Direct SOL/USDC rate via `vsToken` parameter
   - Better rate limiting and error handling

5. **Meteora DLMM API Integration**
   - Real-time pool analytics (APR, APY, volume, fees, TVL)
   - 2.5-second cache to prevent stale data
   - Complete pool metadata (bin step, active bin, reserves)

6. **Enhanced Price Utilities**
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

**Execution parameters (Optimized for 2025 fee market):**
- `PRIORITY_FEE_MICRO_LAMPORTS`: Priority fee in micro-lamports per CU (default: 50000 = moderate priority)
- `MAX_COMPUTE_UNITS`: Maximum compute units per transaction (default: 600000)
- `JUPITER_PRIORITY_FEE_LAMPORTS`: Fixed priority fee for Jupiter swaps (default: 80000 lamports)

**Note on Priority Fees:**
- Priority fees are added via ComputeBudget instructions
- Formula: `priorityFee = computeUnits × microLamportsPerCU / 1,000,000`
- With 600k CUs @ 50,000 µL/CU: ~30,000 lamports (~$0.0048) per tx
- Jupiter swaps use fixed 80,000 lamport fee (~$0.013) for reliability

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

## Jupiter Swapper Integration (NEW!)

The **Jupiter Swapper** module enables intelligent token swaps for automatic position balancing:

### Purpose

Handles scenarios where wallet has insufficient token balance for position creation. Instead of requiring manual token acquisition, the bot automatically swaps tokens to achieve the target balance based on `AUTO_TUNE_DEPOSIT_AMOUNT`.

### Sequential Three-Phase Rebalance Flow

**Phase 1: Withdraw + Claim + Close (Single Atomic Transaction)**
- Withdraw 100% liquidity from old position
- Claim all accumulated fees (auto-compounded into new position)
- Close position and reclaim rent (~0.057 SOL)

**Pre-flight Balance Check**
- Calculate target deposits: `AUTO_TUNE_DEPOSIT_AMOUNT` (base) + claimed fees
- Check actual wallet balances (SOL + USDC)
- Determine if swap is needed BEFORE any position creation attempts

**Swap Phase (if needed)**
```
IF insufficient balance detected:
├─ Calculate exact shortfall for missing token
├─ Respect dual reserves:
│  ├─ MINIMUM_WALLET_BALANCE_SOL (permanent, never touched)
│  └─ RENT_RESERVE_SOL (temporary for rent/fees)
├─ Calculate swap amount with 2% slippage buffer
├─ Execute Jupiter swap transaction
├─ Wait for confirmation (2s settle time)
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

- **Pre-flight Balance Check**: Detects insufficient funds BEFORE any operations
- **Sequential Execution**: Swap → Wait for confirmation (2s) → Create Position
- **Target-Based Swapping**: Calculates exact shortfall, not generic 50/50 rebalancing
- **Dual Reserve System**:
  - `MINIMUM_WALLET_BALANCE_SOL`: Permanent reserve (e.g., 0.2 SOL, never touched)
  - `RENT_RESERVE_SOL`: Temporary reserve for rent/fees (e.g., 0.1 SOL)
- **Smart Shortfall Calculation**:
  - Available SOL = Actual SOL - (Minimum Balance + Rent Reserve)
  - Swap only the exact amount needed to reach target
- **Slippage Protection**: 2% buffer added to swap amounts for price impact
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

- **Jupiter V6 API**: Latest aggregator with best swap routes
- **Sequential Execution**: Swap → Wait 2s → Create (simpler, more reliable)
- **Target-Based Calculation**: Calculates exact shortfall, not generic rebalancing
- **Dual Reserve System**: Protects permanent minimum + temporary rent reserves
- **Quote Validation**: Fetches quotes before executing swaps
- **Price Impact Tracking**: Logs price impact percentage for monitoring
- **2% Slippage Buffer**: Added to all swap calculations for safety

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