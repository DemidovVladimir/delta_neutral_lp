# Memecoin trading patterns: pre-registered hypotheses (A27)

**Version:** v1, frozen 2026-09-25, before any analysis of collector data.
**Question:** can patterns in Solana memecoin trading (pump.fun bonding curve, PumpSwap after
graduation, and later Raydium LaunchLab / Meteora DBC as replication venues) give a positive
expected return after realistic costs for a ~430 USD (≈3.6 SOL) bankroll traded by our own bot?
**Companion:** `PROTOCOL.md` (cost model, latency, splits, multiple-testing control, pass bar,
power / data-days).

Rules for this file:
- It is **append-only after the freeze**. A change gets a dated amendment at the bottom. Every new
  or changed variant goes into the variant ledger (PROTOCOL §9) and raises the multiple-testing count K.
- A hypothesis may be dropped for **data reasons** (field not collectable) before the train set is
  opened. It may not be dropped or reshaped after its validation numbers are seen.
- Evidence tags: **strong** (replicated, or our own on-chain measurement in two windows),
  **moderate** (one large dataset with a temporal split), **weak** (in-sample association, small
  sample, or prediction without a trading test), **folklore** (community claim, no data),
  **contra** (the evidence points the other way, so it is tested as an expected negative or a filter).

---

## 1. Evidence base (what already exists; numbers as published)

| Source | Data | Finding that matters here |
|---|---|---|
| Our A26 baseline (docs/reports/2026-09-25-1pct-day-strategy-sweep.md) | 228 pump.fun launches + second window | Ordinary buyers: 23 % profitable, SOL-weighted −20 %/position after retail costs. First-slot snipers −29…−51 %. Copying last window's top wallets: leaders stayed good (+20 %), copiers −10…−13 % at 0.4–30 s latency. A passive PumpSwap LP opened at migration had a median of −88 % in SOL after 24 h (48 pools, Sep 2026). −88 % is the LP floor, reached when the token price falls ≥ 95.7 %, so **the median graduate lost ≥ 95.7 % of its price within a day**. An LP entered 2 min after migration was −98 %. Hot day-1 Meteora memes −58…−66 % within 72 h. Insider / bundle "sell-only" wallets took ≈5 % of volume. |
| Same lane, full-life 230-coin sample (scratchpad `universe/directional-copy-memecoin-kelly/pump/analysis_final.txt`) | 11,314 non-creator positions | Early entrants (2–25 slots after the first trade): SOL-weighted **+3.9 % raw, +1.5 % after pump.fun fee, −2.7 % after terminal fee + tips**. Positions in coins that went on to graduate: +8.0 % raw. Everything else negative. In-sample, 230 coins, no latency model. This is the only positive hint we have. |
| arXiv 2602.14860, *Predicting the success of new crypto-tokens: the Pump.fun case* | 655,770 tokens, Sep 2025, 0.63 % graduated | Buy-and-hold to graduation pays only if P(graduate \| vSol) > (vSol/115)². **The unconditional curve never crosses this line.** The strongest predictor is fast accumulation within the first few tens of trades. Two more features raise P(graduate): top traders identified in an earlier two-week window (out of sample in time), and a non-bot trade share above 0.3. **Both conditional curves still stay below breakeven over most of the range.** The non-bot curve comes close only near graduation. Prolific creators do not help. 92.22 % of tokens have at least one dump, and after a dump graduation becomes much less likely. |
| arXiv 2607.02823, *Auditing collector-generated graduation labels on pump.fun* | 749,816 mints, 12 May–10 Jun 2026 | A pre-registered logistic graduation model had AUROC 0.859 on the first 15 days and **0.464 on the next 14 days** (CI includes 0.5). The covariates were metadata: social links, market-cap bin, description length, hour. An off-chain collector's "TIMEOUT" label is not the same as on-chain non-graduation. |
| arXiv 2608.20271, *Catching the Rug* | 6.4 M Solana tokens, Nov 2024–Jun 2025 | A rug is a drawdown of at least 99 % or long idleness. It is predictable from the first 5 minutes of trades: XGBoost with forward rolling CV gets F1 0.79, MCC 0.39, AUPRC 0.80. The 24 features are trade counts, buy/sell ratios, unique buyers and sellers, early price changes and timing. The model transfers across platforms only after data fusion. **No trading test.** |
| arXiv 2602.13480, *MELT* | 41,470 pump.fun launches, Dec 2024–Mar 2025 | **36.5 % of supply is held by coordinated accounts at migration.** Of that, 28.2 % is linked by funding source, 16.0 % by Jito bundle and 9.2 % by same-tx co-purchase. 84 % of migrated coins are "high-risk" (minimum price within 20 min is below 0.3× the migration price). Buying at migration, the best model filter cuts the 1-hour loss from −60.7 % to **−26.6 %: still negative.** |
| arXiv 2601.08641, *Resisting manipulative bots in meme coin copy trading* | 6,000 coins, 70/15/15 temporal split | Smart-money wallets make +14 %/coin. The best (LLM) filter gives a **copier return of +2.9 %/coin, but the copier trades immediately after the leader and the formula has no fees.** After ≈2.5 % round-trip fees plus latency this is ≈0 or negative. Statistical baselines (LASSO, NN, XGBoost) give copiers −5.8…−8.3 %. Bundle bots appear in ≈25 % of projects and are weakly associated with lower returns. Sniper bots are everywhere and have little effect. |
| arXiv 2609.10246, *Meme Coin Factories* | 15.2 M coins over 730 days, 1.02 % graduate | Median 17,926 launches/day. Wash trading (same-tx buy+sell) is found in 8.3 % of coins and 17 % of transactions. Wash-traded coins graduate **more** often (2.0 % vs 0.9 %; 9.6 % with 500+ wash txs). The top 1 % of funder clusters create 58.6 % of coins. Copycats are 10–36 % of coins and graduate 0.86 %. The originals they copy graduate 9.2 %, but this is look-ahead. Non-automated creator groups with ≈100 attempts about 30 min apart reach ≈14 % graduation (in sample). 23.5 % of coins are created right after an X/Truth post. Coordinated dumps typically come from 7 sender wallets feeding one dumper. |
| arXiv 2607.02795, *Coordinated sniper cohorts on pump.fun* | 166,098 launches, 11–25 Jun 2026 | 1,012 persistent sniper rings (2,965 wallets). A ring's presence raises the first-30-min **buyer count by +16 %** but **SOL inflow by only +6 % (CI includes 0)**. 7 % of ring-sniped launches had zero non-ring buyers. Rings inflate apparent demand. |
| arXiv 2606.08232, *Hour-aware risk management…* | 190 paper trades, 29 Mar–12 Apr 2026 | Mean +0.62 %/trade, 40.5 % win rate. **Removing the top 3 trades flips the result to a loss.** The hour-of-day effect is not significant (p = 0.56). |
| arXiv 2607.02830, *Precision auditing of filter rules* | 2,402 rejection events | Conservatively, filters "save" 3.7 losses per missed winner. Filters work as loss avoidance. |
| arXiv 2609.05663, *What LLM trading agents actually do* | 3,505 DX Terminal vaults (Base memecoins) + 500 HL agents | **No directional edge.** 43 % of positions saw +3 % favourable excursion, yet half of those closed negative. A mechanical 2 %/4 % stop/target bracket adds +39 bps per position, but no exit policy is profitable outright. The paper's 17-rule methodology canon is adopted in PROTOCOL. |
| arXiv 2507.01963, *A Midsummer Meme's Dream* | 34,988 meme coins, 4 chains | 82.8 % of tokens with >100 % return show artificial growth (wash trading, LP-based price inflation) before the dump. |
| arXiv 2609.01176, *Pump it Up* (Telegram) | 14,499 channels, 20 M messages | In pump-and-dumps, the social burst comes a median **256 s before the price peak**. The messages cannot be told apart from organic talk. |
| arXiv 2306.02148 / 2309.06608 | Twitter / Telegram P&D | Followers who act on promotion sell late and lose. Targets are −30 % a year later. |
| LP Army knowledge base (`.claude/skills/lp-army-playbook/reference/knowledge-base.md`) | community | [consensus] Net buy volume precedes price. [consensus] Screen dev-sold, top-10 share, bundle clusters, rug history. [disputed] Holder-concentration thresholds of 3–20 %. Tokens with fewer than ~2,000 holders are too thin for indicator-based prediction. |
| Lindsey, *Alpha Without Access* (Aug 2026), https://doi.org/10.5281/zenodo.22110673 | 1,220 tokens with ≤1 SOL left on the curve (99.6 % graduate); policy buys 0.10 SOL, holds 5 min, sells on PumpSwap | Paper median if every buy filled: +8.5…+17.5 %. But the median time from ≤1 SOL left to graduation is 0 s; 69 % are unreachable at the first observable second and 89.7 % by 8 s. Fills actually achievable at 8 s: mean −12.3 %. **Zero-cost upper bound of expected gross return: −5.3 % (0 s), −2.9 % (2 s), −1.3 % (8 s). The hour-bootstrap upper 95 % bound is < 0 at every latency.** Faster is worse (adverse selection). One ~2-day window, possibly before BOOST. |
| SmugCalls on-chain count, https://smugcalls.com/pumpfun-graduation-rate.html (Zenodo https://doi.org/10.5281/zenodo.21983722) | 825,123 launches, 6 Jul–5 Aug 2026 | Graduation 2.62 % overall. By the **creator's own initial buy:** none 0.34 %, 0.05–0.2 SOL 5.70 %, 0.2–5 SOL 1.45–2.32 %, >5 SOL 7.98 %. 12.4 % graduate once a coin reaches 25 SOL. Median time to graduation 5 min; 81 % graduate within the first hour. |
| SSRN 6915560 (Kamat, *Graduation regime windows*); SSRN 7307252 (*Which assets become active, and what persists?*) | May–Jun 2026; pump.fun 2025 cohorts | Advertised Telegram → 1.485 % vs 0.166 % graduation (8.94×). Initial mcap > 30 SOL (creator self-buy) hazard ratio 4.51. But the same author's covariates **failed temporal validation** (2607.02823). SSRN 7307252: **prior deployer history is the only tested feature with incremental gain beyond creation-time controls**; narrative tags add nothing; post-graduation daily volume decays to 0.00666 of its early level. |
| pump.fun BOOST (21 Jul 2026, via news) | platform change | ≈20 % of migration liquidity is spent on automatic buys during the first 5 min after migration; the tokens are burned. Graduation rate went from a 2.5 % June average to 4.7 % over the first 4 days. A new, predictable post-migration buy flow. **All base rates from before 21 Jul 2026 are stale.** |
| pump.fun Mayhem mode (Nov 2025), https://pump.fun/docs/mayhem-mode | platform mechanic | An agent wallet `BwWK17cbHxwWBKZkUYvzxLcNQ1YVyaFezduWbtm2de6s` (program `MAyhSmzXzV1pTf7LsNkrNwkWKTo4ougAJ1PPg47MD4e`) buys and sells at random for 24 h on mayhem coins (2B supply). **The same address was the #1 "top-PnL wallet" in our 230-coin sample**, so it must be excluded from wallet-skill lists and from buyer and volume features. |
| Pine Analytics (Mar–Apr 2025, via Bitget news) | 15,000+ launches | Snipers funded directly by the deployer and buying in the creation block: 4,600+ wallets, 15,000+ SOL net profit, 87 % of snipes profitable; 55 % sell within 1 min, 85 % within 5 min. Detectable with the funding graph [E-fund]. |
| CoinWire 2024 (377 X influencers, 1,567 coins); MadeOnSol KOL tracker (1,058 KOL wallets, 30 days) | KOL calls | 86 % of promoted coins were down ≥90 % after 3 months; 3 % did 10×. KOL wallets' median win rate is 57 % (their own trades, not their followers'). |
| SmugCalls call channel (Zenodo, 4,356 calls 30 Jun–17 Aug 2026; live 8,179) | automated Telegram calls | Median **peak** after a call is 1.64× the call mcap and 36–39 % reach 2×. These are peaks, not realised returns. A timestamped, losers-included external signal usable for H07b. |
| Platform scale (DefiLlama 2026-09-25; MadeOnSol Aug 2026; Galaxy Oct 2025) | — | 24 h volume: pump.fun curve 123.2 M USD, PumpSwap 133.8 M USD, LaunchLab 23.4 M USD, Meteora DBC 16.9 M USD. Aug 2026: 1.03 M launches (≈33 k/day) from 223,339 wallets, 1.8 % graduated (≈600/day). Median hold time ≈100 s. |

