# BACKLOG — implementation-ready specs & analysis recipes

**Purpose (operator order, 2026-07-08):** after 2026-07-12 this project may be
operated by a less capable model. Everything non-obvious must be written down
so routine work is MECHANICAL: follow the recipe, don't improvise. Read this
file together with `HANDOVER.md` (current state), `CLAUDE.md` (commands +
gotchas), `.claude/skills/*` (procedures), `bugs.md` / `decisions.md`
(history). Operator communication rules live in the memory files
(plain Russian, RULE #1 step-by-step numbers, no jargon — READ THEM FIRST).

Rules of engagement for ANY item below:
- Live mutations / deploys / .env changes / baseline changes: ONLY with the
  operator's explicit «да» in the conversation. Dry-run and read-only work
  needs no approval.
- After every code change: `npx tsc --noEmit` + `npx vitest run` (NOT
  `pnpm test` — that's watch mode and never exits). For simulator changes:
  `cd simulator && cargo test --release`. After `hedgeController.ts`
  changes additionally: `npx tsx scripts/export-hedge-vectors.ts`, then fix
  the Rust port until `cargo test` is green (TS is the source of truth).
- After every deploy: verify server `STRATEGY_VERSION` = local HEAD,
  container `restarts=0`, first cycles in band, `watchdog.env` still present
  (BUG-016), persistent log advancing.
- Every срез: the MANDATORY verification block in
  `.claude/skills/hodl-check/SKILL.md` — no exceptions, no summaries without
  the data.

---

## A. Open code items (ordered by value)

### A1. Deploy the VITALS latch (READY — built 2026-07-08, commit `52a2b12`)
Status: implemented + unit-tested, NOT yet deployed. All six engine vitals
now fire once per episode and log `✅ VITALS recovered` on release (gap
levels: notional 1.1×/1.0×, churn 3×/2.7×, liq 1.25/1.30, reserves ×1.0/×1.1,
feeburn 0.05/0.045 SOL). Deploy = operator runs `pnpm deploy:hetzner`, then
verify per the rules above. Post-deploy watch: the first real episode should
produce exactly ONE 🚨 push and one ✅ line in `data/logs/bot.log`.

### A2. Collateral starvation guard (BUG-013 family) — PREVENTION SHIPPED 2026-07-13 (BUG-020); controller-side recovery still DESIGN
**2026-07-13 (Session 25): the starvation materialized** — the 02:05Z
recenter deposit consumed wallet USDC to 7.47, the follow-up increase_short
filled 0.296 of 0.599 SOL, wallet ended at 0 USDC (BUG-020 in bugs.md).
**Prevention layer SHIPPED (operator-approved, deploy pending):**
`planSwapForDeposit` now reserves `0.5 × deposit value ×
HEDGE_TARGET_COLLATERAL_RATIO` of wallet USDC (`reserveUsdc` — the
proportional rule below applied at the exact moment it matters, the
alignment-swap sizing), live+non-dry only, all three call sites. The
controller-side RECOVERY guard below (partial decrease to free collateral
when already starved) remains open design — still useful for starvation
paths that bypass recenters (e.g. a storm-clamp jump with a dry wallet).
**Problem:** shorts post USDC collateral. Recenters + collateral posts drain
wallet USDC (2026-07-08 morning: $6.37 left). When the controller wants
`increase_short` and USDC < size×ratio, it blocks (`blocked_reason:
collateral`) — netΔ can sit out of band for hours (BUG-012 was 5.5h).
**Existing mitigations:** blocked-streak VITALS alert (pushes after ~10 min);
manual fixes in the alert-response runbook (unwrap wSOL / partial short
decrease / operator top-up).
**Proposed auto-guard (implement in `hedgeController.ts` — pure, then
vectors):** when action=increase_short is blocked ONLY by collateral AND
`|error| > 2×band` (genuinely unhedged, not boundary noise), emit a new
decision `decrease_short` of the MINIMUM size that frees enough collateral
for the remainder — a partial decrease RETURNS collateral at the blended
ratio, so a small controlled decrease unblocks the increase next cycle.
Guards: never on cooldown, never below min position, one per N cycles.
**Verification:** table-driven tests in `hedgeController.test.ts` (blocked →
partial-decrease path), vectors regenerated, simulator replay of the Jul-8
falling night with `wallet_usdc_start: 6` shows netΔ returning to band.
**Alternative (simpler, zero code) — PROPORTIONAL rule (operator 2026-07-08:
«я не люблю статические цифры»):** keep idle wallet USDC ≥
`HEDGE_TARGET_COLLATERAL_RATIO × LP full value in USD` (≈ 0.33 × 96 ≈ $32
today). Derivation: the largest single hedge increase the machine generates
is ~half the LP value (a below-range recenter dumps the SOL half into the
wallet; the storm clamp jump is the same magnitude), needing
`ratio × value/2` of collateral — the rule covers TWO back-to-back events.
Scales automatically with position size and the ratio. Documented as a
norm in §C4; check it in every срез.

### A3. RPC-budget awareness (BUG-014 residual) — DESIGN
**Problem:** Helius `429 {"code":-32429,"message":"max usage reached"}` means
the PLAN'S CREDITS ARE GONE — retries are useless, but the loop's 5-error
kill switch + Docker restart policy turn it into a crash loop (15h outage
Jul 6-7). The hodl cron shares the same key and dies silently with it.
**Spec:** in the RPC error path (search `max usage reached` in
`src/utils/solana.ts` / wherever the connection wrapper lives), classify
this error distinctly; on detection: log
`🚨 VITALS BREACH — RPC credits exhausted (BUG-014)` (the watchdog will push
it), STOP the retry loop (sleep 10 min between probes instead of hammering),
and keep the process alive (a crash-looping container looks the same as a
dead one to the operator). Read-only fallback for CLIs already exists
(`RPC_URL=https://api.mainnet-beta.solana.com`).
**Verification:** unit test the classifier; manual test by pointing RPC_URL
at a mock returning the 429 body.

### A4. ESLint 9 migration (mechanical, 20 min)
`pnpm lint` is broken: ESLint 9.39.4 requires `eslint.config.js`, repo has
legacy config only. Steps: `npx @eslint/migrate-config .eslintrc.json`
(or whatever legacy file exists — check repo root), commit the generated
`eslint.config.js`, run `pnpm lint`, fix or explicitly ignore findings (do
NOT auto-fix en masse — review each). Low value, do in idle time.

### A5. Recenter-rate vitals → latch — DONE 2026-07-08
`autoTuneOrchestrator.ts`: converted to the shared `VitalsLatch` (fire > 12
recenters/6h, release < 9/6h, 10-min throttle backstop), `vitalsWatch`
wrapper mirrors `jupiterPerpsEngine.ts`. The latch is evaluated EVERY cycle
(not only on recenter success) so the ✅ release fires even when
recentering stops entirely.

### A6. Watchdog: push ✅ recovered lines — DONE 2026-07-08
`deploy/hetzner/watchdog.sh` (repo copy, cron runs it): second grep for
`VITALS recovered`, pushed at ntfy priority `low`, deduped via a
`recovered=` line in `data/watchdog.state` (the 10m log window overlaps two
5-min cron runs). Informational — never touches the bad/ok state machine.

### A7. Trend-shrink production port — REJECTED 2026-07-08, do not revisit
The mechanism is built in the simulator (`--trend-streak`, `--trend-frac`,
`--trend-calm-min`; commit `856d735`). First verdict on 4 real windows was
TIE. **Month-long re-test (Jun 8 → Jul 8 Binance path, +21% rally month,
pool 10/10, prod params) REJECTED it decisively**: with the C3 recipe
(streak 2 / frac 0.5 / calm 60m) edge worsened on the FULL month (−15.95
vs −10.64 baseline) and on EVERY week individually, including the rally
week it was designed for (−14.99 vs −12.13). Cause: each shrink/restore is
a full recenter with swap costs, and perp trades exploded 18 → 88 ($654 →
$2087 churn). More aggressive settings (streak 1 / frac 0.1) are worse
still (−17.11, 97 trades). The C3 episode-accumulation protocol is
superseded by this month test — do NOT port; keep delta-neutral (operator
explicitly rejected directional bets 2026-07-08).

### A9. Pool-switch candidate: step 20 / fee 0.2% — REJECTED/FROZEN 2026-07-10 (target pool is dead on-chain)
**2026-07-10 (Session 24) verdict: the sim keeps liking it, the CHAIN kills
it.** Re-run in the production `--swap-skip` mode (both reference months,
LP 95 / USDC 180 / idle 0, band 0.49): crash month +43.94 vs prod +28.84,
rally month +19.15 vs prod +6.29 — direction confirmed again. BUT the live
pool check the same hour (`npx tsx scripts/pool-activity.ts
BVRbyLjjfSBcoyiYFuxbgKYnWuiFaF9CSXEa5vdSZ9Hh`) shows **36 successful tx/h
with 693 of the last 1000 signatures FAILED (69%)**, pool price lagging
$79.2248 vs $79.2829, while our pool `BGm1tav58oGcsQJehL9WXBFXF7D27vZsKefj4xJKD5Y`
does **34,527 successful tx/h**. LP fees are paid by OTHER PEOPLE'S flow
through our bins; the sim's fee model assumes arbs keep the pool at par —
at 36 tx/h that flow does not exist and the simulated fee income there is
fiction. FROZEN until that pool (or another fat-fee SOL/USDC pool) shows
real volume; recheck with pool-activity.ts before ever re-opening. Original
Jul-8 evidence kept below for context.

Two-month sim evidence (Jul 8, post-ADR-025 defaults, same paths as the
month grids): step20/fee20/bins10 (same 2% width, same ~8 recenters/day as
prod) beats prod 10/10/bins20 on BOTH regimes — rally month +0.70 vs
−10.64, crash month +55.64 vs +42.62 — ≈ +12 USD/month on the ~245 sim
portfolio. Live target pool found and verified active Jul 8:
`BVRbyLjjfSBcoyiYFuxbgKYnWuiFaF9CSXEa5vdSZ9Hh` (SOL/USDC, binStep=20,
baseFee=0.2%, 62 successful tx/h, fresh price; current pool does 525
tx/h). bins4 scores similar but runs 819–913 recenters/month (pro-narrow —
distrust per D1). GATE: the fee model at fat fees is D2-extrapolated
(sim already +50% optimistic at 10 bps).

### A10. Recenter rebalancing venue: swap-skip shuttle — DECIDED 2026-07-09 (keep it; option c)
Found during the Jul-9 churn VITALS incident (progress.md session 23).
Mechanism: with a fat idle-USDC buffer (~$180, left by the Jul-8 operator
swap pair), most recenter deposits "fit without a swap" (swapPlanner
post-scale check) and shuttle ~0.61 SOL between wallet and LP. The hedge
counts wallet SOL live (ADR-021) but the LP at midpoint (ADR-019), so each
shuttle steps the hedge input by ~half the deposit and the perp re-trades
~$43 one cycle after the recenter. Verified control: recenters that DO
swap produce NO hedge trade (Jul-8 08:24Z).
**Simulator verdict (Jul 9, `--swap-skip` mode added — dynamic wallet +
swapPlanner port; two reference months, pool 10/10, LP 95 / USDC 180 /
idle 0):**
- (a) force the alignment swap: REJECTED — loses on BOTH months
  (rally +4.97 vs +6.29, crash +18.24 vs +28.84 at band 0.49). The spot
  swap (~10 bps fee+impact) is strictly dearer than the perp leg (6 bps);
  the shuttle is the CHEAPER rebalancing venue, ~+2–10 USD/month.
- (b) band ≥10 bins (0.62): TIE with 8 bins over the two months
  (+35.89 vs +35.13 summed — under the noise threshold), halves trade
  count (125→70) but doubles the un-hedged residual (netΔ end ±0.55).
  Not worth a change; 8 bins (deployed 2026-07-09) stays.
- (c) accept + recalibrate the churn norm: ACCEPTED — C4 updated; at
  band 8 bins expect ~1–3 recenter-follow trades/day, churn well under
  the 3× latch on calm days.
Live-window validation of the new mode (Jul 7 13:47 → Jul 9, 42h):
recenters 12 vs 14 real, machine trades 9 vs 10, machine churn 456 vs
478 USD, alignment swaps 5 vs 5 EXACT, LP fees +49% (the known D2 fee
optimism, reconfirmed) — the stage-3 «perp trade count −35%» caveat is
CLOSED when running `--swap-skip`. Residual ops note: wallet SOL can
drift below reserve after consecutive top-exit recenters (self-heals on
a bottom-exit; ~0.1 SOL manual top-up silences the latch early). Since
`26e9319` (BUG-018 fix, 2026-07-10) the planner budgets the position rent,
so swap-assisted recenters land AT the floor instead of ~0.044 below it.

### A11. Выдержка (TREND_CONFIRM_MS) 5 → 10 мин — DEPLOYED 2026-07-10 (operator choice)
Sim signal: confirm-10 beat confirm-5 on BOTH reference months in the
production `--swap-skip` mode (crash +31.64 vs +28.84, rally +8.06 vs
+6.29) — consistent direction, but +1.8–2.8 sim-USD/month is UNDER the
~10 USD/month noise threshold (D2); also top-tier in the pre-ADR-025 Jul-6
grid (bins20/confirm10 +4.07 vs +2.61 on 65h). Mechanism: fewer recenters
(186 vs 239 crash / 214 vs 250 rally) and less churn (crash $1170 vs
$2027); storms bypass the выдержка so crash reaction stays immediate.
Offered as «решить 14 июля»; operator chose «переключить сейчас» →
`TREND_CONFIRM_MS=600000` live since 2026-07-10 ~09:58Z (deploy `26e9319`).
NOTE for the weekly verdict: the live week now mixes two выдержка regimes —
split any recenter-cadence comparison at 2026-07-10T09:58Z.

### A12. Protective step on the hidden live-vs-midpoint gap — TESTED & REJECTED 2026-07-10
Operator proposal (after the Kamino review): the midpoint hedge leaves a
hidden gap = LP live delta − hedge input (up to ~half LP value ≈ 48 USD at
a range edge); add a discrete protective perp step with dollar hysteresis
(engage/release) when it grows. Built into the simulator
(`--risk-engage-usd E --risk-release-usd R`, release defaults E/2) and run
on the three reference windows (prod config, swap-skip, LP 95/USDC
180/idle 0):

| window | baseline | 20/10 | 30/15 | 45/22 |
|---|---|---|---|---|
| crash month −25% | +28.84 | +24.96 | +21.78 | +27.27 |
| rally month +21% | +6.29 | +0.52 | — | +6.29 (0 сраб.) |
| whipsaw 65h | +2.98 | +2.54 | — | +2.98 (0 сраб.) |

LOSES at every threshold on every regime — including the crash month, its
best case. Mechanism: edge-touches mostly revert → the step sells low and
buys back higher (~0.3–0.5 USD per false episode, dozens/month at tight
thresholds); genuinely dangerous continuations are already owned by the
storm pause + ADR-021 clamp + recenter. Structural note: at 20-bin
geometry the max hidden gap (10 bins' worth) is only 1.25× the band
(8 bins) — there is almost no room between «noise we deliberately
tolerate» and «max possible gap». Flags stay in the simulator for
re-tests at other geometries (wider positions raise the ceiling).

### A13. Profitability governor — auto-action REJECTED 2026-07-10; daily-PnL табло OPEN
Same session, same proposal batch. (a) AUTO-ACTION (sample daily Δequity;
after N consecutive negative days redeposit only 50% at recenters, restore
on the first positive day) — built (`--governor-frac 0.5 --governor-days
N`, requires --swap-skip) and run: crash month +25.74 vs baseline +28.84
(−3.10; the lagging-signal trap: it downsizes into the post-drawdown
recovery days where the machine earns), rally +6.59 vs +6.29 (noise),
whipsaw: never fired. 3-day variant no better (crash −2.98). REJECTED as
an actuator. (b) THE ТАБЛО IS BUILT & DEPLOYED (operator «Да, делай
табло», same day): the watchdog 08:05Z heartbeat now appends «за сутки:
±X USD» = Δ equityUsd between the last two 00:17Z hodl-history.jsonl
rows; when the older row belongs to another campaign (baselineCapturedAt
differs) it diffs against `hodl-baseline.json` instead and labels the
window «за Nч» — so the first morning after a campaign restart already
shows a number. Field-tested on the server against real rows (three
cases incl. the campaign-boundary fallback). KNOWN LIMIT (accepted): a
manual mid-campaign withdrawal shows as that day's «loss» (baseline
adjustments keep their capturedAt) — the срез procedure owns that case,
the табло does not.

### A14. External dead-man monitor (host-death blind spot) — CODE SHIPPED 2026-07-13, WAITING ON OPERATOR PING URL
**Incident:** Hetzner VM rebooted 2026-07-12 19:50:42→20:32:59Z (42 min
down, no clean-shutdown record in `last -x` — host-level event). ZERO
alerts: the watchdog + all its push channels live on the same VM. The only
detection today is a missing 08:05Z 💚 (up to ~12h blind).
**Shipped (Session 25, operator «настроить сейчас»):** `watchdog.sh` runs
`deadman_ping()` at the end of every */5 and heartbeat run — a
`curl -fsS -m 10 --retry 3` to `WATCHDOG_PING_URL` from server-side
`/opt/delta-bot/watchdog.env`. No-op while the var is unset. The EXTERNAL
service alerts when pings stop, covering host death, cron death, and
watchdog death in one signal.
**Operator TODO:** create a free healthchecks.io check (period 5 min, grace
5–10 min, alert to email/Telegram), then append
`WATCHDOG_PING_URL=https://hc-ping.com/<uuid>` to
`/opt/delta-bot/watchdog.env` (server-only secrets file, rsync-excluded —
BUG-016). Verify: the check turns green within 5 min; `docker` not needed.

### A15. «Выдержка на вход» (re-entry confirm) — BUILT & APPROVED 2026-07-13 (ADR-026), deploy pending
**STATUS UPDATE (same day, operator «Строить сейчас»):** production
implementation DONE — pure core `src/modules/reentryGate.ts` (11 tests),
orchestrator wait state persisted in `AutoTuneState.reentryWait`
(restart-safe; gates auto-create; self-heals when a position appears
on-chain; hedge runs on the wallet-only input throughout — no BUG-011
grace deferral; storms extend the wait). Env: `REENTRY_CONFIRM_MS=7200000`
+ `REENTRY_TOL_FRAC=0.15` set in .env — **goes live on the next
`pnpm deploy:hetzner`**; rollback = set 0 + redeploy (a wait in progress
opens next cycle). Field checks after the first triggered recenter:
(1) «⏸ Выдержка на вход: позиция ЗАКРЫТА» line, netΔ stays in band while
waiting (wallet bag hedged); (2) «▶️ … пересоздаём позицию» only after
120 min of calm; (3) recenter rate should DROP in saws/trends; (4) fees
will drop too — judge by vs-USDC trend, not fee pace (C4 norm does not
apply while out of pool). Original sim evidence below.
**Idea (Session 25, after срез #1's 13-traversal saw):** the storm pause
only sees FAST moves (2%/5min); slow saws and trends — the actual killers —
sail under it. New mechanism: after a recenter CLOSES the old position,
do NOT open the new one; park the inventory in the wallet (ADR-021 keeps it
hedged/neutral), and open only once the price has stayed within
±(0.15 × range width) of an anchor for 120 min. The anchor resets on every
breakout — a running trend keeps the machine out of the pool until it
pauses. Auto-scales with geometry (no hand constants).
**Simulator evidence (built + committed `95fe61c`; flags `--reentry-min
120 --reentry-tol 0.15`, REQUIRES `--swap-skip`; fee 6.5 bps + deadband
pinned 5 bps = the D2 discount applied IN-model):** EDGE vs hold-as-is,
reentry-120/0.15 vs deployed config: crash month (May 8→Jun 8) **+21.48 vs
+14.24**; rally month (Jun 8→Jul 8) **−12.56 vs −20.87**; C3 week incl.
the crash night (Jul 7→10) +2.27 vs +1.93; C4 saw window (Jul 10→13)
+2.24 vs +3.03 (the one loss: −0.8/3d in a pure-saw regime). Two-month
sum flips −6.6 → **+8.9**. Also beats the pure-cash benchmark (never
re-enter: −10.57/+14.41, sum +3.8). Time out of pool: 76% rally / 52%
crash / 55% saw — this is a «mostly-hedged-cash, opportunistically-LP»
machine.
**Crux caveat:** the ranking holds ONLY under the D2 fee calibration
(sim fees ×1.49/×1.68/×1.55 too high on three measured real windows; at
raw 10 bps sim fees the deployed config wins). Crossover ≈ optimism
factor 1.3. Secondary bias in our favor: the sim UNDERestimates shuttle
churn (249 vs 475 real on the saw window), which penalizes re-entry less
than reality penalizes the baseline.
**Production build spec (needs operator approval):** orchestrator wait
state between Phase 1 (close) and Phase 2 (create): persist
`reentryWait {anchorPrice, sinceTs, parkedDepositUsd}` in AutoTuneState
(restart-safe); each cycle, if |price/anchor − 1| > 0.15 × width → reset
anchor, else if held ≥ `REENTRY_CONFIRM_MS` (default 0 = off) → run the
normal Phase-2 (swap plan incl. BUG-020 reserve + create). While waiting:
hedge runs on wallet-only input (ADR-021 already supports LP=0), auto-band
floors at DELTA_THRESHOLD_SOL, and the auto-create path MUST be gated
(positionCount 0 + wait state ≠ «create initial position»). Storms extend
the wait. Rollback = REENTRY_CONFIRM_MS=0.
**Also checked & closed this session:** live fat-fee pool re-scan — the
entire fat tier is still dead on-chain (A9 pool now 47 tx/h with 80%
failures and a 2%-stale price vs our 34.5k tx/h; step 15/25/30 pools all
0 tx/h) — the pool lever stays exhausted; and the existing-knob grid on
the saw window (confirm 20/30, band 0.62, bins 28) found nothing better
than deployed.

### A15.1. Re-entry loosened 0.15 → 0.20 — DEPLOYED 2026-07-15 (operator «ослабить вход в пул»)

After 40h+ of the first live wait with zero re-entries the operator ordered
a loosening. Sim (pinned flag set, 4 windows, EDGE / time-out-of-pool):
120min/0.20 beats deployed 120/0.15 on BOTH axes — sum +5.74 vs +1.05 AND
less time out everywhere (43–85% vs 56–96%). Shortening the clock is the
WRONG loosening: 60min re-enters into trend pauses (rally −18.7/−19.2 vs
−10.9) — REJECTED. Mechanism: a wider corridor stops harmless wiggles from
resetting the anchor; the long clock still keeps trends out.
`REENTRY_TOL_FRAC=0.20` deployed ~17:50Z (`622d72c` env, then `3776f5b`).
**Code fix shipped with it:** the corridor used to be BAKED into the
persisted wait state at close time — an operator tol change only applied to
the NEXT wait. Now the wait persists the closed position's `widthFrac` and
the corridor recomputes as config-tol × width every cycle (legacy states
reconstruct width from the stored corridor / 0.15). Verified live: running
wait corridor 0.295% → 0.394%, anchor + heldMs preserved. Rollback:
REENTRY_TOL_FRAC=0.15 + redeploy (applies mid-wait now).

### A17. Full-grid sweep 2026-07-15 (operator «вытащи все возможные варианты») — production composite CONFIRMED OPTIMAL

37 configs × 4 pinned windows (saw 72h / C3-week 68h / crash month 744h /
rally month 720h), calibrated fees 6.5 bps, deadband 5, swap-skip, lp95,
idle 0, USDC 180, confirm 10 unless varied. EDGE-vs-hold sums (per-window
detail in progress.md Session 27 / the sweep script in the session
scratchpad; re-runnable — all flags recorded here):

- **Re-entry grid (5 tol × 4 wait + off, 21 configs): deployed 120min/0.20
  is the MAX (+5.74)**; runners-up are all «practically never re-enter»
  configs (240/0.15 +4.70, 180/0.10 +4.37 — 93–100% out of pool); every
  60-min wait is deeply negative (−7…−13, re-enters into trend pauses);
  off = −13.72. Surface is JAGGED (120/0.25 → −0.87 one tol-step from the
  max) — treat ±3–4 USD as path noise, don't chase maxima.
- **Bins × выдержка (under 120/0.20):** bins20 wins (cm10 +5.74 ≈ cm5
  +5.73; cm20 +4.06); bins14 loses (+0.28…+2.79), bins28 loses
  (−0.67…+2.82). Deployed 20/10мин confirmed.
- **Hedge band:** 0.49 (= production 8-bin auto-band) beats the 0.25 floor
  — sum **+10.73 vs +5.74**, crash +19.59 vs +14.66 with 21 vs 36 trades
  (better on BOTH months — not direction luck); 0.75 (≈15 bins' worth at
  lp95) DANGEROUS: crash collapses to +6.63 (netΔ drifts unhedged).
  ADR-025's 8-bin choice validated; the DELTA_THRESHOLD floor should never
  be the binding value at healthy LP sizes.
- **Deposit ×2 (lp190) with PROPORTIONAL band 0.97 (auto-band reality):**
  sum **+17.34** (saw +2.48 / c3week +1.50 / crash +37.10 / rally −23.74)
  ≈ 1.8–2%/мес on the ~370 portfolio, rally-month drawdown ≈ −6.5%.
  lp190 WITHOUT A15: −30.11 — the re-entry gate is MANDATORY at scale.
- **Wide-wait re-checked under 0.20:** still rejected (wide40 −9.48,
  wide-once +2.40 vs cash +5.74).
- **Pure-cash benchmark honesty:** the never-re-enter corner sits at
  +4…+4.7 — the LP layer adds only ~+1…+6 over «hedge and sit» at lp95
  under D2-calibrated fees; the machine's trend-month value is protection,
  its earning shows in chop. At raw (uncalibrated) fees the LP share grows.

**Verdict: NOTHING new to deploy** — production already runs the sweep's
best composite (bins 20, выдержка 10м, 8-bin auto-band, re-entry 120/0.20
after A15.1). The one remaining lever is §A8 (deposit 0.61 → 1.25 after
2–3 clean срезы). Previously rejected and NOT re-run: pool switch (A9,
market dead), trend-shrink (A7), protective step (A12), governor (A13),
target tilt (sum-trap), clamp ramp/slow-exit. Caveats: single price path
per window; D2 calibration assumed; ties within a few USD are noise.

### A18. Old-pool re-check (step 4 / fee 0.04%) under the A15/A17 composite — REJECTED 2026-07-16 (current pool confirmed)

Operator question (Meteora UI 24h Fee/TVL: step4 pool 0.23%/day vs our
step10 0.12%/day — «не самый оптимальный?»). Re-ran the A17 pinned flag
set (`--swap-skip --confirm-min 10 --band 0.49 --lp-value 95 --idle-sol 0
--wallet-usdc 180 --reentry-min 120 --reentry-tol 0.20`, same 4 windows)
with HONEST per-pool fee calibration: prod 10 bps → `--fee-bps 6.5
--deadband-bps 5` (D2 ×1.55 discount), old pool
`5rCf1DM8LjKTw4YqhnoLcngyZYeNnQqztScTogYHAS6` 4 bps → `--fee-bps 4
--deadband-bps 2` (the stage-3 fit ran ON this pool, +6% ≈ honest — no
discount due). EDGE saw / c3week / crash / rally / SUM:

- PROD 10bps, bins20 (2.0% width): +1.05 / +0.74 / +19.59 / −10.66 /
  **+10.73** — reproduces the A17 band-0.49 record exactly (crash 21 perp
  trades ✓), baseline verified.
- OLD 4bps, bins50 (same 2.0% width): +1.09 / +0.77 / +13.87 / −9.86 /
  **+5.87** — chop/rally windows tie, the CRASH month separates (−5.7):
  deadband 2 makes the pool track every wiggle, more IL realized for
  comparable fee dollars (11.47 vs 10.85 crash fees at 4 vs 6.5 bps).
- OLD 4bps, bins20 (0.8% width, naive «just move» config): +2.07 / +1.08 /
  +11.27 / −10.56 / +3.86 — DEGENERATE: re-entry corridor = tol × width =
  ±0.16%, price never holds inside it → 89–100% time out of pool, LP fees
  ≈ 0 on the months; this is the pure-cash benchmark (+4ish per A17), not
  a pool test.

Verdict: current pool keeps a ~5 USD/2.2-months edge (borderline vs the
±3–4 noise bar, but the direction matches the Jul-8 legacy grid: old pool
4/4 −54.80 vs −10.64 pre-A15). The UI Fee/TVL ratio is pool-WIDE (all
bins, all TVL); our income is traversals through OUR bins × fee rate,
already calibrated per-pool against real earnings — do not compare pool
dashboards directly. Step-1/0.01% pool not simmed: 20 bins there = 0.2%
width, corridor ±0.04% — degenerates even harder, and fee per traversal
is 10× lower.

Chain check (pool-activity.ts, 2026-07-16): both pools alive, prices
fresh; old pool 1829 successful tx/h vs ours 269. ⚠ **WATCH-ITEM (volume
migration):** our pool did 34,527 tx/h on Jul 10 — activity fell ~100×
and UI volume is $28.6M (old) vs $3.77M (ours). The sim's traversal fee
model can't see resting-volume fees; if the next срезы show live LP fee
pace falling well below the C4 norm while the 4bps pool keeps the flow,
re-run this check (and a fresh D2-style live-vs-sim fee measurement) —
the answer can flip with the flow.

**Re-run 2026-07-17 (operator asked; volume kept draining 269→157 tx/h vs
old 1651) — REJECTION STANDS, now with a fresh calibration point and
quantified robustness margin.** (1) Fresh D2 live-vs-sim measurement on
the срез #3+#4 window (replay 2026-07-15T12:23Z +35h, prod composite, RAW
--fee-bps 10): sim LP fees 1.5392 vs real 0.966 → **×1.59** (prior points
×1.49/×1.68) — the 6.5 bps calibration is CONFIRMED by live data taken
AFTER the volume drain; sim time-in-pool 49.6%×35h ≈ 17.4h vs real 17.78h
(machine timing reproduces too). The tx/h drain has NOT shown up in our
realized fees — traversal/arb flow (what we actually earn from) persists.
(2) Sensitivity: old pool needs ≈**4.9 bps effective** (+22% over its
honest 4-bps fit; per-window fees 1.3013/1.0674/11.4666/8.3467 = 22.18
total, gap 4.86) to tie the 4-window SUM, and **6.0 bps** (+50%) to tie
the decisive crash window (fee 5→+16.72, fee 6→+19.58 vs prod +19.59) —
both against the MEASURED direction of model error (every live point says
the fee model overshoots reality, never undershoots). Baselines
re-reproduced to the cent before the sensitivity (saw +1.0511, old saw
+1.0896, old crash +13.8729, old rally −9.8605, old c3wk +0.7650).
Trigger unchanged: sustained live in-pool pace < ~1 USD/day → re-run again.

### A19. Hedge-venue alternatives for synchronous/atomic execution — CHECKED 2026-07-16 (no viable move; Jupiter stays)

Operator idea (from a parallel claude.ai session): bundle «Meteora close +
hedge adjust» into ONE base-chain transaction (a Solana tx is already
atomic — days of work, not months) — requires a venue that FILLS inside
our own transaction. Jupiter's keeper (TX2) physically prevents that.
Checked both candidates with live data:

- **Flash Trade** — cheap but no longer base-chain: fees 2 bps open/close
  (vs Jupiter 6), live SOL-short borrow ≈ **1.5%/yr** right now (shorts
  borrow the stable side; Crypto.1 USDC custody
  `5N2St2e1BdgWsJiXxfetwWKkHS1BYochAp1ruPFJUfgY`, utilization 5.55%,
  `currentRate` 1758e-9/hr from `flashapi.trade/raw/custodies`; curve kinks
  at 72% util → 20%/yr there). BUT **V2 executes on Flash's own execution
  layer** («orders confirm in ~50 ms», trade txs absent from base-Solana
  explorers, health endpoint `program: "ER"` = ephemeral rollup) → **no
  base-chain CPI / atomic composition possible**. Crypto.1 TVL $3.8M
  (whole protocol $7.8M per DefiLlama).
- **Adrena** — CPI-able but effectively dead: base-chain synchronous
  (datapi exposes unsigned-tx builders), open source — the only candidate
  that composes — but main-pool **daily volume $98.92, daily fees $0.05**
  (`datapi.adrena.trade/pool-high-level-stats`), TVL $440k (DefiLlama),
  their own `/liquidity-info` 500s on main-pool; close fee ~16 bps
  (secondary sources, unverified). Do not build on it.
- **Jupiter (ours)** — JLP ~$1.5B, short borrow measured **5.66%/yr** this
  hour (`pnpm jupiter:read`, carryRateBps −566), 6 bps open/close,
  keeper-async.

Verdict: today there is NO liquid base-chain-synchronous SOL perp venue —
the atomic close+hedge idea has no venue to run on; Jupiter stays. Flash's
carry edge (1.5% vs 5.66% ≈ $7.7/yr on the current $184 short) is noise vs
срез swings and buys venue risk on an off-chain-execution platform 200×
smaller than JLP. Recheck triggers: Velocity (ex-Drift) public relaunch
with base-chain fills; Flash reverting to base-chain execution; Jupiter
carry sustained >15%/yr. Recipes: `flashapi.trade/raw/custodies` (live
rates), `datapi.adrena.trade/docs` (swagger inline), `pnpm jupiter:read`.

### A21. Stable-stable pools on Meteora (operator 2026-07-18: «USDT/USDC, 5 бинов?») — SURVEYED; NICHE IS EMPTY, one 1-day-old exception

Survey (GT dex=meteora top pages + targeted search + on-chain owner/params
check, 2026-07-18): the stable-stable niche on Meteora has NO live DLMM
volume. USDC/USDT `32D4zRxNc1EssbJieVHfPhZM3rH6CzfUPrWUuWxD9prG` is the OLD
Dynamic-AMM program (owner `Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB`,
NOT DLMM — our bot can't run it), $901k TVL / $65k vol/day → passive fee
yield ≈ 0.26%/yr (dead). USDS/USDC on meteora-dbc: $50M TVL, $5k vol/day.
USD+/USDC $197k TVL ZERO volume; PYUSD/USDT dust. Solana's real stable
volume (Raydium CLMM/Orca/Byreal/ZeroFi, $1.7–3.8M/day pools) is off-venue
for us. The ONE live stable DLMM: **USDI/USDT
`UCgzcpE1VoDnY5x8YkiM2ZP75ANjXQBv9jMYZM5dcsv`** (step 1 bp, fee 0.01%,
$997k TVL, $395k vol/day) — but its trade history starts 2026-07-17T16:30Z:
the pool was ~ONE DAY OLD at survey time (launch-day numbers, unknown
issuer's stable `4ZfUkWUgW77CdqE73NTJoVGHubYayuZh7sfW529SCUnR`).
Measurements on it: active bin holds ~$29.5k (a $50/5-bin position = 0.034%
share of pass-through fees ≈ $0.013/day); BUT the launch-day «peg» wandered
316 one-bp bin crossings in 6h — sim on the real path (cache
SOLUSDC_1m_1784305800000_1784327400000.csv, `--bins 5 --bin-step 1
--fee-bps 1 --band 99 --swap-skip --reentry-min 120 --reentry-tol 0.20
--lp-value 50`) gave **EDGE +0.44 USD/6h on $50 (≈3.5%/day)** — traversal
fees on our own converting inventory (competition-independent), 0
recenters, netΔ drift +0.33. Interpretation: the yield IS the peg noise of
a day-old token — the income and the depeg risk are the same thing.
VERDICT: no deployable stable pair on Meteora today; USDI/USDT = watch
item ONLY (re-run this survey in ~1 week: if volume/peg persist and the
wiggle stays, re-cost with fresh bin distribution; the bot is now
pair-generic and could run it unchanged). Re-check recipe: GT pages →
owner check (DLMM = `LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo`) →
LbPair offsets 80/8 → GT minute OHLCV currency=token → sim.

Addendum (operator follow-up, same day): **Raydium CLMM USDC/USDT 0.01%**
`BZtgQEyS6eXUXicYPHecYQ7PybqodXQMvkjUbP4R8mUU` measured 3 ways for a $50
5-bin position. (1) Raydium's own feeApr: day 1.50% / week 1.47% / month
2.63% ANNUAL → $50 earns **$0.002–0.0036/day**. (2) Share arithmetic:
$156.6/day pool fees, $3.8M TVL all parked at the peg — same order. (3)
Sim on the real week path (cache SOLUSDC_1m_1783693800000_1784363400000,
55% minutes tradeless, price band 20bp): EDGE +0.65/7.75d ($0.084/day)
**BUT that is a ×~30 microstructure overstatement** — 449 observed 1-bp
price crossings/day vs ~15 true full-depth sweeps ($1.57M/day volume ÷
~$100k/bp depth); last-trade price wiggle is not liquidity traversal, so
the sim's traversal-fee engine does not apply to peg noise (new structural
caveat for ALL stable-pair sims; Raydium's feeApr is the ground truth) —
corrected ≈ $0.003/day, consistent with (1)+(2). Sim also showed 72% time
out of pool (reentry corridor ±1bp never holds 2h) and network cost per
recenter > daily income. Plus Raydium CLMM ≠ Meteora DLMM (program
`CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK`) — a new venue adapter for
~⅓ цента/день. REJECTED on data; niche verdict unchanged.

### A24. Raydium SOL/USDC venue check (operator 2026-07-20: «прогони на симуляторе usdc sol на raydium») — MEASURED, REJECTED

Answer in one line: Raydium's best SOL/USDC concentrated pool pays **31%
LESS fee per parked dollar** than the Meteora pool we already retired, on
the SAME pair we retired it for. No venue lever here.

Fee density per TVL dollar = turnover x fee tier (venue-neutral, both
measured 2026-07-20):
- Meteora SOL/USDC `BGm1tav58oGcsQJehL9WXBFXF7D27vZsKefj4xJKD5Y` (0.1%):
  TVL $2,832,064, vol24h $5,733,245 -> 2.02x/day x 0.1% = **0.2025%/day**
- Raydium CLMM SOL/USDC `3ucNos4NbumPLZNWztqGHNFFgkHeRMBQAVemeeomsUxv`
  (0.04%): TVL $6,053,124, vol24h $21,000,337 -> 3.47x/day x 0.04% =
  **0.1388%/day** (matches Raydium's own feeApr 50.62%/y day, 18.98% week,
  40.27% month — the A21 ground-truth rule)
- Meteora HYPE/SOL `81GpCm4d13y8TozYtThabuSCLQN2o3bbrvDogXFPn8sA` (0.2%):
  TVL $1,030,772, vol24h $495,709 -> 0.48x/day x 0.2% = **0.0962%/day**
Raydium's 1.7x higher turnover does NOT cover its 2.5x thinner fee tier.
All other Raydium concentrated SOL/USDC tiers are far worse (0.02% ->
0.0381%/day, 0.05% -> 0.0150, 0.01% -> 0.0007, 1.0% -> 0.0129); the 0.04%
pool is the only live one.

Sim run (same 39h window as срез #2, LP 148, identical machine, only the
fee tier swapped): Meteora tier 6.5 bps -> equity 249.22 -> 250.92
(**+1.70**, LP fees 1.729); Raydium tier 4 bps -> 249.22 -> 250.55
(**+1.33**, LP fees 1.386). Lower tier, less money — as arithmetic
predicts.

⚠ METHOD CAVEAT (important, reusable): **the simulator cannot distinguish
venues.** Its fee engine counts only OUR OWN range sweeps and has no notion
of pool volume or liquidity share, so "simulate Raydium" reduces to
"simulate our machine at 4 bps". Venue questions must be decided on
measured fee density (above) + the pool's realized feeApr, exactly as A21
established for stables. The sim only answers "what does a thinner tier
cost us on this path".

Blockers even if the numbers had been good: (1) Raydium CLMM is a
DIFFERENT program `CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK` — the bot
has only a Meteora DLMM adapter (create/withdraw/claim/close/exposure all
program-specific, ticks vs bins); a whole venue adapter is a session+ of
work. (2) The PAIR is unchanged — SOL vs a stable traverses constantly,
and traversal cost (not venue) is why the campaign was retired (A23).
Changing venue is a second-order lever on a first-order problem.

### A23. Replace the campaign with «HYPE/SOL LP + SOL short» — EXECUTED LIVE 2026-07-18 18:11–18:31Z (operator «Сворачивай сейчас»)

Executed (all signatures verbatim): campaign LP `3XBMM3DdfAueJPs9waasowfZiEJ6qNPica6KXhSTNMAY` closed atomically (claim+tokens+account+rent)
`32sK4WvEuu9HbaPEhyiPCgaFb7SPvaiwkwHd3hLLFFsTCNcJcprv1oqV1xTQNg5FPMPsk473SRjLics3S3GjXPUZ`;
AUTO_CREATE_POSITIONS=false on the main instance (it idles + manages ONLY
the short now). HYPE position resized +$100: old
`BSVXVU7pTjrW2NvBPPbCyZDZoufX6qWgqneaDMbA27Ng` closed
`5inJHc5yYZ2i8VtBUr59pKQQizPSDBG1k8EdqzkQXUaZ358p7aaNDNPN7JSfW7pZvWrUi6JSjDmVohXvkbVgKU7`,
funding gap covered by 20 USDC→0.2657 SOL
`5SZu8YiT4Rf2388ULxK7BRrU76papcaUiJH9RFwMpSG7ZriPSmdW1cc1FqFss31K6EpVUJE54fTLxReh8crfRM6J`
(the instance cannot see USDC — pair-invisible), new position
`2BKShoLZiPUmmg7fepp6hQn3R7kTnZRnT3RfUAiWd7tg` = 1.239443252 HYPE +
0.984994459 SOL ≈ 1.97 SOL ≈ $148, open
`2sBUR8eaGEBGiwzvUnSzcY2wK2EQgbzys6jXztivruZrb2MySZs5t9A2iWm27rEYXN4XLHGCEDZedQYvsabykbxH`.
GOTCHA caught live: the main instance auto-DECREASED the short to idle-only
(1.71→0.50) after the campaign close — its input can't see the pool.
BRIDGE: HEDGE_TARGET_DELTA_SOL=−1.97 (pool value in SOL) → controller
raised the short to ≈2.4735 (+$148.66 notional, +49.06 USDC collateral,
`5GSMPw4y1it412MwZntoYB83LNv5Zv5oEsH7tJYyyi8EuSy3UiRyEnLL9mijkakoTpgMEWHqmV7h3KMWg9y3hLR8`),
net −1.9713 vs target −1.97 in band. UPDATE THE TARGET at срезы as the
pool value drifts; PROPER FIX next session: hedge input = hype-pool value
(cross-instance read), then the bridge target returns to 0. Residual true
long ≈ +0.29 SOL (reserves floor, by design). СРЕЗ BASELINE (operator:
«начало = момент повышения объёма»): anchor 2026-07-18T18:16:50Z,
data/strategy-a23-baseline.json (both copies) — TOTAL $327.07 (pool $148.2
+ wallet 0.802 SOL + 41.30 USDC + dust + collateral $75.80 @ SOL 75.249).
Old hodl-baseline/hodl-compare are CAMPAIGN artifacts — archived by this
entry, do not run pnpm hodl against them. Srez formula now: whole-portfolio
USD (pool valueSol×price + wallet SOL×price + USDC + HYPE dust×price×… +
collateral ± perp PnL) vs 327.07; SOL-reference secondary.
⚠ FORMULA GOTCHAS measured at срез #1: (a) the anchor TOTAL 327.07
EXCLUDED the short's uPnL, which was **+0.5346** at anchor (blended entry
75.464911 vs spot 75.249) — a срез that includes uPnL reads +0.53 too
good; report both frames. (b) The engine prices uPnL at its oracle while
the portfolio uses pyth — ±0.2 scale noise on a 2.47 SOL short. (c)
Baseline collateral 75.800782 was captured BEFORE the increase's open-fee
settlement; the first срез absorbs a one-time −0.111218 face drift.

**Срез log (append one line per срез):**
- #1 2026-07-19T18:33Z (24.3h): TOTAL 328.86 = pool 150.06 (fees window
  0.007849 SOL=$0.59) + wallet 103.34 (unchanged 0.802161852 SOL +
  41.304678 USDC + 0.022725965 HYPE) + short 75.46 → **+1.79 formula /
  +1.26 honest**. Window sterile: 0 txs after baseline snapshot, 0
  recenters both instances, VITALS 0, liq 1.40×, netΔ −1.9666 in band,
  fee pace 0.393%/день. Decomp: fees +0.59, basis HYPE+0.8% +0.60 (luck),
  IL −0.09, carry −0.03, collateral one-time −0.11. Target drift +0.007
  → no update.
- #2 2026-07-20T07:30Z (39.2h): TOTAL 328.34 = pool 150.35 (1.978813 SOL,
  fees cumulative 0.0131837 SOL=$1.00) + wallet 103.62 (unchanged) +
  short 74.38 (uPnL −1.270132, borrow 0.042562) → **+1.28 formula /
  +0.74 honest**. Window #1→#2 −0.52: fees +0.41 < basis swing (HYPE
  −1.2% vs SOL over the window; from anchor −0.4%, #1's +0.60 luck half
  reverted). Sterile: 0 txs (tx-audit), 0 recenters both instances,
  VITALS/errors/storms 0, netΔ −1.9512 in band, liq 1.394×, IL from
  anchor −0.03. Fee pace window 0.499%/день (above norm). Target drift
  −0.004 → no update. Found (cosmetic, not fixed): local dashboard
  outOfBand ignores HEDGE_TARGET_DELTA_SOL (dashboardData.ts:221) —
  always «OUT-OF-BAND» under the bridge target; controller unaffected.

