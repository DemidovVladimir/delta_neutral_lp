---
name: lp-army-playbook
description: Meteora DLMM domain knowledge distilled from 14 LP Army bootcamp sessions, reconciled against measurements taken on THIS bot's own pools. Use when choosing or comparing DLMM pools, questioning bin step / range width / fee tier, judging whether a pool is alive, translating pool-level fee density into expected return on our concentrated capital, budgeting rent and transaction costs, or when the operator asks "какой пул лучше", "почему пул умер", "что говорит комьюнити про X", "стоит ли менять шаг бина". Community claims are labelled by strength — never quote one as fact without checking the Verified section first.
---

# LP Army playbook — Meteora DLMM domain knowledge

Distilled from 14 Meteora "LP Army" bootcamp sessions (Nov–Feb, ~24 hours of
video, 830 extracted claims) and then **reconciled against on-chain and
`pnl.db` measurements taken on our own two SOL/USDC pools on 2026-07-28**.

The bootcamps teach MANUAL, DIRECTIONAL, memecoin LPing. We run an AUTOMATED,
DELTA-NEUTRAL, blue-chip position. Most of the tape does not transfer. This
skill exists to keep the parts that do, and to mark loudly the parts that
don't — so nobody re-imports a memecoin heuristic into a hedged SOL/USDC bot.

**Reading rule.** Every community claim carries a strength label:
`consensus` (several sessions agree) · `single-source` (one session) ·
`disputed` (instructors contradicted each other on air). A `consensus` label
means "many people said it", NOT "it is true for our pools". The Verified
section below outranks all of them.

Full material: `reference/knowledge-base.md` (10 topic sections),
`reference/numeric-index.md` (40 thresholds), `reference/disagreements.md`
(15 open contradictions), `reference/sources.md` (video list + provenance).

---

## 1. VERIFIED on our pools (2026-07-28) — this outranks the videos

Measured with `scripts/pool-fee-depth.ts` (in this skill dir) plus a full scan
of all 179 position-open transactions in `data/pnl.db`. SOL was 73.17 USD,
cross-checked Jupiter Lite v3 vs Pyth Hermes.

| | old pool `5rCf1DM8LjKTw4YqhnoLcngyZYeNnQqztScTogYHAS6` | campaign pool `BGm1tav58oGcsQJehL9WXBFXF7D27vZsKefj4xJKD5Y` |
|---|---|---|
| bin step / base fee | 4 / 0.0400% | 10 / 0.1000% |
| `variableFeeControl` | 120000 | 40000 |
| `maxVolatilityAccumulator` | 300000 | 350000 |
| volatility accumulator when measured | 21252 = **7.1%** of max | 1567 = **0.4%** of max |
| fee at that moment | 0.0402% (**1.005x** base) | 0.1000% (**1.000x** base) |
| max achievable total fee | 0.2128% (**5.32x** base) | 0.5900% (**5.90x** base) |
| pool TVL | ≈4.60M quote units | ≈2.79M quote units |
| TVL within ±10 bins | 197,843–246,320 over ±0.40% = 4.30–5.32% | 165,679 over ±1.00% = 5.94% |
| **concentration multiplier at our width** | **18.8–23.3x** | **16.8x** |
| **depth per 1% of price movement** | **≈247k–308k USD** | **≈83k USD** |

**The multiplier is a SNAPSHOT, not a constant.** The two old-pool readings
above are one hour apart on the same day — other LPs move liquidity and the
ratio moved 23.3x → 18.8x. Re-measure before leaning on it; treat any single
reading as ±25%.

Realized fee density from 175 closed positions (fees ÷ capital ÷ time in pool):

| pool | positions | capital-hours | fees | density on OUR capital |
|---|---|---|---|---|
| old | 135 | 96.8 | 10.49 USD | **2.784 %/day** |
| campaign | 40 | 187.4 | 9.42 USD | **1.273 %/day** |

### The five findings that matter

