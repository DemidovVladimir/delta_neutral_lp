# Futility check on public pump.fun tapes (A27 external pilot, PROTOCOL §14)

**Date:** 2026-09-25.
**Status:** informational pilot. It is kill-only: public tapes can never promote anything.
**Code:** `research/memecoins/backtest/`. **Raw outputs:** `research/memecoins/results/raw/`.
**Ledger:** `research/memecoins/results/variant_ledger.csv`.

> **Follow-up (2026-09-25, after this report).** HYPOTHESES.md Amendment A1 records H02, H05 and
> H09 as operationally killed, freezes C1 = `H17 · [0.05, 0.2) SOL · XB`, and pre-registers a
> two-look test on unselected collector data:
> - look 1: the backfilled week 2026-09-18 … 2026-09-24;
> - look 2: live days 2026-09-25 … 2026-10-22.
>
> Hashes are in `raw/hypotheses-amendment-A1.sha256`.
>
> **Update, same day.** Look 1 ran early on operator order (Amendment A1.2 overrides the void rule
> and uses 1-hour-block CIs) on collector data for 2026-09-23 … 25. **C1 was KILLED:** −2.99 %
> [−3.55, −2.45], n = 3,480. The tape's positive launch pocket was a selection artefact. See
> `collected-data-2d.md`.

## 0. Bottom line

1. **The one usable tape does not qualify for a formal PROTOCOL kill.** That tape is van de Wouw's.
   - It fails G1 at the letter: 23.2 % of mints have reserve-chain gaps.
   - It has no slots, no fee fields and no PumpSwap trades.
   - Its token set is **outcome-selected**: coins that graduate are 2–7× more likely to be on it
     than coins that do not.

   Everything below is therefore an *operational* verdict under a rule written before the
   results. Negative numbers are conservative. Positive numbers are suspect.
2. **Killed under that rule: H02 (organic breadth), H05 (near-graduation run-up) and
   H09 (copycat wave).**
   - H02 is killed under all three data treatments.
   - H05 and H09 are each killed under two of the three.
3. **Flow-following entries lose money at our real latency.**
   - Covered families: velocity, net buy pressure, breadth, smart-wallet consensus, KOL
     following, near-graduation run-up, copycat wave, dip-buy.
   - At the protocol's primary setting (L = 2 s), every variant of H02, H03, H05, H06, H10
     and the H07 control has a 95 % upper bound below zero. So do most variants of H01 and
     H09.
   - This holds on a tape biased *towards* winners, and with a favourable migration-exit
     assumption.
   - H03, H06 and H10 escape the pre-stated kill only at the zero-latency best case.
     The latency tax between that case and 2 s is 5–16 percentage points per trade.
4. **The only positive pockets are entries at or near launch, where the curve bounds the
   downside.**
   - H17: small creator buy of 0.05–0.2 SOL with the bracket exit XB. **+11.5 % per trade,
     CI [+7.7 %, +16.9 %], at L = 2 s**; +4.9 % at L = 10 s.
   - H13: the ML ceiling, +4.9 … +26.9 % out of fold.
   - This is exactly where the tape's selection bias is strongest. Four partial de-biasing
     attempts did not remove the H17 result, but none of them can fully correct the selection.
5. **Avoid-lists work as loss avoidance.** Flagged coins do 2–14 percentage points worse in every
   primary-treatment cell for F04 (holder concentration) and F01 (bundled launch), in every
   30 s-entry cell for F03 (ring presence), and in every cell for "no creator buy".
6. **PROTOCOL §11.1's campaign-level futility stop is not triggered on this tape.** H13 is > 0
   out of fold, and some H01–H13 variants are > 0 at L = 2 s.

**Honest read (details in §10):** the campaign is not dead, but most of its grid probably is.
Sixty days of our own *unselected* collection are still worth it. Only that data can tell a real
launch-time edge (H17-small, H13) from the tape's survivorship. The post-BOOST exit families
(H15/H16) can only be judged there too. The expected outcome remains failure at S3/S4.

---

## 1. Datasets

| | van de Wouw pump.fun DB | RED-PUMP-2026-v1 |
|---|---|---|
| DOI | https://doi.org/10.5281/zenodo.22306254 | https://doi.org/10.5281/zenodo.21923106 (v1.4, corrigenda v1.3/v1.4) |
| Author, licence | Niek van de Wouw, published 2026-09-04, **CC-BY-4.0** | Arati Kamat, 2026-08-13, **CC-BY-4.0** |
| File(s) | one SQLite file `pumpfun_database.db`, 23,971,725,312 bytes | `red_pump_2026_v1_launches.jsonl.gz` (47.9 MB), `red_pump_2026_v1_outcomes.csv.gz` (43.6 MB) plus docs |
| Integrity | md5 `e7ff0d1edfe604331388ad423af4856c`, verified after download and again after analysis | SHA256SUMS verified |
| Downloaded | the whole file: it is one SQLite database whose table and index pages interleave, so no clean subset exists. It lives under `data/public/` (gitignored) and can be re-fetched with `data/public/fetch_vdw.sh` (resumable, ≈ 40 min at ≈ 10 MB/s) | everything |
| Period | **28 collection days between 2026-04-28 and 2026-07-13, with holes.** No data on 2 May, 5–7 May, 12–19 May, 30 May, 5–28 Jun, 1–12 Jul. The Zenodo text says 28 Apr–29 May; the file holds more. All days are **before BOOST (21 Jul 2026)**. | 2026-05-08 … 2026-06-10 |
| Content | 149,989 tokens; **28,669,509 trades** (the description says 110,469 and 20.7 M); 702,767 wallets; 402,297 checkpoint feature rows | 860,194 unique launches: mint, creation time, market cap at first sight, social-link flags; outcome GRADUATED/TIMEOUT |
| Trade fields | mint, signature, trader, is_buy, `sol_amount` (SOL, curve amount without fees), `token_amount` (raw), `vsol_after` (SOL), `block_time` (1 s). `slot` = **0 in every row** | none: **not a trade tape** |
| Missing | no vToken, no real reserves, **no fee fields, no slot, no in-block index, one row per signature**, bonding curve only (**no PumpSwap**, no migration pool states) | trades, reserves, wallets. Its outcome label only sees ≈ 6 min after launch, so its 0.198 % graduation rate is a lower bound (its own corrigendum) |
| Used for | every simulation | coverage and selection audit of the vdW tape; F08 social flags (joined on mint); a descriptive graduation figure |

### 1.1 Data-quality findings on the van de Wouw tape (`raw/tape-audit.vdw.json`, `raw/selection-audit.json`)

- **G1 reserve continuity fails.**
  - 99.98 % of mints chain from the initial 30 SOL state, so the collector tracked tokens from
    creation.
  - But 34,845 mints (23.2 %) have ≥ 1 break, and they carry 66 % of all trades.
  - Unobserved net flow is 1.67 % of volume. For the median gapped mint it is 2.5 % of its volume;
    at p90 it is 34 %.
  - Breaks sit at a median age of 201 s. The most likely cause is one row per signature plus
    websocket drops.
  - Under U4 every day would be dropped.
- **G4.** There is no slot and no in-block index. The clock is `block_time` (1 s). Intra-second
  order is rebuilt from the reserve chain.
- **G5 downtime.** A minute with zero trades on a tape averaging ≈ 700 trades/min means the
  collector was down. Only 9 of 28 collected days have ≤ 1 % downtime, 7 of them after the
  warm-up.
- **Selection is correlated with outcome** (look-ahead survivorship).
  - Coverage: on fully collected days the tape holds 24–34 % of all launches (RED-PUMP census).
  - Yet the tape's graduation rate is **2.51 %** (3,767 / 149,989), against 0.63–1.02 %
    published for the population.
  - 98.7 % of tape coins have a creator buy in the create transaction (median 3 SOL).
  - Mayhem coins are absent.
  - On the 16 fully collected overlap days, P(coin on tape) was:

| RED-PUMP initial mcap | Graduated within ≈ 6 min | Did not graduate |
|---|---|---|
| exactly 30 SOL (no creator buy seen) | 0.914 | 0.125 |
| 30–32 SOL | 0.773 | 0.366 |
| 32–45 SOL | 0.950 | 0.637 |
| ≥ 45 SOL | 0.952 | 0.383 |

  Among non-graduates, coins that rose 1.2–2× by ≈ 6 min are 1.2–3.8× more likely to be on the
  tape than flat coins. **Consequence: every entry rule is biased upward on this tape.** Kills are
  conservative. Survivals, and especially positive cells, may be artefacts.

## 2. Backtester

**Location:** `research/memecoins/backtest/` (TypeScript, run with `tsx`).

**Why TypeScript:**
- the repo is TypeScript, and `better-sqlite3` is already a dependency;
- the local Python has no numpy;
- the V8 loops are fast enough: the full hypothesis battery (308 variants × 4 execution settings
  over 28.7 M trades) runs in 80 s;
- BigInt gives exact lamport math for our fills.

| File | Role |
|---|---|
| `curve.ts` | Exact pump.fun curve and PumpSwap math. SDK formulas and ceil/floor order from PROTOCOL §4; fee schedule 95 + 30 bps per side on the curve; PumpSwap tier 0 2/93/30 bps; real-vault sell check (post-BOOST revert rule). Exact BigInt path for our fills, float path for replaying other traders (checked to ≤ 1 base unit). |
| `tape.ts`, `chain.ts` | Canonical columnar tape (ticks + resolution, so the same simulator runs on slots or seconds). Reserve-chain reconstruction: G1 gaps, execution order inside a tick, vToken chain. |
| `adapters/vdw.ts` | Public tape → cache: streams 28.7 M rows via the DB's `(mint, block_time, id)` index in 70 s; peak memory about 1 GB instead of loading the whole table. |
| `adapters/collector.ts` | **Stub adapter for our collector** (`data/memecoins.db`, read-only, schema from `collector/store.ts`). Slot clock, exact per-trade `v_quote`/`v_token`, split guard: refuses days past the planned train range unless `A27_STAGE=validate`/`test`. TODO: PumpSwap pool states for the migration exit; derive the split from the final day count. Smoke-tested on `data/backfill-sample.db`. |
| `sim.ts` | PROTOCOL §3 execution: latency, pessimistic/optimistic placement, p = 0.10 landing failure (buys retry once, sells until filled), `max_sol_cost` ×1.20 and `min_sol_output` ×0.70, insert-and-replay vs no-insert, the six exits (XT60/300/1800, XB, XR, XG), NLV marks, dead-coin −100 % rule, exit into the migration pool, end-of-data handling. |
| `context.ts` | Point-in-time sets: C(m), bundle B(m), sniper S(m), Bot(d), rings R(d), smart wallets W*(d), creator histories, G5 downtime mask, warm-up by collected days. |
| `signals.ts` | Generators for H01–H10, H17 and the H07 control, plus the filters F01–F08, all on the frozen grids. |
| `h13.ts` | H13 walk-forward gradient boosting: histogram GBM, 3 configs fixed in advance, weekly retrain on the trailing 14 days. |
| `run-futility.ts`, `run-filters.ts`, `run-all.sh` | Batteries; write raw JSON and ledger rows. |
| `make-report.ts`, `make-summary.ts` | Apply the pre-stated rule mechanically and write the tables. |
| `baselines.ts`, `tape-audit.ts`, `selection-audit.py`, `ipw-check.ts`, `activity-split.ts`, `diag-h13.ts`, `size-sweep.ts` | Descriptive baselines, data-quality audits, selection-bias probes, size sweep. |
| `selftest.ts`, `gbm-selftest.ts` | Checks: live-trade fee values, the 0.97531 round trip, graduation price and 14.7× move, float vs exact math, pool exit and real-vault clip, synthetic-tape replay and no-insert, GBM R² on synthetic data. |

**How to run** (from the repo root; long steps in the background):

```bash
bash research/memecoins/data/public/fetch_vdw.sh                  # 24 GB, resumable, md5-checked
node --max-old-space-size=6000 --import tsx research/memecoins/backtest/adapters/vdw.ts   # -> data/public/cache/vdw (70 s)
npx tsx research/memecoins/backtest/selftest.ts                   # 6 checks
python3 research/memecoins/backtest/selection-audit.py            # needs data/public/redpump/*.gz from Zenodo 21923106
nohup bash research/memecoins/backtest/run-all.sh fromStart guard > research/memecoins/results/raw/run-all.fromStart.guard.log 2>&1 &   # ≈ 7 min
bash research/memecoins/backtest/run-all.sh strict guard; bash research/memecoins/backtest/run-all.sh fromStart drop   # sensitivities
npx tsx research/memecoins/backtest/make-summary.ts
```

Our collector will use the same code: `loadCollector()` returns the same `Tape`, and the
generators, simulator and statistics do not change.

## 3. The futility rule and when it was fixed

