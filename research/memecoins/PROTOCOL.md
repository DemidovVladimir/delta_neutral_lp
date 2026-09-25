# Memecoin campaign: evaluation protocol (A27)

**Version:** v1, frozen 2026-09-25 together with `HYPOTHESES.md`, before any collector data is
analysed.
**Scope:** how every hypothesis in `HYPOTHESES.md` is simulated, costed, split, tested, corrected
for multiple testing, and promoted (or killed) on the way to real money. Money is in SOL unless
stated. Bankroll ≈ 3.6 SOL ≈ 430 USD at ≈120 USD/SOL.

Change rule: as for HYPOTHESES.md, this file is append-only after the freeze and every amendment is
dated. **The untouched test period may be opened exactly once, for the finalists frozen in §9.**

---

## 0. Stages and gates

| Stage | What happens | Gate to go on | Who decides |
|---|---|---|---|
| S0 Collect | The collector runs continuously. The first 7 UTC days are warm-up (wallet, ring, bot and creator histories only). | Data-quality gates pass (§2) | automatic |
| S1 Futility check | After 21 analysis days, run on **train days only** | §11.1 | pre-registered rule |
| S2 Train | Explore **inside** the pre-registered grids. No inference, no new variant without a ledger entry. | — | — |
| S3 Validation | Run every ledger variant; SPA / Romano-Wolf; freeze ≤ 3 finalists + ≤ 3 filters + ≤ 1 modifier each | §9.3 | pre-registered rule |
| S4 Test (one shot) | Unseal the last 20 % of days and evaluate the finalists only | Pass bar §12 | pre-registered rule |
| S5 Forward paper trading | Live signals with simulated fills, ≥ 14 days and ≥ 200 signals | §13.1 | pre-registered rule |
| S6 Micro-live | Real transactions at 0.02 SOL per trade, ≤ 0.5 SOL at risk | §13.2 | **operator approval required** |
| S7 Real size | Ramp from 0.05 to 0.1 SOL per trade under kill switches | §13.3 | **operator approval required** |

No stage may be skipped. A failure at S3, S4, S5 or S6 ends this campaign. Retrying needs **new
future data** and a new pre-registration: the sealed test is never reused after it is opened.

## 1. Pre-registration mechanics

1. Before the train set is opened, commit `HYPOTHESES.md`, `PROTOCOL.md` and the simulator code.
   The commit hash is the **freeze hash**.
2. The backtester refuses to load days in the validation or test ranges unless the env var
   `A27_STAGE` is `validate` or `test`.
   - Validation also requires the ledger file hash to be recorded.
   - Test also requires `research/memecoins/results/finalists.json`, whose sha256 must already be
     recorded in the ledger.
3. **Variant ledger** (`research/memecoins/results/variant_ledger.csv`, append-only). One row per
   (variant, split) evaluation: timestamp, code hash, hypothesis ID, parameters, exit, filter set,
   latency, size, split, n_trades, mean, CI.
   - **K** = the number of distinct variants ever evaluated on validation.
   - Exploratory ideas that arise during train are allowed only as logged rows, and they count
     toward K.
4. Every number in a report is reproducible from the ledger plus the frozen code (canon rule 8
   below).

## 2. Data-quality gates (before any analysis)

Lessons from 2609.18975 (two collectors see nearly disjoint token sets) and 2607.02823 (an
off-chain "graduated / timeout" label is not the on-chain event) are built in.

- **G1 Reserve-chain continuity (exact).** Every pump.fun TradeEvent carries post-trade virtual and
  real reserves. For consecutive trades i−1, i of a mint, rebuild trade i's pre-trade reserves from
  its post-trade reserves and its amounts (§3.3). They must equal trade i−1's post-trade reserves to
  the lamport or base unit.
  - A mismatch means missed trade(s). Backfill from a second RPC with `getSignaturesForAddress` on
    the bonding-curve account.
  - Unrepaired mints are excluded (U4). If more than 2 % of a day's mints fail, the day is dropped.
  - PumpSwap is checked the same way on pool reserves.
- **G2 Independent coverage audit.** Every day, draw 50 random mints and pull their full history
  from a different provider. The collector must match ≥ 99.5 % of their trades, or the day is
  dropped.
- **G3 Outcome labels only from on-chain events.** "Graduated" means a CompleteEvent /
  CompletePumpAmmMigrationEvent was seen or `BondingCurve.complete == true` was read. It never comes
  from an API or a timeout.
- **G4 Clock.** Slot is the clock for all intra-coin timing. Block time is used only for calendar
  splits and hour-of-day. Within a slot, trades are ordered by (transaction index in block,
  instruction index). If the index is unavailable for a slot the simulator needs, fetch that slot
  with `getBlock`, or fall back to the pessimistic placement in §3.1.
- **G5 Downtime.** A UTC day with collector gaps covering > 1 % of its slots is dropped. A dropped
  day stays in its calendar position, so splits remain by date.
