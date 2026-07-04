# HANDOVER — Delta-Neutral Bot (LP + Jupiter Perps hedge, both sides)

**Last updated:** 2026-07-04 (Session 16)
**Branch:** `feature/hedge-jupiter-perps-pivot` (NOT pushed to a remote — local only)
**Status:** ⚠️ **BOT DOWN SINCE 2026-07-04T04:33Z — FIX COMMITTED (87e71d1) BUT NOT DEPLOYED.** The
container on Hetzner `167.233.105.131` is restart-brick-looping (BUG-008: stale persisted
`running: true`). On-chain right now: LP `HJPZ5EczJ1QMWWCP2PMmrgonh17xXfVJoEfES4a9seAJ` is 100% SOL
(1.22 SOL, out of range, earning nothing), short 0.531 SOL — net ΔSOL ≈ **+0.69 unhedged**.
**FIRST ACTION: `pnpm deploy:hetzner`** (auto-mode classifier blocks it; the operator must run/approve
it). After deploy expect: one LP rebalance (swap ~0.6 SOL→USDC + recenter), then hedge likely in the
new ±0.25 band. Verify with `pnpm logs:hetzner` that cycles tick and the container stays Up >5 min.
Session 16 also shipped ADR-018 (band 0.06→0.25, cooldown 120s→600s) — hedge churn was eating ~all
LP income (see `progress.md` Session 16).

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

## Deployment status (2026-07-03)

**Stage A is LIVE on Hetzner**: server `delta-bot`, **cpx22** (2 vCPU x86 / 4 GB, fsn1), IP **167.233.105.131**, Docker Compose, container running the loop every 15s with `AUTO_CREATE_POSITIONS=false`, `HEDGE_ENABLED=true`, `HEDGE_DRY_RUN=true`. Hedge heartbeat (`Hedge: no action — in band`, sampled INFO) confirmed in server logs; state persists to `/opt/delta-bot/data` (uid 1000). Server coordinates + `HCLOUD_TOKEN` live in gitignored `deploy/hetzner/host.env`. Redeploy = `pnpm deploy:hetzner`; logs = `pnpm logs:hetzner`.

Operator budget decision: **~$30 total experiment** — `.env` sized accordingly (`AUTO_TUNE_DEPOSIT_AMOUNT=0.15` SOL → LP ≈ $24, `HEDGE_TARGET_COLLATERAL_RATIO=0.5` → short collateral ≈ $6, `DELTA_THRESHOLD_SOL=0.1`, `MAX_HEDGE_NOTIONAL_USD=40`).

## Stage B — LIVE since 2026-07-03 ~13:07 UTC (operator: «погнали»)

1. Funding swap: **0.35 SOL → 28.512026 USDC**, signature
   `iVj7MvsFEyF2a4A3uRQRXsYFhcg54QWhghqDcFcT7uaa1t2ZDh1gjt9tPz4nU9K1GLYxZHJGjZuJL2yDJ54jUWh`.
2. LP position auto-created: **0.15 SOL + 12.220767521156759 USDC**, range **$81.14661214654234–$81.76555161061418** (20 bins),
   mint `KS1p61P3g5Rub8Ar9TXWp8rbu2Wxi1jpQQLDJVtaMrA`, signature
   `537VY8KsFkXvUwiKKrDabJ3e2YKyrTAbPAH1wuD5EJqeTrMeJAV9huAw5SHZ195ZLtiMM19kfZttzsRmfFcafdRj`.
3. Hedge opened LIVE next cycle: **increase_short −0.149999997 SOL** ($12.220511976089755 notional,
   6.1102559880448775 USDC collateral, fill floor $81.06 @ oracle $81.47), request
   `Ae3j8h9zPZv24eGYXLrZeix7aLyJ9Jf6gYCafvzBcBck`, TX1 signature
   `3mtTAD5wScCLaXMSqGGvYYbx3o5Nf3xJWfjoy1NEoALijuV9fkTErKh44yziUKB4N2uHPUMqdWpoUZYs35ih5A9o`.
   Keeper filled within ~15s; the bot read **netΔSOL ≈ −0.02** (inside the ±0.1 band) — delta-neutral.
4. Survived a redeploy/restart: position rediscovered from chain, hedge stayed in band, pnl.db writes
   clean after the pnpm-10 build-script fix (`pnpm.onlyBuiltDependencies`).

