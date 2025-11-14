# Delta-Neutral Liquidity Provision Bot

A sophisticated automated market-making bot for Solana that provides liquidity on Meteora DLMM (SOL/USDC) while maintaining delta neutrality through Drift Protocol perpetual shorts.

[![Solana](https://img.shields.io/badge/Solana-Mainnet-9945FF?logo=solana)](https://solana.com)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue?logo=typescript)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

## 🎯 Overview

This bot earns LP fees from Meteora DLMM pools while minimizing directional exposure to SOL price movements by maintaining a short position on Drift Protocol. The result is a market-neutral strategy that profits from trading fees and funding rate arbitrage.

### Key Features

- ✅ **Automated Position Creation** - No manual setup required
- 🤖 **Auto-Tune Rebalancing** - Automatic position rebalancing with fee auto-compounding
- 🔍 **Robust Position Tracking** - Never loses track of positions, prevents duplicates
- 📊 **Delta-Neutral Strategy** - Maintains ΔSOL ≈ 0 through automatic rebalancing (planned)
- 🔄 **Meteora DLMM Integration** - Concentrated liquidity with customizable ranges
- ⚡ **Drift Protocol Hedging** - Perpetual shorts for delta neutrality (planned)
- 🔁 **Jupiter Ultra API** - Fast, reliable token swapping with error detection
- 📈 **Real-time Pool Analytics** - Jupiter v6 + Meteora API integration
- 🛡️ **Risk Management** - Configurable limits with dual reserve system
- 📝 **Enhanced Logging** - Clear error messages with wallet balance debugging

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Orchestrator                             │
│  - Monitors LP exposure vs short position                   │
│  - Triggers rebalancing when delta exceeds threshold        │
│  - Manages emergency flows                                  │
└──────────────┬──────────────────────────┬───────────────────┘
               │                          │
       ┌───────▼────────┐        ┌────────▼─────────┐
       │  MeteoraAdapter │        │   DriftEngine    │
       │                │        │                  │
       │ - LP positions │        │ - Perp shorts    │
       │ - Fee claims   │        │ - Collateral     │
       │ - Deposits     │        │ - Rebalancing    │
       └────────────────┘        └──────────────────┘
               │                          │
       ┌───────▼────────┐        ┌────────▼─────────┐
       │ Meteora DLMM   │        │  Drift Protocol  │
       │   (SOL/USDC)   │        │   (SOL-PERP)     │
       └────────────────┘        └──────────────────┘
```

### Core Modules

- **MeteoraAdapter** - Manages DLMM LP positions (deposits, withdrawals, fee claims)
- **AutoTuneOrchestrator** - Automated position rebalancing with intelligent retry logic
- **JupiterSwapper** - Token swapping for position balancing
- **PriceOracle** - Jupiter v6 + Pyth price feeds
- **DriftEngine** - Handles perpetual short positions (planned)
- **RiskController** - Enforces delta thresholds and limits (planned)

## 🚀 Quick Start

### Prerequisites

- Node.js 18+ or pnpm
- Solana wallet with SOL and USDC
- RPC endpoint (Helius, QuickNode, or local validator)

### Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/delta_neutral_bot.git
cd delta_neutral_bot

# Install dependencies
pnpm install

# Copy environment template
cp .env.example .env.mainnet
```

### Configuration

Edit `.env.mainnet` with your settings:

```bash
# Network
RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_KEY

# Wallet
PRIVATE_KEY=your_base58_private_key

# Meteora Position Setup (Option 1: Auto-create)
AUTO_CREATE_POSITIONS=true
METEORA_POOL_ADDRESS=5rCf1DM8LjKTw4YqhnoLcngyZYeNnQqztScTogYHAS6
INITIAL_DEPOSIT_SOL=10
INITIAL_DEPOSIT_USDC=1000
PRICE_RANGE_BPS_LOWER=-100  # -1% from current price
PRICE_RANGE_BPS_UPPER=100    # +1% from current price

# Auto-Tune Configuration
AUTO_TUNE_ENABLED=true
AUTO_TUNE_BIN_COUNT=20
AUTO_TUNE_CHECK_INTERVAL_MS=30000
AUTO_TUNE_IMBALANCE_THRESHOLD=0.8
AUTO_TUNE_DEPOSIT_TOKEN=SOL
AUTO_TUNE_DEPOSIT_AMOUNT=1.0

# Wallet Reserves
MINIMUM_WALLET_BALANCE_SOL=0.2
RENT_RESERVE_SOL=0.1

# Jupiter Swap Configuration
SWAP_ENABLED=true
SWAP_SLIPPAGE_BPS=50

# Transaction Execution (Optimized for 2025)
PRIORITY_FEE_MICRO_LAMPORTS=50000  # 50,000 µL/CU = moderate priority
MAX_COMPUTE_UNITS=600000
```

### Running the Bot

```bash
# Auto-Tune Mode (Automated Rebalancing)
pnpm auto-tune           # Start auto-tune orchestrator (REAL FUNDS!)
pnpm auto-tune:watch     # Start with watch mode (visual display)

# API Server
pnpm api                 # Start API server on port 3001

# Run tests (recommended for initial validation)
pnpm test:local          # Test on localnet
pnpm test:mainnet        # Test on mainnet (REAL FUNDS!)
pnpm test:integration    # Integration tests for utilities

# Find available pools
pnpm find-pools          # Find SOL/USDC DLMM pools on mainnet

# Localnet management
pnpm localnet:start      # Start mainnet fork for testing
pnpm localnet:stop       # Stop validator

# Build and lint
pnpm build              # Compile TypeScript
pnpm lint               # Run ESLint
pnpm format             # Format code with Prettier
```

**Note**: The auto-tune feature is fully functional for automated position rebalancing. The main hedge loop for Drift integration is planned for future implementation.

## 📊 How It Works

### 1. LP Provision
The bot creates a concentrated liquidity position on Meteora DLMM (SOL/USDC pool) within a configurable price range. This position earns trading fees from swaps.

### 2. Delta Hedging
To neutralize SOL price exposure, the bot opens a perpetual short position on Drift Protocol:
- **LP Exposure**: +10 SOL from liquidity provision
- **Drift Short**: -10 SOL from perpetual position
- **Net Delta**: ~0 SOL (market neutral)

### 3. Rebalancing
The bot continuously monitors the delta (difference between LP SOL and short SOL):
```
delta = lpSol - |shortSol|
```
When `|delta| > DELTA_THRESHOLD_SOL`, the bot rebalances the short position.

### 4. Profit Sources
- **LP Fees**: Trading fees from Meteora pool (0.01% - 0.3% per swap)
- **Funding Arbitrage**: Profit when funding rate is favorable
- **Impermanent Loss Protection**: Hedged position minimizes IL

## 🧪 Testing

### Integration Tests

Test all utilities and integrations:
```bash
pnpm test:integration
```

Tests include:
- ✅ Jupiter API v6 multi-token price fetching
- ✅ Meteora DLMM API pool analytics
- ✅ Position composition calculations
- ✅ Price oracle utilities (Jupiter + Pyth)

### Localnet Testing

Test on a safe mainnet fork:
```bash
pnpm localnet:start     # Start validator
pnpm test:local         # Run localnet tests
pnpm localnet:stop      # Stop validator
```

### Mainnet Test (REAL FUNDS)

⚠️ **WARNING**: This uses real funds!

```bash
pnpm test:mainnet
```

This will:
1. Check wallet balances
2. Create a real Meteora position
3. Read LP exposure

### Finding Pools

Find available SOL/USDC DLMM pools:
```bash
pnpm find-pools
```

This script queries Meteora's API to find pools and displays:
- Pool address
- Token mints
- Bin step
- Current price
- TVL

## 📚 Documentation

- **[FEE_OPTIMIZATION.md](docs/FEE_OPTIMIZATION.md)** - 💰 Fee optimization guide (2025) - 96% cost reduction!
- **[API.md](docs/API.md)** - API server endpoints and usage
- **[INTEGRATION_SUMMARY.md](INTEGRATION_SUMMARY.md)** - Recent improvements from meteora-lp-army-bot
- **[agent-kit-mvp-prd.md](agent-kit-mvp-prd.md)** - Product requirements and architecture
- **[progress.md](progress.md)** - Development progress tracking
- **[decisions.md](decisions.md)** - Architectural decision records
- **[bugs.md](bugs.md)** - Known issues and bug reports

## 🛠️ Advanced Usage

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `RPC_URL` | Solana RPC endpoint | Required |
| `PRIVATE_KEY` | Wallet private key (base58) | Required |
| `AUTO_CREATE_POSITIONS` | Auto-create LP positions | `false` |
| `METEORA_POOL_ADDRESS` | Meteora DLMM pool | Required |
| `INITIAL_DEPOSIT_SOL` | Initial SOL deposit | `0` |
| `INITIAL_DEPOSIT_USDC` | Initial USDC deposit | `0` |
| `PRICE_RANGE_BPS_LOWER` | Lower price bound (BPS) | `-500` |
| `PRICE_RANGE_BPS_UPPER` | Upper price bound (BPS) | `500` |
| `DELTA_THRESHOLD_SOL` | Max delta before rebalancing | `2` |
| `MIN_COLLATERAL_RATIO` | Min collateral ratio | `0.15` |
| `MAX_SHORT_NOTIONAL_USD` | Max short position size | `12000` |
| `FUNDING_RATE_CAP_BPS` | Max funding rate (BPS) | `80` |
| `AUTO_TUNE_ENABLED` | Enable auto-tune mode | `false` |
| `AUTO_TUNE_BIN_COUNT` | Number of bins | `20` |
| `AUTO_TUNE_DEPOSIT_TOKEN` | Deposit token (SOL/USDC) | `SOL` |
| `AUTO_TUNE_DEPOSIT_AMOUNT` | Deposit amount | `1.0` |
| `MINIMUM_WALLET_BALANCE_SOL` | Permanent reserve | `0.2` |
| `RENT_RESERVE_SOL` | Temporary reserve | `0.1` |
| `SWAP_ENABLED` | Enable Jupiter swaps | `true` |
| `SWAP_SLIPPAGE_BPS` | Slippage tolerance (BPS) | `50` |
| `PRIORITY_FEE_MICRO_LAMPORTS` | Priority fee (µL/CU) | `50000` |
| `MAX_COMPUTE_UNITS` | Max compute units | `600000` |

### Custom Price Ranges

For tighter ranges around current price (better for stable markets):
```bash
PRICE_RANGE_BPS_LOWER=-50   # -0.5%
PRICE_RANGE_BPS_UPPER=50     # +0.5%
```

For wider ranges (better for volatile markets):
```bash
PRICE_RANGE_BPS_LOWER=-500   # -5%
PRICE_RANGE_BPS_UPPER=500    # +5%
```

### Multiple Positions

To use existing positions instead of auto-create:
```bash
AUTO_CREATE_POSITIONS=false
METEORA_POSITION_MINTS=mint1,mint2,mint3
LP_OWNER=your_wallet_address
```

## 🔒 Security

- **Private Keys**: Never commit `.env` files. Use environment variables or secret managers
- **RPC Endpoints**: Use authenticated RPCs to prevent rate limiting
- **Wallet Reserves**: Configure minimum balance to prevent accidental drainage
- **Risk Limits**: Set conservative limits for initial testing
- **Start Small**: Test with small deposit amounts first (e.g., 0.1-0.5 SOL)

## 💰 Transaction Costs (2025)

The bot has been optimized for minimal transaction costs using priority fees:

### Cost Breakdown

**Per Auto-Tune Rebalance Cycle:**
- Phase 1 (withdraw+claim+close): ~30,000 lamports (~$0.0048)
- Swap (if needed): Controlled by Jupiter Ultra API (~varies by network congestion)
- Phase 2 (create position): ~30,000 lamports (~$0.0048)
- **Total without swap**: ~60,000 lamports (~$0.01)
- **Total with swap**: ~60,000 lamports + Jupiter fees (~varies)

### Key Optimizations

1. **Optimized Compute Units**: 600,000 CUs per transaction
2. **Market-Rate Priority Fees**: 50,000 µL/CU (moderate priority for 2025)
3. **Sequential Execution**: Simple, reliable transaction flow
4. **No External Dependencies**: Direct @solana/web3.js usage

### Cost Analysis by Position Size

| Position Size | Cost per Rebalance | Cost % | Break-even Fees |
|---------------|--------------------|---------|-----------------|
| 0.5 SOL (~$80) | ~$0.022 | 0.03% | $0.022 LP fees |
| 1.0 SOL (~$160) | ~$0.022 | 0.01% | $0.022 LP fees |
| 5.0 SOL (~$800) | ~$0.022 | 0.003% | $0.022 LP fees |

**Even 0.5 SOL positions are profitable with typical LP fees!**

## 📈 Monitoring

The bot logs all operations to:
- **Console**: Real-time activity with simplified format (HH:mm:ss timestamps)
- **Action Journal**: Historical execution log (`data/journal.json`)
- **State Snapshots**: Current position state (`data/state.json`)
- **Auto-Tune State**: Rebalance history (`data/auto-tune-state.json`)

### Key Metrics to Monitor

- **Position Composition**: SOL/USDC percentage (triggers rebalance at 80%+)
- **Total Claimed Fees**: Accumulated fees across all rebalances
- **Rebalance Count**: Number of successful rebalances
- **Pool APR/APY**: From Meteora API analytics
- **Transaction Costs**: Typically ~$0.01-$0.022 per rebalance
- **Wallet Balances**: Ensure reserves are maintained

### Financial Tracking (NEW!)

The bot automatically tracks **all financial metrics** in `data/state.json` for complete profit calculation:

**Tracked Metrics:**
- 💸 **Transaction Fees** (costs): All Solana transaction fees paid
- 💰 **LP Fees** (revenue): Fees earned from providing liquidity
- 📊 **Claim History**: Complete history of all fee claims with timestamps
- 📈 **Current Unclaimed Fees**: Real-time tracking of claimable fees

```bash
# View complete financial summary
pnpm tsx src/test/view-transaction-fees.ts
```

**Example output:**
```
=== 📊 Delta-Neutral Bot - Financial Summary ===

💸 TRANSACTION FEES (COSTS)

📊 Transaction Fee Summary
  totalFeeSol: 0.00028
  totalFeeUsd: 0.04
  operationCount: 11

  └─ withdrawClaimClose
    count: 3
    totalFeeSol: 0.000015
    totalFeeUsd: 0.0021

  └─ createPosition
    count: 4
    totalFeeSol: 0.00004
    totalFeeUsd: 0.0057

  └─ swap
    count: 2
    totalFeeSol: 0.00021
    totalFeeUsd: 0.030

💰 LP FEES (REVENUE)

Total Claimed Fees: { sol: 0.005124, usdc: 0.85, claimCount: 2 }
Current Unclaimed Fees: { sol: 0.000012, usdc: 0.02 }

Recent Claims:
  └─ 1/13/2025, 9:10:30 PM: 0.002500 SOL + 0.42 USDC
  └─ 1/13/2025, 9:12:15 PM: 0.002624 SOL + 0.43 USDC

📈 NET PROFIT CALCULATION

Revenue (LP fees earned):    $0.90
Costs (transaction fees):   -$0.04
────────────────────────────────────────
Gross Profit:                $0.86

⚠️  Note: This does NOT include impermanent loss/gain.
```

**Profit formula:**
```typescript
// Complete profit calculation
const lpFeesUsd = (state.lpFees.totalClaimedFees.sol * solPrice) + state.lpFees.totalClaimedFees.usdc;
const txFeesUsd = state.transactionFees.totalFeeUsd;
const impermanentLoss = calculateIL(); // compare current vs initial position value

const netProfit = lpFeesUsd - txFeesUsd - impermanentLoss;
```

All transaction signatures are saved for audit trail on [Solscan](https://solscan.io).

## 🤝 Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Make your changes with tests
4. Submit a pull request

### Development Workflow

```bash
# Run unit tests
pnpm test              # Run Vitest tests
pnpm test:watch        # Run tests in watch mode

# Build and type check
pnpm build             # Compile TypeScript (runs tsc)

# Code quality
pnpm lint              # Run ESLint
pnpm format            # Format with Prettier

# Integration testing
pnpm test:integration  # Test utilities
pnpm test:local        # Test on localnet
```

## 🔄 Solana SDK Migration Roadmap

### Current State: `@solana/web3.js` 1.x

The bot currently uses **@solana/web3.js 1.x** for all Solana interactions. This is the stable, widely-adopted version with excellent ecosystem support.

### Future: Migration to `@solana/kit`

[`@solana/kit`](https://github.com/anza-xyz/kit) (formerly web3.js 2.x) represents the next generation of Solana JavaScript SDKs with significant improvements:

#### Benefits of @solana/kit

- **83% Smaller Bundles**: Tree-shakable architecture reduces bundle size from 111KB → 18KB
- **900% Faster Crypto**: Native Web Crypto API support for Ed25519 operations
- **Zero Dependencies**: No third-party dependencies, reducing supply chain risk
- **Modular Design**: Import only what you need (`@solana/rpc`, `@solana/signers`, etc.)
- **Modern JavaScript**: Native bigint, Web Crypto API, no polyfills needed

#### Migration Strategy

**Why Not Migrate Now?**

1. **External SDK Dependencies**:
   - Meteora DLMM SDK still uses web3.js 1.x
   - Jupiter Aggregator uses web3.js 1.x
   - Requires `@solana/compat` layer for interoperability

2. **Production Stability**:
   - Current bot is working perfectly with 33+ rebalances
   - Migration introduces risk of breaking changes
   - Limited production battle-testing of @solana/kit

3. **Ecosystem Maturity**:
   - Wait for major protocols (Meteora, Jupiter) to migrate first
   - Better documentation and migration guides needed
   - More production examples required

**Migration Timeline (Proposed)**

- **Q2 2025**: Monitor ecosystem adoption (Meteora/Jupiter migration status)
- **Q3 2025**: Begin phased migration if ecosystem has stabilized
  - Phase 1: Migrate internal utilities (`utils/solana.ts`)
  - Phase 2: Add `@solana/compat` layer for external SDKs
  - Phase 3: Comprehensive testing on testnet/localnet
  - Phase 4: Gradual mainnet rollout with monitoring
- **Q4 2025**: Complete migration (if stable)

**Resources**

- [Solana Kit GitHub](https://github.com/anza-xyz/kit)
- [Migration Guide](https://romankurnovskii.com/en/blog/solana-migration-v1-v2)
- [Triton One Blog](https://blog.triton.one/intro-to-the-new-solana-kit-formerly-web3-js-2/)
- [Helius Developer Guide](https://www.helius.dev/blog/how-to-start-building-with-the-solana-web3-js-2-0-sdk)

**Current Assessment**: ⏳ **Monitoring** - Not migrating until ecosystem matures

## 📝 License

MIT License - see [LICENSE](LICENSE) file for details.

## ⚠️ Disclaimer

This software is for educational purposes only. Use at your own risk. The authors are not responsible for any losses incurred from using this bot. Always test thoroughly on devnet/localnet before using with real funds.

## 🙏 Acknowledgments

- [Meteora](https://meteora.ag) - DLMM protocol
- [Jupiter](https://jup.ag) - Best-in-class swap aggregator
- [Solana](https://solana.com) - High-performance blockchain

## 📞 Support

- **Issues**: [GitHub Issues](https://github.com/yourusername/delta_neutral_bot/issues)
- **Discussions**: [GitHub Discussions](https://github.com/yourusername/delta_neutral_bot/discussions)

---

**Built with ❤️ for the Solana ecosystem**