**Net reading.** The published evidence says early on-chain features **predict** graduation and rug
risk (AUROC 0.8–0.86 in sample). Those predictions **have not been shown to turn into positive
net returns**, and in one pre-registered test they **did not survive two weeks** of time shift.
The one directly measured "obvious" trade, buying just before graduation, has a **negative
zero-cost upper bound** at every latency (Alpha Without Access). No study found a positive
out-of-sample net return for an outside, non-insider trader. Avoiding losers works: it roughly
halves losses. Whether avoidance plus a weak signal crosses zero after costs is the open question
this campaign answers.

---

## 2. Shared definitions (all computable from collector tables)

Collector tables assumed: `tokens` (CreateEvent: mint, creator, name, symbol, uri, create slot/ts,
quote_mint, per-coin initial virtual reserves, mayhem/cashback flags, creator_fee_bps),
`trades` (pump TradeEvent: signature, slot, in-block order, ts, mint, user, is_buy, sol_amount,
token_amount, post-trade virtual and real reserves, fee, creator_fee, cashback, ix_name,
track_volume), `migrations` (CompleteEvent + CompletePumpAmmMigrationEvent: slot, pool,
pool_migration_fee), `amm_trades` (PumpSwap Buy/SellEvent: pool, user, amounts, post-trade pool
reserves, lp/protocol/creator fees).
Programs: pump.fun `6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P`, PumpSwap
`pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA`.

Optional enrichments (each flagged where used):
- **E-fund:** each wallet's first funder, up to 2 hops (one `getSignaturesForAddress` walk per new
  wallet). MELT shows funding links are the largest source of hidden coordination.
- **E-kol:** kolscan leaderboard snapshots, used **point-in-time**, i.e. only snapshots dated on or
  before the trade. The first snapshot is
  `research/memecoins/notes/robinhood-and-social-data/kolscan_leaderboard_2026-09-25.json`
  (142 wallets).
- **E-tx:** full transaction parse (Jito tip account, terminal fee accounts, co-signers) for
  bundle and "routed via terminal" detection.
- **E-sol:** SOL/USD 1-minute series (Pyth or Binance), used only by H14.
- **E-meta:** the metadata JSON behind each CreateEvent `uri` (socials, description). It must be
  fetched **at creation time**, because metadata can change later. Used only by F08.
- **E-calls:** the SmugCalls call log (hash-anchored, https://doi.org/10.5281/zenodo.21983722 and
  its live page), used only by H07b.

Notation (per mint m):
- `s0` = creation slot. `age(e)` = (slot(e) − s0) × 0.4 s. Slots are the clock, because block
  timestamps have 1 s resolution.