**Head-to-head on the срез-#2 window (Session 33, operator asked «а что
если бы оставили SOL/USDC?»)** — campaign machine replayed on REAL Binance
candles, SAME calendar 2026-07-18T18:16Z → 2026-07-20T07:30Z (39h, 2319
candles), production params (bins 20, confirm 10m, step 10 / fee 6.5 bps
D2-pessimistic, reentry 120m/0.20, --swap-skip, band 0.49; band 0.25
identical to the cent). Cache keyed by exact (start_ms,end_ms) → no
collision with the HYPE-poisoned `SOLUSDC_*` files. Results, ABSOLUTE
Δequity (the frame the live срез reports):
- campaign **as it actually was** (LP 91, idle 1.4, usdc 100): **+0.67**
  (fees 1.063, perp fees 0.144, carry 0.025, 2 recenters, 1 skipped by
  выдержка, 30% time out of pool, churn $240) — vs live HYPE+short **+0.74
  measured**. TIE (difference 0.07 ≪ the ±10% model bias).
- campaign **scaled to the same LP dollars** (LP 148): **+1.70** (fees
  1.729, 2 recenters, 30% out of pool, netΔ end −0.44) — beats the live
  +0.74 ON THIS WINDOW.
Mechanism: SOL/USDC pays fees **~1.75× faster per LP dollar** (0.715%/day
sim vs 0.408%/day real on HYPE/SOL) but pays it back in traversals — 30%
out of pool + 2 recenters + perp churn, while HYPE/SOL sat in range 100%
of the window with 0 recenters and 0 churn.
FRAME WARNING — this window FLATTERS the campaign: 1.2 recenters/day vs
the campaign's historical ~4.5/day (срез #1: 13 traversals / 2.89d), i.e.
≈4× calmer than its normal regime, and calm drift is exactly what the
campaign machine likes. The month-long same-calendar head-to-head below
still stands: campaign **−6.48/мес** vs HYPE+short **−0.85/мес**. Verdict
UNCHANGED (no return to SOL/USDC); logged as a regime data point — if
SOL chop stays this low for a week+, re-open the question with a week
window, not 39h.

