# Numeric index — every concrete threshold worth keeping

Reference only. Numbers measured on OUR pools live in SKILL.md section 1
and take precedence where they overlap. Most figures below come from
memecoin pools with bin steps 100-400 and do not transfer to bin step 4/10.

- Total fee on every Meteora DLMM pool is hard-capped at 10% (base + dynamic), no exceptions, all configs
- Maximum selectable base fee = 5%; maximum bin step = 400; base fee is immutable after pool creation
- 69 bins maximum per DLMM position (Solana account limit); 138 bins = 2 positions, 139 bins → 3, 116-bin request → 2, 442 bins → 7 positions
- Bin step formula: next bin price = current × (1 + binStep/10000); bin step 1 → ×1.0001, 50 → ×1.005, 200 → ×1.02; worked example 0.01231 → 0.01237
- Basis-point reference: 1 bp = 0.01%, 100 bp = 1%, 10,000 bp = 100%; bin step 50 = 0.5% per bin
- Range per position by bin step: bin step 20 → ~17%; bin step 100 → 40–49%; bin step 250 → 81% price drop; bin step 20 covers 2.5x less range than bin step 50
- Per-config dynamic-fee ceilings: 250-bin/5% → ~10%; 200-bin/2% → 8.75%; 125-bin/5% → 7.68%; 100-bin/2% → 3.65–3.68%; 100-bin/1% → 2.6–2.65% (first misquoted as 1.85%)
- Dynamic fee as a multiple of base: 2% pool peaks ~+80% over base; 1% pool peaks ~2.5x base
- Memecoin config lifecycle: 250-bin/5% for the first 30–60 minutes → 200-bin/2% after ~2 hours or 125-bin/5% → 100-bin/2% at 6–8 hours of token age → 1% pools after ~12 hours
- Fee-tier rotation trigger: 5% pool healthy when dynamic ≥6% (7%+ strong), 5.11% = dead; 2% pool typically ~3.6%, rotate to 1% when it decays to 2.0%
- Position rent ≈0.05 SOL per position, fully refundable (variants quoted: 0.056 SOL, 7 positions = 0.395 SOL, 0.06 SOL, 0.11 SOL for two)
- Bin-array rent = 0.07 SOL per array, NEVER refundable (4 arrays quoted at 0.282 SOL); a fresh pool needs 2 arrays = 0.14 SOL
- First position in a pristine pool: ~0.197 SOL total = 0.05 refundable + 0.14 non-refundable; common complaint is paying 0.2 SOL and recovering 0.05 SOL
- Pool creation cost: 0.03 SOL, never refunded (one instructor said 3 SOL; unresolved on air)
- Bin-array blow-ups: bin step 1 at -10%/+10% → 30 positions, ~2,000 bins, 23 new arrays; 2 USDlower bound → 6,932 bins / 101 positions; -99% range → 52 positions ≈3 SOL burned; UI double-charge bug cost ~2–3 SOL, workaround is widening 1–2 bins
- MET points: 1 point per 1 USDof TVL per day (out-of-range TVL still counts), 1,000 points per 1 USDof fees per day; vaults, Alpha Vaults, farms and roles earn zero
- Meteora DLMM protocol fee = 0% on essentially all pools (one session says 5% of the dynamic fee); Dynamic-pool protocol fee = 0%
- Screen A: min fee 2%, 1-hour volume window, TVL 10,000–700,000, sort by volume
- Screen B: min TVL 100,000, max TVL 1,000,000, all fee tiers, sort by 1-hour volume
- Screen C ('Magical'): bin step 100–250, base fee 2%–5%, TVL 10,000–700,000, strict list only, sort by volume/TVL over 1 hour
- Screen D: base fee ≥2%, 6-hour volume window, minimum liquidity 10,000 USD; Screen E: base fee >2%, 6h volume >0, sort by 1h volume; Screen F: base fee 5%, 5-minute volume >0, sort by 5m volume
- Activity floor: 3 swaps per 5 minutes = bad; 15–20 trades per 5 minutes with proportionally more over 1 hour = worth considering
- Routing floors: >600 USD TVL needed for organic Jupiter routing; avoid pools under 3,000–4,000 USD TVL; seed a new Dynamic pool with at least 600 USD; new SOL/USDC pool needs ≥100,000 USD concentrated liquidity; a 730,000 TVL / 0.3% pool cannot be beaten by a new 0.2% pool; do not undercut a memecoin 100-bin/2% pool above 200,000–300,000 USD TVL
- Depth vs fee routing: 100 USD in a bin cannot fill a 300 USD (or 200 USD) trade; with 100 USDvs 1,000 USDof depth a 600 USDtrade goes to the deeper pool and a 10 USDtrade to the cheaper-fee pool; a bin holding ~158 USD absorbs a 150 USD swap with zero slippage but not a 300 USD one
- Volume/TVL worked pairs: 10,000 TVL → 700,000 volume (good) vs 230,000 → 400,000 (poor); 2,500,000 → 21,000,000 vs 5,000,000 → 4,000,000; ~34M USD volume on ~1.2M USD TVL (bin step 20, fee 2%); 108k USD fees / 300k USD TVL / 4M USD volume = 13x turnover; 148,000 TVL with 44,000 24h fees and ~8,000,000 volume; 200-bin-step pool with 232,000 USDTVL and only 1,000 USD–1,600 USDvolume = dead
- Bin step vs turnover: SOL/USDC bin step 1 / 1 bp ≈200,000 USDTVL doing ≈4,000,000 USDvolume vs bin step 20 / 20 bp with more TVL and equal volume; BONK 1,100,000 TVL / bin step 25 / 0.25% doing 2,600,000 volume vs bin step 8 / 0.05% with ~10x less TVL and nearly the same volume; JUP/SOL bin step 1 / 0.1%, TVL ≈59,000, volume >3,000,000, fee/TVL ≈67% (≈400 USD fees)
- Stable-pair settings: USDC/USDT bin step 1 / base fee 0.01% (1 bp) is where the volume is, ~3,000,000 USDTVL; 37 pools listed in one session, 28 in another; ranges used ±4 bps, 5-bin curve, 8 bins, 10-bin curve; Dynamic-pool amp 8,000 and virtual price must be >1
- Holder concentration: >20% in one wallet/bundle = red flag; ~40% cluster = position-wrecking; personal ceilings 3%, ~4%, 5%; rejected at 91% single holder, top-10 at 71%, top holders 18%; accepted at top holder 2% / 2.9%, second 1.75%, top-10 11% and 11.89%, 15,000 and 26,000 holders
- Market-cap thresholds: cluster analysis matters most below ~5,000,000 mcap; ~1,000 traders or ~2,000 holders too few for indicator averages; >100,000,000 mcap disputed for 100-bin/2%; 26,000 holders with 36,900,000 USDof 24h volume cited as strong
- RSI lines at 70 / 50 / 30 — do not buy above 70, consider buying below 30, ~50 means flat sideways
- Liquidity slippage by instructor: 1.5% (2% max), 4–5%, 10–15%, 15%, 15%, 20%, 30% live, up to 50% for memecoins; Meteora default 1%; swap slippage 0.1% pre-deposit, dynamic 3% cap (could be 1%), in-pool DLMM swap default 0.5%
- Priority fees: 0.00001 SOL floor that reliably lands; ~0.0001 on Jupiter; max cap 0.003 SOL; escalation ladder 0.0022 USD→ 0.02 USD→ 0.11 USD; 0.0000031 SOL observed untuned; never cap at 1 SOL (~200 USDper transaction)
- Position sizing: ~3% of the dedicated LP wallet per position; first memecoin LP 0.1–0.2 SOL; cut at 20% loss; expect to lose >50% of the time; UI reserves at least 0.05 SOL of gas
- Fee-target ladder for scaling up: 20 USD/day → 50 USD/day sustained ~1 week → 100 USD/day, stepping back down on failure
- Stop/take-profit: stop ≈ -30% under a ~25%-wide range; take profit 5–10% above the upper bound; live example stop 0.145 = ~8% downside vs ~30% upside; alerts placed at 0.137, 0.0013 and ~0.0093
- Range asymmetry: +5% up / -33% down; +7% up (max 0.005404) / -30% down; allocation 20% above price / 80% below covering 10–15% upside and 50% downside; lower bound 17–20% below spot for a ~20% swing over ~8 hours; 43% below current price; SOL/USDC ranges 116–132 (thin 122–124) and 216 → 132 with SOL accumulated ≤119 vs a spot entry at 123
- Bid-ask vs spot on a downside breach: bid-ask loses ~25% where spot loses ~50%; 10 SOL into a downward bid-ask puts ~7–8 SOL in the bottom region
- Shape splits used live: 50/50 spot+bid-ask (0.1 + 0.1 SOL of 0.2, also 0.05 + 0.05); 1/3 spot + 2/3 bid-ask (1 SOL + 2 SOL of 3); 0.3 SOL spot + ~0.6 SOL bid-ask of ~0.9; entry allocation 75% token / 25% SOL of 0.5 SOL; alternatives cited 25/75 and 30/60
- Concentration arithmetic: 1 SOL over ~5 bins = 0.2 SOL per bin vs 2 SOL spread wide = 0.016 SOL per bin
- Meme bin-step guidance 25–80 short-term, 80–125 longer-term; JLP mechanics 75% of perp fees, ~47% SOL / ~26% USDC weights, 89.58%–~100% APY; Solana inflation 6.8%/yr with jitoSOL/SOL ≈1.16; Meteora Vaults ~9% APY rebalanced every 1 minute; depth benchmarks 23,000,000 USD TVL needs 1–5 million USD to move price, ~50,000 USD TVL moves on high-hundreds, ~10,000 USD TVL moves on a few hundred