- `rs(e)` = real SOL reserves after trade e = vSol − initial vSol. `progress(e)` = rs(e) / rs_grad,
  where rs_grad = 85.005359 SOL for standard coins (verified: completion at vTok 279,900,000,
  vSol 115.005359). Verify per coin from the CreateEvent reserves; mayhem coins have their own
  parameters.
- `NLV(t)` = net liquidation value of a held token amount q at time t. It is the SOL received by
  selling q into the curve (or pool) state at t, after the exact fees, minus the fixed exit
  transaction cost. This is the only mark used anywhere. "Price" is never used for P&L.
- **Creator group `C(m)`:** the creator, plus every wallet that bought in the create transaction's
  signature, plus [E-fund] wallets that share the creator's first funder.
- **Bundle set `B(m)`:** non-creator wallets that buy in slot s0, plus every wallet in a transaction
  with ≥2 distinct buyers within s0…s0+2.
- **Sniper set `S(m)`:** non-creator wallets whose first buy lands in slots s0…s0+4 (≈ the first
  2 s). This follows 2601.08641's "1–5 blocks".
- **Ring set `R` (day d):** rebuilt nightly from the trailing 7 days. For every launch take the first
  20 distinct buyers and count wallet-pair co-occurrences. Keep pairs that co-occur in ≥3 launches
  with Jaccard ≥ 0.5. Union-find components of size 2–12 are rings (adapted from 2607.02795).
- **Bot set `Bot` (day d):** wallets with ≥300 trades across ≥100 mints in the trailing 24 h, or a
  median holding time < 3 s over ≥20 round trips, or ≥3 WT1 wash events (see F07). Always included:
  the platform's mayhem agent `BwWK17cbHxwWBKZkUYvzxLcNQ1YVyaFezduWbtm2de6s`, which is also the
  Global `whitelist_pda`.
- **Excluded wallets** `X(m) = C ∪ B ∪ S ∪ R ∪ Bot`. **Organic** trades are trades by wallets
  outside X(m).
- **Smart wallets `W*` (day d):** from the trailing 7 days, using FIFO realised SOL P&L per mint
  after exact fees. Keep wallets with ≥20 closed mints, mean per-mint return > 0 and t-stat > 2,
  and median hold ≥ 10 s. Drop any wallet that is in `Bot`, is a ring member, or was in C(m) for a
  coin it traded.
- **Normalised ticker:** symbol and name uppercased, non-alphanumerics stripped, trailing digits
  stripped.

Signals are evaluated after every confirmed trade. The **signal slot** `s_sig` is the slot of the
trade that completes the condition. Entry and exit execution follow PROTOCOL §3: latency
L ∈ {0.4, 2, 10} s maps to slots, fills use exact curve math at the landing state, and **L = 2 s is
the primary setting used for selection.**

## 3. Universe rules (fixed; these are not hypotheses and are not tuned)

- U1. Standard SOL quote only: quote_mint = `So11111111111111111111111111111111111111112`.
  Coins quoted in other assets (the Sep 2026 QuoteControl wave) are a separate stratum and are not
  traded in v1.
- U2. Fees come from each coin's own event fields at trade time (PROTOCOL §4).
  - Verified 2026-09-25: the curve charges a flat 1.25 %/side (0.95 % protocol + 0.30 % creator).
    Buyback is a split of the protocol fee. Holder-reward coins redirect the creator fee without
    changing the trader's cost. Cashback coins are deprecated.
  - A configurable creator fee (≤ 3 %) exists only on custom-quote pairs, which U1 already excludes.
  - Any coin whose charged total exceeds 1.25 %/side is excluded, not modelled.
- U3. Mayhem-mode coins are a separate stratum: reported, not pooled.
- U4. A mint is excluded from the day's sample if its reserve chain is discontinuous, i.e. a
  missing trade is detected (PROTOCOL §2). The day is dropped if more than 2 % of its mints fail.
- U5. The first 7 collected days are **warm-up only**. They build W*, R, Bot and creator histories
  and are never traded.

## 4. Shared exit family (every signal hypothesis is run with all six; not tuned further)

| ID | Rule |
|---|---|
| XT60 / XT300 / XT1800 | Time stop: sell τ = 60 / 300 / 1800 s after the entry lands. |
| XB | Bracket: take profit when NLV ≥ +50 %, stop when NLV ≤ −30 %, max hold 1800 s. Checked after every trade; the sell executes at trigger + L. |
| XR | Trailing: exit when NLV falls 35 % below its post-entry peak; max hold 1800 s. |
| XG | Graduation exit: sell into the curve at the first trade with progress ≥ 0.95. If the curve completes before the sell lands, sell on PumpSwap into the first pool state at migration + L. Stop at −30 %, max hold 3600 s. |

Post-migration hypotheses (H11, H12) define their own longer exits. The "exit on dev dump"
override belongs to F02 and is **off** unless F02 passes validation.

---

## 5. Signal hypotheses (entries)

Variant count = parameter grid × exits. Latency is not a free parameter: selection uses L = 2 s,
and 0.4 s and 10 s are reported as sensitivity.

### H01 — Fast organic accumulation ("velocity")
- **Signal:** the first trade e with rs(e) ≥ V, age(e) ≤ T and total trade count up to e ≤ N, **and**
  organic trades supply ≥ 50 % of net SOL inflow up to e.
  Grid: V ∈ {10, 20, 35} SOL, N ∈ {25, 60}, T ∈ {60, 300} s → 12 × 6 exits = **72 variants**.
- **Direction:** + (continuation).
- **Prior:** weak. This is the strongest graduation predictor in 2602.14860, but it stays below
  buy-and-hold breakeven there. On our 101-coin calibration sample, velocity triggers returned a
  mean from +3 % (60-s hold, n = 18–50, noise) to −45 % (30-min hold) (PROTOCOL §14).
- **Why it might survive faster bots:** it fires 10–300 s after launch, which is not a slot-0 race.
  The organic-share condition removes the bundle-made "velocity" that naive auto-buy bots react to.
  **Why it might not:** it is a simple public trigger ("X SOL in Y s"), and terminals sell it as
  auto-buy. At L = 2 s we buy after them and become their exit liquidity.
- **Frequency (est.):** 1–5 % of launches. Planning base rates for Jul–Aug 2026 are ≈26–33 k
  launches/day and 1.8–2.6 % graduation, i.e. ≈500–900 graduations/day, and more after BOOST.
  PROTOCOL G6 replaces them with measured values.

### H02 — Organic breadth with low concentration
- **Signal** at age W: organic unique buyers ≥ U, Herfindahl of organic buy SOL ≤ 0.10, and net
  organic inflow > 0. Grid: W ∈ {60, 180} s, U ∈ {15, 30, 60} → 6 × 6 = **36 variants**.
- **Direction:** +.
- **Prior:** weak. Unique buyers is a top feature in rug models (2608.20271, MELT market-activity
  group). Rings inflate raw buyer counts (2607.02795), so the organic filter is the point.
- **Survival argument:** it needs the ring, bot and bundle classification, which generic trigger
  bots do not do. It fires at 60–180 s.

### H03 — Net organic buy pressure
- **Signal:** the first rolling window of length Δ, at age 60–1800 s, with organic net inflow ≥ F SOL
  and organic buys/sells ≥ 2. Grid: Δ ∈ {30, 120} s, F ∈ {3, 8} → 4 × 6 = **24 variants**.
- **Direction:** +.
- **Prior:** folklore ([consensus] in LP Army: "net volume precedes the chart").
- **Survival argument:** weak. Every terminal displays this. Kept as the folklore control.

### H04 — Early-holder retention (low overhang)
- **Signal** at age A: at least a fraction r of the first 20 organic buyers still hold ≥ 80 % of the
  tokens they bought, and progress is in [0.15, 0.70].
  Grid: A ∈ {300, 900} s, r ∈ {0.6, 0.8} → 4 × 6 = **24 variants**.
