# Memecoin trade collector (pump.fun + graduated PumpSwap pools) — v3

Data foundation for the research question *"can on-chain patterns in Solana memecoin
trading give a positive expected return after realistic costs?"* (protocol: `../PROTOCOL.md`,
≥ 60-day campaign on a home Mac). Collects, live, into SQLite:

* **every pump.fun bonding-curve trade** (all fee components, virtual + real reserves),
  every creation, curve completion and migration, and the other pump program events;
* **PumpSwap only for coins that graduate while we collect**: trade-level for the first
  minute after migration, then pool state (vault balances + BOOST virtual reserves) polled
  for 78 h (72 h max hold + 6 h entry offset);
* each new coin's metadata JSON, and the PumpPortal free feed as an independent cross-check.

Strictly read-only: no wallet, no transactions. The only thing read from the repo `.env` is the
`RPC_URL` line (Helius key, used for metered gap-fill / audits / verification / backfill under a
hard credit budget). `PRIVATE_KEY` is never read.

## Footprint (v3, measured — see "Validation v3" below)

| | v2 (all PumpSwap, getBlock) | **v3 (measured 12:59–13:31Z, a busy hour)** | target |
|---|---|---|---|
| Download (per-process, `nettop`) | ~6.5 GB/h | **0.99 GB/h** (pump socket 0.89, graduated-pool logs 0.16, polling/metadata/gap fills the rest; gzip on all HTTP) | ≤ ~1 GB/h |
| Disk | ~6.3 GB/day | **≈ 1.2 GB/day** (≈ 50 MB/h: trades 43 MB/h at 255 B/row, events 2.8, metadata 1.0, tokens 0.8, pool states 0.4, keys ≤ 2) | ≤ ~1.5 GB/day |
| Trade rows | 0.86 M/h | 0.15 M/h pump + ~15–24 k/h graduated-pool first minutes | |
| Helius credits (live) | — | est. 5–9 k/day (restart gaps ~200 each, late pool subscriptions 10 each, chain holes, audits, phantom tie-breaks); cap 25 k/day | ≤ 30 k/day total |

If pump.fun activity grows, the pump socket alone approaches 1 GB/h; the only remaining knob is
`--amm-logs-min` (0.5 saves ~70 MB/h).

## How it works

