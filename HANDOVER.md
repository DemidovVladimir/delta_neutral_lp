# HANDOVER — Delta-Neutral Hedge (Drift → Jupiter Perps pivot)

**Last updated:** 2026-06-28
**Branch:** `feature/hedge-jupiter-perps-pivot`
**Status:** Hedge read-side + observability DONE & validated on Jupiter Perps. Write-side NOT started.

---

## TL;DR — where we stopped

The bot's planned hedge venue was **Drift** (ADR-014). During this session we discovered **Drift is down after a ~$285M exploit (April 1, 2026)** and is mid-relaunch (settlement asset changing USDC→USDT, new program). The pinned `@drift-labs/sdk@2.156.0` targets the now-frozen old program and its instructions are rejected on-chain.

**Decision (ADR-015): pivot the hedge to Jupiter Perpetuals** (live, ~80% of Solana perps volume). We built and validated the **read side + dashboard** on Jupiter Perps. The next session picks up at the **write side** (open/adjust/close short via the request+keeper flow, dry-run gated).

**No funds were ever moved.** Everything is read-only or dry-run.

---

## What is DONE and VALIDATED (live mainnet, read-only)

| Area | Files | Validated by |
|---|---|---|
| Risk/Drift config wired into `BotConfig` | `src/config/env.ts`, `.env.example` | `tsc`, boot validation |
| Venue-agnostic `HedgeEngine` interface + shared types | `src/modules/hedgeEngine.ts` | `tsc` |
| Jupiter Perps loader/constants/PDA/borrow-math | `src/utils/jupiterPerps.ts`, `src/idl/jupiter-perps-idl.json` | live custody decode |
| `JupiterPerpsEngine` read side (`getHedgeState`/`computeDelta`) | `src/modules/jupiterPerpsEngine.ts` | `pnpm jupiter:read` (live) |
| Read-only dashboard (blessed-contrib) on Jupiter | `src/cli/dashboard.ts`, `src/modules/dashboardData.ts`, `src/utils/dashboardLib.ts` | `pnpm dashboard --json` (live), `--mock --json` (offline) |

**Smoke commands (re-runnable, no funds):**
```bash
pnpm jupiter:read                 # hedge state: position, carry, price
pnpm jupiter:read --lp-sol=12.5   # + net ΔSOL vs band
pnpm dashboard --json             # full snapshot as JSON (non-TTY)
pnpm dashboard --mock --json      # offline deterministic snapshot
pnpm dashboard                    # live TUI panel (needs a real terminal)
pnpm dashboard --mock             # TUI with fake data (layout check)
```

Last live read (2026-06-28): venue `jupiter-perps`, `carryRateBps ≈ -1176` (≈ **-11.76% APR borrow cost**), no position open (clean start), SOL ≈ $70.

---

## What is NEXT (write side — not started)