- **`raw/futility-rule-prestated.md`**: sha256 `ea55bbf4232098f97ec96c1e5bc74f1662660be99f02e8e288166d89e17a7c82`,
  written 11:36 UTC while the tape was still downloading.
  - **Kill point:** the most favourable execution the protocol allows. L = 0.4 s, optimistic
    placement, insert-and-replay, 0.1 SOL, racing budget 0.0005 SOL.
  - **A variant is dead** when n ≥ 30 on ≥ 5 days and the upper bound of the 95 % day-block
    bootstrap CI (10,000 resamples) of the mean per-trade net return is < 0.
  - **A hypothesis is KILLED** when every powered variant is dead and ≤ 50 % of its grid is
    underpowered.
  - **Filters** are tested standalone against the naive baseline. A filter is KILLED only if
    flagged coins are significantly *better* in every cell.
- **`raw/futility-rule-addendum-A1.md`**: sha256 `d99018109ac14d9df2f2e1baf3147cdb71594db246f650b37e71c471d7c32394`,
  written after the data audit and **before any P&L run**. It changes four things:
  - **Universe.** Chains starting from the initial state, gaps allowed and replayed as aggregate
    flow. Strict G1 would drop, after the fact, the most active coins, which are the winners.
  - **Downtime.** Entries are refused if any downtime minute falls in [signal, signal + 65 min].
    G5 day-drop becomes a sensitivity.
  - **Warm-up.** The first 7 *collected* days; analysis starts 9 May.
  - **Status.** Every verdict is operational, not formal.
- **Timeline from the hash files and file times:**
  - rule hashed 11:36:04Z;
  - addendum A1 hashed 12:10:58Z (its text says "~12:15"; the hash time is the reliable one);
  - first P&L simulation 12:13:50Z (an H17 smoke run, not in the ledger);
  - first ledger row 12:16:05Z.
- The *kill rule itself* did not change. The selection audit (§1.1) was done after the first H17
  smoke run showed a positive cell, and I say so here. It changes interpretation only, not any
  verdict.

## 4. Simulator sanity checks against known baselines

Position baselines use a downtime-safe sample: 64,976 mints created on the 9 G5-clean days, with
no downtime in the first 2 h. Positions are marked pro rata at liquidation value (see the
zero-sum row).

| Check | Earlier measurement or expectation | This tape | Reading |
|---|---|---|---|
| Buy then immediate sell on an unchanged curve | 0.97531 (−2.47 %) | 0.97531 (selftest) | exact |
| Zero-sum: all wallets, raw, liquidation marks | ≈ 0 | −3.7 %. Unobserved flow is 3.0 % of SOL in; migrated pools keep a share of the SOL | accounting consistent |
| Graduation | ≈ 1 % (published 0.63–1.02 %; ours ~1 %) | 2.51 % of tape launches; RED-PUMP ≤ 6-min lower bound 0.198 % | tape over-represents graduates |
| Ordinary (non-creator) buyers, SOL-weighted | −20 %/position after retail costs, 23 % profitable (A26) | −6.9 % raw, −9.2 % after pump fees, −11.0 % after retail costs (+1 % terminal fee/side); 28.8 % profitable after pump fees | same sign; smaller because of the selection lift |
| Early entrants (2–25 slots) | +3.9 % raw, +1.5 % after pump fee (230-coin sample) | buyers 2–10 s after creation: −1.6 % raw, −4.0 % after pump fees | same order, negative |
| "First-slot snipers" | −29 … −51 % | same-second buyers: +13.9 % raw / +11.1 % after pump fees. Buyers at 1–2 s: +0.7 % raw / −1.8 % | **not comparable.** On a 1 s clock the creation second mixes insider bundles (our sample: "same-slot bundle-like +14 %") with snipers |
| Creators | −12.7 % … +23 % (two passes) | +39 % raw. 79 % of creators sold ≥ 50 % of their tokens within 30 s | dev dumping is the norm on this tape |
| B_naive, enter every coin at 30 s, XT300 (§7) | −5 … −20 % | −8.5 % [−8.8, −8.2] at L = 2 s; −6.4 % with XB; age 120 s: −4.3 … −5.8 % | inside the expected band |
| Control H07, KOL follow (expected −) | our KOL study: followers −10 … −13 %, +12 % latency tax at the next slot | L = 2 s: all 14 variants negative, −6.2 … −19.5 %, CI < 0. Zero latency: +3 … +10 % | ✓ at realistic latency; shows how generous the kill point is |
| Control H10, dip buy (expected −) | − | L = 2 s: all 24 variants −6.9 … −14.8 %, CI < 0 | ✓ |
| Size 0.05 → 0.5 SOL | small decline expected | B_naive −8.7 / −8.5 / −8.6 / −8.8 %; H17-small XB +11.4 / +11.5 / +11.2 / +10.2 % | capacity is not binding at these sizes |

No control came out strongly positive at the realistic latency, and the accounting closes.
The simulator is behaving. The large positives (H13, H17-small) are traced to the tape's
selection and to the curve's bounded downside near launch (§5, §10), not to a simulator bug:
- the synthetic replay test passes;
- no-insert is ≈ replay for these small sizes;
- the pool-exit share is ≈ 0–4 % for these cells.

## 5. Verdicts: signal hypotheses

**Variants tested** are the frozen grids. **Kill point** = L 0.4 s, optimistic.
**Primary** = L 2 s, pessimistic, insert-and-replay, 0.1 SOL. **Data treatments:**
- primary = chain from start, downtime guard;
- sensitivity 1 = strict G1;
- sensitivity 2 = G5 day-drop (7 analysis days).

Per-variant numbers for every grid point, including median, no-insert, L = 10 s and pool-exit
share, are in Appendix A and `raw/variants.fromStart.guard.csv`.

| Hyp. | Variants | Trades (kill setting, all variants) | Best variant at the kill point: mean / median / 95 % CI / win (n) | Dead at primary (CI upper bound < 0) | Median variant, primary | **Verdict** (primary treatment) | Strict G1 | G5 day-drop | Why |
|---|---|---|---|---|---|---|---|---|---|
| H01 velocity | 72 | 256,746 | `V=35;N=25;T=60 · XG`: +5.0 % / −32.2 % / [−29.1, +32.1] / 23 % (44) | 52 of 72 | −14.4 % | **SURVIVES-FUTILITY** | survives | survives | Survives only through the 8 small-n variants V=35, N=25 (34–66 trades, CI ±30 pp). The large-n variants are −14 … −33 % at L = 2 s |
| H02 organic breadth | 36 | 582,216 | `W=180;U=60 · XR`: −4.8 % / −10.1 % / [−6.0, −3.4] / 18 % (11,567) | 36 of 36 | −10.9 % | **KILLED** | KILLED | KILLED | robust: all treatments |
| H03 net organic pressure | 24 | 376,296 | `D=30;F=8 · XR`: +0.2 % / −20.6 % / [−1.4, +1.9] / 30 % (9,549) | 24 of 24 | −14.0 % | **SURVIVES-FUTILITY** | KILLED | survives | alive only at zero latency; every variant has CI < 0 at 2 s |
| H04 holder retention | 24 | 9,144 | `A=900;r=0.8 · XR`: +13.6 % / −0.5 % / [−5.2, +35.2] / 49 % (65) | 18 of 24 | −9.9 % | **SURVIVES-FUTILITY** | survives | survives | small n: 65 trades at the best grid point |
| H05 near graduation | 12 | 30,975 | `P=0.85;Tfast=120 · XG`: −4.3 % / +2.9 % / [−5.7, −1.9] / 52 % (1,390) | 12 of 12 | −14.2 % | **KILLED** | survives (n halves; +4 % [−1, +12]) | KILLED | killed despite the favourable pool-open exit (16–77 % of exits). Agrees with *Alpha Without Access*. Strict G1 is a look-ahead universe (§3) |
| H06 smart-wallet consensus | 24 | 171,162 | `k=2;D=60 · XR`: +2.0 % / −17.2 % / [+0.5, +3.7] / 29 % (8,904) | 24 of 24 | −7.4 % | **SURVIVES-FUTILITY** | KILLED | survives | positive CI **only at zero latency** (+1 … +2 %); −1.7 … −16.7 % at 2 s |
| H08 creator track record | 24 | 38,478 | `nMin=10;g=0.15 · XT300`: −6.9 % / −35.3 % / [−16.3, +8.4] / 22 % (361) | 19 of 24 | −8.6 % | **SURVIVES-FUTILITY** | KILLED | survives | wide CIs. The tape holds ~27 % of launches, so creator histories are truncated |
| H09 copycat wave | 24 | 23,670 | `c=10;D=10 · XB`: −5.2 % / −5.2 % / [−9.2, −0.8] / 17 % (169) | 22 of 24 | −5.9 % | **KILLED** | KILLED | survives (2 variants, n ≈ 100 on 7 days) | the G5 survival is a power problem |
| H10 dip buy (control) | 24 | 165,297 | `Pk=0.3;D=0.6;recovery · XR`: −1.6 % / −22.3 % / [−3.9, +1.0] / 26 % (3,143) | 24 of 24 | −10.1 % | **SURVIVES-FUTILITY** | survives | KILLED | every point estimate is negative, at both settings. The control behaves |
| H13 ML ceiling | 12 | 32,182 | `a=60;θ=0.05;C1 · XB`: +22.4 % / +3.1 % / [+19.2, +25.8] / 52 % (2,143) | 0 of 12 | +15.8 % | **SURVIVES-FUTILITY** | survives | survives | out of fold +4.9 … +26.9 % at 2 s, every CI > 0. No single feature is positive in any quintile (best −0.4 %). The gain comes from progress × drawdown-from-peak × early buy volume (39 / 21 / 18 % of gain), i.e. coins that pumped and fell back near launch by 60 s. The tape over-includes coins that later revive, so this is consistent with selection. **Uninterpretable here** |
| H17 creator initial buy | 18 | 523,842 | `lo=0.05;hi=0.2 · XR`: +19.1 % / −4.3 % / [+14.5, +25.1] / 40 % (3,106) | 12 of 18 | −13.3 % | **SURVIVES-FUTILITY** | survives | survives | [0.05, 0.2) SOL with XB: **+11.5 % [+7.7, +16.9] at 2 s**, +4.9 % at 10 s, +10.2 % at 0.5 SOL. It survives the partial corrections (graduation weighting +11.6 %; early-move weighting +10.6 %; quiet coins ×8 +5.9 %). Its time exits (−3 … +4 %) turn negative under early-move weighting. The 0.2–5 SOL and ≥ 5 SOL buckets are dead (−8 … −26 %) |
| H07 KOL follow (control) | 14 | 214,466 | `S=2 · XB`: +10.1 % / −20.2 % / [+8.4, +11.7] / 48 % (9,953) | 14 of 14 | −10.7 % | **CONTROL ONLY** (no point-in-time KOL list) | — | — | 373 of 536 kolscan wallets (2026-09-25 snapshot) trade on the tape. At 2 s: −6 … −20 % |

**NOT-TESTABLE-ON-TAPE:**
- **H11, H12, H15, H16a/b.** These are post-migration families: the tape has no PumpSwap trades
  and pre-dates BOOST, and PROTOCOL §14 reserves them for our own data anyway. So H15/H16a
  (exit at migration or inside the BOOST window) cannot be checked here.
- **H14.** Applies to finalists only.
- **H07.** Not point-in-time; run as a control only.

## 6. Verdicts: filters

Standalone design: naive entry at age 30 s and 120 s × XT300/XB. Δ = flagged − unflagged mean net
return, with a paired day-block CI. Full per-cell table in Appendix A.

| Filter | Verdict (primary) | Strict G1 | G5 drop | Key numbers (primary, L = 2 s) |
|---|---|---|---|---|
| F01 bundled launch | **SUPPORTED-ON-TAPE** (cannot promote) | supported | supported | flagged −2.2 … −11.1 pp in all 16 cells. On a 1 s clock b = 1 flags 95 % of coins (the creation second spans ≈ 2.5 slots). The unflagged 5 % were +0.8 % (XT300) / +4.2 % (XB) at 30 s |
| F02a dev dump, no entry after it | SURVIVES (inconclusive) | inconclusive | inconclusive | −1.5 … −2.3 pp at 30 s; +0.2 … +1.7 pp at 120 s. 79 % of creators had sold ≥ 50 % within 30 s |
| F02b dev dump, exit override | SURVIVES (inconclusive) | same | same | XT300: +0.5 … +1.5 pp (x = 90, T = 600: +1.4 [+0.6, +2.3]); XB: −0.9 … −1.6 pp. The override helps a time exit and hurts the bracket |
| F03 ring presence | **SUPPORTED-ON-TAPE** | supported | supported | −3.0 … −3.5 pp at 30 s; ≈ 0 at 120 s. The deployer-funded-sniper variant is **not testable** (no funding graph) |
| F04 holder concentration | **SUPPORTED-ON-TAPE** | supported | supported | −7.4 … −13.5 pp in all 8 cells. Strongest filter |
| F05 factory creator | SURVIVES (inconclusive) | inconclusive | inconclusive | −0.6 … −1.9 pp at 30 s, +0.5 … +0.9 pp at 120 s; creator histories are truncated |
| F06 copycat | SURVIVES (inconclusive) | inconclusive | inconclusive | −0.6 … −1.2 pp at 30 s, ≈ 0 at 120 s |
| F07 wash (WT2 only; WT1 not observable) | SURVIVES (inconclusive) | inconclusive | inconclusive | **opposite sign.** w = 30 flagged coins are +1.4 … +4.5 pp *better* in all 4 cells (kill condition met at that grid point); w = 10 is mixed. Agrees with "wash-traded coins graduate more" |
| F08 no socials (RED-PUMP join, 8 May–4 Jun) | SURVIVES (inconclusive) | supported | inconclusive | "no X/TG/website": flagged coins **better** by +3.0 … +8.4 pp. "no Telegram": −5.6 … −8.4 pp at 30 s, ≈ 0 at 120 s |
| "No creator buy" (H17 filter use) | **SUPPORTED-ON-TAPE** | inconclusive | supported | −10.7 … −13.9 pp. Only 1,439 flagged coins: the tape rarely contains no-buy coins |

