# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A delta-neutral liquidity provision bot for Solana, running as a **single process**:

- **LP side:** provides SOL/USDC liquidity on **Meteora DLMM**, auto-creates positions, and auto-tunes (rebalances) them when the composition drifts past a threshold.
- **Hedge side (ADR-015/017):** holds a **Jupiter Perps** SOL position — SHORT **or** LONG — steering net ΔSOL = (LP SOL + perp long − perp short) toward `HEDGE_TARGET_DELTA_SOL` (default 0 = delta-neutral) inside a band. Shorts post USDC collateral; longs post SOL (auto-wrapped to wSOL). Mutations use Jupiter's request + keeper-fill flow (our TX1, keeper's TX2 seconds later) and are **dry-run by default** everywhere.
- Drift was the original hedge venue (ADR-014) but died in the April 2026 exploit; all Drift code has been removed. `HedgeEngine` (`src/modules/hedgeEngine.ts`) keeps the venue abstraction.

Deployment target is a small **Hetzner** VM under Docker Compose (`deploy/hetzner/`). GCP/Pulumi and the Hono API server were removed in ADR-017.

## Commands

```bash
pnpm install             # or npm/bun

# The bot
pnpm auto-tune           # main loop: LP auto-tune + hedge controller (REAL FUNDS when live!)
pnpm auto-tune:watch     # same, with the visual watch display

# Read-only observation
pnpm dashboard           # blessed TUI: wallet, LP, hedge, net-ΔSOL band, liq price
pnpm dashboard --json    # one JSON snapshot (works without a TTY)
pnpm jupiter:read        # hedge state smoke check
pnpm pnl                 # PnL report from data/pnl.db
pnpm hodl                # whole-strategy equity vs HODL-SOL/USDC/as-is (baseline: data/hodl-baseline.json; --init to set; see .claude/skills/hodl-check)

# Hedge mutations (DRY-RUN by default; --live to send)
pnpm hedge:open --size-usd=10 --collateral=5              # short (USDC collateral)
pnpm hedge:open --side=long --size-usd=10 --collateral=0.1  # long (SOL collateral)
pnpm hedge:close [--side=long] [--size-usd=5]
pnpm hedge:rebalance --lp-sol=12.5 [--target-delta=0]     # run the controller once
pnpm hedge:emergency                                      # full close of ALL sides at any price
tsx src/cli/jupiter-hedge.ts --unwrap                     # fold idle wSOL back to native SOL

# Dev
pnpm test | pnpm build | pnpm lint | pnpm format
pnpm find-pools          # discover SOL/USDC DLMM pools

# Docker / deploy
docker compose up -d && docker compose logs -f
pnpm deploy:hetzner      # rsync + .env upload + compose up (see deploy/hetzner/README.md)
pnpm logs:hetzner | pnpm ssh:hetzner
```

## Architecture

### The loop (`src/cli/auto-tune.ts` → `src/modules/autoTuneOrchestrator.ts`)

Every `AUTO_TUNE_CHECK_INTERVAL_MS`:
1. Discover LP positions on-chain (self-heals stale state), read `LpExposure`, check composition.
2. If imbalanced → three-phase LP rebalance: **Phase 1** withdraw+claim+close (atomic, retry loop with on-chain race recovery) → **swap** if needed (planned by pure `swapPlanner.ts`, executed via Jupiter Ultra) → **Phase 2** create the new position (retries re-fetch balances and re-plan the swap).
3. `maybeRebalanceHedge(exposure)` — runs every cycle EXCEPT right after an LP mutation (exposure would be stale). Hedge failures are isolated: own error counter, 5 consecutive failures disable the hedge alone (loud banner), the LP loop never dies from a hedge problem.

### The hedge (ADR-015/017)

- **`src/modules/hedgeController.ts` — the pure decision core.** No I/O; fully unit-tested (`hedgeController.test.ts`, table-driven). Law: `error = (lpSol + longSol − shortSol) − targetDeltaSol`; act only when `|error| > DELTA_THRESHOLD_SOL`; **decrease the opposing side first** (never hold both sides), one mutation per cycle; decreases are never guard-blocked; increases must pass carry cap, per-side notional cap, projected collateral ratio, and (longs) wallet reserves.
- **`src/modules/jupiterPerpsEngine.ts` — the venue backend.** `readSides()` fetches both position PDAs + both custodies in parallel. Carry accrues on the **collateral** custody (USDC for shorts, SOL for longs — BUG-007). Long increases pre-wrap SOL→wSOL in the same TX; a long decrease's receiving wSOL ATA must outlive the keeper fill, so it is never closed in TX1 — `unwrapWsol()` reclaims it later (the loop does this automatically when live and in band). Slippage: short open = price floor / short close = ceiling; long open = ceiling / long close = floor; full closes use guaranteed-fill bounds ($100k ceiling short, BN(1) floor long).
- **Keeper-fill cooldown:** `AutoTuneState.hedge.lastActionAt` (persisted; set only after LIVE sends) + `HEDGE_COOLDOWN_MS` prevent double-hedging while TX2 is in flight — including across restarts.
- **`src/utils/jupiterPerps.ts`:** IDL loader (`jup-anchor` = anchor 0.29 alias — the IDL is old-format; loaded only here), PDAs, borrow-rate math, liquidation-price port, hand-rolled SPL ixs. Position PDA seeds: `["position", wallet, pool, SOL_custody, collateral_custody, side(1|2)]`.

