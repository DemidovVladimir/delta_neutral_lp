# "Robinhood wallet" and Twitter/social signals: research notes

Date: 2026-09-25. Context: memecoin trading-pattern campaign on Solana, operator bankroll about 430 USD.
Author: research sub-agent (read-only; no transactions; the wallet key was never touched).

Labels used throughout:
- **MEASURED**: computed here from raw data saved in `robinhood-and-social-data/`. The fetch/analysis scripts are in `robinhood-and-social-data/scripts/`.
- **CLAIMED**: stated by a primary or secondary source (URL given). Not independently verified.
- **FROM MEMORY**: prior knowledge that was not verified in this session.
- **INFERENCE**: my interpretation of measured facts.

Budget used: 403 Helius RPC calls (`getTransactionsForAddress`, about 10 credits each), plus free public APIs (Binance klines, GeckoTerminal, DexScreener, Google News RSS, t.me/s previews, arXiv API). WebSearch had no budget left (200/200), and DuckDuckGo HTML returned a CAPTCHA. Search went through Google News RSS instead, with a decoder for its redirect links.

---

## TL;DR

1. **"Robinhood wallet" is not one famous trader wallet.** No KOL called "Robinhood" appears in kolscan's 531-wallet KOL list or in Lookonchain's feed (MEASURED). In Aug–Sep 2026 the phrase covers one connected story:
   - **Robinhood Chain**: an Arbitrum-Orbit L2 whose public mainnet launched 2026-07-01. It became a memecoin casino (CASHCAT, PONS, MEME and stock-paired memes), and on 2026-09-05 it passed Solana in daily DEX volume (1.45B vs 1.25B USD) (CLAIMED).
   - **Robinhood Wallet**: the self-custody app. It gives free gas on Robinhood Chain until **2026-09-29** and lets users buy memecoins by credit card through Crossmint with no KYC (CLAIMED).
   - **The `$WALLET` token, whose on-chain name is literally "Robinhood Wallet"**: contract `0x0339f5459FC690aC85F1782e15782A151b4A9E1b` on Robinhood Chain. Its story was that the deployer was linked to Robinhood or to Vlad Tenev's wallets. When Robinhood disclaimed it on 2026-09-17, the price fell **-80% in 7 minutes** (MEASURED).
   - **The "Robinhood insider" wallets**: on 2026-09-15 the DOJ charged two Robinhood listing engineers with trading Hyperliquid perps ahead of Robinhood listings (CLAIMED). The addresses are not public.
2. **Is there a tradeable edge from "Robinhood"? Not for a latecomer.** The Robinhood-app listing pop is real but lasts minutes (MEASURED):
   - On 6 CEX memecoin listings, the first minute moved +3% to +13% (median +6.7%) and the 10-minute high was median +14.6%.
   - Buying 1 minute after the pop returned median **-3.1% to 1 h** (5 of 6 negative) and about 0% to 24 h, before costs.
   - CASHCAT (Robinhood Chain DEX, 2026-08-06): +47.6% in the first minute, but a buyer 1 minute late was **-15.9% at 1 h and -38.7% at 24 h**.
   - The money was made **before** the announcement: CASHCAT ran +106% in the 36 h beforehand, while Bubblemaps flagged a cluster of new wallets that bought 2.7M USD (price MEASURED, cluster CLAIMED).
3. **Copying KOL wallets on pump.fun/PumpSwap loses money at every latency we tested** (MEASURED; 52 KOL first-buys, 19 kolscan KOLs, 2026-09-22 to 09-25):
   - Even the **very next slot** pays median **+12%** above the KOL's price. That is because copy bots pile in inside the KOL's own slot (median 2 co-buys; 75% of events have at least one).
   - Entering 2 s after the KOL (round trip 4% costs), median returns are -4.0% to 1 min, -11.8% to 5 min, -58% to 30 min and -63% to 2 h. Win rates fall from 40% to 8%.
   - KOLs start selling a median **115 s** after buying (65% within 5 min).
   - "Sell when the KOL sells" at +2 s: median -26%, win 23%.