Sim grid on fresh candles (Session 32, cache extended to Jul 19 18:00Z —
master `SOLUSDC_1m_1781697600000_1784484000000.csv`, splice k=75.904170;
live-24h replay matched reality: 0 recenters, fees sim 0.51 vs real 0.59):
FRAME RULE — band 0.49 simulates a HYPE perp that DOES NOT EXIST (A19);
the live A23 construction = band 99, and the live срез ≈ ABSOLUTE Δequity
of that frame (the SOL short only converts SOL-metric → USD). Results
(lp 148, fee 12.5 pessimistic, месяц 774h / неделя 168h): current params
месяц −1.05; **bins 28 the ONLY config ≥ base in every frame** (месяц
+0.64, неделя −2.92 vs −2.98 band99 and −0.10 vs −1.92 band0.49; cost:
−27% fees on quiet days, 0.37 vs 0.51/day); REJECTED on data: bins 14
(−5.83)/40 (−2.09), confirm 30 (−2.49), tol 0.15 (−3.85)/0.30 (−3.42),
reentry-min 240/360 (месяц +7.7/+14.3 but неделя −5.0/−5.9 — the month
win is escape-the-falling-saw regime luck; the sim wait bag KEEPS HYPE
exposure while parked, netΔ +1.1, so parking is not neutral either).