### Supporting modules

- `meteoraAdapter.ts` — LP create / withdraw+claim+close / exposure / on-chain analytics (the off-chain `dlmm-api.meteora.ag` host is dead, BUG-004).
- `jupiterSwapper.ts` — Jupiter Ultra API swaps (order → sign → execute).
- `swapPlanner.ts` — pure swap-decision helper (total-value pre-flight + per-branch balance guards), unit-tested.
- `priceOracle.ts` — Jupiter Lite v3 + Pyth Hermes, cached, cross-validated.
- `persistence.ts` — `data/state.json`, `data/auto-tune-state.json`.
- `pnlDb.ts` — SQLite (`data/pnl.db`): positions, snapshots, swaps, rebalances, **hedge_actions** (every non-`none` hedge decision, dry-run included), HODL benchmarks. All writers fail-safe.
- `dashboardData.ts` / `dashboard.ts` — pure snapshot layer + blessed TUI renderer.

## Configuration (.env — see .env.example for the full annotated list)

Core: `RPC_URL`, `PRIVATE_KEY`.
LP: `METEORA_POOL_ADDRESS`, `AUTO_CREATE_POSITIONS`, `AUTO_TUNE_*` (bin count, interval, threshold, deposit token/amount), `SWAP_*` (slippage, buffer, impact warning), reserves `MINIMUM_WALLET_BALANCE_SOL` + `RENT_RESERVE_SOL`.

Hedge (ADR-017):
- `HEDGE_ENABLED` (default false) and `HEDGE_DRY_RUN` (**default true** — the loop simulates mutations until you flip it)
- `HEDGE_TARGET_DELTA_SOL` (0 = delta-neutral; positive = deliberate long tilt, can exceed LP exposure → perp long)
- `DELTA_THRESHOLD_SOL` (band; size to ~10% of LP SOL exposure)
- `MAX_HEDGE_NOTIONAL_USD` (per-side blast-radius cap; legacy `MAX_SHORT_NOTIONAL_USD` still parses)
- `HEDGE_TARGET_COLLATERAL_RATIO` (1.0 = 1×; ADR-016 runs 0.33 ≈ 3×), `MIN_COLLATERAL_RATIO` (hard floor)
- `HEDGE_CARRY_CAP_BPS` (refuse increases above this borrow APR), `HEDGE_COOLDOWN_MS` (keeper-fill guard)

## Key facts & addresses (verbatim — never abbreviate)

- Wallet: `F3YvPiLdniRPGpeKrbeGWR2zg2wPpzVuvqBA5BBJBQ5S`
- Jupiter Perpetuals program: `PERPHjGBqRHArX4DySjwM6UJHiR3sWAatqfdBS2qQJu`
- JLP pool: `5BUwFW4nRbftYTDMbgxykoFWqWHPzahFSNAaaaJtVKsq`
- SOL custody: `7xS2gz2bTp3fwCC7knJvUWTEU9Tycczu6VhJYKgi1wdz` / USDC custody: `G18jKKXQwBbrHeiK3C9MRXhkHsLHf7XgCSisykV46EZa`
- Short SOL position PDA: `6HFhuYzQGcqdj4NGwC6vfVETRvMA3pXaVeZnHgWSKsJK` / Long: `FqymRcB92t63jpwh7om4RLbxMNUGoHnZPQMkkAA8ksVY`
- Meteora SOL/USDC pool: `5rCf1DM8LjKTw4YqhnoLcngyZYeNnQqztScTogYHAS6`

## Gotchas

- `.gitignore` has `*.json`, which would exclude `src/idl/jupiter-perps-idl.json` — it was force-added. Re-vendoring requires `git add -f`.
- `jup-anchor` (anchor 0.29 alias) exists ONLY for the Jupiter IDL; the rest of the project uses anchor 0.32. Keep every Jupiter PublicKey inside the jup-anchor web3 copy (no dual-web3 casting).
- Carry sign convention: `carryRateBps` negative = the hedge PAYS (always, on Jupiter — borrow fee, not funding income). Break-even ≈ LP fee APR > carry APR / 2.
- Jupiter fills are asynchronous (TX2). Never act on position state within `HEDGE_COOLDOWN_MS` of a live mutation.
- Meteora SDK + Jupiter APIs handle priority fees internally; `SEND_OPTIMIZED=true` opts LP sends into simulated CU limits + Helius fee estimates.

## Documentation duties

**Always update** `progress.md` after every session, add bug reports to `bugs.md`, and document architectural decisions in `decisions.md` (ADR index at the bottom). `HANDOVER.md` carries the resume-here state for the next session.
