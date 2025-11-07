# UI Component Hierarchy

## Visual Layout

```
┌─────────────────────────────────────────────────────────────────┐
│                     🌊 Meteora DLMM LP Manager         🔄 Refresh │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌──────────────────────────┐  ┌──────────────────────────────┐ │
│  │  📊 Oracle Prices        │  │  💎 Pool Analytics           │ │
│  │                          │  │                              │ │
│  │  SOL/USD: $125.45        │  │  APR: 45.2%    Vol: $1.2M   │ │
│  │  Source: Pyth            │  │  APY: 56.8%    Fees: $24K   │ │
│  │                          │  │  Bin Step: 4 (0.04%)        │ │
│  │  SOL/USDC: 125.4321      │  │  Liquidity: $5.6M           │ │
│  │  Source: Jupiter         │  │                              │ │
│  └──────────────────────────┘  └──────────────────────────────┘ │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │  📈 Bin Distribution & Price Range                          │ │
│  │                                                             │ │
│  │  Active Bin: 12345  Price: $125.45  Bin Step: 4           │ │
│  │                                                             │ │
│  │    140 │                                                   │ │
│  │        │                            ╱─────────            │ │
│  │    130 │                      ╱────╱                      │ │
│  │        │                 ╱───╱                            │ │
│  │    120 │            ╱───╱           ▓                     │ │
│  │   $ 110│       ╱───╱                ▓  Active Bin        │ │
│  │    100 │  ╱───╱                     ▓                     │ │
│  │        │╱╱                          ▓                     │ │
│  │        └────────────────────────────▓─────────────────→   │ │
│  │        12300       12340       12380 12420       12460    │ │
│  │                         Bin ID                            │ │
│  │                                                             │ │
│  │  ⚡ Your Position: Bins 12330 → 12360                     │ │
│  │     Price Range: $122.50 → $128.40                        │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │  ⚡ LP Position Management                                  │ │
│  │                                                             │ │
│  │  [ View Positions ] [ Create Position ] [ Deposit ] [ Withdraw ] │
│  │                                                             │ │
│  │  ┌─────────────────────────────────────────────────┐       │ │
│  │  │  Your Positions                                 │       │ │
│  │  │                                                 │       │ │
│  │  │  Total SOL: 1.2345          Claimable: 0.0034 SOL│    │ │
│  │  │  Total USDC: $155.20        Claimable: $0.42    │     │ │
│  │  │  Total Value: $309.77                           │       │ │
│  │  │                                                 │       │ │
│  │  │  [💰 Claim Fees]                                │       │ │
│  │  │                                                 │       │ │
│  │  │  ┌──────────────────────────────────────────┐  │       │ │
│  │  │  │ Position 1                              │  │       │ │
│  │  │  │ SOL: 1.2345  USDC: $155.20              │  │       │ │
│  │  │  │ Value: $309.77                          │  │       │ │
│  │  │  │ Bins: 12330 → 12360                     │  │       │ │
│  │  │  └──────────────────────────────────────────┘  │       │ │
│  │  └─────────────────────────────────────────────────┘       │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

## Component Tree

```
App.tsx
├── Header
│   ├── Title: "🌊 Meteora DLMM LP Manager"
│   └── Button: Refresh
│
├── Dashboard Grid (2 columns, auto-fit)
│   │
│   ├── Section: Oracle Prices
│   │   └── PriceOracles.tsx
│   │       ├── PriceCard: SOL/USD (Pyth)
│   │       │   ├── Price Value
│   │       │   ├── Source Badge
│   │       │   └── Timestamp
│   │       ├── PriceCard: SOL/USDC (Jupiter)
│   │       │   └── Exchange Rate
│   │       └── PriceCard: Divergence Warning (conditional)
│   │           └── Percentage Difference
│   │
│   ├── Section: Pool Analytics
│   │   └── PoolAnalytics.tsx
│   │       └── Analytics Grid (3x3)
│   │           ├── Pool Name
│   │           ├── Current Price
│   │           ├── APR (highlighted)
│   │           ├── APY (highlighted)
│   │           ├── 24h Volume
│   │           ├── 24h Fees
│   │           ├── Bin Step
│   │           ├── Base Fee
│   │           └── Total Liquidity
│   │
│   ├── Section: Bin Visualization (full-width)
│   │   └── BinVisualization.tsx
│   │       ├── Bin Info Grid
│   │       │   ├── Active Bin ID
│   │       │   ├── Active Bin Price
│   │       │   ├── Bin Step
│   │       │   └── Oracle Price
│   │       ├── Chart Container
│   │       │   └── Recharts ComposedChart
│   │       │       ├── CartesianGrid
│   │       │       ├── XAxis (Bin ID)
│   │       │       ├── YAxis (Price)
│   │       │       ├── Tooltip
│   │       │       ├── Legend
│   │       │       ├── ReferenceLine: Active Bin (red)
│   │       │       ├── ReferenceLine: Position Lower (green)
│   │       │       ├── ReferenceLine: Position Upper (green)
│   │       │       └── Line: Price Curve (blue)
│   │       └── Position Ranges List (if positions exist)
│   │           └── Range Info Cards
│   │
│   └── Section: Position Manager (full-width)
│       └── PositionManager.tsx
│           ├── Tab Navigation
│           │   ├── Tab: View Positions
│           │   ├── Tab: Create Position
│           │   ├── Tab: Deposit
│           │   └── Tab: Withdraw
│           │
│           ├── Message Banner (success/error, conditional)
│           │
│           └── Tab Content
│               │
│               ├── View Tab:
│               │   ├── Exposure Summary Grid
│               │   │   ├── Card: Total SOL
│               │   │   ├── Card: Total USDC
│               │   │   ├── Card: Total USD Value
│               │   │   ├── Card: Claimable SOL
│               │   │   └── Card: Claimable USDC
│               │   ├── Button: Claim Fees (conditional)
│               │   └── Positions List
│               │       └── Position Cards
│               │           ├── Position Header
│               │           └── Position Details
│               │               ├── SOL Amount
│               │               ├── USDC Amount
│               │               ├── USD Value
│               │               └── Bin Range
│               │
│               ├── Create Tab:
│               │   └── Form
│               │       ├── Input: SOL Amount
│               │       ├── Input: USDC Amount
│               │       ├── Input: Price Range (±%)
│               │       ├── Helper: Range Preview
│               │       └── Button: Create Position
│               │
│               ├── Deposit Tab:
│               │   └── Form
│               │       ├── Input: SOL Amount
│               │       ├── Input: USDC Amount
│               │       ├── Select: Single-Sided
│               │       └── Button: Deposit
│               │
│               └── Withdraw Tab:
│                   └── Form
│                       ├── Input: Withdrawal %
│                       ├── Helper: 100% = full withdrawal
│                       └── Button: Withdraw
```

## Data Flow

### Fetch Data (on mount + every 10s)

```
App.tsx
  ↓ useEffect()
  ↓ fetchData()
  ├─→ fetch(/api/prices)           → setPrices()      → PriceOracles
  ├─→ fetch(/api/pool/analytics)   → setPoolAnalytics()→ PoolAnalytics
  ├─→ fetch(/api/pool/bins)        → setBins()        → BinVisualization
  └─→ fetch(/api/positions)        → setPositions()   → PositionManager
