# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a delta-neutral liquidity provision bot for Solana that:
- **Automatically creates** Meteora DLMM positions (SOL/USDC) with configurable ranges
- Provides liquidity on **Meteora DLMM** (SOL/USDC pool)
- Maintains a **Drift** perpetual short position to keep delta-neutral (ΔSOL ≈ 0)
- Uses **solana-agent-kit** for on-chain execution with Jito bundles and priority fees
- Implements emergency flows as atomic transactions or multi-tx bundles

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

**Available Commands:**

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
   - ✅ **Transaction Builder**: Returns unsigned VersionedTransactions for Jito bundling
   - ✅ **Swap Quote**: Fetches optimal routes with price impact analysis
   - ✅ Slippage protection with configurable tolerance (default: 50 BPS = 0.5%)
   - ✅ Helper methods for SOL ↔ USDC swaps
   - ✅ **Auto-balance calculation**: Determines optimal swap to achieve 50/50 balance
   - ✅ **Intelligent error handling**: Distinguishes insufficient funds vs network errors

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
   - ✅ Detects position imbalance (e.g., >90% in one token)
   - ✅ **Two-Phase Rebalance Flow**:
     - Phase 1: Withdraw 100% + Claim + Close (single atomic TX)
     - Phase 2: Create new position with intelligent retry (max 3 attempts)
   - ✅ **Jupiter Swap Integration**: Auto-swaps tokens when balance is insufficient
   - ✅ **Intelligent Retry Logic**:
     - Attempt 1: Try position creation WITHOUT swap
     - Attempt 2+: Execute swap first if insufficient funds detected
     - Non-fund errors: Escalate Jito tips (1x → 1.5x → 2x → 2.5x)
   - ✅ **Fee Auto-Compounding**: Claimed fees automatically added to new positions
   - ✅ **User-Controlled Deposits**: Based on `AUTO_TUNE_DEPOSIT_TOKEN` + `AUTO_TUNE_DEPOSIT_AMOUNT`
   - ✅ **Red Banner Error Logging**: Highly visible ANSI-formatted error notifications
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
   - **jitoUtils** (`src/utils/jitoUtils.ts`)
     - ✅ Jito tip instruction creation
     - ✅ Dynamic tip escalation (4k→6k→8k lamports)
     - ✅ **Jito Bundle Submission**: `submitJitoBundle()` for atomic multi-tx bundles
     - ✅ **Bundle Status Tracking**: `getBundleStatus()` to monitor bundle confirmation
     - ✅ MEV protection and guaranteed transaction ordering
   - **agentKit** (`src/core/agentKit.ts`)
     - ✅ Solana Agent Kit initialization
     - ✅ Wallet keypair management

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

Integrated improvements from `meteora-lp-army-bot` project:

1. **Jupiter API v6 Upgrade**
   - Multi-token price fetching in single request
   - Direct SOL/USDC rate via `vsToken=So11111111111111111111111111111111111111112`
   - Better rate limiting and error handling

2. **Meteora DLMM API Integration**
   - Real-time pool analytics (APR, APY, volume, fees, TVL)
   - 2.5-second cache to prevent stale data
   - Complete pool metadata (bin step, active bin, reserves)

3. **Enhanced Price Utilities**
   - Precise bin price calculations using Decimal.js
   - Position composition calculator (token X/Y percentages)
   - Support for pools with different decimals

4. **Jito Tip Escalation**
   - Dynamic tip strategy: 4000→6000→8000 lamports
   - Automatic retry logic for failed bundles
   - Better MEV protection for time-sensitive transactions

5. **Jupiter Swap Integration (January 2025)**
   - Auto-swapping when position creation fails due to insufficient token balance
   - Transaction builder pattern for Jito bundling support
   - Sequential execution: swap → confirm → create (atomic bundling planned)
   - Intelligent error detection: insufficient funds vs network errors
   - Cost-aware tip escalation based on error type

See [INTEGRATION_SUMMARY.md](INTEGRATION_SUMMARY.md) for detailed changelog.

### Transaction Execution Strategy

**Current implementation:**
- Uses `skipPreflight: false` with `preflightCommitment: 'confirmed'`
- Priority fees via ComputeBudget instructions
- Jito tip instructions for MEV protection with dynamic escalation
- **Two-Phase Rebalance**: Withdraw+Claim+Close (TX1) → Create New Position (TX2)
- **✅ Atomic Jito Bundling**: Swap + Create Position in single bundle (IMPLEMENTED!)
  - Uses `submitJitoBundle()` for atomic execution when Jito enabled
  - Polls bundle status with 30s timeout
  - Fallback to sequential execution if Jito disabled
  - Guaranteed transaction ordering and atomicity
- **Intelligent Retry Logic**:
  - Attempt 1: Try creation without swap (normal priority)
  - Attempt 2+: Execute swap in Jito bundle if insufficient funds (high priority)
  - Escalate Jito tips for non-fund errors (normal → high priority)
  - Max 3 retries before giving up

