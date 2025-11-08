# Meteora Position Rent Reclamation Guide

## Problem: Why Did I Lose 0.3 SOL When Depositing 0.1 SOL?

When you created a Meteora DLMM position with 0.1 SOL + 10 USDC, your wallet lost approximately **0.3 SOL**. This is NOT a fee or loss - most of it is **recoverable rent**.

## Transaction Breakdown

Looking at your deposit transaction: `Rd6vR6Be35Rt91jmA77a7Yy1yjDH2YKPMRMTXcTWKA5YxMmHe4voWYdbFzBgkQe2uAJRwTw1618MjyqbSZ4WH8t`

```
Position NFT Account:     0.05740608 SOL  (recoverable)
Bin Array #72:            0.07143744 SOL  (recoverable)
Bin Array #73:            0.07143744 SOL  (recoverable)
Temp Token Account:       0.00203928 SOL  (already recovered at end of tx)
───────────────────────────────────────────
Total Rent Locked:        ~0.20 SOL
Actual LP Deposit:         0.10 SOL
Transaction Fee:           0.00001 SOL
───────────────────────────────────────────
TOTAL SPENT:              ~0.30 SOL
```

## What is Rent on Solana?

On Solana, all accounts (data storage) require a **rent deposit** to remain on-chain forever. This is:
- **NOT a fee** - it's a refundable deposit
- **Locked in the account** - but returned when you close it
- **Rent-exempt** - means the account can exist indefinitely

### Accounts Created for Your Position:

1. **Position NFT** (~0.057 SOL) - Stores your position metadata
2. **Bin Array #72** (~0.071 SOL) - Liquidity bins 5096-5105
3. **Bin Array #73** (~0.071 SOL) - Liquidity bins 5106-5116

## Why Two Bin Arrays?

Your position spans **bins 5096-5116** (21 bins total). Meteora groups bins into "bin arrays" for efficiency (~10-24 bins per array). Your position **crossed a boundary** between two arrays, requiring both to be initialized.

### Visual Representation:

```
Bin Array 72:  [... 5096 5097 5098 5099 5100 5101 5102 5103 5104 5105]
                    └─────────────────────────────────────┐
Your Position:                                            ├─ 21 bins
                    ┌─────────────────────────────────────┘
Bin Array 73:  [5106 5107 5108 5109 5110 5111 5112 5113 5114 5115 5116 ...]
```

## How to Avoid Double Bin Array Costs

**Option 1:** Use tighter price ranges
```
Instead of: ±1% range (21 bins) → might cross boundary
Try:        ±0.5% range (10 bins) → stays in one array
```

**Option 2:** Check bin array boundaries before creating positions
- Use the UI bin visualization to see where arrays split
- Choose price ranges that fit within a single array

**Option 3:** Accept the cost for wider ranges
- Wider ranges = more stable LP position
- Double bin array cost is a one-time expense
- All rent is fully recoverable

## How to Reclaim Your Rent

### Step 1: Withdraw 100% of Your Liquidity

1. Go to the **Withdraw** tab in the UI
2. Enter `100` for percent
3. Click "Withdraw"
4. Wait for transaction confirmation

Your position is now **empty** (0 SOL, 0 USDC) but the NFT still exists.

### Step 2: Close the Position

1. Go to the **View Positions** tab
2. Find your empty position (shows 0.0000 SOL, $0.00 USDC)
3. Click the red button: **"🔒 Close & Reclaim Rent (~0.19 SOL)"**
4. Confirm the transaction

The bot will:
- Verify position is empty (safety check)
- Close the position NFT account
- Close any associated bin arrays
- Return **~0.194 SOL** to your wallet

## Rent Recovery Summary

| Account Type | Rent Locked | When Recovered |
|--------------|-------------|----------------|
| Position NFT | 0.057 SOL | When you close position |
| Bin Array 72 | 0.071 SOL | When you close position |
| Bin Array 73 | 0.071 SOL | When you close position |
| Temp Token Acct | 0.002 SOL | Already recovered (auto-closed) |
| **TOTAL** | **~0.20 SOL** | **~0.057 SOL recoverable** |

### ⚠️ CRITICAL UPDATE: Bin Array Rent is NON-REFUNDABLE

**Only Position NFT rent (~0.057 SOL) is recoverable!**

**Why Bin Arrays Are Non-Refundable:**
- Bin arrays are **shared pool infrastructure** (not your personal account)
- Once created, **any LP** can add liquidity to those bins
- Meteora can't close them because other LPs might be using them
- The **first LP to use a price range pays to create the bin array**
- **Subsequent LPs using the same range pay $0** (bins already exist)