Sim grid #2 on fresh candles (Session 34, Jul 20 20:00Z). Plumbing first:
the sim grew a `--symbol` flag and the GT pipeline became a durable script
(`scripts/pair-candles.ts` — fetch/normalize/splice + flat gap-fill); pair
candles now live under their own names (`HYPESOL_1m_*` etc., cache-only, no
Binance fallback), the «HYPE-poisoned SOLUSDC_*» class is CLOSED, ambiguous
GT-derived files deleted (rebuildable by recipe). Master
`HYPESOL_1m_1781697600000_1784577600000.csv` = Jun 17 12:00 → Jul 20 20:00,
splice k=75.904171. Validation vs срез #2 (37h): 0 recenters exact, fees
0.90 vs 1.00 real (−10%), abs +1.08 vs +0.74 honest (= carry 0.03 +
one-time collateral 0.11 + oracle noise). Fresh grid (месяц 720h / неделя
168h / срез 49h / full-master 800h; edge/abs): base −1.97/−19.17,
−2.28/−7.69, +1.06/+1.80, −0.94/−19.29; **bins 28 better on every
multi-week frame — THIRD confirmation (месяц −1.86/−19.03, неделя
−2.12/−7.52, 800h +0.99/−17.33; cost −20–30% fees on quiet windows, срез
+0.76/+1.50); **APPLIED by operator order 2026-07-20 ~20:39Z: .env.hype
AUTO_TUNE_BIN_COUNT 20→28 (local+server in sync, STRATEGY_VERSION stamp
preserved), hype container force-recreated, first cycle clean (binCount 28
in config, same position mint discovered, balanced 37.3/62.7, no action);
the live 21-bin position stays until the next natural recenter — the first
28-bin position appears then.** b28-c5 / bins32 jagged (b32
месяц −0.84 best, неделя worse than base) — no overfit chase; reentry-min
240 regime trap re-confirmed (месяц +5.12 / неделя −3.06); tol 0.10 parks
61%; storm-pct insensitive (0 storms — calm). USD bottom line: no parameter
flips the sign — basis swings ±20/мес vs tuning ±1–2/мес. Same-calendar
campaign machine (SOL/USDC hedged, LP 148, band 0.25): месяц +0.54, неделя
+1.94, 336h −2.14, срез-49h +0.94 — BOTH constructions ≈ 0 ± regime; band
0.49≈0.62 ≥ 0.25 everywhere (perp trades −25%, месяц +1.71) — pro-wide
again; campaign regime stays ~4× calmer than historic (31 recenters/мес,
0 storms) — the Session-33 re-open rule (week+ window) keeps ticking.