**Planned improvements:**
- **Emergency flow**: Multi-step atomic bundles
  - Ordering: withdraw → claim fees → swap → adjust hedge
  - Fallback to sequential txs with confirmation gating

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

**Swap Configuration (Jupiter Integration - NEW!):**
- `SWAP_ENABLED`: Enable Jupiter swap functionality (default: true)
- `SWAP_SLIPPAGE_BPS`: Slippage tolerance in basis points (default: 50 = 0.5%)

**Risk parameters:**
- `DELTA_THRESHOLD_SOL`: Maximum delta before rebalancing (default: 2)
- `MIN_COLLATERAL_RATIO`: Minimum collateral ratio (default: 0.15)
- `MAX_SHORT_NOTIONAL_USD`: Maximum short position size (default: 12000)
- `FUNDING_RATE_CAP_BPS`: Maximum acceptable funding rate in basis points (default: 80)

**Execution parameters (Optimized for 2025 fee market):**
- `USE_JITO`: Enable Jito bundle submission (default: false, DNS issues)
- `JITO_RELAY_URL`: Jito relay endpoint
- `PRIORITY_FEE_MICRO_LAMPORTS`: Priority fee in micro-lamports per CU (default: 50000 = moderate priority)
- `MAX_COMPUTE_UNITS`: Maximum compute units per transaction (default: 600000)

**Note on Jito Bundles:**
- For bundles: Priority fees are OPTIONAL (Jito tip provides priority)
- For single transactions: Use moderate priority fees (50,000 µL/CU typical)
- Jito tips range from 5,000-20,000 lamports (~$0.0008-$0.003)
- Priority fees: ~30,000 lamports (~$0.0048) with optimized settings

### State Management

- Structured JSON logs for all operations
- Action journal persists execution history
- State snapshot includes: LP exposure, short position, collateral, delta, timestamps
- **Auto-created position mints** are saved to `data/state.json` for persistence across restarts
- **Auto-tune state** is saved to `data/auto-tune-state.json` with iteration count, rebalance history, and error tracking

## Auto-Tune Feature (NEW!)

The **Auto-Tune Orchestrator** provides fully automated position rebalancing for Meteora DLMM positions:

### How It Works

1. **Monitors** position composition at configurable intervals (default: every 10s)
2. **Detects** when position becomes imbalanced (e.g., >80% in one token)
3. **Executes** atomic rebalance transaction combining:
   - Withdraw 100% from old position
   - Claim all accumulated fees
   - Close empty position (reclaim rent ~0.057 SOL)
   - Create new position centered at current price

**All operations execute in a SINGLE transaction** for atomicity and cost savings!

### Key Features

- **Concentrated Liquidity**: Maintains fixed bin count (default: 20 bins) for capital efficiency
- **Auto-Compounding**: Claimed fees automatically added to new position
- **Atomic Execution**: All rebalance operations in one transaction - either all succeed or all fail
- **State Persistence**: Survives restarts with full state recovery
- **Error Handling**: Automatic retry with exponential backoff, stops after 5 consecutive failures

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
- **Atomic rebalance executes:**
  1. Withdraws all liquidity (~0.5 SOL + 85 USDC)
  2. Claims fees (~0.02 SOL + 1 USDC)
  3. Closes old position (reclaims ~0.057 SOL rent)
  4. Creates new position at $180 with 0.577 SOL + 86 USDC (fees compounded!)
- New position: 20 bins centered at $180 (range: $178-$182)
- Composition: 50% SOL, 50% USDC ✅

**All in ONE transaction!**

## Jupiter Swapper Integration (NEW!)

The **Jupiter Swapper** module enables intelligent token swaps for automatic position balancing:

### Purpose

Handles scenarios where position creation fails due to insufficient token balance. Instead of requiring manual token acquisition, the bot automatically swaps tokens to achieve the desired 50/50 balance.

### Intelligent Two-Phase Rebalance Flow

**Phase 1: Withdraw + Claim + Close (Single Atomic Transaction)**
- Withdraw 100% liquidity from old position
- Claim all accumulated fees (auto-compounded into new position)
- Close position and reclaim rent (~0.057 SOL)

**Phase 2: Create New Position (Intelligent Retry with Swap)**

```
Attempt 1: Try WITHOUT swap
├─ Calculate balanced deposits: AUTO_TUNE_DEPOSIT_TOKEN + claimed fees
├─ Try to create position with calculated amounts
└─ SUCCESS → Done! | FAIL → Detect error type

Attempt 2: Execute swap FIRST (if insufficient funds)
├─ Check actual wallet balances (SOL + USDC)
├─ Calculate optimal swap to achieve 50/50 balance
├─ Execute Jupiter swap transaction
├─ Wait for swap confirmation
├─ Try to create position again
└─ SUCCESS → Done! | FAIL → Retry with escalated tips

Attempt 3: Retry with escalated Jito tips (if non-fund error)
├─ Escalate tip: 1x → 1.5x → 2x → 2.5x (capped at 3x)
├─ Only for network errors (NOT insufficient funds)
└─ SUCCESS → Done! | FAIL → Red banner error + give up
```

