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

### A2. Collateral starvation guard (BUG-013 family) — DESIGN, needs approval
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

### A8. Scaling 130 → 300+ (operator decision, after clean срезы)
Everything auto-scales (cap ADR-022, band ADR-025, collateral = ratio). The
ONLY knobs to change: `AUTO_TUNE_DEPOSIT_AMOUNT` (currently 0.61 SOL) and
the wallet funding itself. Protocol: (1) at least 2 clean срезы on Campaign
3 with vs-USDC trend ≥ 0 on calm days; (2) re-run the simulator pool grid on
CURRENT Campaign-3 data (fee model was validated only at 4 bps — see D2);
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
  2.049970 for Campaign 3). On a price DROP this term is positive (the
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
