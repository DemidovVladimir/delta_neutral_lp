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

`--strategy` prints the ledger: `EDGE vs hold-as-is` (the срез metric —
strategy equity minus doing nothing with the same starting mix), LP fees,
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
first run of a window needs network, repeats don't.

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

- `EDGE vs hold-as-is` is directly comparable to the срез verdict block's
  главное число (fees − IL − costs vs doing nothing).
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