- **Direction:** +. Mechanism: early buyers' unrealised profit is future sell supply; if they have
  not sold, the overhang is smaller.
- **Prior:** folklore / mechanistic. 2602.14860 shows dumps kill graduation, but retention may only
  mean "not dumped yet".
- **Survival argument:** it needs per-wallet position state and is slow (5–15 min), so it is not a
  latency race.

### H05 — Near-graduation run-up, sell into migration
- **Signal:** the first trade with progress ≥ P, **and** the time from progress 0.5 to P ≤ Tfast.
  Grid: P ∈ {0.70, 0.85}, Tfast ∈ {120, 600} s. Exits: XG (primary), XT300, XB → 4 × 3 = **12 variants**.
- **Arithmetic:** at P = 0.85, vSol ≈ 102.25 → the graduation price is (115/102.25)² ≈ 1.265×.
  Assume a stop that fills at ≈ −35 %. The required P(complete) then depends on where the win is
  taken:
  - Held into migration (PumpSwap opens at ≈ the final curve price, tier fee 1.25 %): +26.5 %
    gross, ≈ +23 % net → P(complete) ≈ 0.60 to break even.
  - Sold into the curve at progress 0.95: +17 % gross, ≈ +14.6 % net → P(complete) ≈ 0.70.
- **Direction:** + (small).
- **Prior:** weak / contra.
  - For: it is the only region where a published conditional curve (non-bot share > 0.3)
    **approaches** breakeven (2602.14860). That paper assumed a total loss on non-graduation; our
    stop cuts that loss.
  - Against: the closest measured version (buy with ≤1 SOL left, hold 5 min) has a **negative
    zero-cost upper bound at every latency** (Alpha Without Access). Our P = 0.70/0.85 enters
    earlier, where the coin can still be reached but P(complete) is lower. The earlier entry is the
    only thing that can make H05 differ from that negative result.
- **Survival argument:** the crowding is on the migration snipe, while we are the seller into it.
  **Risk:** H15 says post-migration dumps are fast, so an exit that lands late gives back the gain.

### H06 — Smart-wallet consensus (k independent skilled wallets)
- **Signal:** k distinct W* wallets make their first buy of m within Δ of each other; they are not
  in the same ring and do not share a first funder [E-fund]; the k-th buy happens at progress < 0.7.
  Entry at the k-th buy + L. Grid: k ∈ {2, 3}, Δ ∈ {60, 600} s → 4 × 6 = **24 variants**.
- **Direction:** +.
- **Prior:** weak. Leader skill persisted out of sample in our A26 test (+20 %) and in 2601.08641
  (+14 %). Copying one leader loses to the imitation penalty. Consensus aggregates independent
  information and does not need to beat any single leader's slot.
- **Survival argument:** GMGN-style "smart money" alerts crowd single-wallet copying. Consensus
  with a trailing, point-in-time, bot-cleaned W* is less common. Adversarial: KOLs know they are
  copied (2601.08641 attack models).

### H07 — KOL buy: follow vs fade [E-kol]
- **Signal:** the first buy by a KOL wallet (point-in-time list) of ≥ S SOL, at progress < 0.9.
  Grid: S ∈ {0.5, 2} SOL; exits × 6, plus 2 variants with the override "sell when that KOL sells"
  (+L) → **14 variants**.
- **Direction: − expected for following.** Followers are exit liquidity (2601.08641 sniper-KOL and
  bundle-KOL attack models; 2306.02148; our copy result −10…−13 %).
- **Prior:** contra. If confirmed, "KOL bought in the first 5 min" joins the avoid-list (tested
  under F-incremental). CoinWire found 86 % of promoted coins down ≥90 % at 3 months. The MadeOnSol
  KOL win rate of 57 % is the KOLs' own trades, not their followers'.
- **H07b [E-calls, optional]:** the same test with the SmugCalls hash-anchored call log as the
  signal. Entry at call time + L; the call timestamp is taken from the log and never adjusted.
  Grid: exits × 6 → **6 variants**. Median call peak 1.64×, but peaks are not returns. Prior: weak.

### H08 — Creator track record [E-fund improves]
- **Signal** at creation: the creator (or funder cluster) over the trailing 30 days, point-in-time,
  has ≥ n_min launches, a graduation rate ≥ g, and a median gap between launches ≥ 10 min (not a
  factory). Entry at s0 + L.
  Grid: n_min ∈ {3, 10}, g ∈ {5 %, 15 %} → 4 × 6 = **24 variants**.
- **Direction:** + (graduation), but **− expected at L ≥ 2 s**.
- **Prior:** weak.
  - 2602.14860: prolific creators do not help, and top-10 creators have tiny n.
  - 2609.10246: some groups reach ≈14 % graduation, in sample.
  - SSRN 7307252: **prior deployer history is the only tested feature with incremental predictive
    gain**. This makes it the best-supported *predictor* in the list. What remains unknown is
    whether it is still tradable after snipers act on it.
- **Survival argument:** almost none. Dev-tracking snipers buy in slot 0, and our A26 snipers lost
  −29…−51 %. Kept because it is cheap to test and could show that a coin's minutes-long trend
  outlasts the sniper pile.

### H09 — Narrative originality (the copycat wave as an attention signal)
- **Signal:** m is the earliest coin with its normalised ticker in the trailing 24 h, and ≥ c other
  coins with the same ticker are created within D minutes of m. Enter when the c-th copy is created
  (+L), if m's progress < 0.9. Grid: c ∈ {3, 10}, D ∈ {10, 30} → 4 × 6 = **24 variants**.
- **Direction:** +.
- **Prior:** weak. Originals with copycats graduate 9.2 % vs 1.02 % (2609.10246), but that uses
  look-ahead. This tests the real-time version.
- **Survival argument:** copycat factories detect attention quickly but create coins rather than buy
  the original. A buyer's signal at 3–10 copies is minutes old but may still be early.

### H10 — Dip-buy / first-dump recovery on the curve (mean reversion)
- **Signal:** peak progress ≥ Pk, then NLV-price drawdown ≥ D from the peak within 10 min. Entry
  mode "dip" enters at the first trade after the drawdown. Entry mode "recovery" enters when
  price has recovered one third of the drop.
  Grid: Pk ∈ {0.3, 0.5}, D ∈ {40 %, 60 %}, mode ∈ {dip, recovery}; exits XT300, XB, XR →
  8 × 3 = **24 variants**.
- **Direction: − expected.**
- **Prior:** contra. After a dump, coins rarely attract the net inflow needed to graduate
  (2602.14860). This is the "buy the dip" folklore control. If it is negative, "never enter after a
  ≥ D dump" becomes a filter.

### H11 — Post-migration survivor momentum (PumpSwap)
- **Signal** at migration + h: pool price ≥ k × the migration price, trailing-1 h pool volume
  ≥ 50 SOL, and ≥ 100 unique traders. Entry on PumpSwap at +L.
  Grid: h ∈ {1 h, 6 h}, k ∈ {1.0, 2.0}. Exits: time 6 h, time 24 h, bracket +100 %/−40 % with max
  72 h → 4 × 3 = **12 variants**.
- **Direction:** + (momentum among survivors).
- **Prior:** weak / contra. The median graduate's price falls ≥ 95.7 % within 24 h (the −88 % LP floor), and hot day-1 memes are
  −58…−66 % over 72 h. Survivors are a different population, not measured yet.
- **Survival argument:** it runs on an hours scale, so latency is irrelevant. The risk is insiders
  distributing into survivor strength (MELT: 36.5 % of supply is coordinated at migration).

