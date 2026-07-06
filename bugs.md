# Bug Tracker

**Project:** Delta-Neutral LP Bot

---

## Active Bugs

### BUG-012: Silent multi-hour under-hedge when the desired short pins at MAX_HEDGE_NOTIONAL_USD
**Status:** Fixed (2026-07-06, same day — ADR-022: auto-derived cap + headroom fill + blocked-streak banner; operator ordered the auto-scaling fix over a manual cap bump)
**Severity:** Medium (neutrality hole, bounded by the cap gap; cost that night ≈ −0.5 USD, could be worse in a real dump)
**Reported:** 2026-07-06
**Related:** ADR-021 (full-portfolio input + out-of-range clamp), exit-trap rule in strategy-analyzer

**Description:**
During the 2026-07-05→06 whipsaw night the out-of-range clamp put the full
bag into the hedge input (≈2.63 SOL ≈ $212 at $80.5), while
`MAX_HEDGE_NOTIONAL_USD=200` — sized by ADR-021 against a smaller bag —
blocked EVERY increase. The controller blocks the whole increase instead of
filling the remaining headroom (short was $167, headroom $33, wanted +$46 →
took $0), so netΔ sat at +0.42..+0.57 SOL (outside the 0.25 band) for ~5.5
hours (02:04→07:37Z) with 990 `blocked` rows written to pnl.db and no
escalation — an "unhedged and unpaused, silently" state the exit-trap rule
classifies as a bug. SOL fell ~$1 over the window → ≈ −0.5 USD of exactly
the exposure the hedge exists to remove.

**Candidate fixes (for the Tuesday decision):**
1. Controller: clamp increase size to remaining cap headroom instead of
   all-or-nothing blocking (keeps netΔ as close to band as the cap allows).
2. Size `MAX_HEDGE_NOTIONAL_USD` to the full bag with margin (≥250 for the
   current ~$214 bag), and re-derive whenever capital is added.
3. Loud escalation (banner/alert) after N consecutive blocked cycles.

---

### BUG-011: Failed LP re-creation mid-crash would unwind the protective short
**Status:** Fixed (2026-07-05) — 5-minute grace window before no-LP hedge decisions
**Severity:** High (loss-prevention hole; never triggered live, found by drawdown review)
**Reported:** 2026-07-05
**Related:** ADR-017 (unwind-leftover-perp design), ADR-020 (oracle gate raises failed-swap odds in fast markets)

**Description:**
The rebalance closes the old position (Phase 1) before creating the new one.
If creation fails (oracle-gate-refused swap in a fast move, RPC hiccup,
slippage), the next cycle sees exposure = 0 and the controller — by the
ADR-017 rule "a leftover perp with no LP is naked directional risk to
unwind" — issues a FULL decrease_short. Decreases are never guard-blocked
and the cooldown has long expired, so the bot would strip its only downside
protection in the middle of exactly the kind of move that made the creation
fail, while the LP's entire SOL sat un-deposited in the wallet.

**Fix:** `consecutiveNoLpCycles` counter in the orchestrator; hedge decisions
in the no-LP branch are deferred (loud warning) until the state persists
NO_LP_HEDGE_GRACE_CYCLES = 20 cycles (~5 min). A genuine wind-down still
unwinds — 5 minutes later. Positions found on-chain reset the counter.

---

### BUG-010: Network fees never persisted to pnl.db — `pnpm pnl` reported $0 network costs
**Status:** Fixed (2026-07-04)
**Severity:** Low (reporting only; ~$0.10 understated so far, no funds lost)
**Reported:** 2026-07-04