- **G6 Base-rate report.** Days 1–7 produce launches/day, graduation rate, trades/day, the share of
  SOL-quoted coins and the share of mayhem coins. These base rates replace the §14 planning
  assumptions and are logged. Grids are **not** changed because of them.
  - Published graduation rates for the same months range from 0.198 % to 2.62 %, depending on the
    denominator and the observation window. **The definition is fixed here:** graduated = a
    CompleteEvent within 7 days of creation, denominator = all CreateEvents of SOL-quoted coins in
    the universe.
- **G7 Point-in-time audit.** Every feature timestamp must be ≤ the signal slot. A unit test replays
  one day and asserts that no feature reads a trade at or after the entry slot.
  - This catches the documented leak: a public graduation model used first-30-minute features while
    median graduation takes 5–10 min.
  - Mayhem agent trades (`BwWK17cbHxwWBKZkUYvzxLcNQ1YVyaFezduWbtm2de6s`) are excluded from all
    buyer and volume features.
- **G8 Regime log.** Platform changes are logged with their activation slot, e.g. BOOST (21 Jul
  2026), cashback (Feb 2026), quote assets (Sep 2026), creator-fee config.
  - Detection comes from program upgrades and from Global / FeeConfig account changes, re-read daily.
  - Results are reported per regime (§11.4).

## 3. Execution simulator

### 3.1 Latency and landing

- A signal is known after the trade completing it is confirmed, at slot `s_sig`. Latency
  L ∈ {0.4, 2, 10} s maps to Δ = {1, 5, 25} slots. The order lands in slot `s_sig + Δ`.
  The 0.4 s slot time is re-measured from the data (slots per block-time second) in G6. If it
  differs by > 10 %, Δ = ⌈L / measured slot time⌉.
- **Primary placement (pessimistic):** our transaction executes **after every trade in its landing
  slot**. Sensitivity placement: before them. The pass bar uses the pessimistic placement.
- **Primary latency: L = 2 s.** This is realistic for a non-colocated bot on a paid RPC stream plus
  Jito or a priority sender. 0.4 s is the best case (colocated gRPC, processed commitment). 10 s is
  a slow bot. S5 **measures** our real L. If it exceeds 2 s, the result at the measured L must also
  hold (P7).
- **Landing failure:** with p = 0.10 an order does not land in its slot. Buys retry once, Δ slots
  later, then are abandoned. Sells retry every Δ slots until they land. A failed attempt that is
  included on-chain pays base + priority fee. A Jito tip is paid only when the bundle lands.
- **Slippage guards:**
  - Buys carry `max_sol_cost` = quoted cost × 1.20. If the landing state needs more, the buy fails:
    no position, fees still paid.
  - Sells carry `min_sol_output` = quote × 0.70. A sell that fails is retried at the next state.
    Stops keep retrying until filled.
- Exit triggers (brackets, trailing stops, event overrides) are evaluated on NLV after every trade.
  The sell lands at trigger slot + Δ with the same placement rule. The gap between the stop level and
  the fill is **not** assumed away.

### 3.2 Counterfactual: our order inside the real tape

- **Primary: insert-and-replay.** Our buy is applied to the curve state at landing. Every later
  observed trade is then replayed on the adjusted reserves: buys keep their SOL input, sells keep
  their token amount. Our exit is priced on the adjusted state. This keeps the constant-product path
  consistent: a buy followed immediately by a sell returns our SOL minus fees.
- **Conservative: no-insert.** Buy and sell are each priced on the *observed* state, ignoring our
  own earlier trade. This charges our price impact twice.
- Both are reported. The pass bar needs primary > 0 on the CI (P1) and conservative > 0 as a point
  estimate (P2).
- Other traders' decisions are assumed unchanged by our presence. At 0.05–0.5 SOL against 30–115 SOL
  virtual reserves, our price impact is 0.1–1.7 % per trade.

### 3.3 Curve and pool math

The exact formulas, fee order and rounding are in §4 (verified from the program IDLs, SDK source
and on-chain decode).
- Every simulated fill uses integer lamport and base-unit math, with the **per-coin, per-moment fee
  fields actually observed** in that coin's adjacent TradeEvents (protocol fee, creator fee incl.
  configurable creator_fee_bps, cashback, market-cap tier). The fee schedule follows the platform
  automatically, so no hand-coded schedule can go stale.
- A hand-coded schedule (§4) is used only for sanity checks and for §14 planning.

### 3.4 Marking, dead coins, migration, end of data

- **On the curve there is always a buyer:** the curve itself. NLV is exact at any moment and there
  is no "no bid" state before completion. A coin that collapsed back to near its initial state
  simply returns little SOL, and the exact amount is computed.
- **Negative NLV:** if NLV is below the fixed cost of the exit transaction, the position is marked
  at −100 % and not sold. The token account is then burned and closed, and its rent is recovered.
