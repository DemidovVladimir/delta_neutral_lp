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
```bash
# Start the main hedge loop
pnpm tsx src/cli/start.ts

# Manual LP operations
pnpm tsx src/cli/lp.ts deposit --usdc 12000
pnpm tsx src/cli/lp.ts withdraw --percent 50 --singleOut usdc

# Manual Drift operations
pnpm tsx src/cli/drift.ts rebalance

# Claim fees
pnpm tsx src/cli/fees.ts claim

# Emergency withdrawal
pnpm tsx src/cli/emergency.ts --full
```

## Architecture

The codebase follows a modular adapter pattern:

### Core Modules

1. **MeteoraAdapter** (`src/modules/meteoraAdapter.ts`)
   - **Auto-creates** LP positions with configured price ranges (if enabled)
   - Reads LP exposure from position NFTs (SOL/USDC amounts)
   - Handles deposits/withdrawals with single-sided support
   - Claims accumulated fees
   - Persists created position NFT mints to state

2. **DriftEngine** (`src/modules/driftEngine.ts`)
   - Reads perpetual short position state (size, collateral, margin ratio, funding rate)
   - Executes rebalancing to match LP exposure
   - Manages collateral deposits/withdrawals

3. **Bundler** (`src/modules/bundler.ts`)
   - Builds atomic transactions with ComputeBudget instructions
   - Submits Jito bundles for ordered multi-tx execution
   - Falls back to priority fee transactions when Jito unavailable

4. **RiskController** (`src/modules/riskController.ts`)
   - Enforces delta threshold, margin requirements, funding rate caps
   - Validates notional size limits
   - Checks all risk parameters before execution

5. **Orchestrator** (`src/orchestrator/`)
   - Main hedge loop: monitors LP exposure vs short position
   - Triggers rebalancing when delta exceeds band
   - Executes emergency flows (withdraw → claim → swap → adjust hedge)

## Key Technical Details

### Transaction Execution Strategy

**Normal rebalancing:** Single transaction with priority fees

**Emergency flow (multi-step):**
- If total CU < limit → pack all instructions into single atomic tx
- Otherwise → split into 2-3 transactions and submit as Jito bundle
- Bundle ordering: withdraw → claim fees → swap → adjust hedge
- Fallback: sequential transactions with confirmation gating

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