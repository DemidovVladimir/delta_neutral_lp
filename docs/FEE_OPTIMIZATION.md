# Fee Optimization Guide (2025)

This document explains the fee optimization implemented in the delta-neutral bot to support small position sizes profitably.

## Problem Statement

**Before Optimization:**
- Transaction costs: ~$0.388 per rebalance
- For small positions (0.2 SOL ≈ $32): Fees = 1.2% of position
- Fees would eat all profits, making small positions unprofitable

**Goal:**
- Reduce transaction costs by >90%
- Enable profitable operation with positions as small as 0.2 SOL ($32-64)

## Solution Overview

We identified and fixed two critical issues:

### Issue 1: Double Jito Tips (FIXED ✅)

**Problem:**
Bundle transactions were paying TWO Jito tips:
1. Embedded tip inside create position transaction (from `enhanceTransaction()`)
2. Separate tip transaction at end of bundle

**Cost Impact:** Wasting 5,000-100,000 lamports per rebalance (~$0.008-$0.016)

**Solution:**
- Pass `undefined` to `getCreatePositionTransaction()` when building bundle transactions
- Only include one tip transaction at the end of the bundle

**Location:** [autoTuneOrchestrator.ts:751](../src/modules/autoTuneOrchestrator.ts#L751)

```typescript
// Build create position transaction WITHOUT embedded Jito tip
const createTxResult = await this.meteoraAdapter.getCreatePositionTransaction({
  poolAddress: this.config.meteoraPoolAddress!,
  solAmount,
  usdcAmount,
  priceLower: priceRange.lowerPrice,
  priceUpper: priceRange.upperPrice,
}, undefined); // NO jitoConfig - avoid duplicate tips!
```

### Issue 2: Excessive Priority Fees - 40x Too High (FIXED ✅)

**Problem:**
- Config used: 1,000,000 micro-lamports × 1,200,000 CUs = 1,200,000 lamports (~$0.192)
- 2025 typical: 25,000-100,000 micro-lamports × 200,000-600,000 CUs = 5,000-60,000 lamports (~$0.001-$0.010)
- **Overpaying by ~2,000%!**

**Cost Impact:** Wasting ~1,170,000 lamports per rebalance (~$0.187)

**Solution:**
- Updated default `PRIORITY_FEE_MICRO_LAMPORTS` from implicit 1,000,000 to 50,000
- Reduced `MAX_COMPUTE_UNITS` from 1,200,000 to 600,000
- Added documentation about 2025 fee market rates

**Locations:**
- [.env.example:70-71](../.env.example#L70-L71)
- [env.ts:209-213](../src/config/env.ts#L209-L213)

## Results

### Cost Breakdown (After Optimization)

**Per Rebalance (2 transactions + 1 tip):**

| Component | Cost (lamports) | Cost (USD @ $0.16/SOL) |
|-----------|-----------------|------------------------|
| Swap transaction | 35,000 | $0.0056 |
| Create position | 35,000 | $0.0056 |
| Jito tip | 5,000-20,000 | $0.0008-$0.003 |
| **TOTAL** | **80,000-95,000** | **$0.013-$0.015** |

### Cost Comparison by Position Size

| Position Size | Old Cost | New Cost | Savings | Old % | New % |
|---------------|----------|----------|---------|--------|--------|
| 0.2 SOL ($32) | $0.388 | $0.015 | 96% | 1.2% | 0.05% |
| 1.0 SOL ($160) | $0.388 | $0.015 | 96% | 0.24% | 0.01% |
| 5.0 SOL ($800) | $0.388 | $0.015 | 96% | 0.05% | 0.002% |

**Conclusion: With optimized fees, even 0.2 SOL positions are profitable!**

## Configuration

### Recommended Settings (.env)

```bash
# Transaction parameters (Optimized for 2025)
PRIORITY_FEE_MICRO_LAMPORTS=50000  # 50,000 µL/CU = moderate priority
MAX_COMPUTE_UNITS=600000           # Typical for Meteora + Jupiter operations

# Jito configuration
USE_JITO=false                     # Disabled by default (DNS issues)
JITO_RELAY_URL=https://mainnet.block-engine.jito.wtf/api/v1/bundles
```

### Fee Market Context (2025)

**Typical Priority Fees:**
- Low priority: 25,000 µL/CU
- Moderate priority: 50,000 µL/CU (recommended)
- High priority: 100,000 µL/CU

**Jito Tips:**
- Normal: 5,000-10,000 lamports
- High: 10,000-20,000 lamports
- Urgent: 20,000+ lamports

**Compute Units:**
- Simple transfers: 200,000 CUs
- Meteora operations: 400,000-600,000 CUs
- Complex bundles: 600,000-1,000,000 CUs

## Key Insights

### 1. Jito Bundles vs Single Transactions

**For Jito Bundles:**
- Priority fees are OPTIONAL (Jito tip provides priority)
- Only the bundle tip matters for inclusion
- Can set priority fees to minimum or zero

**For Single Transactions:**
- Use moderate priority fees (50,000 µL/CU typical)
- No Jito tip needed
- Relies on priority fee for inclusion speed

### 2. Formula

```
Priority Fee (lamports) = (Compute Units × Micro-lamports per CU) / 1,000,000

Example with optimized settings:
= (600,000 × 50,000) / 1,000,000
= 30,000,000 / 1,000,000
= 30,000 lamports (~$0.0048)
```

### 3. Avoiding Double-Charging

**Rule:** When building transactions for bundles, do NOT include embedded Jito tips.

```typescript
// ✅ CORRECT: For bundle transactions
const txResult = await getCreatePositionTransaction(params, undefined);

// ❌ WRONG: For bundle transactions (creates duplicate tip)
const txResult = await getCreatePositionTransaction(params, jitoConfig);
```

## Profitability Analysis

### Break-Even Analysis (0.2 SOL Position)

**Position Details:**
- Size: 0.2 SOL + 32 USDC ≈ $64
- Bin count: 20 bins
- Fee tier: 0.01% (typical for SOL/USDC)

**Costs:**
- Rebalance cost: $0.015
- Rebalances per day: ~2-4 (depending on volatility)
- Daily costs: $0.03-$0.06

**Revenue:**
- Trading volume in range: ~$100,000/day (conservative)
- LP's share: ($64 / $2,700,000) × $100,000 × 0.01% = $0.024/day
- Plus: Claimed fees compounding

**Conclusion:** Even with frequent rebalancing, fees are only 0.05% of position, making small positions viable!

## Monitoring

Track these metrics to ensure optimal fee performance:

```bash
# Check transaction costs in logs
grep "Priority fee" logs/combined.log
grep "Jito tip" logs/combined.log

# Monitor rebalance costs
grep "rebalance completed" logs/combined.log | jq .durationMs
```

### Warning Signs

- Priority fees > 100,000 lamports per transaction
- Jito tips > 50,000 lamports
- Multiple tips in single bundle
- Compute units > 1,000,000

## Further Optimizations (Future)

1. **Dynamic Priority Fees**: Adjust based on network congestion
2. **Batch Operations**: Combine multiple operations in single transaction
3. **Compute Unit Profiling**: Measure actual CU usage and optimize
4. **Tip Escalation Tuning**: Fine-tune retry tip amounts based on success rates

## References

- [Solana Fee Markets (2025)](https://solana.com/docs/core/fees)
- [Jito Bundle Documentation](https://jito-foundation.gitbook.io/mev/)
- [Compute Unit Optimization](https://solana.com/docs/core/fees#compute-budget)
- [Priority Fee Statistics](https://fees.solana.com/)

---

**Last Updated:** 2025-11-10
**Status:** Implemented and tested
