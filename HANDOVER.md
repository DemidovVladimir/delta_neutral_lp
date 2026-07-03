# HANDOVER — Delta-Neutral Bot (LP + Jupiter Perps hedge, both sides)

**Last updated:** 2026-07-03
**Branch:** `feature/hedge-jupiter-perps-pivot`
**Status:** **Code complete (ADR-017).** Simplified single-process bot; hedge (short OR long) wired into the auto-tune loop, dry-run-validated live; Hetzner deploy scripts ready. **Blocked on operator input for launch** — see "What's next".

---

## TL;DR — where we stopped

Session 14 (2026-07-03) executed the approved ADR-017 plan end-to-end:

1. **Pruned** (−8,034 lines): all Drift code + SDK, the Hono API server (+ its env config), `deploy/gcp` Pulumi, 11 unused dependencies, orphan scripts/docs. Winston is the logger; dashboard + pnl CLIs remain the observation stack.
2. **Both-sides hedge**: `JupiterPerpsEngine` now trades SHORT (USDC collateral) or LONG (SOL collateral, auto-wrapped wSOL). Pure decision core `src/modules/hedgeController.ts` steers `error = (lpSol + longSol − shortSol) − HEDGE_TARGET_DELTA_SOL` into the `DELTA_THRESHOLD_SOL` band: decrease-first, one mutation/cycle, guards on increases only. **BUG-007 fixed** (carry now read from the side's COLLATERAL custody).
3. **Loop wiring**: `AutoTuneOrchestrator.maybeRebalanceHedge()` runs every cycle (skipped right after LP mutations), hedge errors isolated from the LP loop, persisted keeper-fill cooldown (`AutoTuneState.hedge`, `HEDGE_COOLDOWN_MS`), every non-`none` decision recorded to `hedge_actions` in `data/pnl.db`.
4. **Hetzner deploy kit** in `deploy/hetzner/` (provision/deploy/logs/ssh + runbook README). GCP is gone.

**No funds were ever moved.** Everything remains read-only or dry-run; `HEDGE_DRY_RUN` defaults to true.

Validation: `tsc` clean; **60 vitest tests** green; live-mainnet dry-runs — short open (blocks only on 0 USDC), **long open simulates clean end-to-end incl. wSOL wrap**, long close (`AccountNotInitialized` only), controller none/increase_short/increase_long branches; two full live loop cycles with hedge dry-run + graceful shutdown.

---

## What's NEXT (blocked on operator)

1. **Hetzner server** — either:
   - `HCLOUD_TOKEN=... bash deploy/hetzner/provision.sh` (creates a CX22 with Docker), or
   - an existing server IP into `deploy/hetzner/host.env` (copy from `host.env.example`).
2. **Stage A (dry-run on the server)**: create `.env.hetzner` per `deploy/hetzner/README.md` (`AUTO_TUNE_ENABLED=true`, `AUTO_CREATE_POSITIONS=false`, `HEDGE_ENABLED=true`, `HEDGE_DRY_RUN=true`) → `pnpm deploy:hetzner` → observe via `pnpm logs:hetzner` / local `pnpm dashboard`.
3. **Stage B (go-live — needs explicit operator sign-off on sizing)**: wallet `F3YvPiLdniRPGpeKrbeGWR2zg2wPpzVuvqBA5BBJBQ5S` holds **3.266365303 SOL + 0 USDC**. Proposed small-stakes launch: reserve 0.3 SOL, swap ~1.4 SOL → USDC, LP ≈ 1.2 SOL-equivalent (`AUTO_TUNE_DEPOSIT_TOKEN=SOL`, `AUTO_TUNE_DEPOSIT_AMOUNT≈1.2`), `DELTA_THRESHOLD_SOL=0.15`, `MAX_HEDGE_NOTIONAL_USD=150`, `HEDGE_TARGET_COLLATERAL_RATIO=0.33` (ADR-016). Flip `AUTO_CREATE_POSITIONS=true` + `HEDGE_DRY_RUN=false`, redeploy, watch the first cycle.
4. Success criteria: |netΔSOL − target| stays inside the band across LP rebalances; `hedge_actions` rows carry signatures; carry cost visibly below LP fee income (`pnpm pnl`).

---

## Key facts & addresses (verbatim — never abbreviate)

- **Wallet:** `F3YvPiLdniRPGpeKrbeGWR2zg2wPpzVuvqBA5BBJBQ5S`
- **Jupiter Perpetuals program:** `PERPHjGBqRHArX4DySjwM6UJHiR3sWAatqfdBS2qQJu`
- **JLP pool:** `5BUwFW4nRbftYTDMbgxykoFWqWHPzahFSNAaaaJtVKsq`
- **SOL custody:** `7xS2gz2bTp3fwCC7knJvUWTEU9Tycczu6VhJYKgi1wdz`
- **USDC custody:** `G18jKKXQwBbrHeiK3C9MRXhkHsLHf7XgCSisykV46EZa`
- **SHORT SOL position PDA:** `6HFhuYzQGcqdj4NGwC6vfVETRvMA3pXaVeZnHgWSKsJK` (pinned in tests)
- **LONG SOL position PDA:** `FqymRcB92t63jpwh7om4RLbxMNUGoHnZPQMkkAA8ksVY`
- **Meteora SOL/USDC pool:** `5rCf1DM8LjKTw4YqhnoLcngyZYeNnQqztScTogYHAS6`

Position PDA seeds: `["position", wallet, JLP_pool, SOL_custody, collateralCustody, side([1]long/[2]short)]` — longs are collateralised by the SOL custody itself, shorts by USDC.

---

## Smoke commands (re-runnable, no funds)

```bash
pnpm test && pnpm build
pnpm jupiter:read                                  # both PDAs, netted state, per-side carry
pnpm hedge:open --size-usd=10 --collateral=5       # short open sim
pnpm hedge:open --side=long --size-usd=10 --collateral=0.1   # long open sim (wSOL wrap)
pnpm hedge:close --side=long                       # long full-close sim
pnpm hedge:rebalance --lp-sol=3                    # controller: increase_short branch
pnpm hedge:rebalance --lp-sol=0 --target-delta=5   # controller: increase_long branch
pnpm dashboard --json                              # full snapshot (non-TTY)
AUTO_CREATE_POSITIONS=false HEDGE_ENABLED=true HEDGE_DRY_RUN=true pnpm auto-tune   # loop dry-run
```

---

## Open issues / caveats

1. **`.gitignore` has `*.json`** — `src/idl/jupiter-perps-idl.json` was force-added; re-vendoring needs `git add -f`.
2. **`jup-anchor` alias** (= `@coral-xyz/anchor@0.29.0`) exists only for the old-format Jupiter IDL, loaded solely in `src/utils/jupiterPerps.ts`. Never mix its PublicKeys with the project's anchor 0.32 web3 copy.
3. **Long-decrease proceeds arrive as wSOL** — the receiving ATA must outlive the keeper fill (TX2), so TX1 never closes it; the loop unwraps idle wSOL automatically when live and in band (`unwrapWsol`, CLI `--unwrap`). The long-close unwrap ordering has been dry-run simulated but not yet exercised live — watch the first live long close.
4. **Legacy env name**: `MAX_SHORT_NOTIONAL_USD` still parses as a fallback for `MAX_HEDGE_NOTIONAL_USD`.
5. **`collateralRatio: Infinity`** serialises to `null` in JSON — cosmetic, handled by the dashboard's `jsonReplacer`.
6. **Stale local state**: `data/auto-tune-state.json` still carries May counters (iteration 12k). Harmless (positions self-heal from chain); the server starts with a fresh `data/` anyway.

---

## Session log pointer

Full narrative: `progress.md` Session 14 (2026-07-03) and `decisions.md` ADR-017. Bugs: BUG-007 (carry custody — fixed). Deploy runbook: `deploy/hetzner/README.md`.
