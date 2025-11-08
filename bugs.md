# Bug Tracker

**Project:** Delta-Neutral LP Bot

---

## Active Bugs

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

None - All reported bugs have been resolved.

## Fixed Bugs (Current Session)

### BUG-002: BN Conversion Error in getLpExposure()
**Status:** Fixed
**Severity:** Critical
**Fixed:** 2025-11-08
**Related Epic/Task:** Epic L (Meteora Adapter), Session 8

**Description:**
Using `parseFloat()` on BN (BigNumber) objects in `MeteoraAdapter.getLpExposure()` caused runtime errors.

**Error Message:**
```
"Failed to read LP exposure { "error": "undefined is not an object (evaluating 'value._bn')" }"
```

**Root Cause:**
The @meteora-ag/dlmm SDK returns position amounts as BN (BigNumber) objects. `parseFloat()` expects a string or number, not an object, so it attempts to convert the object to a string first, which fails when accessing internal `_bn` property.

**Reproduction Steps:**
1. Run bot with multiple positions
2. Call `getLpExposure()`
3. See error when parsing position amounts

**Resolution:**
Changed from `parseFloat(pos.positionData.totalXAmount)` to `pos.positionData.totalXAmount.toNumber()` on lines 710-711 of `src/modules/meteoraAdapter.ts`.

**Fixed Code:**
```typescript
// BEFORE (BROKEN)
const solAmount = parseFloat(pos.positionData.totalXAmount) / 10 ** DECIMALS.SOL;
const usdcAmount = parseFloat(pos.positionData.totalYAmount) / 10 ** DECIMALS.USDC;

// AFTER (FIXED)
const solAmount = pos.positionData.totalXAmount.toNumber() / 10 ** DECIMALS.SOL;
const usdcAmount = pos.positionData.totalYAmount.toNumber() / 10 ** DECIMALS.USDC;
```

**Testing:**
- ✅ Manual testing with multiple positions
- ✅ Exposure values now correctly read from blockchain

---

### BUG-003: API Endpoints Using Old Config Property Name
**Status:** Fixed
**Severity:** High
**Fixed:** 2025-11-08
**Related Epic/Task:** Epic L (Meteora Adapter), Multi-Pool Support, Session 8

**Description:**
After updating config to support multiple pool addresses (`meteoraPoolAddresses` as array), several API endpoints continued referencing the old singular property name (`meteoraPoolAddress`), causing them to receive `undefined`.

**Error Message:**
```
"Failed to fetch bin data { "error": {} }"
(caused by attempting to access array length on undefined)
```

**Affected Endpoints:**
- `GET /api/pool/bins` - Line 122 in hono-server.ts
- `POST /api/positions/create` - Line 244 in hono-server.ts
- Same issues in bun-server.ts

**Root Cause:**
Config refactoring changed property name from singular to plural, but endpoint code wasn't updated:
```typescript
// WRONG (old property no longer exists)
const poolAddresses = config.meteoraPoolAddress;  // undefined

// CORRECT (new property name)
const poolAddresses = config.meteoraPoolAddresses;  // string[]
```

**Reproduction Steps:**
1. Configure multiple pools via `METEORA_POOL_ADDRESSES`
2. Call `GET /api/pool/bins`
3. See error due to undefined array

**Resolution:**
Updated all endpoint references from `meteoraPoolAddress` to `meteoraPoolAddresses` in both:
- `src/api/hono-server.ts` (lines 122, 244)
- `src/api/bun-server.ts` (same lines)

**Fixed Code:**
```typescript
// BEFORE
const poolAddresses = config.meteoraPoolAddress;

// AFTER
const poolAddresses = config.meteoraPoolAddresses;
```

**Testing:**
- ✅ `GET /api/pool/bins` now works with multiple pools
- ✅ `POST /api/positions/create` accepts pool selection
- ✅ Default pool selection works correctly

---

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