- **Completion while holding:** after migration the tokens trade on PumpSwap. The exit is priced on
  the first pool state ≥ migration slot + Δ.
  - If no pool exists 600 s after completion, the position is marked 0 until the pool exists.
  - **PumpSwap pools can quote a price with no exit.** Pricing uses Qeff = real quote vault +
    `virtual_quote_reserves`. Since BOOST, ≈17.58 SOL of each new pool's quote sits in a boost vault
    (§4.2), and a sell reverts when the real vault cannot pay it.
    - The simulator tracks the real vault from the events and enforces that check.
    - If a full sell would revert, it sells the largest amount that clears, and the remainder is
      marked 0.
    - NLV on PumpSwap is always this *executable* value, never reserves × price.
  - LP burn is verified per pool at creation. A pool without burned LP is marked 0 after any LP
    withdrawal that drains it.
- **Token-2022 extensions** (transfer fee, freeze, hooks) on a mint: excluded at signal time.
- **End of data:** open positions are liquidated on the last observed state. With max holds of
  ≤ 1 h on the curve and ≤ 72 h on PumpSwap, this touches < 0.5 % of trades. If it touches more,
  report it.

## 4. Cost model (verified numbers)

> Verified 2026-09-25 (sources in §4.6). Where a number could not be verified it is marked
> **UNVERIFIED**, and the simulator must read it from on-chain fields instead.

### 4.1 pump.fun bonding curve (program `6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P`)

Parameters, decoded from the Global PDA `4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf`:
- initial virtual token reserves 1,073,000,000 and initial virtual SOL 30 SOL;
- initial real tokens 793,100,000 and supply 1,000,000,000 (6 decimals);
- pool_migration_fee 0.015000001 SOL.

**Fee: 1.25 % per side, flat** = 0.95 % protocol + 0.30 % creator, LP 0.
- Source: the fee program `pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ`, FeeConfig PDA
  `8Wf5TiAheLUqBrKXeYg2JtAFFMWtKdG2BSFgqUcPVwTt`. It has a single tier at threshold 0.
- The Global fields fee_basis_points 95 / creator_fee_basis_points 5 are a legacy fallback and are
  **not** what is charged.
- The "buyback" fee is 50 % *of the protocol fee*, not an extra charge. Verified on the live buy
  `oVt3kfdWyN9QBh1NVqd6dkDD1n55pAMSNmmfUQGj9hrQAMhP7YchrfHCmmSavzWwwxsKM6zNBUpeW3Q7rM83LNW`:
  sol_amount 393,476,981, fee 3,738,032 (= ceil 0.95 %), creator_fee 1,180,431, buyback_fee 1,869,016.
- Holder-reward coins (since 2026-09-12) redirect the creator fee to holders, so the trader's cost is
  unchanged.
- Cashback coins are deprecated: no new ones.
- A per-coin configurable creator fee (up to 300 bps) exists only for custom-quote pairs. Those are
  excluded by U1.

**Exact math** (SDK `@pump-fun/pump-sdk` 2.0.0, `src/bondingCurve.ts` + `src/fees.ts`, confirmed against
on-chain events):
- Buy with S lamports:
  - input = (S − 1)·10⁴ / (10⁴ + 125);
  - tokens = input·vTok / (vSol + input), capped at the real token reserves.
- Buy an exact t tokens:
  - solCost = t·vSol/(vTok − t) + 1;
  - pay solCost + ceil(solCost·95/10⁴) + ceil(solCost·30/10⁴).
- Sell t tokens:
  - gross = t·vSol/(vTok + t);
  - receive gross − ceil(gross·95/10⁴) − ceil(gross·30/10⁴).
- Fees are charged on SOL in for buys and on SOL out for sells. TradeEvent `sol_amount` is the curve
  amount **excluding** fees. That makes G1's reconstruction exact:
  - a buy moves vSol by +sol_amount and vTok by −token_amount;
  - a sell moves them the opposite way.
- A buy followed immediately by a sell on an unchanged curve returns (1 − 0.0125)/(1 + 0.0125) =
  0.97531, i.e. **2.47 % round trip in fees**. Constant product is path-reversible, so price impact
  costs money only relative to other traders' flow.

**Graduation:**
- It happens when real tokens reach 0: vTok = 279,900,000, vSol = 115.005359 SOL, **real SOL =
  85.005359 SOL**.
- Price there is 4.1088e-7 SOL/token, **mcap ≈ 410.9 SOL** (≈ 49.8 k USD at 121.3 USD/SOL). Launch
  mcap is 27.96 SOL.
- Launch → graduation is a (115.005/30)² ≈ **14.7×** price move.
- Example migration tx
  `3MLuPyGLRotwGyeF4583gR6G6bwUycVi8LNxWiaYcqKLHUxmLQL74hADBnZm8naE5Sjqt6ZJCPFcEkjmN69ASvLK`:
  - mint `mFutWGiMBRn9D36f3MdJFgYTJi4ftFJfRJWibsepump`, pool `8ZMAvvoSNVKLn5eTyWmdKUCpYCuUBgSxiSmhiZ7j2DBA`;
  - the pool was seeded with 84.990359 SOL + 206,900,000 tokens.

### 4.2 PumpSwap (program `pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA`)

