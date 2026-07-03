# HANDOVER — Delta-Neutral Hedge (Drift → Jupiter Perps pivot)

**Last updated:** 2026-06-30
**Branch:** `feature/hedge-jupiter-perps-pivot`
**Status:** Hedge read-side + observability DONE & validated on Jupiter Perps. Write-side: **open/increase + decrease/close + `rebalanceHedge` controller + `liquidationPrice` + `emergencyUnwind` built & dry-run-validated on live mainnet** (`pnpm hedge:open` / `hedge:close` / `--rebalance` / `--emergency`). Only **loop wiring** remains before a live end-to-end hedge.

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
| **Write side Step 1 — open/increase short** (request+keeper TX1; PDAs, ATA, account wiring, dry-run/`--live`) | `src/utils/jupiterPerps.ts` (PDA/ATA helpers), `src/modules/jupiterPerpsEngine.ts` (`openOrIncreaseShort`), `src/cli/jupiter-hedge.ts` | `pnpm hedge:open` dry-run (live mainnet sim): program invoked, request+escrow built, Validate inputs passed; only blocker = 0 USDC collateral |
| **Write side Step 2 — decrease/close short** (`createDecreasePositionMarketRequest`; full close + partial; ceiling slippage) | `src/modules/jupiterPerpsEngine.ts` (`decreaseOrCloseShort`), `src/cli/jupiter-hedge.ts` (`--close`) | `pnpm hedge:close` dry-run (live sim): instruction decoded, 16 metas + params accepted; only blocker = no open position (`AccountNotInitialized 3012`) |
| **Write side Step 3 — `rebalanceHedge` controller** (band gate, increase/decrease sizing, carry/notional/collateral guards, 1× collateral) | `src/modules/jupiterPerpsEngine.ts` (`rebalanceHedge`), `src/config/env.ts` (`HEDGE_TARGET_COLLATERAL_RATIO`, `HEDGE_CARRY_CAP_BPS`), `src/cli/jupiter-hedge.ts` (`--rebalance --lp-sol=`) | dry-run: in-band→none, $15k→blocked(max notional), 12.5 SOL→increase_short sized $948 notional/$948 collateral |
| **Write side Step 4 — `liquidationPrice`** (faithful Jupiter port; fees + maintenance margin) | `src/utils/jupiterPerps.ts` (`computeLiquidationPrice`), `src/modules/jupiterPerpsEngine.ts` (`getHedgeState`) | synthetic-position math pinned (2× short→$147.99, long mirror→$52.01, +$10 carry→$146.99, closed→null); live read clean |
| **Write side Step 5 — `emergencyUnwind`** (full close at any price; `--emergency` CLI) | `src/modules/jupiterPerpsEngine.ts` (`emergencyUnwind`), `src/cli/jupiter-hedge.ts` (`--emergency`) | `--emergency` dry-run (live sim): full-close request built, only blocker = no open short (`AccountNotInitialized 3012`) |

**Smoke commands (re-runnable, no funds):**
```bash
pnpm jupiter:read                 # hedge state: position, carry, price
pnpm jupiter:read --lp-sol=12.5   # + net ΔSOL vs band
pnpm dashboard --json             # full snapshot as JSON (non-TTY)
pnpm dashboard --mock --json      # offline deterministic snapshot
pnpm dashboard                    # live TUI panel (needs a real terminal)
pnpm dashboard --mock             # TUI with fake data (layout check)

# Write side (DRY-RUN by default — builds + simulates, sends NOTHING):
pnpm hedge:open --size-usd=10 --collateral=5            # simulate opening a SHORT
pnpm hedge:open --size-usd=10 --collateral=5 --live     # LIVE: submit the request (escrows USDC; needs USDC in wallet)
pnpm hedge:open --size-usd=10 --collateral=5 --slippage-bps=80
pnpm hedge:close                                        # simulate a FULL close (needs an open short to actually fill)
pnpm hedge:close --size-usd=5 --collateral=2            # simulate a PARTIAL decrease
pnpm hedge:close --live                                 # LIVE: full-close request

tsx src/cli/jupiter-hedge.ts --emergency                # simulate EMERGENCY UNWIND (full close, fill at any price)
tsx src/cli/jupiter-hedge.ts --emergency --live         # LIVE: emergency full-close request
```

Last live read (2026-06-30): venue `jupiter-perps`, `carryRateBps ≈ -1181` (≈ **-11.81% APR borrow cost**), no position open (clean start), SOL ≈ $73.43, `liquidationPrice` = `null` (no position — populates only with an open short).

---

## What is NEXT (write side — open + close + controller + liq-price + emergency done; only loop wiring left)

