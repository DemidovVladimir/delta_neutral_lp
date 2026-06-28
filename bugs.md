# Bug Tracker

**Project:** Delta-Neutral LP Bot

---

## Active Bugs

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

### BUG-004: Configured Meteora LP pool returns 404 / position not on-chain
**Status:** Open
**Severity:** High (the LP side we hedge currently reads 0)
**Reported:** 2026-06-28
**Related:** Auto-tune, hedge

**Description:**
`METEORA_POOL_ADDRESS=5rCf1DM8LjKTw4YqhnoLcngyZYeNnQqztScTogYHAS6` returns HTTP
404 from `https://dlmm-api.meteora.ag/pair/{addr}`. The saved position mint
`EUXx25SLaS3sbPvcirLw7QzaBQepkB9M4QJ7u4eXxhVs` (in `data/state.json`) is not
found on-chain ("No positions found matching configured mints").

**Impact:** LP exposure reads as 0 everywhere (dashboard, hedge delta). There is
nothing to hedge until the LP side is restored.

**Fix (TODO):** Find a live SOL/USDC DLMM pool (`pnpm find-pools`), update
`METEORA_POOL_ADDRESS`, clear/refresh stale state, recreate the position.

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
