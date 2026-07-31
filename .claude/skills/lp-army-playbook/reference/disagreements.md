# Open disagreements between instructors

Points where the bootcamps contradict themselves. Do not quote either side
as settled. Two of these were RESOLVED by our own measurement — see the
notes below.

- Dynamic fee semantics: 6 sessions describe the trader's fee as base fee PLUS a dynamic component stacked on top (2% base + 2.5% dynamic = +0.5pp); 2 sessions state flatly that they are never added — the displayed dynamic fee IS the all-in rate and the base fee is only its floor. This changes expected income materially.
- Liquidity-slippage setting: heavy metal cook 4–5% in one session and ≤1.5% (2% max) in another; Chief 15%; Alex 15%; a fourth instructor 20% and up to 50% for memecoins; 30% used live on a quiet token; Goa insists 10–15% is required on new extremely volatile coins; another session says 10–15% vs a 1% default. Range of stated values: 1.5% to 50%.
- Pool creation cost: 0.03 SOL (stated in two sessions) versus 3 SOL (stated by one instructor on air, immediately contradicted by his co-host with 0.03, left unresolved).
- 100-bin-step / 2%-base-fee config for large caps: Mario recommends it as the workhorse for established memes; Goa says it is ineffective above roughly 100,000,000 market cap and blames LP inertia there for poor volume and fees across Meteora.
- Holder-concentration red line: 3% (one instructor's personal ceiling), ~4% (another, at meme market caps), 5% (enough to damage price in one trade), 20% (single wallet or bundle = scare off), 40% (position-wrecking cluster). No agreed number.
- Whether to pre-compute impermanent loss: one instructor says use spreadsheet/charting tools that plot IL against price for a given bin step and bin count; the other says it is not worth the time and you should just open the position and observe.
- Trusting 24h fee/TVL: the lead instructor discounts the ratio entirely in favour of absolute 24h fees plus raw volume; another says it is broadly reliable in deep pools like JUP/SOL majors but should be ignored in thin meme pools; a third uses it as a legitimate first screen with cross-checks.
- Tighter bin step: 5 sessions argue smaller bin step captures more volume and more dynamic fee and should be preferred where the 69-bin cap allows; 2 argue against it — bid-ask/curve shapes break across multiple positions in tight pools, and one instructor rejects 20 bin step as too tight and avoids 1 bin step entirely because it demands constant monitoring.
- Spot+curve on SOL/USDC: some LPs run the stack on the USDC-per-SOL pair; the lead instructor states he is not a fan and notes others go straight spot or straight bid-ask.
- Meteora protocol fee on DLMM: 4 sessions say 0% on essentially all pools (non-zero only on token launches / Alpha Vaults); 1 session says it is 5% of the dynamic fee.
- Meteora out-of-range notifications: 6 sessions say they fire only when a position goes OUT of range (and never say whether price broke above or below, nor when it returns); 1 session says they alert both out of range and back into range.
- Position rent figure: 0.05 SOL in most sessions, 0.056 SOL in one (7 positions = 0.395 SOL), 0.06 SOL in the Spanish session demo, 0.11 SOL quoted for two positions.
- 100-bin-step / 1%-base-fee dynamic-fee ceiling: the instructor first said 1.85% on air, then corrected himself to 2.6–2.65%. Similarly, the 100-bin/2% ceiling was given first as 3.68% and later restated as 3.65%.
- Bin-step multiplier for bin step 1: correctly ×1.0001, but one instructor spoke it as 1.001 — flagged in-session as a misstatement.
- One-sided vs two-sided entry: several instructors default to one-sided almost exclusively and warn that buying the token first compounds losses; live demos nonetheless used 50/50 and 75%-token / 25%-SOL splits when they expected a rebound.

## Resolved by measurement on our pools (2026-07-28)

- **Item 1, base + dynamic fee semantics — RESOLVED.** The mechanism is
  additive (`total = base + variable`) and the displayed number is the
  total. Both camps described the same thing from different ends. See
  SKILL.md section 2 for the verified formula and readings.
- **Item 13, per-config dynamic-fee ceilings — NOT APPLICABLE to us.** The
  variable fee scales with the SQUARE of bin step, so ceilings measured on
  bin steps 100-250 say nothing about bin steps 4 and 10. Our measured
  ceilings: 5.32x base on bin step 4, 5.90x base on bin step 10, with the
  live component at zero in normal conditions.
