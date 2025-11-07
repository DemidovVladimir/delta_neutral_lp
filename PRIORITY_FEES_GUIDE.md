# Priority Fees & Jito Configuration Guide

## Current Status

### Configuration (.env)
```bash
USE_JITO=true
JITO_RELAY_URL=https://mainnet.block-engine.jito.wtf/api/v1/bundles
PRIORITY_TIP_LAMPORTS=100000  # 0.0001 SOL (~$0.016 at $163/SOL)
MAX_COMPUTE_UNITS=1200000
```

### ⚠️ Current Implementation: **NOT USING JITO OR PRIORITY FEES**

**The bot currently:**
- ✅ Has Jito utilities implemented ([src/utils/jitoUtils.ts](src/utils/jitoUtils.ts))
- ✅ Has config variables set in .env
- ❌ **Does NOT use Jito when sending transactions**
- ❌ **Does NOT add priority fees (ComputeBudget instructions)**
- ❌ **Does NOT add Jito tips to transactions**

All transactions in [src/modules/meteoraAdapter.ts](src/modules/meteoraAdapter.ts) currently use:
```typescript
await connection.sendRawTransaction(tx.serialize(), {
  skipPreflight: false,
  preflightCommitment: 'confirmed',
});
```

This sends transactions **without priority fees or Jito tips**, relying only on base transaction fees (~5,000 lamports).

## What You Need to Know

### Priority Fees vs Jito Tips

**Priority Fees (Solana native)**
- Built into Solana protocol
- Added via ComputeBudget instructions
- Paid per compute unit consumed
- Helps transactions land faster during congestion
- Cost: Variable based on network demand
- Implementation: Add `setComputeUnitPrice` instruction

**Jito Tips**
- Third-party MEV protection service
- Separate tip payment to validators
- Guarantees transaction ordering in bundles
- Prevents front-running/sandwich attacks
- Cost: Fixed tip (1,000-100,000+ lamports depending on priority)
- Implementation: Add SystemProgram transfer to Jito tip account

### When to Use Each

**Use Priority Fees For:**
- General transactions during network congestion
- Ensuring timely inclusion in blocks
- Cost-effective for normal operations

**Use Jito For:**
- Emergency exits (atomic multi-tx operations)
- Time-sensitive rebalancing
- MEV protection (prevent sandwich attacks)
- Guaranteed transaction ordering

**Use Both For:**
- Critical operations that must land immediately
- High-value transactions requiring maximum protection

## Current Costs

### Base Transaction Fees (What You're Paying Now)
```
Position Creation:    ~5,000 lamports  ($0.0008)
Deposit:             ~5,000 lamports  ($0.0008)
Withdraw:            ~5,000 lamports  ($0.0008)
Claim Fees:          ~5,000 lamports  ($0.0008)
Close Position:      ~5,000 lamports  ($0.0008)
```

### With Priority Fees (Recommended)
```
Priority Fee: 1 microlamport per CU
Compute Units: ~50,000 CU (typical)
Additional Cost: ~50 lamports ($0.000008)

Total: ~5,050 lamports ($0.0008)
```

### With Jito Tips (Your Config: 100,000 lamports)
```
Base Fee:        ~5,000 lamports   ($0.0008)
Jito Tip:      100,000 lamports   ($0.0163)
──────────────────────────────────────────
Total:         105,000 lamports   ($0.0171)
```

**⚠️ Your PRIORITY_TIP_LAMPORTS=100000 is VERY HIGH**
- This is 20x the base transaction fee
- Appropriate for critical/emergency operations only
- For normal operations, 5,000-10,000 lamports is sufficient

## Recommended Configuration

### Option 1: Priority Fees Only (Recommended for Normal Operations)
```bash
USE_JITO=false
PRIORITY_TIP_LAMPORTS=0
PRIORITY_FEE_MICRO_LAMPORTS=1000  # 1 microlamport per CU
MAX_COMPUTE_UNITS=200000
```

**Pros:**
- Very low cost (~50-100 lamports extra)
- Helps during network congestion
- No external dependencies

**Cons:**
- No MEV protection
- No guaranteed ordering

### Option 2: Jito + Priority Fees (Recommended for Production)
```bash
USE_JITO=true
JITO_RELAY_URL=https://mainnet.block-engine.jito.wtf/api/v1/bundles
JITO_TIP_PRIORITY=normal  # normal, high, urgent, critical
PRIORITY_FEE_MICRO_LAMPORTS=1000
MAX_COMPUTE_UNITS=200000
```

**Use dynamic Jito tips based on operation type:**
- Position creation: `normal` (5,000 lamports)
- Fee claiming: `low` (1,000 lamports)
- Rebalancing: `high` (10,000 lamports)
- Emergency exit: `critical` (100,000 lamports)

