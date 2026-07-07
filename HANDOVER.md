# HANDOVER — Delta-Neutral Bot (LP + Jupiter Perps hedge, both sides)

**Last updated:** 2026-07-07 (Session 20)

## Session 20 delta (read this first, then the Session 19 context below)

**ADR-025 deployed** (operator-approved): BUG-015 fix (the hedge used to be
silently skipped on EVERY imbalanced cycle — storm clamp was dead code;
evidence in bugs.md) + clamp-commit freeze while the healthy recenter
pipeline owns the imbalance + auto-band `HEDGE_BAND_BINS=4`
(DELTA_THRESHOLD_SOL=0.25 is now the floor; today auto 0.244 → no-op) +
`HEDGE_TARGET_COLLATERAL_RATIO` 0.5→0.33 (new increases only; projected
full-migration liq ≈ spot +32%). 103 vitest + 17 cargo green; vectors
regenerated (decide() unchanged). Simulator defaults now mirror production;
`--no-clamp-freeze` = the pre-ADR-025 machine.

**Queue leftovers:** pool switch — operator undecided. Sim says any fat pool
≈ 2× edge; the on-chain activity check killed the 0.2% candidate (58 tx/h)
and strengthened the 0.1% one:
`BGm1tav58oGcsQJehL9WXBFXF7D27vZsKefj4xJKD5Y` (bin step 10, base fee 0.1%,
7,772 successful tx/h vs our 1,120; TVL ≈ 20,112 SOL + $1.21M USDC).
Switching = new campaign (baseline re-init). Scaling 130→300+: auto-band
was the missing piece, now in — the conversation can resume after a clean
срез on ADR-025.

**Watch-fors after this deploy:** first `🧊 Clamp regime commit frozen`
line; first storm with a LIVE clamp trade (never happened before — the
clamp path is now reachable); collateral blend drifting 0.466→0.33 on new
increases (liq price will drift closer to spot accordingly — alarm only
below 1.3× spot); `pnpm test` is vitest WATCH mode, use `npx vitest run`.
RULE #1 (operator, standing): explain every number step-by-step, mechanism
first — see memory `explain-step-by-step-rule-one`.
**Branch:** `main` (github.com:DemidovVladimir/delta_neutral_lp) — feature/hedge-jupiter-perps-pivot merged in and deleted 2026-07-07 along with feature/ID-2-auto-tune (both were fully merged); the old multipool experiment survives as tag `archive/multipool-bkp` (commit `e100c9a`), its branch deleted. Work directly on `main` until a new feature branch is warranted.
**Status:** **LIVE, recovered from BUG-014.** Helius quota died 2026-07-06T17:27Z → bot
crash-looped 15h (959 restarts), LP out of range, +0.41 SOL unhedged. Operator upgraded the
Helius subscription 08:35Z Jul 7 → restart 08:40Z → recenter (new position mint
`3WuvvKnQo8iJHBGAEZYmNBEaZXNNjGBL7uUoBj2nz5Fc`) → increase_short +0.366 SOL →
**netΔ −0.0000048 at 08:46:28Z**. Host watchdog live (ADR-024) with ntfy.sh + Telegram
(`@healthchecks_delta_neutral_bot`) push alerts; all channel secrets in server-only
`/opt/delta-bot/watchdog.env`. **Срез #7 (3.50d): FIRST loses-to-both** —
vs as-is −1.71 / vs USDC −5.32 / vs SOL −0.14 (window contaminated by the outage).
Выдержка verdict: recenters tamed (~40/day, 22 filtered), clamp flapping NOT cured
(3 sell-low-buy-high round trips ≈ −1.2 USD in 6h). Operator kept выдержка at 5 мин.
**Campaign 2 baseline $372.69253481882396** (twice-adjusted; do NOT re-init).
Full story: progress.md Session 19, BUG-014, ADR-024.

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

## Jul 7 checklist — DONE (Session 19). Outcome summary

