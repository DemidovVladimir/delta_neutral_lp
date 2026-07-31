---
name: simulator
description: Run and interpret the Rust DLMM strategy simulator (simulator/) — backtest recenter/hedge parameters (bin count, выдержка/TREND_CONFIRM, band) on real Binance price paths, regenerate the shared hedge test vectors after hedgeController.ts changes, and respect the stage-3 authenticity gate. Use when the user asks to simulate, backtest, tune parameters, "прогони симулятор", compare выдержка settings, or verify the Rust port still matches the TS controller.
---

# DLMM Strategy Simulator (Rust, `simulator/`)

Backtests the WHOLE machine — Spot LP position with exact per-bin inventory,
recenters (0.92 threshold + ADR-023 выдержка + ADR-021 storm pause), and the
perp hedge (midpoint/clamp input, ADR-022 auto-cap, cooldown) — over real or
synthetic price paths. Built Jul 6 2026 (tasks #6–7); stage 3 (calibration
gate + parameter grid) is task #8.

## Commands (run from `simulator/`)

```bash
cargo test            # 17 tests: unit + golden (live on-chain fixtures) + 1027 shared vectors
cargo run --release -- --demo                                  # synthetic whipsaw, static position
cargo run --release -- --from 2026-07-05T14:47:00Z --hours 20  # real Binance SOLUSDC path, static position
cargo run --release -- --from 2026-07-05T14:47:00Z --hours 20 --strategy \
    [--confirm-min 5] [--bins 20] [--band 0.25] \
    [--bin-step 4] [--fee-bps 4]                               # FULL strategy loop; pool params for the
                                                               # pool-switch question (fee-bps also rescales
                                                               # arb_deadband to fee/2 — the calibrated ratio;
                                                               # --deadband-bps after it overrides)
    [--symbol HYPESOL]    # non-SOL/USDC pairs (Session 34): candles load ONLY
                          # from data/<SYMBOL>_1m_<startMs>_<endMs>.csv — no
                          # Binance fetch, missing cache = loud error. Build or
                          # extend caches with scripts/pair-candles.ts (the GT
                          # pipeline, A20 recipe made durable). NEVER write pair
                          # data under the SOLUSDC name — that was the Session
                          # 32/33 «poisoned cache» class, closed by this flag.
    [--target 0.6]        # HEDGE_TARGET_DELTA_SOL tilt (Jul 8): net SOL kept
                          # unhedged; must stay below total delta (sim never
                          # goes perp-long — watch the ⚠ unsupported counter).
                          # Two-month verdict: pure direction risk, net LOSER
                          # (+8.4 rally / −14.6 crash) — measurement dial, not
                          # an improvement. NEGATIVE target (over-short, the
                          # «cover IL with a bigger hedge» idea, tested Jul 9
                          # with --swap-skip --band 0.49): rally +6.29→−2.52
                          # (0.6) →−9.87 (1.2), crash +28.84→+38.14→+55.50 —
                          # first-order tilt cannot cover second-order IL, it
                          # doubles the loss on up-trends and pays extra carry.
                          # TRAP: do NOT sum this pair for tilt questions —
                          # the two months have a net DOWN drift (crash move
                          # bigger than rally move), so any short tilt "wins"
                          # the sum spuriously; delta-neutral comparisons
                          # cancel the drift, directional ones do not.
# Clamp dampening (Jul 7): the freeze is PRODUCTION since ADR-025 and the
# sim DEFAULT (clamp regime commits frozen while the recenter pipeline owns
# the imbalance, storms excepted; 65h: trades 13→1, churn 574→120 USD, edge
# +2.61→+2.98).
#   --no-clamp-freeze         pre-ADR-025 machine, reproduces +2.6052/13 trades exactly
#   --clamp-ramp 0.9          continuous midpoint→bag ramp — REJECTED (13→78 trades on 65h)
#   --exit-confirm-min 30     slow clamp exit — REJECTED (worse on 65h path)
# Risk-cap & governor probes (Jul 10, operator ideas from the Kamino review;
# both auto-actions REJECTED with numbers — BACKLOG A12/A13; flags kept):
#   --risk-engage-usd E [--risk-release-usd R]   discrete protective perp step
#                             on the hidden gap |LP live delta − hedge input|
#                             with USD hysteresis (R defaults to E/2). LOSES
#                             on all three reference windows incl. the crash
#                             month (its best case): edge-touches mostly
#                             revert → sells low, buys back higher each false
#                             episode; at 20-bin geometry the max gap (10
#                             bins' worth) is only 1.25× the 8-bin band, so
#                             loose thresholds simply never trade.
#   --governor-frac 0.5 --governor-days N        after N consecutive negative
#                             daily-Δequity samples, recenters redeposit only
#                             the fraction; first positive day restores.
#                             Requires --swap-skip. Crash −3.10 (downsizes
#                             into the recovery days — lagging signal),
#                             rally +0.30 (noise), whipsaw: never fires.
```