| Piece | Source | Cost |
|---|---|---|
| pump.fun trades + all pump program events | `logsSubscribe {mentions: [6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P]}`, commitment **confirmed**, on the free public websocket `wss://api.mainnet-beta.solana.com` | 0 credits; ~0.7–0.8 GB/h (2/3 of it failed bot txs — cannot be filtered server-side) |
| Graduated pools, trade level | the canonical pool address is a PDA of the mint (`["pool", 0u16, PDA("pool-authority", mint; pump), mint, WSOL]` on `pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA`); once a curve is ≥ ~85 % sold (real tokens ≤ 119 M) the future pool is **pre-subscribed** (`logsSubscribe mentions pool`), so the migration and the first trades are never missed; unsubscribed at migration + 1 min (`--amm-logs-min`) | 0 credits; ~6 MB per graduate |
| Graduated pools, state level | `getMultipleAccounts` (dataSlice) on the two vaults (amount at offset 64) and the Pool account (`virtual_quote_reserves`, i128 at offset 245): every 3 s for 15 min, 15 s to 6 h, 120 s to 78 h; a row in `pool_states` only when something changed | 0 credits; a few MB/h |
| Event decoding | Anchor events in `Program data:` logs, official IDLs in `../idl/` (github.com/pump-fun/pump-public-docs); accepted only when emitted by the pump / PumpSwap program itself (invoke-stack check) | — |
| Intra-slot order | `trades.seq` = per-coin order inside a slot, solved from the reserve chain (see G1) every 5 min. Block position (`tx_index`) is no longer fetched live: it needs one `getBlock` per slot (~1.35 GB/h) because young coins trade in 99 % of slots; `--tx-index` re-enables it, backfills (gTFA) still fill it | free |
| G1 reserve chain, online | every 5 min over the recent window: breaks → `getTransaction` on both sides; a tx that never landed is deleted ("phantom": mainnet-beta's websocket reports a few per minute, incl. all-zero `1111…` signatures, which are now dropped at ingest), a genuine hole is filled with Helius gTFA on the coin's mint / pool | free / ~10 credits per hole |
| Truncated logs | tx re-fetched (`getTransaction`, `maxSupportedTransactionVersion: 1`) and events decoded from the self-CPI inner instructions | free |
| Token metadata | GET of each new coin's `uri` (IPFS gateways rotated), 3 workers, ≤ 5 tries | free |
| Gaps (reconnect, restart, fallback endpoint, pool logs) | recorded in `gaps`, filled (throttled) with Helius `getTransactionsForAddress` (full txs, 0.1 credit/tx; pump ≈ 0.95 credits/slot, one fresh pool ≈ 0.2) | hard cap **6,000 credits/h, 25,000/day**, persisted across restarts |
| Self-audit | every 120 min: 40 pump slots re-read from Helius + the first 60 slots of the latest graduated pool, compared event by event → `audits` | ~50–150 credits per audit |
| Cross-check feed | PumpPortal free websocket (`subscribeNewToken`, `subscribeMigration`) → `tokens.seen_pp`, `migrations.seen_pp` | free |

Housekeeping events with no market information are no longer stored:
`Init/Close/SyncUserVolumeAccumulatorEvent`, `ExtendAccountEvent`, `DistributeFeeToHoldersEvent`,
`ClaimCashbackEvent` (`--keep-housekeeping` is not exposed; change `HOUSEKEEPING_EVENTS` in
`processor.ts` if a hypothesis needs them).

**Why this PumpSwap design (measured 2026-09-25).** Program-wide PumpSwap logs: ~4.4 GB/h for
0.74 M trades/h (mostly old bot-traded coins). Per-pool logs on the ~20 freshest graduates:
0.7–2.1 GB/h — bots hammer fresh pools (≈ 5–10 KB of log traffic per real trade; mentioning the
quote vault or the creator-fee ATA instead of the pool gives the same traffic). 40 % of a
graduate's first-30-min trades happen in its first 5 min, 12 % in the first minute. Helius gTFA
per pool would cost ≈ 0.1 credit per tx (≥ 450k credits/day for 10-min windows). So trade level is
kept for the first minute (exit/entry at migration + L, the `sell at +60 s` variant of H16), and
the pool **state** (what an exit is priced on: real vault + virtual reserves) for the full holding
horizon. What is lost after minute 1: individual post-migration trades (trader, size, gross
volume); net flow per poll interval is still visible in the vault balances.

**Endpoint policy.** `wss://api.mainnet-beta.solana.com` delivered the same event set as Helius;
`wss://solana-rpc.publicnode.com` only ~53 % and ~10 s later. mainnet-beta is primary (retried 4×),
time on the fallback is a recorded gap, and the primary is re-tried every minute. Commitment is
`confirmed`: a 12-minute trial at `finalized` still delivered never-landed txs AND missed ~0.5 % of
pump trades (169 in 12 min, found by the reserve chain), while `confirmed` + the online chain audit
gives 0 holes (phantoms removed, 3–4 per 5 min).

## Commands (run from the repo root)

```bash
bash research/memecoins/collector/ctl.sh start      # nohup supervisor; pid -> research/memecoins/data/collector.pid
bash research/memecoins/collector/ctl.sh status     # alive?, last heartbeat, row counts, audits
bash research/memecoins/collector/ctl.sh tail 30    # last log lines
bash research/memecoins/collector/ctl.sh stop       # graceful (flushes, checkpoints WAL)
bash research/memecoins/collector/ctl.sh restart    # stop, wait 30 s (mainnet-beta answers 413 to instant reconnects), start

# extra collector flags go after `start` / `restart`:
#   --amm-logs-min=1 (trade-level minutes after migration; ~6 MB per graduate per minute)
#   --pool-track-hours=78 --arm-real-tokens=119000000000000 --amm=graduates|off
#   --venues=pump,amm (ALSO the program-wide PumpSwap socket: all PumpSwap trades, ~4.4 GB/h)
#   --tx-index (per-slot getBlock, ~1.35 GB/h) --commitment=confirmed|finalized
#   --no-gap-fill --helius-credits-per-hour=6000 --helius-credits-per-day=25000 --audit-min=120 --chain-audit-min=5
#   --no-meta --no-pumpportal --min-free-gb=20 --ws=url1,url2 --http=url1,url2

cd research/memecoins/collector
node --import tsx stats.ts [--since-min=60]                    # rates per hour from heartbeats
node --import tsx verify.ts --chain                            # G1 reserve-chain continuity, whole DB (free)
node --import tsx verify.ts --program --windows=5              # pump trades event-by-event vs Helius (≈550 credits)
node --import tsx verify.ts --pools=3                          # graduated-pool trade windows vs Helius (≈100-300 credits)
node --import tsx verify.ts --auto-mints=5                     # per-mint completeness (≈50-600 credits + free RPC)
node --import tsx verify.ts --tokens                           # on-chain creates/migrations vs PumpPortal (free)
node --import tsx repair.ts                                    # rows with NULL tx_index from --tx-index mode (free)
node --import tsx backfill.ts --program=pump --minutes-ago=60 --span-min=5 --max-credits=1000
node --import tsx backfill.ts --mint=<MINT> --since-hours=24 --max-credits=500
node --import tsx backfill.ts --address=<POOL> --from-slot=A --to-slot=B --max-credits=200   # e.g. refill one pool window
node --import tsx footprint.ts --since=<unix ms>                 # live disk footprint per table (isolated from backfill rows)

# historical backfill job (resumable; gzip; wire-throttled; credit cap + projection stop):
bash research/memecoins/collector/ctl.sh bf-start --job=pump7d --from-time=2026-09-18T00:00:00Z --workers=6 --max-mbps=8 --max-credits=2600000
bash research/memecoins/collector/ctl.sh bf-status pump7d
bash research/memecoins/collector/ctl.sh bf-stop pump7d          # saves cursors; bf-start --job=pump7d resumes
node --import tsx backfill-pools.ts --job=pumpswap7d --window-min=1440 --sample=10 --projection-only   # PumpSwap cost projection
```

All HTTP RPC calls send `Accept-Encoding: gzip` (Helius gTFA page of 1,000 full txs: 10.0 MB → 2.2 MB,
ratio 0.21; public getBlock signature lists compress only to 0.74).

Files: `research/memecoins/data/memecoins.db` (+ `-wal`), `collector.log` (rotates at 20 MB,
keeps 3), `collector.out` (supervisor output, crashes only), `collector.pid` (supervisor),
`collector.lock` (node pid). The supervisor (`run-loop.sh`) restarts the node process after a
crash with backoff 15 s → 8 min; exit codes 3 (second instance) and 4 (disk guard) are final.

**Mac sleep.** When the Mac sleeps the sockets die; on wake the collector reconnects and records
the missed slot range in `gaps` (a gap larger than the Helius budget is marked `skipped:budget` —
fill it later with `backfill.ts`, or drop the day per protocol G5). To keep the Mac awake while
collecting: `caffeinate -dimsu -w "$(cat research/memecoins/data/collector.lock)" &`
(prevents sleep until the collector exits; no system setting is changed).

## Schema (see `store.ts`; `meta.schema_version` = 3)

* `trades` — one row per trade event (~250 bytes incl. indexes). Pubkeys are integer ids into
  `keys`; **query the `trades_v` view** for base58 `mint`, `trader`, `pool`, `quote_mint`,
  `ix_name`, `trader_label`, plus `sol_amount`, `market_cap_sol` (= v_quote·1e6 / v_token, for
  1B-supply 6-decimal coins with SOL quote) and `fee_total`.
  * `venue` 0 = bonding curve, 1 = PumpSwap (v3: only graduated pools, first minute after
    migration; rows before 2026-09-25 12:37Z contain ALL PumpSwap trades). `source` 0 = live
    websocket, 1 = tx fetch (truncated logs), 2 = Helius backfill / gap fill.
  * Order: `ORDER BY slot, seq, idx` for one coin (`seq` = reserve-chain order inside the slot;
    rows collected 11:33–12:37Z instead carry `tx_index`, the position in the block, and NULL
    `seq` until `verify --chain`/the online audit touches them).
  * `quote_amount` = curve/pool-side quote EXCLUDING fees; `user_quote` = what the trader paid
    (buy) / received (sell); fees: `fee_protocol + fee_creator + fee_lp` (additive), `fee_buyback`
    = share of the protocol fee routed to buyback (not additive), `fee_cashback`, `fee_holder` as
    emitted. PumpSwap `buy_exact_quote_in` reports `quote_amount_in`/`user_quote_amount_in`
    swapped relative to `buy`; both are normalized.
  * Reserves are **post-trade** for both venues (PumpSwap events are pre-trade and converted:
    buy base −= base_out, vault += quote_in_with_lp_fee; sell base += base_in, vault −=
    quote_out_without_lp_fee). `r_*` = real reserves, `v_*` = effective reserves (pump virtual;
    PumpSwap vault + `virt_quote`). Mayhem coins' virtual reserves are re-set by the mayhem
    program between trades — use the real reserves for continuity.
  * Dedupe key `uid` = 63-bit hash of `sig:idx` (`idx` = ordinal of the trade event in the tx).
* `tracked_pools` — graduated pools in scope: mint, vaults, `migrate_slot`, the trade-level
  window `logs_from_slot..logs_to_slot`, `logs_status` (`armed-before-migration` = subscribed
  before the pool existed; `subscribed-at-migration+gapfill`; `pre-v3 (program-wide PumpSwap
  socket)`), `poll_until`.
* `pool_states` — `(pool_id, slot)` → `base`, `quote` (vault balances = real reserves) and
  `virt` (`Pool.virtual_quote_reserves`); one row per poll that saw a change. Executable exit
  value on PumpSwap = f(quote + virt, base) per PROTOCOL §3.3/§4.2, with the real-vault check.
* `events` — every non-trade, non-housekeeping pump event and every in-scope PumpSwap event,
  `(sig, eidx)` keyed, full decoded body in `data` (JSON; u64 as strings): `CreateEvent`,
  `CompleteEvent`, `CompletePumpAmmMigrationEvent`, `CreatePoolEvent`, `InitBoostEvent`,
  `BoostBuyAndBurnEvent` (inside trade-level windows), `CollectCreatorFeeEvent`,
  `DistributeCreatorFeesEvent`, `SetParamsEvent`, `UpdateMayhemVirtualParamsEvent`, ...
* `tokens` — pump.fun creations (`seen_logs`, `seen_pp`, `launchpad`, `is_mayhem`, `is_cashback`,
  `is_holder_reward`, `creator_fee_bps`, `quote_mint` NULL = SOL, `initial_buy_*`).
* `token_meta` — metadata JSON per mint (+ description, image, twitter, telegram, website).
* `wallet_labels` — `BwWK17cbHxwWBKZkUYvzxLcNQ1YVyaFezduWbtm2de6s` = `mayhem_agent` (exclude from
  buyer/volume features, G7), `HTVZVEQMBsNanubDPTs3CxDAEGNFQHJY8c1441iy2S5r` = `boost_authority`.
* `migrations`, `pools`, `gaps`, `audits` (Helius audits, pool-window audits, online chain
  audits), `heartbeats` (per-minute JSON counters).

### Example queries

```sql
-- one coin's curve trades in execution order
SELECT slot, seq, idx, trader, trader_label, is_buy, sol_amount, token_amount, market_cap_sol, fee_total
FROM trades_v WHERE mint = '<MINT>' AND venue = 'pump' ORDER BY slot, seq, idx;

-- a graduated pool: first-minute trades, then the state path
SELECT slot, seq, idx, trader, is_buy, sol_amount, r_quote, virt_quote FROM trades_v WHERE pool = '<POOL>' ORDER BY slot, seq, idx;
SELECT s.slot, s.base, s.quote, s.virt FROM pool_states s JOIN keys k ON k.id = s.pool_id WHERE k.pubkey = '<POOL>' ORDER BY s.slot;

-- coins created in the last hour with dev-buy, graduation and socials
SELECT t.mint, t.creator, t.initial_buy_sol / 1e9 AS dev_buy_sol, t.is_mayhem, m.slot AS graduated_slot, tm.twitter
FROM tokens t LEFT JOIN migrations m ON m.mint = t.mint AND m.kind = 'complete' LEFT JOIN token_meta tm ON tm.mint = t.mint
WHERE t.seen_logs = 1 AND t.created_ts > strftime('%s','now') - 3600;
```

Indexes: `trades(mint_id, slot)`, `trades(slot)`, `events(name, slot)`. For wallet-centric work add
`CREATE INDEX trades_trader ON trades(trader_id, slot);` (≈ +15 % size) while the collector is stopped.
Reading while collecting: `sqlite3 -readonly …/memecoins.db` (when stopped, plain `sqlite3`).

## Validation v3

Measured 2026-09-25 on the v3 scope (window 12:59:29–13:31Z, slots 450359931..450366870):

* **pump.fun, event by event vs Helius** (`verify --program`, 5 × 100-slot windows): **5,958 / 5,958**
  trade events (100 %), 0 field mismatches, 0 extra rows (790 credits).
* **G1 reserve chain** (`verify --chain`): 72,901 pairs, 12 breaks (99.98 %); the breaks were never-landed
  phantoms not yet removed (public RPC throttled the check — Helius is now the tie-breaker) or in the
  last 5 minutes (not yet audited). Online audit over the run: 189k pairs/h, 72 breaks/h → 60 phantoms
  removed, 15 holes refilled. Backfilled regions (tx_index from gTFA): 122,362 + 20,047 + 35,181 +
  29,951 pairs, **0 breaks**.
* **Graduated pools, first minute vs Helius** (`verify --pools=5`): 1,213 / 1,221 trades (99.3 %);
  the 8 misses were snipes in the migration slot delivered by the pool socket before the pump socket
  delivered the migration — fixed (armed pools are in scope) and refilled.
* **Helius audit** (built in, 13:09Z): pump 460/460; pool window 24/28 → refilled (socket drop around
  the migration of an armed pool — fixed: such drops now queue a pool gap at migration).
* Pre-subscription: 29 of 46 graduations since v3 went live were subscribed before the pool existed; the
  17 others fell into the many validation restarts (restart gaps) and had their first minute refilled from
  Helius (`subscribed-at-migration+gapfill`).
* PumpPortal cross-check (whole DB): on-chain creates 10,045 vs PumpPortal 2,257 of them (PumpPortal
  misses most non-SOL-quote and many Token-2022 coins; it also reports 75 LaunchLab "bonk" coins).

## 7-day backfill job `pump7d` — state at 2026-09-25 14:25Z: STOPPED, Helius credits exhausted

Order (operator decision): the Look-1 window 2026-09-25 00:00Z → 2026-09-18 00:00Z newest-first
(`--priority-before-slot=450184450`), then 2026-09-25 00:00Z → live start; cap raised to 3.5 M credits.
At ~14:18Z Helius began answering every call with HTTP 429 **"max usage reached"** — the plan's credits are
exhausted (the job had spent 968,290; the collector/verification ~30 k more). The job now treats that body as
fatal (`rpc.ts` maps it to -32429) instead of backing off.

* Covered (contiguous, G1 reserve chain **100 %: 5,791,790 pairs, 61,354 coins, 0 breaks**):
  slots 449593267..450185016 = 2026-09-23 04:22Z → 2026-09-25 00:02Z, plus 450322267..450370701 =
  2026-09-25 10:13Z → 13:48Z (backfill + live collector), plus 15 isolated 10-minute sample chunks on Sep 18–22.
* Full UTC days inside Sep 18–25: **2026-09-24 only**; Sep 23 81.8 %; Sep 18–22 ≈ 2 % each (samples).
  Not covered: Sep 25 00:02Z → 10:13Z.
* Rows: 6.89 M curve trades, 69,786 creations, 2,156 migrations; `tx_index` on every backfilled row;
  wire 20.5 GB (raw 99 GB, gzip 0.21); DB now 2.37 GB. No failed chunks (no `backfill:pump7d` gaps).
* Measured cost: 1.48–1.77 credits/slot on Sep 23–25 (busier than the 1.35 stride average of Sep 18–22).
  Remaining 787 chunks ≈ 1.78 M slots ≈ 2.4–2.7 M credits.
* Resume after credits reset / top-up (continues newest-first where it stopped):
  `bash ctl.sh bf-start --job=pump7d --workers=6 --max-mbps=8 --max-credits=3500000 --projection-after=100000 --priority-before-slot=450184450`
* Report: `node --import tsx backfill-report.ts` (ranges, UTC days, credits, gaps; day boundaries in
  `data/day-boundaries.json`).

PumpSwap for graduates, migration → +24 h (`backfill-pools.ts --projection-only`, 10 sampled pools):
avg 18,193 txs per pool (median 6,716, max 66,401) ≈ 1,820 credits per graduate ⇒ **≈ 13.9 M credits for
the week — not feasible**. First minute only ≈ 60–100 credits per graduate ⇒ ≈ 0.5–0.8 M (not authorised).

## Backfill options (measured 2026-09-25; slot = 0.2664 s ⇒ 13,514 slots/h, 324k slots/day)

Helius `getTransactionsForAddress` (full txs, `status: succeeded`, slot window, 0.1 credit per
returned tx) is the only cheap complete historical path. Measured with `backfill.ts`:

| Scope | tx per slot | credits per slot | bytes/tx | 1 day | 7 days | 14 days |
|---|---|---|---|---|---|---|
| pump.fun program (all bonding-curve trades, creates, completions, migrations) | 13.8 (stride average; 9.4 at one quiet hour) | 1.38 | 9.9 KB raw / 2.1 KB gzip | 0.45 M credits | **≈ 3.1 M credits**, ≈ 70 GB on the wire (gzip), ≈ 2.3 h at 8 MB/s | ≈ 6.2 M credits |
| PumpSwap program (every AMM trade) | 99–150 | 10–15 | 10.9–12.6 KB | 3.2–4.9 M credits, 350+ GB | 23–34 M credits, 2.4+ TB | 45–68 M credits, 5 TB |
| One graduated pool, first N minutes (pool address) | ~2 | ~0.2 | ~10 KB | — | — | — |
| One token, whole life (mint address; both venues) | — | — | 8.6 KB | e.g. a coin that graduated 4 min after launch: 2,044 txs → 210 credits | | |

* A pump.fun backfill of 7 days is ≈ 31 % of a Developer plan's 10 M monthly credits (14 days ≈ 62 %).
* Keyless: public RPC `getSignaturesForAddress` + `getTransaction` works (free) but at ~5–10 tx/s
  it only suits samples.
* Keyed third parties (not signed up): Dune free plan is view-only (exports need a paid plan);
  Bitquery trial = 1,000 API points for 7 days; Solana Tracker Data API free = 10k requests/month,
  Datastream websocket from €397/month; PumpPortal trade feed is live-only at 0.01 SOL per 10k
  messages.

## Known limitations

* PumpSwap after minute 1: state only (see above). A gap on the pump stream that swallows a
  migration makes the pool's registration late; its first minute is then filled from Helius
  (`subscribed-at-migration+gapfill`).
* Only pump.fun + PumpSwap are decoded. Raydium LaunchLab (`LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj`)
  and Meteora DBC (`dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN`) trades are not collected.
* The collector stops itself below 20 GB free disk.
* Public endpoints throttle: mainnet-beta answers HTTP 413 to websocket upgrades right after a stop
  (use `ctl.sh restart`), closes a connection after ~80 rapid subscribe calls ("1013 Too many
  subscriptions attempted" — the pool-log manager caps 40 subscriptions per connection), and
  documents 100 MB / 30 s per IP; publicnode answered 403 "Request blocked" after heavy getBlock use.
* `.gitignore` has `*.json`, so `../idl/*.json` would need `git add -f` if ever committed.