- Tiered by pool market cap, from FeeConfig PDA `5PHirr8joyTMp9JMm6nW7hNDVyEYdkzDqazxPD7RaTjx`
  (25 tiers).
- It applies to canonical pools, i.e. every pump.fun graduate.
- GlobalConfig `ADyA8hdefvWN2dbGGWFotbzWxrAvLW83WG6QCVXvJKqw` (lp 20 / protocol 5 / creator 5) is a
  legacy fallback only.

| Pool mcap ≥ (SOL) | LP / protocol / creator (bps) | Total per side |
|---|---|---|
| 0 | 2 / 93 / 30 | **1.25 %** (a new graduate sits here: 410.8 SOL) |
| 420 | 20 / 5 / 95 | 1.20 % |
| 1,470 · 2,460 · 3,440 · 4,420 | 20 / 5 / 90 · 85 · 80 · 75 | 1.15 · 1.10 · 1.05 · 1.00 % |
| 9,820 · 14,740 · 19,650 · 24,560 · 29,470 | 20 / 5 / 70 · 65 · 60 · 55 · 50 | 0.95 · 0.90 · 0.85 · 0.80 · 0.75 % |
| 34,380 · 39,300 · 44,210 · 49,120 | 20 / 5 / 45 · 40 · 35 · 30 | 0.70 · 0.65 · 0.60 · 0.55 % |
| 54,030 · 58,940 · 63,860 · 68,770 · 73,681 | 20 / 5 / 28 · 25 · 23 · 20 · 18 | 0.53 · 0.50 · 0.48 · 0.45 · 0.43 % |
| 78,590 · 83,500 · 88,400 · 93,330 · 98,240 | 20 / 5 / 15 · 13 · 10 · 8 · 5 | 0.40 · 0.38 · 0.35 · 0.33 · 0.30 % |

- Non-canonical pools pay a flat 0.30 % (25/5/0). The buyback is again 50 % of the protocol fee and
  not additive.
- Verified on live BuyEvents:
  - pool `GZeai3Pe131GyTrdWNxR8E2euHFqsmr3oTRMHg4TpmfZ` charged 20/5/55;
  - pool `5hbhKixb7U8s4FzPLdiFKRNKW25M3wU4Xf2fzDogDAMh` charged 20/5/80;
  - non-canonical pool `Dxvngmdp9QdfUHyU8mBSDNzG9QtGwCGuhwEjvTMZ28rK` charged 25/5/0.

**Math** (`@pump-fun/pump-swap-sdk` 1.20.0, `buy.js` / `sell.js`). Fees are on the quote side, each
ceil(amount·bps/10⁴).
- Qeff = quote vault balance + `Pool.virtual_quote_reserves`.
- Buy with quote q: eff = q·10⁴/(10⁴ + totalBps); base = B·(eff − 1)/(Qeff + eff − 1).
- Sell base b: out = Qeff·b/(B + b); receive out − fees.
- **A sell reverts if the real quote vault < out − lpFee.**

**BOOST changes exit modelling. This is new and not in the docs.** At migration an `InitBoostEvent`
moves 17.584505288 SOL out of the pool's real quote vault into a boost vault and sets
virtual_quote_reserves = 17,584,505,288 lamports. The same value was seen on all 7 canonical pools
sampled.
- The price is unchanged, but only ≈ 67.4 SOL of real SOL backs sellers at the start.
- The boost authority `HTVZVEQMBsNanubDPTs3CxDAEGNFQHJY8c1441iy2S5r` can spend the vault via
  `boost_buy_and_burn`. How often it does is **UNVERIFIED** and is to be measured from
  `BoostBuyAndBurnEvent`.
- **Consequence:** a drained pool can show a price and still have no exit. The simulator must enforce
  the real-vault check (§3.4).

### 4.3 Replication venues (for P8 only)

**Raydium LaunchLab** (`LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj`):
- The fee is the protocol trade_fee_rate plus the platform fee_rate plus the platform
  creator_fee_rate (+ optional referral). All are per 10⁶ of amount_in and additive.
- All 565 GlobalConfigs have trade_fee_rate 0.25 % and migrate_fee 0. The SOL config is
  `6s1xP3hpbAfFoNtUNF8mfHsjr2Bd97JxFJRWLbL6aHuX`.
- 49 of 50 live trades used StonkFun platform `6BwHHDg3u1854jC8PDLXvR4spTcLNaoBxLJNGC4nTESt`
  (platform 1.0 %, creator 0), so the **curve cost is 1.25 % per side**.
- Its post-migration CPMM config `CRRS5ieQmBrZjWhcj99JuGrT5tyuWDaGAXLXLFjbAtjQ` is 0.25 % + 1.0 % =
  1.25 %. The creator-fee field offset is **UNVERIFIED** by a swap.
- Platform fees vary per PlatformConfig (up to 5 % since 2026-08-26), so they are read per trade.

