# Meteora DLMM LP Manager UI

A React-based web interface for managing Meteora DLMM liquidity positions with real-time oracle price feeds and bin visualization.

## Features

### 🔍 Oracle Price Display
- **Dual-source price feeds**: Pyth and Jupiter
- **Price divergence detection**: Warns when oracle prices differ >0.5%
- **SOL/USD and SOL/USDC rates**: Direct exchange rates from Jupiter v6
- **Real-time updates**: Auto-refresh every 10 seconds

### 📊 Pool Analytics
- **APR/APY metrics**: Real-time yield data from Meteora API
- **24h volume and fees**: Trading activity metrics
- **Pool metadata**: Bin step, base fee, total liquidity
- **Current price**: Active bin price from Meteora DLMM

### 📈 Bin Step Visualization
- **Interactive chart**: Visualize bins around active price
- **Position ranges**: Green indicators showing your LP range
- **Active bin marker**: Red line highlighting current active bin
- **Price distribution**: See how price changes across bins

### ⚡ Position Management
- **View positions**: See all active LP positions and exposure
- **Create positions**: Auto-create positions with configurable price ranges
- **Deposit/Withdraw**: Manage liquidity (balanced or single-sided)
- **Claim fees**: One-click fee claiming from all positions

## Architecture

```
┌─────────────────┐
│   React UI      │  (Port 3000)
│  (Bun Server)   │
└────────┬────────┘
         │ HTTP Requests
         ↓
┌─────────────────┐
│  Hono API       │  (Port 3001)
│  (Bun Server)   │
└────────┬────────┘
         │ Function Calls
         ↓
┌─────────────────┐
│ MeteoraAdapter  │  ← Existing module
│  PriceOracle    │  ← Existing module
└────────┬────────┘
         │
         ↓
    ┌─────────┐
    │ Solana  │
    └─────────┘
```

### Tech Stack

**Backend (API Server)**
- **Bun**: Fast JavaScript runtime
- **Hono**: Lightweight web framework for Bun
- **MeteoraAdapter**: Reuses existing LP management logic
- **PriceOracle**: Reuses existing Pyth + Jupiter integration

**Frontend (UI)**
- **React 19**: Modern React with hooks
- **Recharts**: Chart visualization for bins
- **Bun Server**: Native Bun HTTP server for dev

## Getting Started

### Prerequisites

- **Bun**: JavaScript runtime (installed during setup)
- **Node.js 18+**: For npm dependencies
- **Solana wallet**: With SOL for transactions

### Installation

1. Install dependencies:
```bash
# Install main project dependencies (including Hono)
npm install

# Install UI dependencies
cd ui
bun install
cd ..
```

2. Configure environment:
```bash
cp .env.example .env
# Edit .env with your settings:
# - RPC_URL: Solana RPC endpoint
# - PRIVATE_KEY: Your wallet private key
# - METEORA_POOL_ADDRESS: Pool address (e.g., SOL/USDC)
# - AUTO_CREATE_POSITIONS=true (to enable auto-creation)
# - INITIAL_DEPOSIT_SOL: Amount for initial position
# - PRICE_RANGE_BPS_LOWER/UPPER: Price range (e.g., -100/+100 = ±1%)
```

### Running the UI

**Option 1: Run both API and UI together (recommended)**
```bash
npm run dev
```