1. **Concentration multiplier ≈ 17–23x at our 19–21 bin width.** Pool-average
   fee density and our realized density are different units and differ by this
   factor. Cross-check: realized ÷ multiplier gives 0.119–0.148 %/day (old,
   across the two snapshots) and 0.076 %/day (campaign), against separately
   measured pool densities of 0.142 and 0.088. The old-pool range brackets its
   measured value; the campaign figure sits ≈14% low, consistent with time
   spent out of range (recenters + ADR-026 re-entry wait). Do NOT claim a
   precise capture-efficiency number from this — the multiplier's own drift is
   larger than the residual.
   → The entry criterion (pool density ≥ 0.15 %/day) is measured in POOL units
   and compared against a POOL-units threshold. It is internally consistent.
   **Do not "correct" it.** 0.15 %/day pool-side ≈ 2.5–3.5 %/day on our capital.
   ⚠ **2026-09-25 (BACKLOG A26): density is internally consistent but does
   NOT predict net profit** — gross fees are matched by traversal loss.
   The go/no-go metric is now R = (LP fee flow ÷ depth D per unit ln-price)
   ÷ (σ_d²/2); R < 1 loses at any width. On 2026-09-24 the campaign pool
   PASSED density (0.266) with R 0.71–0.80.

2. **The dynamic fee component on our bin steps is currently ZERO.** Ceiling is
   real (5.3–5.9x base) but only reachable at extreme volatility. The variable
   fee scales with the SQUARE of bin step, so the bootcamp's 2.5–4.4x
   multipliers — all measured on bin steps 100–250 — do NOT transfer to bin
   steps 4 and 10. Our density formula using base fee alone understates by
   effectively nothing in normal conditions.

3. **FALSIFIED 2026-07-28 — the volatility accumulator is NOT a liveness
   gauge.** This section previously claimed the accumulator ÷ its max was a
   cheap one-call substitute for the density calculation. Testing it on both
   pools the same day killed it:

   | pool | 7d avg volume | tx/day | accumulator readings that day | latest ÷ max |
   |---|---|---|---|---|
   | old (**alive**) | 19.47M | 11,325 | 21252 → 410 | **0.14%** |
   | campaign (**weak**) | 2.87M | 1,971 | 1567 → 10000 | **2.9%** |

   The weaker pool read **20x higher**. The accumulator is a sub-10-minute
   volatility reading (`filterPeriod` 30s, `decayPeriod` 600s), so it answers
   "is price crossing bins in the last few minutes", not "does this pool get
   flow". Single reads swing by 50x within hours on the same pool.
   → **Never use it to judge a pool.** For liveness use transactions per hour
   and turnover (volume ÷ TVL) over 7 days. The bootcamps' "dynamic fee stuck
   at base = dead pool" heuristic does not survive on low bin steps, where the
   variable fee is near zero even in healthy pools.

4. **Depth, not fee tier, decides routing on a blue-chip pair.** The old pool
   charges 2.5x LESS and is 3x DEEPER per 1% of price movement — which is why
   flow goes there. Comparing candidate pools on base fee alone is wrong;
   normalize liquidity to price width (TVL in ±N bins ÷ total width in %).

5. **Bin-array rent is a non-issue for us. Measured, not assumed.** All 179
   opens scanned, zero missing: exactly one rent amount ever appears,
   `0.057406080 SOL` (position account, x176), and the close transaction
   drains the same account for the same amount. **Zero non-refundable
   bin-array rent, ever.** Both pools are mature enough that every array we
   touch is already funded by someone else. Do not add this cost to the
   simulator; do not let it inflate the sim-edge threshold.

---

## 2. Fee mechanics

**Resolved dispute — how base and dynamic fee combine.** The bootcamps split
6-vs-2 on whether the trader pays base PLUS a variable component or whether the
displayed "dynamic fee" IS the all-in rate. Our SDK reading settles it: the
MECHANISM is additive (`total = base + variable`), and the DISPLAYED number is
the total. `getFeeInfo().baseFeeRatePercentage` is the floor;
`getDynamicFee()` returns base + variable. Both camps were describing the same
thing from different ends. Verified: base 0.0400% + computed variable 0.00087%
= 0.04087%, against a live `getDynamicFee()` of 0.0402% (the gap is read
timing, the accumulator decays between calls).

Formula, confirmed against on-chain parameters:

```
variable_fee_pct = variableFeeControl * (volatilityAccumulator * binStep)^2 / 1e11 / 1e9 * 100
total_fee_pct    = base_fee_pct + variable_fee_pct        (hard-capped at 10%)
base_fee_pct     = binStep * baseFactor * 10 / 1e9 * 100
```