**Meteora DBC** (`dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN`):
- Fees are set per config: base fee ≥ 0.25 %, with an optional anti-sniper time scheduler that decays
  from a high start, and an optional dynamic fee. Protocol takes 20 % of the fee. There is a 0.2 %
  protocol migration fee plus optional partner/creator migration fees.
- **Typical launchpad values are UNVERIFIED.** Read them per pool from on-chain config.

### 4.4 Network and account costs

- **Base fee:** 5,000 lamports per signature (verified on every sampled transaction).
- **Priority fee:** from 60 landed pump.fun trade transactions (≈11:00 UTC 2026-09-25), the total
  transaction fee was p50 0.000065 SOL, p75 0.000098 SOL, p90 0.00041 SOL, max 0.0029 SOL
  (≈ 98.6 k compute units). PumpSwap: p50 0.000005 SOL, p90 0.000065 SOL.
  - `getRecentPrioritizationFees` reports per-slot *minimums* (p50 = 0) and is useless for sizing.
- **Jito tip** (landed tips, `https://bundles.jito.wtf/api/v1/bundles/tip_floor` at
  2026-09-25T10:54:29Z): p25 0.0000034, p50 0.0000090, p75 0.0000156, p95 0.0000434,
  p99 0.0002125 SOL.
- **Budget per transaction in the simulator:**
  - normal: 0.0001 SOL (priority + tip);
  - "racing": 0.0005 SOL for signals that need L = 0.4 s;
  - sensitivity: ×3.
  - Failed-but-included attempts pay base + priority.
  - The network-wide failure rate (79.8 % of pump.fun-touching transactions in a 3-s window) is
    mostly bot spam and **is not our failure rate**. Ours is set to p = 0.10 until S6 measures it.
- **Rent: the old figures are stale.** The rent sysvar was lowered: lamports_per_byte_year 5,080.
  - SPL ATA 0.00148844 SOL; Token-2022 ATA 0.00151384 SOL. Both are **refunded** by closing the
    account in the sell transaction.
  - `user_volume_accumulator` 0.0013462 SOL, once per wallet (closable). It is mandatory on
    buy_v2/sell_v2.
  - The simulator treats rent as locked capital, not as cost. An ATA we fail to close (a worthless
    position) is a cost.

### 4.5 Resulting cost budget per round trip (our bot, no terminal fee)

| Size | Protocol + creator fees | Network (2 tx, normal budget) | Total | For comparison: retail via terminal |
|---|---|---|---|---|
| 0.05 SOL | 2.47 % | 0.40 % | **≈ 2.9 %** | ≈ 4.5–5 % (A26) |
| 0.1 SOL | 2.47 % | 0.20 % | **≈ 2.7 %** | ≈ 4.5 % |
| 0.25 SOL | 2.47 % | 0.08 % | **≈ 2.55 %** | ≈ 4.4 % |
| 0.5 SOL | 2.47 % | 0.04 % | **≈ 2.5 %** | ≈ 4.4 % |

These exclude price impact against other traders' flow (simulated exactly, §3.2) and losses from
latency and adverse selection, which are the real costs. PumpSwap exits in tier 0 cost the same
1.25 %.

### 4.6 Sources for §4

- `github.com/pump-fun/pump-public-docs`: last commit 2026-09-14, IDLs refreshed 2026-09-12. The
  collector's copies are in `research/memecoins/idl/`.
- npm: `@pump-fun/pump-sdk` 2.0.0 (2026-09-13) and `@pump-fun/pump-swap-sdk` 1.20.0 (2026-09-10).
- Account decodes via public RPC `https://api.mainnet-beta.solana.com` on 2026-09-25 10:50–11:20 UTC.
  Scripts and raw JSON are in the session scratchpad `memelit/fees/` (`decode.py`, `events.py`,
  `feesample.py`, `global.json`, `feecfg_pump.json`, `feecfg_amm.json`, `jito_tip_floor.json`,
  `sample_pump.json`).
- Raydium docs `docs.raydium.io` (LaunchLab platform-config / global-config) plus
  `getProgramAccounts` counts.
- Meteora docs `docs.meteora.ag` (DBC fees overview, fee scheduler).
- **Re-verify at S4 and S6.** The fee accounts are re-read daily (G8), and any change is a regime
  boundary.

## 5. Position sizing and bankroll

- Bankroll 3.6 SOL, dedicated hot wallet holding only the trading bankroll. **Never the operator's
  main key.** No third-party bot or terminal ever holds the key.
- **Primary size 0.1 SOL per coin** (2.8 % of bankroll). Sensitivity sizes: 0.05, 0.25, 0.5 SOL,
  through insert-and-replay.
- ≤ 8 concurrent positions (≤ 0.8 SOL deployed). ≥ 0.5 SOL stays idle for fees, rent and retries.
  Signals that arrive while at the cap are **skipped in chronological order**, and the skips are part
  of the simulated result.
- One open position per mint per strategy. No pyramiding.
- The daily loss stop (no new entries after −10 % of start-of-day equity) applies in the bankroll
  Monte Carlo and in S5–S7. Per-trade statistics are reported without it.