Supported filters cut losses, but they do not make the naive baseline positive. The one exception
is a launch-time pocket (F01-unflagged at 30 s), and it is exposed to the same selection
artefact as H17-small.

## 7. Variant budget

- **K = 335 distinct variants** logged with `counts_toward_K = 1` in
  `results/variant_ledger.csv` (4,275 rows over the three data treatments and four execution
  settings):
  - 294 frozen signal variants: H01 72, H02 36, H03 24, H04 24, H05 12, H06 24, H08 24,
    H09 24, H10 24, H13 12, H17 18;
  - the H07 control, 14;
  - 24 standalone filter variants: F01 4, F02a 4, F02b 4, F03 2, F04 2, F05 2, F06 1, F07 2,
    F08 2, "no creator buy" 1;
  - 3 exploratory diagnostics: the quiet/active naive probes and the naive 60 s XB feature scan.
- Budget ≤ 662 (512 pre-registered + ≤ 150 exploratory). The exploratory reserve used is 3.
- Latency, placement, size and data-treatment sensitivities are not selection variants
  (PROTOCOL §9.1).

## 8. Spec ambiguities and how I resolved them

1. **No slots.** The clock is 1 s block time. A signal at second T lands at T + L:
   - pessimistic: after every trade with tick ≤ ⌈T + L⌉;
   - optimistic: after trades with tick ≤ ⌊T + L − 1⌋, never before the signal trade.

   So L = 0.4 s optimistic means "straight after the signal trade", effectively zero latency.
   The same code gives exact slot placement on our collector. The slot time could not be
   re-measured (G6).
2. **No fee fields.** Our fills use PROTOCOL §4's hand-coded schedule (§3.3 allows it for
   sanity checks; there is nothing else). Other traders' trades are replayed on curve amounts,
   which exclude fees.
3. **G1 fails.** Universe = chains from the initial state, with gaps replayed as one aggregate
   trade. Strict G1 is a sensitivity (addendum A1).
4. **G5.** Entry guard over the next 65 min; day-drop is a sensitivity. Warm-up = 7 *collected*
   days (U5).
5. **C(m) = {creator}.** One row per signature hides co-buyers in the same transaction, and there
   is no funding graph.
   - B(m) = non-creator buyers in the creation **second**.
   - S(m) = first buy within ⌈1.6 s⌉ = 2 s.
   - Unobserved flow counts as non-organic.
6. **Positions open at curve completion** are sold into the pool-opening state:
   - quote = real SOL − 0.015000001 SOL, base 206.9 M tokens, tier-0 fee, full pre-BOOST vault;
   - this is favourable given the documented post-migration collapse, so it is valid for kills
     only;
   - share of exits affected: 16–77 % for H05, up to 33 % for small-n H01 variants, ≤ 11 %
     elsewhere (median 2 %).
7. **Time exits** trigger at landing + τ and the sell lands L later. **Buys** use exact-token
   `buy` semantics: t_q is quoted at the signal and fails above 1.20× the quoted cost.
8. **Transaction costs.**
   - A landed tx pays 5,000 lamports + budget (0.0001 SOL normal, 0.0005 SOL at L = 0.4 s).
   - A failed-but-included tx pays 5,000 lamports + 50 % of the budget.
   - Landing failure is drawn deterministically from a hash of (mint, signal tick, attempt), so
     every variant sees the same draws.
9. **Concurrency cap (≤ 8) is not applied.** The kill statistic is per trade, and a chronological
   skip is not selective on outcome.
10. **Trailing objects** use calendar windows as specified. After the collection holes they are
    thin or empty, so W* and Bot are empty on some days.
11. **H04** requires 20 organic buyers at age A.
12. **H10.** "Drawdown within 10 min" is measured against the trailing 10-min peak. "Recovery" is a
    one-third retrace within 30 min of the dip.
13. **H13.** Weekly retrains start at tape day 15, so the first week has a full 14-day window.
    Training rows must resolve ≥ 1 h before each retrain. There is no other tuning.
14. **H07 mirror variants** sell when the KOL sells, capped by XT1800.
15. **F08** can only be tested on the 8 May–4 Jun RED-PUMP overlap.
16. **Baseline marks.** Remaining tokens are marked pro rata at liquidation value, so the marks
    sum to what the curve or pool can actually pay out. My first pass marked each holder as if
    selling alone. That made every group positive, which is impossible, and it was fixed before
    any hypothesis run.

## 9. What the tape cannot tell us

- **Whether H17-small or H13 is real.** Only an unselected firehose can say, and our collector is
  one.
- **Anything after migration, or under BOOST, cashback or holder-reward fees.**
- **Slot-level races.** It cannot resolve bundle vs sniper, or 0.4 s vs 1 s.
- **Anything that needs a funding graph:** E-fund, F03 deployer-funded snipers.
- **The current regime.** The creator-buy mix, dev-dump share and bot population of Apr–Jul 2026
  may differ from Sep 2026.

## 10. Honest read: is the campaign worth 60 days of collection?

**Not dead, but most of the grid probably is. Collect, and expect to fail.**

What the tape settles, as far as a biased tape can:

1. **The flow-following half of the grid fails at our latency.**
   - It covers every rule that waits for visible demand before entering: velocity, net
     pressure, breadth, smart-wallet consensus, KOL buys, near-graduation run-up, copycat
     waves, dip-buys.
   - Every one is negative with CI < 0 at L = 2 s on 28.7 M trades.
   - That holds even on a tape biased towards winners, and even with a free migration exit.
   - The only way to make them look positive is zero latency, and even then only for H06 and the
     KOL control.
   - This is the "public signals are priced by faster bots" failure the pre-registration
     anticipated (HYPOTHESES §9), now measured.
   - H02, H05 and H09 are killed under the pre-stated rule. I recommend recording them as
     **operationally killed** in a dated amendment to HYPOTHESES.md: 72 variants less to test on
     validation.
   - H03, H06 and H10 are dead at 2 s in every variant. Expect them to fail S3.
2. **Loss-avoidance filters work but don't create an edge.** F04, F01, F03 and "no creator buy"
   separate losers by 2–14 pp, which matches the literature. They are worth keeping as
   incremental filters.
3. **The only positive cells are launch-time entries** (H17 small creator buy with a bracket exit;
   H13 at 60–300 s).
   - They share a real mechanism: on the curve, an entry near the launch price has bounded
     downside.
   - They also share the tape's worst bias: inclusion is 2–7× more likely for coins that later
     traded.
   - H17-small XB survived every correction the tape allows. None of those corrections is
     complete.
   - HYPOTHESES predicted exactly this sign for this bucket.
   - It is the most useful thing this pilot found. But it is a launch snipe at L = 2 s, the zone
     where A26 measured first-slot snipers at −29 … −51 %, and it is a pre-BOOST, pre-Sep-regime
     result.

**Why 60 days is still worth it:**
- the protocol's own futility stop (§11.1) is not triggered;
- the decisive question, launch-time edge versus survivorship, can only be answered by an
  unselected firehose, which is what our collector records;
- the post-BOOST exit families (H15/H16) can only be judged on our data;
- the marginal cost is low: the collector is free apart from disk space, about 5 GB/day.

**Why to expect failure:**
- the flow-following families are already dead;
- what survives is either underpowered or sits exactly where the tape is biased;
- PROTOCOL §14 treats effects ≤ 5 %/trade as not demonstrable.

**If H17-small is a survivorship artefact, the campaign has no live candidate left. Expect that
to become clear at the S1 futility check (day 28).**

## 11. Files

- `research/memecoins/results/futility-public-tapes.md`: this report.
- `research/memecoins/results/variant_ledger.csv`: append-only ledger (4,275 rows; K = 335).
- `research/memecoins/results/raw/`:
  - `futility-rule-prestated.md` and `.sha256`, `futility-rule-addendum-A1.md` and `.sha256`: the
    pre-stated rule and addendum A1;
  - `tape-audit.vdw.json`, `selection-audit.json`: data-quality and selection audits;
  - `baselines.vdw.fromStart.json`, `baselines.vdw.strict.json`: descriptive baselines;
  - `H01…H17,H07.<treatment>.json`, `filters.<treatment>.json`, `H13.<treatment>.json`: per-variant
    results;
  - `tables.<treatment>.md`, `variants.<treatment>.csv`, `verdicts.<treatment>.json`,
    `summary.md`: generated tables;
  - `ipw-check.fromStart.guard.json`, `activity-split.fromStart.guard.json`,
    `diag-h13.fromStart.guard.json`, `size-sweep.fromStart.guard.json`: probes;
  - `*.log`: run logs.

  Note: `.gitignore` has `*.json`, so these need `git add -f` if they are ever committed.
- `research/memecoins/data/public/` (gitignored):
  - `pumpfun_database.db` (24 GB; md5 in `.md5` and `.md5.after`);
  - `cache/vdw/` (1.5 GB canonical cache);
  - `redpump/` (88 MB);
  - `fetch_vdw.sh`.

  **The 24 GB database is kept for now** (main-session decision, 2026-09-25). It can be deleted
  at any time, since everything reruns from `cache/vdw/`. To re-fetch it:
  `bash research/memecoins/data/public/fetch_vdw.sh` (resumable, md5-checked, ≈ 40 min). Then
  rebuild the cache with `adapters/vdw.ts` if the cache is gone too. The disk had 129 GB free
  before the download.

---

## Appendix A: per-hypothesis and per-filter tables (primary treatment, generated by `make-report.ts`)

Columns:
- **Kill** = L 0.4 s optimistic, insert-and-replay (the verdict setting).
- **Primary** = L 2 s pessimistic.
- **No-insert** = the conservative double-impact model, at L 2 s.
- **Via pool** = share of exits made into the migration pool-open state.

Each table shows the 8 variants with the highest kill-point upper bound and the 2 lowest. All
variants are in `raw/variants.fromStart.guard.csv`.

### H01: SURVIVES-FUTILITY

Variants tested: 72 (powered 72, dead at the kill setting 38, underpowered 0). Trades over all variants at the kill setting: 256746.
At the PRIMARY setting (L = 2 s, pessimistic) 52 of 72 powered variants have an upper 95 % bound < 0; variants whose primary CI lies entirely above 0: none.
Primary setting (L = 2 s, pessimistic): variant means range -33.1 % … +13.3 %, median variant -14.4 %.

| Variant | Signals | Kill n | Kill mean | Kill median | Kill 95 % CI | Kill win | Primary mean [CI] | No-insert mean | L = 10 s mean | Via pool |
|---|---|---|---|---|---|---|---|---|---|---|
| `H01 · V=35;N=25;T=60 · XG` | 44 | 44 | +5.0 % | -32.2 % | [-29.1 %, +32.1 %] | 23 % | -6.1 % [-46.3 %, +23.4 %] | -6.1 % | -10.6 % | 2 % |
| `H01 · V=35;N=25;T=300 · XG` | 66 | 66 | +3.9 % | -32.2 % | [-25.0 %, +28.2 %] | 24 % | -13.7 % [-45.1 %, +11.0 %] | -12.6 % | -15.6 % | 9 % |
| `H01 · V=35;N=25;T=60 · XR` | 44 | 44 | +9.4 % | -12.8 % | [-14.0 %, +27.9 %] | 30 % | +1.4 % [-28.0 %, +21.7 %] | +1.3 % | +1.6 % | 20 % |
| `H01 · V=35;N=25;T=300 · XR` | 66 | 66 | +7.0 % | -12.8 % | [-17.7 %, +27.2 %] | 29 % | -9.3 % [-33.7 %, +8.1 %] | -9.4 % | -8.2 % | 26 % |
| `H01 · V=35;N=25;T=300 · XT300` | 66 | 66 | -1.5 % | -43.6 % | [-27.4 %, +20.4 %] | 33 % | -4.9 % [-27.9 %, +12.1 %] | -5.0 % | -11.0 % | 29 % |
| `H01 · V=35;N=25;T=60 · XT60` | 44 | 44 | +2.0 % | -4.1 % | [-16.2 %, +18.3 %] | 41 % | +13.3 % [-9.7 %, +33.0 %] | +13.2 % | -6.7 % | 20 % |
| `H01 · V=35;N=25;T=60 · XT1800` | 44 | 44 | -5.7 % | -79.5 % | [-37.4 %, +18.1 %] | 30 % | +0.6 % [-39.7 %, +29.2 %] | +0.6 % | -12.8 % | 32 % |
| `H01 · V=35;N=25;T=60 · XB` | 44 | 44 | +1.8 % | -16.5 % | [-16.4 %, +18.1 %] | 43 % | +8.4 % [-10.5 %, +21.5 %] | +8.3 % | +1.9 % | 7 % |
| `H01 · V=10;N=60;T=60 · XT1800` | 12314 | 12162 | -26.9 % | -48.8 % | [-29.4 %, -24.2 %] | 8 % | -28.7 % [-31.3 %, -26.0 %] | -28.8 % | -23.6 % | 3 % |
| `H01 · V=20;N=60;T=60 · XT1800` | 3248 | 3200 | -30.2 % | -66.2 % | [-34.3 %, -25.6 %] | 12 % | -33.1 % [-37.8 %, -27.8 %] | -33.1 % | -28.5 % | 8 % |
| … 62 more variants in `variants.fromStart.guard.csv` | | | | | | | | | | |

