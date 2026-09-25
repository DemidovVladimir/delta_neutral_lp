# Collected data, 2026-09-23 … 25: C1 test, exploratory scan, tape bias

**Date:** 2026-09-25. **Status:** operator-ordered early analysis; there were no RPC calls and
no transactions.

**Code:** `research/memecoins/backtest/collected-2d.ts`, which reuses the frozen C1 components,
and `activity-compare.ts`.

**Raw outputs:** `results/raw/collected-2d.json`, `collected-2d.log`,
`activity-compare.collector.json`, `activity-compare.vdw.json`.

## Verdict

**Nothing shows through.**

1. **C1 is killed** (H17, creator buy 0.05–0.2 SOL, bracket exit, frozen before any collector
   result).
   - Mean −2.99 % per trade, 1-hour-block 95 % CI [−3.55 %, −2.45 %].
   - n = 3,480 fills, win rate 5 %.
   - −10.48 SOL in total on 0.1 SOL stakes.
2. **The tape's +11.5 % was a selection artefact.**
   - On the tape, C1 coins had a median of **74 trades and 44.5 SOL** of volume in their first
     30 min.
   - On our unselected data they have a median of **4 trades and 0.23 SOL**. 96 % of C1 trades
     exit on the time stop with the price nearly unchanged, so the loss is simply the fee round
     trip.
3. **Exploratory scan (266 variants with ≥ 30 trades):** **0** have a CI lower bound > 0. About
   6.7 would be expected by chance even if every true mean were 0. 186 have an upper bound < 0.
4. **The tape's negative directions replicate almost everywhere.** Every entry that waits for
   visible buying loses again: velocity, breadth, pressure, near-graduation, dip-buy and
   KOL-follow are negative in 59/60, 36/36, 24/24, 12/12, 24/24 and 14/14 variants.
5. **Loss-avoidance filters F01, F03 and F04 replicate:** flagged coins do 2–11 pp worse. They cut
   losses; they do not create an edge.

## 1. Data and deviations

- **Database:** `research/memecoins/data/memecoins.db`, read-only. The collector is stopped, and
  the last trade is 2026-09-25 13:48:31Z.
- **Loaded:** 69,632 creations, 63,263 of them with curve trades, and 6,350,171 curve trades.
  Of those trades, 6,076,242 are backfill (source 2) and 273,929 are live.
- **Excluded:**
  - 6,369 coins quoted in something other than SOL (U1);
  - 21,864 mayhem coins (U3).
- **Measured slot time: 0.2677 s.** So L = 2 s is 8 slots (erratum A1.1).
- **Usable ranges:**
  - the continuous backfill from 2026-09-23 04:22Z to 2026-09-25 00:02Z;
  - live data from 2026-09-25 10:13Z to 13:48Z.

  The 15 sample chunks from 18–22 Sep drop out under the 65-min downtime guard, as intended.

**Operator-ordered deviations.** They are recorded in HYPOTHESES.md Amendment A1.2 *before* the
run (sha256 in `raw/hypotheses-amendment-A1.sha256`, 14:40:29Z):
- (a) The look-1 void rule (≥ 5 usable days and ≥ 100 fills) is **overridden**. This look covers
  2.4 days and 46 signal hours.
- (b) The look includes live coins created 2026-09-25 10:13–13:48Z, which belonged to look 2. Look 2
  therefore now starts at 2026-09-25 13:48:31Z.
- (c) The decision bootstrap is the **1-hour-block** bootstrap (10,000 resamples) instead of day
  blocks. Coin-level and day-block CIs are reported alongside.

The C1 definition and code were unchanged: all 11 frozen file hashes were re-verified before the
run. The outcome is recorded in Amendment A1.3.

## 2. C1, exactly as frozen

C1 = `H17 · lo=0.05;hi=0.2 · XB`:
- creator buy in the create transaction of 0.05–0.2 SOL;
- entry at creation + L with a 0.1 SOL budget;
- take profit +50 %, stop −30 %, time stop 1,800 s;
- insert-and-replay, p_fail 0.10.

Signals: 3,599. Of those, 3,480 filled, 81 failed the slippage guard, 31 were abandoned, and 7
completed before entry. Exit reasons at the primary setting: 3,329 time stops, 100 take-profits,
44 stops, 7 curve completions.

