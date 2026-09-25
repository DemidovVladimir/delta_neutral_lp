# Addendum A1 to the pre-stated futility rule

Written 2026-09-25 ~12:15 UTC, after the data-quality audit (`tape-audit.vdw.json`) and **before any
P&L simulation was run on the tape**.

## Findings that force changes

1. **G1 fails at the letter.**
   - 34,845 of 149,989 mints (23.2 %) have ≥ 1 reserve-chain break. They carry 66 % of the trades.
   - Unobserved net flow is 1.67 % of all volume. For the median gapped mint it is 2.5 % of its
     volume; at p90 it is 34 %.
   - Breaks happen at a median age of 201 s, not only at creation.
   - Under U4 (> 2 % of a day's mints failing → drop the day) every day would be dropped.
2. **Strict exclusion (D3) is look-ahead.** "No break in the coin's whole life" conditions on what
   happens after the entry. Breaks concentrate in active coins, so strict G1 would remove winners
   after the fact and bias every entry rule downward. That is invalid for a kill.
3. **G5.** 19 of the 28 collected days have > 1 % downtime (> 14.4 min with zero trades).
   G5 as written would leave 7 analysis days.
4. **No slots.** The slot column is 0 in all 28,669,509 rows, so the clock is block_time
   (1 s), as described in D.
5. **Longer and later than described.** The tape runs to 2026-07-13, not 29 May as the Zenodo text
   says. All collected days are before BOOST (21 Jul 2026).

## Changes

- **A1.1 Universe:** mints whose chain starts at the initial 30 SOL state (99.98 % of mints),
  gaps allowed.
  - Post-trade vSol is exact at every observed trade, so every mark at an observed trade is
    exact.
  - Unobserved flow is replayed as one aggregate trade of the same direction (sim.ts).
  - Pre-signal features treat unobserved flow as non-organic.
  - **Strict G1 is run as a sensitivity only.**
- **A1.2 Verdict status:** because the tape fails G1 at the letter, every verdict is
  **operational, not a formal PROTOCOL kill**. The results file says so.
- **A1.3 Downtime (primary):**
  - entries only on analysis days;
  - no downtime minute may fall in [signal, signal + 65 min];
  - partial days are kept.
  **Sensitivity:** G5 as written, i.e. drop every day with > 1 % downtime.
- **A1.4 Warm-up** is the first 7 *collected* days (U5): 28, 29, 30 Apr and 1, 3, 4, 8 May.
  Analysis starts 9 May.
- **A1.5 Sample:** the verdict needs n ≥ 30 and ≥ 5 distinct days per variant, unchanged.
- The kill rule itself (section A) and the filter rule (section B) are unchanged.