### H02: KILLED

Variants tested: 36 (powered 36, dead at the kill setting 36, underpowered 0). Trades over all variants at the kill setting: 582216.
At the PRIMARY setting (L = 2 s, pessimistic) 36 of 36 powered variants have an upper 95 % bound < 0; variants whose primary CI lies entirely above 0: none.
Primary setting (L = 2 s, pessimistic): variant means range -28.6 % … -4.2 %, median variant -10.9 %.

| Variant | Signals | Kill n | Kill mean | Kill median | Kill 95 % CI | Kill win | Primary mean [CI] | No-insert mean | L = 10 s mean | Via pool |
|---|---|---|---|---|---|---|---|---|---|---|
| `H02 · W=180;U=60 · XR` | 11683 | 11567 | -4.8 % | -10.1 % | [-6.0 %, -3.4 %] | 18 % | -10.9 % [-12.3 %, -9.4 %] | -11.2 % | -11.2 % | 4 % |
| `H02 · W=180;U=30 · XR` | 18573 | 18372 | -4.8 % | -7.4 % | [-5.7 %, -3.7 %] | 16 % | -10.1 % [-11.2 %, -9.0 %] | -10.5 % | -10.3 % | 3 % |
| `H02 · W=180;U=15 · XR` | 23133 | 22870 | -4.6 % | -6.1 % | [-5.4 %, -3.8 %] | 14 % | -9.4 % [-10.3 %, -8.5 %] | -9.7 % | -9.5 % | 2 % |
| `H02 · W=180;U=15 · XT60` | 23133 | 22870 | -5.0 % | -3.5 % | [-5.4 %, -4.6 %] | 22 % | -4.2 % [-4.6 %, -3.8 %] | -4.6 % | -4.3 % | 0 % |
| `H02 · W=60;U=30 · XR` | 15680 | 15531 | -5.9 % | -17.8 % | [-7.1 %, -4.7 %] | 20 % | -14.4 % [-15.8 %, -13.1 %] | -14.6 % | -14.2 % | 3 % |
| `H02 · W=180;U=30 · XT60` | 18573 | 18372 | -5.2 % | -3.6 % | [-5.6 %, -4.7 %] | 24 % | -4.4 % [-4.8 %, -3.8 %] | -4.8 % | -4.5 % | 0 % |
| `H02 · W=180;U=60 · XT60` | 11683 | 11567 | -5.4 % | -3.7 % | [-6.1 %, -4.7 %] | 28 % | -4.6 % [-5.3 %, -3.8 %] | -5.0 % | -5.0 % | 1 % |
| `H02 · W=180;U=60 · XB` | 11683 | 11567 | -6.1 % | -11.6 % | [-7.0 %, -5.1 %] | 21 % | -8.1 % [-9.2 %, -6.9 %] | -8.3 % | -8.3 % | 2 % |
| `H02 · W=60;U=30 · XT1800` | 15680 | 15531 | -25.3 % | -44.6 % | [-26.9 %, -23.5 %] | 11 % | -24.3 % [-26.1 %, -22.4 %] | -24.4 % | -22.5 % | 6 % |
| `H02 · W=60;U=60 · XT1800` | 8736 | 8648 | -29.5 % | -53.3 % | [-31.8 %, -26.8 %] | 12 % | -28.6 % [-31.0 %, -25.7 %] | -28.7 % | -26.4 % | 8 % |
| … 26 more variants in `variants.fromStart.guard.csv` | | | | | | | | | | |

### H03: SURVIVES-FUTILITY

Variants tested: 24 (powered 24, dead at the kill setting 22, underpowered 0). Trades over all variants at the kill setting: 376296.
At the PRIMARY setting (L = 2 s, pessimistic) 24 of 24 powered variants have an upper 95 % bound < 0; variants whose primary CI lies entirely above 0: none.
Primary setting (L = 2 s, pessimistic): variant means range -26.4 % … -5.8 %, median variant -14.0 %.

| Variant | Signals | Kill n | Kill mean | Kill median | Kill 95 % CI | Kill win | Primary mean [CI] | No-insert mean | L = 10 s mean | Via pool |
|---|---|---|---|---|---|---|---|---|---|---|
| `H03 · D=30;F=8 · XR` | 9634 | 9549 | +0.2 % | -20.6 % | [-1.4 %, +1.9 %] | 30 % | -13.2 % [-14.7 %, -11.7 %] | -13.3 % | -14.3 % | 6 % |
| `H03 · D=30;F=3 · XR` | 18516 | 18353 | -0.4 % | -21.9 % | [-1.6 %, +1.0 %] | 28 % | -14.0 % [-14.9 %, -12.9 %] | -14.1 % | -14.7 % | 3 % |
| `H03 · D=120;F=8 · XR` | 14212 | 14069 | -1.7 % | -22.2 % | [-2.9 %, -0.5 %] | 27 % | -15.7 % [-16.7 %, -14.6 %] | -15.8 % | -15.9 % | 4 % |
| `H03 · D=30;F=8 · XB` | 9634 | 9549 | -1.4 % | -30.5 % | [-2.2 %, -0.6 %] | 37 % | -8.8 % [-9.9 %, -7.5 %] | -8.9 % | -10.1 % | 2 % |
| `H03 · D=120;F=3 · XR` | 20965 | 20745 | -3.0 % | -22.4 % | [-4.1 %, -2.0 %] | 26 % | -14.4 % [-15.3 %, -13.5 %] | -14.5 % | -14.5 % | 3 % |
| `H03 · D=30;F=3 · XB` | 18516 | 18353 | -3.6 % | -30.3 % | [-4.3 %, -2.8 %] | 34 % | -8.9 % [-9.9 %, -7.9 %] | -9.2 % | -9.8 % | 1 % |
| `H03 · D=120;F=8 · XB` | 14212 | 14069 | -4.1 % | -30.5 % | [-4.8 %, -3.6 %] | 34 % | -10.1 % [-10.7 %, -9.4 %] | -10.3 % | -10.7 % | 1 % |
| `H03 · D=30;F=3 · XT60` | 18516 | 18353 | -4.6 % | -4.9 % | [-5.4 %, -3.8 %] | 42 % | -5.8 % [-6.5 %, -5.2 %] | -6.1 % | -6.5 % | 1 % |
| `H03 · D=30;F=8 · XT1800` | 9634 | 9549 | -24.1 % | -62.0 % | [-26.2 %, -21.8 %] | 20 % | -24.8 % [-27.1 %, -22.4 %] | -24.8 % | -25.1 % | 11 % |
| `H03 · D=120;F=8 · XT1800` | 14212 | 14069 | -26.0 % | -56.4 % | [-27.9 %, -24.0 %] | 16 % | -26.4 % [-28.4 %, -24.4 %] | -26.5 % | -25.8 % | 7 % |
| … 14 more variants in `variants.fromStart.guard.csv` | | | | | | | | | | |

### H04: SURVIVES-FUTILITY

Variants tested: 24 (powered 24, dead at the kill setting 13, underpowered 0). Trades over all variants at the kill setting: 9144.
At the PRIMARY setting (L = 2 s, pessimistic) 18 of 24 powered variants have an upper 95 % bound < 0; variants whose primary CI lies entirely above 0: none.
Primary setting (L = 2 s, pessimistic): variant means range -43.5 % … +3.7 %, median variant -9.9 %.

| Variant | Signals | Kill n | Kill mean | Kill median | Kill 95 % CI | Kill win | Primary mean [CI] | No-insert mean | L = 10 s mean | Via pool |
|---|---|---|---|---|---|---|---|---|---|---|
| `H04 · A=900;r=0.8 · XR` | 66 | 65 | +13.6 % | -0.5 % | [-5.2 %, +35.2 %] | 49 % | +3.7 % [-16.4 %, +26.6 %] | +3.6 % | +0.5 % | 5 % |
| `H04 · A=900;r=0.8 · XG` | 66 | 65 | +10.6 % | -30.1 % | [-8.2 %, +31.4 %] | 38 % | +2.8 % [-18.2 %, +25.7 %] | +2.7 % | +0.5 % | 2 % |
| `H04 · A=900;r=0.8 · XT1800` | 66 | 65 | +2.1 % | -0.6 % | [-19.1 %, +25.9 %] | 48 % | +2.9 % [-18.3 %, +26.6 %] | +2.7 % | +0.6 % | 5 % |
| `H04 · A=900;r=0.8 · XB` | 66 | 65 | +5.4 % | +2.4 % | [-5.0 %, +16.7 %] | 54 % | +2.2 % [-8.7 %, +14.0 %] | +2.0 % | -3.2 % | 0 % |
| `H04 · A=900;r=0.6 · XR` | 273 | 271 | +1.4 % | -11.7 % | [-2.1 %, +5.4 %] | 35 % | -9.9 % [-15.4 %, -4.3 %] | -10.1 % | -12.0 % | 4 % |
| `H04 · A=300;r=0.8 · XR` | 311 | 308 | -5.4 % | -18.9 % | [-12.3 %, +3.0 %] | 30 % | -37.5 % [-45.0 %, -28.8 %] | -37.7 % | -39.5 % | 4 % |
| `H04 · A=900;r=0.8 · XT60` | 66 | 65 | -0.7 % | -3.5 % | [-4.8 %, +2.7 %] | 29 % | -0.2 % [-4.0 %, +2.8 %] | -0.5 % | -1.2 % | 2 % |
| `H04 · A=900;r=0.6 · XG` | 273 | 271 | -2.5 % | -30.5 % | [-7.0 %, +2.1 %] | 27 % | -12.1 % [-18.0 %, -6.3 %] | -12.3 % | -13.9 % | 1 % |
| `H04 · A=300;r=0.6 · XT1800` | 889 | 880 | -37.6 % | -65.6 % | [-42.6 %, -32.3 %] | 17 % | -36.9 % [-41.9 %, -31.4 %] | -37.0 % | -37.4 % | 6 % |
| `H04 · A=300;r=0.8 · XT1800` | 311 | 308 | -44.5 % | -71.1 % | [-52.3 %, -36.0 %] | 14 % | -43.5 % [-51.5 %, -34.9 %] | -43.6 % | -44.1 % | 4 % |
| … 14 more variants in `variants.fromStart.guard.csv` | | | | | | | | | | |

### H05: KILLED

Variants tested: 12 (powered 12, dead at the kill setting 12, underpowered 0). Trades over all variants at the kill setting: 30975.
At the PRIMARY setting (L = 2 s, pessimistic) 12 of 12 powered variants have an upper 95 % bound < 0; variants whose primary CI lies entirely above 0: none.
Primary setting (L = 2 s, pessimistic): variant means range -18.0 % … -10.3 %, median variant -14.2 %.