The `binStep^2` term is the whole reason bootcamp fee numbers do not transfer:
bin step 10 versus bin step 100 is a 100x difference in variable fee for the
same volatility.

Other decay parameters on both our pools: `filterPeriod` 30s, `decayPeriod`
600s, `reductionFactor` 5000.

Community, still useful:
- `consensus` Total fee on any DLMM pool is hard-capped at 10%. Max selectable
  base fee is 5%. Base fee is immutable after pool creation.
- `consensus` The dynamic fee is driven by how many bins price crosses and how
  often. Oscillation inside two adjacent bins does not trigger it; a sustained
  directional sweep does.
- `single-source` Per-config ceilings measured by the community on large bin
  steps: 250-bin/5% → ≈10%; 200-bin/2% → 8.75%; 125-bin/5% → 7.68%;
  100-bin/2% → 3.65–3.68%; 100-bin/1% → 2.6–2.65%.
- `consensus` Fees are NOT auto-compounded in DLMM — they sit outside the
  position until claimed or swept by withdraw-and-close. (Dynamic/AMM pools do
  the opposite.) Matches our `claimed_fees_sol` / `claimed_fees_usdc` handling.
- `consensus` A claimed-fee figure is stamped in USD at claim time and never
  re-prices; unclaimed fee value tracks live price. Relevant when reconciling
  срез numbers against UI screenshots.
- `disputed` Meteora protocol fee: 4 sessions say 0% on regular pools, 1 says
  5% of the dynamic fee. Assume 0% but verify on-chain if it ever matters.

---

## 3. Pool selection — what applies to a blue-chip pair

**The bootcamps' headline rule (volume ÷ TVL is decisive, `consensus`, 9 of 14
sessions) is a MEMECOIN rule.** For stable and blue-chip pairs the same
instructors invert it:

- `consensus` For stables and blue chips, **TVL depth is the dominant
  criterion** — a high fee tier simply never gets routed. On USDC/USDT they
  pick the deepest pool (bin step 1, base fee 0.01%) and explicitly reject the
  5% pools.
- `single-source` **Undercutting on fee alone does not beat a deep incumbent.**
  A 730,000-TVL pool at 0.3% cannot be beaten by a new 0.2% pool; a new
  SOL/USDC pool needs at least 100,000 USD of concentrated liquidity and will
  usually still lose. ← Confirmed by our own depth measurement (finding 4).
- `consensus` **Higher TVL does NOT mean higher fees** — DLMM liquidity can sit
  anywhere in the range, so headline TVL may be parked far from where trades
  execute. Only depth AT the traded price counts. ← This is exactly what our
  concentration multiplier measures.
- `consensus` Depth is a hard routing constraint, not a preference: a bin
  holding 100 USD cannot fill a 300 USD trade and the router sends it
  elsewhere. Large trades follow depth, small trades follow the cheaper fee.
- `consensus` Holding-period rule: leaving a position alone for days → larger
  bin step and larger fee; actively re-centring → smallest bin step and fee.
  Our bot re-centres constantly, which is consistent with our bin step 4 / 10.

**Procedure for comparing two candidate pools for our pair** (validated
end-to-end on 2026-07-28):

1. **Liveness** — transactions per hour and turnover (volume ÷ TVL) over 7
   days. Do NOT use the volatility accumulator for this; see finding 3.
2. **Depth** — TVL within ±(our half-width) bins, normalized to price width →
   depth per 1% (finding 4). Deeper wins routing on large trades.
3. **Density** — `avg_daily_volume × base_fee ÷ TVL`, averaged over **7 full
   days**, never point-in-time. Threshold 0.15 %/day, in pool units. Exclude
   the current partial day or it drags the average down.
