# Project Epics & Tasks

**Project:** Delta-Neutral LP Bot with solana-agent-kit
**Last Updated:** 2025-10-19

---

## Epic K: Bootstrap & Agent Kit Wiring

**Status:** ✅ Completed (2025-10-19)
**Priority:** P0 (Critical Path)
**Dependencies:** None

### K1: Project Structure & Configuration

**Status:** ✅ Completed
**Complexity:** Small
**Files to Create:**
- `src/config/env.ts` - Environment variable loader with validation
- `src/config/constants.ts` - System constants (retry limits, timeouts, etc.)
- `src/utils/logger.ts` - Structured logging (Winston/Pino)
- `.env.example` - Example environment variables
- `tsconfig.json` - TypeScript configuration
- `package.json` - Update with required dependencies

**Acceptance Criteria:**
- ✅ Config loads from .env with type validation
- ✅ Logger outputs structured JSON logs with levels (debug, info, warn, error)
- ✅ Missing/invalid env vars throw clear errors on startup
- ✅ All required deps installed (solana-agent-kit, @solana/web3.js, dotenv, etc.)

**Testing:**
- Unit test config validation (missing vars, invalid formats)
- Unit test logger output formats

---

### K2: Agent Kit Initialization & Price Oracle

**Status:** ✅ Completed
**Complexity:** Medium
**Dependencies:** K1
**Files to Create:**
- `src/core/agentKit.ts` - Initialize SolanaAgentKit with wallet & connection
- `src/core/priceOracle.ts` - Price fetching (Jupiter/Pyth aggregator)
- `src/types/index.ts` - Shared TypeScript types

**Acceptance Criteria:**
- ✅ AgentKit successfully connects to RPC with provided private key
- ✅ Price oracle fetches SOL/USD price from Jupiter and/or Pyth
- ✅ Price oracle handles failures gracefully (retries, fallback sources)
- ✅ Wallet balance check succeeds

**Testing:**
- Integration test: Connect to devnet/mainnet RPC
- Unit test: Price oracle with mocked responses
- Test error handling for invalid private key

---

## Epic L: Meteora DLMM Adapter

**Status:** ✅ Completed (2025-10-20)
**Priority:** P0 (Critical Path)
**Dependencies:** K2

### L0: Auto-Create Meteora Positions (New!)

**Status:** ✅ Completed
**Complexity:** Large
**Files to Create:**
- `src/modules/meteoraAdapter.ts` - Main adapter class (position creation methods)
- `src/types/meteora.ts` - Type definitions for LP positions

**Acceptance Criteria:**
- ✅ `createPosition()` creates Meteora DLMM position with specified parameters
- ✅ Supports configurable price range (basis points from current price)
- ✅ Supports both balanced and single-sided initial deposits
- ✅ Mints position NFT and returns mint address
- ✅ Validates wallet has sufficient balance before creation
- ✅ Saves created position mint to `data/state.json`
- ✅ Handles `AUTO_CREATE_POSITIONS` config flag
- ✅ Skips creation if positions already exist in state
- ✅ Returns clear errors on failure (insufficient funds, invalid pool, etc.)