| Setting | Fills | Mean net / trade | Median | Win rate | SOL PnL (0.1 SOL stakes) | 95 % CI, 1-hour blocks | 95 % CI, coin level | 95 % CI, day blocks (3 days) |
|---|---|---|---|---|---|---|---|---|
| **L = 2 s, pessimistic (primary; decides)** | 3,480 | **−2.99 %** | −3.32 % | 5.0 % | **−10.48** | **[−3.55, −2.45]** | [−3.40, −2.54] | [−3.44, −1.96] |
| L = 0.4 s, optimistic, racing budget | 3,566 | −2.49 % | −4.10 % | 5.9 % | −8.91 | [−3.12, −1.85] | [−2.96, −1.99] | [−3.16, −0.75] |
| L = 0.4 s, pessimistic | 3,517 | −3.21 % | −4.11 % | 5.2 % | −11.48 | [−3.87, −2.55] | [−3.69, −2.73] | [−3.88, −1.35] |
| L = 2 s, no-insert (conservative) | 3,480 | −3.54 % | −3.95 % | 4.7 % | −12.39 | [−4.10, −2.99] | [−3.95, −3.08] | [−4.03, −2.57] |
| L = 10 s, pessimistic | 3,464 | −3.28 % | −3.33 % | 4.2 % | −11.48 | [−3.82, −2.77] | [−3.66, −2.87] | [−3.65, −3.01] |

- **Other primary statistics:** trimmed mean −3.33 %; mean without the top 3 trades −3.13 %; best
  trade +247 %; worst −89 %.
- **By day:** 23 Sep −3.44 % (n 1,462); 24 Sep −2.71 % (n 1,873); 25 Sep live −1.96 % (n 145).
- **Decision under A1.2 / A1.5:** the 97.5th percentile is < 0, so **KILL**. C1 is dead, and
  look 2 will be descriptive only.
- **The other H17 buckets are negative too.**
  - 0.2–5 SOL: −4.6 … −11.4 % across the six exits.
  - ≥ 5 SOL: −11.4 … −21.1 %.
  - The tape's sign pattern for these buckets (negative) replicates.

## 3. Exploratory scan: the public-tape grid on our data

- **What ran:** 296 variants: H01–H06, H08–H10 and H17 on the frozen grids, including the killed
  H02/H05/H09 for comparison, plus the H07 KOL control. 266 of them have ≥ 30 fills. H13 is not
  testable: it needs 14 days of training.
- **Treatment:** exploratory, 1-hour-block CIs, primary setting. Ledger rows are appended with
  split `collector-exploratory-2026-09-23..25`; there are no new variant IDs.
- **Caveat:** the trailing objects (Bot, rings, W* smart wallets, creator histories) have only
  about 1.5 days of history here, not the protocol's 7–30 days. So H02–H04, H06 and H08 run on
  thin inputs.

**Baseline** (enter every universe coin; primary):

| Entry | Exit | n | Mean | Median | Win rate | 1-hour-block CI |
|---|---|---|---|---|---|---|
| age 30 s | XT300 | 35,014 | **−4.97 %** | −2.92 % | 6.8 % | [−5.44, −4.48] |
| age 30 s | XB | 35,014 | −4.77 % | −3.34 % | 7.4 % | [−5.18, −4.32] |
| age 120 s | XT300 | 35,009 | −4.11 % | −2.73 % | 4.8 % | [−4.39, −3.82] |
| age 120 s | XB | 35,009 | −4.33 % | −2.77 % | 4.9 % | [−4.58, −4.06] |

The tape's comparable figure was −8.5 % at 30 s / XT300.

**Top 10 variants by mean** (primary, n ≥ 30). **None has a CI lower bound > 0.**