| Variant | Signals | Kill n | Kill mean | Kill median | Kill 95 % CI | Kill win | Primary mean [CI] | No-insert mean | L = 10 s mean | Via pool |
|---|---|---|---|---|---|---|---|---|---|---|
| `H05 · P=0.85;Tfast=120 · XG` | 1402 | 1390 | -4.3 % | +2.9 % | [-5.7 %, -1.9 %] | 52 % | -10.3 % [-14.3 %, -6.8 %] | -10.4 % | -9.0 % | 36 % |
| `H05 · P=0.7;Tfast=120 · XG` | 2761 | 2725 | -4.6 % | -30.0 % | [-6.4 %, -2.6 %] | 36 % | -14.2 % [-17.5 %, -10.8 %] | -14.2 % | -14.8 % | 21 % |
| `H05 · P=0.7;Tfast=120 · XB` | 2761 | 2725 | -4.7 % | -30.1 % | [-6.7 %, -2.7 %] | 35 % | -13.5 % [-16.6 %, -10.3 %] | -13.5 % | -14.1 % | 29 % |
| `H05 · P=0.85;Tfast=120 · XB` | 1402 | 1390 | -5.4 % | -1.7 % | [-7.2 %, -2.9 %] | 47 % | -12.6 % [-17.3 %, -8.4 %] | -12.7 % | -12.5 % | 71 % |
| `H05 · P=0.85;Tfast=600 · XG` | 2306 | 2284 | -5.3 % | +5.8 % | [-6.3 %, -4.0 %] | 54 % | -11.1 % [-13.4 %, -8.7 %] | -11.2 % | -11.3 % | 25 % |
| `H05 · P=0.7;Tfast=600 · XG` | 3973 | 3926 | -5.5 % | -30.2 % | [-6.7 %, -4.1 %] | 35 % | -15.9 % [-18.2 %, -13.3 %] | -15.9 % | -16.5 % | 16 % |
| `H05 · P=0.7;Tfast=600 · XB` | 3973 | 3926 | -5.7 % | -30.3 % | [-7.1 %, -4.3 %] | 33 % | -15.2 % [-17.6 %, -12.6 %] | -15.2 % | -15.9 % | 23 % |
| `H05 · P=0.85;Tfast=600 · XB` | 2306 | 2284 | -6.6 % | -1.9 % | [-7.6 %, -5.2 %] | 47 % | -12.9 % [-15.7 %, -9.9 %] | -13.1 % | -13.6 % | 62 % |
| `H05 · P=0.85;Tfast=120 · XT300` | 1402 | 1390 | -9.1 % | +5.3 % | [-12.8 %, -6.4 %] | 53 % | -14.8 % [-20.0 %, -9.8 %] | -15.0 % | -12.8 % | 77 % |
| `H05 · P=0.7;Tfast=120 · XT300` | 2761 | 2725 | -11.7 % | -3.7 % | [-15.2 %, -9.2 %] | 42 % | -18.0 % [-21.5 %, -14.2 %] | -18.0 % | -17.6 % | 46 % |
| `H05 · P=0.85;Tfast=600 · XT300` | 2306 | 2284 | -11.7 % | +5.0 % | [-14.4 %, -9.7 %] | 53 % | -14.5 % [-17.6 %, -11.3 %] | -14.7 % | -13.9 % | 65 % |
| `H05 · P=0.7;Tfast=600 · XT300` | 3973 | 3926 | -13.4 % | -6.9 % | [-15.8 %, -11.5 %] | 42 % | -17.5 % [-19.8 %, -15.0 %] | -17.5 % | -17.4 % | 37 % |

### H06: SURVIVES-FUTILITY

Variants tested: 24 (powered 24, dead at the kill setting 12, underpowered 0). Trades over all variants at the kill setting: 171162.
At the PRIMARY setting (L = 2 s, pessimistic) 24 of 24 powered variants have an upper 95 % bound < 0; variants whose primary CI lies entirely above 0: none.
Primary setting (L = 2 s, pessimistic): variant means range -16.7 % … -1.7 %, median variant -7.4 %.

| Variant | Signals | Kill n | Kill mean | Kill median | Kill 95 % CI | Kill win | Primary mean [CI] | No-insert mean | L = 10 s mean | Via pool |
|---|---|---|---|---|---|---|---|---|---|---|
| `H06 · k=2;D=60 · XR` | 8982 | 8904 | +2.0 % | -17.2 % | [+0.5 %, +3.7 %] | 29 % | -7.4 % [-9.5 %, -5.5 %] | -7.6 % | -9.0 % | 2 % |
| `H06 · k=3;D=60 · XR` | 4057 | 4016 | +1.3 % | -18.4 % | [-0.2 %, +3.6 %] | 29 % | -7.4 % [-9.9 %, -5.1 %] | -7.5 % | -8.5 % | 3 % |
| `H06 · k=3;D=600 · XR` | 5484 | 5430 | +1.5 % | -18.2 % | [+0.0 %, +3.5 %] | 29 % | -6.6 % [-8.2 %, -5.1 %] | -6.8 % | -7.8 % | 3 % |
| `H06 · k=2;D=600 · XR` | 10273 | 10177 | +1.9 % | -16.9 % | [+0.5 %, +3.4 %] | 29 % | -7.1 % [-9.0 %, -5.2 %] | -7.3 % | -8.5 % | 2 % |
| `H06 · k=2;D=60 · XT60` | 8982 | 8904 | +1.7 % | -6.4 % | [+0.5 %, +2.8 %] | 41 % | -2.0 % [-3.0 %, -1.1 %] | -2.2 % | -4.5 % | 0 % |
| `H06 · k=2;D=600 · XT60` | 10273 | 10177 | +1.6 % | -5.0 % | [+0.6 %, +2.4 %] | 41 % | -1.9 % [-2.8 %, -1.2 %] | -2.2 % | -4.2 % | 0 % |
| `H06 · k=2;D=60 · XB` | 8982 | 8904 | +1.0 % | -28.9 % | [-0.0 %, +2.3 %] | 38 % | -3.6 % [-4.8 %, -2.4 %] | -3.9 % | -5.2 % | 0 % |
| `H06 · k=2;D=600 · XB` | 10273 | 10177 | +0.9 % | -27.9 % | [+0.0 %, +2.1 %] | 37 % | -3.5 % [-4.5 %, -2.4 %] | -3.8 % | -5.1 % | 0 % |
| `H06 · k=2;D=600 · XT1800` | 10273 | 10177 | -12.4 % | -39.3 % | [-14.9 %, -9.9 %] | 15 % | -15.0 % [-17.4 %, -12.6 %] | -15.1 % | -15.1 % | 5 % |
| `H06 · k=3;D=60 · XT1800` | 4057 | 4016 | -15.2 % | -45.8 % | [-20.8 %, -10.1 %] | 16 % | -16.7 % [-21.8 %, -12.0 %] | -16.7 % | -16.8 % | 6 % |
| … 14 more variants in `variants.fromStart.guard.csv` | | | | | | | | | | |

### H08: SURVIVES-FUTILITY

Variants tested: 24 (powered 24, dead at the kill setting 13, underpowered 0). Trades over all variants at the kill setting: 38478.
At the PRIMARY setting (L = 2 s, pessimistic) 19 of 24 powered variants have an upper 95 % bound < 0; variants whose primary CI lies entirely above 0: none.
Primary setting (L = 2 s, pessimistic): variant means range -15.0 % … -5.0 %, median variant -8.6 %.

| Variant | Signals | Kill n | Kill mean | Kill median | Kill 95 % CI | Kill win | Primary mean [CI] | No-insert mean | L = 10 s mean | Via pool |
|---|---|---|---|---|---|---|---|---|---|---|
| `H08 · nMin=10;g=0.15 · XT300` | 364 | 361 | -6.9 % | -35.3 % | [-16.3 %, +8.4 %] | 22 % | -6.1 % [-13.6 %, +5.6 %] | -6.1 % | -5.3 % | 5 % |
| `H08 · nMin=3;g=0.15 · XG` | 972 | 965 | -5.2 % | -31.2 % | [-14.8 %, +6.4 %] | 8 % | -11.5 % [-16.6 %, -5.5 %] | -11.6 % | -9.1 % | 2 % |
| `H08 · nMin=3;g=0.15 · XT300` | 972 | 965 | -2.8 % | -32.5 % | [-10.2 %, +6.1 %] | 24 % | -7.5 % [-12.4 %, -1.5 %] | -7.6 % | -5.7 % | 4 % |
| `H08 · nMin=10;g=0.15 · XT1800` | 364 | 361 | -10.9 % | -45.1 % | [-21.5 %, +5.9 %] | 15 % | -11.8 % [-19.9 %, -1.1 %] | -11.9 % | -7.5 % | 11 % |
| `H08 · nMin=3;g=0.15 · XT1800` | 972 | 965 | -5.9 % | -42.1 % | [-15.6 %, +5.8 %] | 15 % | -14.9 % [-19.7 %, -8.8 %] | -15.0 % | -9.7 % | 8 % |
| `H08 · nMin=3;g=0.15 · XT60` | 972 | 965 | -3.3 % | -20.9 % | [-7.2 %, +2.2 %] | 32 % | -8.9 % [-12.6 %, -4.0 %] | -9.0 % | -4.3 % | 3 % |
| `H08 · nMin=10;g=0.15 · XT60` | 364 | 361 | -5.5 % | -27.2 % | [-10.0 %, +2.2 %] | 29 % | -7.7 % [-14.0 %, +1.7 %] | -7.8 % | -4.0 % | 4 % |
| `H08 · nMin=10;g=0.15 · XG` | 364 | 361 | -11.4 % | -31.4 % | [-21.5 %, +1.8 %] | 7 % | -9.3 % [-15.7 %, -0.3 %] | -9.1 % | -8.2 % | 2 % |
| `H08 · nMin=10;g=0.05 · XG` | 2134 | 2116 | -12.1 % | -31.0 % | [-16.7 %, -6.5 %] | 5 % | -14.6 % [-17.1 %, -12.0 %] | -14.6 % | -13.2 % | 1 % |
| `H08 · nMin=10;g=0.05 · XT1800` | 2134 | 2116 | -14.2 % | -37.3 % | [-19.2 %, -7.8 %] | 9 % | -15.0 % [-18.5 %, -10.9 %] | -15.1 % | -14.4 % | 4 % |
| … 14 more variants in `variants.fromStart.guard.csv` | | | | | | | | | | |

### H09: KILLED

Variants tested: 24 (powered 24, dead at the kill setting 24, underpowered 0). Trades over all variants at the kill setting: 23670.
At the PRIMARY setting (L = 2 s, pessimistic) 22 of 24 powered variants have an upper 95 % bound < 0; variants whose primary CI lies entirely above 0: none.
Primary setting (L = 2 s, pessimistic): variant means range -16.9 % … -3.6 %, median variant -5.9 %.

| Variant | Signals | Kill n | Kill mean | Kill median | Kill 95 % CI | Kill win | Primary mean [CI] | No-insert mean | L = 10 s mean | Via pool |
|---|---|---|---|---|---|---|---|---|---|---|
| `H09 · c=10;D=10 · XB` | 171 | 169 | -5.2 % | -5.2 % | [-9.2 %, -0.8 %] | 17 % | -5.9 % [-10.4 %, -0.5 %] | -6.3 % | -2.9 % | 1 % |
| `H09 · c=3;D=30 · XR` | 1946 | 1922 | -3.4 % | -4.7 % | [-5.1 %, -1.7 %] | 14 % | -3.6 % [-5.5 %, -1.8 %] | -4.1 % | -3.5 % | 2 % |
| `H09 · c=3;D=10 · XR` | 1639 | 1619 | -3.9 % | -5.3 % | [-5.7 %, -1.9 %] | 14 % | -4.5 % [-6.4 %, -2.5 %] | -4.9 % | -3.7 % | 2 % |
| `H09 · c=10;D=30 · XB` | 239 | 235 | -5.2 % | -4.2 % | [-8.5 %, -1.9 %] | 15 % | -4.8 % [-8.6 %, -0.4 %] | -5.5 % | -3.2 % | 1 % |
| `H09 · c=10;D=10 · XT60` | 171 | 169 | -7.4 % | -3.7 % | [-11.5 %, -2.0 %] | 20 % | -4.7 % [-9.1 %, +0.8 %] | -5.1 % | -4.1 % | 2 % |
| `H09 · c=10;D=30 · XT60` | 239 | 235 | -6.4 % | -3.5 % | [-9.7 %, -2.3 %] | 17 % | -4.0 % [-7.6 %, +0.1 %] | -4.4 % | -3.8 % | 2 % |
| `H09 · c=3;D=30 · XB` | 1946 | 1922 | -4.7 % | -4.7 % | [-5.7 %, -3.6 %] | 16 % | -3.8 % [-5.0 %, -2.6 %] | -4.2 % | -3.2 % | 1 % |
| `H09 · c=3;D=30 · XT60` | 1946 | 1922 | -5.2 % | -3.5 % | [-6.3 %, -3.9 %] | 17 % | -3.8 % [-5.2 %, -2.3 %] | -4.3 % | -2.9 % | 1 % |
| `H09 · c=10;D=30 · XT1800` | 239 | 235 | -15.5 % | -4.9 % | [-19.9 %, -11.5 %] | 9 % | -13.2 % [-17.9 %, -9.1 %] | -13.5 % | -12.5 % | 6 % |
| `H09 · c=10;D=10 · XT1800` | 171 | 169 | -19.5 % | -9.3 % | [-25.3 %, -14.2 %] | 10 % | -16.9 % [-23.1 %, -11.4 %] | -17.3 % | -15.9 % | 8 % |
| … 14 more variants in `variants.fromStart.guard.csv` | | | | | | | | | | |

### H10: SURVIVES-FUTILITY

Variants tested: 24 (powered 24, dead at the kill setting 22, underpowered 0). Trades over all variants at the kill setting: 165297.
At the PRIMARY setting (L = 2 s, pessimistic) 24 of 24 powered variants have an upper 95 % bound < 0; variants whose primary CI lies entirely above 0: none.
Primary setting (L = 2 s, pessimistic): variant means range -14.8 % … -6.9 %, median variant -10.1 %.