## 6. Splits

- Analysis days are the UTC calendar days after the 7 warm-up days. Train = first 60 %, validation =
  next 20 %, **test = last 20 % (sealed)**. Split boundaries fall at midnight UTC.
- A position belongs to the split of its **entry** day and may exit in the next split.
  - Trailing-window objects (W*, R, Bot, creator histories, H13 models) are built only from data
    before the signal. Using earlier-split days for them is allowed. Using later days never is.
- Inside train, exploration uses walk-forward folds: 7 days fit/observe, then 3 days evaluate,
  rolled forward. The headline train number is the pooled out-of-fold result.
- The test range is not touched by any plot, summary or "quick look" before S4 (canon rule 15).

## 7. Metrics (per variant and split, at L = 2 s, pessimistic placement, insert-and-replay, 0.1 SOL)

- **Per trade:**
  - The net return r = (exit NLV − cost basis) / cost basis. The cost basis includes every entry
    cost.
  - Mean, median, 1 %-trimmed mean, win rate, p5/p95, worst, best.
  - **Top-3 and top-1 % flip test** (2606.08232: three trades carried a 190-trade record).
- **SOL-weighted return** = Σ PnL / Σ SOL in.
- **Daily** (UTC day = inferential unit, canon rule 1): mean, median, SD and worst day of daily PnL;
  % of positive days; the share of PnL from the best day.
- **Uncertainty:** day-block bootstrap with 10,000 resamples of UTC days. 6-h blocks as
  sensitivity. Plus a permutation null: shuffle entry times within the same coin-age bucket
  (canon rule 5).
- **Frequency and capacity:**
  - Trades/day and the concurrency distribution.
  - Return vs size, 0.05 → 0.5 SOL.
  - The largest size with mean > 0.
- **Sensitivities:** L = 0.4 / 10 s; optimistic placement; no-insert; fees +20 %; fixed costs ×3.
- **Benchmarks:**
  - B_zero: do nothing, 0.
  - B_naive: enter every universe coin at age 30 s, exit XT300. Expected ≈ −5…−20 %.
  - B_carry: JupSOL ≈ 5–6 %/yr in SOL, i.e. ≈ 0.015 %/day of bankroll.
  - A strategy must beat B_zero outright, and its increment over B_naive is reported (canon rule 3).
- **Bankroll Monte Carlo** (§10) for finalists.

## 8. Adopted methodology canon (from arXiv 2609.05663, each rule bought with a retraction there)

1. The market day is the inferential unit, never the trade.
2. Pre-register the grid or report the whole sweep ("1 of 35 clearing zero is chance").
3. Require an increment over a concrete baseline (B_naive).
4. Walk-forward / leave-window-out splits, never random splits.
5. Permutation nulls on every arm.
6. Conditioning on trades taken is descriptive only (the skip-at-cap rule is simulated, not
   assumed away).
7. Reconstructed fills, never a signal's "paper" price, are the P&L.
8. Check the calendar footprint of any group difference (§7 best-day share).
9. Compare at a common fee rate. Fees come from the events, so eras differ only when fees really
   differed; report fee regime changes.
10. Check what the primary metric throws away: count censored and never-closed positions.
11. Calibrate against a null arm before reading any P&L table: a random-entry arm with the same
    frequency and exits.
12. A rolling p-value read many times is not a p-value. S5 uses one pre-registered read (§13.1).
13. Know your timing-luck floor: report results with entry shifted ±1 and ±5 slots.

## 9. Multiple-testing control

### 9.1 Counting
K = distinct variants evaluated on validation, from the ledger. The pre-registered budget is
≈ 512 plus ≤ 150 logged exploratory variants, ≤ 662 in total (HYPOTHESES §7). Latency, size and placement
sensitivities of the finalists are not selection variants and do not count.