```

### User Actions (Position Manager)

```
PositionManager.tsx
  │
  ├─→ Create Position
  │   ├─ User fills form
  │   ├─ handleCreatePosition()
  │   ├─ POST /api/positions/create
  │   │   ↓
  │   │  Hono API Server
  │   │   ↓
  │   │  MeteoraAdapter.createPosition()
  │   │   ↓
  │   │  Solana Transaction
  │   └─ onUpdate() → re-fetch all data
  │
  ├─→ Deposit
  │   ├─ User fills form
  │   ├─ handleDeposit()
  │   ├─ POST /api/positions/deposit
  │   │   ↓
  │   │  MeteoraAdapter.depositToLp()
  │   └─ onUpdate()
  │
  ├─→ Withdraw
  │   ├─ User fills form
  │   ├─ handleWithdraw()
  │   ├─ POST /api/positions/withdraw
  │   │   ↓
  │   │  MeteoraAdapter.withdrawFromLp()
  │   └─ onUpdate()
  │
  └─→ Claim Fees
      ├─ handleClaimFees()
      ├─ POST /api/positions/claim-fees
      │   ↓
      │  MeteoraAdapter.claimFees()
      └─ onUpdate()
```

## Component Props

### PriceOracles
```typescript
interface PriceOraclesProps {
  prices: {
    sol: Price;
    multiToken: MultiTokenPriceResult;
    timestamp: number;
  };
}
```

### PoolAnalytics
```typescript
interface PoolAnalyticsProps {
  analytics: MeteoraPairInfo;
}
```

### BinVisualization
```typescript
interface BinVisualizationProps {
  bins: {
    activeBin: { binId: number; price: number };
    binStep: number;
    bins: Array<{ binId: number; price: number; isActive: boolean }>;
  };
  currentPrice: number | null;
  positions: LpExposure;
}
```

### PositionManager
```typescript
interface PositionManagerProps {
  positions: {
    exposure: LpExposure;
    positionMints: string[];
  };
  currentPrice: number | null;
  poolAddress: string;
  onUpdate: () => void; // Re-fetch data callback
}
```

## State Management

All state is managed in **App.tsx** with React hooks:

```typescript
const [prices, setPrices] = useState<any>(null);
const [poolAnalytics, setPoolAnalytics] = useState<any>(null);
const [bins, setBins] = useState<any>(null);
const [positions, setPositions] = useState<any>(null);
const [loading, setLoading] = useState(true);
const [error, setError] = useState<string | null>(null);
```

**No global state library** (Redux, Zustand, etc.) needed for this simple app.

## Styling Architecture

### CSS Variables (Dark Theme)
```css
:root {
  --bg-primary: #0a0a0a;       /* Main background */
  --bg-secondary: #1a1a1a;     /* Card backgrounds */
  --bg-tertiary: #2a2a2a;      /* Input backgrounds */
  --text-primary: #ffffff;     /* Primary text */
  --text-secondary: #b0b0b0;   /* Secondary text */
  --accent: #4a9eff;           /* Blue accent */
  --success: #00ff88;          /* Green for fees, APR */
  --error: #ff6b6b;            /* Red for errors */
  --warning: #ffa500;          /* Orange for warnings */
  --border: #333;              /* Border color */
}
```

### Layout System
- **Grid**: CSS Grid for responsive layouts
- **Flexbox**: For component internal layouts
- **Auto-fit**: Columns adapt to screen size
- **No framework**: Pure CSS (no Tailwind, Bootstrap)

### Responsive Breakpoints
```css
@media (max-width: 768px) {
  /* Single column layout on mobile */
  .dashboard {
    grid-template-columns: 1fr;
  }
}
```

## File Sizes

| File | Size | Purpose |
|------|------|---------|
| App.tsx | 3.8 KB | Main app logic |
| App.css | 8.3 KB | All styles |
| PriceOracles.tsx | 1.5 KB | Price display |
| PoolAnalytics.tsx | 1.6 KB | Pool metrics |
| BinVisualization.tsx | 3.2 KB | Chart component |
| PositionManager.tsx | 7.8 KB | LP management |
| index.tsx | 284 B | React entry |
| config.ts | 53 B | API config |
| **Total** | **26.5 KB** | All React code |

**Production bundle** (estimated): ~600 KB with React + Recharts

## Performance Optimization

### Data Fetching
- **Parallel requests**: All API calls in `Promise.all()`
- **Caching**: API caches pool info for 2.5s
- **Debouncing**: Auto-refresh every 10s (not aggressive)
- **Conditional rendering**: Only render when data available

### Chart Performance
- **Limited data**: Only 100 bins (±50 from active)
- **No animation**: For faster rendering
- **Memoization**: Recharts internally optimizes

### Bundle Optimization
- **Tree shaking**: Only import used components
- **Code splitting**: Not needed (small bundle)
- **Lazy loading**: Not implemented (fast enough)

## Browser Compatibility

**Tested on**:
- Chrome 120+ ✅
- Firefox 120+ ✅
- Safari 17+ ✅
- Edge 120+ ✅

**Requirements**:
- Modern browser with ES2020+ support
- JavaScript enabled
- Fetch API support
- CSS Grid support

## Accessibility

**Implemented**:
- Semantic HTML (section, header, button)
- Alt text for status indicators
- Keyboard navigation (tab order)
- Readable font sizes (1rem base)
- High contrast (dark theme)

**Not implemented** (future):
- ARIA labels
- Screen reader optimization
- Focus indicators
- Keyboard shortcuts

## Internationalization

**Current**: English only

**Future**: Could add i18n for:
- UI labels
- Number formatting
- Date/time formatting
- Currency symbols

## Development Workflow

```bash
# Start development
npm run dev

