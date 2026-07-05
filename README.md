# Delta-Neutral Bot

A delta-neutral liquidity bot for Solana, live on mainnet as a single Docker
process: it provides SOL/USDC liquidity on **Meteora DLMM** (auto-created,
auto-recentered positions) and neutralizes the SOL exposure with a **Jupiter
Perps** hedge. Runs on a small Hetzner VM; observed and tuned from a laptop
via read-only CLIs.

> Drift was the original hedge venue and died in the April 2026 exploit; the
> hedge pivoted to Jupiter Perpetuals (ADR-015). The old Hono API server and
> GCP deployment were removed (ADR-017).

## How it works

Every `AUTO_TUNE_CHECK_INTERVAL_MS` (15s in production) the orchestrator:

1. **LP side** — discovers positions on-chain (self-heals stale state), reads
   composition; if one side exceeds `AUTO_TUNE_IMBALANCE_THRESHOLD` it
   recenters: withdraw + claim + close (one atomic tx) → optional Jupiter
   Ultra swap (oracle-gated, ADR-020) → create a fresh position centered at
   the current price.
2. **Hedge side** — steers net ΔSOL toward `HEDGE_TARGET_DELTA_SOL` (0 =
   delta-neutral) inside a `DELTA_THRESHOLD_SOL` band. The hedge input is
   NOT the raw LP composition (that churned 6bps fees on every wiggle —
   ADR-018/019): it is the LP **range midpoint** (≈ constant per position)
   clamped to the position's true delta when it exits range (ADR-021), plus
   **idle wallet SOL** above reserves (full-portfolio neutrality, ADR-021).
   Shorts post USDC collateral (~0.5:1, returnable margin); longs post SOL.
   Mutations use Jupiter's request + keeper-fill flow and are **dry-run by
   default** (`HEDGE_DRY_RUN=true`).
3. **Protections** — storm mode pauses recentering when the 5-minute move
   exceeds `LP_VOL_PAUSE_PCT_5M` while the hedge shorts the full one-sided
   bag (a reversible synthetic USDC exit); a 5-minute grace window stops the
   hedge from unwinding while LP funds are mid-rebalance (BUG-011); hedge
   failures never kill the LP loop; a wallet janitor reclaims rent from
   empty dust token accounts.

The economics: **profit = LP fees − gamma (IL) − costs**; SOL direction is
absent by construction. Progress is measured against HODL benchmarks
(`pnpm hodl`) from a per-campaign baseline.

## Commands

```bash
pnpm auto-tune           # THE bot loop (REAL FUNDS when .env says live)
pnpm dashboard [--json]  # read-only TUI/JSON: wallet, LP, hedge, net-ΔSOL band
pnpm hodl [--json]       # whole-strategy equity vs HODL-SOL/USDC/as-is
pnpm pnl                 # PnL report: fees, net-return decomposition, lifetime buckets
pnpm jupiter:read        # hedge state smoke check

# Hedge mutations (DRY-RUN by default; --live to send)
pnpm hedge:open --size-usd=10 --collateral=5
pnpm hedge:close [--side=long] [--size-usd=5]
pnpm hedge:rebalance --lp-sol=12.5
pnpm hedge:emergency     # full close of ALL perp sides at any price
pnpm derisk [--live]     # RED BUTTON: close LP + perps + swap everything to USDC

pnpm test | pnpm build | pnpm lint
pnpm deploy:hetzner | pnpm logs:hetzner | pnpm ssh:hetzner
```

## Architecture

```text
src/cli/auto-tune.ts             loop entry (Docker CMD)
src/modules/autoTuneOrchestrator.ts
    the loop: discover → composition check → recenter → hedge decision;
    storm mode, BUG-011 grace, wallet janitor, re-entrancy guard
src/modules/hedgeController.ts   PURE decision core (band, decrease-first,
    guards) + computeLpMidpointSol / computeLpHedgeDelta — fully unit-tested
src/modules/jupiterPerpsEngine.ts  Jupiter Perps backend: PDAs, carry,
    request+keeper-fill mutations, wSOL lifecycle, idle-SOL inclusion
src/modules/meteoraAdapter.ts    DLMM create/close/exposure/analytics
src/modules/swapPlanner.ts       pure swap planning + oracle gate (ADR-020)
src/modules/jupiterSwapper.ts    Jupiter Ultra order → sign → execute
src/core/priceOracle.ts          Jupiter Lite v3 + Pyth Hermes, cross-validated
src/modules/pnlDb.ts             SQLite: positions, swaps, rebalances,
    hedge_actions, decomposition + lifetime-bucket reports
src/modules/dashboardData.ts     pure snapshot layer (ADR-021-aware delta)
src/cli/derisk.ts                manual full exit to USDC
deploy/hetzner/                  rsync + compose deploy kit (see README there)
```

## Quick start

```bash
pnpm install
cp .env.example .env   # fill RPC_URL, PRIVATE_KEY; review every knob
pnpm test && pnpm build
pnpm auto-tune         # LP-only first; enable the hedge in dry-run before live
```

Safety defaults: `HEDGE_ENABLED=false`, `HEDGE_DRY_RUN=true` — the hedge
simulates until you explicitly flip both. Start with dust amounts. The
`.env.example` documents every parameter with the reasoning (band sizing,
cooldown-as-throttle, storm mode, oracle gate).

## Operational docs

- `CLAUDE.md` — condensed operating knowledge (addresses, gotchas, commands)
- `decisions.md` — ADR log (ADR-001…021, index at the bottom)
- `bugs.md` — bug tracker incl. post-mortems (BUG-008 brick-loop is a read)
- `progress.md` — session-by-session narrative
- `HANDOVER.md` — resume-here state for the next session
- `.claude/skills/` — hodl-check and strategy-analyzer operating procedures

## Status

Live in production since 2026-07-03 (Campaign 2, ~300 USD total, ~130 USD
working capital) on Hetzner. This is an experiment with real funds — treat
every number in `.env` as a risk decision, not a suggestion.