| Variant | Signals | Kill n | Kill mean | Kill median | Kill 95 % CI | Kill win | Primary mean [CI] | No-insert mean | L = 10 s mean | Via pool |
|---|---|---|---|---|---|---|---|---|---|---|
| `H10 · Pk=0.3;D=0.6;mode=recovery · XR` | 3169 | 3143 | -1.6 % | -22.3 % | [-3.9 %, +1.0 %] | 26 % | -9.5 % [-11.6 %, -7.0 %] | -9.7 % | -11.4 % | 4 % |
| `H10 · Pk=0.5;D=0.6;mode=recovery · XR` | 1533 | 1511 | -2.7 % | -22.4 % | [-5.4 %, +0.2 %] | 26 % | -7.5 % [-10.0 %, -4.6 %] | -7.6 % | -8.8 % | 6 % |
| `H10 · Pk=0.3;D=0.4;mode=recovery · XR` | 7117 | 7054 | -2.5 % | -22.6 % | [-4.1 %, -0.9 %] | 27 % | -9.4 % [-11.3 %, -7.5 %] | -9.5 % | -10.3 % | 4 % |
| `H10 · Pk=0.5;D=0.6;mode=recovery · XB` | 1533 | 1511 | -3.1 % | -30.5 % | [-5.0 %, -1.2 %] | 34 % | -6.9 % [-8.9 %, -4.8 %] | -6.9 % | -7.5 % | 0 % |
| `H10 · Pk=0.3;D=0.4;mode=recovery · XB` | 7117 | 7054 | -3.0 % | -30.5 % | [-3.9 %, -2.0 %] | 35 % | -8.2 % [-9.2 %, -7.1 %] | -8.3 % | -8.1 % | 0 % |
| `H10 · Pk=0.3;D=0.6;mode=recovery · XB` | 3169 | 3143 | -3.7 % | -30.6 % | [-5.0 %, -2.4 %] | 33 % | -8.8 % [-10.4 %, -7.1 %] | -8.9 % | -9.2 % | 0 % |
| `H10 · Pk=0.5;D=0.4;mode=recovery · XR` | 3333 | 3292 | -5.1 % | -23.3 % | [-6.8 %, -2.9 %] | 26 % | -10.1 % [-12.1 %, -7.6 %] | -10.2 % | -9.6 % | 8 % |
| `H10 · Pk=0.5;D=0.4;mode=recovery · XB` | 3333 | 3292 | -4.8 % | -30.5 % | [-6.4 %, -3.0 %] | 33 % | -9.2 % [-10.7 %, -7.3 %] | -9.3 % | -9.1 % | 1 % |
| `H10 · Pk=0.5;D=0.4;mode=dip · XT300` | 6305 | 6252 | -29.2 % | -57.7 % | [-31.6 %, -26.4 %] | 23 % | -14.7 % [-16.2 %, -13.1 %] | -14.8 % | -12.1 % | 4 % |
| `H10 · Pk=0.5;D=0.6;mode=dip · XT300` | 5453 | 5403 | -30.4 % | -54.5 % | [-32.5 %, -28.3 %] | 17 % | -11.4 % [-12.6 %, -10.1 %] | -11.5 % | -7.7 % | 1 % |
| … 14 more variants in `variants.fromStart.guard.csv` | | | | | | | | | | |

### H13: SURVIVES-FUTILITY

Variants tested: 12 (powered 12, dead at the kill setting 0, underpowered 0). Trades over all variants at the kill setting: 32182.
At the PRIMARY setting (L = 2 s, pessimistic) 0 of 12 powered variants have an upper 95 % bound < 0; variants whose primary CI lies entirely above 0: `H13 · a=60;theta=0;cfg=C1 · XB`, `H13 · a=60;theta=0.05;cfg=C1 · XB`, `H13 · a=60;theta=0;cfg=C2 · XB`, `H13 · a=60;theta=0.05;cfg=C2 · XB`, `H13 · a=60;theta=0;cfg=C3 · XB`, `H13 · a=60;theta=0.05;cfg=C3 · XB`, `H13 · a=300;theta=0;cfg=C1 · XB`, `H13 · a=300;theta=0.05;cfg=C1 · XB`, `H13 · a=300;theta=0;cfg=C2 · XB`, `H13 · a=300;theta=0.05;cfg=C2 · XB`, `H13 · a=300;theta=0;cfg=C3 · XB`, `H13 · a=300;theta=0.05;cfg=C3 · XB`.
Primary setting (L = 2 s, pessimistic): variant means range +4.9 % … +26.9 %, median variant +15.8 %.

| Variant | Signals | Kill n | Kill mean | Kill median | Kill 95 % CI | Kill win | Primary mean [CI] | No-insert mean | L = 10 s mean | Via pool |
|---|---|---|---|---|---|---|---|---|---|---|
| `H13 · a=60;theta=0.05;cfg=C1 · XB` | 2143 | 2143 | +22.4 % | +3.1 % | [+19.2 %, +25.8 %] | 52 % | +26.9 % [+23.1 %, +31.6 %] | +26.4 % | +26.4 % | 0 % |
| `H13 · a=60;theta=0.05;cfg=C2 · XB` | 2323 | 2323 | +20.4 % | +0.5 % | [+16.4 %, +24.4 %] | 50 % | +24.9 % [+20.5 %, +29.2 %] | +24.4 % | +24.3 % | 0 % |
| `H13 · a=60;theta=0.05;cfg=C3 · XB` | 2342 | 2342 | +20.4 % | +1.6 % | [+17.0 %, +23.9 %] | 51 % | +24.7 % [+20.6 %, +29.2 %] | +24.2 % | +24.1 % | 0 % |
| `H13 · a=300;theta=0.05;cfg=C1 · XB` | 957 | 957 | +15.1 % | -2.1 % | [+10.4 %, +20.8 %] | 47 % | +19.4 % [+14.3 %, +24.8 %] | +18.6 % | +20.0 % | 0 % |
| `H13 · a=300;theta=0.05;cfg=C3 · XB` | 1092 | 1092 | +13.0 % | -3.5 % | [+8.7 %, +18.3 %] | 44 % | +16.6 % [+11.7 %, +21.9 %] | +16.0 % | +17.3 % | 0 % |
| `H13 · a=300;theta=0.05;cfg=C2 · XB` | 1153 | 1153 | +12.1 % | -3.5 % | [+7.6 %, +17.1 %] | 44 % | +15.8 % [+10.7 %, +20.7 %] | +15.1 % | +16.3 % | 0 % |
| `H13 · a=60;theta=0;cfg=C1 · XB` | 3769 | 3769 | +12.5 % | -3.5 % | [+9.8 %, +15.4 %] | 35 % | +15.8 % [+13.2 %, +18.7 %] | +15.3 % | +15.4 % | 0 % |
| `H13 · a=60;theta=0;cfg=C2 · XB` | 5001 | 5001 | +9.5 % | -3.7 % | [+7.4 %, +11.6 %] | 31 % | +12.7 % [+10.5 %, +14.9 %] | +12.2 % | +11.7 % | 0 % |
| `H13 · a=300;theta=0;cfg=C1 · XB` | 1921 | 1921 | +6.3 % | -3.5 % | [+2.4 %, +11.0 %] | 29 % | +9.2 % [+4.7 %, +14.3 %] | +8.5 % | +9.7 % | 0 % |
| `H13 · a=60;theta=0;cfg=C3 · XB` | 5869 | 5869 | +7.1 % | -3.7 % | [+5.4 %, +8.7 %] | 28 % | +10.0 % [+8.3 %, +11.7 %] | +9.4 % | +9.0 % | 0 % |
| `H13 · a=300;theta=0;cfg=C2 · XB` | 2571 | 2571 | +3.5 % | -3.5 % | [+0.5 %, +7.0 %] | 27 % | +5.8 % [+2.4 %, +9.5 %] | +5.2 % | +5.8 % | 0 % |
| `H13 · a=300;theta=0;cfg=C3 · XB` | 3041 | 3041 | +2.7 % | -3.5 % | [+0.6 %, +5.2 %] | 23 % | +4.9 % [+2.6 %, +7.5 %] | +4.3 % | +5.2 % | 0 % |

### H17: SURVIVES-FUTILITY

Variants tested: 18 (powered 18, dead at the kill setting 12, underpowered 0). Trades over all variants at the kill setting: 523842.
At the PRIMARY setting (L = 2 s, pessimistic) 12 of 18 powered variants have an upper 95 % bound < 0; variants whose primary CI lies entirely above 0: `H17 · lo=0.05;hi=0.2 · XB`.
Primary setting (L = 2 s, pessimistic): variant means range -26.2 % … +11.5 %, median variant -13.3 %.

| Variant | Signals | Kill n | Kill mean | Kill median | Kill 95 % CI | Kill win | Primary mean [CI] | No-insert mean | L = 10 s mean | Via pool |
|---|---|---|---|---|---|---|---|---|---|---|
| `H17 · lo=0.05;hi=0.2 · XR` | 3128 | 3106 | +19.1 % | -4.3 % | [+14.5 %, +25.1 %] | 40 % | +4.3 % [-0.4 %, +10.3 %] | +4.0 % | -2.4 % | 3 % |
| `H17 · lo=0.05;hi=0.2 · XB` | 3128 | 3106 | +15.3 % | -3.5 % | [+12.1 %, +19.8 %] | 47 % | +11.5 % [+7.7 %, +16.9 %] | +11.2 % | +4.9 % | 1 % |
| `H17 · lo=0.05;hi=0.2 · XG` | 3128 | 3106 | +4.6 % | -27.6 % | [-1.1 %, +12.2 %] | 13 % | -1.2 % [-7.0 %, +6.2 %] | -1.4 % | -5.6 % | 3 % |
| `H17 · lo=0.05;hi=0.2 · XT60` | 3128 | 3106 | +6.1 % | -3.5 % | [+2.0 %, +10.9 %] | 42 % | +4.0 % [-0.0 %, +9.1 %] | +3.7 % | -3.1 % | 1 % |
| `H17 · lo=0.05;hi=0.2 · XT300` | 3128 | 3106 | +0.8 % | -16.7 % | [-4.2 %, +7.2 %] | 26 % | +0.1 % [-4.4 %, +6.5 %] | -0.1 % | -4.0 % | 3 % |
| `H17 · lo=0.05;hi=0.2 · XT1800` | 3128 | 3106 | -3.4 % | -26.3 % | [-8.7 %, +3.3 %] | 15 % | -3.1 % [-8.2 %, +3.3 %] | -3.3 % | -6.2 % | 4 % |
| `H17 · lo=0.2;hi=5 · XR` | 67948 | 67261 | -5.7 % | -23.8 % | [-6.5 %, -4.6 %] | 22 % | -13.3 % [-13.9 %, -12.5 %] | -13.5 % | -11.1 % | 0 % |
| `H17 · lo=0.2;hi=5 · XB` | 67948 | 67261 | -6.3 % | -30.0 % | [-6.8 %, -5.7 %] | 28 % | -8.6 % [-9.2 %, -7.9 %] | -8.9 % | -8.1 % | 0 % |
| `H17 · lo=5;hi=Infinity · XT300` | 17108 | 16940 | -25.9 % | -43.3 % | [-27.3 %, -24.4 %] | 9 % | -24.4 % [-25.7 %, -23.1 %] | -24.6 % | -13.6 % | 2 % |
| `H17 · lo=5;hi=Infinity · XT1800` | 17108 | 16940 | -27.7 % | -45.4 % | [-29.3 %, -26.2 %] | 6 % | -26.2 % [-27.4 %, -24.7 %] | -26.4 % | -15.0 % | 3 % |
| … 8 more variants in `variants.fromStart.guard.csv` | | | | | | | | | | |

### H07: CONTROL ONLY (no point-in-time KOL list; no verdict)

Variants tested: 14 (powered 14, dead at the kill setting 4, underpowered 0). Trades over all variants at the kill setting: 214466.
At the PRIMARY setting (L = 2 s, pessimistic) 14 of 14 powered variants have an upper 95 % bound < 0; variants whose primary CI lies entirely above 0: none.
Primary setting (L = 2 s, pessimistic): variant means range -19.5 % … -6.2 %, median variant -10.7 %.