Pre-execution simulation (same-calendar head-to-head) — retained below:

Mechanism: a SOL short sized to the test's total SOL value converts the
pair's SOL-metric result into USD (USD PnL ≈ SOL-metric edge × price +
carry − resize churn); residual risk = HYPE-vs-SOL basis only (unhedged —
no HYPE perp, A19). ONE wallet has ONE short PDA → the short must be run
by a single controller: either the main instance's hedge input adds the
test's SOL value (campaign stays), or the campaign retires and the hype
instance takes over the short (operator's ask) — either ≈ a session of
work, hedge machinery exists.

Same-calendar head-to-head (Jun 17 12:00 → Jul 17 12:00 UTC, both with
production-machine params, D2-pessimistic fees, sim ±10%):
- **Campaign machine** (SOL/USDC step 10 / fee 6.5, LP $91, idle 1.4,
  usdc 100, band 0.25, REAL Binance candles): **EDGE −6.48/мес**, fees
  10.22, perp+carry −1.44, 31 recenters, 11 storms, 77.5% time out of
  pool, churn $1487 — matches the live bleed direction (срезы).
- **HYPE/SOL machine $48** (step 20 / fee 12.5 pessimistic, honest
  no-perp frame; short overlay = carry −0.23/мес − resize ~0.05):
  continuous month **−0.57 → with short −0.85/мес**; weekly split
  +1.13 / −0.41 / +0.38 / +0.28 (3 of 4 positive; weekly sum +1.38 —
  boundary/state effects vs continuous month documented); live managed
  8.5h on Jul 18: +$0.37.
Per LP dollar: campaign −7.1%/мес vs HYPE+short −1.8%/мес on the WORST
month, weekly median positive. Risks: HYPE-vs-SOL basis (−20% day ≈ −$5
per $48, no hedge exists), short resize lag in storms, carry spikes,
+$16–25 collateral. Caveat: the HYPE pool has ~1 month of history.
Decision pending operator: retire campaign now vs after the A20 week
confirms live fees.

### A22. Pool combinations / HYPE-USDC frame (operator 2026-07-18: «USDC-HYPE + USDC-SOL, балансировать между ними?») — MEASURED, REJECTED

Structural answer first: two USDC-quoted LPs do NOT hedge each other —
both are long their volatile asset, correlated crashes hit both, and
«перебалансировать в упавший» = averaging down (risk up, not down). The
only neutralizers: a perp short (SOL only — no HYPE perp anywhere, A19) or
quoting IN the correlated asset (X/SOL — the live test). The operator's
idea in its correct form is ALREADY the live test: HYPE/SOL LP +
SOL-neutral portfolio ≡ HYPE/USDC LP + proxy SOL short, in one position
with no carry.

Measured head-to-head (same window 2026-06-29T22:00Z → 2026-07-17T12:00Z
= 17.6d, same machine flags as the A20 deployment frame, $39.5, fee 12.5
pessimistic, step 20/bins 20): **HYPE/USDC**
`ANCx141SujgVdbKz9NTEH8F38qWsnyyXsVju64aU3qLB` (DLMM, step 20, 0.2%,
$5.5M TVL, $2M vol/day — 5× our HYPE/SOL pool; path −10.94%) vs
**HYPE/SOL** `81GpCm4d13y8TozYtThabuSCLQN2o3bbrvDogXFPn8sA` (path −9.87%):
- honest no-perp frame: HYPE/USDC **−2.50** (33 recenters, 2 storms, 40%
  time out of pool) vs HYPE/SOL **−0.30** (25, 0, 20%) — 8× worse; fees
  nearly equal (3.85 vs 3.92) — the USD quote adds SOL-beta to the pair
  volatility and the extra traversals eat everything.
- fictional perfect-HYPE-perp frame (NOT implementable, upper bound):
  HYPE/USDC +6.53 (fees 7.12 — the 5× volume does show up) vs HYPE/SOL
  **+7.60** (fees 5.33) — still loses after churn/IL/carry.
VERDICT: no pool combination beats the current single HYPE/SOL frame;
rejected on data both structurally and numerically. (Sim caches for these
runs deleted to avoid poisoning real-SOL windows; rebuild via the A20/A21
recipe if needed.)

### A20. Non-USDC pair survey (operator 2026-07-17: «пары без привязки к доллару») — MEASURED; HYPE/SOL live test APPROVED

Operator redirect after A18: no USDC leg, Solana+Meteora only, no ETH/BTC —
X/SOL pairs, SOL-metric («профит на обеих сторонах», no USD peg). Survey
method now REUSABLE: GeckoTerminal top DLMM pools (dex id `meteora`) →
filter X/SOL non-stable → on-chain binStep/baseFactor (LbPair offsets 80/8)
→ 1m pool OHLCV via GT (`currency=token` = price in SOL) → gap-fill flat
(pool price IS flat between swaps) → normalize first close to 75 → write
simulator cache CSV (`SOLUSDC_1m_<startMs>_<endMs>.csv`) → run with
`--bin-step/--fee-bps` of the pool. New sim flag `--storm-pct` (was
hardcoded 2.0). Clean-mechanics measurement trick: run the (fictional)
hedge `--band 0.49` to pin netΔ≈0 → EDGE = fees − IL − costs, direction
purged; unhedged `--band 99` = the live no-perp frame.

Measured (clean mechanics, month window, per 95 USD position, fee raw 20
→ pessimistic 12.5 per D2):

- **ANSEM/SOL** `6e7V9eegCHw997T72MxgwwJipZ6GJyZF8NvjkzT1rvpN` (0.2%,
  step 20, $19.5M vol/24h, ±15–50%/day): **−145…−161/month**; flat week
  −29…−44/wk. Fees 43–90/19d are real but IL is 3–5×. The A15 machine
  refuses to enter at all (99%+ out, corridor never holds; storms 2275).
  Unhedged runs swing +180/−36 = wait-bag momentum lottery, not edge.
  **REJECTED on data.**
- **PUMP/SOL** `HbjYfcWZBjCBYTJpZkLGxqArVmZVu3mQcRudb6Wg1sVh` (0.2%,
  step 20, 73% minutes tradeless): month **−12…+9** — straddles zero,
  regime-dependent (calm weeks positive, the hot 13–14%/day days
  −8…−14/wk). BORDERLINE, passed over for HYPE.
- **HYPE/SOL** `81GpCm4d13y8TozYtThabuSCLQN2o3bbrvDogXFPn8sA` (0.2%,
  step 20, 84% minutes tradeless, month path −18% slide): clean mechanics
  **+5…+21/month, positive in EVERY window** (7d +3.9, 72h +2.4), zero
  storms. STRUCTURAL FINDING for the no-perp frame: swap-skip lets netΔ
  drift (accumulated +2.9 HYPE ≈ $177 by month end — ate the whole edge:
  unhedged −3.9); with FORCED alignment swaps (legacy no-swap-skip mode)
  the live frame gives **−2…+8/month** (swap costs 2.5, residual drift
  +0.8). → any no-perp deployment MUST re-balance via spot swaps at
  recenters, never swap-skip.

**DECISION (operator, 2026-07-17): small live test of HYPE/SOL — and per
the follow-up «Сделай сам. Я вручную не хочу» it is EXECUTED FROM THE BOT
WALLET, opened LIVE 2026-07-17T15:22Z.** Facts (all signatures verbatim):
swap 0.27 SOL → 0.331139501 HYPE
`2qKXKEg5wLQyQXvCdogPeM78uiTr8JRKnnBXmdx6hAKbXG7PJcMruZDw2unDv4rTqj2YQQopDnV3rE9M8bU9mRVG`
(price impact −0.0007%), position open
`52tLJoRRm2NQNS8kyiBHpWsYw6AgRJYn19SMyLYbCtkUaBHrjYoDPdAHaQNxrAGfnxhYB7ywDLPQXqbsXma5L6GF`,
position mint `7xSB8jczjK8bMTMpaPANAFUnshWehzmeknwyPSbddcEh`, range bins
−114…−94 (21 bins ≈ ±2%), 0.270000 SOL + 0.331139501 HYPE, test equity at
open 0.539010 SOL (outflow 0.601069348 incl. refundable rent 0.0574 +
network). Opener: `scripts/hype-test-open.ts` (dry-run default; --live
allowed via project settings.local rule). **Campaign-4 baseline adjusted
on BOTH copies by the exact carve-out**: solSideAmount 0.812640989 →
0.211571641, totalUsd 336.52055387901737 → 288.7504719127552 (note
documents; capturedAt unchanged). ⚠ CONTINUITY: the carve-out is valued
at the frozen baseline price 79.475 while SOL left at ~74.6 → post-Jul-17
срезы read ≈ **+2.93 more favorable** vs-USDC than the pre-carve-out
trend — subtract it when comparing (first adjusted read: −1.74 ≈ old
−4.28 + 2.93 + intraday). Hedge auto-trim VERIFIED: decrease_short
0.5925034123309025 SOL (−$43.80 notional, $14.45 collateral back) at
15:22:05Z, 3s after the open, sig
`2wvcMjtTPSzV9agLDimBLPSHQmcvVw1rtB4QPZ5SapF1vJroim5urwhUYnGzCD7ZiRJbcFDjmRn1uNa5VmbY6z19`,
netΔ back in band (+0.002). Test position is INVISIBLE to the bot loop
(different pool) and to campaign equity (by design). MANAGEMENT — since
2026-07-18 the test IS a second instance of the production bot (operator:
«вся автоматика уже в коде есть, продублируй и задеплой» — a bespoke
recenter script was built first and DISCARDED): compose service
`delta-neutral-bot-hype`, same image/wallet, own data dir `data-hype/`,
env `.env.hype` (HEDGE off per A19; bins 20; выдержка 10m; реентри
120m/0.20; storm 2%/5m; interval 60s; deposit = quote-role 0.32 SOL ≈
$48 total — operator's «сумма 50»; MINIMUM_WALLET_BALANCE_SOL=1.05 = the
campaign fence, ≈0.18 SOL spendable = the one-time top-up, flows visible
in data-hype/pnl.db — subtract at срез). The LP path is pair-generic
(src/config/pairConfig.ts: base=tokenX, quote=tokenY, derived on-chain;
"usd"-named figures on this instance are SOL figures). The production
swapPlanner at tight budget IS forced-alignment (sim: 44/44 recenters
swapped) — the swap-skip drift trap does not apply. Deployment-frame sim
(month −18.4%, fee 12.5 bps, `--swap-skip --reentry-min 120 --reentry-tol
0.20 --lp-value 39.5 --idle-sol 0 --wallet-usdc 0`): EDGE −0.50/мес ≈ tie
with hold on the WORST month; legacy A20 frame reproduced (−2.28 ∈
−2…+8). Manual rule stays for extremes: HYPE −20%+/day → close to SOL
(`pnpm derisk` won't see this pool — close via the hype instance or UI).
Daily cadence: срез BOTH — `pnpm hodl` (кампания) + `pnpm hype` (тест).
Tracking `pnpm hype` (scripts/hype-test-track.ts): mint-AGNOSTIC baseline
= first history row (recenters keep continuity), % readouts, trailing 24h
window. Success bar: sim expects
~0.003–0.005 SOL/day fees on this size; vs-hold-mix positive over ≥1
week → migration spec conversation; negative → close the test, re-add
the exact return flow to the baseline. Caveats: 1 month of history, GT
volume split across 3 HYPE pools, bridge-token risk, no perp anywhere
(Hyperliquid's own HYPE perp is another chain — not composable).

**Survey refresh 2026-07-20 (Session 34; recipe now durable —
`scripts/pair-candles.ts` + sim `--symbol`; fees ×0.625 pessimistic; ONE
336h window Jul 6 20:00 → Jul 20 20:00 for every pair, LP 148; numbers =
clean band0.49 edge / live band99 abs):** references SOLUSDC +4.63 / +1.04
unhedged (hedged band0.25 abs −2.14), HYPE +4.21 / −8.47. New/re-checked:
- **PUMP/SOL −28.83 / +15.36 — fresh data REJECTS the July «borderline»**
  (37 storms, +34% trend; the +15 abs is bag ride, not edge).
- MET/SOL `AsSyvUnbfaZJPRrNh3kUuvZTeHKoMVWEoHz86f4Q5D9x` (step 20/0.2%,
  density 0.41%/д): −8.03 / −16.54 — REJECT (chops hard, +3.7% net path).
- USELESS/SOL `8ztFxjFPfVUtEf4SLSapcFj8GW2dxyUA9no2bLPq7H7V` (step 20/0.2%):
  +7.15 with 82% parked / −41.25 (−33% slide) — REJECT.
- Jimothy/SOL `E3SotafntrgRg9XjppxqoJWSR4GUaJV7sA8u4a89rYo6` (step 50 /
  0.5%!): permanent storm (745 pauses/2wk), wait-bag momentum lottery
  (abs +452 on a +263% pump) — ANSEM-class REJECT + survivor bias (it is
  in the volume top BECAUSE it pumped).
- JUP/SOL `C8Gr6AUuq9hEdSYJzoEpNcdjpojPZwqG5MtQbeouNNwg` (step 80/0.15%):
  +6.34 / −10.73 — the only mechanically-positive-and-calm alternative
  (6 recenters, 4.8% out of pool) but JUP-vs-SOL basis is unhedgeable
  (−14%/2wk realized, no composable perp) — same trap as HYPE, thinner
  fees. Parked as a data point, not a proposal.
Pool notes (the «разные пулы» leg): HYPE/SOL alt pool
`6oQ9wVex4mKZti2GsGCfD8FWTMMC9PLQkztRU5cd6MK8` (step 4 / 0.04%) — pool-wide
fee density 0.265%/д vs ours 0.090%/д (GT vol24h × baseFee / TVL), BUT
mechanically −5.14 clean vs our +4.21 (own-position fees 2.11 vs 8.78/2wk)
— the A24 pattern (sim cannot see venue flow; ×3 density < ×4 thinner
tier): REJECT unless a live tx/h + fee-density measurement
(scripts/pool-activity.ts) says otherwise. Old SOL/USDC pool
`5rCf1DM8LjKTw4YqhnoLcngyZYeNnQqztScTogYHAS6` fee density flipped ABOVE the
campaign pool (0.34 vs 0.21 %/д) — A18's ×1.59 advantage is GONE; if
SOL/USDC ever re-opens, re-measure the venue first. VERDICT: no new pair
beats HYPE/SOL + short; the only live proposal remains bins 20 → 28.

### A16. Wide-wait («расширять вместо выхода») — TESTED & REJECTED 2026-07-15

**Operator question (Session 27):** DLMM bins/positions CAN be resized
in-place (`increase_position_length`/`decrease_position_length`, positions
up to 1400 bins, both in our SDK) — so instead of the A15 cash wait, hold
the parked deposit in a WIDE position (±2% at 40 bins / 10 bps) and narrow
back when calm confirms. Theory: a saw contained inside the wide range
earns fees with no realized IL (round trips restore inventory); law-2
(IL/day width-independent) only bites on paths that traverse.

**Sim probe (`--wait-wide-bins N [--wide-once]`, both require
`--reentry-min`):** re-pinned baseline flag set for THIS grid (the
session-25 exact flags were unrecorded): `--swap-skip --bin-step 10
--fee-bps 6.5 --deadband-bps 5 --confirm-min 10 --lp-value 95 --idle-sol 0
--wallet-usdc 180`; windows crash = May 8 + 744h, rally = Jun 8 + 720h,
C3-week = Jul 7 13:47 + 68h, saw = Jul 10 10:48 + 72h. EDGE vs
hold-as-is (saw / C3-week / crash / rally / SUM):

- base (no A15):     +2.28 / −0.27 / +3.91 / −19.64 / **−13.72**
- cash-wait (PROD):  +1.59 / +0.89 / +11.13 / −12.56 / **+1.05**
- wide-40:           +2.18 / +1.68 / +11.72 / −24.70 / **−9.12**
- wide-60:           +2.18 / +0.27 / +10.00 / −19.70 / **−7.25**
- wide-40 + once:    +2.07 / +0.85 / +10.14 / −13.07 / **−0.01**

**Verdict: REJECTED, cash-wait stays.** Full wide-wait dies on the rally
month (81 wide recenters — a month-long trend traverses ANY containable
width, eating full IL for half fees; worse than no A15 at all). The
wide-once escalation (widen once per episode, breakout → cash) fixes the
trend leg but lands a TIE with deployed (Δ ≈ 1 USD / 2.2 months ≪ model
noise) — not worth new production machinery. Extra bias caution: the
mechanism's whole win is FEES, exactly where D2 says the model flatters
(×1.3 crossover), and the sim under-counts live shuttle churn (more wide
recenters live than simmed). Revisit ONLY if live срезы show multi-day
pure-saw regimes where the machine sits in cash and the vs-USDC trend is
flat — the saw window's +0.5/3d is real but small, and it's the only
regime that pays. Account plumbing answer recorded for the operator:
position rent is refundable (BUG-022), so in-place resize saves ~nothing —
the recenter cost is the swap + market move, not the account.

### A8. Scaling 130 → 300+ (operator decision, after clean срезы)
**OPERATOR DECISION 2026-07-14 («После 2–3 чистых срезов»):** bump
`AUTO_TUNE_DEPOSIT_AMOUNT` 0.61 → 1.25 SOL only after 2–3 clean срезы
prove the A15 machine positive LIVE (≈ Jul 17–18). Criterion: vs-USDC
trend ≥ 0 across the срезы, no new incidents. Then one .env change + one
deploy — everything else auto-scales.
**2026-07-14 sim probe (Session 26, calibrated fees, A15 120/0.15 on):**
deposit scaling is THE percent lever — lp-value 190 (deposit ≈ 1.25 SOL)
vs 95: crash month +42.18 vs +21.48, rally −27.47 vs −12.56, saw +2.47 vs
+2.24 → two-month avg **+7.35/мес ≈ 2.2%/мес on the $330 portfolio** (lp95:
+4.45 ≈ 1.35%/мес), at the cost of a DOUBLED bad-month drawdown (−27.5 ≈
−8.3%/мес on the rally month). Same-session negatives: Kamino-style wide
ranges LOSE even with A15 (bins28: crash +16.95/rally −13.05/saw +1.78;
bins40: +14.18/−13.21/+1.67 — concentration at 20 bins stays optimal);
fine A15 grid (60–180 min × tol 0.10–0.20) is jagged within the model's
noise band (~±10/мес) — 120/0.20 looked best on months (+13.8 sum) but
loses on the saw; **kept 120/0.15, no overfit chase**. All numbers under
the D2 calibration assumption — validate A15 live (2–3 clean срезы)
before bumping the deposit.
Everything auto-scales (cap ADR-022, band ADR-025, collateral = ratio). The
ONLY knobs to change: `AUTO_TUNE_DEPOSIT_AMOUNT` (currently 0.61 SOL) and
the wallet funding itself. Protocol: (1) at least 2 clean срезы on Campaign
4 (clean restart 2026-07-10, baseline 331.958196546895 @
2026-07-10T10:48:08.395Z) with vs-USDC trend ≥ 0 on calm days; (2) re-run
the simulator pool grid on CURRENT campaign data (D2: sim fees ×1.5–1.7
hot at 10 bps);
(3) propose numbers, get approval, operator funds the wallet, bump deposit,
one deploy, watch the first recenter + hedge cycle live.

---

## B. Daily operations (the mechanical loop)

1. **Morning:** check both heartbeats arrived (00:17Z hodl row via
   `bash -c 'source deploy/hetzner/lib.sh; remote "tail -1 /opt/delta-bot/data/hodl-history.jsonl"'`,
   08:05Z «💚 живой» on the operator's phone), then `bash scripts/triage.sh`.
   Expect: 0 VITALS, netΔ in band, restarts=0, persistent log advancing.
2. **Срез:** `pnpm hodl` + the mandatory verification block (hodl-check
   skill) + strategy-analyzer skill. Report format: plain-language summary
   FIRST (≤5 sentences, ≤4 numbers), details below; headline number =
   vs-USDC (did the dollar total grow — operator decision 2026-07-09).
3. **Any alert:** alert-response skill, triage first, mutate never without
   «да».
4. **Docs after every session:** progress.md (what happened), bugs.md (new
   defects), decisions.md (ADRs), HANDOVER.md (resume state).

## C. Analysis recipes (how to explain the numbers)

### C1. Срез decomposition — mechanical vs skill (used in срез #2)
The bot's target delta is 0 (full-portfolio neutral). Therefore:
- **vs HODL-USDC = the skill number AND the headline of every срез**
  (operator decision 2026-07-09: the goal is stable USD growth, SOL
  indifferent — report this line FIRST, per the hodl-check verdict block)
  ≈ LP fees − conversion losses (IL) − all costs. For a neutral bot this
  line should NOT move with price; its TREND across срезы answers
  «бот выгоден?».
- **vs HODL-as-is contains a mechanical part** = `baseline_SOL × (P_baseline
  − P_now)` (baseline_SOL = the SOL amount in `data/hodl-baseline.json`,
  0.755234909 for Campaign 4 since 2026-07-10; was 2.049970 for
  Campaign 3). On a price DROP this term is positive (the
  hedge protected what the benchmark lost); on a rise, negative. Skill part
  = vs-as-is − mechanical ≈ vs-USDC (cross-check: they must agree within
  cents; a mismatch = neutrality leak → hedge-economics mirror-check in
  strategy-analyzer).
- Sanity numbers from Jul 7-8: −3.8% night → mechanical +6.56, vs-as-is
  +4.91, skill −1.65 ≈ vs-USDC −1.63 ✓.

### C2. Night/incident loss decomposition template
For a window with N out-of-range recenters on position value V and range
width w (fraction, = binCount × binStep_bps / 10000):
- conversion loss ≈ N × V×w/8 (per full traversal; Campaign 3: V≈$96,
  w=2% → ≈$0.24 each);
- trend tax: positions living <15 min (check `rebalances` timestamps) mean
  recentering into a moving price — count them, each adds roughly another
  V×w/8;
- hedge trade fees = 6 bps × Σ|size_usd| (from `hedge_actions`);
- swap costs = Σ swap volume × ~10 bps + priority fees (from tx-audit);
- LP fees earned = claimed (rebalances table) + unclaimed (hodl breakdown).
Sum must ≈ the vs-USDC move over the window. If it doesn't (gap > ~30%),
something is unexplained — dig before reporting.

### C3. Trend-shrink re-test protocol — CLOSED (superseded by the Jun 8 →
### Jul 8 month test, see A7; kept for the episode-mining sqlite recipe)
An «episode» = either a trend (≥3 same-direction recenters within ~6h) or a
chop night (≥6 recenters alternating). Find them:
`sqlite3 pnl.db "SELECT triggered_at, trigger_reason FROM rebalances WHERE triggered_at >= '<campaign start>' ORDER BY triggered_at"`
— direction from the reason (SOL 100% = down, USDC 100% = up). For each
episode window run baseline + `--trend-streak 2 --trend-calm-min 60
--trend-frac 0.5` (commands in `.claude/skills/simulator/SKILL.md`; pool
flags `--bin-step 10 --fee-bps 10`). Decision rule: deploy only if
Σ(variant − baseline) over ALL episodes > +$1 per 3 days of covered time
AND no single episode loses more than $0.60.

### C4. Norms (the срез check list, current values 2026-07-10)
- Network fees: 0.001–0.005 SOL/day (alert 0.05/24h).
- LP fees pace: **RECALIBRATED 2026-07-10 to ≈ $1.2–2.2/day** on the
  ~$95–100 slice (scale with LP value). The old $2–3.5 band was set from
  sim dollars, which run ×1.5–1.7 above reality at 10 bps (D2); the honest
  sim-derived expectation is 2.09–2.66 sim-USD/day ÷ 1.6 ≈ $1.3–1.7, and
  the measured campaign pace is $1.64/day — mid-band. Falling fee pace +
  rising recenter count together still = pool thesis needs a look.
- Recenters: 2–40/day red lines; sim promise for this pool ≈ 4.4/day —
  judge only on calm days.
- Hedge churn 24h: ≤ 3× auto-cap (watch the CAVEAT: surplus wallet SOL
  inflates the cap and can absorb a symptom — cross-check churn in absolute
  dollars vs the day's trade list). Since Jul 9: while the wallet holds a
  fat idle-USDC buffer, expect ~1 recenter-follow trade of ~$43 per
  recenter (swap-skip shuttle, see A10) ≈ 2.2–2.9× cap on a 6–8-recenter
  day — near-threshold latch fires are explained noise, not the Jul-5
  pathology; verify by matching each trade to a recenter ±1 cycle.
- Liq distance ≥ 1.3× spot (alert 1.25, release 1.30).
- Wallet idle USDC ≥ `HEDGE_TARGET_COLLATERAL_RATIO × LP full value USD`
  (proportional, operator rule 2026-07-08; ≈ $32 at the current ~$96 slice) —
  covers two back-to-back hedge-increase events; below it = collateral
  starvation risk (see A2).
- netΔ in band; band = max(0.25, 4 bins' worth).

## D. Known model/tooling caveats (do not re-discover these)

- **D1. Simulator idle wallet is a CONSTANT** (`idle_wallet_sol`) — real
  wallets swing; configs generating hedge churn are under-penalized ~35% on
  trade count. Pro-wide/pro-slow conclusions are trustworthy; pro-narrow/
  pro-tight need extra scrutiny.
- **D2. Simulator fee model at 10 bps is EXTRAPOLATED** (deadband=fee/2
  validated only at 4 bps). Absolute fee dollars on Campaign-3 windows run
  **×1.5–1.7 above reality — two live measurements now:** +49% on the 42h
  Jul 7→9 window (A10 replay) and +68% on the 20h срез-#4 window
  (2026-07-09T13:26 → +20h replay: sim fees 1.69 vs real 1.01; on that
  quiet window counts were noisy too — recenters 1 vs 2, trades 2 vs 1 —
  single threshold crossings dominate short windows). Relative comparisons
  on the same window remain valid; divide sim fee advantages by ~1.6
  before quoting dollars. The C4 fee-pace norm was recalibrated from this
  (2026-07-10). Full stage-3 refit still worthwhile before any scaling grid.
- **D3. `hedge_actions` records only non-`none` decisions** — hedge liveness
  is verified from `data/logs/bot.log` heartbeat lines, never from db row
  density (strategy-analyzer skill has the exact procedure).
- **D4. VITALS churn denominator self-inflation:** the auto-cap grows with
  idle SOL, so a bug that dumps SOL into the wallet RAISES the alert
  threshold (observed Jul 7: cap $147→$250 after the $83 trade). When churn
  looks quiet, also eyeball the absolute trade list for the day.
- **D5. `pnpm test` = vitest WATCH mode** (never exits); single run =
  `npx vitest run`. `pnpm lint` broken until A4.
- **D6. Local `pnpm hodl` appends to LOCAL hodl-history.jsonl** — the
  canonical history is the SERVER file (00:17Z cron). Never mix them in
  trend analysis; filter rows by `baselineCapturedAt`.
- **D7. Every fresh pnl.db pull needs the WAL file too** — unless the bot is
  down (WAL checkpoints on shutdown).

## E. Communication contract (operator)

Authoritative memory files: `user-prefers-russian` (plain Russian, no
transliterated jargon, no scientific loanwords — «двойной порог» not
«гистерезис»), `explain-step-by-step-rule-one` (mechanism first, every
number defined in words with direction, ≤5-sentence summary with ≤4 numbers
FIRST, details after a separator, re-explain coined terms every session),
`mandatory-srez-verification` (trust is revoked: logs + full tx list + 
formulas + norms in every срез), `operator-wants-auto-scaling-params`
(derive constants from portfolio size, never hand-pick). Addresses and
signatures ALWAYS verbatim in full. The wallet:
`F3YvPiLdniRPGpeKrbeGWR2zg2wPpzVuvqBA5BBJBQ5S`.