`--strategy` prints the ledger: `EDGE vs PARKED` (the go/no-go metric —
strategy equity minus staying parked; see the metric rule below),
`edge vs hold-as-is` (diagnostic only), LP fees,
perp fees, carry, swap/network costs, recenter count + how many the выдержка
skipped, perp churn, final netΔ. Defaults = production params as deployed
2026-07-07 incl. the ADR-025 clamp-commit freeze (`StrategyParams::default()`
in `src/strategy.rs`); NOTE the default `target_collateral_ratio: 0.5`
predates the production 0.33 (collateral only affects wallet-USDC pressure
in the sim, not the edge — update if simulating collateral starvation).
CAUTION: the pre-recorded grids in this file were run pre-ADR-025
(`--no-clamp-freeze` equivalent) — re-run baselines before comparing new
numbers against them.

Binance 1m candles are cached in `simulator/data/*.csv` (gitignored) — the
first run of a window needs network, repeats don't. Non-SOL/USDC pairs live
under their own symbol (`HYPESOL_1m_*.csv`, `PUMPSOL_*`, …) and are
cache-only; GT-derived files are recognizable by a normalized first close
(75.000000) or flat O=H=L=C gap-fill rows. Sub-windows of a master file must
be sliced into exact-key files (python one-liner or pair-candles) — the sim
never reads partial ranges.

## Canonical frames & the money metric (Session 34, 2026-07-20)

**Metric rule (operator priority = прибыль в долларах).** Three numbers, and
mixing them up has cost us a wrong entry recommendation once already:

1. **`EDGE vs PARKED` — THE go/no-go metric (added 2026-07-31).** Strategy
   equity minus the REAL alternative: the same bag sitting in the wallet,
   hedged flat by one short held all window, paying carry and nothing else.
   Enter only when this is positive BY A MARGIN.
2. **`edge vs hold-as-is` — DIAGNOSTIC ONLY. Never a criterion.** Its
   baseline is UNHEDGED (`hold_as_is_end` = the starting mix marked to the
   end price), so on any falling window it credits the machine with the
   hedge's entire gain — work the parked wallet does too, for free. On
   2026-07-28 this read **+4.99** and «passed» a +2 bar while the machine
   actually LOST 1.28 USD over the week; the parked alternative cost only
   0.19. As written it green-lights entry on any falling week. Historical
   grids in this file quote it — treat those numbers as unusable for go/no-go.
3. **ABSOLUTE Δequity** (`equity: X → Y`) — the honest USD result of the run
   itself. For the hedged SOL/USDC machine abs IS the live USD result (the
   sim short cancels price drift internally). Use it for parameter search on
   the same path; use #1 to decide whether to run the machine at all.