### 9.2 Validation inference
- Each variant v yields a daily PnL series d_v(t) on validation days, at 0.1 SOL fixed size.
- **Hansen SPA test** (and White's Reality Check as a cross-check) of H0 "no variant beats
  B_zero", using a stationary bootstrap (mean block 2 days, 10,000 reps) over all K series jointly.
  Report p_SPA.
- **Romano-Wolf step-down** on the same bootstrap, at family-wise error 10 %, lists the variants that
  individually beat zero.
- The **deflated Sharpe ratio** (Bailey & López de Prado) with K trials is reported for the top 10.

### 9.3 Finalist selection (mechanical, pre-registered)
1. If p_SPA > 0.10 **and** Romano-Wolf rejects nothing, **stop**. The test stays sealed for a future
   campaign.
2. Otherwise the finalists are the Romano-Wolf-significant variants. If more than 3 are
   significant, take the 3 with the highest lower 95 % bound of mean per-trade net return. They must
   have ≥ 10 trades/day at L = 2 s and be positive at L = 10 s or at the S5-measured latency.
3. Filters (HYPOTHESES §6) and at most one H14 modifier are frozen per finalist by the validation
   rule stated there.
4. Write `finalists.json` (exact definitions + code hash) and record its sha256 in the ledger.

### 9.4 Test inference (one shot)
- Bonferroni over the k ≤ 3 finalists: each is tested one-sided at α = 0.05/k.
- The day-block bootstrap (10,000 reps) lower bound of the **mean per-trade net return** and of the
  **mean daily PnL** must both be > 0 at confidence 1 − 0.05/k.

## 10. Bankroll Monte Carlo (finalists)

- Resample the finalist's **test-period** days (stationary bootstrap, mean block 3 days) into
  10,000 paths of 90 and 180 days.
- Start 3.6 SOL. Two sizing rules:
  - fixed 0.1 SOL;
  - fixed fraction, 2.5 % of equity clamped to [0.05, 0.5] SOL.
- Include the concurrency cap, the daily loss stop, and all fixed costs.
- **Report:**
  - median / p5 / p95 final equity (SOL, and USD at constant SOL price);
  - maximum-drawdown distribution;
  - **P(ruin)**: the probability that equity ever falls below 50 % of the start, and below 20 %;
  - P(ending below the JupSOL alternative);
  - expected USD/day.
- Required (P6): P(equity ever < 50 %) ≤ 10 % over 90 days, at the chosen sizing rule.

## 11. Stopping rules

1. **Futility (S1).** Run after 21 train days, on train only, with walk-forward out-of-fold numbers.
   **Stop the campaign (dead on arrival)** if both hold:
   - no variant of H01–H13 has an out-of-fold mean per-trade net return > 0 at L = 2 s, even before
     any multiple-testing correction;
   - the H13 ceiling model is ≤ 0 out of fold.

   The collector may keep running for other uses.
2. **Validation stop:** §9.3 step 1.
3. **Test failure:** stop. No re-tuning on the opened test.
4. **Platform change:** if pump.fun changes curve parameters or fee structure mid-campaign (e.g. a new
   creator-fee regime, quote assets), mark the change date.
   - Results are reported per regime.
   - A finalist must be positive in the **latest** regime's test days (point estimate), or it fails
     P1.

## 12. Pass bar (all required, at the pre-registered primary settings)

| # | Criterion |
|---|---|
| P1 | Test: lower bound of the mean per-trade net return > 0 and of the mean daily PnL > 0 (day-block bootstrap, one-sided α = 0.05/k). L = 2 s, pessimistic placement, insert-and-replay, 0.1 SOL. |
| P2 | Conservative execution (no-insert, double impact): mean > 0 as a point estimate. |
| P3 | Robustness: the mean stays > 0 after removing the top 1 % of trades **and** after removing the top 3 trades (point estimates). |
| P4 | No single UTC day contributes > 25 % of test PnL, and both halves of the test period are positive (point estimates). |
| P5 | Economic: expected net ≥ 0.008 SOL/day (≈ 1 USD/day ≈ 0.23 %/day of bankroll, ≈ 15× the JupSOL alternative) at 0.1 SOL size, with ≥ 10 trades/day. |
| P6 | Bankroll MC: P(equity ever < 50 % within 90 days) ≤ 10 %. |
| P7 | Latency: P1 also holds (point estimate > 0) at L = 10 s **or** at the S5-measured latency, whichever is smaller. |
| P8 (desirable) | Same sign on a replication venue (Raydium LaunchLab or Meteora DBC) if the collector covers it. |

## 13. Forward stages

### 13.1 S5 Forward paper trading (no transactions)
- The production signal code runs live on the stream. Fills are computed by the §3 simulator at the
  slot where our order *would* land, i.e. the decision slot + Δ. Δ comes from our measured pipeline
  latency (stream → decision), plus the landing-delay distribution measured in S6, or a pre-S6
  assumption of 2 slots.
- Duration ≥ 14 days **and** ≥ 200 signals.
- **One pre-registered read** at the end:
  - PASS if the forward mean per-trade net return is > 0 **and** ≥ 50 % of the test-period mean;
  - otherwise FAIL.
- Also logged: detection latency percentiles; forward vs backtest trade frequency (must be within
  ±30 %); signal overlap with a simultaneous re-run of the backtester on the same days (must be
  ≥ 95 % identical signals). This catches look-ahead bugs.

### 13.2 S6 Micro-live (**only with explicit operator approval in-conversation**)
- 0.02 SOL per trade, ≤ 0.5 SOL total at risk, ≥ 100 trades. Dedicated wallet.
- Measures real landing rate and delay, real fees, cashback and tip spend, and real fill vs simulated
  fill at the same landing slot.
- PASS if:
  - the realised per-trade cost is within the simulated cost + 1 pp;
  - the realised per-trade return is not significantly below paper (two-sided test at α = 0.10 on
    the paired difference).

### 13.3 S7 Real size (**only with explicit operator approval**)
- Size ramps from 0.05 SOL to 0.1 SOL after 100 trades without a kill.
- **Kill switches:**
  - daily loss −10 % → no new entries that day;
  - rolling 7-day loss −20 % → pause and review;
  - drawdown −30 % from peak → stop the strategy;
  - 14-day live mean < 0 with ≥ 100 trades → stop.
- Weekly live vs paper comparison, and the same reporting as §7.

## 14. Statistical power and how many days to collect

**Dispersion input.** We calibrated on the earlier 101-coin pump.fun tape (scratchpad
`memelit/calib/calib.py`), with 0.1 SOL, 1.25 %/side fee, 0.0005 SOL fixed cost per transaction
(5× the §4.4 normal budget, so conservative), L = 5 slots and the no-insert model:
- per-trade SD 0.24–0.46 for age-based entries;
- 0.68–0.97 for velocity-type signals;
- worst trades ≈ −100 % (the coin round-trips to its start);
- best trades +180…+540 %.

The planning values are **σ = 0.5** (bracketed exits) and **σ = 0.8** (time exits). Design effect
D = 2 for same-day clustering. k = 3 finalists, so one-sided z = 2.128; power 0.8 (z = 0.842).
Then:

n = (2.128 + 0.842)² · σ² · D / μ²

| True mean net return per trade μ | n trades (σ 0.5) | n trades (σ 0.8) |
|---|---|---|
| 3 % | 4,899 | 12,542 |
| 5 % | 1,764 | 4,515 |
| 10 % | 441 | 1,129 |
| 20 % | 110 | 282 |

Test days = n / f, where f is the finalist's trades/day. A floor of 10 test days is applied: at
least 10 day-clusters are needed for day-level inference and to cover two weekends. Total calendar
days = 7 warm-up + test days / 0.20:

| f (trades/day) | μ = 5 %, σ 0.5 | μ = 10 %, σ 0.5 | μ = 10 %, σ 0.8 | μ = 20 %, σ 0.8 |
|---|---|---|---|---|
| 20 | 448 d | 117 d | 289 d | 78 d |
| 50 | 183 d | 57 d | 120 d | 57 d |
| 100 | 95 d | 57 d | 63 d | 57 d |
| 300 | 57 d | 57 d | 57 d | 57 d |

**Decision:**
- **Collect ≥ 60 calendar days:** 7 warm-up + ≈ 32 train + ≈ 10.5 validation + ≈ 10.5 test. That
  detects μ ≥ 10 %/trade for strategies firing ≥ 50–100 times/day, or μ ≥ 20 %/trade at ≥ 20–30/day.
- **The futility check comes at day 28** (7 warm-up + 21 train). If it triggers, stop there.
- Graduation-bound families (H05, H11, H12, H15, H16) are limited by the graduation count. That is
  ≈ 500–900/day at the Jul–Aug 2026 rates (26–33 k launches/day × 1.8–2.6 %), and more after BOOST.
  - H05 and H16 can fire tens to hundreds of times per day, so they are in the 60-day design.
  - H11 (survivors hours later) may fire only ≈ 10–50 times/day and can only show μ ≥ 20 %.
- **External pilot (S0.5, optional, cannot promote anything).** Public tapes can run the simulator
  and the §11.1 futility check **before our own data matures**:
  - van de Wouw, 20,731,091 pump.fun trades, 28 Apr–29 May 2026, https://doi.org/10.5281/zenodo.22306254;
  - RED-PUMP-2026-v1, 860,213 launches, https://doi.org/10.5281/zenodo.21923106.

  Rules:
  - These tapes pre-date BOOST, so they may **kill** hypotheses (futility) but may never select
    finalists or tighten grids.
  - The kill applies only to curve-stage hypotheses (H01–H10, H13, H17). Post-migration families
    (H11, H12, H15, H16) changed with BOOST and are judged only on our own data.
  - Any use of them is logged in the ledger and counts toward K.
  - They must pass G1 (reserve continuity) before use.
- **Effects ≤ 5 %/trade need 3–15 months.** The platform changes its rules monthly (creator-fee
  tiers, cashback, mayhem mode and quote assets all arrived in 2025–26), and a pre-registered
  graduation model lost all skill within two weeks (2607.02823). So an edge that small is treated as
  not demonstrable, and also as not bankable at a 3.6 SOL bankroll.
- After S4: ≥ 14 days of S5 paper trading. Earliest possible first real trade ≈ 80–90 days after
  collection starts. Starting 2026-09-25, that means late December 2026, and only if every gate
  passes.

## 15. Report template (every stage produces exactly this)

1. Data: days collected, dropped days and why, G1/G2 coverage numbers, launches/day, graduation
   rate.
2. Ledger: K, and the variants per hypothesis.
3. Per hypothesis: the best and median variant on train and validation. For each, report the mean,
   median, trimmed mean, win rate, trades/day, day-bootstrap CI, flip test, and the B_naive
   increment.
4. SPA p, Romano-Wolf set, deflated Sharpe ratios.
5. Finalists with full definitions and hashes.
6. Test: the P1–P8 table with numbers.
7. Bankroll MC table.
8. Plain-language verdict: pass/fail and what the money would have done.
