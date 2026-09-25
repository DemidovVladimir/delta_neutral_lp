# Public-tape futility rule: stated BEFORE any tape result was computed

Written 2026-09-25 ~11:35 UTC, while the van de Wouw database was still downloading and before any
tape row had been read by the backtester. Its sha256 is recorded in `futility-public-tapes.md`.
PROTOCOL.md §14 allows public tapes to KILL curve-stage hypotheses (H01–H10, H13, H17) but never to
promote anything. PROTOCOL §11.1 defines only a campaign-level futility stop, so the per-hypothesis
rule below is mine.

## A. Signal hypotheses (H01–H06, H08–H10, H13, H17)

- **Unit.** A variant is one pre-registered grid point × one exit (HYPOTHESES §4/§5), exactly as
  frozen. No new grid points.
- **Kill-point execution: the most favourable one the protocol allows.** L = 0.4 s (Δ = 1 slot),
  **optimistic** placement (our tx lands before every other trade in its slot), insert-and-replay,
  0.1 SOL. Costs follow PROTOCOL §4: 1.25 %/side on the curve, 5,000 lamports base plus a
  0.0005 SOL "racing" budget per landed tx at L = 0.4 s, and p = 0.10 landing failure.
- **Statistic.** The mean per-trade net return over trades entered on analysis days. Its 95 % CI is
  a two-sided percentile interval from a day-block bootstrap over UTC entry days, with 10,000
  resamples.
- **Dead variant:** n ≥ 30 trades on ≥ 5 distinct entry days **and** the upper 95 % bound < 0.
- **Underpowered variant:** n < 30 or < 5 days.
- **KILLED:** every variant with enough data is dead, **and** at most 50 % of the grid is
  underpowered.
- **NOT-TESTABLE-ON-TAPE:** a required field is missing from the tape, or more than 50 % of the
  grid is underpowered.
- **SURVIVES-FUTILITY:** any other outcome. This label only means "not killed"; it never promotes
  anything.
- **Also reported, for information only:** the primary setting (L = 2 s, pessimistic placement,
  insert-and-replay, 0.1 SOL, 0.0001 SOL budget), the no-insert result, and L = 10 s. Plus the
  PROTOCOL §11.1 campaign-level test: does any H01–H13 variant have a mean > 0 at L = 2 s?

## B. Filters (F01–F08, plus "no creator buy" from H17)

- **Standalone design (HYPOTHESES §6 (i)).** A naive entry into every universe coin at age 30 s and
  at age 120 s (+ L), with exits XT300 and XB, so 4 cells per grid point. Flags use only
  information up to the entry signal slot.
- **Statistic.** Δ = mean(flagged) − mean(unflagged). Its 95 % CI comes from a paired day-block
  bootstrap: the same resampled days are used for both groups.
- **Setting.** The primary setting (L = 2 s, pessimistic). L = 0.4 s is reported too.
- **KILLED:** at every grid point and in every cell with ≥ 30 flagged and ≥ 30 unflagged trades,
  the lower 95 % bound of Δ is > 0. That means flagged coins do significantly **better**, so the
  avoid-list would throw away winners.
- **SUPPORTED-ON-TAPE (cannot promote):** the upper bound of Δ is < 0 in at least 3 of the 4
  cells at some grid point.
- **Otherwise: SURVIVES-FUTILITY (inconclusive).**
- **F02 (b), the exit override.** Compare paired returns with and without the override, on the
  naive positions where the flag fires during the hold. KILLED if the upper 95 % bound of the
  paired mean difference (override − base) is < 0 in every cell at every grid point.

## C. Not judged on public tapes

- H11, H12, H15 and H16 are post-migration families. PROTOCOL §14 reserves them for our own
  post-BOOST data, and the tape has no PumpSwap trades.
- H07 needs a point-in-time KOL list. Only a 2026-09-25 kolscan snapshot exists, so H07 may be
  run as a simulator sanity control with no verdict.
- H14 applies only to finalists.

## D. Resolutions of spec gaps forced by the tape (decided before seeing results)

1. **Fees.** The tape has no per-trade fee fields. Every fill of ours uses the PROTOCOL §4
   hand-coded current schedule: curve 95 + 30 bps per side, and PumpSwap tier 0 2/93/30 bps.
   Other traders' observed trades are replayed on curve amounts, which exclude fees, so their
   historical fee level does not matter.
2. **Intra-slot order.** Rebuilt from the reserve chain (G4). If the chain cannot order a slot,
   the mint fails G1.
3. **G1.** A mint is usable only if its reserve chain is continuous from the initial state
   (vSol 30 SOL) through its last trade:
   - consecutive `vsol_after` must differ by exactly ± `sol_amount`, within 2 lamports of float
     rounding;
   - the first trade must start from 30 SOL.
   Mints that fail are excluded (U4). Mayhem coins are excluded (U3): the mayhem agent
   `BwWK17cbHxwWBKZkUYvzxLcNQ1YVyaFezduWbtm2de6s` trades them, and their reserves are re-set.
4. **C(m) = {creator}.** One tape row per signature hides same-transaction co-buyers, and there is
   no funding graph (E-fund). B(m) = non-creator buyers in slot s0. Multi-buyer transactions are
   not observable.
5. **Wash trading.** WT1 (the same wallet buys and sells in one tx) is not observable. F07 uses WT2
   only.
6. **Positions still open when the curve completes** are sold into the pool-opening state at
   completion slot + Δ:
   - quote = real SOL at completion − 0.015000001 SOL, base = 206,900,000 tokens;
   - tier-0 fee 1.25 %; the real-vault check is applied with the full pre-BOOST vault.
   The tape has no PumpSwap trades. Our own data shows post-migration prices collapse, so this is
   **favourable** to every hypothesis. It is valid for kills and invalid for anything else.
7. **Time exits (XT\*) and max-hold deadlines** trigger at entry landing slot + ⌈τ / 0.4 s⌉. The
   sell lands Δ slots later.
8. **Buy semantics.** The quote is taken at the signal state: t_q = tokens for 0.1 SOL.
   `max_sol_cost` = 1.20 × the quoted cost of t_q. If the landing state needs more, the buy fails
   and the fee is still paid.
9. **Landing failure.** p = 0.10, drawn from a deterministic hash of (mint, signal slot, attempt),
   so every variant sees the same random numbers.
   - A failed-but-included attempt pays 5,000 lamports + 50 % of the tx budget (the priority
     part).
   - A landed tx pays 5,000 lamports + the full budget.
10. **Concurrency cap (≤ 8) is not applied.** Per-trade statistics are the kill statistic, the
    tape covers only a subset of launches, and a chronological skip is not selective on outcome.
11. **Warm-up.** The first 7 UTC days of the tape only build the trailing objects (Bot, R, W*,
    creator histories). Entries are simulated on the remaining days only.
12. **Point-in-time sets.** Bot, R and W* for day d are built from days before d. Creator
    history uses only launches, and completions, that happened before the signal slot.
