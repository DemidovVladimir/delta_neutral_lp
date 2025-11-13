# Transaction Fee Tracking

This bot automatically tracks all transaction fees for accurate profit calculation.

## Overview

Transaction fees are stored in `data/state.json` under the `transactionFees` field. The system tracks:
- **Total fees in SOL** (actual amount paid)
- **Total fees in USD** (approximate, for convenience)
- **Operation count** (total number of transactions)
- **Breakdown by operation type** (create, swap, rebalance, etc.)
- **Transaction signatures** (for audit trail on Solscan)

## Fee Breakdown

### 1. `totalFeeSol` vs `totalFeeUsd`

**These are the SAME fees, just in different units:**

```typescript
// Example from state.json
{
  "totalFeeSol": 0.000015,      // Actual fee paid in SOL
  "totalFeeUsd": 0.0021,        // USD equivalent (for convenience)
  "operationCount": 2           // Number of transactions
}
```

**Important:** You only pay fees in SOL. The USD amount is calculated as:
```
totalFeeUsd = totalFeeSol × current_SOL_price
```

### 2. Operation Types

Fees are tracked separately by operation type:

| Operation | Description | Typical Cost (SOL) |
|-----------|-------------|-------------------|
| `createPosition` | New position creation | ~0.00001 (~$0.0016) |
| `withdrawClaimClose` | Withdraw + claim + close in 1 TX | ~0.000005 (~$0.0008) |
| `swap` | Jupiter token swap | ~0.00008 (~$0.013) |
| `rebalance` | Full rebalance cycle (multiple TXs) | ~0.00003 (~$0.0048) |

## Viewing Transaction Fees

### Command Line

```bash
# View complete fee summary
pnpm tsx src/test/view-transaction-fees.ts
```

**Example output:**
```
📊 Transaction Fee Summary
  totalFeeSol: 0.000023
  totalFeeUsd: 0.0033
  operationCount: 3

  └─ createPosition
    count: 1
    totalFeeSol: 0.000010
    totalFeeUsd: 0.0014
    avgFeeSol: 0.000010

  └─ swap
    count: 1
    totalFeeSol: 0.000008
    totalFeeUsd: 0.0011
    avgFeeSol: 0.000008

  └─ withdrawClaimClose
    count: 1
    totalFeeSol: 0.000005
    totalFeeUsd: 0.0007
    avgFeeSol: 0.000005
```

### Programmatic Access

```typescript
import { getTransactionFees } from './modules/persistence.js';

const fees = getTransactionFees();
if (fees) {
  console.log('Total fees paid:', fees.totalFeeSol, 'SOL');
  console.log('USD equivalent:', fees.totalFeeUsd);

  // Access breakdown
  for (const [operation, details] of Object.entries(fees.breakdown)) {
    console.log(`${operation}: ${details.totalFeeSol} SOL (${details.count} txs)`);
  }
}
```

## Profit Calculation

To calculate your net profit from auto-tune:

```typescript
// 1. Get LP fees earned (from auto-tune-state.json)
const autoTuneState = loadAutoTuneState();
const lpFeesEarnedSol = autoTuneState.totalClaimedFees.sol;
const lpFeesEarnedUsdc = autoTuneState.totalClaimedFees.usdc;
const lpFeesUsd = (lpFeesEarnedSol * solPrice) + lpFeesEarnedUsdc;

// 2. Get transaction fees paid (from state.json)
const txFees = getTransactionFees();
const txFeesPaidUsd = txFees.totalFeeUsd;

// 3. Calculate impermanent loss/gain
const initialValue = calculateInitialPositionValue();
const currentValue = calculateCurrentPositionValue();
const impermanentLossUsd = initialValue - currentValue;

// 4. Net profit
const netProfitUsd = lpFeesUsd - txFeesPaidUsd - impermanentLossUsd;
```

**Formula:**
```
Net Profit = LP Fees Earned - Transaction Fees - Impermanent Loss
```

## Example Scenario

**Starting position:**
- 1 SOL deposited @ $160/SOL = $160 value
- Created position: -0.00001 SOL fee

**After 5 rebalances:**
- LP fees earned: 0.05 SOL + 8 USDC = $16 @ $160/SOL
- Transaction fees: 0.00015 SOL = $0.024
- Impermanent loss: ~$2 (due to price movement)

**Net profit:**
```
$16.00 (LP fees) - $0.024 (TX fees) - $2.00 (IL) = $13.976 profit
```

**ROI:** 13.976 / 160 = 8.7% return

## Transaction Signatures

All transaction signatures are saved in the `signatures` array for each operation type. You can verify any transaction on:
- **Solscan**: https://solscan.io/tx/{signature}
- **Solana Explorer**: https://explorer.solana.com/tx/{signature}

Example:
```json
{
  "breakdown": {
    "swap": {
      "signatures": [
        "5G1N6iyzwq1T5eabxGHcuV88AwUgNpHXYKoiYUJ4ueaFJmH9usJPiKsSFfANEQgHaFw2bHqGyhxxZYDeDSeh7Yyi"
      ]
    }
  }
}
```

Click the signature link on Solscan to see:
- Exact fee paid
- Compute units consumed
- Program logs
- Account changes

## Automatic Tracking

Transaction fees are tracked automatically for:
- ✅ Position creation (`meteoraAdapter.createPosition`)
- ✅ Position closure (`meteoraAdapter.withdrawClaimAndClose`)
- ✅ Token swaps (`jupiterSwapper.executeSwap`)
- ✅ Rebalance operations (`autoTuneOrchestrator.executeRebalance`)

No manual intervention required - fees are logged to state.json after each transaction confirmation.

## State File Location

```
data/state.json
```

**Structure:**
```json
{
  "timestamp": 1763064486498,
  "createdPositionMints": ["F26PNgGidnRFirrjwne891zxhwGbzo6MSCwP6iT9Rn5D"],
  "transactionFees": {
    "totalFeeSol": 0.000015,
    "totalFeeUsd": 0.0021,
    "operationCount": 2,
    "breakdown": {
      "createPosition": { ... },
      "swap": { ... },
      "withdrawClaimClose": { ... }
    }
  }
}
```

## Troubleshooting

**Q: I don't see swap fees in my state.json**

A: Swap fees are only tracked when swaps are executed. If auto-tune hasn't performed any swaps yet (because your wallet already had sufficient balance), you won't see swap fees. Check your auto-tune logs for "Swapping SOL → USDC" or "Swapping USDC → SOL" messages.

**Q: The USD amounts seem wrong**

A: USD amounts are calculated using the current SOL price at the time of the transaction. If SOL price has changed significantly since then, the historical USD values may not reflect current prices. The SOL amounts are always accurate.

**Q: Can I reset the fee counter?**

A: Yes, but be careful! Fees are stored in `data/state.json`. To reset:

```bash
# Backup current state
cp data/state.json data/state.json.backup

# Edit state.json and remove the transactionFees field
# Or delete the entire file (will be recreated on next operation)
```

**Q: How accurate are the fees?**

A: Fee tracking fetches the actual transaction fees from the blockchain after confirmation. The SOL amounts are 100% accurate. USD conversions use the SOL price at tracking time, which may differ slightly from the exact price when the transaction was sent.