### H12 — Post-migration capitulation bounce (PumpSwap)
- **Signal:** within 2 h of migration, price is ≥ D below the migration price, then a 5-min window
  shows net buy inflow > 0. Grid: D ∈ {70 %, 85 %}. Exits: time 1 h, bracket +50 %/−30 % with max
  6 h → **4 variants**.
- **Direction: − expected** (dead-cat bounce).
- **Prior:** contra.

### H13 — Walk-forward ML composite (ceiling test)
- **Features** at age a: everything used above, the 24 first-5-minute features of 2608.20271
  (counts, buy/sell ratios, unique buyers and sellers, early price changes, timing), and the
  bundle/ring/sniper/creator shares (MELT group 4).
- **Target:** net return under XB at L = 2 s.
- **Model:** gradient boosting, retrained weekly on the trailing 14 days, strictly point-in-time.
  There are 3 hyperparameter configs, listed in advance, with no other tuning. Trade when the
  predicted return is > θ.
- **Grid:** a ∈ {60, 300} s, θ ∈ {0, +5 %}, 3 configs → **12 variants**.
- **Prior:** weak. In 2607.02823 AUROC fell from 0.86 to 0.46 two weeks later. MCC for rug models is
  0.39. The best MELT filter still loses −27 %.
- **Role:** an upper bound on what these features can do. If the composite cannot beat zero in
  validation, no hand rule will, and that feeds the futility stop (PROTOCOL §11).

### H14 — Regime modifiers (applied only to validation finalists, at most 5)
- M1 platform heat: graduations in the trailing 1 h ≥ the trailing-7-day median hourly count.
- M2 SOL trend [E-sol]: SOL/USD 1 h return ≥ 0.
- M3 session: entry hour UTC in [12, 24) vs [0, 12).
- 3 modifiers × ≤5 finalists = **15 variants**.
- **Prior:** weak / folklore. Evidence on each side:
  - The only statistical hour-of-day claim collapsed after correction, from p = 0.006 (SSRN
    6564803) to p = 0.56 (2606.08232 v3).
  - Folklore contradicts itself: one Reddit analysis says Fri–Sun, another source says Tue–Thu.
  - Daily graduation rates swing 1.43–3.62 % within one month.
  - Deployer-funded snipers are active 14:00–23:00 UTC and nearly idle 00:00–08:00 UTC.
  - Attention spillovers across chains (2602.23762) suggest regime matters.

### H15 — Exiting at migration beats holding through it (exit hypothesis)
- For every H01–H06 position still open at migration, compare three exits: (a) sell into the first
  PumpSwap state at migration + L; (b) hold to migration + 1 h; (c) hold to migration + 24 h →
  **3 variants**.
- **Direction:** a > b > c.
- **Prior: strong.** The median graduate's price falls ≥ 95.7 % within 24 h (our −88 % LP floor, 48 pools), and a 2-min-late LP entry was −98 %; MELT 84 % high-risk within
  20 min.
- **Role:** a design constraint. Every exit caps its hold at ≤ 1 h after migration. Verified on data,
  not assumed.

### H16 — The BOOST window: sell into (or ride) the automatic post-migration buys
- **Background:** since 21 Jul 2026, ≈20 % of migration liquidity is spent on automatic buys during
  the first 5 min after migration, and the tokens are burned.
  - Verified on-chain 2026-09-25: the migration tx emits `InitBoostEvent`, which moves 17.584505288
    SOL of the pool's quote into a boost vault controlled by
    `HTVZVEQMBsNanubDPTs3CxDAEGNFQHJY8c1441iy2S5r`. The same amount becomes
    `virtual_quote_reserves`.
  - Spending is logged as `BoostBuyAndBurnEvent`, so the flow is observable.
  - How often and how fast it fires is unverified and must be measured first (G6).
  - Side effect: only ≈67.4 SOL of real SOL backs sellers at the start, and a drained pool can quote
    a price with no exit (PROTOCOL §3.4).
- **(a) Exit timing**, for positions held into migration: sell at migration + L vs at migration
  + 60 s vs at migration + 300 s (just before BOOST ends) → 3 variants.
- **(b) Entry**: buy the first PumpSwap state at migration + L, and sell at migration + 60 s or
  + 300 s → 2 variants.
- **5 variants.**
- **Direction:** + for (a) waiting for BOOST vs selling at once; ? for (b).
- **Prior:** weak / contra.
  - For (a): a known, mechanical buy flow is exactly what a seller wants to sell into.
  - Against (b): our Sep 2026 measurement (post-BOOST) found that a pool position entered 2 min after
    migration was −98 % in SOL. Alpha Without Access found the pre-graduation path unreachable.
- **Survival argument:** the flow is public, so everyone who holds will sell into it. The question
  is whether BOOST is larger than that selling. That can only be measured on post-21-Jul data, which
  is all of our collector's data.

### H17 — Creator's own initial buy (signal and filter)
- **Signal** at creation: the SOL the creator spends in the create transaction falls in bucket
  β ∈ {[0.05, 0.2), [0.2, 5), ≥ 5} SOL. Entry at s0 + L → 3 × 6 = **18 variants**.
- **Filter use** (counted under F-incremental): "no creator buy" → avoid.
- **Direction:** + for [0.05, 0.2) and ≥ 5; the "none" bucket is expected strongly negative.
- **Prior:** weak for trading, moderate as a predictor. On 825,123 launches (Jul–Aug 2026)
  graduation was 0.34 % (none) vs 5.70 % (0.05–0.2 SOL) vs 7.98 % (> 5 SOL), and SSRN 6915560 gives
  hazard ratio 4.51 for initial mcap > 30 SOL.
- **Survival argument:** weak. The dev buy is in the create transaction, so every slot-0 sniper
  sees it first and our L ≥ 2 s entry comes after them. It is more promising as a zero-cost filter
  on the other signals.

---

## 6. Filter hypotheses (avoid-lists; avoiding losers may matter more than finding winners)

Each filter is tested two ways. (i) **Standalone:** a naive baseline enters every universe coin at
age 30 s and 120 s with exit XT300 and XB. Compare the mean net return of flagged coins with
unflagged coins, with a day-block bootstrap CI. (ii) **Incremental:** apply the filter on top of each
validation finalist. A filter passes if (i) flagged-minus-unflagged is < 0 with its CI excluding 0,
**and** (ii) it does not reduce any finalist's validation mean. At most 3 filters are frozen into
the final strategy.