1. ✅ **Open / increase short** — DONE. `JupiterPerpsEngine.openOrIncreaseShort` builds `createIncreasePositionMarketRequest` (request PDA seeds `["position_request", positionPubkey, counter(le8), [1]increase]`), submits TX1; keeper fills TX2. Collateral = USDC. Dry-run by default, `--live` to send. Validated dry-run on mainnet (only blocker = 0 USDC in wallet).
2. ✅ **Decrease / close short** — DONE. `decreaseOrCloseShort` builds `createDecreasePositionMarketRequest` (`requestChange = decrease [2]`; `receivingAccount`/`desiredMint` = USDC; full close = zero deltas + `entirePosition:true` + `$100k` ceiling; partial = real ceiling `oracle*(1+slip)`). Validated dry-run (only blocker = no open position).
3. ✅ **`rebalanceHedge(lpExposure)` controller** — DONE. Band gate, increase/decrease sizing toward `lpExposure.solAmount`, guards (carry `HEDGE_CARRY_CAP_BPS=5000`/50% APR on increases, `MAX_SHORT_NOTIONAL_USD`, `MIN_COLLATERAL_RATIO`), collateral sized to `HEDGE_TARGET_COLLATERAL_RATIO=1.0` (1×). Returns `HedgeRebalanceResult` (now carries `mutation?`). Dry-run validated (none/blocked/increase paths).
4. ✅ **Hedge mutation CLI** — DONE. `pnpm hedge:open` / `hedge:close` / `--rebalance --lp-sol=`.
5. ✅ **`liquidationPrice`** in `getHedgeState` — DONE. `computeLiquidationPrice()` in `src/utils/jupiterPerps.ts` is a line-by-line port of Jupiter's `get-liquidation-price.ts` (close fee + price-impact fee + accrued borrow fee vs. maintenance margin `sizeUsd/maxLeverage`; short healthy → liq above entry). `getHedgeState` fetches the collateral (USDC) custody and fills the field (was `null`). Math pinned with synthetic positions (2× short @ $100/$500 → liq $147.99; long mirror $52.01; +$10 carry → $146.99; closed → null). Dashboard "Liq price" row now populates automatically.
6. ✅ **`emergencyUnwind`** — DONE. `JupiterPerpsEngine.emergencyUnwind({ dryRun })` delegates to `decreaseOrCloseShort({ entirePosition: true })` (the `$100k` "fill at any price" ceiling → guaranteed keeper fill), tags the result `emergency_unwind`, loud `errorBanner`. CLI: `--emergency` (dry-run) / `--emergency --live`. Dry-run validated live (full-close request built, only blocker = no open short → `AccountNotInitialized 3012`).
7. 🔜 Wire the controller into the auto-tune loop **(operator decision 2026-06-30: wire INTO the existing `AutoTuneOrchestrator` — call `rebalanceHedge` after each LP composition check, single process, not a separate loop)**, once dry-run-validated. **This is the last remaining write-side step.** Also still blocking a real end-to-end delta: BUG-004 (no LP position created yet — the long side reads 0).

**Hedge controller config (operator-chosen 2026-06-29):** `HEDGE_TARGET_COLLATERAL_RATIO=1.0` (1× fully collateralized — safest), `HEDGE_CARRY_CAP_BPS=5000` (block increases when borrow APR > 50%). Both in `.env.example`; defaults live in `env.ts`.

**To take the open LIVE:** the wallet needs USDC collateral (currently 0). That's a deliberate fund movement — fund the USDC ATA, then `pnpm hedge:open --size-usd=.. --collateral=.. --live`.

**Slippage convention (verified against the dry-run + Jupiter ref):** for a SHORT, `priceSlippage` on an **increase** is a price FLOOR `oracle*(1 - bps/1e4)` (selling — refuse if entry too low); on a **decrease/close** it's a price CEILING (buying back — refuse if too high; ref hardcodes `100_000_000_000` = "fill at any price"). `DEFAULT_PERP_SLIPPAGE_BPS = 50` in the engine, overridable via `--slippage-bps`.

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

1. **BUG-004 reframed + analytics fixed (2026-06-29).** The pool `5rCf1DM8LjKTw4YqhnoLcngyZYeNnQqztScTogYHAS6` is **alive** (verified on-chain + GeckoTerminal: ~$3.3M TVL, ~$51M/24h, binStep 4, base fee 0.04%). The 404 was the whole **off-chain API host `dlmm-api.meteora.ag` being dead**, not the pool. `getMeteoraPairInfo` now derives analytics **on-chain (DLMM SDK)** + GeckoTerminal for 24h volume — no dead-host dependency. **Residual:** no LP position created yet (the "LP reads 0" half) — create one (`AUTO_CREATE_POSITIONS=true`) + clear the stale state mint before a live end-to-end delta.
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
