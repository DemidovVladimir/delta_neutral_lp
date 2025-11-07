# Quick Start Guide - Meteora LP UI

Get the UI running in 3 minutes!

## Prerequisites

- Node.js 18+ installed
- A Solana wallet with some SOL
- RPC endpoint (can use public: `https://api.mainnet-beta.solana.com`)

## Step 1: Environment Setup

Create `.env` file in project root:

```bash
# Copy example (if available) or create new
cp .env.example .env

# Or create manually with these required fields:
cat > .env << 'EOF'
# Solana RPC
RPC_URL=https://api.mainnet-beta.solana.com

# Your wallet private key (base58 format)
PRIVATE_KEY=your_private_key_here

# Meteora SOL/USDC pool (1 Bin Step)
METEORA_POOL_ADDRESS=Agxw5VTjEaUt4NcK9r6cA5HuVVcpJFcbw6LZG5tbxvcT

# Auto-create position settings
AUTO_CREATE_POSITIONS=true
INITIAL_DEPOSIT_SOL=0.1
INITIAL_DEPOSIT_USDC=0
PRICE_RANGE_BPS_LOWER=-100
PRICE_RANGE_BPS_UPPER=100

# API port (optional, default 3001)
API_PORT=3001
EOF
```

## Step 2: Install Dependencies

```bash
# Install npm dependencies (includes Hono, concurrently)
npm install

# Install UI dependencies (Bun will be installed if not present)
export PATH="$HOME/.bun/bin:$PATH"
cd ui && bun install && cd ..
```

## Step 3: Run the App

```bash
# Start both API and UI servers
npm run dev
```

This will start:
- **API Server**: http://localhost:3001
- **UI Server**: http://localhost:3000

Open http://localhost:3000 in your browser!

## What You'll See

### 1. Oracle Prices (Top Left)
- Current SOL/USD price from Pyth oracle
- SOL/USDC rate from Jupiter
- Price divergence warning if sources differ

### 2. Pool Analytics (Top Right)
- APR/APY from Meteora pool
- 24h volume and fees
- Pool configuration (bin step, fees)

### 3. Bin Visualization (Middle)
- Chart showing price distribution across bins
- Red line = active bin (current price)
- Green lines = your position range
- Blue line = price curve

### 4. Position Manager (Bottom)
Four tabs:
- **View Positions**: See your LP exposure and fees
- **Create Position**: Make new LP positions
- **Deposit**: Add liquidity to existing position
- **Withdraw**: Remove liquidity

## Quick Actions

### Create Your First Position

1. Click **"Create Position"** tab
2. Enter SOL amount (e.g., `0.1`)
3. Set price range (e.g., `1` for ±1%)
4. Click **"Create Position"**
5. Wait for transaction confirmation
6. Position will appear in **"View Positions"** tab

### Claim Fees

1. Go to **"View Positions"** tab
2. If "Claimable SOL/USDC" > 0, you'll see a button
3. Click **"💰 Claim Fees"**
4. Fees will be sent to your wallet

### Adjust Position Range

The bin visualization shows:
- If price is outside your green range → you're not earning fees
- If price is inside your range → you're earning fees

To adjust:
1. Withdraw from old position (100%)
2. Create new position with better range

## Troubleshooting

### "Failed to fetch data from API"

**Check API is running**:
```bash
curl http://localhost:3001/api/health
# Should return: {"status":"ok","timestamp":...}
```

**If not running**:
```bash
# Terminal 1: Start API manually
npm run api

# Terminal 2: Start UI
npm run ui
```

### "Failed to create position"

**Check wallet balance**:
```bash
solana balance <your-public-key>
```

You need at least:
- Position amount (e.g., 0.1 SOL)
- Extra 0.1 SOL for rent + fees

**Check pool address** is correct in `.env`

### "No positions found"

If you set `AUTO_CREATE_POSITIONS=true`:
- Position is created on first API start
- Check `data/state.json` for saved position mints
- Check API logs for creation status

If using existing positions:
- Set `AUTO_CREATE_POSITIONS=false`
- Add `METEORA_POSITION_MINTS=mint1,mint2` to `.env`

### Bun not found