| Variant | n | Mean | Median | Win rate | 1-hour-block CI | Coin-level CI | Tape mean (primary) |
|---|---|---|---|---|---|---|---|
| `H08 · nMin=10;g=0.05 · XG` | 68 | +20.2 % | −33.6 % | 10 % | [−27.9, +75.0] | [−23.2, +75.9] | −14.6 % |
| `H08 · nMin=10;g=0.05 · XT300` | 68 | +19.4 % | −48.8 % | 16 % | [−23.8, +69.0] | [−21.8, +72.7] | −10.7 % |
| `H08 · nMin=10;g=0.05 · XR` | 68 | +17.7 % | −30.7 % | 25 % | [−19.9, +67.8] | [−19.1, +68.6] | −9.1 % |
| `H08 · nMin=10;g=0.05 · XT1800` | 68 | +17.0 % | −49.6 % | 9 % | [−32.3, +71.2] | [−28.0, +73.2] | −15.0 % |
| `H06 · k=3;D=60 · XR` | 77 | +14.4 % | −17.5 % | 34 % | [−14.4, +38.7] | [−11.7, +51.5] | −7.4 % |
| `H06 · k=3;D=60 · XB` | 77 | +5.5 % | −18.1 % | 43 % | [−5.1, +14.5] | [−3.7, +14.9] | −3.7 % |
| `H06 · k=3;D=600 · XR` | 176 | +4.0 % | −19.8 % | 31 % | [−10.0, +18.3] | [−9.3, +21.6] | −6.6 % |
| `H06 · k=3;D=600 · XT60` | 176 | +4.0 % | −2.4 % | 47 % | [−0.1, +8.9] | [−0.6, +8.9] | −1.7 % |
| `H08 · nMin=3;g=0.15 · XB` | 65 | +3.4 % | −22.7 % | 32 % | [−8.8, +15.8] | [−8.6, +15.9] | −5.1 % |
| `H06 · k=2;D=600 · XT60` | 424 | +2.2 % | −1.8 % | 47 % | [−0.5, +5.1] | [−0.8, +5.4] | −1.9 % |

The top four are the same 68 coins seen through different exits: a few big winners, with a median
of −34 … −50 %. The H06 entries are small-n cells built on a W* list drawn from 1.5 days of
history. With 266 cells tested, they are what chance produces.

**Count against chance.**
- 0 of 266 have a CI lower bound > 0; about 6.7 are expected under a true mean of 0.
- **186 of 266 have an upper bound < 0.**

**Direction replication** (primary; median variant, and sign agreement per variant with the
tape):

| Hypothesis | Variants < 0 (ours) | Median variant (ours) | Median variant (tape) | Sign agreement |
|---|---|---|---|---|
| H01 velocity | 59 / 60 | −14.5 % | −16.3 % | 58 / 60 |
| H02 organic breadth (killed on tape) | 36 / 36 | −9.6 % | −11.7 % | 36 / 36 |
| H03 net pressure | 24 / 24 | −10.2 % | −14.1 % | 24 / 24 |
| H04 retention | 12 / 12 powered | −11.0 % | −23.9 % | 12 / 12 |
| H05 near graduation (killed on tape) | 12 / 12 | −8.0 % | −14.4 % | 12 / 12 |
| H06 smart-wallet consensus | 16 / 24 | −2.1 % | −7.4 % | 16 / 24 |
| H07 KOL follow (control) | 14 / 14 | −6.7 % | −10.7 % | 14 / 14 |
| H08 creator track record | 12 / 18 powered | −4.6 % | −9.0 % | 12 / 18 |
| H09 copycat (killed on tape) | 22 / 24 | −4.9 % | −6.3 % | 22 / 24 |
| H10 dip buy (control) | 24 / 24 | −10.6 % | −10.1 % | 24 / 24 |
| H17 creator buy | **18 / 18** | −7.0 % | −14.4 % | 14 / 18: **the tape's four positive H17-small exits flip negative** |

**Filters** (primary; Δ = flagged − unflagged; 1-hour-block paired CI):

| Filter | Result on our data | On the tape |
|---|---|---|
| F01 bundled launch | Δ −1.8 … −5.8 pp; CI < 0 in all 16 cells | supported |
| F03 ring presence | Δ −2.1 … −3.8 pp; CI < 0 in all 8 cells | supported (30 s entry) |
| F04 holder concentration | Δ −5.3 … −11.5 pp; CI < 0 in 7 of 8 cells | supported |
| F02a dev dump, no entry | −0.4 … −0.1 pp at 30 s; **+0.6 … +1.1 pp at 120 s** (flagged coins do *better*) | mixed |
| F02b dev dump, exit override | +0.4 … +0.8 pp with T = 600 s (CI > 0 in 7 of 8 cells); ≈ 0 … −0.9 pp with T = 60 s. A small loss saver | mixed |
| F05 factory, F06 copycat | about 0 | about 0 |
| F07 wash | w = 10: −0.5 … −2.6 pp; w = 30: ≈ 0 … +0.6 pp | w = 30 flagged better |
| "No creator buy" | about 0 (−0.9 … +0.3 pp) | −11 … −14 pp. **Does not replicate: a tape selection effect** |