# Make changes to React components
# → Hot reload (Bun auto-restarts)

# Make changes to API
# → Restart API server (Ctrl+C, npm run api)

# Test API directly
curl http://localhost:3001/api/health

# Test in browser
# → Open http://localhost:3000
# → Check browser console for errors
# → Check API logs in terminal
```

## Deployment Options

### Option 1: Same Server
```
nginx reverse proxy
  ↓ /api/* → Hono API (port 3001)
  ↓ /*     → Static files (build UI)
```

### Option 2: Separate Servers
```
UI Server (Vercel, Netlify)
  ↓ fetch()
API Server (VPS, AWS)
  ↓ function calls
Solana RPC
```

### Option 3: Docker
```dockerfile
# Multi-stage build
FROM oven/bun AS builder
WORKDIR /app
COPY . .
RUN bun install
RUN bun build ui/src/index.tsx --outdir ui/dist

FROM oven/bun
WORKDIR /app
COPY --from=builder /app .
EXPOSE 3001 3000
CMD ["bun", "run", "dev"]
```

## Summary

**Component Count**: 4 main components (PriceOracles, PoolAnalytics, BinVisualization, PositionManager)
**Lines of Code**: ~800 lines (React) + 8KB CSS
**API Endpoints**: 9 endpoints
**External Libraries**: React, Recharts, Hono
**Performance**: <2s initial load, 10s refresh interval

The UI is **modular**, **performant**, and **easy to maintain**. Each component has a single responsibility and communicates via props. All business logic stays in existing bot modules.
