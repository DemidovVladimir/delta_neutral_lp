---
name: strategy-analyzer
description: Audit the live delta-neutral strategy after every срез (hodl-check run) — verify liveness, fee economics, and parameter sanity against fresh pnl.db + on-chain data, then keep-or-propose a strategy change. Never applies changes without explicit operator approval. Use right after hodl-check, or when the user asks "проверь стратегию", "что оптимизировать", whether current parameters are still right, or where fees are leaking.
---

# Strategy Analyzer — is the CURRENT strategy still the right one?

Runs after every срез. hodl-check answers "are we beating HODL"; this skill
answers "is the machine converting LP fees into net edge efficiently, and
should any lever move?" Output: a keep/change verdict with numbers. Any
change requires explicit operator approval (AskUserQuestion) — «если захотим
заапрувим, а нет так нет».

## Step 1 — Gather (all read-only)

```bash
pnpm hodl --json                     # срез (usually just ran via hodl-check)
pnpm dashboard --json                # net delta, band, carry, collateral, liq price
# Server pnl.db — ALWAYS copy the WAL too, hours of rows can live only there:
bash -c 'source deploy/hetzner/lib.sh; scp "${ssh_args[@]}" \
  "${HETZNER_USER}@${HETZNER_HOST}:/opt/delta-bot/data/pnl.db" \
  "${HETZNER_USER}@${HETZNER_HOST}:/opt/delta-bot/data/pnl.db-wal" <scratchpad>/'
# Campaign history (filter rows by baselineCapturedAt):
bash -c 'source deploy/hetzner/lib.sh; remote "cat /opt/delta-bot/data/hodl-history.jsonl"'
# LIVE params — trust the container banner, not the local .env:
bash -c 'source deploy/hetzner/lib.sh; remote "docker logs delta-neutral-bot 2>&1 | grep -m1 -A8 \"HEDGE IS LIVE\""'
# ADR-019/021 flags are NOT in the banner — read them from the container env:
bash -c 'source deploy/hetzner/lib.sh; remote "docker exec delta-neutral-bot printenv STRATEGY_VERSION HEDGE_LP_INPUT HEDGE_INCLUDE_WALLET_SOL LP_VOL_PAUSE_PCT_5M MAX_HEDGE_NOTIONAL_USD"'
```

Pool constants for the current pool `5rCf1DM8LjKTw4YqhnoLcngyZYeNnQqztScTogYHAS6`:
bin step 4 (0.04%/bin), base fee 0.04%, protocol fee 10%. Re-fetch via the
DLMM SDK (`pool.getFeeInfo()`, `pool.lbPair.binStep`) if the pool ever changes.

## Step 2 — Liveness (BUG-008 lesson: logs lie, data doesn't)

