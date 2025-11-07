# UI Setup - Fixed Version

## The Problem

The original UI server wasn't properly building the React app. I've fixed this and created an easy startup script.

## Quick Start (30 seconds)

```bash
# 1. Make sure you have .env configured
cat .env | grep RPC_URL
# If empty, see configuration below

# 2. Run the startup script
./start-ui.sh
```

That's it! The script will:
- ✅ Check Bun is installed (install if needed)
- ✅ Install dependencies (if needed)
- ✅ Start API server (port 3001)
- ✅ Start UI server (port 3000)
- ✅ Open browser automatically

## Configuration Required

Create `.env` in the project root:

```bash
cat > .env << 'EOF'
# Solana RPC
RPC_URL=https://api.mainnet-beta.solana.com

# Your wallet private key
PRIVATE_KEY=your_private_key_here

# Meteora pool address
METEORA_POOL_ADDRESS=Agxw5VTjEaUt4NcK9r6cA5HuVVcpJFcbw6LZG5tbxvcT

# Auto-create position
AUTO_CREATE_POSITIONS=true
INITIAL_DEPOSIT_SOL=0.1
INITIAL_DEPOSIT_USDC=0
PRICE_RANGE_BPS_LOWER=-100
PRICE_RANGE_BPS_UPPER=100
EOF
```

Replace `your_private_key_here` with your actual wallet private key (base58 format).

## What Was Fixed

### Issue 1: React Not Transpiling
**Problem**: Bun was serving raw `.tsx` files without transpilation
**Fix**: Updated `ui/server.ts` to use `Bun.build()` before serving

### Issue 2: CSS Not Loading
**Problem**: CSS import in React wasn't working
**Fix**: Moved CSS to `<link>` tag in HTML

### Issue 3: Module Resolution
**Problem**: React imports not resolving correctly
**Fix**: Proper build configuration with explicit target

## Manual Start (Alternative)

If the script doesn't work, start manually:

```bash
# Terminal 1: API Server
export PATH="$HOME/.bun/bin:$PATH"
bun run src/api/hono-server.ts

# Terminal 2: UI Server
export PATH="$HOME/.bun/bin:$PATH"
cd ui && bun run server.ts
```

Then open http://localhost:3000

## Verify Everything Works

### Test 1: Check API
```bash
curl http://localhost:3001/api/health
# Expected: {"status":"ok","timestamp":...}
```

### Test 2: Check UI
```bash
curl -I http://localhost:3000/
# Expected: HTTP/1.1 200 OK
```

### Test 3: Check Prices
```bash
curl http://localhost:3001/api/prices | jq .sol.usd
# Expected: A number like 125.45
```

## Troubleshooting

### Error: "Bun not found"
```bash
# Install Bun
curl -fsSL https://bun.sh/install | bash

# Add to PATH
export PATH="$HOME/.bun/bin:$PATH"

# Add to shell profile permanently
echo 'export PATH="$HOME/.bun/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
```

### Error: "Module not found"
```bash
# Reinstall dependencies
rm -rf node_modules ui/node_modules
npm install
cd ui && bun install && cd ..
```

### Error: "Failed to fetch data from API"
1. Check API is running: `curl http://localhost:3001/api/health`
2. Check `.env` is configured
3. Check browser console for CORS errors

### Error: "Build failed"
```bash
# Clean and rebuild
cd ui
rm -rf dist
bun build src/index.tsx --outdir dist
ls -la dist/  # Should show index.js
```

## File Structure

After fixing, the structure is:

```
delta_neutral_bot/
├── start-ui.sh              # ⭐ NEW: Easy startup script
├── src/
│   └── api/
│       └── hono-server.ts   # ✅ FIXED: API server
├── ui/
│   ├── server.ts            # ✅ FIXED: Now builds React app
│   ├── src/
│   │   ├── App.tsx          # ✅ FIXED: Removed CSS import
│   │   ├── App.css          # Styles
│   │   ├── index.tsx        # Entry point
│   │   ├── config.ts        # API URL
│   │   └── components/      # React components
│   ├── public/
│   │   └── index.html       # ✅ FIXED: Added CSS link
│   └── dist/                # ⭐ NEW: Built files go here
│       └── index.js         # Transpiled React bundle
└── .env                     # Configuration
```

## What the UI Does

Once running, the UI shows:

1. **Oracle Prices** (Pyth + Jupiter)
   - SOL/USD current price
   - SOL/USDC exchange rate
   - Price divergence warnings

2. **Pool Analytics**
   - APR and APY
   - 24h volume and fees
   - Pool configuration

3. **Bin Visualization**
   - Interactive chart with 100 bins
   - Your position range (green lines)
   - Active bin (red line)

4. **Position Manager**
   - View: See your positions and fees
   - Create: Make new LP positions
   - Deposit: Add liquidity
   - Withdraw: Remove liquidity

All data auto-refreshes every 10 seconds.

## Development

### Make Changes to React Components

```bash
# 1. Edit files in ui/src/
# 2. Restart UI server (Ctrl+C, then bun run server.ts)
# 3. Refresh browser
```

### Make Changes to API

```bash
# 1. Edit files in src/api/
# 2. Restart API server (Ctrl+C, then bun run src/api/hono-server.ts)
# 3. UI will automatically use new API
```

### Add New Components

```bash
# 1. Create file in ui/src/components/MyComponent.tsx
# 2. Import in ui/src/App.tsx
# 3. Add to JSX
# 4. Restart UI server
```

## Production Deployment

For production:

1. **Build UI for production**:
```bash
cd ui
bun build src/index.tsx --outdir dist --minify
```

2. **Serve static files**:
Use nginx, Cloudflare Pages, or any static host

3. **Run API server**:
```bash
bun run src/api/hono-server.ts
```

4. **Update CORS** in `src/api/hono-server.ts`:
```typescript
app.use('*', cors({
  origin: 'https://your-domain.com'
}));
```

## Next Steps

1. ✅ Run `./start-ui.sh`
2. ✅ Open http://localhost:3000
3. ✅ Create your first position
4. ✅ Monitor prices and fees
5. ✅ Manage your LP positions

## Support

- **Quick troubleshooting**: See `ui/TROUBLESHOOTING.md`
- **Full documentation**: See `UI_README.md`
- **Component details**: See `UI_COMPONENTS.md`

The UI is now fixed and ready to use! 🎉