4. **Fee handicap** — when the candidates have different base fees, the
   cheaper pool must beat the other on TURNOVER by at least the fee ratio to
   win. Old vs campaign: base fees differ 2.5x, so the old pool needs >2.5x
   the turnover. (Equivalent to just comparing densities; keep both forms
   because the operator's A24 note is written in turnover terms.)
5. **Expected return on our capital** = pool density × concentration
   multiplier for the width we would actually run. This is GROSS — it ignores
   divergence loss and hedge carry. Do not attach a capture-efficiency
   constant; the multiplier's own drift is larger than any such correction.
6. Only then run the weekly simulator edge check. Density passing is
   necessary, not sufficient — **both** criteria must clear before entry.

---

## 4. Bins, range width, position mechanics

- `consensus` **69 bins maximum per position** — a Solana account-size limit.
  Wider ranges silently split into multiple positions (138 bins = 2 positions,
  139 → 3, 442 → 7). Our 19–21 bin positions are far inside this; only matters
  if bin count is ever raised dramatically.
- `consensus` `next_bin_price = current × (1 + binStep/10000)`. Bin step 4 =
  0.04% per bin; bin step 10 = 0.10% per bin.
- `consensus` Reachable width = bin step × 69 bins: bin step 20 → ≈17%,
  bin step 100 → 40–49%, bin step 250 → 81% price drop. Max bin step 400.
- `consensus` The base fee constrains which bin steps are selectable — the two
  are mathematically coupled. A very low base fee cannot be paired with a large
  bin step.
- `consensus` **A position's bin range cannot be changed after creation** —
  close and reopen, or open an additional position. The SHAPE can be changed in
  place by withdrawing 100% and re-adding, which preserves the position rent.
- `consensus` `withdraw liquidity` ≠ `close position`. Withdrawing empties the
  bins but keeps the account, the range and the locked rent, and does NOT claim
  fees. `withdraw and close` claims fees, removes liquidity and returns rent.
  Our Phase-1 pipeline does withdraw+claim+close atomically — correct.
- `consensus` Only ONE bin is active at a time and only that bin holds both
  tokens; every bin above holds one token and every bin below the other.
- `disputed` Tighter bin step: 5 sessions argue it captures more volume and
  more dynamic fee; 2 argue against because bid-ask/curve shapes break across
  multi-position splits and tight ranges demand constant monitoring. For an
  automated spot-only position the objections do not apply.

---

## 5. Costs and rent

Measured on our own history (section 1, finding 5) — these community figures
are reference for pools we do NOT already trade.

- `consensus` Position rent ≈0.05 SOL, **fully refundable** on close. Our
  measured exact value: `0.057406080 SOL`.
- `consensus` Bin-array rent **0.07 SOL per array, NEVER refundable**, paid
  only when depositing into price territory that has never held liquidity. A
  pristine pool needs 2 arrays = 0.14 SOL for the first position.
- `consensus` Pre-flight check: if the "SOL needed to create position" figure
  exceeds ≈0.05 SOL, the excess is non-refundable bin-array cost. Instructors
  call the unread fee breakdown the single most common way people lose money on
  Meteora. **Relevant to us only if we ever move to a fresh pool or widen far
  outside existing liquidity.**
- `consensus` Runaway examples worth knowing: a lower bound set to 2 USD needed
  6,932 bins across 101 positions; a −99% range produced 52 positions and ≈3
  SOL burned; a bin-step-1 pool over ±10% needed 30 positions and 23 new
  arrays.
- `single-source` **Known Meteora bug:** opening a very tight position on bins
  whose arrays were rented very recently can charge array rent a SECOND time;
  workaround is widening the range by 1–2 bins. One instructor lost 2–3 SOL to
  it. Only shows up on extremely volatile pools — worth remembering if an
  unexplained ≈0.07 SOL outflow ever appears in `tx-audit.ts`.
- `disputed` Pool creation cost: 0.03 SOL (two sessions) vs 3 SOL (one, on air,
  contradicted immediately and left unresolved).
- `consensus` When deposits or withdrawals repeatedly fail to land, raise the
  PRIORITY FEE, not just slippage. Switching RPC is the other lever.
- `consensus` Two independent slippage settings exist — SWAP slippage and
  LIQUIDITY slippage — and the `exceeded bin slippage tolerance` error is about
  the latter, regardless of bin count. Low bin steps need more of it.
- `disputed` Liquidity-slippage values range 1.5% to 50% across instructors.
  No usable consensus; for a deep blue-chip pair the low end is right.

---

## 6. Tools worth knowing

- **metlex.io** — community screener. `DLMM-100` (top pools with fee / volume
  window / TVL-bound filters, sortable by volume-to-TVL), `Pools` (every pool
  for a mint with 1m/5m/1h/6h/24h windows — sub-24h volume the Meteora UI does
  not show), `Dex` (all venues for a token, per-pool volume and buy/sell
  counts), `PnL` (feed it a transaction SIGNATURE, not a wallet). Useful as an
  independent cross-check on our own venue comparisons.
- **lp4fun / lpfor.fun** — read-only open-position monitor by wallet address.
  Independent second opinion on live LP PnL. **Caveat (`single-source`): it
  denominates in SOL while metlex denominates in USDC** — a real source of
  wrong conclusions when the SOL price itself has moved. Its "invested amount"
  also sums redeposits, so it overstates capital at risk.
- **GeekLad's tool** — whole-wallet DLMM performance with date filters, CSV
  export and a downloadable SQLite database of all transactions.
- **GMGN (gmgn.ai)** — chart aggregator across ALL pools for a token, plus net
  buy/sell volume per timeframe. The bootcamps' reason for preferring an
  aggregator over a single-pool chart applies to us too: one pool's chart
  misleads.
- **Solscan → DeFi Activities** — enumerate every add/remove-liquidity and swap
  with signatures. Our `scripts/tx-audit.ts` supersedes this, but it is the
  fallback when the DB is suspect.
- `consensus` Generic portfolio trackers misreport DLMM because they still
  count deposited tokens as held. Use DLMM-aware tools.
- `consensus` Report profitability in the QUOTE token — quote-denominated
  results come straight off chain while USD figures depend on an oracle that
  lags. SOL- and USD-denominated PnL can have OPPOSITE SIGNS on the same
  position. ← This is the same rule as our canonical-frames / USD-metric rule.

---

## 7. What does NOT transfer to this bot

Read this before importing any bootcamp idea.

- **Every directional shape.** Bid-ask, curve, the bid-ask flip, the
  "toothpaste", fee-recompounding above price, one-sided SOL entries — all of
  them are bets on direction or on mean reversion. We run spot and hedge delta
  to zero. A one-sided or bid-ask position breaks the hedge input, which
  assumes symmetric composition.
- **Memecoin fee-tier lifecycle** (250-bin/5% → 125-bin/5% → 100-bin/2% →
  1%). We hold one blue-chip pair on a fixed pool.
- **Manual chart-timed entry** — MACD crossovers, RSI 70/30, Heikin Ashi,
  watching 1-minute net buy volume. These are discretionary scalping signals on
  thin memecoin tape. Our ADR-023 выдержка and ADR-026 re-entry wait solve the
  same problem (filter noise, demand confirmation) mechanically and are
  backtestable. Do not replace a measured filter with a chart heuristic.
- **Rug checks, bubble maps, holder concentration, wash-trade detection.**
  Irrelevant for SOL/USDC. Would matter only if a new pair were ever
  considered.
- **"Impermanent loss cannot be computed in advance"** (`disputed`, one
  instructor). False for us — the Rust simulator computes exactly this on real
  price paths. Our tooling is ahead of the community here; do not defer to the
  video.
- **Pool creation.** We join existing pools. The creation material is kept only
  because it explains the cost structure and the fee/bin-step coupling.
- **MET points optimisation** (1 point per USD of TVL per day, 1,000 points per
  USD of fees per day). Not a strategy input; noted because it distorts other
  LPs' behaviour and therefore pool TVL.

---

## 8. Reusable measurement

`scripts/pool-fee-depth.ts` in this skill directory reports, for any DLMM pool:
base fee, current fee, pool-specific max fee, the volatility-accumulator
liveness ratio, and the TVL distribution around the active bin with
concentration multipliers.

```bash
set -a && source .env && set +a
NODE_PATH=$PWD/node_modules npx tsx \
  .claude/skills/lp-army-playbook/scripts/pool-fee-depth.ts <pool> [<pool> ...]
```

Read-only, two RPC round trips per pool. Promote it to the project's
`scripts/` directory (and document it in CLAUDE.md) if it becomes routine at
every срез.

To re-check bin-array rent over history, scan position-open signatures for
accounts funded from zero — any amount other than the ≈0.0574 SOL position
rent is bin-array rent and is not coming back.

---

## 9. Sources and gaps

14 of the 15 requested bootcamp sessions were transcribed and mined. The
Spanish Day 2 session (`nyHSuqW8iGY`) has **no retrievable subtitle track** —
YouTube returns an empty caption response for every language and format, so it
is NOT represented here. Given the Spanish Day 1 session overlapped heavily
with the English curriculum, the loss is likely small but is unquantified.

Full provenance, video IDs and per-session coverage: `reference/sources.md`.