- Container `delta-neutral-bot` Up, RestartCount not climbing. A huge
  RestartCount + 1-cycle lifetimes = the BUG-014 signature (RPC quota dead;
  the loop's 5-error kill switch + Docker restart policy = crash loop).
- `hedge_actions`/`position_snapshots` MAX(taken_at) is recent; `pnl.db`
  advancing. Silence with a "✅ started successfully" log is the brick-loop
  signature.
- `data/hodl-cron.err` on the server holds only the benign bigint warning;
  history rows appear daily (00:17 UTC). The cron shares the bot's RPC key —
  a missing row right after an RPC incident is expected, not a new bug.
- Watchdog (ADR-024) alive: `/opt/delta-bot/data/watchdog.state` says
  `status=ok` and its mtime is < 10 min old (root cron */5 runs it); the
  operator got the daily 08:05 UTC «💚 живой» heartbeat.

## Step 3 — Fee & flow ledger since the last review (normalize to $/day)

From pnl.db (window = since previous analyzer run or campaign baseline):

| Metric | Source | Red line |
|---|---|---|
| LP fees earned | `rebalances.claimed_fees_*` + state `totalClaimedFees` | — |
| Net per position | `getRebalanceDecomposition` (pnlDb) / `pnpm pnl` section "NET RETURN PER CLOSED POSITION" — fees + IL − swap − network, LP-side only | positions with net < 0 in a calm market |
| Hedge churn | `hedge_actions`: count, Σ`size_usd`; fee ≈ Σ×6bps | churn fees > 25% of LP fees |
| Hedge flapping | alternating increase/decrease pairs share | > 30% of actions |
| LP rebalances/day | `rebalances` count | outside 2–40 |
| Swap cost | `swaps`: Σ input × (impact + ~5bps Ultra) | > 10% of LP fees |
| Network fees | `transactions.fee_sol` (populated since BUG-010 fix) | > 0.5 USD/day |
| Carry | dashboard `carryRateBps` × notional | APR beyond `HEDGE_CARRY_CAP_BPS` |
| **External flows** | on-chain SOL/USDC deltas from txs whose fee payer is NOT the wallet or the known operator wallet `F7p3dFrjRTbtRp8FRF6qHLomXbKRBzpvBLjtQcfcgmNe` — and operator top-ups too | ANY unexplained transfer |

External flows found → flag baseline distortion loudly (см. «Baseline
adjustments» ниже) — a deposit shows up as fake strategy profit.

## Step 4 — Parameter invariants (ADR-018 and friends)

- **Transaction audit (operator standing order 2026-07-07, MANDATORY):**
  `npx tsx scripts/tx-audit.ts --since <window> --db <pulled pnl.db>` — every
  wallet transaction listed with full signature, fee payer + amount, ΔSOL /
  ΔUSDC, class, and db cross-check; unexplained perps/meteora/jupiter rows
  are findings, not noise. Totals come with formulas spelled out.
- **Hedge liveness — NO silent gaps (BUG-015 lesson, MANDATORY every срез):**
  `hedge_actions` must have a row (any action incl. `none`) at least every
  ~3 cycle intervals while `HEDGE_ENABLED=true` and the bot is up. Check:
  `SELECT taken_at FROM hedge_actions WHERE taken_at >= '<window>' ORDER BY
  taken_at` → scan for gaps > 60s that do NOT coincide with bot downtime.
  A gap = the hedge silently not running (BUG-015 hid exactly this for days
  behind a debug-level skip; trades clustering 20–40s after recenters is
  the same signature). NEVER infer the hedge mechanism from trade patterns
  alone — row DENSITY first, then trades.
- The effective band is AUTO-derived since ADR-025 (`HEDGE_BAND_BINS` ×
  lpFullValueSol / binCount, floored by `DELTA_THRESHOLD_SOL`) — verify the
  floor still ≥ 3 bins' worth if the operator changed bin count or pool
  (per-bin delta = lpFullValueSol / binCount; on a fatter pool the bins are
  wider in PRICE but per-bin SOL delta only depends on value/binCount).
- `HEDGE_COOLDOWN_MS ≥ 600000` — the cooldown is the churn throttle.
- netΔ within band in ≥95% of hodl-history / snapshot samples.
- Projected collateral ratio ≥ `MIN_COLLATERAL_RATIO` + 0.1; liquidation
  price ≥ 1.3 × spot.
- LP range width (binCount × binStep) vs realized rebalance cadence: <2
  rebalances/day → range wastefully wide; >40/day → too narrow.
- ADR-021 protections armed: `LP_VOL_PAUSE_PCT_5M` > 0 (storm mode),
  `HEDGE_INCLUDE_WALLET_SOL=true` (idle hedged), `HEDGE_LP_INPUT=midpoint`;
  storm/clamp log lines (🌩 / "regime changed" / 🧊 frozen) reviewed for the
  window. NOTE: before 2026-07-07 (~13:31Z) "regime changed" could never
  appear (BUG-015) — do not treat its historical absence as calm.
- Combined hedge input can jump up to ~reserves (0.3 SOL) around the
  reserves floor and the above-range clamp — the band must stay ≥ that
  (0.25 is at the edge; a persistent netΔ near the band boundary right
  after recenters is this effect, not a leak).

## Tool: Range-geometry check (width & shape — spot/curve/bidask)

Run when the operator asks about bin count / range width / distribution
shape, when LP rebalances/day approach the red line, or when the `<15min`
lifetime bucket grows. First derived 2026-07-05 on live Campaign-2 data;
the scaling laws below let you answer geometry questions WITHOUT live A/B
experiments (a 1 USD/day effect drowns in noise for weeks on 100 USD capital).

**Data (one command):** `pnpm pnl` → section `POSITION LIFETIME BUCKETS`
(programmatic: `getPositionLifetimeBuckets(sinceIso?)` in pnlDb — fees, IL,
net, fees/|IL| per `<15min` / `15-45min` / `>45min` bucket).

**Scaling laws (verify against fresh data before relying on them):**
1. **Fees/day ∝ 1/width** — fees accrue only in the active bin,
   proportionally to our share of it (valid while our liquidity ≪ pool's,
   e.g. 100 USD vs 2.7M USD).
2. **IL(gamma)/day is width-independent** — IL per range traversal
   ≈ V×w/8 (V = position value, w = fractional width), traversals/day
   ∝ 1/w; the product depends only on the price path, not the grid.
   Sanity-check: avg IL per closed position should ≈ V×w/8 (measured
   2026-07-05: −0.081 USD avg vs 0.10 USD theoretical on 20 bins × 4bps — ✓).
3. Therefore **narrower = strictly better fee/IL ratio**, bounded only by
   (a) per-recenter tx costs — negligible since ADR-019 decoupled the hedge
   from recenters, and (b) the **trend tax**: the `<15min` bucket, recenters
   into a still-moving price (measured −0.22 USD/day). The trend tax is fixed
   by a re-trigger dampener, NOT by widening (widening pays ~half the fee
   income for the same cure).

**Shape rules for THIS architecture (auto-recenter + midpoint hedge):**
- **Spot** — correct. Uniform density, delta linear in price, midpoint
  hedging exact.
- **Curve** — emulates a narrower spot with dead tails; composition crosses
  the imbalance threshold FASTER → more recenters, worse `<15min` bucket.
  Meteora positions it for stables/calm pairs. Wrong for SOL/USDC here.
- **BidAsk** — liquidity at the edges, thinnest exactly where our recenter
  puts the price (center). A directional-view/DCA tool; anti-fit for a
  delta-neutral recentering loop. Do not use.

**Decision template** (fill with fresh $/day numbers): widening W× costs
`fees/day × (1 − 1/W)` and saves only `(trend tax) + (recenter tx costs ×
(1 − 1/W))`. On 2026-07-05 data: 2× widening = −1.16 + 0.22 ≈ −0.94 USD/day
→ rejected. Revisit if the market enters a sustained trend regime (long
one-way traversals, recenters > 40/day, `<15min` bucket dominating) — then
consider a dampener FIRST, then moderate widening (e.g. 30 bins), never
curve/bidask for this loop.

## Tool: Hedge-economics & idle-capital check («правильная траектория» с хеджем, стейл-суммой и свопами)

Run on every срез (cheap — reuses data already gathered) and whenever the
operator worries the hedge "loses money", the wallet balance looks off, or
swaps seem excessive. Codified 2026-07-05 after the operator's drawdown
review. Core mental model to re-verify each time, WITH numbers:

**The machine's equation: profit = LP fees − gamma(IL) − costs.** Direction
of SOL is absent by construction. The hedge is a MIRROR, not insurance that
can "не сработать": every dollar the short loses, the SOL side gained (and
vice versa). A negative short uPnL is NEVER a loss by itself — always show
it next to the offsetting side. The only real hedge costs, recompute per
срез and normalize to USD/day:

1. Carry: |carryRateBps|/10000 × perpNotionalUsd / 365 (dashboard).
2. Trade fees: 6bps × Σ|size_usd| of the window's hedge_actions.
3. Locked-collateral opportunity: collateral / LP value × (LP fees per day).

Red line: (1)+(2)+(3) > 30% of LP fees/day → hedge is too expensive for the
income; look at churn first, then collateral ratio.

**Mirror check (did neutrality actually hold?):** over the window, portfolio
vs HODL-as-is should move ≈ (fees − IL − costs), NOT with the SOL price.
If the edge visibly breathes with price → un-hedged delta somewhere: check
netΔ in band %, the out-of-range clamp regime, idle-SOL inclusion flag, and
whether a top-up arrived (external flows step).

**Collateral proportionality:** collateral ≈ 0.5 × notional ≈ 1:4 of working
capital — NOT 1:1 of the pool sum (operator worried about this; the deposit
is a returnable margin, not a wager). Check `collateralRatio` ≥ min + 0.1
and liq price ≥ 1.3 × spot. If collateral drifts toward 1:1 of working
capital, something is wrong — flag it.

**Idle wallet SOL policy (стейл-сумма):** current policy B = always hedged
(`HEDGE_INCLUDE_WALLET_SOL=true`), full-portfolio neutrality. Verify:
- idle = walletSol − reserves; the hedge input includes it; the combined
  input is INVARIANT to recenter-phase wallet↔LP transfers (they cancel) —
  only real swaps move it. If hedge trades correlate with recenters again,
  that invariant broke — investigate.
- A sudden idle jump = probably an operator top-up → run the external-flows
  check and the baseline adjustment BEFORE the next срез verdict.
- Directional SOL treasury belongs on the operator's hot wallet
  (`F7p3dFrjRTbtRp8FRF6qHLomXbKRBzpvBLjtQcfcgmNe`), not on the bot — remind
  when idle stays large for days.
- Policy C (hedge idle only on a drawdown trigger) was analyzed and REJECTED
  without a backtest: it is a stop-loss — every false alarm (dip that
  recovers) permanently locks the trigger-depth loss; crypto dips vastly
  outnumber crashes. Revisit only with the simulator and a trigger no
  tighter than −15%.

**Exit-trap reminder (вся соль):** never "close the pool and hold as-is" —
a one-sided exit is a bag of the depreciating asset (the 6h outage cost
−1.01 USD IL, the single worst row in the decomposition). Every exit path
must end in one of: re-enter (recenter), hedge the bag (out-of-range clamp /
storm mode), or full USDC exit (`pnpm derisk`). If a review finds any state
where funds can sit one-sided AND unhedged AND unpaused — that is a bug
(cf. BUG-011), file it.

**Swap-trajectory check:** swaps should exist ONLY as real conversions
(recenter shortfalls, alignment) — each one legitimately moves the hedge
target the opposite way. Verify per window: swap count and volume vs
rebalance count (ratio ≪ 1 is healthy — the wallet buffer absorbs most
recenters), avg price impact < 0.1%, oracle-gate refusals investigated
(repeated refusals in calm markets = stale oracle, not manipulation).

## Step 5 — Verdict and proposal

1. **Все инварианты в норме** → «стратегия подтверждена, менять нечего» +
   the $/day ledger. Done.
2. **Что-то красное** → draft ONE concrete proposal (the dominant lever
   first): current value → proposed value, expected $/day impact (from the
   measured ledger, not vibes), risk, rollback. Candidate levers, in usual
   order of dominance: hedge band / cooldown → pool choice (bin step & base
   fee via `pnpm find-pools`) → `AUTO_TUNE_BIN_COUNT` / imbalance threshold →
   collateral ratio → deposit size.
3. Present via AskUserQuestion (approve / reject / modify). **NEVER edit
   .env, redeploy, or touch the baseline without the approval.** Deploy needs
   the operator anyway (auto-mode blocks `pnpm deploy:hetzner`).
4. After an approved change: deploy, verify the new banner values +
   container Up ≥5 min + first cycles in band, then log one line in
   `progress.md` (date, verdict, what changed / what was rejected).

## Baseline adjustments (external flows)

If the operator deposited/withdrew mid-campaign, offer (do not auto-pick):
- adjust the baseline side amounts by exactly the flow (keeps history rows
  comparable; note it in the baseline's `note`),
- or re-init the baseline (kills cross-campaign comparability),
- or ignore (verdict stays polluted by the flow amount — say by how much).

## Reporting

Russian, numbers verbatim, addresses/signatures ALWAYS in full. Lead with
the verdict («стратегия ок» / «предлагаю изменение X»), then the ledger
table, then details. APRs from windows <3 days are noise — say so.