**Description:**
`trackTransactionFee` / `trackBatchTransactionFees` fetched the real fee from
chain and saved it to `state.json` (`addTransactionFee`), but never into
`pnl.db`. The orchestrator inserts `transactions` rows BEFORE the fee is
known, so `fee_lamports/fee_sol/fee_usd` stayed NULL forever and every
`SUM(fee_sol)` in the PnL report returned 0. `recordTransaction` even had an
idempotent COALESCE-update path built for exactly this backfill ("may
complete after the orchestrator has already inserted the row") — it was just
never called from the tracker.

**Fix:** the trackers now also call `recordTransaction` with the fetched fee
(signature-idempotent update; `operationToTxKind` maps the label on the rare
insert-first race). Historical rows stay NULL — only ~34 rows / ~$0.10.

---

### BUG-008: Stale persisted `running: true` bricked every container restart
**Status:** Fixed (2026-07-04)
**Severity:** Critical (bot silently down ~6h with live funds; net Δ drifted to +0.69 SOL unhedged)
**Reported:** 2026-07-04
**Related:** BUG-009, ADR-018

**Description:**
`AutoTuneOrchestrator` persists its whole state to `data/auto-tune-state.json`,
including the runtime flag `running`. A process that dies without `stop()`
leaves `running: true` on disk. On the next boot `start()` saw the stale flag,
logged `Auto-tune loop already running`, and returned WITHOUT scheduling the
interval. The CLI's keep-alive (`await new Promise(() => {})`) holds no event
loop handle, so with no interval the process drained its sockets and exited
cleanly (code 0) ~60s later. Docker (`restart: unless-stopped`) restarted it,
and the cycle repeated forever — 345 "restarts" between 2026-07-04T04:33Z and
~10:40Z, each logging "✅ Auto-tune loop started successfully" while doing
nothing. Meanwhile the LP drifted to 100% SOL (out of range, earning nothing)
against a 0.531 SOL short.

**Fix:**
1. Constructor resets `savedState.running = false` on load (a runtime flag can
   never be validly true at boot).
2. `start()` now guards on `this.intervalHandle` (a real double-start within
   this process), not the persisted flag.

**Lesson:** exit code 0 + "started successfully" in logs is not liveness. The
DB/log silence (last pnl.db row 03:41Z, WAL only) was the actual signal.

---

### BUG-009: No re-entrancy guard on `runCheckCycle` — overlapping cycles race
**Status:** Fixed (guard added 2026-07-04); original crash cause still unknown
**Severity:** Medium (races observed live; suspected contributor to the 04:33Z death)
**Reported:** 2026-07-04
**Related:** BUG-008

**Description:**
`setInterval` fires every `AUTO_TUNE_CHECK_INTERVAL_MS` (15s) regardless of
whether the previous cycle is still awaiting — an LP rebalance takes 10–26s,
so a new cycle regularly started mid-rebalance. Observed live at
2026-07-04T04:32:46–04:33:06Z: cycle 4141 started while cycle 4140's rebalance
was in flight; the overlapped discovery saw "No positions found on blockchain"
one second after the position was created, cleared the tracked mints, then
re-discovered. Within ~15s of that interleaving the process died silently
(no error logged; no OOM in dmesg; exit code unrecoverable), which armed
BUG-008. Fixed with a `cycleInFlight` boolean + try/finally skip-tick guard.
The root cause of the original silent death remains unconfirmed — if it
recurs, the restart now self-heals (BUG-008 fix) and the skipped-tick log
line will make overlap visible.

---

### BUG-003: Drift protocol down post-exploit — write instructions rejected on-chain
**Status:** Won't Fix (external) — pivoted away
**Severity:** Critical (blocked the hedge)
**Reported:** 2026-06-28
**Related:** ADR-014, ADR-015

**Description:**
Drift suffered a ~$285M exploit on 2026-04-01 and is in a full relaunch
(settlement asset changing USDC→USDT, new program). The deployed program
`dRiftyHA39MWEi3m9aunc5MzRF1JYuBsbn6VPcn33UH` is frozen/transitional and rejects
account-creation instructions from `@drift-labs/sdk@2.156.0`.

**Actual Behavior:**
`pnpm hedge --init` dry-run → `InstructionError [1, Custom(101)]` =
`InstructionFallbackNotFound`. Reproduced on Helius **and** public mainnet RPC,
signed/unsigned, v0/legacy. SDK discriminators are canonical and identical
across stable/latest; not a dual-web3 or simulation artifact. Reads still work
(account layouts compatible) but writes do not.

**Resolution:** Pivoted the hedge to Jupiter Perpetuals (ADR-015). Drift code
retained as a paused backend in case Drift relaunches.

---

### BUG-004: Meteora off-chain API host dead → analytics broke (NOT a dead pool)
**Status:** Fixed (analytics) — residual: no LP position created yet
**Severity:** High → resolved for analytics
**Reported:** 2026-06-28
**Updated:** 2026-06-29
**Related:** Auto-tune, hedge, API server

**Root cause (corrected 2026-06-29):** The whole host `dlmm-api.meteora.ag` is
dead — it returns HTTP 404 for **every** path (incl. root), from curl *and*
WebFetch — not just our pool. The configured pool
`5rCf1DM8LjKTw4YqhnoLcngyZYeNnQqztScTogYHAS6` is **alive and trading** (verified
on-chain via the DLMM SDK and on GeckoTerminal: ~$3.3M TVL, ~$51M/24h volume,
binStep 4, base fee 0.04%, price ~$75). So the earlier "pool returns 404" was an
API-host failure, not a dead pool. The separate "position not on-chain"
(`EUXx25SLaS3sbPvcirLw7QzaBQepkB9M4QJ7u4eXxhVs`) is simply that no LP position
has been created yet — stale mint in `data/state.json` — not a code bug.

**Impact (before fix):** `getMeteoraPairInfo` threw on the 404, breaking
`/api/pool/analytics`. Bot *logic* was unaffected (auto-tune reads composition
on-chain; LP exposure is on-chain), so this was display/analytics only.

**Fix (done 2026-06-29):** `getMeteoraPairInfo` (`src/utils/meteoraUtils.ts`)
rewritten to derive analytics **on-chain via the DLMM SDK** (bin step,
base/max/protocol fee rates, active-bin price, reserves, TVL priced at the
pool's own active price — no external oracle). The genuinely historical metrics
(24h volume/fees/APR) come best-effort from GeckoTerminal and degrade to 0 if
that indexer is down — never throws. No dependency on `dlmm-api.meteora.ag`.
Validated live against the configured pool.

**Residual (not blocking the hedge build):** create an actual LP position
(`AUTO_CREATE_POSITIONS=true` or via API) and clear the stale state mint, so LP
exposure is non-zero before running a live delta-neutral loop.

**Update 2026-06-30 (stale state cleared + auto-heal added):**
- Verified on-chain (read-only, DLMM SDK `getPositionsByUserAndLbPair`): wallet
  `F3YvPiLdniRPGpeKrbeGWR2zg2wPpzVuvqBA5BBJBQ5S` holds **0 positions** in pool
  `5rCf1DM8LjKTw4YqhnoLcngyZYeNnQqztScTogYHAS6`; the state mint
  `EUXx25SLaS3sbPvcirLw7QzaBQepkB9M4QJ7u4eXxhVs` is **not on-chain** (closed). Wallet
  balance: **3.266365 SOL, 0 USDC**.
- **Code gap found + fixed:** `ensurePositionsLoaded()` short-circuits when
  `positionMints.length > 0`, so a phantom mint in `state.json` made the bot skip
  on-chain discovery and trust a position it didn't have (never self-healing).
  Added auto-heal in two on-chain-authoritative spots in `meteoraAdapter.ts`:
  `discoverPositionsFromBlockchain()` and `getLpExposure()` now **prune the tracked
  mints + persist `[]`** when the chain shows no match. Safe: position creation
  re-checks the chain to avoid dupes, so a transient empty read self-corrects.
- **State cleared:** `data/state.json` `createdPositionMints` set to `[]` (history
  preserved). Validated: adapter now discovers 0 and `getLpExposure` returns clean
  zeros without crashing.
- **Still operator-gated (fund movement):** actually opening a live LP position.
  Wallet is SOL-only (~$240 at SOL ≈ $73.43); a balanced position needs a SOL→USDC
  swap and may scale down to fit. Not done unilaterally — awaiting operator go.

---

### BUG-001: [Bug Title]
**Status:** Open | In Progress | Fixed | Won't Fix
**Severity:** Critical | High | Medium | Low
**Priority:** P0 | P1 | P2 | P3
**Reported:** YYYY-MM-DD
**Assignee:** [Name]
**Related Epic/Task:** [Epic X, Task Y]

**Description:**
Brief description of the bug

**Reproduction Steps:**
1. Step 1
2. Step 2
3. Step 3

**Expected Behavior:**
What should happen

**Actual Behavior:**
What actually happens

**Environment:**
- Network: Devnet | Mainnet-beta
- Node version: X.X.X
- solana-agent-kit version: X.X.X

**Logs/Stack Trace:**
```
Paste relevant logs here
```

**Root Cause:**
[Analysis of why the bug occurred]

**Fix Approach:**
[How you plan to fix it]

**Testing:**
- [ ] Unit test added/updated
- [ ] Integration test added/updated
- [ ] Manually verified fix

**Related Issues:**
- Links to related bugs or tasks

---

## Bug Template

Copy this template for each new bug:

```markdown
### BUG-XXX: [Bug Title]
**Status:** Open
**Severity:** [Critical | High | Medium | Low]
**Priority:** [P0 | P1 | P2 | P3]
**Reported:** YYYY-MM-DD
**Assignee:**
**Related Epic/Task:**

**Description:**


**Reproduction Steps:**
1.
2.
3.

**Expected Behavior:**


**Actual Behavior:**


**Environment:**
- Network:
- Node version:
- solana-agent-kit version:

**Logs/Stack Trace:**
```
```

**Root Cause:**


**Fix Approach:**


**Testing:**
- [ ] Unit test added/updated
- [ ] Integration test added/updated
- [ ] Manually verified fix

**Related Issues:**

```

---

## Fixed Bugs

### BUG-003: Initial-Position Swap Asks Jupiter to Swap More USDC Than Wallet Holds
**Status:** Fixed
**Severity:** Critical
**Priority:** P0
**Reported:** 2026-05-09 (from production log)
**Fixed:** 2026-05-09
**Related Epic/Task:** Auto-Tune Stability

**Description:**
Wallet contained 0.258 SOL + 9.43 USDC. With `AUTO_TUNE_DEPOSIT_TOKEN=SOL` and `AUTO_TUNE_DEPOSIT_AMOUNT=4` (target ≈ 4 SOL ≈ $560), the bot computed a 566.81 USDC → SOL swap and called `JupiterSwapper.executeSwap()`. Jupiter Ultra returned `errorCode: 1, errorMessage: "Insufficient funds"` in the order response (with empty `transaction` field), which was then surfaced to the operator as the unhelpful `"No transaction in order response"` error.

**Reproduction:**
1. Configure auto-tune with `AUTO_TUNE_DEPOSIT_AMOUNT` larger than your wallet's USD value can fund.
2. Start the bot from a fresh state (no existing position).
3. Observe `createInitialPosition` attempting a swap that exceeds the wallet's USDC holding.

**Root Cause:**
The `createInitialPosition` swap path was missing the per-token balance guard that the rebalance path had. The two paths (initial-position around line 1166 vs. rebalance around line 894) had drifted apart over time — one had `if (actualUsdc >= usdcToSwap)` before calling Jupiter, the other didn't.

**Resolution:**
Two-layer fix:
1. **Per-branch balance guards** added to the initial-position path mirroring the rebalance flow.
2. **Upstream total-USD-value pre-flight** that throws fast with a descriptive error when wallet's total value (after reserves) is below position value, since no swap can resolve that.
3. **Structural fix**: extracted both paths into a single pure helper `src/modules/swapPlanner.ts` so they can never drift apart again. 20 vitest unit tests pin the behaviour, including a regression test for this exact wallet/target case.

**Testing:**
- [x] `npx tsc --noEmit`
- [x] `npx vitest run` — `swapPlanner.test.ts`: 20/20 pass
- [x] Regression case `'production bug regression — wallet (0.258 SOL, 9.43 USDC), 4 SOL target throws on total-value pre-flight'` pins behaviour.

**Related:** ADR-013, progress.md Session 9 (2026-05-09).

---

### BUG-004: Hono API POST Endpoints Were Unauthenticated With Wildcard CORS
**Status:** Fixed
**Severity:** Critical
**Priority:** P0
**Reported:** 2026-05-09 (audit finding)
**Fixed:** 2026-05-09
**Related Epic/Task:** API Security

**Description:**
`POST /api/positions/create` and `POST /api/positions/withdraw-claim-close` accepted requests without authentication. Combined with `app.use('*', cors())` (wildcard origin), any web page the operator visited could fire fund-moving requests at `http://localhost:3001` via JavaScript fetch.

**Resolution:**
Four-layer guard added to mutating POST routes:
1. CORS allowlist via `API_ALLOWED_ORIGINS` (wildcard removed).
2. API-key auth via `X-API-Key` header matching `API_KEY` env. Constant-time compare. **Fail-closed** — when `API_KEY` is unset, POSTs return HTTP 503.
3. Per-IP rate limit via `API_RATE_LIMIT_PER_MIN` (default 10/min, 429 with Retry-After).
4. Body validation: types, ranges, sanity ceilings (`solAmount ≤ 1000`, `priceLower < priceUpper`, etc).

**Testing:**
- [x] `npx tsc --noEmit`
- [x] All four guards verified individually against Hono v4 middleware semantics.

**Related:** ADR-013, `docs/API.md` security model section.

---

### BUG-005: `withdrawClaimAndClose` 30s Hard Timeout + No Phase 1 Retry
**Status:** Fixed
**Severity:** High
**Priority:** P1
**Reported:** 2026-05-09 (audit finding)
**Fixed:** 2026-05-09
**Related Epic/Task:** Auto-Tune Reliability

**Description:**
Two issues bundled:
- `withdrawClaimAndClose` wrapped its SDK build call in a 30s `Promise.race` timeout. On slow RPCs the build legitimately took >30s and falsely failed.
- The Phase 1 caller had no retry — a single re-thrown error left the position open on-chain and the bot silently broken until the next rebalance check.

**Resolution:**
- Build timeout bumped 30s → 90s with clearer error message.
- Defensive on-chain re-check in the catch block via new private `isPositionStillOnChain()` (read-only, no state mutation). If the SDK rejected locally but the transaction settled on-chain, returns synthetic success rather than re-throwing.
- Phase 1 caller wrapped in retry loop (uses `AUTO_TUNE_MAX_RETRIES`) with on-chain re-check before each retry.

**Testing:**
- [x] `npx tsc --noEmit`
- [x] All four scope/control-flow concerns verified by code-review subagent.

**Related:** ADR-013.

---

### BUG-006: `priceImpactPct` Hard-Coded to `undefined` (Comment Was Wrong)
**Status:** Fixed
**Severity:** Medium
**Priority:** P2
**Reported:** 2026-05-09 (audit finding)
**Fixed:** 2026-05-09
**Related Epic/Task:** Observability

**Description:**
`JupiterSwapper.executeSwap` returned `priceImpactPct: undefined` with a comment claiming "Ultra API doesn't provide priceImpactPct". The user's own production log shows Jupiter's order response includes `"priceImpactPct": "-0.0007154577850814085"` — the comment was wrong and operators had no visibility into actual price impact.

**Resolution:**
- New module-level `parsePriceImpactPctFromOrder()` reads the field from the order response, normalizes string-or-number input, returns a positive percentage.
- New private `logSwapOutcome()` helper in `autoTuneOrchestrator.ts` compares against `SWAP_HIGH_IMPACT_WARNING_PCT` (default 1.0); emits `errorBanner` when exceeded with bufferExceeded flag and recommended action.

**Related:** ADR-013.

---

### BUG-007: Hedge Carry Read From the Wrong Custody (SOL Instead of Collateral)
**Status:** Fixed
**Severity:** Medium (misleading economics, no fund loss)
**Reported:** 2026-07-03 (found during the both-sides generalization design)
**Fixed:** 2026-07-03
**Related:** ADR-015, ADR-017

**Description:**
`JupiterPerpsEngine.getHedgeState()` computed `carryRateBps` from the **SOL
custody** unconditionally. On Jupiter Perps, borrow fees accrue on the
position's **collateral** custody — USDC for a short, SOL for a long. The
liquidation-price port already used `collateralCustody.fundingRateState`
correctly; only the headline carry number was wrong. Effect: the reported
short carry was the SOL-side borrow APR (~11.8% at the time) instead of the
USDC-side rate (~5.5% at fix time) — overstating the hedge cost and feeding
the wrong number into the controller's carry-cap gate.

**Resolution:**
`readSides()` computes per-side carry from each side's collateral custody
(USDC custody for the short, SOL custody for the long); the carry-cap guard in
`decideHedgeAction` receives the side-correct cost. Verified live:
`pnpm jupiter:read` now reports `carryRateBps ≈ -552` (USDC custody) for the
prospective short.

---

### BUG-002: Node 24 Crashes Loading Meteora DLMM ESM Bundle
**Status:** Fixed
**Severity:** High
**Fixed:** 2026-05-08
**Related Epic/Task:** Auto-Tune Runtime

**Description:**
`pnpm auto-tune:watch` failed before startup under Node `v24.4.0` because `@meteora-ag/dlmm@1.9.7` ESM bundle imports `BN` as a named export from `@coral-xyz/anchor`, but Anchor exposes `BN` on its default/CommonJS export rather than as a Node 24 synthetic named export.

**Resolution:**
Added a central `src/utils/dlmm.ts` loader that uses `createRequire()` to load the Meteora SDK CommonJS build, then updated source and scripts to use that loader/pattern. The CJS build reads `anchor.BN` at runtime and avoids the ESM named-export crash.

**Testing:**
- [x] `pnpm build`
- [x] `CI=1 pnpm test`
- [x] `node -e "import('./dist/utils/dlmm.js')..."`

### BUG-000: Example Fixed Bug
**Status:** Fixed
**Severity:** High
**Fixed:** YYYY-MM-DD
**Related Epic/Task:** Epic K, Task K1

**Description:**
[Brief description]

**Resolution:**
[How it was fixed]

---

## Bug Statistics

### By Severity
- Critical: 0
- High: 0
- Medium: 0
- Low: 0

### By Status
- Open: 0
- In Progress: 0
- Fixed: 0
- Won't Fix: 0

### By Epic
- Epic K: 0
- Epic L: 0
- Epic L (Auto-Tune): 0
- Epic M: 0
- Epic N: 0
- Epic O: 0
- Epic P: 0

---

## Bug Severity Guidelines

**Critical (P0):**
- System crash or data loss
- Security vulnerability
- Production outage
- Financial loss risk
- Must fix immediately

**High (P1):**
- Major feature broken
- Incorrect calculations (delta, margin, etc.)
- Transaction failures
- Should fix before next release

**Medium (P2):**
- Minor feature broken
- Poor error messages
- Performance degradation
- Fix in upcoming release

**Low (P3):**
- Cosmetic issues
- Minor inconveniences
- Nice to have fixes
- Fix when convenient

## Active Bugs

### BUG-001: Empty Position Created Despite Successful Transaction
**Status:** Won't Fix (Expected Behavior)
**Severity:** Low
**Priority:** P3
**Reported:** 2025-10-22
**Related Epic/Task:** Epic L, Testing

**Description:**
Balanced deposit test creates position NFT but deposits 0 tokens (totalXAmount: 0, totalYAmount: 0).

**Reproduction Steps:**
1. Run: `METEORA_POOL_ADDRESS=27bw11iT7dcrRTPDo5arWcXrAKfAKmZoWHR5fcmqNdN7Y6nk6xSrM BASE_TOKEN_AMOUNT=100 SOL_AMOUNT=1 PRICE_RANGE_PCT=5 NODE_ENV=local pnpm tsx src/test/local-meteora-balanced-test.ts`
2. Transaction succeeds, position NFT created
3. Check position state - shows 0 liquidity

**Expected Behavior:**
Position contains 100 Base Token and 1 SOL

**Actual Behavior:**
Position NFT created but empty (0 tokens deposited)

**Environment:**
- Network: Localnet
- Pool: 27bw11iT7dcrRTPDo5arWcXrAKfAKmZoWHR5fcmqNdN7Y6nk6xSrM
- Active Bin: 0
- Position Bins: -21 to 20

**Root Cause:**
This is **expected DLMM behavior**, not a bug. The Meteora DLMM SDK's `StrategyType.Spot` strategy calculated that zero liquidity was needed for the specified bin range given the pool's current state and price. The transaction succeeded in creating the position structure, but no tokens were transferred because the strategy determined the bins don't require liquidity.

**Resolution:**
Won't Fix - This is correct behavior. In production, bins would be chosen based on actual market needs and price ranges where liquidity is required.

**Related Issues:**
- Localnet USDC whitelist limitation (see notes below)

---

## Notes

### Localnet USDC Whitelist Limitation (Not a Bug)
**Discovered:** 2025-10-22

The Meteora DLMM program on localnet has a hardcoded whitelist for quote tokens that only accepts:
- SOL (wrapped): `So11111111111111111111111111111111111111112`
- Mainnet USDC: `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`

Custom USDC tokens are rejected with error: `InvalidQuoteToken` (0x17ad)

**Impact:** Cannot create custom USDC pools on localnet
**Workaround:** Use existing pools with Base Token/SOL for localnet testing
**Production Impact:** None (mainnet has real USDC)

---

## Notes on Auto-Tune Implementation

### Auto-Tune Feature (Implemented 2025-11-09)
**Status:** No bugs encountered

The auto-tune feature was implemented with atomic rebalancing (withdraw + claim + close + create in single transaction). Implementation went smoothly with no bugs filed during development.

**Implementation Details:**
- All operations bundled into single transaction for atomicity
- Uses partialSign for wallet + position keypair signatures
- Normal Jito priority to avoid overpaying
- Auto-calculation of centered price ranges
- Simple threshold-based imbalance detection (0.8 = 80%)

**Testing Status:** Pending production testing

---