Implement Jupiter Perps mutations in `JupiterPerpsEngine` (currently `notImplemented`):
1. **Open / increase short** — build a `positionRequest` (PDA seeds: `["position_request", positionPubkey, counter(le8), requestChange([1]increase/[2]decrease)]`), submit (TX1), keeper fills (TX2). Collateral = USDC. **Dry-run (simulate) by default**, `--live` to send.
2. **Decrease / close short** — `requestChange = decrease [2]`.
3. **`rebalanceHedge(lpExposure)`** — the controller: size the short to `lpExposure.solAmount`, respect band (`DELTA_THRESHOLD_SOL`) + risk guards (`MIN_COLLATERAL_RATIO`, `MAX_SHORT_NOTIONAL_USD`). Carry has no `FUNDING_RATE_CAP_BPS` equivalent yet — decide whether to add a carry-cap guard (e.g. refuse to hold short when borrow APR > threshold).
4. **`liquidationPrice`** in `getHedgeState` — currently returns `null`; compute from the open position (Jupiter ref: `src/examples/get-liquidation-price.ts`).
5. Add a hedge mutation CLI (mirror `src/cli/drift-hedge.ts`'s dry-run/`--live` pattern) → `pnpm hedge:open` / `hedge:close` or extend one CLI.
6. Wire the controller into the auto-tune loop (or a dedicated hedge loop) once dry-run-validated.

**Reference repo for write instructions** (Jupiter has no official TS SDK): `julianfssen/jupiter-perps-anchor-idl-parsing` — see `src/examples/create-market-trade-request.ts` and `close-position-request.ts`.

---

## Key facts & addresses (verbatim — never abbreviate)

- **Wallet:** `F3YvPiLdniRPGpeKrbeGWR2zg2wPpzVuvqBA5BBJBQ5S`
- **Jupiter Perpetuals program:** `PERPHjGBqRHArX4DySjwM6UJHiR3sWAatqfdBS2qQJu`
- **Doves oracle program:** `DoVEsk76QybCEHQGzkvYPWLQu9gzNoZZZt3TPiL597e`
- **JLP pool:** `5BUwFW4nRbftYTDMbgxykoFWqWHPzahFSNAaaaJtVKsq`
- **SOL custody (market):** `7xS2gz2bTp3fwCC7knJvUWTEU9Tycczu6VhJYKgi1wdz`
- **USDC custody (short collateral):** `G18jKKXQwBbrHeiK3C9MRXhkHsLHf7XgCSisykV46EZa`
- **Our SHORT SOL position PDA:** `6HFhuYzQGcqdj4NGwC6vfVETRvMA3pXaVeZnHgWSKsJK` (empty — no position)
- **Drift program (frozen/exploited, do NOT use):** `dRiftyHA39MWEi3m9aunc5MzRF1JYuBsbn6VPcn33UH`

Position PDA seeds: `["position", wallet, JLP_pool, custody, collateralCustody, side([1]long/[2]short)]`.

---

## Carry economics (decided to proceed)

- Carry is a **continuous cost** on Jupiter (borrow fee), not funding income like Drift would have been. Sign convention in code: `carryRateBps` **negative = the short pays**.
- Jump curve (annual borrow APR): **10%** @ 0% util → **35%** @ 80% util → **150%** @ 100% util. Currently util ≈ 5.7% → **≈ 11.8% APR**.
- Break-even framework: the hedge shorts only the **SOL half** of the LP, so net-positive when **LP fee APR > carry_APR / 2** (≈ 6% now). Risk: utilization spikes push carry toward 35–150% (often exactly during big SOL moves).

---

## Open issues / caveats

1. **Configured Meteora LP pool is broken.** `METEORA_POOL_ADDRESS=5rCf1DM8LjKTw4YqhnoLcngyZYeNnQqztScTogYHAS6` returns **404** on the Meteora API; the saved position mint `EUXx25SLaS3sbPvcirLw7QzaBQepkB9M4QJ7u4eXxhVs` is **not on-chain**. The LP side (the thing we're hedging) currently reads 0. **Must fix before any live hedge** — find a live SOL/USDC DLMM pool, update config. See BUG-004.
2. **`.gitignore` has `*.json`** which excludes `src/idl/jupiter-perps-idl.json` — it was force-added (`git add -f`). If you re-vendor it, force-add again, or add a `!src/idl/*.json` negation.
3. **`jup-anchor` alias** = `@coral-xyz/anchor@0.29.0` (npm alias) — required because Jupiter's IDL is the old (0.29) format and the project's top-level anchor `0.32` can't parse it. Loaded only in `src/utils/jupiterPerps.ts`.
4. **Drift code is dead but kept.** `src/modules/driftEngine.ts`, `src/utils/drift.ts`, `src/cli/drift-read.ts`, `src/cli/drift-hedge.ts`, `@drift-labs/sdk` — retained as a paused backend (Drift may relaunch). Not on the `HedgeEngine` interface yet. Decide later: migrate or remove.
5. **`collateralRatio: Infinity`** serializes to `"Infinity"`/`null` in JSON — cosmetic, handled by the dashboard's `jsonReplacer`.

---

## Architecture notes

- **Engine abstraction:** `HedgeEngine` (`src/modules/hedgeEngine.ts`) is the venue-agnostic contract. `JupiterPerpsEngine` is the active backend; a future Drift backend can implement the same interface.
- **Why direct fetches (not polling subscription):** Jupiter needs only a couple of accounts (custody + our position PDA); per-read fetch is simpler/cheaper than a subscriber. `jupiterPerps.getPerpsProgram()` builds a dedicated jup-anchor web3 Connection from `RPC_URL` so all PublicKeys share one web3 copy (no dual-web3 casting).
- **Dashboard:** data layer (`dashboardData.ts`, pure, JSON-dumpable) is separate from the renderer (`dashboard.ts`, blessed-contrib). `--json` works without a TTY for deterministic smoke tests.

---

## Session log pointer

Full narrative in `progress.md` (2026-06-28 session) and `decisions.md` ADR-015. Bugs: BUG-003 (Drift down), BUG-004 (Meteora pool 404).