### Key Features

- **Transaction Builder**: Returns unsigned `VersionedTransaction` for Jito bundling
- **Sequential Execution**: Swap → Confirm → Create Position (atomic bundling planned)
- **Smart Error Detection**: Distinguishes insufficient funds from network errors
- **Intelligent Retry Logic**:
  - Always try WITHOUT swap first (saves gas if balance is sufficient)
  - Execute swap only if insufficient funds detected
  - Escalate tips ONLY for non-fund errors (avoid wasting fees)
- **Auto-Balance Calculation**: `calculateRebalanceSwap()` determines optimal swap amount
- **Slippage Protection**: Configurable tolerance (default: 50 BPS = 0.5%)
- **Helper Methods**: `swapSolToUsdc()`, `swapUsdcToSol()`, `getSwapTransaction()`

### Example: Real-World Rebalance Scenario

**Starting State:**
- User config: `AUTO_TUNE_DEPOSIT_TOKEN=SOL`, `AUTO_TUNE_DEPOSIT_AMOUNT=1.0`
- Old position at $160: 0.01 SOL + 31 USDC (90% USDC, imbalanced!)
- Withdraw + claim: 0.01 SOL + 31 USDC + 0.005 SOL fees + 0.5 USDC fees

**Phase 2 Execution:**

**Attempt 1** (try without swap):
```
Target position: 1.015 SOL + 162.5 USDC (balanced 50/50 at $160)
Wallet balance: 0.015 SOL + 31.5 USDC
Result: ❌ FAIL - Insufficient USDC (need 162.5, have 31.5)
```

**Attempt 2** (execute swap):
```
1. Swap 50% SOL → USDC:
   - Swap 0.5 SOL → ~80 USDC (at $160/SOL)
   - New balance: 0.515 SOL + 111.5 USDC

2. Create position:
   - Deposit: 0.515 SOL + 82.4 USDC (balanced 50/50)
   - Result: ✅ SUCCESS!
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
```

### ✅ Atomic Jito Bundling (IMPLEMENTED!)

**Status**: ✅ Fully implemented and production-ready!

The bot now uses true atomic Jito bundling for swap + position creation:

```typescript
// Get swap transaction
const swapTx = await jupiterSwapper.getSwapTransaction({...});

// Get position creation transaction
const createTx = await meteoraAdapter.getCreatePositionTransaction({...}, {
  priority: 'high',
  attempt: 0,
});

// Sign both transactions
swapTx.transaction.sign([wallet]);
createTx.transaction.partialSign(wallet, createTx.positionKeypair);

// Submit as atomic bundle to Jito
const bundle = await submitJitoBundle([
  Buffer.from(swapTx.transaction.serialize()).toString('base64'),
  Buffer.from(createTx.transaction.serialize()).toString('base64'),
], true);

// Poll for bundle confirmation (30s timeout)
const status = await getBundleStatus(bundle.bundleId);

// All operations succeed atomically or all fail!
```

**Benefits**:
- ✅ Atomic execution guarantee
- ✅ MEV protection via Jito
- ✅ Guaranteed transaction ordering
- ✅ No partial failures (either both succeed or both fail)
- ✅ 30-second bundle confirmation polling
- ✅ Fallback to sequential execution if Jito disabled

### Use Cases

1. **Position Creation**: When wallet lacks one token, swap automatically before creating position
2. **Rebalancing**: When position drains completely to one side (>95%), swap to restore balance
3. **Emergency Recovery**: Quick token swaps during emergency withdrawal flows

### Technical Details

- **Jupiter V6 API**: Latest aggregator with best swap routes
- **Versioned Transactions**: Uses Solana v0 transactions for bundling
- **No Direct Execution**: Methods return transactions for external bundling
- **Quote Validation**: Fetches quotes before building transactions
- **Price Impact Tracking**: Logs price impact percentage for monitoring

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
- **Auto-tune rebalancing**: Set `AUTO_TUNE_ENABLED=true` to enable fully automated position rebalancing with atomic transactions. The bot will monitor positions and automatically rebalance when they become imbalanced.
- **Jupiter swapper integration**: The bot can automatically swap tokens when position creation fails due to insufficient balance. Swaps are bundled with position creation in atomic Jito bundles for maximum efficiency.
- **Atomic transactions**: Auto-tune executes ALL rebalance operations (withdraw + claim + close + create) in a SINGLE transaction for maximum efficiency and atomicity.
- **Transaction bundling**: Jupiter swaps return unsigned transactions that can be bundled with other operations (e.g., swap + create position) in single Jito bundles with escalating priority tips.
- All production execution uses **solana-agent-kit** for direct control over bundles and fees
- Test emergency flows thoroughly with dry-run flag before mainnet
- Monitor funding rates closely - high sustained funding can erode profitability
- The bot maintains delta neutrality via band rebalancing, not continuous hedging
- Jito bundles provide ordering guarantees critical for atomic emergency exits
- **Always update** `progress.md` after every run, add bug reports to `bugs.md`, and document architectural decisions in `decisions.md`