| Variant | Signals | Kill n | Kill mean | Kill median | Kill 95 % CI | Kill win | Primary mean [CI] | No-insert mean | L = 10 s mean | Via pool |
|---|---|---|---|---|---|---|---|---|---|---|
| `H07 · S=2 · XB` | 10062 | 9953 | +10.1 % | -20.2 % | [+8.4 %, +11.7 %] | 48 % | -6.2 % [-7.5 %, -4.9 %] | -6.4 % | -8.1 % | 1 % |
| `H07 · S=2;mirror=true · XT1800` | 10062 | 9953 | +8.7 % | -9.6 % | [+6.5 %, +10.7 %] | 37 % | -8.6 % [-10.1 %, -6.9 %] | -8.8 % | -13.3 % | 4 % |
| `H07 · S=2 · XR` | 10062 | 9953 | +8.1 % | -11.0 % | [+5.9 %, +10.1 %] | 37 % | -8.5 % [-9.6 %, -7.3 %] | -8.7 % | -10.2 % | 4 % |
| `H07 · S=2 · XT60` | 10062 | 9953 | +7.5 % | -13.0 % | [+5.6 %, +9.2 %] | 40 % | -6.6 % [-8.0 %, -5.1 %] | -6.8 % | -7.6 % | 2 % |
| `H07 · S=0.5;mirror=true · XT1800` | 20910 | 20685 | +5.9 % | -9.6 % | [+4.8 %, +7.0 %] | 34 % | -10.7 % [-11.8 %, -9.3 %] | -10.9 % | -13.5 % | 2 % |
| `H07 · S=0.5 · XB` | 20910 | 20685 | +4.9 % | -22.1 % | [+3.9 %, +6.0 %] | 41 % | -8.4 % [-9.1 %, -7.6 %] | -8.6 % | -9.3 % | 0 % |
| `H07 · S=0.5 · XR` | 20910 | 20685 | +4.6 % | -14.3 % | [+3.4 %, +5.7 %] | 33 % | -10.7 % [-11.9 %, -9.6 %] | -10.9 % | -11.5 % | 2 % |
| `H07 · S=0.5 · XT60` | 20910 | 20685 | +3.3 % | -16.4 % | [+2.0 %, +4.6 %] | 36 % | -9.0 % [-9.9 %, -8.0 %] | -9.2 % | -8.5 % | 1 % |
| `H07 · S=2 · XT1800` | 10062 | 9953 | -6.5 % | -38.3 % | [-9.1 %, -3.6 %] | 16 % | -17.2 % [-19.7 %, -14.4 %] | -17.3 % | -17.0 % | 9 % |
| `H07 · S=0.5 · XT1800` | 20910 | 20685 | -10.1 % | -35.7 % | [-11.7 %, -8.2 %] | 12 % | -19.5 % [-21.3 %, -17.3 %] | -19.6 % | -17.4 % | 5 % |
| … 4 more variants in `variants.fromStart.guard.csv` | | | | | | | | | | |

### B_naive (enter every universe coin; PROTOCOL §7 benchmark)

| Entry age | Exit | Setting | n | mean | median | 95 % CI | win | SOL-weighted |
|---|---|---|---|---|---|---|---|---|
| 30 s | XT300 | PRIMARY | 89340 | -8.5 % | -4.9 % | [-8.8 %, -8.2 %] | 10 % | -8.5 % |
| 30 s | XT300 | KILL | 90543 | -9.8 % | -6.0 % | [-10.1 %, -9.5 %] | 10 % | -9.8 % |
| 30 s | XB | PRIMARY | 89340 | -6.4 % | -4.8 % | [-6.7 %, -6.0 %] | 13 % | -6.4 % |
| 30 s | XB | KILL | 90543 | -6.6 % | -6.0 % | [-6.9 %, -6.2 %] | 13 % | -6.6 % |
| 120 s | XT300 | PRIMARY | 89986 | -5.0 % | -2.7 % | [-5.2 %, -4.8 %] | 8 % | -5.0 % |
| 120 s | XT300 | KILL | 90189 | -5.8 % | -3.7 % | [-6.0 %, -5.6 %] | 8 % | -5.8 % |
| 120 s | XB | PRIMARY | 89986 | -4.3 % | -2.8 % | [-4.5 %, -4.0 %] | 8 % | -4.3 % |
| 120 s | XB | KILL | 90189 | -4.6 % | -3.7 % | [-4.8 %, -4.4 %] | 8 % | -4.6 % |

### Filters, standalone (Δ = flagged − unflagged mean net return; primary setting)

| Filter | Params | Cell | Flagged n | Unflagged n | Flagged mean | Unflagged mean | Δ | Δ 95 % CI |
|---|---|---|---|---|---|---|---|---|
| F01 | `{"b":1,"s":10}` | age 30 s, XT300 | 84679 | 4661 | -9.0 % | +0.8 % | -9.8 % | [-12.4 %, -7.4 %] |
| F01 | `{"b":1,"s":10}` | age 30 s, XB | 84679 | 4661 | -7.0 % | +4.2 % | -11.1 % | [-13.7 %, -8.7 %] |
| F01 | `{"b":1,"s":10}` | age 120 s, XT300 | 85258 | 4728 | -5.2 % | -0.9 % | -4.3 % | [-6.2 %, -2.5 %] |
| F01 | `{"b":1,"s":10}` | age 120 s, XB | 85258 | 4728 | -4.5 % | +1.0 % | -5.6 % | [-7.5 %, -3.6 %] |
| F01 | `{"b":1,"s":25}` | age 30 s, XT300 | 79865 | 9475 | -9.2 % | -2.7 % | -6.6 % | [-8.1 %, -5.1 %] |
| F01 | `{"b":1,"s":25}` | age 30 s, XB | 79865 | 9475 | -7.0 % | -1.0 % | -6.0 % | [-7.4 %, -4.7 %] |
| F01 | `{"b":1,"s":25}` | age 120 s, XT300 | 80417 | 9569 | -5.3 % | -2.0 % | -3.3 % | [-4.4 %, -2.2 %] |
| F01 | `{"b":1,"s":25}` | age 120 s, XB | 80417 | 9569 | -4.6 % | -1.3 % | -3.3 % | [-4.5 %, -2.2 %] |
| F01 | `{"b":3,"s":10}` | age 30 s, XT300 | 80052 | 9288 | -9.5 % | -0.2 % | -9.3 % | [-11.1 %, -7.6 %] |
| F01 | `{"b":3,"s":10}` | age 30 s, XB | 80052 | 9288 | -7.4 % | +2.5 % | -9.9 % | [-11.7 %, -8.3 %] |
| F01 | `{"b":3,"s":10}` | age 120 s, XT300 | 80577 | 9409 | -5.4 % | -1.8 % | -3.6 % | [-4.9 %, -2.2 %] |
| F01 | `{"b":3,"s":10}` | age 120 s, XB | 80577 | 9409 | -4.7 % | -0.4 % | -4.3 % | [-5.7 %, -3.0 %] |
| F01 | `{"b":3,"s":25}` | age 30 s, XT300 | 64092 | 25248 | -10.0 % | -4.8 % | -5.2 % | [-6.1 %, -4.4 %] |
| F01 | `{"b":3,"s":25}` | age 30 s, XB | 64092 | 25248 | -7.6 % | -3.2 % | -4.4 % | [-5.2 %, -3.7 %] |
| F01 | `{"b":3,"s":25}` | age 120 s, XT300 | 64520 | 25466 | -5.7 % | -3.2 % | -2.4 % | [-3.1 %, -1.8 %] |
| F01 | `{"b":3,"s":25}` | age 120 s, XB | 64520 | 25466 | -4.9 % | -2.6 % | -2.2 % | [-2.9 %, -1.6 %] |
| F02a | `{"x":50,"T":60}` | age 30 s, XT300 | 70917 | 18423 | -9.0 % | -6.7 % | -2.3 % | [-3.8 %, -0.9 %] |
| F02a | `{"x":50,"T":60}` | age 30 s, XB | 70917 | 18423 | -6.7 % | -5.2 % | -1.5 % | [-2.7 %, -0.5 %] |
| F02a | `{"x":50,"T":60}` | age 120 s, XT300 | 75256 | 14730 | -4.9 % | -5.2 % | +0.2 % | [-0.7 %, +1.3 %] |
| F02a | `{"x":50,"T":60}` | age 120 s, XB | 75256 | 14730 | -4.1 % | -4.9 % | +0.8 % | [-0.2 %, +1.8 %] |
| F02a | `{"x":50,"T":600}` | age 30 s, XT300 | 70917 | 18423 | -9.0 % | -6.7 % | -2.3 % | [-3.8 %, -0.9 %] |
| F02a | `{"x":50,"T":600}` | age 30 s, XB | 70917 | 18423 | -6.7 % | -5.2 % | -1.5 % | [-2.7 %, -0.5 %] |
| F02a | `{"x":50,"T":600}` | age 120 s, XT300 | 77679 | 12307 | -4.9 % | -5.6 % | +0.7 % | [-0.1 %, +1.7 %] |
| F02a | `{"x":50,"T":600}` | age 120 s, XB | 77679 | 12307 | -4.0 % | -5.7 % | +1.7 % | [+0.7 %, +2.7 %] |
| F02a | `{"x":90,"T":60}` | age 30 s, XT300 | 69425 | 19915 | -9.0 % | -6.9 % | -2.1 % | [-3.6 %, -0.7 %] |
| F02a | `{"x":90,"T":60}` | age 30 s, XB | 69425 | 19915 | -6.7 % | -5.2 % | -1.5 % | [-2.6 %, -0.6 %] |
| F02a | `{"x":90,"T":60}` | age 120 s, XT300 | 73947 | 16039 | -4.9 % | -5.5 % | +0.6 % | [-0.3 %, +1.5 %] |
| F02a | `{"x":90,"T":60}` | age 120 s, XB | 73947 | 16039 | -4.1 % | -5.0 % | +1.0 % | [+0.0 %, +1.8 %] |
| F02a | `{"x":90,"T":600}` | age 30 s, XT300 | 69425 | 19915 | -9.0 % | -6.9 % | -2.1 % | [-3.6 %, -0.7 %] |
| F02a | `{"x":90,"T":600}` | age 30 s, XB | 69425 | 19915 | -6.7 % | -5.2 % | -1.5 % | [-2.6 %, -0.6 %] |
| F02a | `{"x":90,"T":600}` | age 120 s, XT300 | 76569 | 13417 | -4.9 % | -5.5 % | +0.7 % | [-0.2 %, +1.7 %] |
| F02a | `{"x":90,"T":600}` | age 120 s, XB | 76569 | 13417 | -4.0 % | -5.6 % | +1.6 % | [+0.6 %, +2.7 %] |
| F03 | `{"h":5}` | age 30 s, XT300 | 47638 | 41702 | -10.1 % | -6.7 % | -3.5 % | [-4.6 %, -2.4 %] |
| F03 | `{"h":5}` | age 30 s, XB | 47638 | 41702 | -8.0 % | -4.5 % | -3.5 % | [-4.5 %, -2.6 %] |
| F03 | `{"h":5}` | age 120 s, XT300 | 46600 | 43386 | -5.2 % | -4.7 % | -0.5 % | [-1.0 %, -0.0 %] |
| F03 | `{"h":5}` | age 120 s, XB | 46600 | 43386 | -4.7 % | -3.8 % | -0.9 % | [-1.3 %, -0.4 %] |
| F03 | `{"h":15}` | age 30 s, XT300 | 44188 | 45152 | -10.0 % | -7.0 % | -3.0 % | [-4.0 %, -2.1 %] |
| F03 | `{"h":15}` | age 30 s, XB | 44188 | 45152 | -7.9 % | -4.9 % | -3.0 % | [-3.7 %, -2.2 %] |
| F03 | `{"h":15}` | age 120 s, XT300 | 44361 | 45625 | -5.1 % | -4.9 % | -0.2 % | [-0.6 %, +0.3 %] |
| F03 | `{"h":15}` | age 120 s, XB | 44361 | 45625 | -4.4 % | -4.1 % | -0.3 % | [-0.8 %, +0.1 %] |
| F04 | `{"c":25}` | age 30 s, XT300 | 15086 | 74254 | -19.7 % | -6.2 % | -13.5 % | [-14.5 %, -12.4 %] |
| F04 | `{"c":25}` | age 30 s, XB | 15086 | 74254 | -13.5 % | -4.9 % | -8.5 % | [-9.5 %, -7.5 %] |
| F04 | `{"c":25}` | age 120 s, XT300 | 9717 | 80269 | -13.2 % | -4.0 % | -9.2 % | [-10.0 %, -8.4 %] |
| F04 | `{"c":25}` | age 120 s, XB | 9717 | 80269 | -11.3 % | -3.4 % | -7.9 % | [-8.6 %, -7.2 %] |
| F04 | `{"c":40}` | age 30 s, XT300 | 3706 | 85634 | -19.9 % | -8.0 % | -11.8 % | [-14.9 %, -8.3 %] |
| F04 | `{"c":40}` | age 30 s, XB | 3706 | 85634 | -13.5 % | -6.1 % | -7.4 % | [-9.8 %, -4.8 %] |
| F04 | `{"c":40}` | age 120 s, XT300 | 2355 | 87631 | -13.7 % | -4.7 % | -9.0 % | [-10.9 %, -6.7 %] |
| F04 | `{"c":40}` | age 120 s, XB | 2355 | 87631 | -11.5 % | -4.1 % | -7.4 % | [-9.3 %, -5.5 %] |
| F05 | `{"n":5}` | age 30 s, XT300 | 31564 | 57776 | -9.7 % | -7.9 % | -1.8 % | [-2.5 %, -1.0 %] |
| F05 | `{"n":5}` | age 30 s, XB | 31564 | 57776 | -7.6 % | -5.7 % | -1.9 % | [-2.3 %, -1.5 %] |
| F05 | `{"n":5}` | age 120 s, XT300 | 31777 | 58209 | -4.6 % | -5.2 % | +0.5 % | [+0.2 %, +0.9 %] |
| F05 | `{"n":5}` | age 120 s, XB | 31777 | 58209 | -3.9 % | -4.4 % | +0.5 % | [+0.1 %, +0.9 %] |
| F05 | `{"n":20}` | age 30 s, XT300 | 15192 | 74148 | -9.0 % | -8.4 % | -0.6 % | [-1.4 %, +0.3 %] |
| F05 | `{"n":20}` | age 30 s, XB | 15192 | 74148 | -7.4 % | -6.2 % | -1.3 % | [-1.8 %, -0.8 %] |
| F05 | `{"n":20}` | age 120 s, XT300 | 15249 | 74737 | -4.2 % | -5.1 % | +0.9 % | [+0.5 %, +1.3 %] |
| F05 | `{"n":20}` | age 120 s, XB | 15249 | 74737 | -3.7 % | -4.4 % | +0.6 % | [+0.2 %, +1.0 %] |
| F06 | `{}` | age 30 s, XT300 | 31278 | 58062 | -9.3 % | -8.1 % | -1.2 % | [-1.8 %, -0.5 %] |
| F06 | `{}` | age 30 s, XB | 31278 | 58062 | -6.8 % | -6.1 % | -0.6 % | [-1.1 %, -0.1 %] |
| F06 | `{}` | age 120 s, XT300 | 31939 | 58047 | -5.0 % | -4.9 % | -0.1 % | [-0.5 %, +0.4 %] |
| F06 | `{}` | age 120 s, XB | 31939 | 58047 | -4.0 % | -4.4 % | +0.4 % | [-0.2 %, +0.9 %] |
| F07 | `{"w":10,"note":"WT2 only"}` | age 30 s, XT300 | 75437 | 13903 | -8.4 % | -9.1 % | +0.7 % | [-0.4 %, +1.8 %] |
| F07 | `{"w":10,"note":"WT2 only"}` | age 30 s, XB | 75437 | 13903 | -6.6 % | -5.2 % | -1.4 % | [-2.4 %, -0.4 %] |
| F07 | `{"w":10,"note":"WT2 only"}` | age 120 s, XT300 | 72051 | 17935 | -4.4 % | -7.1 % | +2.7 % | [+1.8 %, +3.8 %] |
| F07 | `{"w":10,"note":"WT2 only"}` | age 120 s, XB | 72051 | 17935 | -4.0 % | -5.3 % | +1.3 % | [+0.4 %, +2.3 %] |
| F07 | `{"w":30,"note":"WT2 only"}` | age 30 s, XT300 | 42982 | 46358 | -6.2 % | -10.7 % | +4.5 % | [+4.0 %, +5.2 %] |
| F07 | `{"w":30,"note":"WT2 only"}` | age 30 s, XB | 42982 | 46358 | -5.4 % | -7.3 % | +1.9 % | [+1.5 %, +2.2 %] |
| F07 | `{"w":30,"note":"WT2 only"}` | age 120 s, XT300 | 35084 | 54902 | -3.4 % | -6.0 % | +2.5 % | [+2.1 %, +3.0 %] |
| F07 | `{"w":30,"note":"WT2 only"}` | age 120 s, XB | 35084 | 54902 | -3.4 % | -4.8 % | +1.4 % | [+0.9 %, +1.8 %] |
| F08 | `{"v":"no X/TG/website"}` | age 30 s, XT300 | 3800 | 69658 | -2.4 % | -8.8 % | +6.4 % | [+4.8 %, +8.1 %] |
| F08 | `{"v":"no X/TG/website"}` | age 30 s, XB | 3800 | 69658 | +1.7 % | -6.7 % | +8.4 % | [+6.2 %, +11.0 %] |
| F08 | `{"v":"no X/TG/website"}` | age 120 s, XT300 | 3825 | 70246 | -2.2 % | -5.1 % | +3.0 % | [+0.7 %, +5.4 %] |
| F08 | `{"v":"no X/TG/website"}` | age 120 s, XB | 3825 | 70246 | +0.5 % | -4.5 % | +5.0 % | [+2.5 %, +7.5 %] |
| F08 | `{"v":"no Telegram"}` | age 30 s, XT300 | 71482 | 1976 | -8.7 % | -0.3 % | -8.4 % | [-11.9 %, -4.4 %] |
| F08 | `{"v":"no Telegram"}` | age 30 s, XB | 71482 | 1976 | -6.4 % | -0.8 % | -5.6 % | [-8.7 %, -2.7 %] |
| F08 | `{"v":"no Telegram"}` | age 120 s, XT300 | 72089 | 1982 | -5.0 % | -3.4 % | -1.7 % | [-4.2 %, +0.6 %] |
| F08 | `{"v":"no Telegram"}` | age 120 s, XB | 72089 | 1982 | -4.3 % | -2.7 % | -1.6 % | [-4.2 %, +1.1 %] |
| NOCB | `{"v":"no creator buy (H17 filter use)"}` | age 30 s, XT300 | 1439 | 87901 | -20.8 % | -8.3 % | -12.5 % | [-15.1 %, -9.0 %] |
| NOCB | `{"v":"no creator buy (H17 filter use)"}` | age 30 s, XB | 1439 | 87901 | -20.1 % | -6.1 % | -13.9 % | [-17.1 %, -9.3 %] |
| NOCB | `{"v":"no creator buy (H17 filter use)"}` | age 120 s, XT300 | 1451 | 88535 | -15.5 % | -4.8 % | -10.7 % | [-12.8 %, -7.5 %] |
| NOCB | `{"v":"no creator buy (H17 filter use)"}` | age 120 s, XB | 1451 | 88535 | -16.1 % | -4.1 % | -12.0 % | [-14.6 %, -8.7 %] |