## 4. How winner-biased was the public tape? (descriptive)

**Coin activity in the first 30 minutes** (universe coins with downtime-free signals):

| | Tape: all coins | Ours: all coins | Tape: C1 coins | Ours: C1 coins |
|---|---|---|---|---|
| Coins | 92,283 | 36,624 | 3,177 | 3,631 |
| Share with no trade after creation (30 min) | 0.1 % | **7.7 %** | 0.1 % | 3.9 % |
| Trades in 30 min, p25 / p50 / p90 | 19 / 43 / 437 | **3 / 9 / 196** | 23 / 74 / 550 | **1 / 4 / 28** |
| SOL volume in 30 min, p50 / p90 | 27.7 / 197 | **2.4 / 87** | 44.5 / 338 | **0.23 / 11** |
| Peak curve progress in 30 min, p50 | 13.3 % | **1.8 %** | 18.1 % | **0.2 %** |
| Curve completed within 1 h | 2.4 % | 3.9 % (post-BOOST) | 6.0 % | 1.8 % |

**Completion within 1 h by creator buy** (our data): none 1.3 %; < 0.05 SOL 2.5 %; 0.05–0.2 SOL
1.8 %; 0.2–5 SOL 1.6 %; **≥ 5 SOL 44.4 %**. Buying after a ≥ 5 SOL creator buy still loses
−11 … −21 %, because the price is already up when we get in.

**SOL-weighted return per (wallet, coin) position.** Pro-rata liquidation marks, coins with 2
clean hours, pump fee 1.25 %/side (raw in brackets):

| Group | Ours (35,081 coins) | Tape (64,976 coins) | Earlier measurement |
|---|---|---|---|
| All non-creator buyers | **−7.2 %** (raw −4.9 %); **−9.0 % after retail costs**; 27.5 % profitable | −9.2 % (raw −6.9 %); −11.0 % after retail costs | A26: −20 % after retail costs |
| First-slot buyers (exact creation slot) | **+14.3 %** (raw +17.2 %), n 60,036 | same-second buyers +11.1 % (raw +13.9 %) | A26 first-slot snipers −29 … −51 % |
| Buyers in the first ≤ 1 s (like the tape's same-second group) | +12.4 % | +11.1 % | — |
| First buy 2–10 s | −4.5 % | −4.0 % | — |
| Later buyers | −13.4 % | −14.3 % | — |
| Creators | **−3.1 %** | **+35.6 %** | −12.7 … +23 % |

**The winner bias is in activity, not in the graduation rate.** The tape left out dead and quiet
coins: 7.7 % of our coins never trade again, against 0.1 % on the tape, and the median coin has 9
trades against 43. The coins it kept were the ones where creators profited and where a
launch-time entry could ride flow.

The retail figure (−9.0 %) is milder than A26's −20 %. First-slot buyers (+14 %) are positive on
both datasets; that group is mostly the creator's own bundle and insiders, not an outside bot at
L ≥ 0.4 s. A26's −29 … −51 % was measured on sniper positions with retail costs on 228 launches,
so it is a different definition.

## 5. What this means for the campaign

- **C1**, the only candidate the public tape surfaced, is dead on unselected post-BOOST data.
- **Every hand-rule family** is negative or indistinguishable from zero. Filters cut losses but do
  not create an edge.
- **H13** (ML ceiling) and the **post-migration families** (H11, H12, H15, H16) remain untested.
  The PumpSwap backfill was not completed, and 2 days cannot train H13.

My read: the hand-rule part of the campaign is effectively dead, and no positive signal has
appeared on any dataset once selection is removed. PROTOCOL §11.1's day-28 futility check would
stop the campaign if H13 is also ≤ 0. Everything seen so far points that way.