For the
hedged SOL/USDC machine abs IS the live USD result (the sim short cancels
price drift internally). For X/SOL constructions run `--band 99` (no perp in
sim): abs ≈ the live срез USD number — the real SOL short only converts
SOL-metric → USD (subtract carry ≈ 0.23 USD/мес); HYPE-vs-SOL basis stays in
abs, and NO parameter removes it (Session 34: the whole bins/confirm/reentry
grid moves abs by ~1–2 USD/мес while basis swings ±20 — pair choice, not
tuning, decides the USD sign). `--band 0.49` = fictional pair perp: clean
mechanics only (fees − IL − costs), never a live frame for pairs (A19).

**Canonical frames (verbatim; add `--from/--hours`):**
- live A23 HYPE construction: `--symbol HYPESOL --strategy --swap-skip
  --bin-step 20 --fee-bps 12.5 --confirm-min 10 --bins 20 --band 99
  --reentry-min 120 --reentry-tol 0.20 --lp-value 148 --idle-sol 0
  --wallet-usdc 0`
- campaign SOL/USDC machine (retired, regime watch): same minus `--symbol`,
  with `--bin-step 10 --fee-bps 6.5 --deadband-bps 5 --band 0.25
  --idle-sol 0.8 --wallet-usdc 41`
- pair screen (A20 recipe): GeckoTerminal top DLMM pools
  (`/networks/solana/dexes/meteora/pools?sort=h24_volume_usd_desc`) → filter
  X/SOL → on-chain `binStep`/`baseFactor` (LbPair u16 @ offsets 80 / 8;
  baseFee = bf×step×1e-8) → `npx tsx scripts/pair-candles.ts --pool <addr>
  --from <ISO> --to <ISO> --normalize 75 --out
  simulator/data/<SYM>_1m_<fromMs>_<toMs>.csv` → run clean (band 0.49) +
  live (band 99) on the SAME window as HYPE/SOLUSDC references. Fees always
  D2-pessimistic = raw × 0.625.