**Ongoing observation:** `pnpm logs:hetzner`, local `pnpm dashboard`, `pnpm pnl` (hedge_actions table).
Watch-fors: first LP auto-tune rebalance (composition threshold 0.92) and the hedge re-centering after
it; utilization spikes in carry; the first live long-close/unwrap if a long ever opens (dry-run-validated only).

### Post-launch notes (end of session)

- **The mystery +34.085672 USDC is RESOLVED — it's the operator's own money.** TX
  `5VVvDccXxcsVYhaFXn7TmdTQqW2t9LhTkGw6vtkwUbePAqyPPGQHS5V2cTHaEipXurQehzDPjVDbUVrKL2mdMYA1`
  (13:04:26 UTC, plain spl-token transfer from hot wallet `F7p3dFrjRTbtRp8FRF6qHLomXbKRBzpvBLjtQcfcgmNe`)
  is the payout of the operator's Jupiter cross-chain swap USDC(Ethereum) → USDC(Solana), done just
  before launch. Not a rebalance, not a hedge payout, not an attack. Do NOT re-investigate.
- Wallet reconciliation at close (SOL ≈ $81.5): SOL 3.266365303 → 2.706501121 (0.35 swap + 0.15 LP +
  ~0.057 refundable position rent + fees); USDC 0 → 44.266678 (= +34.085672 bridge +28.512026 swap
  −12.220768 LP −6.110256 short collateral). Everything accounted for.
- The bot does not distinguish "own" vs "extra" USDC: a future LP rebalance may deposit part of the
  free 44 USDC toward its target (it won't swap unnecessarily). Operator was offered isolation and
  declined («забей»).
- First ~15 min of fee flow: claimable ≈ $0.008 (0.000043249 SOL + 0.004216 USDC) vs short carry
  ≈ $0.002/DAY (−5.48% APR on $12.22 notional). Early unit economics strongly positive; do not
  extrapolate a 15-minute sample.
- LP position opening happened BEFORE the pnl.db fix landed on the server, so `positions` has no row
  for `KS1p61P3g5Rub8Ar9TXWp8rbu2Wxi1jpQQLDJVtaMrA` — per-tick snapshots are silently skipped (by
  design) until the FIRST rebalance creates the next position; from then on stats are complete.
  `hedge_actions` records fine regardless.

## Next-session checklist (start here)

1. Read state: `pnpm logs:hetzner` (or `ssh root@167.233.105.131 'cd /opt/delta-bot && docker compose logs --tail=200'`), local `pnpm dashboard --json`, and on-server pnl:
   `ssh root@167.233.105.131 'cd /opt/delta-bot && docker compose exec -T delta-neutral-bot ./node_modules/.bin/tsx src/cli/pnl.ts'`.
2. Questions to answer for the operator (he speaks Russian, wants a profitability read):
   - **Whole-strategy vs HODL: `pnpm hodl`** (campaign-level verdict; skill: `.claude/skills/hodl-check`).
     **Campaign 2 baseline** (local `data/hodl-baseline.json` + server copy): captured
     2026-07-03T20:26:42.414Z, 2.237812341 SOL + 113.16 USDC @ $82.50 = $297.78, note
     "Campaign 2: ~$100 working capital". Do NOT re-init without the operator asking.
     Daily history: server crontab (00:17 UTC) appends to /opt/delta-bot/data/hodl-history.jsonl.
     **Operator plan: срез Jul 4 (sanity), verdict Tuesday Jul 7 (~3.5-day window).**
   - How many LP rebalances happened; realized PnL vs HODL benchmarks (`pnpm pnl`).
   - How many hedge adjustments (`hedge_actions` table), did net ΔSOL stay in the ±0.1 band.
   - Fee income rate vs carry cost; network fees burned.
3. If the hedge ever opened a LONG and closed it: verify the wSOL unwrap path worked live (first
   live exercise of that path; the loop's idle-unwrap should have folded wSOL back to native).
4. Consider: push the branch to a remote (12 local commits, no backup!) and open a PR to main.
5. Emergency commands if something looks wrong: `pnpm hedge:emergency --live` flattens ALL perp
   positions at any price; `ssh … docker compose down` stops the bot; LP can be closed from the
   Meteora UI or by the bot's own withdrawClaimAndClose.

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
