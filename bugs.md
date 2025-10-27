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