| Filter | Verdict (pre-stated rule B) |
|---|---|
| F01 | SUPPORTED-ON-TAPE (cannot promote) |
| F02a | SURVIVES-FUTILITY (inconclusive) |
| F03 | SUPPORTED-ON-TAPE (cannot promote) |
| F04 | SUPPORTED-ON-TAPE (cannot promote) |
| F05 | SURVIVES-FUTILITY (inconclusive) |
| F06 | SURVIVES-FUTILITY (inconclusive) |
| F07 | SURVIVES-FUTILITY (inconclusive) |
| F08 | SURVIVES-FUTILITY (inconclusive) |
| NOCB | SUPPORTED-ON-TAPE (cannot promote) |

### F02 (b) exit override (paired: override − base, on naive positions where the dev dump fires during the hold)

| Params | Cell | Setting | n | mean Δ | 95 % CI |
|---|---|---|---|---|---|
| `{"x":50,"T":60}` | age 30 s, XT300 | PRIMARY | 3743 | +1.1 % | [-0.9 %, +2.9 %] |
| `{"x":50,"T":600}` | age 30 s, XT300 | PRIMARY | 9469 | +0.5 % | [-0.4 %, +1.4 %] |
| `{"x":90,"T":60}` | age 30 s, XT300 | PRIMARY | 3926 | +1.5 % | [-0.3 %, +3.0 %] |
| `{"x":90,"T":600}` | age 30 s, XT300 | PRIMARY | 9950 | +1.4 % | [+0.6 %, +2.3 %] |
| `{"x":50,"T":60}` | age 30 s, XT300 | KILL | 3800 | +4.3 % | [+1.6 %, +6.8 %] |
| `{"x":50,"T":600}` | age 30 s, XT300 | KILL | 9613 | +6.3 % | [+4.9 %, +7.6 %] |
| `{"x":90,"T":60}` | age 30 s, XT300 | KILL | 3987 | +4.5 % | [+2.0 %, +6.7 %] |
| `{"x":90,"T":600}` | age 30 s, XT300 | KILL | 10106 | +7.0 % | [+5.6 %, +8.4 %] |
| `{"x":50,"T":60}` | age 30 s, XB | PRIMARY | 3743 | -1.6 % | [-3.1 %, -0.4 %] |
| `{"x":50,"T":600}` | age 30 s, XB | PRIMARY | 9469 | -1.1 % | [-2.0 %, -0.4 %] |
| `{"x":90,"T":60}` | age 30 s, XB | PRIMARY | 3926 | -1.0 % | [-2.4 %, +0.0 %] |
| `{"x":90,"T":600}` | age 30 s, XB | PRIMARY | 9950 | -0.9 % | [-1.7 %, -0.2 %] |
| `{"x":50,"T":60}` | age 30 s, XB | KILL | 3800 | -0.5 % | [-2.2 %, +0.7 %] |
| `{"x":50,"T":600}` | age 30 s, XB | KILL | 9613 | +0.6 % | [-0.4 %, +1.4 %] |
| `{"x":90,"T":60}` | age 30 s, XB | KILL | 3987 | -0.2 % | [-1.6 %, +0.9 %] |
| `{"x":90,"T":600}` | age 30 s, XB | KILL | 10106 | +0.7 % | [-0.2 %, +1.5 %] |
| `{"x":50,"T":60}` | age 120 s, XT300 | PRIMARY | 0 | n/a | [n/a, n/a] |
| `{"x":50,"T":600}` | age 120 s, XT300 | PRIMARY | 3359 | +1.0 % | [-0.1 %, +2.1 %] |
| `{"x":90,"T":60}` | age 120 s, XT300 | PRIMARY | 0 | n/a | [n/a, n/a] |
| `{"x":90,"T":600}` | age 120 s, XT300 | PRIMARY | 3460 | +1.3 % | [+0.1 %, +2.6 %] |
| `{"x":50,"T":60}` | age 120 s, XT300 | KILL | 0 | n/a | [n/a, n/a] |
| `{"x":50,"T":600}` | age 120 s, XT300 | KILL | 3370 | +7.8 % | [+6.3 %, +9.5 %] |
| `{"x":90,"T":60}` | age 120 s, XT300 | KILL | 0 | n/a | [n/a, n/a] |
| `{"x":90,"T":600}` | age 120 s, XT300 | KILL | 3472 | +8.0 % | [+6.5 %, +9.5 %] |
| `{"x":50,"T":60}` | age 120 s, XB | PRIMARY | 0 | n/a | [n/a, n/a] |
| `{"x":50,"T":600}` | age 120 s, XB | PRIMARY | 3359 | +0.5 % | [-0.0 %, +0.9 %] |
| `{"x":90,"T":60}` | age 120 s, XB | PRIMARY | 0 | n/a | [n/a, n/a] |
| `{"x":90,"T":600}` | age 120 s, XB | PRIMARY | 3460 | +0.5 % | [-0.2 %, +1.0 %] |
| `{"x":50,"T":60}` | age 120 s, XB | KILL | 0 | n/a | [n/a, n/a] |
| `{"x":50,"T":600}` | age 120 s, XB | KILL | 3370 | +2.6 % | [+2.0 %, +3.3 %] |
| `{"x":90,"T":60}` | age 120 s, XB | KILL | 0 | n/a | [n/a, n/a] |
| `{"x":90,"T":600}` | age 120 s, XB | KILL | 3472 | +2.5 % | [+1.9 %, +3.1 %] |

F02 (b) verdict: SURVIVES-FUTILITY

### PROTOCOL §11.1 campaign-level check (information)

Variants of H01–H13 with a positive mean at the primary setting (L = 2 s): 26.

- H01 · V=35;N=25;T=60 · XT60 (n=34, mean +13.3 %)
- H01 · V=35;N=25;T=60 · XT300 (n=34, mean +5.0 %)
- H01 · V=35;N=25;T=60 · XT1800 (n=34, mean +0.6 %)
- H01 · V=35;N=25;T=60 · XB (n=34, mean +8.4 %)
- H01 · V=35;N=25;T=60 · XR (n=34, mean +1.4 %)
- H01 · V=35;N=60;T=60 · XB (n=311, mean +0.9 %)
- H04 · A=900;r=0.8 · XT1800 (n=65, mean +2.9 %)
- H04 · A=900;r=0.8 · XB (n=65, mean +2.2 %)
- H04 · A=900;r=0.8 · XR (n=65, mean +3.7 %)
- H04 · A=900;r=0.8 · XG (n=65, mean +2.8 %)
- H13 · a=60;theta=0;cfg=C1 · XB (n=3769, mean +15.8 %)
- H13 · a=60;theta=0.05;cfg=C1 · XB (n=2143, mean +26.9 %)
- H13 · a=60;theta=0;cfg=C2 · XB (n=5001, mean +12.7 %)
- H13 · a=60;theta=0.05;cfg=C2 · XB (n=2323, mean +24.9 %)
- H13 · a=60;theta=0;cfg=C3 · XB (n=5869, mean +10.0 %)
- H13 · a=60;theta=0.05;cfg=C3 · XB (n=2342, mean +24.7 %)
- H13 · a=300;theta=0;cfg=C1 · XB (n=1921, mean +9.2 %)
- H13 · a=300;theta=0.05;cfg=C1 · XB (n=957, mean +19.4 %)
- H13 · a=300;theta=0;cfg=C2 · XB (n=2571, mean +5.8 %)
- H13 · a=300;theta=0.05;cfg=C2 · XB (n=1153, mean +15.8 %)
- H13 · a=300;theta=0;cfg=C3 · XB (n=3041, mean +4.9 %)
- H13 · a=300;theta=0.05;cfg=C3 · XB (n=1092, mean +16.6 %)
- H17 · lo=0.05;hi=0.2 · XT60 (n=2698, mean +4.0 %)
- H17 · lo=0.05;hi=0.2 · XT300 (n=2698, mean +0.1 %)
- H17 · lo=0.05;hi=0.2 · XB (n=2698, mean +11.5 %)
- H17 · lo=0.05;hi=0.2 · XR (n=2698, mean +4.3 %)
