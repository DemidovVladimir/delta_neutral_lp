# Meteora DLMM LP Manager UI

A React-based web interface for managing Meteora DLMM liquidity positions with real-time oracle prices and bin visualization.

## 🚀 Quick Start

```bash
# 1. Test your setup
./test-ui-setup.sh

# 2. Start the UI
./start-ui.sh

# 3. Open browser
# → http://localhost:3000
```

That's it! The UI will open automatically in your browser.

## 📋 Prerequisites

- **Bun**: JavaScript runtime (auto-installed by scripts)
- **Node.js 18+**: For npm dependencies
- **Solana wallet**: With SOL for transactions
- **.env configured**: See configuration below

## ⚙️ Configuration

Create `.env` in project root:

```bash
RPC_URL=https://api.mainnet-beta.solana.com
PRIVATE_KEY=your_private_key_here
METEORA_POOL_ADDRESS=Agxw5VTjEaUt4NcK9r6cA5HuVVcpJFcbw6LZG5tbxvcT
AUTO_CREATE_POSITIONS=true
INITIAL_DEPOSIT_SOL=0.1
PRICE_RANGE_BPS_LOWER=-100
PRICE_RANGE_BPS_UPPER=100
```

## 🎯 Features

- **📊 Oracle Prices**: Dual-source (Pyth + Jupiter) with divergence detection
- **💎 Pool Analytics**: Real-time APR, APY, volume, fees
- **📈 Bin Visualization**: Interactive chart showing your position range
- **⚡ Position Management**: Create, view, deposit, withdraw, claim fees
- **🔄 Auto-Refresh**: Updates every 10 seconds

## 🏗️ Architecture

```
React UI (3000) → Hono API (3001) → MeteoraAdapter → Solana
```

The UI makes HTTP calls to a Bun+Hono API server, which then calls your existing `MeteoraAdapter` and `PriceOracle` modules. This means 100% code reuse - no duplication!

## 📚 Documentation

- **[UI_FIXED_SETUP.md](UI_FIXED_SETUP.md)** - Setup instructions with fixes
- **[UI_QUICKSTART.md](UI_QUICKSTART.md)** - 3-minute quick start guide
- **[UI_README.md](UI_README.md)** - Complete documentation
- **[UI_COMPONENTS.md](UI_COMPONENTS.md)** - Component hierarchy
- **[ui/TROUBLESHOOTING.md](ui/TROUBLESHOOTING.md)** - Troubleshooting guide

## 🛠️ Scripts

| Script | Description |
|--------|-------------|
| `./test-ui-setup.sh` | Verify setup is correct |
| `./start-ui.sh` | Start both API and UI servers |
| `npm run dev` | Alternative: Use concurrently |
| `npm run api` | Start API server only |
| `npm run ui` | Start UI server only |

## 🧪 Testing

```bash
# Test setup
./test-ui-setup.sh

# Test API
curl http://localhost:3001/api/health
curl http://localhost:3001/api/prices | jq

# Test UI
curl -I http://localhost:3000/
```

## 🐛 Troubleshooting

### 404 Error?
1. Check both servers are running
2. See [UI_FIXED_SETUP.md](UI_FIXED_SETUP.md) for fixes
3. See [ui/TROUBLESHOOTING.md](ui/TROUBLESHOOTING.md) for detailed help

### Quick Fixes

```bash
# Fix 1: Restart everything
pkill -f "bun run"
./start-ui.sh

# Fix 2: Reinstall dependencies
rm -rf node_modules ui/node_modules ui/dist
npm install && cd ui && bun install && cd ..

# Fix 3: Verify configuration
cat .env | grep -E "RPC_URL|PRIVATE_KEY|METEORA_POOL_ADDRESS"
```

## 📁 File Structure

```
delta_neutral_bot/
├── start-ui.sh                # ⭐ Easy startup
├── test-ui-setup.sh          # ⭐ Setup verification
├── src/api/
│   └── hono-server.ts        # API server (Bun + Hono)
├── ui/
│   ├── server.ts             # UI dev server (Bun)
│   ├── src/
│   │   ├── App.tsx           # Main React app
│   │   ├── App.css           # Styles
│   │   ├── components/       # React components
│   │   │   ├── PriceOracles.tsx
│   │   │   ├── PoolAnalytics.tsx
│   │   │   ├── BinVisualization.tsx
│   │   │   └── PositionManager.tsx
│   │   └── config.ts         # API configuration
│   └── public/
│       └── index.html        # HTML template
└── .env                      # Configuration
```

## 🎨 UI Preview

The interface has 4 main sections:

1. **Top Left**: Oracle prices from Pyth and Jupiter
2. **Top Right**: Pool analytics (APR, volume, fees)
3. **Middle**: Interactive bin chart with your position range
4. **Bottom**: 4-tab position manager (View, Create, Deposit, Withdraw)

## 🔧 Development

### Add New Component

```bash
# 1. Create file
cat > ui/src/components/MyComponent.tsx << 'EOF'
export function MyComponent() {
  return <div>Hello!</div>;
}
EOF

# 2. Import in App.tsx
# import { MyComponent } from './components/MyComponent';

# 3. Restart UI
cd ui && bun run server.ts
```

### Add New API Endpoint

```bash
# 1. Edit src/api/hono-server.ts
# app.get('/api/my-endpoint', async (c) => {
#   return c.json({ data: 'result' });
# });

# 2. Restart API
bun run src/api/hono-server.ts
```

## 🚢 Production

For production deployment:

1. Build UI: `cd ui && bun build src/index.tsx --outdir dist --minify`
2. Deploy static files to CDN (Cloudflare Pages, Vercel, etc.)
3. Run API server: `bun run src/api/hono-server.ts`
4. Update CORS in API to restrict origins

## ✅ Verified Working

- ✅ Bun 1.3.1+
- ✅ React 19
- ✅ Hono 4.10+
- ✅ macOS (tested)
- ✅ Linux (should work)
- ✅ Windows (via WSL)

## 💡 Tips

- Use `./test-ui-setup.sh` to verify everything before starting
- Keep API and UI servers running in separate terminals
- Check browser console (F12) for errors
- Use `curl` to test API endpoints directly
- Read `UI_FIXED_SETUP.md` if you encounter 404 errors

## 🆘 Support

If you're stuck:

1. Run `./test-ui-setup.sh` to diagnose issues
2. Check [ui/TROUBLESHOOTING.md](ui/TROUBLESHOOTING.md)
3. Review [UI_FIXED_SETUP.md](UI_FIXED_SETUP.md)
4. Verify `.env` is configured correctly
5. Check existing bot tests work: `npm run test:integration`

## 📄 License

Same as main project

---

**Built with**: Bun + Hono + React + Recharts

**Reuses**: 100% of existing MeteoraAdapter and PriceOracle modules

**No code duplication**: UI is a thin HTTP wrapper + React frontend