**Pros:**
- MEV protection
- Guaranteed ordering for bundles
- Cost-effective with dynamic pricing

**Cons:**
- Slightly higher cost
- External dependency on Jito

### Option 3: Base Fees Only (Current - Not Recommended)
```bash
USE_JITO=false
PRIORITY_TIP_LAMPORTS=0
```

**Only use for:**
- Testing on localnet
- Low-value operations
- When costs are critical

## How to Implement Priority Fees

### Step 1: Add ComputeBudget Instructions

Add this import to meteoraAdapter.ts:
```typescript
import { ComputeBudgetProgram } from '@solana/web3.js';
```

### Step 2: Add Priority Fee Instructions

Before sending transactions, add:
```typescript
// Example: In createPosition method
const priorityFee = ComputeBudgetProgram.setComputeUnitPrice({
  microLamports: 1000, // 1 microlamport per CU
});

const computeLimit = ComputeBudgetProgram.setComputeUnitLimit({
  units: 200000, // Adjust based on actual usage
});

// Add to transaction before signing
tx.add(priorityFee);
tx.add(computeLimit);
```

### Step 3: Add Jito Tips (Optional)

```typescript
import { createEnhancedJitoTipInstruction } from '../utils/jitoUtils.js';

// For normal operations
const jitoTip = await createEnhancedJitoTipInstruction(wallet.publicKey, {
  priority: 'normal',
  attempt: 0,
});

tx.add(jitoTip);
```

## Cost Comparison Examples

### Example 1: Claiming Fees (2 transactions)

**Current (no priority/Jito):**
```
Tx 1: 5,000 lamports
Tx 2: 5,000 lamports
Total: 10,000 lamports ($0.0016)
```

**With Priority Fees:**
```
Tx 1: 5,000 + 50 = 5,050 lamports
Tx 2: 5,000 + 50 = 5,050 lamports
Total: 10,100 lamports ($0.0016)
Extra cost: $0.00001
```

**With Jito (your config):**
```
Tx 1: 5,000 + 100,000 = 105,000 lamports
Tx 2: 5,000 + 100,000 = 105,000 lamports
Total: 210,000 lamports ($0.034)
Extra cost: $0.032
```

**With Jito (low priority):**
```
Tx 1: 5,000 + 1,000 = 6,000 lamports
Tx 2: 5,000 + 1,000 = 6,000 lamports
Total: 12,000 lamports ($0.002)
Extra cost: $0.0004
```

### Example 2: Emergency Exit (withdraw + claim + swap + hedge)

**With Jito (critical priority):**
```
4 txs × (5,000 + 100,000) = 420,000 lamports ($0.068)
```

**Justification:** For a $10,000 emergency exit, $0.068 is 0.00068% - acceptable for guaranteed execution

## Recommendations

### For Your Use Case (Delta-Neutral Bot)

1. **Normal Operations (Position creation, deposits, withdrawals):**
   - Use priority fees only (1,000 microlamports)
   - Cost: ~$0.0008 per tx (negligible increase)
   - Skip Jito unless network is congested

2. **Fee Claiming:**
   - Use low priority or no fees
   - Not time-sensitive, can wait
   - Cost: base fee only

3. **Rebalancing:**
   - Use priority fees + Jito (normal priority)
   - Prevent front-running
   - Cost: ~$0.002 per tx

4. **Emergency Exits:**
   - Use priority fees + Jito (critical priority)
   - Guaranteed execution essential
   - Cost: ~$0.02 per tx (acceptable for emergencies)

### Update Your .env

```bash
# For production delta-neutral bot
USE_JITO=true
JITO_RELAY_URL=https://mainnet.block-engine.jito.wtf/api/v1/bundles

# Use dynamic tips based on operation type (implemented in code)
# Don't set a fixed PRIORITY_TIP_LAMPORTS

# Priority fees for network congestion
PRIORITY_FEE_MICRO_LAMPORTS=1000  # 1 microlamport per CU
MAX_COMPUTE_UNITS=200000

# Emergency exit settings
EMERGENCY_JITO_PRIORITY=critical
EMERGENCY_MAX_TIP_LAMPORTS=100000
```

## Summary

**Current state:** You're configured for Jito with very high tips (100k lamports), but NOT using it.

**Recommended next steps:**
1. ✅ Keep USE_JITO=true in .env
2. ✅ Reduce PRIORITY_TIP_LAMPORTS to 5000-10000 for normal ops
3. ✅ Implement dynamic Jito tips in code (use existing jitoUtils)
4. ✅ Add ComputeBudget instructions for priority fees
5. ✅ Use operation-specific priority levels

**Cost impact:**
- Current: ~$0.0008 per transaction
- With priority fees: ~$0.0009 per transaction (+$0.0001)
- With Jito (normal): ~$0.002 per transaction (+$0.0012)
- Worth it for MEV protection and guaranteed execution