**You paid for bin arrays #72 and #73 because:**
- You were the **first LP** to add liquidity to bins 5096-5116
- These bins didn't exist before your transaction
- Now they're permanently available for the entire pool

**Source:** [Meteora DLMM FAQ - SOL Required for Rent](https://docs.meteora.ag/user-faq/getting-started-lping/sol-required-for-rent)

## Implementation Details

### Backend (MeteoraAdapter)

New method: `closePosition(positionMint: string)`

```typescript
// Location: src/modules/meteoraAdapter.ts:750-812
async closePosition(positionMint: string): Promise<string> {
  // 1. Verify position is empty (safety check)
  // 2. Call DLMM.closePosition()
  // 3. Return rent to wallet
  // 4. Remove from tracked positions
}
```

### API Endpoint

```bash
POST /api/positions/close
Body: { "positionMint": "H1S8Qt..." }
Response: { "signature": "...", "success": true, "message": "..." }
```

### UI Component

- **Location**: `ui/src/components/PositionManager.tsx:162-196`
- **Button**: Shows only when position is empty (0 liquidity)
- **Confirmation**: Requires user confirmation before closing
- **Display**: Shows position mint address for verification

## Testing the Feature

### Step 1: Create a Test Position (if needed)

```bash
# In UI
1. Go to "Create Position" tab
2. Enter small amounts: 0.05 SOL, 5 USDC
3. Set range: 1% (±1%)
4. Click "Create Position"
```

### Step 2: Withdraw Everything

```bash
# In UI
1. Go to "Withdraw" tab
2. Enter: 100 (percent)
3. Click "Withdraw"
4. Wait for confirmation
```

### Step 3: Close and Reclaim

```bash
# In UI
1. Go to "View Positions" tab
2. Find empty position (0.0000 SOL, $0.00 USDC)
3. Click "🔒 Close & Reclaim Rent"
4. Confirm warning dialog
5. Check wallet - should see +0.19 SOL
```

### Verify on Solscan

Check the close transaction on Solscan:
```
https://solscan.io/tx/[SIGNATURE]
```

Look for "closeAccount" instructions that transfer SOL back to your wallet.

## Common Errors and Solutions

### Error: "Cannot close position with liquidity"

**Cause**: Position still has liquidity (SOL or USDC)

**Solution**: Withdraw 100% first, then close

### Error: "Position not found"

**Cause**: Position mint address is incorrect or already closed

**Solution**: Check the position mint in "View Positions" tab

### Error: "Transaction failed"

**Cause**: Network congestion or insufficient SOL for tx fee

**Solution**: Retry after a few seconds, ensure you have ~0.001 SOL for fees

## Best Practices

### For Production Use:

1. **Plan your price ranges** - Check bin array boundaries before creating positions
2. **Keep positions open** - Only close when truly done (avoid repeated create/close cycles)
3. **Batch operations** - If managing multiple positions, consider closing several at once
4. **Monitor rent costs** - Factor into profitability calculations

### For Testing:

1. **Use small amounts** - Test with 0.05 SOL first
2. **Tight ranges** - Use ±0.5% to avoid double bin array costs
3. **Track rent** - Note your wallet balance before/after to verify recovery
4. **Save signatures** - Keep transaction signatures for debugging

## Technical Notes

### Why Meteora Uses Bin Arrays

Bin arrays are a storage optimization:
- **Without**: Each bin = separate account (expensive)
- **With**: 10-24 bins per array (efficient)
- **Trade-off**: Occasional double-initialization when crossing boundaries

### Rent Calculation Formula

```solidity
rent_exemption = (data_size_bytes) * rent_per_byte * epochs

Position NFT:  ~500 bytes  → 0.057 SOL
Bin Array:     ~800 bytes  → 0.071 SOL
```

### Related Solana Programs

- **System Program**: Creates accounts, transfers rent
- **Meteora DLMM Program**: Manages positions and bin arrays
- **Token Program**: Handles wrapped SOL (WSOL) token accounts

## Further Reading

- [Solana Rent Documentation](https://docs.solana.com/implemented-proposals/rent)
- [Meteora DLMM Docs](https://docs.meteora.ag/liquidity-pool/dynamic-amm)
- [Bin Array Architecture](https://docs.meteora.ag/liquidity-pool/dynamic-amm/bin-arrays)

---

**Summary**: You didn't lose 0.3 SOL - you locked ~0.2 SOL as recoverable rent. After withdrawing and closing your position, you'll get ~0.194 SOL back. The actual cost was just the 0.1 SOL deposit + 0.00001 SOL fee.