This starts:
- API server on [http://localhost:3001](http://localhost:3001)
- UI server on [http://localhost:3000](http://localhost:3000)

**Option 2: Run separately**
```bash
# Terminal 1: Start API server
npm run api

# Terminal 2: Start UI server
npm run ui
```

Then open [http://localhost:3000](http://localhost:3000) in your browser.

## API Endpoints

The Hono API server ([src/api/hono-server.ts](../src/api/hono-server.ts)) exposes:

### Price & Analytics
- `GET /api/health` - Health check
- `GET /api/prices` - Oracle prices (Pyth + Jupiter)
- `GET /api/pool/analytics` - Pool metrics from Meteora API
- `GET /api/pool/bins` - Bin distribution around active bin

### Position Management
- `GET /api/positions` - Get LP exposure and positions
- `POST /api/positions/create` - Create new position
- `POST /api/positions/deposit` - Deposit to position
- `POST /api/positions/withdraw` - Withdraw from position
- `POST /api/positions/claim-fees` - Claim accumulated fees

## Usage Examples

### Creating a Position

1. Navigate to "Create Position" tab
2. Enter SOL amount (e.g., 1.0)
3. Optionally enter USDC amount for balanced deposit
4. Set price range (±% from current price)
5. Click "Create Position"

The UI will:
- Calculate price bounds from current oracle price
- Call the API to create position via MeteoraAdapter
- Show transaction signature on success
- Auto-refresh to show new position

### Viewing Positions

The "View Positions" tab shows:
- Total SOL and USDC in LP
- Total USD value
- Claimable fees (if any)
- Individual position details with bin ranges

### Bin Visualization

The chart displays:
- **Blue line**: Price across bins
- **Red vertical line**: Active bin (current price)
- **Green dashed lines**: Your position range (lower/upper bounds)

This helps you visualize:
- Where your liquidity is concentrated
- How price moves relative to your range
- Whether you need to adjust your position

## Configuration

### API Configuration

Edit `.env` in project root:
```bash
# API server port (default: 3001)
API_PORT=3001

# Meteora pool address
METEORA_POOL_ADDRESS=5rCf1DM8LjKTw4YqhnoLcngyZYeNnQqztScTogYHAS6

# Auto-create position on first run
AUTO_CREATE_POSITIONS=true
INITIAL_DEPOSIT_SOL=1.0
INITIAL_DEPOSIT_USDC=0
PRICE_RANGE_BPS_LOWER=-100  # -1%
PRICE_RANGE_BPS_UPPER=100   # +1%
```

### UI Configuration

Edit [ui/src/config.ts](src/config.ts):
```typescript
export const API_BASE_URL = 'http://localhost:3001';
```

Change this if running API on different host/port.

## Development

### File Structure

```
ui/
├── src/
│   ├── App.tsx                    # Main app component
│   ├── App.css                    # Global styles
│   ├── index.tsx                  # React entry point
│   ├── config.ts                  # API configuration
│   └── components/
│       ├── PriceOracles.tsx       # Oracle price display
│       ├── PoolAnalytics.tsx      # Pool metrics
│       ├── BinVisualization.tsx   # Bin chart
│       └── PositionManager.tsx    # LP management UI
├── public/
│   └── index.html                 # HTML template
├── server.ts                      # Bun dev server
└── package.json
```

### Adding New Features

**To add a new API endpoint:**

1. Add route in [src/api/hono-server.ts](../src/api/hono-server.ts):
```typescript
app.get('/api/my-endpoint', async (c) => {
  // Call existing MeteoraAdapter or PriceOracle methods
  return c.json({ data: 'result' });
});
```

2. Call from React component:
```typescript
const response = await fetch(`${API_BASE_URL}/api/my-endpoint`);
const data = await response.json();
```

**To add a new UI component:**

1. Create component in `ui/src/components/`
2. Import and use in `App.tsx`
3. Style in `App.css`

## Troubleshooting

### API Connection Failed

**Error**: "Failed to fetch data from API"

**Solutions**:
1. Check API server is running: `curl http://localhost:3001/api/health`
2. Verify `.env` is configured correctly
3. Check CORS is enabled (Hono middleware)

### Transaction Failed

**Error**: "Failed to create position"

**Solutions**:
1. Check wallet has sufficient SOL balance
2. Verify pool address is correct
3. Check price range is within DLMM limits (max 70 bins)
4. Review API logs for detailed error

### Bin Chart Not Loading

**Error**: Chart shows no data

**Solutions**:
1. Verify pool address is set in `.env`
2. Check RPC connection is working
3. Ensure Meteora DLMM pool is active

### Price Divergence Warning

**Warning**: "Price divergence detected"

This is **normal** when:
- Pyth and Jupiter have slight differences (<1%)
- Market is volatile with rapid price changes

**Action required** if:
- Divergence is >2% consistently
- Could indicate oracle issues or extreme market conditions

## Performance

- **Initial load**: <2s with warm cache
- **Auto-refresh**: Every 10s for all data
- **API latency**: ~100-500ms depending on RPC
- **Chart rendering**: <100ms with 100 bins

## Security Notes

⚠️ **Important Security Considerations**:

1. **Private keys**: Never commit `.env` to git
2. **RPC endpoints**: Use rate-limited public RPC or private RPC
3. **CORS**: API allows all origins for development - restrict in production
4. **Input validation**: API validates all inputs before calling Solana
5. **Transaction simulation**: All txs use `skipPreflight: false` for safety

## Production Deployment

For production use:

1. **Restrict CORS**:
```typescript
app.use('*', cors({
  origin: 'https://your-domain.com'
}));
```

2. **Use HTTPS**: Deploy behind reverse proxy (nginx, Cloudflare)

3. **Environment variables**: Use production RPC and secure key management

4. **Rate limiting**: Add rate limiting middleware to API

5. **Monitoring**: Add error tracking (Sentry, etc.)

## Contributing

The UI is built on top of existing bot modules:
- `MeteoraAdapter` - LP position management
- `PriceOracle` - Price feeds from Pyth + Jupiter
- All Solana interactions use existing utilities

To contribute:
1. Test locally with `npm run dev`
2. Ensure all existing tests pass: `npm test`
3. Add new tests for new features
4. Submit PR with clear description

## Support

For issues:
1. Check existing bot tests work: `npm run test:integration`
2. Review API logs in console
3. Check browser console for UI errors
4. Open GitHub issue with reproduction steps

## License

Same as main project (see root LICENSE file)