4. **Social data we can realistically use** (details in section 5):
   - **Telegram public channels** via `t.me/s/<channel>`: free and working (MEASURED).
   - **Google News RSS** and **DexScreener boosts/profiles API**: free and working (MEASURED).
   - **kolscan KOL list**: free, 531 wallets with X handles (MEASURED).
   - **Our own Helius RPC** for on-chain KOL buys.
   - **X API**: now pay-per-use, 0.005 USD per post read, filtered stream P99 about 4–5 s (CLAIMED, docs.x.com). Monitoring even 30 accounts costs about 90 USD/month, about 21% of the bankroll per month.
   - **Dead or impractical**: Nitter/XCancel (dead, MEASURED); the Reddit JSON API from this host (403, MEASURED); LunarCrush (social endpoints from 90 USD/month); Kaito Yaps (shut after X's InfoFi ban).
5. **Hypothesis-list verdict:**
   - Kill "copy KOL wallets" in every tested form.
   - Keep KOL and Telegram activity only as a **negative filter**: do not buy what KOLs or shill channels just pumped.
   - One low-frequency forward test is worth considering: the Robinhood-listing go-live watcher (H-S5 below). It needs a ToS/legal check first.

---

## 1. What "Robinhood wallet" actually is: evidence per candidate

| Candidate | Verdict | Evidence |
|---|---|---|
| (a) A famous trader/KOL wallet nicknamed "Robinhood" | **Not found** | MEASURED: kolscan's public page embeds 531 KOL wallets with names and X/Telegram handles (saved as `kolscan_all_kols_2026-09-25.json`). No name or handle contains "robin". Same result on kolscan's 1d/7d/30d leaderboards (142 rows). A Lookonchain Telegram search for "Robinhood" (t.me/s/lookonchainchannel?q=Robinhood) returns only CASHCAT early-buyer stories and one ARB/Robinhood thread. GMGN and Cielo could not be checked: GMGN is behind Cloudflare and blocked this host (MEASURED). |
| (b) Robinhood Wallet app / Robinhood exchange listing memecoins / "Robinhood listing pump" | **Yes, part of the buzz** | CLAIMED: The Block, 2026-09-01, [link](https://www.theblock.co/news/business/2026-09-01-buying-memecoins-with-credit-cards-on-robinhood-wallet-fomo-sidestep-card-network-crypto-rules-411911). Robinhood Wallet and the Fomo app let users buy memecoins by credit card via Crossmint (Apple/Google Pay), with **no KYC**, coded as MCC 5815 (digital goods). Token Checkout covers about 150 tokens, about 80% of 24h memecoin volume. Visa then moved to recode these purchases ([The Block, 2026-09-19](https://www.theblock.co/news/regulation/2026-09-19-visa-to-close-crossmint-memecoin-rewards-loophole-following-the-block-investigation-report-415866)). The Robinhood app listed CASHCAT on 2026-08-06 ([KuCoin/TechFlow](https://www.kucoin.com/news/flash/cashcat-listed-on-robinhood-surges-151-in-15-hours), [Yahoo/TheStreet](https://finance.yahoo.com/markets/crypto/articles/meme-coin-surges-77-robinhood-233128321.html)). On 2026-09-01 Tenev replied "👂" to a "Memecoins on Robinhood" post ([U.Today via TradingView](https://www.tradingview.com/news/u_today:fe2dc0dac094b:0-robinhood-ceo-teases-memecoins/)). US app lineup per that article: DOGE, SHIB, PEPE, BONK, WIF, FLOKI, POPCAT, MOODENG, PNUT, MEW, PENGU, TRUMP, and later CASHCAT. |
| (c) Robinhood Chain (Arbitrum-Orbit L2) and memecoins on it | **Yes, the core of the buzz** | CLAIMED: public mainnet 2026-07-01 ([Robinhood newsroom](https://robinhood.com/us/en/newsroom/robinhood-accelerates-global-expansion-robinhood-chain-mainnet-stock-tokens-agentic-trading/)). Memecoins took over within a week ([CoinDesk 2026-07-13](https://www.coindesk.com/tech/2026/07/13/robinhood-built-a-blockchain-for-tokenized-stocks-memecoins-took-over); [Galaxy Research 2026-07-30](https://www.galaxy.com/insights/research/robinhood-chain-launch-analysis-base-comparison-memecoins-distribution-thesis): memecoins were 79% of chain DEX volume at 2026-07-27). CASHCAT rose +1,100% in 24h after Tenev posted "works great for memes too" and followed the token ([CoinGape 2026-07-09](https://coingape.com/cashcat-memecoin-pumps-1100-after-robinhood-ceos-x-tweet/)). The Pump.fun app routes cross-chain trades into Robinhood Chain tokens ([The Defiant 2026-07-08](https://thedefiant.io/news/tokens/pump-fun-adds-trading-for-robinhood-chain-tokens-as-cashcat-meme-coin-frenzy-builds)). Robinhood Chain passed Solana in daily DEX volume on 2026-09-05, **1.45B vs 1.25B USD** ([Yellow 2026-09-07](https://yellow.com/news/robinhood-chain-flips-solana-dex-volume)). The PONS launchpad hit 5.95M USD/day in fees and PONS rose about 180x from its 2026-07-17 low ([Decrypt 2026-09-03](https://decrypt.co/377349/pons-robinhood-chain-meme-coin-token-factory)). Chain fees then fell 97% from the early-September peak (8M to 0.23M USD/day by 2026-09-16) while transactions fell only 32% ([CoinDesk 2026-09-19](https://www.coindesk.com/business/2026/09/19/robinhood-chain-fees-collapse-97-even-as-transactions-stay-near-record-highs)). The **90-day gas subsidy for Robinhood Wallet transactions ends 2026-09-29**, and only an estimated 1–2% of chain trading comes from the Robinhood app itself ([CryptoTicker 2026-09-17](https://cryptoticker.io/en/robinhood-chain-gas-subsidy-ends-memecoins/), citing crypto.news and Bloomingbit). |
| (c') **The `$WALLET` token, on-chain name "Robinhood Wallet"** | **Most literal match for the phrase** | See section 2.2. The narrative was that the deployer had ties to Robinhood infrastructure or Tenev's wallets. Robinhood Wallet disclaimed it and the price collapsed ([Crypto Briefing 2026-09-17](https://cryptobriefing.com/robinhood-wallet-token-crashes-90-percent/)). |
| (c'') "Robinhood insider wallets" (DOJ case) | **Yes, in the news since 2026-09-15** | CLAIMED: SDNY charged ex-Robinhood engineers Hefu Chai and Huaisong "Jerry" Xiang with commodities fraud and wire fraud. They allegedly traded **Hyperliquid perps** ahead of Robinhood listings (≥10 events each; tokens incl. MEW, MOODENG, ASTER, XPL, HYPE, ENA, AERO, SYRUP, RENDER, POPCAT). Prosecutors said "**tokens could become tradable on Robinhood as much as an hour before the public announcement**" ([CryptoSlate](https://cryptoslate.com/robinhood-engineers-face-up-to-30-years-over-50000-alleged-hyperliquid-profits/), [Cointelegraph via TradingView](https://www.tradingview.com/news/cointelegraph:4819626f2094b:0-us-charges-ex-robinhood-engineers-over-alleged-pre-listing-crypto-trades/), [TechStock²](https://ts2.tech/en/robinhood-engineers-charged-over-hyperliquid-trades-hood-faces-a-listing-control-test/)). Profit figures conflict between sources: ">50k USD each" (DOJ quote via CryptoSlate) vs ">1.13M combined" (Blockonomi). No wallet addresses appear in any coverage found. |
| (d) A bot/tool named Robinhood | **Not found** | Robinhood-Chain trading bots exist, but none is called Robinhood: `basedbot` ([CoinDesk](https://www.coindesk.com/tech/2026/07/13/robinhood-built-a-blockchain-for-tokenized-stocks-memecoins-took-over)), Maestro ([CryptoPotato 2026-07-17](https://cryptopotato.com/maestro-supports-robinhood-chain-the-fastest-trading-bot-on-the-new-l2/)), @ZappinTradeBot (advertised in the OnchainLens TG, MEASURED), and GMGN. |

**Conclusion (INFERENCE).** When people say "Robinhood wallet" in Aug–Sep 2026 they mean trading the Robinhood Chain memecoin boom through Robinhood Wallet or the Pump/GMGN/Fomo apps. The literal `$WALLET` "Robinhood Wallet" token and the DOJ insider-wallet story are part of the same noise. It is not a Solana wallet we could copy. The operational takeaways for us:
- (i) Liquidity rotated out of Solana. Robinhood Chain passed Solana in DEX volume, and Solana transactions were down 37% from their 2026-08-28 peak (CLAIMED, Yellow). The 2026-09-29 subsidy end is a scheduled regime event.
- (ii) "Brand-borrowed" tokens (CASHCAT, WALLET) carry a specific tail risk: a disclaimer or listing headline moves the price 50–90% within minutes.

---

## 2. Is there a measurable, tradeable pattern? (Part 1 measurements)

### 2.1 Robinhood-app listing pop: 6 CEX memecoin listings + CASHCAT (MEASURED)

**Method.**
- Data: Binance 1-minute klines, 2 days before to 4 days after each listing date (spot for WIF/PENGU/PNUT; USDT-M perp for POPCAT/MEW/MOODENG).
- Listing dates are CLAIMED by news:

| Token | Listing date | Source |
|---|---|---|
| WIF | 2024-11-25 | [DL News](https://www.dlnews.com/articles/markets/robinhood-lists-memecoin-as-worries-mount-about-dark-side/) |
| PENGU, PNUT, POPCAT | 2025-03-13 | [Cointelegraph](https://www.tradingview.com/news/cointelegraph:2e3982f54094b:0-robinhood-lists-pengu-popcat-amid-crypto-ramp-up/) |
| MOODENG, MEW | 2025-05-22 | [CoinDesk](https://www.coindesk.com/markets/2025/05/22/memecoin-moo-deng-mew-surges-after-robinhood-listing) |

- Spike minute: the minute with the largest (1-min return × log volume multiple) within 36 h of the listing date. For all 6 memecoins it landed on the listing date with 53x–1184x volume (plausible announcement or go-live minute; exact tweet times not verified).
- CASHCAT: GeckoTerminal minute/hour OHLCV for pool `0xa70fc67c9f69da90b63a0e4c05d229954574e313` (CASHCAT/WETH, Uniswap v3, Robinhood Chain; token `0x020bfC650A365f8BB26819deAAbF3E21291018b4`).
- Returns are raw prices, before fees and not market-adjusted.

| Token | Spike minute (UTC) | Vol x median | Pre-24h run-up | 1st-minute move | 10-min high | Enter +1m → 1h | → 4h | → 24h | → 72h | Enter +60m → 24h |
|---|---|---|---|---|---|---|---|---|---|---|
| WIF | 2024-11-25 12:55 | 179x | +8.5% | +5.9% | +8.7% | -3.3% | -7.1% | -14.9% | -12.7% | -12.0% |
| PENGU | 2025-03-13 12:12 | 1184x | -1.4% | +7.6% | +20.3% | -5.3% | -0.7% | -1.7% | +4.3% | +3.8% |
| PNUT | 2025-03-13 12:12 | 235x | +2.7% | +6.4% | +14.8% | -2.8% | -1.6% | +6.1% | +11.9% | +9.1% |
| POPCAT (perp) | 2025-03-13 12:12 | 190x | +8.7% | +13.0% | +17.5% | -0.5% | +4.9% | +5.7% | +3.9% | +6.2% |
| MEW (perp) | 2025-05-22 20:11 | 928x | +9.3% | +6.9% | +14.4% | -4.3% | +0.5% | -3.1% | -10.0% | +1.3% |
| MOODENG (perp) | 2025-05-22 20:16 | 53x | +8.8% | +3.1% | +11.5% | +7.2% | +21.5% | +3.2% | -6.8% | -3.7% |
| **CASHCAT** (Robinhood Chain DEX) | **2026-08-06 12:41** | n/a | **+54.4%** (+106% from 2026-08-04 22:00) | **+47.6%** | **+56.0%** | **-15.9%** | **-35.2%** | **-38.7%** | **-34.8%** | **-27.1%** |

**Medians for the 6 CEX memecoins.**
- Pre-24h run-up: +8.6%.
- First minute: +6.65%.
- 10-min high: +14.6%.
- Latecomer +1 min → 1 h: **-3.05%** (5 of 6 negative).
- +1 min → 24 h: +0.75% (mean -0.8%).
- With about 0.5–1% round-trip cost on a CEX, or about 2–4% on-chain, **no latecomer edge**.

**Non-memecoin listings** (HYPE 2025-10-23, PYTH 2026-01-28, RENDER 2026-01-29, ZEC 2026-04-23, VIRTUAL 2026-09-07): the detector found no clear spike (best 1-min move ≈ +1%, volume multiple 18–69x). This fits the CLAIMED view "Robinhood listings didn't really move the price except maybe for something like CASHCAT" (Mikko Ohtamaa, quoted in [Cryptonews](https://cryptonews.net/news/market/33453685/)). Treat these as inconclusive, since the detector may have missed the minute.

**CASHCAT minute path (MEASURED, GeckoTerminal).**
- 12:40 close 0.1374 USD.
- 12:41 open 0.1374, high **0.2143**, close 0.2028 (2.34M USD volume in that minute).
- 12:42 close 0.1819, 12:45 close 0.1639, 13:10 close 0.1478.
- 24 h later about 0.111.

The CLAIMED "+151% in 15 hours" headline ([KuCoin/TechFlow](https://www.kucoin.com/news/flash/cashcat-listed-on-robinhood-surges-151-in-15-hours)) is measured from the pre-announcement low (0.085), so most of it happened **before** the announcement. The same source says Bubblemaps saw "a cluster of new wallets purchased 2.7 million USD in CASHCAT the previous night". MEASURED: the 2026-08-04 23:00 UTC hourly candle had 2.78M USD volume and +20%.

**Takeaway (INFERENCE).** The listing effect belongs to whoever holds before the announcement: insiders (see the DOJ case), anticipators, or sub-second news bots. A human, or a bot that reacts after about 1 minute, buys the top.

### 2.2 `$WALLET` ("Robinhood Wallet") token: brand-disclaimer crash (MEASURED)

- **Token and pool.** Token `0x0339f5459FC690aC85F1782e15782A151b4A9E1b`; pool `0x9501A20Bedb8beA0798FE5D4c411f5e270965D49` (WALLET/WETH 1%, Uniswap, Robinhood Chain, created 2026-07-10T01:02:04Z). Supply 1e9, so price × 1e9 = FDV.
- **Run-up.** Daily close 0.0075 USD on 2026-09-01 (FDV about 7.5M) to a high of 0.0768 on 2026-09-13 (FDV about 77M).
- **Crash on 2026-09-17 (UTC).** 14:00–16:59 rally from 0.0553 to 0.0880. The crash starts at **17:33**: 17:32 close 0.0820, 17:39 close **0.0165 (-80% in 7 minutes)**. The 18:00-hour low was 0.0032 (-96%), and the day's volume was 20.4M USD.
- **Recovery.** 0.0258 on 2026-09-25 (FDV about 25M).
- **CLAIMED trigger.** A public Robinhood Wallet disclaimer that it does not endorse third-party tokens ([Crypto Briefing](https://cryptobriefing.com/robinhood-wallet-token-crashes-90-percent/)). The exact disclaimer timestamp was not verified.
- **Tradeable? Not as an entry signal** (INFERENCE). It is a risk rule: any position whose thesis is an unconfirmed brand affiliation can lose 80% before a human reacts.

### 2.3 Robinhood public currency-pairs endpoint: is there a pre-announcement signal? (MEASURED, one read-only GET)

`https://nummus.robinhood.com/currency_pairs/` is public and needs no auth. On 2026-09-25 it returned **429 pairs: 90 `tradable`, 339 `display_only`/`untradable`**. The display-only set includes Solana memes such as ANSEM, FARTCOIN, SPX, GOAT, AI16Z, BOME, MELANIA, PONKE, GIGA, GRIFFAIN, pippin, jellyjelly and swarms, plus PONS.

Two Wayback snapshots (2026-04-06 and 2026-07-11, saved) test whether `display_only` predicts listings:
- Only **3 of the 338** assets that were display-only on 2026-07-11 became tradable by 2026-09-25 (MORPHO, INJ, FET).
- CASHCAT and BILL were **absent** on 2026-07-11 and then listed (2026-08-06 and 2026-07-24).

So display-only status is not a useful leading indicator: the base rate is about 1% over 2.5 months. The only potentially useful moment is the real-time flip `untradable → tradable`. The DOJ complaint says tradability can precede the announcement by up to 1 h (CLAIMED). That becomes hypothesis H-S5 below. It is untestable historically with 2 snapshots, and ToS/legal review is needed before any automated polling.

---

## 3. Part 2(b): KOL wallet-follow measurement (MEASURED)

### 3.1 Method
- **KOL universe.** kolscan.io 7-day leaderboard, fetched 2026-09-25, top 20 by profit with 10–1500 trades, plus Cented and Cupsey added manually. kolscan is owned by Pump.fun since July 2025 ([Blockworks](https://blockworks.com/news/pump-fun-kolscan)). 3 wallets had no own trades in their last 300 transactions and were dropped, leaving **19 KOLs**. This is a **survivorship-biased** list: they were winners in the prior 7 days.
- **KOL trades.** Helius `getTransactionsForAddress`, up to 300 most recent successful transactions per wallet, using the `tokenTransfer` filter.
  - Without that filter, 100 of 100 transactions referencing Cented's wallet came in 77 s from a third-party program `DhpyNWkdxFh3DRPsBrwRwrK3TYC5t7Q4arnSvf3t84HY`. INFERENCE: watcher or copy-trade infrastructure reading KOL wallets.
  - A KOL trade is a transaction **signed by the KOL** with a net SOL change of the opposite sign to a single non-quote token change.
  - 1,525 trades parsed. Venues: pump.fun 537, PumpSwap 448, Raydium LaunchLab 265, Raydium CPMM 193, other 82.
- **Events.** The KOL's first buy of a mint inside the fetched window, at least 2h10m before now. There were 265 candidates (pump.fun/PumpSwap 184). A stratified sample of ≤3 per KOL gives **55 events, of which 52 were parsed** (pump.fun 33, PumpSwap 19). KOL buy t0 runs from 2026-09-22 18:50 to 2026-09-25 08:45 UTC. Median KOL buy is 3.0 SOL.
- **Price path.** For each event, all successful transactions touching the mint are pulled, starting at the KOL's slot (up to 100 transactions), plus transactions at/after t0+60 s, +300 s, +1800 s and +7200 s, and at the KOL's first-sell time.
  - Price = **pool-side** quote delta / token delta of the pool owner in each swap. For the pump.fun bonding curve this is SOL lamports / token ATA. This excludes the trader's own fees.
  - "Price at time T" = median of the first 3 swaps at/after T. If nothing trades after T, it is the last price before T.
  - Only swaps with the same quote asset as the KOL's trade are used.
- **Follower entries.** Next slot after the KOL's transaction (about 0.4 s), then +2 s, +10 s and +60 s.
- **Exits.** Fixed horizons of 1, 5, 30 and 120 min, or "mirror": exit at the KOL's first sell plus the same latency.
- **Costs.** Round trip 4% (pump.fun 1.25%/side + about 0.75%/side slippage + priority fees) and 5%. GMGN/Axiom-style terminals add about 1%/side more (CLAIMED: GMGN "standard 1% fee per transaction", [Coin Edition](https://coinedition.com/gmgn-ais-copy-trading-is-booming-why-are-retail-traders-chasing-whales/)).
- **Quote assets.** 19 of 52 events (37%) were **not SOL-quoted** (MEASURED). Pools were paired with Xs-prefixed tokenized equities (likely xStocks, FROM MEMORY), PUMP, CARDS, USDC or another memecoin; returns for those are in quote units. Full quote mints:
  - `So11111111111111111111111111111111111111112` ×33
  - `CARDSccUMFKoPRZxt5vt3ksUbxEFEcnZ3H2pd3dKxYjp` ×2
  - `TTWofwAge91oFhZs7kpQdyrVRkmevgM88xijGvQFbKo` ×2
  - `Xsa62P5mvPszXL1krVUnU5ar38bBSVcWAB6fmPCo5Zu` ×2
  - `Xsv9hRk1z5ystj9MhnA7Lq4vjSsLwzL2nxrwmwtD3re` ×2
  - `pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn` ×2
  - `9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump` ×2
  - `BABANGA4JE7Kkam4nTrALAwAVgsNJUuFJnnkF7S16BZp`
  - `SPCXxcqXj6e5dJDVNovHN8744zkbhM2bYudU45BimGb`
  - `4Zp52aF4hZi9fzH19xpbWKYKQvgLyCN67KFbrQDqeTKh`
  - `XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp`
  - `Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh`
  - `XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN`
  - `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`
- **Bootstrap CIs.** 2000 resamples, on the median unless stated.

### 3.2 Results: latency tax (follower entry price vs the KOL's pool price)

| Entry | Median | Mean | Follower pays more than KOL in | Median CI95 |
|---|---|---|---|---|
| Next slot (~0.4 s) | **+12.1%** | +21.4% | 98% of events | [+10.0, +18.2] |
| +2 s | +14.5% | +21.2% | 88% | [+9.7, +19.2] |
| +10 s | +12.3% | +20.4% | 83% | [+7.4, +23.0] |
| +60 s | +14.6% | +36.1% | 73% | [+5.4, +24.1] |

- **Same-slot competition.** Median 2 other buys land in the KOL's own slot after the KOL (max 16; ≥1 in 75% of events). Price moves **+10.4% (median) inside the KOL's slot**. SOL-quoted subset: 3 co-buys, 82% of events.
- **By venue.** Latency tax at +2 s is +18.6% on the pump.fun bonding curve and +6.8% on PumpSwap.

### 3.3 Results: follower P&L, fixed exits, 4% round trip (n = 52)

| Entry → exit | Median | Mean | Win rate |
|---|---|---|---|
| next slot → 1 min | -1.9% | +6.1% (mean CI95 [-6.3, +20.4]) | 44% |
| next slot → 5 min | -16.4% | -4.3% | 33% |
| next slot → 30 min | -56.0% | -10.6% | 10% |
| next slot → 120 min | -60.4% | -16.0% | 8% |
| +2 s → 1 min | -4.0% | +6.0% | 40% |
| **+2 s → 5 min** | **-11.8%** | **-4.5%** | **27%** |
| +2 s → 30 min | -58.1% | -9.9% | 12% |
| +2 s → 120 min | -63.2% | -15.3% | 8% |
| +10 s → 1 min | -3.0% | +6.6% | 40% |
| **+10 s → 5 min** | **-13.1%** | **-5.2%** | **31%** |
| +10 s → 30 min | -57.1% | -8.3% | 12% |
| +10 s → 120 min | -60.0% | -13.9% | 8% |
| +60 s → 5 min | -11.4% | -17.0% | 23% |
| +60 s → 30 min | -57.9% | -33.4% | 10% |
| +60 s → 120 min | -61.7% | -37.8% | 8% |

- **At 5% round trip:** every median is about 1 pp worse. For example, +10 s → 1 min is median -4.0%, mean +5.5%, win 35%.
- **The positive 1-minute means are not an edge.** They come from 3 events (+83% to +208%), the mean's CI crosses zero, and medians are negative.
- **Tails (+2 s → 5 min, 4%):** p10 -74%, p25 -52%, p50 -10%, p75 +3%, p90 +52%, max +512%. 6 of 52 events exceed +50%; 14 of 52 fall below -50%.
- **SOL-quoted only (n = 33):** similar or worse. +2 s → 5 min median -27.1%, win 24%; +2 s → 30 min median -63.8%.
- **Other variants, all negative:**
  - Mirror exit (sell at the KOL's first sell + same latency, 4%): +2 s gives median **-26.3%**, win 23% (mean +5.1%, outlier-driven); +10 s gives -22.4% / 19%; +60 s gives -21.3% / 15%.
  - Even a zero-latency exit at the KOL's own first-sell price, with next-slot entry: median -12.8%, win 27%.
  - "KOL still holding at +5 min, then enter" (n = 18): to 30 min median -29.2%, win 17%. To 120 min -29.5%, win 22%.

### 3.4 Results: KOL behaviour ("sold into followers")

- **Speed of the first sell.** Within 1 min 25%; within 5 min **65%**; within 30 min 81%; within 2 h 85%. **Median 115 s** (p25 47 s, p75 322 s). 5 of 52 showed no sell from that wallet: still holding, or tokens moved elsewhere.
- **KOL's own mark-to-market from their entry:** 1 min +14.6% (median), 5 min +1.9%, 30 min -46.4%, 2 h -49.3%. The KOL's edge is being first and selling within minutes.
- **KOL realized P&L** on 45 fully exited events (SOL out ÷ SOL in - 1): median -2.8%, win 44%. The sum is +29.35 SOL, driven by a few winners. One artifact (0.004 SOL in, 1.34 SOL out) inflates the mean, so it is not quoted.
- **"Sold into followers."** Defined as: KOL's first sell within 30 min, at a price above the +10 s follower's entry, and the 2-hour mark below that entry. This held in **12 of 52 = 23%** (SOL-quoted subset: 7 of 33 = 21%).
- **Multi-KOL overlap.** 14 of 248 mints were bought by ≥2 of the 19 KOLs inside the windows (gap 16 s to 16 h; saved in `multi_kol_mints.json`). Not price-tested because of the RPC budget (hypothesis H-S3).

### 3.5 Caveats
- One ~2.5-day window in late September 2026 (a period of Solana liquidity rotating out to Robinhood Chain).
- Selected KOLs were recent winners (survivorship).
- "First buy in window" may be a re-entry, because windows are only hours long for active wallets.
- Pool-side prices ignore the follower's own price impact. With 0.5–5 SOL on bonding curves, real fills would be worse.
- Blocktimes have 1-second resolution; +2 s means blockTime ≥ t0+2.
- Non-SOL quotes add quote-asset drift, which is small over ≤2 h.
- None of these caveats plausibly flips a -12% median 5-minute result to positive.

### 3.6 Published evidence (CLAIMED; not re-verified)
- arXiv 2609.01176 (2026-09-01), "Don't You Know, Pump it Up!", [link](http://arxiv.org/abs/2609.01176v1). 14,499 public Telegram channels, more than 20M messages, 17,000 tokens. 47 P&D-consistent events; manipulative signals show extreme synchrony and **precede price moves by seconds**; P&D messages are linguistically indistinguishable from organic chat.
- arXiv 2504.15790, [link](http://arxiv.org/abs/2504.15790v1). 70% of pre-event volume trades within 1 h before the pump announcement. Insiders' median return is above 100%.
- arXiv 2309.06608, [link](http://arxiv.org/abs/2309.06608v1). Across 765 Telegram-pumped coins: short-term pop, then about **-30% relative price one year later**.
- arXiv 2607.02795 (2026-07-02), [link](http://arxiv.org/abs/2607.02795v3). 1,012 persistent sniper wallet rings on pump.fun (2,965 addresses). Coordination lifts first-30-min buyer count +16.1% but SOL inflow is not significantly different from zero. 7% of treated launches had zero outside buyers.
- arXiv 2609.10246 (2026-09-09), "Meme Coin Factories", [link](http://arxiv.org/abs/2609.10246v1). 15M pump.fun coins. Manipulation classes: wash trading, creator obfuscation, coordinated sells, copycats, social-media manipulation, plus "market-manipulation-as-a-service".
- arXiv 2606.08232, [link](http://arxiv.org/abs/2606.08232v3). A 190-trade autonomous memecoin bot on Solana: mean +0.62% per trade, but **removing the top 3 trades flips it unprofitable**.
- FOMO/Dune via [BigGo 2026-08-20](https://finance.biggo.com/news/cfad9098-b79e-48bb-bc08-7411c46821fc). 93.75% of 304,161 Solana memecoin traders lost money over 90 days (median -120 USD). Only 25 wallets realized more than 10k USD.
- Bubblemaps via [KuCoin/TechFlow](https://www.kucoin.com/news/flash/cashcat-listed-on-robinhood-surges-151-in-15-hours). 63% of 164,000 traders in the top 50 Robinhood Chain memes were at a loss.
- Influencer tweet effect example: ZCAT +230% in one session after an Ansem post, then "gave much of that back" ([Yellow 2026-09-07](https://yellow.com/news/robinhood-chain-flips-solana-dex-volume)).

---

## 4. Part 2(a): social/Twitter data sources in Sep 2026, access and cost

| Source | Status / access (how verified) | Cost | Latency / notes | Usable for us? |
|---|---|---|---|---|
| **X API v2, pay-per-use** | Live. Official docs [docs.x.com pricing](https://docs.x.com/x-api/getting-started/pricing) (CLAIMED, page fetched 2026-09-25). Pay-per-use replaced the 200 and 5,000 USD/month tiers on 2026-02-06 ([MediaNama](https://www.medianama.com/2026/02/223-x-developer-api-pricing-pay-per-use-model/), [GIGAZINE](https://gigazine.net/gsc_news/en/20260209-x-api-pay-per-use/)) | **Post read 0.005 USD**, user read 0.010, trends 0.010, post create 0.015 (0.20 with URL). Cap 3M post reads/month; 24h dedup; auto-recharge credits; ≥200 USD spend earns 10–20% xAI credits | **Filtered stream on pay-per-use: 1,000 rules, P99 about 4–5 s** (Powerstream lower latency is Enterprise) ([docs](https://docs.x.com/x-api/posts/filtered-stream/introduction.md)). Full-archive search available on pay-per-use | Technically yes. Economically marginal: 30 KOL accounts × 20 posts/day = 600 reads/day ≈ 3 USD/day ≈ **90 USD/month (21% of bankroll/month)**. A cashtag/contract-address firehose rule runs to hundreds of USD/month. Requires a developer account (operator sign-up). |
| X syndication timeline (`syndication.twitter.com/srv/timeline-profile/screen-name/<handle>`) | Responds, but returns only stale "top" tweets (latest Nov 2025 for @lookonchain) (MEASURED) | free | useless | No |
| **Nitter / XCancel** | **Dead.** xcancel.com shows "XCancel service is suspended. Unfortunately, due to a new development in the ongoing legal proceedings, we are required to suspend this service again until further notice." (MEASURED). nitter.net unreachable; other instances 403 or Anubis JS challenge (MEASURED). X C&D in Aug 2026, Nitter repo archived 2026-09-11 ([TechCrunch 2026-09-15](https://techcrunch.com/2026/09/15/nitter-and-xcancel-are-dead-again-after-xs-latest-legal-actions/)) | — | — | No |
| **Telegram public channels** `t.me/s/<channel>` (and `?q=` search) | **Works** (MEASURED: @lookonchainchannel posts minutes old; search works; also whale_alert_io, WatcherGuru, OnchainLens) | free | Polling: about 20 latest posts per request, so latency = poll interval. MTProto user API gives push delivery (free, needs a Telegram account; FROM MEMORY) | **Yes**, as a negative filter or narrative tracker. Too slow to front-run P&D (the arXiv study puts the lead at seconds). |
| Reddit | `search.json`: **403 "blocked by network security"** from this host (MEASURED). `.rss`: works but **429 after about 2 requests** (MEASURED). Official OAuth API needs a registered app (FROM MEMORY: free non-commercial tier about 100 QPM) | free with OAuth app | minutes | Low value for memecoin timing |
| **Google News RSS** (`news.google.com/rss/search?q=`) | **Works** (MEASURED; this whole report used it) | free | minutes to hours | Yes, for listing, regulation and exchange news, not micro-timing |
| LunarCrush API v4 | Live ([pricing](https://lunarcrush.com/pricing), [API docs](https://lunarcrush.com/developers/api/authentication), CLAIMED) | **Individual 90, Builder 300, Scale 900 USD/month**. Free "Hobby" = market-data endpoints only (4 req/min, 100/day); social/creator endpoints paid | aggregated social metrics | Too expensive for the bankroll, and too coarse for pump.fun |
| Kaito | **Yaps shut down** after X banned incentivized-posting apps and revoked API access, 2026-01-15 ([CoinDesk](https://www.coindesk.com/business/2026/01/15/kaito-to-sunset-yaps-as-x-cracks-down-on-infofi-apps-token-falls-17)). The Kaito API still exists per the company; pricing not public (pricing page 404, MEASURED) | unknown / enterprise | — | No |
| TweetScout | Now branded **"Sorsa"** (tweetscout.io serves the Sorsa site, MEASURED). Pricing not visible without JS/login | unknown | KOL scores, VC follows | Not evaluated |
| Santiment (SanAPI) | Live. Free tier has a **30-day lag**; real-time is paid ([pricing](https://app.santiment.net/pricing), CLAIMED) | paid for real-time | social volume, dev activity | No (lag, cost) |
| **kolscan.io** (Pump.fun-owned) | Public pages embed **531 KOL wallets + X/Telegram handles** and 1/7/30-day leaderboards (MEASURED, saved). The per-wallet trades API returns **403** to scripted POST (MEASURED), so we did not work around it | free | — | **Yes**: the KOL wallet list plus our own RPC |
| GMGN (KOL tags, copy trading) | Cloudflare-blocked from this host (MEASURED). API by application ([docs](https://docs.gmgn.ai/index/cooperation-api-integrate-gmgn-solana-trading-api), CLAIMED). 1% fee per trade (CLAIMED) | application | — | Not needed |
| **DexScreener API** (`/token-boosts/latest/v1`, `/token-profiles/latest/v1`, pairs/search) | **Works**, no key (MEASURED) | free | paid-promotion ("boost") events and new profiles are social-marketing proxies | **Yes**, as a feature or negative filter |
| **Helius** (`getTransactionsForAddress`, websockets/streams) | Our existing key. `getTransactionsForAddress` costs 10 credits per 100 full transactions (CLAIMED, Helius docs) | already paid | real-time possible | **Yes**: the backbone for on-chain KOL signals |
| pump.fun frontend API | responds 200 (MEASURED) | free | — | possible data source (unofficial) |

**On-chain proxy for KOL calls (MEASURED).** KOLs buy on-chain before or with their posts, and their buys are immediately crowded: copy bots trade in the same slot, and a third-party program referenced one KOL wallet 100 times in 77 s. So the "free Twitter substitute" (watch KOL wallets) exists and is cheap, **but the signal it carries is already priced within 1 slot**.

---

## 5. Signal definitions for the hypothesis list

| ID | Definition | Data | Status / numbers | Next step / kill criterion |
|---|---|---|---|---|
| **H-S1 Naive KOL copy** | Buy when any kolscan KOL buys a pump.fun/PumpSwap token; enter at +Δ (next slot, 2 s, 10 s, 60 s); exit at a fixed 1/5/30/120 min | Helius + kolscan list | **KILLED** (MEASURED, n = 52): median net return negative at every latency × horizon. Best cell is next slot → 1 min, median -1.9%, win 44%. | Do not build. |
| **H-S1b Mirror-exit copy** | Same entry; exit when the KOL first sells (+same latency) | same | **KILLED**: +2 s median -26%, win 23% | Do not build. |
| **H-S1c "KOL still holding" delayed entry** | Enter at t0+5 min only if the KOL has not sold | same | **KILLED**: to 30 min median -29%, win 17% (n = 18) | Do not build. |
| **H-S2 KOL-pump negative filter** | For any other memecoin strategy, veto entry if ≥1 tracked KOL bought the mint in the last 30 min and the price is ≥ +10% above that KOL's entry | Helius (1 call per candidate mint) + kolscan list | Supported by MEASURED data: the 30-min median from a +2 s entry is -58%. Cheap to add. | Backtest as a filter on the next strategy's candidate set. Kill if vetoed trades don't underperform non-vetoed ones by ≥10 pp at 30 min. |
| **H-S3 Multi-KOL cluster** | Trigger when ≥2 distinct KOLs buy the same mint within 10 min; enter 2 s after the 2nd buy; exit at 1–5 min | same | **UNTESTED**. 14 of 248 mints qualified in our windows (`multi_kol_mints.json`); about 6 per day across 19 KOLs | About 70 RPC calls to test on the saved list. Kill if the median at 5 min (4% cost) is below 0 or n < 30 after 2 weeks of collection. |
| **H-S4 Telegram/DexScreener shill veto** | Veto a mint if it appears in ≥3 public shill Telegram channels (t.me/s polling) or gets a DexScreener boost within the last 30 min | t.me/s, DexScreener API (free) | **UNTESTED**. Literature: P&D messages lead price by seconds (arXiv 2609.01176); 1-year drift about -30% (arXiv 2309.06608) | Build a channel list and log for 2 weeks. Negative filter only; never an entry trigger. |
| **H-S5 Robinhood listing go-live watcher** | Poll the public `nummus.robinhood.com/currency_pairs/` and detect a flip `untradable → tradable` for a Solana SPL memecoin; buy on-chain via Jupiter within seconds; exit at +10 to +60 min | public endpoint + Jupiter | **UNTESTED; low frequency.** Measured pop to beat: 1-min +3% to +13% (median +6.7%), 10-min high median +14.6%; CASHCAT +48% in 1 min. The DOJ complaint says tradability can precede the announcement by up to 1 h (CLAIMED). Base rate: 6 Solana-meme listings in about 10 months (2024-11 to 2025-05), plus CASHCAT | **Legal/ToS review first**: automated polling of Robinhood's endpoint may breach its ToS, and this is not MNPI only if the data is truly public. Then a forward-only log (no trading) of flip times vs announcement times. Kill if the flip does not lead the public announcement by ≥30 s in ≥3 of the first 5 events. |
| **H-S6 Brand-borrowed-narrative risk rule** | Do not hold, or hard-cap size on, tokens whose thesis is an unconfirmed affiliation with a company or brand (WALLET, CASHCAT-type) | manual/news | MEASURED: `$WALLET` -80% in 7 min on the disclaimer; CASHCAT listing latecomers -39% at 24 h | Risk rule; no test needed |
| **H-S7 Chain-rotation regime flag** | Regime feature: Robinhood Chain vs Solana launchpad volume share (Pons vs pump.fun), with 2026-09-29 (end of the Robinhood Wallet gas subsidy) as the scheduled breakpoint | DefiLlama/DexScreener (free) | CLAIMED: Robinhood Chain passed Solana DEX volume on 2026-09-05; pump.fun volume slid while Pons led from 2026-08-29 | Log daily from 2026-09-26. Use as context for pump.fun strategies (thin days mean worse fills), not as an entry signal. |
| **H-S8 X-API KOL post trigger** | Filtered stream on N KOL handles for contract addresses or cashtags; buy on post | X API pay-per-use | **Not recommended.** Cost about 90 USD/month for 30 accounts, and stream P99 about 4–5 s (CLAIMED). Our on-chain data shows the price is already +12% by the next slot after the KOL's own buy, which usually precedes the post (INFERENCE / FROM MEMORY) | Only revisit if H-S3 turns positive and needs a confirmation feature. |

---

## 6. Per-KOL wallets used (full addresses; kolscan names and X handles as published)

| KOL (kolscan name) | wallet | X | kolscan 7d profit (SOL) | used in study |
|---|---|---|---|---|
| LJC | 6HJetMbdHBuk3mLUainxAPpBpWzDgYbHGTS2TqDAUSX2 | https://x.com/OnlyLJC | 1260.7 | no (0 own trades in last 300 txs) |
| decu | 4vw54BmAogeRV3vPKWyFet5yf8DTLcREzdSzx4rw9Ud9 | https://x.com/notdecu | 977.7 | yes |
| Ducky | ADC1QV9raLnGGDbnWdnsxazeZ4Tsiho4vrWadYswA2ph | https://x.com/zXDuckyXz | 687.4 | yes |
| trunoest | ardinRsN1mNYVeoJWTBsWeYeXvuR9UUDGMsCDKpb6AT | https://x.com/trunoest | 684.9 | yes |
| theo | Bi4rd5FH5bYEN8scZ7wevxNZyNmKHdaBcvewdPFxYdLt | https://x.com/theonomix | 624.7 | yes |
| Flames | 6aXFYXbFob1ZKAEDCcqZnX2vooA3TgEqDoy5dAQbeWoV | https://x.com/FlamesOnSol | 526.6 | no (0 own trades in last 300 txs) |
| Kadenox | B32QbbdDAyhvUQzjcaM5j6ZVKwjCxAwGH5Xgvb9SJqnC | https://x.com/kadenox | 471.3 | yes |
| Matt | 3bzaJd5yZG73EVDz8xosQb7gfZm2LN5auFGh6wnP1n1f | https://x.com/MattFws | 419.4 | yes |
| Mr. Frog | 4DdrfiDHpmx55i4SPssxVzS9ZaKLb8qr45NKY9Er9nNh | https://x.com/TheMisterFrog | 415.5 | yes |
| OGAntD | 215nhcAHjQQGgwpQSJQ7zR26etbjjtVdW74NLzwEgQjP | https://x.com/0GAntD | 373.3 | yes |
| Orange | 2X4H5Y9C4Fy6Pf3wpq8Q4gMvLcWvfrrwDv2bdR8AAwQv | https://x.com/OrangeSBS | 334.0 | yes |
| Ethan Prosper | sAdNbe1cKNMDqDsa4npB3TfL62T14uAo2MsUQfLvzLT | https://x.com/pr6spr | 306.1 | yes |
| Schoen | 5hAgYC8TJCcEZV7LTXAzkTrm7YL29YXyQQJPCNrG84zM | https://x.com/Schoen_xyz | 296.8 | no (0 own trades in last 300 txs) |
| EustazZ | FqamE7xrahg7FEWoByrx1o8SeyHt44rpmE6ZQfT7zrve | https://x.com/Eustazzeus | 285.9 | yes |
| Megga | H31vEBxSJk1nQdUN11qZgZyhScyShhscKhvhZZU3dQoU | https://x.com/Megga | 282.3 | yes |
| Cooker | 8deJ9xeUvXSJwicYptA9mHsU2rN2pDx37KWzkDkEXhU6 | https://x.com/CookerFlips | 280.4 | yes |
| Pain | J6TDXvarvpBdPXTaTU8eJbtso1PUCYKGkVtMKUUY8iEa | https://x.com/PainCrypt0 | 273.6 | yes |
| Jijo | 4BdKaxN8G6ka4GYtQQWk4G4dZRUTX2vQH9GcXdBREFUk | https://x.com/jijo_exe | 221.9 | yes |
| Rilsio | 4fZFcK8ms3bFMpo1ACzEUz8bH741fQW4zhAMGd5yZMHu | https://x.com/CryptoRilsio | 217.4 | yes |
| Spuno | GfXQesPe3Zuwg8JhAt6Cg8euJDTVx751enp9EQQmhzPH | https://x.com/spunosounds | 215.4 | yes |
| Cented | CyaE1VxvBrahnPWkqm5VsdCvyS2QmNht2UFrKJHga54o | https://x.com/Cented7 | n/a (added manually) | yes |
| Cupsey | 2fg5QD1eD7rzNNCsvnhmXFm5hqNgwTTG8p7kQ6f3rx6f | https://x.com/Cupseyy | n/a (added manually) | yes |

---

## 7. Per-event results (52 parsed events; full mints; "net 4%" = after 4% round trip; "n/a" = no data)

| # | KOL | t0 (UTC) | mint | venue | quote | KOL buy (SOL) | same-slot co-buys | +2s entry vs KOL | +2s→5m net 4% | +2s→120m net 4% | KOL first sell after (s) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Ethan Prosper | 09-22 18:50:54 | Fdkt7feCyHLszA25h3JwG36whQ6FpdJuvSr9Hopypump | pumpfun | SOL | 3.149 | 8 | -59.3% | -65.2% | -65.2% | 3 |
| 2 | Ethan Prosper | 09-23 00:44:07 | 3myTmnz8aNNuqebrrB5DSJrkYLPGfibGRwnH54Bv4hUC | pumpswap | SOL | 4.654 | 3 | +4.2% | +142.5% | -45.1% | 322 |
| 3 | Ethan Prosper | 09-23 01:10:28 | 9Vwzaqweq31NevbfGa2Dj4TdvuYjQHquJRQQdbfKpump | pumpfun | SOL | 3.149 | 3 | +31.2% | -78.4% | -78.4% | 7 |
| 4 | Matt | 09-23 21:40:07 | 4n8gJ4yP8U2TVAzx8R4qhJjSZcT2VQrHA5bHtK1kpump | pumpswap | SOL | 0.004 | 0 | +5.9% | +11.4% | -17.6% | 119632 |
| 5 | Matt | 09-23 23:31:02 | HpWGRTs5x2pmWrGKpD5cXpZhja1uuXbPBqf7kYo2mz86 | pumpswap | Xsv9hRk1z5ystj9MhnA7Lq4vjSsLwzL2nxrwmwtD3re | 8.085 | 0 | +6.8% | +42.6% | -90.3% | 758 |
| 6 | Matt | 09-23 23:53:42 | 74sHNXtVDHZVw4ADktjGFHPzNycV8iHvfHLPp6QZPdT4 | pumpswap | Xsv9hRk1z5ystj9MhnA7Lq4vjSsLwzL2nxrwmwtD3re | 8.086 | 0 | +10.3% | -15.8% | -42.0% | 2906 |
| 7 | Rilsio | 09-24 10:51:37 | C8n9MWXRBp5YPcoHKQ11NXdMhwfDX3m21vuy5iVj29B4 | pumpfun | SOL | 2.023 | 4 | +18.6% | -51.8% | -59.2% | 74 |
| 8 | Orange | 09-24 15:07:39 | 9yDLr8oZh1KAMrmE1vG6f9zseLXpskzW75T2ndd8bWBT | pumpfun | TTWofwAge91oFhZs7kpQdyrVRkmevgM88xijGvQFbKo | 1.282 | 1 | +11.5% | -45.9% | -45.9% | 12 |
| 9 | Orange | 09-24 15:11:14 | Hs8JDjxT2gGzSXe6KtycDhKkFGBu7BHR71emwJz5pump | pumpswap | SOL | 5.062 | 2 | +8.9% | -34.8% | -55.1% | 19 |
| 10 | Orange | 09-24 15:11:55 | CeDVr5XcPvToeS4omaSTjMhjAqQ4XWvcaZMeNVs4okzF | pumpswap | TTWofwAge91oFhZs7kpQdyrVRkmevgM88xijGvQFbKo | 10.120 | 0 | +9.5% | -37.6% | -38.6% | 74 |
| 11 | Spuno | 09-24 15:28:35 | 6hoe2vgzjVDHKKKtiQcXpdLAorZLvxfW45pQBzQDK6mu | pumpswap | 4Zp52aF4hZi9fzH19xpbWKYKQvgLyCN67KFbrQDqeTKh | 1.021 | 0 | +2.3% | -2.9% | -29.1% | 413 |
| 12 | Ducky | 09-24 15:38:31 | FJACueGsBZ2T2oJ9CSx8j8EguELbDvkcERRnjh3Dpump | pumpswap | SOL | 4.819 | 1 | +21.3% | -81.3% | -79.8% | none in window |
| 13 | Spuno | 09-24 18:15:33 | 6TQBFXT7GKY2BZVATXHMFA5QfAUS7SxtdF1aEGnYNSV6 | pumpswap | Xsa62P5mvPszXL1krVUnU5ar38bBSVcWAB6fmPCo5Zu | 10.113 | 9 | +29.6% | -94.7% | -96.0% | 62 |
| 14 | Megga | 09-24 19:12:17 | 6aVMoRb5EkrQiPgwDBDPASSg9Q4mkJXmsnrHtgVLpump | pumpfun | Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh | 2.039 | 3 | +15.4% | -74.9% | -77.5% | 10 |
| 15 | EustazZ | 09-24 19:59:24 | 8Yo3h42DsNcCshEDiVCc1dQD77s6ixDq7VzG7k6SjyF | pumpfun | PUMP | 3.033 | 0 | +5.9% | -6.1% | -58.6% | 197 |
| 16 | OGAntD | 09-24 20:18:07 | CfEKLtLG6BDXZeY2YwL9EETK1PRTdpUhqJsy9X7CkzbQ | pumpswap | CARDSccUMFKoPRZxt5vt3ksUbxEFEcnZ3H2pd3dKxYjp | 0.543 | 0 | +1.6% | +3.0% | -43.8% | none in window |
| 17 | EustazZ | 09-24 20:33:20 | 5NKJkMLnTBwf91XLCvJPX1QebUdFiSTkP6PF9qYfpump | pumpfun | SOL | 1.518 | 4 | +20.4% | -6.1% | -62.5% | 120 |
| 18 | Megga | 09-24 21:08:32 | BQc9wM8EdJo6UjkSA3fxd78hRqBotW21qgYyUGJzNarM | pumpswap | XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN | 1.814 | 6 | +46.7% | -70.3% | -73.6% | 14 |
| 19 | Megga | 09-24 21:15:30 | 2fWLL96uGKSJCNMn3j2xTS4MxKGrpsk4MMYZeHwHRmNx | pumpfun | XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp | 0.987 | 0 | -27.6% | -42.4% | -40.1% | 17 |
| 20 | Cooker | 09-24 22:08:03 | BPPgBd2iYTifTR2eek9exH7fuPb2ymRjoyh77yfAaJLz | pumpfun | SOL | 5.051 | 2 | +12.4% | -0.3% | -26.3% | 855 |
| 21 | Jijo | 09-24 22:09:07 | 128URtzUayahSVEBLEFjLGeHdkqckfXfkWsaoxiPx8cS | pumpfun | BABANGA4JE7Kkam4nTrALAwAVgsNJUuFJnnkF7S16BZp | 2.031 | 2 | +59.6% | -2.9% | -72.4% | 1070 |
| 22 | EustazZ | 09-24 22:12:11 | 6cJUmCz9sp88PyL9CwqDfqzg2benGj47N9hDp4PCpump | pumpfun | SOL | 1.518 | 0 | +7.7% | +10.2% | -45.8% | 298 |
| 23 | Kadenox | 09-24 22:58:20 | CvUX4G2tzq7J3ECmNvWZLayZYV6KpgQp6SJ5K8Uvsu5g | pumpswap | SOL | 6.765 | 2 | +9.9% | -4.1% | -28.7% | 9657 |
| 24 | Kadenox | 09-24 23:23:35 | 5a1CvpaxMtXN3bnWERo5WUo34tdQKUGSrFWd5DW73Qsx | pumpfun | SOL | 1.254 | 3 | +21.3% | -37.4% | -80.6% | 65 |
| 25 | Cupsey | 09-24 23:26:58 | J7kYtuNan7TTLYg55yfQM7zjpC4WBymNC86MPQfJpump | pumpfun | SOL | 0.576 | 4 | +24.1% | -13.4% | -80.5% | 40 |
| 26 | Cupsey | 09-24 23:34:13 | BpjGVGLkZtYENJffLdBXPHZHcqQuReKaxH6yrEiVpump | pumpfun | SOL | 0.763 | 6 | +15.5% | -85.3% | -89.3% | 73 |
| 27 | Cupsey | 09-25 00:17:42 | 3PcHi48ANJ3UFtRunaWYj3LgEPKuRvgx7M2d2Yonpump | pumpfun | Xsa62P5mvPszXL1krVUnU5ar38bBSVcWAB6fmPCo5Zu | 1.393 | 2 | -2.0% | -44.4% | -80.5% | 480 |
| 28 | Kadenox | 09-25 00:58:46 | nDZknLvfFRp5rgUHdzTrQsmSY5NKzoavqdLjSHVpump | pumpfun | CARDSccUMFKoPRZxt5vt3ksUbxEFEcnZ3H2pd3dKxYjp | 1.720 | 1 | +9.5% | +511.9% | +1227.0% | 16896 |
| 29 | Mr. Frog | 09-25 01:20:57 | 5iqjhP5ig6JWdXQf6hYAwojZeMf11pTCvH87gCQtpump | pumpswap | SOL | 2.002 | 4 | +5.9% | +18.5% | +204.1% | 3870 |
| 30 | Cooker | 09-25 01:22:44 | CUh9nnRSojHHdLWzVQQ2rZBmnq66zLg8TfcuQUyy6BLr | pumpfun | SOL | 5.051 | 0 | +17.2% | -3.2% | -25.5% | 3 |
| 31 | theo | 09-25 01:38:02 | 97nWxgYRNoKVbeJPxWjEtRw6ubuY4Sfo7n3745dPyAxq | pumpfun | SOL | 3.033 | 3 | +19.8% | -8.4% | -74.5% | 226 |
| 32 | decu | 09-25 02:14:27 | 6sEfSA57vXerqm3cFmwQxa78rmBgRBR6pyEPJG74pump | pumpswap | SOL | 0.025 | 1 | -1.3% | -73.3% | -95.5% | 176 |
| 33 | Pain | 09-25 02:18:58 | yFcTuQJCMsd1Asya15GZ7h4KGdxsujRLcUiTWWXpump | pumpswap | SOL | 1.548 | 0 | +4.8% | +1.4% | +32.0% | none in window |
| 34 | Pain | 09-25 02:20:22 | BcHEaaTCvycPwwsJ9yQTXdHP9X2gCLkznDbZ8VySpump | pumpswap | USDC | 5.085 | 2 | +0.2% | -3.9% | -5.3% | none in window |
| 35 | decu | 09-25 02:22:37 | 2BXnAkkTguDycoXqJsDGu2wLRMCMo881i9ixUW5Tpump | pumpfun | 9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump | 0.025 | 1 | -6.2% | +239.1% | -67.5% | 209 |
| 36 | Mr. Frog | 09-25 02:37:16 | 9zZrncv1boUbosuBHQUXUAdVGJmMfne7kh3N7keZpump | pumpfun | SPCXxcqXj6e5dJDVNovHN8744zkbhM2bYudU45BimGb | 3.501 | 3 | +13.6% | -9.0% | -7.5% | 115 |
| 37 | Jijo | 09-25 02:40:28 | C61oA922BKGFkQMEE27QYkAd15NsRh9T6H462LYHk4DU | pumpswap | SOL | 7.074 | 11 | +15.5% | -10.3% | -89.8% | 303 |
| 38 | theo | 09-25 02:40:45 | C7f5wVEs7CUD7poM6UMBiQappDGRxALB1SxBbtiJedyf | pumpfun | SOL | 5.053 | 4 | +45.6% | -74.0% | -79.0% | 250 |
| 39 | OGAntD | 09-25 02:43:06 | C61oA922BKGFkQMEE27QYkAd15NsRh9T6H462LYHk4DU | pumpswap | SOL | 14.002 | 0 | +24.6% | -68.3% | -89.1% | 222 |
| 40 | decu | 09-25 02:48:01 | 12LNHtZHyjkz4rk8Gqf3J4yM8ip7aGi7EZMtvTrD3BbC | pumpfun | PUMP | 2.518 | 5 | +94.4% | +69.3% | -61.7% | 136 |
| 41 | theo | 09-25 03:05:51 | EKXTSJohVHDMW7XiYduFNJpKRcPcihRwGkMHYuGEb5vs | pumpfun | SOL | 3.033 | 2 | +30.0% | -63.9% | -63.9% | 103 |
| 42 | Cented | 09-25 03:08:52 | 4bC8X3gaQ4EZjnr5CPtZkCc2i4MGptf9XZvAMT8hHstm | pumpfun | 9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump | 3.015 | 1 | +12.3% | +126.2% | +613.1% | 137 |
| 43 | Mr. Frog | 09-25 03:45:34 | 9xTao3xZA7CvoXNgjqip7wRXScVsLosWSpthQXntpump | pumpfun | SOL | 3.503 | 3 | +19.2% | -27.2% | -27.7% | 21 |
| 44 | Pain | 09-25 03:52:24 | DqVnhbBBMViH7bQ2Vh8CSHm76ZzNyYXjFcd4afLhpump | pumpfun | SOL | 7.104 | 10 | +61.5% | +5.1% | -89.6% | 52 |
| 45 | Jijo | 09-25 04:02:25 | HLWSkL9Xe6DTnqXbUiuMXQs3Fbvf6GiWK9YDD3tjbRo4 | pumpfun | SOL | 0.864 | 16 | +163.1% | -27.1% | -66.4% | 80 |
| 46 | Cented | 09-25 04:15:34 | 7N8ocxwSB81EC7N4LtiegD1Q98X9QYTLSQMXWSzGG9Eq | pumpfun | SOL | 3.014 | 4 | +49.5% | -49.7% | -53.8% | 93 |
| 47 | Cented | 09-25 04:17:27 | GZM3BiFFaZwvHk4p5NFspHW5YeB3mfaPb4RRkjK24MNT | pumpfun | SOL | 5.013 | 6 | +11.9% | -28.0% | -82.1% | 62 |
| 48 | Spuno | 09-25 05:01:58 | 6Qj5jR8iLFr74FsMPsYDPjJLBa4HEyWruMNxY2dGpump | pumpfun | SOL | 5.062 | 0 | +17.8% | +52.5% | -87.1% | 47 |
| 49 | OGAntD | 09-25 05:26:15 | DX1SnAPCfV9ZDGmYguUXCAtSQ8pL3B7N4ak4cqjtpump | pumpswap | SOL | 15.190 | 3 | -8.4% | -4.0% | -4.0% | none in window |
| 50 | trunoest | 09-25 06:11:40 | AzxmpfpRxAGXSnD6Dr4c3oUXYeKAQKnbe6VyGKQCSWZZ | pumpfun | SOL | 1.516 | 1 | +85.6% | +8.2% | -69.5% | 360 |
| 51 | trunoest | 09-25 06:33:58 | 3VTjczygxWATJP7DNsYk3h9PTf99ASfjZqVsan6S9Lnc | pumpfun | SOL | 1.516 | 5 | +66.6% | -64.0% | -64.1% | 87 |
| 52 | trunoest | 09-25 08:45:24 | FmMCrsJzVgKtFZ9tdAn2uHTfPRamacE61MRY26dLpump | pumpfun | SOL | 2.017 | 3 | +39.7% | -63.7% | -63.8% | 10 |

Three sampled events could not be parsed because the KOL transaction was not recognised as a swap on the target mint: Rilsio `5Lkve8Hg3jXGT8ywEGCuc1uKHcLEHZhQncCvEeJypump`, Rilsio `5QqGPXyRBhbRFqEKpfVRMUkkL4kQht2jwV2y8kFpump`, Cooker `ENvX62woT8HUSPcsxh9VqgsbsotjquKSvyk6dfhPpump`.

---

## 8. Data files (`research/memecoins/notes/robinhood-and-social-data/`)

| File | Content |
|---|---|
| `kolscan_all_kols_2026-09-25.json` | 531 KOL wallets with names and X/Telegram links, embedded in public kolscan pages |
| `kolscan_leaderboard_2026-09-25.json` | kolscan 1/7/30-day leaderboards (142 rows: wallet, name, profit in SOL, wins/losses) |
| `selected.json` | the 20 leaderboard KOLs picked for the study (Cented and Cupsey added in code) |
| `kol_trades.json` | 1,525 parsed KOL buys/sells (full signature, slot, blockTime, mint, SOL delta, token delta, venue) |
| `events_all.json` | 265 candidate KOL first-buy events with the KOL's later buys/sells |
| `event_results.json` | the 55 sampled events with entries, exits, mirror exits and KOL behaviour (3 flagged as parse errors) |
| `kol_event_trade_series.json` | 7,544 pool-side trades (signature, slot, index, time, side, price, quote, pool, signer) behind every event |
| `kol_follow_stats_all.txt`, `kol_follow_stats_sol_quoted.txt` | the full stats printouts |
| `multi_kol_mints.json` | the 14 mints bought by ≥2 KOLs (input for H-S3) |
| `listing_klines/*.json.gz` | Binance 1m klines around 11 Robinhood listings |
| `robinhood_listing_results_binance.json` | per-listing metrics |
| `cashcat_h1.json`, `cashcat_m1.json`, `cashcat_listing_result.json` | CASHCAT GeckoTerminal OHLCV and metrics |
| `wallet_token_h1.json`, `wallet_token_m1_2026-09-17.json`, `wallet_token_pool_info.json` | `$WALLET` price data |
| `robinhood_nummus_currency_pairs_2026-09-25.json` + two `_wayback_` snapshots | Robinhood public currency-pairs endpoint |
| `sources/*.txt` | text of the fetched articles, for provenance |
| `scripts/` | fetch/parse/analysis code. `hel.py` reads `RPC_URL` from `.env` at runtime; no key is stored in any file |

**Reproduce the KOL study** (from the scratch dir with `scripts/`):
1. `python3 kol_fetch.py 3`
2. `python3 kol_parse.py`
3. Build `events_all.json` (inline snippet in the session; the logic is "first trade for (wallet, mint) is a buy, t0 ≤ now-2h10m").
4. `python3 ev_fetch.py pumpfun,pumpswap 3 420 7`
5. `python3 analyze.py`
6. `python3 stats.py all|sol`

RPC calls used: 403.

## 9. Key identifiers (verbatim)

**Robinhood Chain (EVM)**
- CASHCAT token: `0x020bfC650A365f8BB26819deAAbF3E21291018b4`
- CASHCAT/WETH pool: `0xA70fc67C9F69da90B63a0e4C05D229954574E313`
- `$WALLET` ("Robinhood Wallet") token: `0x0339f5459FC690aC85F1782e15782A151b4A9E1b`
- WALLET/WETH pool: `0x9501A20Bedb8beA0798FE5D4c411f5e270965D49`
- CASHCAT early-buyer wallets in Lookonchain posts (CLAIMED): `0xDE4C44e841972C2c4Db1b1E27a353340fE9899DE`, `0x4C9064c39d549dd09Fc9b49Af27ECB02942525A2`, `0xc0FdfEb9c4BF4C95C90063757b2Bd3e5ECbd3698`
- Largest PONS/CASHCAT short on Hyperliquid, @loraclexyz (CLAIMED): `0xefe4c06b6d310978bead596e1798a4fc1d9d194b`

**Solana**
- pump.fun: `6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P`
- PumpSwap: `pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA`
- Raydium LaunchLab: `LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj`
- Raydium CPMM: `CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C`
- Raydium CLMM: `CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK`
- Router used by several KOLs (unidentified terminal): `FLASHX8DrLbgeR8FcfNV1F5krxYcYMUdBkrP1EPBtxB9`
- pump fee program: `pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ`
- Third-party program referencing KOL wallets (INFERENCE: watcher/copy infrastructure): `DhpyNWkdxFh3DRPsBrwRwrK3TYC5t7Q4arnSvf3t84HY`

**Robinhood public endpoint:** `https://nummus.robinhood.com/currency_pairs/`