Executed 2026-07-07 morning, derailed-then-recovered by BUG-014 (see progress.md Session 19):
срез #7 done (first loses-to-both, −1.71 vs as-is); выдержка = half-win (recenters ~40/day,
clamp flap survives); campaign verdict = fees ≈ $9.7 vs $3,580 hedge churn + 4 incidents/4 days —
binding constraint is survivability + clamp churn, not parameters. Decisions taken: Helius
subscription upgraded; выдержка stays 5 мин; ntfy watchdog approved + installed (ADR-024).
**Still queued for the operator:** collateral ratio 0.5→0.33; fatter-fee pool switch (needs
simulator `--fee` flag); clamp-toggle dampening design; scaling 130→300+.
Next срез: watch that the 00:17Z cron row returns (it shares the bot's RPC key).

The original checklist follows for reference.

## Jul 7 checklist — ВЕРДИКТ дня (operator-approved plan; commands inline, no re-derivation needed)

**Regime timeline (compare windows, NEVER average across them):**
tight-band Jul 3 20:26Z→Jul 4 04:33Z → outage 04:33–10:45Z → wide-band live-input →
midpoint Jul 4 16:42Z → ADR-021 Jul 5 14:47Z → **whipsaw night** (38 recenters, 23 hedge trades) →
Jul 6: ADR-022 10:23Z (`7ebd0ac`) → hedge SELF-DISABLED 10:25–10:46Z (BUG-013 gap, LP unhedged) →
BUG-013 fix 10:46Z (`cb09b84`) → **ADR-023 выдержка live ~11:26Z (`0df7bf4`) = финальная машина**.
Post-11:26Z-Jul-6 rows are the cleanest signal — judge primarily on them.

### 1. Срез #7 + standing order

```bash
pnpm hodl          # локально; baseline $372.69253481882396 — НЕ переинициализировать
```
Then run the `strategy-analyzer` skill (standing order). Mandatory verdict-block format
(hodl-check SKILL.md). Reference points: срез #6 (Jul 6 08:17Z): vs as-is +1.09 / vs USDC −4.70 /
vs SOL +3.62; cron rows: Jul 5 00:17Z edge +1.12 @81.54, Jul 6 00:17Z edge −1.06 @81.53.

### 2. Did the выдержка work? (ADR-023 effect check, ~24h window)

```bash
# pnl.db + WAL (ALWAYS both) → scratchpad:
bash -c 'source deploy/hetzner/lib.sh; scp "${ssh_args[@]}" "${HETZNER_USER}@${HETZNER_HOST}:/opt/delta-bot/data/pnl.db*" <scratchpad>/'
sqlite3 pnl.db "SELECT count(*) FROM rebalances WHERE triggered_at >= '2026-07-06T11:26'"
sqlite3 pnl.db "SELECT action, count(*), round(sum(size_usd),2) FROM hedge_actions WHERE taken_at >= '2026-07-06T11:26' GROUP BY action"
# сколько пересозданий выдержка отфильтровала (события «сам рассосался»):
bash -c 'source deploy/hetzner/lib.sh; remote "cd /opt/delta-bot && docker compose logs --since 2026-07-06T11:26:00Z 2>&1 | grep -c \"recenter skipped\""'
```
Success criteria: recenters/day **< 40** (night was ~52); hedge trades in chop **≈ 0–2/day**
(night was 23); no 🚧 blocked-streak banners; netΔ in band in ≥95% of samples.
If the window filters too little/too much → `TREND_CONFIRM_MS` is one line in .env.

### 3. Campaign verdict (full window)

```bash
bash -c 'source deploy/hetzner/lib.sh; remote "cat /opt/delta-bot/data/hodl-history.jsonl"'
```
Only rows with `baselineCapturedAt: 2026-07-03T20:26:42.414Z` AND benchmarks referencing 372.69
(older rows reference 297.78/369.80 — re-derive or skip). Judge by the **as-is edge TREND per
regime**. Run BOTH standing analyzer tools (range-geometry, hedge-economics & idle-capital).

### 4. Operator decisions queue (approve/reject each; auto-scaling principle applies — no hand constants)

1. `HEDGE_TARGET_COLLATERAL_RATIO` 0.5 → 0.33 (ADR-016 allows 3×; frees ~$29 of the $86
   collateral; CHECK liq price stays ≥ 1.3× spot after the change).
2. Pool with fatter base fee: `pnpm find-pools` (bin-step 8–10, 0.1%+ SOL/USDC); switching =
   new campaign (baseline re-init) — decide consciously.
3. Rebalancing simulator — **operator pre-approved Jul 6 evening, in RUST** (ecosystem verified:
   Meteora dlmm-sdk repo ships Rust crates incl. `commons` = the on-chain bin/quote math;
   `jup-perps-client` on crates.io; official `jupiter-swap-api-client`). Build plan = tasks #6–8:
   (1) cargo workspace `simulator/` + bin math + golden tests vs real pnl.db positions;
   (2) strategy port with SHARED TEST VECTORS — hedgeController.test.ts cases exported to JSON,
   Rust must pass all 100 (no parallel TS simulator — one truth table, two executors);
   (3) authenticity gate: replay the real Jul 3–6 price path and reproduce the measured facts
   (38 recenters/night, $2.77 fees, $966 hedge churn, −2.2 USD/day like-for-like) within
   tolerance BEFORE any parameter grid-search is trusted. Full bot rewrite in Rust: deferred —
   the bot is I/O-bound; revisit after the simulator proves the crates.
4. If «machine earns» → scaling conversation (130→300+ USD; cap/collateral now auto-scale
   per ADR-022, but ratio & band choices deserve a look).

### 5. Health after three same-day deploys

RestartCount / cron row 00:17Z Jul 7 (baseline 372.69) / `data/hodl-cron.err` (only bigint
warnings) / wallet USDC level (was drained to ~$38 on Jul 6 — does it hamper recenters?) /
first ⏳ ADR-023 log lines look sane / no 🚧 banners.

Emergency commands if something looks wrong: `pnpm hedge:emergency --live` flattens ALL perp
positions at any price; `pnpm derisk --live` = red button (LP + perps + all SOL → USDC; stop the
server loop first); `ssh … docker compose down` stops the bot.

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