| ID | Definition (flag at signal time unless stated) | Grid | Prior and evidence |
|---|---|---|---|
| **F01 Bundled launch** | ≥ b non-creator wallets buy in slot s0, **or** the create tx plus slot-s0 buys take ≥ s % of supply | b ∈ {1, 3}; s ∈ {10, 25} → 4 | **moderate.** MELT: 36.5 % coordinated supply, and filtering halves the loss. 2601.08641: bundles weakly lower returns. Our sample: same-slot "bundle-like" positions +14 %, i.e. they are the winners against everyone else. |
| **F02 Dev / insider dump** | C(m) has sold ≥ x % of the tokens it acquired within T of s0. Two uses: (a) never enter after the flag; (b) exit override, sell a held position at flag + L | x ∈ {50, 90}; T ∈ {60, 600} s; use ∈ {a, b} → 8 | **moderate.** Coordinated sells via 7-wallet sender groups (2609.10246), MELT insider unwind, GMGN "dev sold" folklore. Caution: our two passes disagree on creators' own trading P&L (−12.7 % raw in one run, +23 % in another), because devs earn from creator fees as well as from dumping. |
| **F03 Sniper ring / early overhang** | Ring wallets hold ≥ h % of supply, **or** ≥ 25 % of the first 20 buyers are ring members, **or** [E-fund] any slot-s0 buyer was funded directly by the creator before launch | h ∈ {5, 15} → 2, + 1 deployer-funded variant → 3 | **moderate.** 2607.02795: rings inflate buyer counts, not SOL inflow, and 7 % of their launches have no outside buyers. Pine Analytics: deployer-funded creation-block snipers were 87 % profitable, and 55 % sold within 1 min. A26 snipers −29…−51 %. |
| **F04 Holder concentration** | Top-10 non-curve holders, merged by ring and C(m) [E-fund], hold ≥ c % of supply | c ∈ {25, 40} → 2 | **moderate/folklore.** In MELT the top-10 share rises 24 pp for high-risk coins vs 6 pp for low-risk. LP Army thresholds are disputed (3–20 %). |
| **F05 Factory creator** | The creator (cluster) launched ≥ n coins in the trailing 24 h with 0 graduations, **or** its median gap between launches is < 60 s | n ∈ {5, 20} → 2 | **moderate.** The top 1 % of clusters make 58.6 % of coins, and more automation means lower graduation (2609.10246). |
| **F06 Copycat** | The normalised ticker matches a coin created earlier in the trailing 24 h that reached progress ≥ 0.3 or graduated | 1 | **weak-moderate.** Copycats graduate 0.86 % vs a 1.02 % base (2609.10246). |
| **F07 Wash / bump volume** | WT1 trades (same wallet buys and sells in one tx) plus WT2 trades (same wallet buys and sells ±2 % of the same token amount within 5 s) are ≥ w % of trades | w ∈ {10, 30} → 2 | **two-sided.** Wash-traded coins graduate *more* (2609.10246), but fake volume also feeds the trigger bots. The sign is not pre-judged. Funder grouping caught 30 of 30 flagged wash wallets (Bitquery, Apr 2026) [E-fund]. |
| **F08 No socials** [E-meta: fetch the metadata `uri` JSON] | The coin advertises no X / Telegram / website link; variant: no Telegram link | 2 | **weak / conflicting.** Telegram-advertised coins graduate at 8.94× the rate (SSRN 6915560), but the same kind of social-link covariates **failed temporal validation** in 2607.02823. |

Plus the two contra-hypotheses, which turn into filters if confirmed negative: "KOL bought in the
first 5 min" (H07) and "a ≥ D dump already happened" (H10).

---

## 7. Variant ledger at freeze

| Block | Variants |
|---|---|
| H01 72, H02 36, H03 24, H04 24, H05 12, H06 24, H07 14 (+H07b 6), H08 24, H09 24, H10 24, H11 12, H12 4, H13 12, H14 15, H15 3, H16 5, H17 18 | **353** |
| Filters standalone F01–F08 (4 + 8 + 3 + 2 + 2 + 1 + 2 + 2) | **24** |
| Filters incremental (≤ 5 finalists × (24 + "no creator buy" + "KOL in first 5 min" + "after a dump")) | **≤ 135** |
| Reserve for logged exploratory additions (each one must be logged) | ≤ 150 |
| **K for multiple-testing control** | **≤ 662** (the actual count at unblinding is used) |

Sizes (0.05 / 0.1 / 0.25 / 0.5 SOL) and latencies (0.4 / 10 s) are sensitivity dimensions of the
finalists. They are reported but are not selection variants.

## 8. Prior ranking (for deciding what to build first; this does not affect the tests)

1. **F02** dev/insider-dump avoidance plus exit override: loss avoidance works in every study that
   measured it.
2. **F01 + F03** bundled-launch and deployer-funded-sniper avoidance: MELT halves the loss; Pine
   shows who profits.
3. **H15 + H16a** exit at migration, or inside the BOOST window: strong. It is a constraint more than
   an edge.
4. **F05 / H08** deployer history: the only feature with published incremental predictive gain
   (SSRN 7307252). Most useful as a filter; as an entry it is sniper-crowded.
5. **H17** creator initial buy: a large association (0.34 % vs 5.7–8.0 % graduation on 825 k
   launches). Most useful as a filter.
6. **H02** organic breadth: its value is the ring/bot/bundle classification that generic bots lack.
7. **H06** smart-wallet consensus: leader skill persisted out of sample twice; consensus sidesteps
   the single-leader imitation penalty.
8. **H13** ML composite: a ceiling test, useful as a futility check.

Demoted after the sweep: **H05** near-graduation. The closest measured version has a negative
zero-cost upper bound. **H01** velocity is below breakeven in 2602.14860.

Expected negative (contra): H07 follow-KOL, H08 creator sniping at L ≥ 2 s, H10 dip-buy, H12
capitulation bounce, H16b buy-at-migration.

## 9. Why most of this may fail (stated in advance)

- On a bonding curve, price moves only when someone trades. A public signal is "priced in" only by
  the bots that trade on it. If they fire at 0.4 s and we fire at 2 s, we pay their markup and they
  sell into us.
- Out-of-sample decay is documented. Graduation-model AUROC went from 0.86 to 0.46 in two weeks
  (2607.02823). The platform also changes its rules monthly: creator-fee tiers, cashback, mayhem
  mode, non-SOL quotes.