```bash
# Install Bun
curl -fsSL https://bun.sh/install | bash

# Add to PATH
export PATH="$HOME/.bun/bin:$PATH"

# Verify
bun --version
```

## Development Tips

### View API Logs

API server logs to console with Winston:
```bash
npm run api
# Watch for errors, transaction signatures, etc.
```

### Test API Endpoints

```bash
# Health check
curl http://localhost:3001/api/health

# Get prices
curl http://localhost:3001/api/prices | jq

# Get pool analytics
curl http://localhost:3001/api/pool/analytics | jq

# Get bins
curl http://localhost:3001/api/pool/bins | jq

# Get positions
curl http://localhost:3001/api/positions | jq
```

### Change Ports

Edit `.env`:
```bash
API_PORT=4000  # API on port 4000
```

Edit `ui/src/config.ts`:
```typescript
export const API_BASE_URL = 'http://localhost:4000';
```

Restart servers.

### Use Custom Pool

Find pools:
```bash
npm run find-pools
```

Copy pool address to `.env`:
```bash
METEORA_POOL_ADDRESS=<your-pool-address>
```

## Next Steps

1. **Read the full docs**: [UI_README.md](UI_README.md)
2. **Understand the architecture**: See "Architecture" section in README
3. **Explore the code**:
   - API: `src/api/hono-server.ts`
   - UI: `ui/src/App.tsx`
   - Components: `ui/src/components/`
4. **Test integration**: `npm run test:integration`

## Common Pool Addresses

**Meteora SOL/USDC Pools** (mainnet):

- **1 Bin Step** (0.01% per bin): `Agxw5VTjEaUt4NcK9r6cA5HuVVcpJFcbw6LZG5tbxvcT`
- **4 Bin Step** (0.04% per bin): `5rCf1DM8LjKTw4YqhnoLcngyZYeNnQqztScTogYHAS6`
- **10 Bin Step** (0.1% per bin): `CkAA1rmcmJGCjPDaGSXMXo2wCnT1RGRuXNJaDBq6oGjG`

Smaller bin steps = tighter ranges, better for stable price ranges.

## Support

- GitHub Issues: [Create Issue](https://github.com/your-repo/issues)
- Check existing integration tests: `npm run test:integration`
- Review logs: API logs show detailed error messages

## Architecture Diagram

```
┌─────────────────────────────────────┐
│         Browser (localhost:3000)    │
│  ┌───────────────────────────────┐  │
│  │       React UI                │  │
│  │  - Price Display             │  │
│  │  - Bin Visualization         │  │
│  │  - Position Management       │  │
│  └───────────┬───────────────────┘  │
└──────────────┼──────────────────────┘
               │ HTTP/JSON
               │
┌──────────────▼──────────────────────┐
│      Bun + Hono API (port 3001)     │
│  ┌───────────────────────────────┐  │
│  │     API Routes                │  │
│  │  /api/prices                  │  │
│  │  /api/pool/*                  │  │
│  │  /api/positions/*             │  │
│  └───────────┬───────────────────┘  │
└──────────────┼──────────────────────┘
               │ Function Calls
               │
┌──────────────▼──────────────────────┐
│       Existing Bot Modules          │
│  ┌─────────────────────────────┐   │
│  │  MeteoraAdapter             │   │
│  │  - createPosition()         │   │
│  │  - getLpExposure()          │   │
│  │  - depositToLp()            │   │
│  │  - withdrawFromLp()         │   │
│  │  - claimFees()              │   │
│  └─────────────────────────────┘   │
│  ┌─────────────────────────────┐   │
│  │  PriceOracle                │   │
│  │  - getSolPrice() (Pyth)     │   │
│  │  - getMultiTokenPrices()    │   │
│  └─────────────────────────────┘   │
└──────────────┬──────────────────────┘
               │ Solana Web3.js
               │
┌──────────────▼──────────────────────┐
│           Solana Blockchain         │
│  - Meteora DLMM Program             │
│  - Pyth Oracle                      │
│  - Jupiter Aggregator               │
└─────────────────────────────────────┘
```

That's it! You're ready to manage Meteora LP positions with the UI. 🎉