**Masters registry:** `HYPESOL_1m_1781697600000_1784577600000.csv` = HYPE/SOL
Jun 17 12:00Z → Jul 20 20:00Z (splice k=75.904171, GT pool
`81GpCm4d13y8TozYtThabuSCLQN2o3bbrvDogXFPn8sA`). Extend forward with
`pair-candles.ts --splice <master> --from <master-end> --to <now floor 1m>`,
then `cat` master+segment into the new-key master. Validation anchor
(срез #2, 37h): 0 recenters exact, LP fees sim 0.90 vs real 1.00 (−10%),
abs +1.08 vs honest +0.74 (gap = carry 0.03 + one-time collateral 0.11 +
oracle noise) — the frame tracks the live срез.

## Session 34 results (fresh grids to Jul 20 20:00Z — supersede stale runs)

Frame A, HYPE param grid (edge / abs per window; base = live params):
- base b20-c10: месяц −1.97/−19.17, неделя −2.28/−7.69, срез49h +1.06/+1.80,
  full-master 800h −0.94/−19.29
- **bins 28 (c10): месяц −1.86/−19.03, неделя −2.12/−7.52, срез +0.76/+1.50,
  800h +0.99/−17.33 — THIRD independent confirmation (Sessions 32, 33, 34):
  better on every multi-week frame, cost ≈ −20–30% fees on quiet windows.
  APPLIED live 2026-07-20 (operator order): hype instance
  AUTO_TUNE_BIN_COUNT=28, takes effect at the next recenter — the live A23
  frame becomes `--bins 28` once the first 28-bin position exists.**
- b28-c5 / bins32: strong on some windows (b32 месяц −0.84), never robust on
  all — jagged within noise, no overfit chase. reentry-min 240: месяц winner
  (+5.12) / неделя loser — regime trap RE-confirmed. tol 0.10 parks 61% out.
  storm-pct 1.5/3: zero effect (0 storms in the calm window).

Frame B, SOL/USDC fresh windows (hedged abs = USD): band 0.25 месяц +0.54,
неделя +1.94, 336h −2.14, срез49h +0.94; band 0.49≈0.62 everywhere ≥ 0.25
(perp trades −25%, месяц +1.71) — pro-wide confirmed again. Unhedged
band 99 = direction lottery (месяц abs +22.78 = SOL rally, not edge).
Regime: 31 recenters/мес, 0 storms vs historical ~4.5/day — the calm that
flatters the campaign persists ≥ a month; Session-33 verdict (no return)
still stands on the month head-to-head, re-open only on a week+ window.

Frame C, pair survey 336h same-calendar (Jul 6 → Jul 20, clean / live-abs):
- SOLUSDC 10/6.5: +4.63 / +1.04·unhedged (hedged −2.14) — only basis-free ≈0
- HYPE 20/12.5: +4.21 / −8.47 (basis slide; bins28: −0.44 edge, −8.30 abs)
- JUP/SOL 80/9.4 b10: +6.34 / −10.73 — mechanically POSITIVE and calm
  (6 recenters, 4.8% out), but JUP basis unhedgeable, slid −14%/2wk
- PUMP 20/12.5: −28.83 / +15.36 — fresh data REJECTS (was «borderline» A20)
- MET/SOL 20/12.5: −8.03 / −16.54 reject; USELESS/SOL: +7.15·82%-parked /
  −41.25 reject; Jimothy/SOL 50/31: permanent storm (745 pauses/2wk),
  wait-bag momentum lottery (abs +452 on a +263% pump) = ANSEM-class reject
  + survivor bias (sampled BECAUSE it pumped).
- HYPE alt pool step4/fee0.04% `6oQ9wVex4mKZti2GsGCfD8FWTMMC9PLQkztRU5cd6MK8`:
  pool-wide fee density 0.265%/день vs ours 0.090%, BUT mechanically −5.14
  clean vs +4.21 (fees 2.11 vs 8.78/2wk) — the A24 pattern: sim can't see
  venue flow, and even ×3 density doesn't cover the ×4 thinner tier. Reject
  without a live tx/h measurement (scripts/pool-activity.ts).
- Old SOL/USDC pool 5rCf1DM8LjKTw4YqhnoLcngyZYeNnQqztScTogYHAS6 fee density
  flipped ABOVE the campaign pool (0.34 vs 0.21 %/день pool-wide, GT
  vol24h × baseFee / TVL) — A18's ×1.59 advantage is GONE; if SOL/USDC ever
  re-opens, re-measure the venue first.

Bottom line (USD, 148 USD LP): every construction ≈ 0 ± regime luck; the
only data-backed change on the table is bins 20 → 28 on the hype instance.

## The three-layer verification (why this simulator can be trusted)

1. **Bin math & position mechanics** — golden tests (`tests/golden.rs`)
   pinned to REAL Campaign-2 on-chain snapshots: three live compositions
   reproduce to <0.75 pp; full-traversal IL = V·w/8 matches the measured
   average.
2. **Decision logic** — `src/hedge.rs` is a port of the production
   `src/modules/hedgeController.ts`; `tests/vectors.rs` replays 1027
   (input → decision) pairs GENERATED BY THE PRODUCTION TS CODE.
   **TypeScript is the source of truth — it trades real money.** After ANY
   `hedgeController.ts` change: `npx tsx scripts/export-hedge-vectors.ts`
   (repo root), then fix the Rust port until `cargo test` is green. Never
   adjust vectors to fit Rust.
3. **Whole-system replay vs reality** — the stage-3 authenticity gate
   (task #8): replay the real Jul 3–6 window and reproduce pnl.db facts
   before trusting any parameter search.

## Authenticity gate — status: PASSED 2026-07-06 (stage 3), one caveat

Calibration added two PHYSICAL mechanisms (no fudge factors): the pool
follows the exchange price lazily (`arb_deadband`, fitted 2 bps ≈ arb
profitability threshold) and a recenter executes 1 tick after confirmation
(`recenter_latency_ticks` — the real bot needs 7–15s; in that gap the 98%
clamp engages, which is where the real perp churn came from).

Fit window (Jul 5–6 whipsaw night, confirm=0): fees 2.84 vs 2.67 real
(+6%), recenters 32 vs 38 (−16%), per-trade size 44 vs 42 USD, edge same
sign/magnitude. **OUT-OF-SAMPLE validation** (Jul 6 day window, confirm=5,
never seen during fitting): recenters **10/10 exact**, perp trades **7/7
exact**, churn +5%, fees +11%.

**Caveat:** perp trade COUNT on the fit window is −35% (15 vs 23) because
`idle_wallet_sol` is a constant while the real wallet balance swung ±0.5
SOL. Consequence: configs that generate hedge churn (narrow bins, tight
bands) are penalized LESS than reality — pro-wide/pro-slow conclusions are
conservative, pro-narrow/pro-tight ones need extra scrutiny. Absolute
dollars carry ~±10% model bias; treat edge differences under ~1 USD/3days
between configs as ties.

First sanctioned grid (bins × confirm, real 65h campaign path, recorded
2026-07-06): confirm ≥5m beats confirm=0 at EVERY bin count (monotone);
bins=10 is catastrophic (edge −17.6 at confirm=0, 364 recenters); top tier
within noise: bins20/confirm10 (+4.07), bins40/confirm10 (+4.59),
bins40/confirm5 (+3.78), bins30/confirm3 (+3.51) — vs deployed
bins20/confirm5 (+2.61). Widening beyond 20 bins interacts with the
pool-switch decision (different bin step / base fee — simulate with
--bin-step/--fee-bps).

Pool grid (Jul 7, 65h campaign path, deadband extrapolated = fee/2):
every fat-fee config beat prod (4bps/20bins = +2.61). Conservative winner
**step 10 bps / fee 10 bps / 20 bins (2% width): +5.98, recenters 50→12,
perp trades 13→1** (pro-wide/pro-slow = the trustworthy direction);
step20/fee20/bins4 scored +6.60 but is pro-narrow (54 recenters, 28
trades) — do not trust without extra scrutiny. CAVEAT: fee model counts
only our own bin-sweep conversions; the deadband=fee/2 scaling is an
extrapolation validated only at 4 bps.

CONTROL month (May 8 → Jun 8, SOL 88.43 → 66.40 = −25% crash): prod config
+42.62 vs hold-as-is (insurance paying; absolute equity still POSITIVE
+1.74 through the crash). Improvement candidates on BOTH months:
step20/fee20/bins10 (same 2% width, same recenter cadence) wins BOTH
(+11.3 and +13.0 over prod → BACKLOG A9, gated on D2 recalibration; live
pool BVRbyLjjfSBcoyiYFuxbgKYnWuiFaF9CSXEa5vdSZ9Hh); band 0.5 wins both
slightly (+1.5/+1.1, trades 18→6/17→2); confirm 30/60 loses (clamp trades
while parked out of range); --target tilt is symmetric direction risk,
net negative over the pair.

MONTH grid (Jul 8, post-ADR-025 defaults, Jun 8 → Jul 8 path = +21% rally
month, SOL 66.49 → 80.50, pool 10/10): ALL configs negative vs hold-as-is —
the rally week Jun 29 → Jul 6 (edge −12.13) dominates; the weekly split
shows the machine WINS in chop (+4.03, +1.04, +3.73 per 48h) and pays for
neutrality in trends. Best of the 3×3 grid = deployed bins20/confirm5
(−10.64); confirm 0 is far worse everywhere (−26.8 at 20 bins); wider bins
lose fees faster than they save costs on this path (bins40/confirm5
−19.48). Old pool 4/4 on the same month: −54.80 (pool switch confirmed,
≈44 USD/month). `--no-clamp-freeze` on the month: −12.77 with 118 perp
trades vs 18 (ADR-025 freeze confirmed, +2.13/month). Band 0.5 vs 0.25:
−9.11 vs −10.64, trades 18 → 6 — inside month-level noise but pro-wide
(the trustworthy direction); candidate at scaling time. Trend-shrink:
REJECTED on this month (BACKLOG A7). Absolute dollars: remember BACKLOG
D2 — fee income at 10 bps runs ~50% above reality; relative comparisons
on the same path stay valid.

## Interpretation rules

- `edge vs hold-as-is` is comparable to the срез verdict block's SECOND line
  (vs «ничего не делать») — and carries the same caveat there: subtract the
  mechanical hedge-protection term before reading it as skill. The срез
  главное число (vs HODL-USDC) has no direct sim twin; `EDGE vs PARKED` is
  the closest and is what decides go/no-go.
- Compare parameter sets on the SAME path (cache guarantees identical
  candles). Sweep example: `for m in 0 3 5 10; do cargo run --release -q --
  --from ... --hours 24 --strategy --confirm-min $m; done`.
- Synthetic paths (`--demo`) are for mechanics smoke only — NEVER for
  strategy conclusions (a sine wave reverses exactly at range edges and
  flatters instant recentering; real chop does not — measured Jul 6:
  выдержка 5m won +2.3 USD/night on the real path while losing on the
  synthetic one).
- `⚠ unsupported long decisions` > 0 in output = the replay wandered into
  perp-long territory the sim does not execute (target≠0 scenarios) —
  results invalid, extend `strategy.rs` first.

## Gotchas

- zsh does NOT word-split unquoted `$VAR` — `FLAGS="--a 1 --b 2"; cargo run
  -- $FLAGS` passes ONE argument and the flags are SILENTLY ignored (bitten
  twice on Jul 8; symptom: variant output identical to baseline to the
  cent). Write flags out explicitly in Bash tool calls.
- `auto_notional_cap_usd`'s 4th arg is `absolute_cap_usd` (the optional
  MAX_HEDGE_NOTIONAL_USD ceiling), NOT |target|. |target| belongs in the
  bag (1st arg, per ADR-022). Passing a small number as the 4th arg
  silently disables the whole hedge (sub-dollar ceiling, 0 trades).
- Fixtures are `.jsonl`, NOT `.json` — the repo `.gitignore` excludes
  `*.json` (the Jupiter IDL trap); keep it that way.
- The bot's logged position ranges span 18–20 bin steps for a "20-bin"
  position (boundary-vs-center convention at creation) — golden tests infer
  the span from each range's own bounds; the stage-3 replay must pin the
  convention before absolute-fee calibration.
- `simulator/target/` and `simulator/data/` are gitignored; `deploy.sh`
  rsync excludes `target` — the simulator never ships to the Hetzner box.
- The idle-wallet SOL is a constant param (`idle_wallet_sol`) ONLY in the
  legacy always-swap model. Since Jul 9 (A10) `--swap-skip` turns on the
  PRODUCTION swapPlanner model: dynamic wallet, recenter deposits that fit
  the wallet skip the alignment swap and shuttle SOL wallet↔LP, and the
  hedge re-trades the step one tick later. Extra flags: `--idle-sol`,
  `--wallet-usdc`, `--lp-value` set the starting state. This CLOSED the
  stage-3 «perp trade count −35%» caveat: live-window replay (Jul 7
  13:47Z → Jul 9, 42h, pool 10/10, `--swap-skip --band 0.25 --idle-sol
  0.85 --wallet-usdc 100`) gives recenters 12 vs 14 real, machine trades
  9 vs 10, churn 456 vs 478 USD, alignment swaps 5 vs 5 exact; LP fees
  +49% (D2 fee optimism reconfirmed). A10 grid (both reference months,
  LP 95 / USDC 180 / idle 0): forcing the swap LOSES on both months
  (spot ~10 bps > perp 6 bps); band 0.62 ties band 0.49; recorded in
  BACKLOG A10. Pre-recorded grids in this file ran the LEGACY model —
  do not mix their absolute numbers with `--swap-skip` runs.