- The best published outsider result (+2.9 %/coin, 2601.08641) assumes zero fees and zero latency.
  A published review (https://doi.org/10.5281/zenodo.22679925) adds that its bundle detector was
  never validated.
- The most direct published test of an obvious pattern is buying the last SOL before graduation. It
  is negative even at zero cost and zero latency (Alpha Without Access). Faster bots do *worse*
  because they reach more of the bad coins.
- Our structural edge is small and real. We pay no terminal fee, which saves ≈0.95 %/side vs the
  measured retail cost, and we can skip most coins. In our sample the naive non-creator population
  is ≈ −3.6…−5.0 % SOL-weighted after pump.fun fees but before terminal fees and tips. A filter plus
  signal has to add ≈ +5 % per trade just to reach zero.

---

## Amendments

(none)

### Amendment A1 (2026-09-25): public-tape results and confirmatory candidate C1

**About this amendment.** It is dated and append-only; nothing above it was edited. It was written
at about 12:50 UTC on 2026-09-25. At that time `data/memecoins.db` held **no** trades and **no**
tokens created before 2026-09-25 00:00Z (checked at 12:49Z), so none of the backfilled week
used in A1.4 had been seen. HYPOTHESES.md before the append had sha256
`0d3c564cc521a46d084e26cf5d8e5c272adb31f79602648f450d6a3b6bd3b54f`. The post-append hash and the
time are in `results/raw/hypotheses-amendment-A1.sha256`.

#### A1.1 Source and status

- **Report.** The public-tape futility pilot is `results/futility-public-tapes.md`.
- **Rule.** The rule was stated before any result: `results/raw/futility-rule-prestated.md`,
  sha256 `ea55bbf4232098f97ec96c1e5bc74f1662660be99f02e8e288166d89e17a7c82`. Addendum
  `futility-rule-addendum-A1.md` has sha256
  `d99018109ac14d9df2f2e1baf3147cdb71594db246f650b37e71c471d7c32394`.
- **Tape.** van de Wouw, https://doi.org/10.5281/zenodo.22306254: 28.7 M curve trades on 28 days
  between 2026-04-28 and 2026-07-13, all before BOOST.
- **The tape fails G1 at the letter.** 23.2 % of its mints have reserve-chain gaps. It has no
  slots, no fee fields and no PumpSwap trades.
- **The tape is winner-biased.** Coins that graduate are 2–7× more likely to be on it than coins
  that do not.
- **So the kills below are operational, not formal PROTOCOL §14 kills.**

#### A1.2 Operationally killed; excluded from S2 exploration and S3 validation

- **H02 organic breadth, 36 variants.** Every variant has a 95 % CI upper bound < 0, even at the
  most favourable execution (L = 0.4 s, optimistic placement). The best variant is
  −4.8 % [−6.0, −3.4]. This holds under all three data treatments.
- **H05 near-graduation run-up, 12 variants.** Every variant has CI < 0 at the favourable
  execution, even though a favourable pool-open exit price was assumed. At L = 2 s the variants
  range −10.3 … −18.0 %. This agrees with *Alpha Without Access*.
- **H09 copycat wave, 24 variants.** Every variant has CI < 0 at the favourable execution. At
  L = 2 s the median variant is −5.9 %.

These variants are not re-opened on our data unless a new dated amendment argues for it before
any validation data is seen.

#### A1.3 Variant budget

- **Validation grid.** Signal variants go from 353 to **281** (−72). The pre-registered total
  goes from about 512 to **about 440**. The exploratory reserve stays ≤ 150. The validation
  ceiling becomes **≤ 590**.
- **K accounting.** PROTOCOL §14 says every public-tape use counts toward K. The ledger
  `results/variant_ledger.csv` holds **335** distinct public-tape variants, including the 72
  killed ones.
  - The deflated Sharpe ratio and any count-based correction use K = (distinct variants evaluated
    on validation) ∪ (public-tape variants).
  - The SPA / Romano-Wolf bootstrap runs over the variants actually evaluated on validation.

#### A1.4 Confirmatory candidate C1 (a pre-registered variant, not a new one)

**C1 = `H17 · creator buy in [0.05, 0.2) SOL · exit XB`.**

**Why this variant.** On the tape it was the only H17 variant, and the only H01–H17 hand rule,
whose 95 % CI lies above 0 at the primary setting:
- L = 2 s, pessimistic placement, insert-and-replay, 0.1 SOL: **+11.5 % [+7.7, +16.9], n = 2,698
  over 21 days**;
- +4.9 % at L = 10 s.

It was picked from 3 buckets × 6 exits on the tape, so the tape estimate is inflated by the
winner's curse. The confirmation below uses only new data.

**This is not finalist selection.** §9.3 and PROTOCOL §14 are unchanged. A confirmed C1 enters
S3 as a pre-declared candidate and must still pass S3–S7. Real money needs operator approval.

**Frozen definition. Every parameter is exactly as run on the tape.**

- **Universe.**
  - pump.fun bonding-curve coins with SOL quote (U1), not mayhem (U3). Mayhem means
    `is_mayhem`, or any trade by `BwWK17cbHxwWBKZkUYvzxLcNQ1YVyaFezduWbtm2de6s`.
  - The reserve chain must start from the standard initial state: the first trade's pre-trade
    virtual SOL is exactly 30,000,000,000 lamports.
  - Later chain gaps are allowed. Each is replayed as one aggregate trade of the same direction
    (tape addendum A1 treatment).
  - Creation (the CreateEvent's slot) must fall inside the look window.
- **Signal.**
  - The creator buy is the curve SOL amount (TradeEvent `sol_amount`, which excludes fees) of the
    coin's **first** trade in reconstructed execution order. That trade must start from the
    initial state, be made by the coin's creator (CreateEvent `creator`), and be a buy.
  - C1 fires iff **50,000,000 ≤ creator buy < 200,000,000 lamports**.
  - Coins whose first trade is not the creator's buy are not candidates.
- **Signal time** = the creation slot s0. On the tape it was the creation second.
- **Signal state** = the curve state after the last trade with tick ≤ s0. It is used for the
  quote.
- **Entry.**
  - Budget S = **0.1 SOL** (100,000,000 lamports).
  - The quote t_q is taken at the signal state with the SDK formula:
    input = (S − 1)·10⁴/(10⁴ + 125), t = input·vTok/(vSol + input), capped at the real tokens.
  - Order type: an exact-token `buy(t_q)` with `max_sol_cost` = **1.20 ×** the quoted cost of t_q,
    fees included. If the landing state needs more, the buy fails and the failed-tx cost is paid.
  - Latency **L = 2 s**: the order lands at s0 + 5 slots (0.4 s per slot). **Pessimistic
    placement:** we execute after every trade with slot ≤ s0 + 5. On the tape's 1-s clock this
    was: after every trade with second ≤ creation second + 2.
  - Landing failure p = **0.10** per attempt. It is a deterministic hash of (mint index, signal
    tick, attempt) (`rng` in `backtest/sim.ts`). Buys retry once, L later, then are abandoned.
- **Fees.**
  - Curve: 95 bps protocol + 30 bps creator per side, each charged with ceil (PROTOCOL §4.1).
  - PumpSwap tier 0: 2/93/30 bps.
  - A landed tx costs 5,000 + 100,000 lamports. A failed-but-included tx costs 5,000 + 50,000.
- **Exit XB.**
  - NLV = sale of the whole position into the current state, after fees, minus the exit-tx cost
    (105,000 lamports). It is checked after every trade.
  - **Take profit** when NLV ≥ cost basis × 1.50. **Stop** when NLV ≤ cost basis × 0.70.
  - **Time stop:** 1,800 s = 4,500 slots after the entry lands.
  - The sell lands L = 2 s (5 slots) after the trigger, with pessimistic placement. Its
    `min_sol_output` is 0.70 × the quote at the trigger. A failed sell is retried every 5 slots
    with a new quote.
  - If NLV ≤ 0 at the trigger, the trade is marked −100 % and not sold.
  - If the curve completes while we hold, we sell into the pool-opening state at completion + L:
    - quote = real SOL − 0.015000001 SOL, base 206,900,000 tokens;
    - tier-0 fee;
    - real-vault check with vault = quote.
- **Counterfactual.** Insert-and-replay.
- **Data treatment.** A signal is used only if no minute in [signal minute, signal minute + 65]
  has zero curve trades in the database (collector downtime guard).
- **Statistic.**
  - Per-trade net return r = (exit value − cost basis) / cost basis, over filled trades whose
    signal falls in the look window. The failed-attempt costs are inside the basis and the exit
    value.
  - The test uses the **mean** of r.
  - Day-block bootstrap over UTC signal days, 10,000 resamples, seed 27 (`dayBootstrap` in
    `backtest/stats.ts`), with percentile bounds.
- **Code.**
  - Definitions come from `backtest/curve.ts`, `sim.ts`, `signals.ts` (`H17`, `timeSignal`),
    `stats.ts`, `chain.ts`, `tape.ts` and `context.ts`.
  - Between this amendment and the look-1 run, the only allowed changes are:
    - (a) data I/O in `adapters/collector.ts`: reading rows, including `source = 'backfill'`,
      streaming and memory;
    - (b) the slot → UTC time mapping, used only for day bucketing and the downtime guard.
  - **Nothing above may change.**
  - File hashes will be recorded in `results/raw/c1-code-freeze.sha256` before look 1 is run.
- **Reported, not decisive:**
  - median, win rate, trimmed mean, the mean without the top 3 trades, and the best-day share;
  - no-insert, L = 10 s, L = 0.4 s;
  - PROTOCOL G1/G2/G5 day gates;
  - pricing a migration exit on the first observed pool state;
  - the share of C1 coins whose observed fee fields differ from 1.25 %/side;
  - signal counts, abandoned and slippage failures, and the pool-exit share.

#### A1.5 C1 test: two looks on disjoint, unselected data

- **Look 1: backfilled week.**
  - Signals created in **[2026-09-18 00:00:00Z, 2026-09-25 00:00:00Z)**: 7 UTC days,
    2026-09-18 … 2026-09-24. Every launch is included; the week is after BOOST and under current
    fees. It was never used to choose C1.
  - Data: curve trades from any source in the collector database. The week is being written by
    the collector's backfill (`source = 2`, 'backfill'), with PumpSwap trades for coins that
    graduated in the window.
  - Run as soon as the collector agent reports the backfill complete.
  - Signals whose 65-min guard reaches past the data end are excluded by the downtime rule.
  - **Void** (no decision from look 1) if there are fewer than 5 usable signal days or fewer than
    100 filled trades.
- **Look 2: live days.**
  - Signals created in **[2026-09-25 00:00:00Z, 2026-10-23 00:00:00Z)**, i.e. UTC days
    2026-09-25 … 2026-10-22.
  - Run on or after **2026-10-23 01:00Z**.
  - C1 uses no trailing object (Bot, R, W*, creator history), so U5's warm-up reason does not
    apply. **U5 is waived for C1 only.**
  - The window ends before the planned validation and test days: train ends 2026-11-02 under the
    60-day plan, so those days are not touched.
  - **Void** if there are fewer than 10 usable days or fewer than 300 filled trades. Then the
    window end moves forward one day at a time until both hold, but never past
    2026-11-03 00:00Z. If both still fail, C1 is **dropped as untestable**, which counts as not
    confirmed.
- **Multiplicity.** There are two looks on disjoint data. Each is tested one-sided at
  **α = 0.025** (Bonferroni over 2 looks), so the pass bound is the **2.5th percentile** of the
  day-block bootstrap distribution of the mean. That is the lower end of the two-sided 95 % CI.
  Under a true mean ≤ 0: P(confirm) ≤ P(look-1 pass) + P(look-2 pass) ≤ 0.05.
- **Look 1 decision.**
  - **KILL** if the 97.5th percentile < 0, i.e. the whole two-sided 95 % CI is below 0.
    C1 is dead; look 2 is reported descriptively only.
  - **PASS-1** if mean > 0 and 2.5th percentile > 0.
  - Otherwise **CONTINUE**.
- **Look 2 decision.**
  - After PASS-1: **CONFIRMED** if the look-2 mean > 0 (the sign replicates). Otherwise
    **KILLED**, as a failed replication.
  - Otherwise: **CONFIRMED** if the look-2 mean > 0 **and** its 2.5th percentile > 0.
    Otherwise **KILLED**. There is no extension beyond the void rule and no re-tuning.
- **What a kill means.** C1 is excluded from validation. The other H17 variants stay as
  pre-registered. A kill on unselected post-BOOST data is also evidence that the tape's
  launch-time pocket was a selection artefact. That is noted for the S1 read; it is not a rule.

#### A1.6 H13: model spec frozen; no separate confirmatory look

- **Spec as run on the tape** (`backtest/h13.ts`):
  - the 30 features listed in `FEATURES`, computed point-in-time at age a ∈ {60, 300} s;
  - target = net return under XB at L = 2 s (pessimistic, insert-and-replay, 0.1 SOL);
  - histogram gradient boosting with squared loss, 32 quantile bins, row subsample 0.8;
  - configs C1 (depth 2, 150 trees, lr 0.05, min leaf 100), C2 (3 / 300 / 0.03 / 100) and
    C3 (4 / 400 / 0.02 / 200);
  - retrained every 7 days at 00:00Z on the trailing 14 days;
  - a training row is used only if its entry was ≥ 1 h before the retrain;
  - trade when the prediction > θ, with θ ∈ {0, 0.05}.
- **Its role stays PROTOCOL §11.1** (the S1 ceiling at day 28).
- **Why it is not a confirmatory candidate.**
  - On the tape it was +4.9 … +26.9 % out of fold, but the gain came from progress × drawdown ×
  early buy volume (39 / 21 / 18 % of split gain). No single feature was positive in any
  quintile.
  - That pattern fits the tape's outcome-correlated inclusion.
  - It is a ceiling test, not a strategy.

### Amendment A1.1 (2026-09-25, erratum to A1.4): slot conversions

**Timing.** Appended at about 13:00 UTC, still before any backfilled data existed in
`data/memecoins.db` (0 trades and 0 tokens before 2026-09-25 00:00Z).

**The error.** A1.4 converted seconds to slots at 0.4 s per slot: 5 slots for L = 2 s, and
4,500 slots for the 1,800 s time stop. The collector measured a slot time of about 0.2664 s
(collector README). Under PROTOCOL §3.1 and G6, a slot time that differs from 0.4 s by more than
10 % replaces 0.4 s.

**The binding C1 parameters are therefore in seconds, as run on the tape:**
- latency L = **2 s**;
- time stop **1,800 s**;
- sell retries every L.

**How seconds become slots on collector data.** The slot time is measured on each look's own
data as (last trade ts − first trade ts) / (last slot − first slot) over the look window. Then:
- Δ = ⌈2 s / measured slot time⌉;
- landing = s0 + Δ, pessimistic: after every trade with slot ≤ s0 + Δ;
- the time stop is 1,800 s / measured slot time after the entry lands.

The simulator already does this through `tickSec`. The measured value is reported with each look.

**Unchanged.** Everything else in A1.4 and A1.5.

### Amendment A1.2 (2026-09-25, about 14:45 UTC): operator-ordered early look at C1, before any C1 result

**The operator's order.** Evaluate C1 now on the data already collected. Helius credits are
exhausted, so the backfill week cannot be completed. No C1 result on collector data had been
computed when this was appended.

**The data this look uses.** `data/memecoins.db`, frozen when the collector stopped. It covers:
- the continuous backfill from 2026-09-23 04:22Z to 2026-09-25 00:02Z;
- live data from 2026-09-25 10:13Z to 13:48:31Z;
- 15 sample chunks from 2026-09-18 to 2026-09-22 (about 10 min each).

The unchanged 65-min downtime guard drops signals that lack 65 min of data after them. In
practice, that removes the sample-chunk coins.

**It counts as look 1 of A1.5.** It replaces the backfill-week look. The unfilled days,
2026-09-18 … 2026-09-22, will not become a separate look.

**Operator-ordered deviations:**
1. The void rule (≥ 5 usable days, ≥ 100 fills) is overridden.
2. The look includes live coins created 2026-09-25 10:13Z … 13:48Z, which belong to the A1.5
   look-2 window.
3. The decision bootstrap changes, because about 2 days make day blocks meaningless. It is
   the **1-hour-block** bootstrap over UTC signal hours, 10,000 resamples, seed 27. Coin-level
   (i.i.d.) and day-block bootstraps are reported alongside.

**Decision rule, otherwise as frozen in A1.5 for look 1:**
- **KILL** if the 97.5th percentile < 0.
- **PASS-1** if mean > 0 and the 2.5th percentile > 0.
- Otherwise **CONTINUE**.
- One-sided α = 0.025.

**Look 2 changes accordingly,** so the two looks stay on disjoint data and within the
Bonferroni α budget: it covers coins created in **[2026-09-25 13:48:31Z, 2026-10-23 00:00Z)**.
Its rules and dates are otherwise as in A1.5.

**Nothing else changes.** C1's frozen definition, erratum A1.1 and the code freeze all stand.

### Amendment A1.3 (2026-09-25): result record for C1, look 1 run under A1.2

- **Decision: KILL.** Under A1.5 this ends C1. The C1 variant is excluded from validation, and
  look 2 will be reported descriptively only.
- **Numbers.** Primary setting (L = 2 s, pessimistic, insert-and-replay, 0.1 SOL), coins created
  2026-09-23 04:22Z … 2026-09-25 13:48Z:
  - n = 3,480 fills over 46 signal hours;
  - mean −2.99 %, 1-hour-block 95 % CI [−3.55 %, −2.45 %] (97.5th percentile < 0);
  - coin-level CI [−3.40 %, −2.54 %];
  - median −3.32 %, win rate 5.0 %.
- **Details:** `results/collected-data-2d.md`.
- **Frozen code:** matches `results/raw/c1-code-freeze.sha256` (re-verified before the run).
