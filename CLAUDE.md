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

**Current Status**: The main orchestrator and CLI commands are planned for future implementation. Currently available:

```bash
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
   - ✅ **Multi-pool support** - Track and manage positions across multiple pools
   - ✅ Per-pool caching and pool address validation
   - ✅ Deposits/withdrawals with single-sided support
   - ✅ Fee claiming functionality

2. **PriceOracle** (`src/core/priceOracle.ts`)
   - ✅ Jupiter API v6 integration with multi-token price fetching
   - ✅ Direct SOL/USDC exchange rate via vsToken parameter
   - ✅ Pyth oracle fallback for price feeds
   - ✅ Price caching with configurable TTL
   - ✅ Multi-source price validation

3. **Persistence Layer** (`src/modules/persistence.ts`)
   - ✅ State snapshot management (positions, exposure, timestamps)
   - ✅ Action journal for execution history
   - ✅ Auto-created position NFT tracking
   - ✅ JSON-based storage in data/ directory

4. **Utility Modules:**
   - **meteoraUtils** (`src/utils/meteoraUtils.ts`)
     - ✅ Bin price calculations from bin ID
     - ✅ Token percentage composition calculator
     - ✅ Meteora API client for pool analytics
   - **jitoUtils** (`src/utils/jitoUtils.ts`)
     - ✅ Jito tip instruction creation
     - ✅ Dynamic tip escalation (4k→6k→8k lamports)
   - **agentKit** (`src/core/agentKit.ts`)
     - ✅ Solana Agent Kit initialization
     - ✅ Wallet keypair management

**Planned (not yet implemented):**

- 🔜 **DriftEngine** - Perpetual short positions and rebalancing
- 🔜 **Bundler** - Jito bundle submission and atomic transactions
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

See [INTEGRATION_SUMMARY.md](INTEGRATION_SUMMARY.md) for detailed changelog.

### Transaction Execution Strategy

**Current implementation:**
- Uses `skipPreflight: true` for faster transaction submission
- Priority fees via ComputeBudget instructions
- Jito tip instructions for MEV protection

**Planned (not yet implemented):**
- **Normal rebalancing**: Single transaction with priority fees
- **Emergency flow**: Multi-step atomic bundles
  - Pack instructions if total CU < limit
  - Split into 2-3 txs and submit as Jito bundle
  - Ordering: withdraw → claim fees → swap → adjust hedge
  - Fallback to sequential txs with confirmation gating

### Configuration (.env)

**Core Configuration:**
- `RPC_URL`: Solana RPC endpoint
- `PRIVATE_KEY`: Wallet private key (base58 or comma-separated bytes)

**Meteora Position Setup (choose one approach):**

*Option 1: Auto-create positions (recommended)*
- `AUTO_CREATE_POSITIONS=true`: Enable automatic position creation
- `METEORA_POOL_ADDRESSES`: Comma-separated pool addresses or array format (NEW: Multi-pool support!)
  - Single pool: `METEORA_POOL_ADDRESSES=5rCf1DM8LjKTw4YqhnoLcngyZYeNnQqztScTogYHAS6`
  - Multiple pools: `METEORA_POOL_ADDRESSES=5rCf1DM8LjKTw4YqhnoLcngyZYeNnQqztScTogYHAS6,HTvjzsfX3yU6BUodCjZ5vZkUrAxMDTrBs3CJaq43ashR`
  - Also supports legacy single pool via `METEORA_POOL_ADDRESS` (will be converted to array)
- `INITIAL_DEPOSIT_SOL`: Initial SOL deposit amount (e.g., 10)
- `INITIAL_DEPOSIT_USDC`: Initial USDC deposit amount (e.g., 1000)
- `PRICE_RANGE_BPS_LOWER`: Lower price bound in basis points from current (e.g., -100 = -1%)
- `PRICE_RANGE_BPS_UPPER`: Upper price bound in basis points from current (e.g., 100 = +1%)

**Note on Balanced Deposits:**
- Meteora DLMM automatically distributes deposits across the price range based on current price
- For localnet testing with mainnet-fork: Use single-sided SOL deposits (set `INITIAL_DEPOSIT_USDC=0`)
- For production/mainnet: Use balanced deposits with both SOL and USDC
- Tighter ranges (±1-2%) work better with pools that have small bin steps (like bin step = 4)

**Multi-Pool Support:**
- Configure multiple pools to create and manage positions across different Meteora DLMM pools
- Android app shows pool selector dropdown when multiple pools are available
- API endpoint `GET /api/pools` returns list of configured pools
- Position creation accepts optional `poolAddress` parameter (defaults to primary pool)
- Positions automatically grouped by pool in Android UI

*Option 2: Use existing positions*
- `AUTO_CREATE_POSITIONS=false` (or omit)
- `METEORA_POSITION_MINTS`: Comma-separated existing position NFT addresses
- `LP_OWNER`: Owner address for LP positions

**Drift Configuration:**
- `DRIFT_MARKET_SOL_PERP`: Drift market index for SOL-PERP (typically 0)

**Risk parameters:**
- `DELTA_THRESHOLD_SOL`: Maximum delta before rebalancing (default: 2)
- `MIN_COLLATERAL_RATIO`: Minimum collateral ratio (default: 0.15)
- `MAX_SHORT_NOTIONAL_USD`: Maximum short position size (default: 12000)
- `FUNDING_RATE_CAP_BPS`: Maximum acceptable funding rate in basis points (default: 80)

Execution parameters:
- `USE_JITO`: Enable Jito bundle submission (default: true)
- `JITO_RELAY_URL`: Jito relay endpoint
- `PRIORITY_TIP_LAMPORTS`: Priority fee in lamports (default: 80000)
- `MAX_COMPUTE_UNITS`: Maximum compute units per transaction (default: 1200000)

### State Management

- Structured JSON logs for all operations
- Action journal persists execution history
- State snapshot includes: LP exposure, short position, collateral, delta, timestamps
- **Auto-created position mints** are saved to `data/state.json` for persistence across restarts

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
- All production execution uses **solana-agent-kit** for direct control over bundles and fees
- Test emergency flows thoroughly with dry-run flag before mainnet
- Monitor funding rates closely - high sustained funding can erode profitability
- The bot maintains delta neutrality via band rebalancing, not continuous hedging
- Jito bundles provide ordering guarantees critical for atomic emergency exits
- **Always update** `progress.md` after every run, add bug reports to `bugs.md`, and document architectural decisions in `decisions.md`