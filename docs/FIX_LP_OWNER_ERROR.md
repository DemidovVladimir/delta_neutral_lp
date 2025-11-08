# Fix: "Missing required environment variable: LP_OWNER"

## The Issue

You're seeing this error:
```
Failed to fetch LP positions
Error: Missing required environment variable: LP_OWNER
```

This happens because you have `AUTO_CREATE_POSITIONS=false` in your `.env`, which means you want to use **existing** Meteora positions instead of auto-creating them.

## Solution: Add Missing Variables

You need to add two variables to your `.env` file:

### Option 1: Use Existing Positions (Current Mode)

If you already have Meteora LP positions, add these to `.env`:

```bash
# Your wallet's public key (the owner of the positions)
LP_OWNER=YourWalletPublicKeyHere

# Comma-separated list of your position NFT mint addresses
METEORA_POSITION_MINTS=PositionMint1,PositionMint2,PositionMint3
```

**How to find your position mints:**
1. Go to [Meteora DLMM UI](https://dlmm.meteora.ag/)
2. Connect your wallet
3. View your positions
4. Copy the NFT mint addresses

### Option 2: Auto-Create Positions (Easier)

If you want the bot to create positions automatically:

```bash
# Change this in your .env
AUTO_CREATE_POSITIONS=true

# Remove these (not needed for auto-create)
# LP_OWNER=...
# METEORA_POSITION_MINTS=...

# Make sure these are set
METEORA_POOL_ADDRESS=8gJ7UWboMeQ6z6AQwFP3cAZwSYG8udVS2UesyCbH79r7
INITIAL_DEPOSIT_SOL=0.1
INITIAL_DEPOSIT_USDC=0
PRICE_RANGE_BPS_LOWER=-100
PRICE_RANGE_BPS_UPPER=100
```

## Quick Fix Commands

### For Option 1 (Use Existing Positions)

```bash
# Edit .env and add your values
cat >> .env << 'EOF'

# Your wallet public key
LP_OWNER=YourPublicKeyHere

# Your position NFT mints (comma-separated)
METEORA_POSITION_MINTS=mint1,mint2
EOF
```

### For Option 2 (Auto-Create - Recommended)

```bash
# Update AUTO_CREATE_POSITIONS in .env
sed -i.bak 's/AUTO_CREATE_POSITIONS=false/AUTO_CREATE_POSITIONS=true/' .env

# Verify it was changed
grep AUTO_CREATE_POSITIONS .env
```

## Get Your Wallet Public Key

If you need your wallet's public key from your private key:

```bash
# Using Node.js
node -e "
const bs58 = require('bs58');
const { Keypair } = require('@solana/web3.js');
const dotenv = require('dotenv');
dotenv.config();

const privateKey = process.env.PRIVATE_KEY;
let keypair;

try {
  // Try base58 format
  const decoded = bs58.decode(privateKey);
  keypair = Keypair.fromSecretKey(decoded);
} catch {
  // Try array format
  const secretKey = Uint8Array.from(privateKey.split(',').map(Number));
  keypair = Keypair.fromSecretKey(secretKey);
}

console.log('Your Public Key:', keypair.publicKey.toBase58());
"
```

Or use this TypeScript snippet:

```typescript
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';

const privateKey = process.env.PRIVATE_KEY!;
const decoded = bs58.decode(privateKey);
const keypair = Keypair.fromSecretKey(decoded);
console.log('Public Key:', keypair.publicKey.toBase58());
```

## Complete Example .env

### Auto-Create Mode (Recommended for New Users)

```bash
# Core Configuration
RPC_URL=https://mainnet.helius-rpc.com/?api-key=5c8025cb-1a7b-4b16-ac04-cde6c9e293e3
PRIVATE_KEY=your_private_key_here

# Auto-Create Position Settings
AUTO_CREATE_POSITIONS=true
METEORA_POOL_ADDRESS=8gJ7UWboMeQ6z6AQwFP3cAZwSYG8udVS2UesyCbH79r7
INITIAL_DEPOSIT_SOL=0.1
INITIAL_DEPOSIT_USDC=0
PRICE_RANGE_BPS_LOWER=-100
PRICE_RANGE_BPS_UPPER=100

# Risk Parameters
DELTA_THRESHOLD_SOL=2
MIN_COLLATERAL_RATIO=0.15
MAX_SHORT_NOTIONAL_USD=12000
FUNDING_RATE_CAP_BPS=80

# Execution
USE_JITO=true
PRIORITY_TIP_LAMPORTS=80000
MAX_COMPUTE_UNITS=1200000
```

### Manual Mode (Use Existing Positions)

```bash
# Core Configuration
RPC_URL=https://mainnet.helius-rpc.com/?api-key=5c8025cb-1a7b-4b16-ac04-cde6c9e293e3
PRIVATE_KEY=your_private_key_here

# Manual Position Settings
AUTO_CREATE_POSITIONS=false
LP_OWNER=YourWalletPublicKeyHere
METEORA_POSITION_MINTS=PositionMint1,PositionMint2
METEORA_POOL_ADDRESS=8gJ7UWboMeQ6z6AQwFP3cAZwSYG8udVS2UesyCbH79r7

# Risk Parameters (same as above)
# ...
```

## After Fixing

1. **Restart the API server** (Ctrl+C and restart):
```bash
export PATH="$HOME/.bun/bin:$PATH"
bun run src/api/hono-server.ts
```

2. **Test the positions endpoint**:
```bash
curl http://localhost:3001/api/positions
```

You should now see your positions instead of an error!

3. **Refresh the UI**:
Go to http://localhost:3000 and click the refresh button.

## Verification

Test that it works:

```bash
# Should return position data (not error)
curl http://localhost:3001/api/positions | jq

# Should show pool info
curl http://localhost:3001/api/pool/analytics | jq .name

# Should show prices
curl http://localhost:3001/api/prices | jq .sol.usd
```

## Why This Happens

The MeteoraAdapter has two modes:

**Auto-Create Mode** (`AUTO_CREATE_POSITIONS=true`):
- Bot creates positions automatically
- Saves position mints to `data/state.json`
- Requires: `METEORA_POOL_ADDRESS`, `INITIAL_DEPOSIT_SOL`, etc.

**Manual Mode** (`AUTO_CREATE_POSITIONS=false`):
- You provide existing position NFT mints
- Requires: `LP_OWNER` and `METEORA_POSITION_MINTS`

You had Manual Mode enabled but didn't provide the required variables.

## Recommendation

For most users, **Auto-Create Mode is easier**:

```bash
# Just set this in .env
AUTO_CREATE_POSITIONS=true
```

The bot will:
1. Create a position on first run
2. Save the position mint to `data/state.json`
3. Reuse that position on subsequent runs
4. Display it in the UI

No need to manually find position mints or public keys!

## Still Having Issues?

Check the API server logs - they show detailed error messages:

```bash
# In the terminal running the API server
# You should see logs like:
# [info] MeteoraAdapter initialized in auto-create mode
# [info] Position created successfully
```

Or test programmatically:

```bash
# Run this test script
npm run test:mainnet
```

## Summary

**Quick fix:**
```bash
# Edit .env - Change this line:
AUTO_CREATE_POSITIONS=false
# To:
AUTO_CREATE_POSITIONS=true

# Then restart API server
```

That's it! The UI should now work correctly.
