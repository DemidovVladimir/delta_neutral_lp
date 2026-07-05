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
```

Pool constants for the current pool `5rCf1DM8LjKTw4YqhnoLcngyZYeNnQqztScTogYHAS6`:
bin step 4 (0.04%/bin), base fee 0.04%, protocol fee 10%. Re-fetch via the
DLMM SDK (`pool.getFeeInfo()`, `pool.lbPair.binStep`) if the pool ever changes.

## Step 2 — Liveness (BUG-008 lesson: logs lie, data doesn't)

- Container `delta-neutral-bot` Up, RestartCount not climbing.
- `hedge_actions`/`position_snapshots` MAX(taken_at) is recent; `pnl.db`
  advancing. Silence with a "✅ started successfully" log is the brick-loop
  signature.
- `data/hodl-cron.err` on the server holds only the benign bigint warning;
  history rows appear daily (00:17 UTC).

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
| Network fees | `transactions.fee_sol` (populated since BUG-010 fix) | > $0.5/day |
| Carry | dashboard `carryRateBps` × notional | APR beyond `HEDGE_CARRY_CAP_BPS` |
| **External flows** | on-chain SOL/USDC deltas from txs whose fee payer is NOT the wallet or the known operator wallet `F7p3dFrjRTbtRp8FRF6qHLomXbKRBzpvBLjtQcfcgmNe` — and operator top-ups too | ANY unexplained transfer |

External flows found → flag baseline distortion loudly (см. «Baseline
adjustments» ниже) — a deposit shows up as fake strategy profit.

## Step 4 — Parameter invariants (ADR-018 and friends)

- `DELTA_THRESHOLD_SOL ≥ 3 × (maxLpSol / binCount)` — smaller trades on
  per-bin composition noise (sell low / buy back high, systematically).
- `HEDGE_COOLDOWN_MS ≥ 600000` — the cooldown is the churn throttle.
- netΔ within band in ≥95% of hodl-history / snapshot samples.
- Projected collateral ratio ≥ `MIN_COLLATERAL_RATIO` + 0.1; liquidation
  price ≥ 1.3 × spot.
- LP range width (binCount × binStep) vs realized rebalance cadence: <2
  rebalances/day → range wastefully wide; >40/day → too narrow.

## Tool: Range-geometry check (width & shape — spot/curve/bidask)

Run when the operator asks about bin count / range width / distribution
shape, when LP rebalances/day approach the red line, or when the `<15min`
lifetime bucket grows. First derived 2026-07-05 on live Campaign-2 data;
the scaling laws below let you answer geometry questions WITHOUT live A/B
experiments (a $1/day effect drowns in noise for weeks on $100 capital).

**Data (one command):** `pnpm pnl` → section `POSITION LIFETIME BUCKETS`
(programmatic: `getPositionLifetimeBuckets(sinceIso?)` in pnlDb — fees, IL,
net, fees/|IL| per `<15min` / `15-45min` / `>45min` bucket).

**Scaling laws (verify against fresh data before relying on them):**
1. **Fees/day ∝ 1/width** — fees accrue only in the active bin,
   proportionally to our share of it (valid while our liquidity ≪ pool's,
   e.g. $100 vs $2.7M).
2. **IL(gamma)/day is width-independent** — IL per range traversal
   ≈ V×w/8 (V = position value, w = fractional width), traversals/day
   ∝ 1/w; the product depends only on the price path, not the grid.
   Sanity-check: avg IL per closed position should ≈ V×w/8 (measured
   2026-07-05: −$0.081 avg vs $0.10 theoretical on 20 bins × 4bps — ✓).
3. Therefore **narrower = strictly better fee/IL ratio**, bounded only by
   (a) per-recenter tx costs — negligible since ADR-019 decoupled the hedge
   from recenters, and (b) the **trend tax**: the `<15min` bucket, recenters
   into a still-moving price (measured −$0.22/day). The trend tax is fixed
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
(1 − 1/W))`. On 2026-07-05 data: 2× widening = −$1.16 + $0.22 ≈ −$0.94/day
→ rejected. Revisit if the market enters a sustained trend regime (long
one-way traversals, recenters > 40/day, `<15min` bucket dominating) — then
consider a dampener FIRST, then moderate widening (e.g. 30 bins), never
curve/bidask for this loop.

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