**Testing:**
- Integration test: Create position on devnet
- Test balance validation (insufficient funds case)
- Test state persistence (mint saved and loaded)
- Test idempotency (doesn't recreate if already exists)
- Unit test price range calculations

**Notes:**
- ADR-005: Automatic Meteora Position Creation
- Position creation is one-time on first run (if AUTO_CREATE_POSITIONS=true)
- Price range calculated from current price + configured BPS offset
- Use solana-agent-kit's Meteora integration

---

### L1: Read LP Exposure from Position NFTs

**Status:** ✅ Completed
**Complexity:** Medium (reduced - position creation split to L0)
**Files to Modify:**
- `src/modules/meteoraAdapter.ts` - Add exposure reading methods
- `src/types/meteora.ts` - Add exposure types

**Acceptance Criteria:**
- ✅ `getLpExposure()` returns `{ solAmount, usdcAmount, totalUsd, claimableSol, claimableUsdc }`
- ✅ Correctly parses position NFT accounts
- ✅ Handles multiple position mints (from config or state.json)
- ✅ Aggregates exposure across all positions
- ✅ Returns 0 values if no positions found (doesn't crash)
- ✅ Loads position mints from state.json if AUTO_CREATE_POSITIONS=true
- ✅ Loads position mints from config if AUTO_CREATE_POSITIONS=false

**Testing:**
- Integration test with real Meteora position on devnet
- Unit test with mocked account data
- Test multiple positions aggregation
- Test loading mints from both config and state

---

### L2: Deposit & Withdraw with Single-Sided Support

**Status:** ✅ Completed
**Complexity:** Large
**Dependencies:** L1
**Files to Modify:**
- `src/modules/meteoraAdapter.ts`

**Acceptance Criteria:**
- ✅ `depositToLp()` supports: usdc-only, sol-only, or balanced deposits
- ✅ `withdrawFromLp()` supports: percentage-based or amount-based withdrawals
- ✅ Single-sided withdrawal (singleSidedOut: 'sol' | 'usdc') works correctly
- ✅ Returns transaction signature on success
- ✅ Validates input parameters (e.g., percent must be 0-100)

**Testing:**
- Integration tests for all deposit modes (devnet)
- Integration tests for withdrawal modes
- Test validation errors (invalid percent, negative amounts)

**Notes:**
- Meteora DLMM SDK usage: check solana-agent-kit's Meteora integration
- May need to use Meteora's DLMM program directly if agent-kit doesn't expose all methods

---

### L3: Claim Fees

**Status:** ✅ Completed
**Complexity:** Medium
**Dependencies:** L1
**Files to Modify:**
- `src/modules/meteoraAdapter.ts`

**Acceptance Criteria:**
- ✅ `claimFees()` returns `{ sol, usdc, sig }` with claimed amounts
- ✅ Handles case where no fees are claimable (returns 0 values)
- ✅ Transaction succeeds on-chain

**Testing:**
- Integration test: claim fees after accrual period
- Test zero-fee case

---

### L4: Auto-Tune Feature - Automatic Position Rebalancing

**Status:** ✅ Completed (2025-11-09)
**Complexity:** Extra Large
**Files Created:**
- `src/modules/autoTuneOrchestrator.ts` - Main orchestrator for auto-tune loop
- `src/cli/auto-tune.ts` - CLI command for running auto-tune

**Files Modified:**
- `src/utils/meteoraUtils.ts` - Added imbalance detection and price range calculation
- `src/types/index.ts` - Added auto-tune type definitions
- `src/config/env.ts` - Added auto-tune configuration
- `src/modules/persistence.ts` - Added auto-tune state persistence
- `src/modules/meteoraAdapter.ts` - Added atomicRebalance() method
- `.env.example` - Added auto-tune parameters
- `package.json` - Added "auto-tune" script

**Acceptance Criteria:**
- ✅ `checkPositionImbalance()` detects when position becomes >threshold% in one token
- ✅ `calculateCenteredPriceRange()` automatically calculates price ranges centered at current price (fixed to create exactly 20 bins)
- ✅ AutoTuneOrchestrator monitors position composition every interval (default: 30s)
- ✅ Triggers rebalance when position becomes imbalanced (default: >80% in one token)
- ✅ `atomicRebalance()` executes rebalance in TWO sequential transactions:
  - TX1: Withdraw + Claim + Close (using SDK's `shouldClaimAndClose=true`)
  - TX2: Create new position with original + claimed fees
- ✅ Uses SDK's transaction objects directly (no manual instruction extraction)
- ✅ Uses partialSign for wallet + position keypair signatures
- ✅ Uses 'normal' Jito priority to avoid overpaying
- ✅ Auto-compounding of claimed fees into new position
- ✅ State persistence (saves iteration count, rebalance count, timestamps)
- ✅ Error tracking with automatic shutdown after 5 consecutive failures
- ✅ Graceful shutdown handling (SIGINT/SIGTERM)
- ✅ Configuration via 4 environment variables (enabled, bin count, interval, threshold)
- ✅ CLI command `pnpm auto-tune` and `pnpm auto-tune:watch` for monitoring

**Testing:**
- ✅ TypeScript compilation: All files compile successfully
- ⏳ Integration test: Pending production testing on mainnet
- ⏳ Test atomic rebalance transaction execution
- ⏳ Test imbalance detection with real positions
- ⏳ Test fee auto-compounding

**Notes:**
- **Key Implementation:** TWO sequential transactions (50% fee savings vs 4 separate txs)
  - Initial atomic approach failed with "Transaction too large: 1294 > 1232" error
  - Two-step approach uses SDK's built-in transactions for reliability
- **User-Requested Design:** Simple threshold-based configuration (no BPS calculations)
- **User-Requested Feature:** Auto-calculation of centered price ranges
- **User-Requested Optimization:** Normal Jito priority to avoid overpaying
- **Architecture:** Clean separation - utils, types, config, persistence, orchestrator, CLI
- ADR-012: Auto-Tune Two-Step Rebalancing Strategy (documented in decisions.md)
- User story with 12 steps fully implemented
- Fixed 20-bin count for concentrated liquidity (bug fix: formula was creating 21 bins)
- Position creation parameters calculated automatically based on current price
- Watch mode with visual progress bars and real-time updates

**Implementation Highlights:**
1. **Two-Step Transactions:**
   - TX1: SDK's `removeLiquidity()` with `shouldClaimAndClose=true`
   - TX2: SDK's `initializePositionAndAddLiquidityByStrategy()` with Spot strategy
2. **Multi-Keypair Signing:** Uses partialSign(wallet, newPositionKeypair) for TX2
3. **Auto-Compounding:** Claimed fees automatically added to new position
4. **Monitoring Loop:** Periodic checks with configurable interval
5. **State Persistence:** JSON-based state tracking (data/auto-tune-state.json)
   - Tracks iteration count, rebalance count, timestamps
   - **Aggregated claimed fees:** Total SOL/USDC claimed across all rebalances
   - **Last position created:** Position mint, initial deposits, creation timestamp
6. **Watch Mode:** Visual terminal UI with progress bars and real-time status
7. **API Endpoint (Added 2025-11-09):** `POST /api/positions/withdraw-claim-close`
   - Exposes TX1 operation (withdraw+claim+close) as standalone endpoint
   - Uses `withdrawClaimAndClose()` method in MeteoraAdapter
   - Executes in ONE atomic transaction using SDK's `shouldClaimAndClose=true`
   - Returns signature and claimed fees (SOL and USDC amounts)

---

## Epic M: Drift Hedge Engine

**Status:** Not Started
**Priority:** P0 (Critical Path)
**Dependencies:** K2

### M1: Read Drift State

**Status:** Not Started
**Complexity:** Large
**Files to Create:**
- `src/modules/driftEngine.ts` - Main Drift integration class
- `src/types/drift.ts` - Type definitions for Drift positions

**Acceptance Criteria:**
- ✅ `getState()` returns `{ shortSol, collateralUsd, marginRatio, fundingBpsDay }`
- ✅ Correctly reads perpetual position size (negative for short)
- ✅ Calculates margin ratio from collateral / notional
- ✅ Fetches current funding rate and converts to BPS/day

**Testing:**
- Integration test with real Drift account on devnet
- Unit test with mocked Drift SDK responses
- Test conversion formulas (funding rate units)

**Notes:**
- Check if solana-agent-kit has Drift integration or if we need @drift-labs/sdk directly
- Funding rate calculation may need historical data or current rate extrapolation

---

### M2: Rebalance to Target Short Position

**Status:** Not Started
**Complexity:** Large
**Dependencies:** M1
**Files to Modify:**
- `src/modules/driftEngine.ts`

**Acceptance Criteria:**
- ✅ `rebalanceToShortSol({ targetSol, price, maxSlippageBps })` adjusts position to target
- ✅ Calculates delta: `newSize = currentShort - (targetSol - currentShort)`
- ✅ Places market order with slippage protection
- ✅ Estimates CU and sets appropriate compute budget
- ✅ Returns transaction signature

**Testing:**
- Integration test: increase short position
- Integration test: decrease short position
- Test slippage limits (should fail if exceeded)
- Test CU estimation accuracy

**Notes:**
- Consider using limit orders with tight bounds vs market orders
- May need to split large rebalances into chunks

---

### M3: Collateral Operations

**Status:** Not Started
**Complexity:** Medium
**Dependencies:** M1
**Files to Modify:**
- `src/modules/driftEngine.ts`

**Acceptance Criteria:**
- ✅ `topUpCollateral({ usdc })` deposits USDC to Drift account
- ✅ `withdrawCollateral({ usdc })` withdraws USDC from Drift
- ✅ Validates withdrawal doesn't breach margin requirements
- ✅ Returns transaction signatures

**Testing:**
- Integration test: deposit and withdraw cycle
- Test withdrawal validation (attempt over-withdrawal)

---

## Epic N: Bundles & Priority Execution

**Status:** Not Started
**Priority:** P0 (Critical Path)
**Dependencies:** K2

### N1: Atomic Transaction Builder

**Status:** Not Started
**Complexity:** Medium
**Files to Create:**
- `src/modules/bundler.ts` - Transaction bundling & priority fee logic
- `src/types/bundler.ts` - Plan and PlanStep types

**Acceptance Criteria:**
- ✅ `buildAtomicTx(plan)` packs multiple instructions into single transaction
- ✅ Adds `ComputeBudgetProgram.setComputeUnitLimit()` instruction
- ✅ Adds `ComputeBudgetProgram.setComputeUnitPrice()` for priority fee
- ✅ Estimates total CU correctly
- ✅ Validates CU doesn't exceed MAX_COMPUTE_UNITS from config

**Testing:**
- Unit test: CU estimation for known instruction sets
- Unit test: Priority fee calculation from lamports
- Test multi-instruction packing

---

### N2: Jito Bundle Submission

**Status:** Not Started
**Complexity:** Large
**Dependencies:** N1
**Files to Modify:**
- `src/modules/bundler.ts`

**Acceptance Criteria:**
- ✅ `sendJitoBundle(txs, tipLamports)` submits ordered multi-tx bundle
- ✅ Uses Jito relay URL from config
- ✅ Includes tip transaction as first tx in bundle
- ✅ Polls for bundle status and confirms landing
- ✅ Returns bundle ID or signature of last tx

**Testing:**
- Integration test with Jito devnet relay (if available)
- Test bundle with 2-3 transactions
- Test tip amount configuration

**Notes:**
- Check solana-agent-kit's Jito integration
- May need jito-ts or direct API calls to Jito relayer

---

### N3: Fallback with Sequential Execution

**Status:** Not Started
**Complexity:** Medium
**Dependencies:** N1
**Files to Modify:**
- `src/modules/bundler.ts`

**Acceptance Criteria:**
- ✅ `sendWithPriority(tx, tipLamports)` sends single tx with priority fee
- ✅ Waits for confirmation before returning
- ✅ Fallback triggers when Jito unavailable or USE_JITO=false
- ✅ Sequential multi-tx execution with confirmation gating between steps

**Testing:**
- Integration test: Send multiple txs sequentially
- Test confirmation timeout handling
- Test fallback when Jito fails

---

### N4: Transaction Simulation

**Status:** Not Started
**Complexity:** Small
**Dependencies:** N1
**Files to Modify:**
- `src/modules/bundler.ts`

**Acceptance Criteria:**
- ✅ `simulatePlan(plan)` simulates all instructions without sending
- ✅ Returns `{ ok: boolean, errors?: string[] }`
- ✅ Catches simulation errors (insufficient funds, program errors, etc.)

**Testing:**
- Unit test with valid and invalid instruction sets
- Test error message parsing

---

## Epic O: Risk Management & Persistence

**Status:** Not Started
**Priority:** P1 (High)
**Dependencies:** L1, M1

### O1: Risk Limits & Enforcement

**Status:** Not Started
**Complexity:** Medium
**Files to Create:**
- `src/modules/riskController.ts` - Risk limit checks
- `src/types/risk.ts` - Risk parameter types

**Acceptance Criteria:**
- ✅ `checkLimits()` validates all risk parameters before execution
- ✅ Checks delta threshold: `|lpSol - shortSol| < DELTA_THRESHOLD_SOL`
- ✅ Checks collateral ratio: `collateralUsd / notionalUsd >= MIN_COLLATERAL_RATIO`
- ✅ Checks notional cap: `lpSol * price <= MAX_SHORT_NOTIONAL_USD`
- ✅ Checks funding rate: `fundingBpsDay <= FUNDING_RATE_CAP_BPS`
- ✅ Throws descriptive errors when limits breached
- ✅ Returns `{ delta, collat, notional }` on success

**Testing:**
- Unit tests for each limit type
- Test combined limits
- Test edge cases (zero collateral, zero LP exposure)

---

### O2: State Persistence & Journal

**Status:** Not Started
**Complexity:** Medium
**Dependencies:** None
**Files to Create:**
- `src/modules/persistence.ts` - JSON state storage
- `src/types/state.ts` - State snapshot types
- `data/` - Directory for JSON files (gitignored)

**Acceptance Criteria:**
- ✅ `saveState(snapshot)` writes state to `data/state.json`
- ✅ `loadState()` reads last saved state
- ✅ `appendToJournal(action)` appends action to `data/journal.jsonl` (JSON Lines)
- ✅ State includes: timestamp, lpExposure, driftState, delta, price, **createdPositionMints**
- ✅ Journal entries include: timestamp, action type, inputs, outputs, txSig
- ✅ Creates data/ directory if not exists
- ✅ Handles file write errors gracefully
- ✅ **Persists auto-created position NFT mints** for future runs

**Testing:**
- Unit test: write and read state
- Unit test: append multiple journal entries
- Test file system errors (permissions, disk full)

**Notes:**
- Consider adding state snapshots at regular intervals (every N minutes)
- Journal useful for debugging and backtesting later

---

## Epic P: Orchestrator & Emergency Flow

**Status:** Not Started
**Priority:** P0 (Critical Path)
**Dependencies:** L0, L1, L2, L3, M1, M2, N1, N2, O1, O2

### P1: Main Hedge Loop

**Status:** Not Started
**Complexity:** Large
**Files to Create:**
- `src/orchestrator/hedgeLoop.ts` - Main bot loop logic
- `src/orchestrator/types.ts` - Orchestrator types

**Acceptance Criteria:**
- ✅ Runs every 10-20s (configurable interval)
- ✅ Fetches SOL price via price oracle
- ✅ Reads LP exposure via MeteoraAdapter
- ✅ Reads Drift state via DriftEngine
- ✅ Calculates delta: `Δ = lpSol - shortSol`
- ✅ If `|Δ| >= DELTA_THRESHOLD_SOL`, calls `rebalanceToShortSol(targetSol=lpSol)`
- ✅ Checks risk limits before rebalancing
- ✅ Logs all metrics to structured logger
- ✅ Saves state snapshot after each iteration
- ✅ Appends rebalance actions to journal

**Testing:**
- Integration test: Full loop on devnet
- Test delta within band (no rebalance)
- Test delta exceeds band (triggers rebalance)
- Test risk limit breach (blocks rebalance)

**Notes:**
- Add graceful shutdown on SIGINT/SIGTERM
- Consider health check endpoint

---

### P2: Emergency Flow Execution

**Status:** Not Started
**Complexity:** Large
**Dependencies:** P1
**Files to Create:**
- `src/orchestrator/emergencyFlow.ts` - Emergency withdrawal logic

**Acceptance Criteria:**
- ✅ Triggers on: margin ratio low, price shock, manual command, or RPC congestion
- ✅ Builds plan with steps: withdraw → claim → (optional swap) → adjust hedge
- ✅ Simulates plan before execution
- ✅ If total CU < MAX_COMPUTE_UNITS → executes as single atomic tx
- ✅ Else → splits into 2-3 txs and sends as Jito bundle
- ✅ Falls back to sequential execution if Jito unavailable
- ✅ Logs emergency execution details
- ✅ Appends to journal with emergency flag

**Testing:**
- Integration test: Full emergency flow on devnet
- Test atomic tx path (low CU)
- Test Jito bundle path (high CU)
- Test fallback path (Jito disabled)
- Test partial withdrawal vs full withdrawal

**Notes:**
- Emergency triggers should be configurable
- Consider dry-run mode for testing on mainnet

---

### P3: Dry-Run Mode & CLI

**Status:** Not Started
**Complexity:** Medium
**Dependencies:** P1, P2
**Files to Create:**
- `src/cli/start.ts` - Start hedge loop
- `src/cli/lp.ts` - Manual LP operations
- `src/cli/drift.ts` - Manual Drift operations
- `src/cli/fees.ts` - Claim fees
- `src/cli/emergency.ts` - Trigger emergency flow
- `src/cli/utils.ts` - Shared CLI utilities

**Acceptance Criteria:**
- ✅ `--dry-run` flag simulates all transactions without sending
- ✅ CLI commands match examples in PRD section 9
- ✅ Start command runs hedge loop until interrupted
- ✅ Manual commands execute single operations and exit
- ✅ Emergency command supports `--full` and `--percent` flags
- ✅ All commands support `--help` flag
- ✅ CLI outputs human-readable logs (not just JSON)

**Testing:**
- Manual test each CLI command
- Test dry-run mode doesn't send transactions
- Test argument parsing and validation

**Notes:**
- Consider using commander or yargs for CLI
- Add confirmation prompt for emergency operations in production

---

## Summary by Priority

### P0 (Critical Path) - Must Have for MVP
- Epic K: Bootstrap (2 tasks) ✅ **COMPLETE**
- Epic L: Meteora Adapter (5 tasks - includes L0 auto-position creation + L4 auto-tune) ✅ **COMPLETE**
- Epic M: Drift Engine (3 tasks)
- Epic N: Bundles & Priority (4 tasks)
- Epic P: Orchestrator (3 tasks)

**Total P0 Tasks:** 17

### P1 (High Priority) - Needed for Safe Operation
- Epic O: Risk & Persistence (2 tasks)

**Total P1 Tasks:** 2

**Overall Progress:** 7/19 tasks completed (36.8%)

---

## Task Dependency Graph

```
K1 (Config) → K2 (AgentKit) ✅
                ↓
        ┌───────┴──────┐
        ↓              ↓
    L0 (Auto-Create) ✅  M1 (Read Drift)
        ↓              ↓
    L1 (Read LP) ✅    M2 (Rebalance)
        ↓              ↓
    L2 (LP Ops) ✅     M3 (Collateral)
        ↓
    L3 (Claim) ✅
        ↓
    L4 (Auto-Tune) ✅

K2 → N1 (Atomic Tx) → N2 (Jito) → N3 (Fallback) → N4 (Sim)

L0, L1, M1 → O1 (Risk)
             O2 (Persistence)

L0, L1, L2, L3, L4, M1, M2, N1, N2, O1, O2 → P1 (Hedge Loop) → P2 (Emergency) → P3 (CLI)
```

**Notes:**
- L0 (Auto-Create Positions) is optional - only runs if AUTO_CREATE_POSITIONS=true. Otherwise, L1 loads existing position mints from config.
- L4 (Auto-Tune) is standalone - runs independently via `pnpm auto-tune` CLI when AUTO_TUNE_ENABLED=true.

---

## Estimation

- **Small:** 2-4 hours
- **Medium:** 4-8 hours
- **Large:** 8-16 hours
- **Extra Large:** 16-24 hours

**Total Estimated Effort:** ~146-234 hours for MVP (includes L0 and L4 tasks)

---

## Next Steps

1. Start with Epic K (Bootstrap) - critical foundation
2. Parallel work possible on Epic L and M once K2 is done
3. Epic N can be developed alongside L/M
4. Epic O provides safety layer before Epic P
5. Epic P integrates everything - save for last

**Completed:** K1, K2, L0, L1, L2, L3, L4 ✅

**Recommended Next Tasks:**
- M1: Read Drift State (Epic M - Drift Hedge Engine)
- N1: Atomic Transaction Builder (Epic N - can be done in parallel with M)

**Note:** L4 (Auto-Tune) is feature-complete and ready for production testing. It can run independently of the main hedge loop.
