# Delta-Neutral Liquidity Provision Bot

A sophisticated automated market-making bot for Solana that provides liquidity on Meteora DLMM (SOL/USDC) while maintaining delta neutrality through Drift Protocol perpetual shorts.

[![Solana](https://img.shields.io/badge/Solana-Mainnet-9945FF?logo=solana)](https://solana.com)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue?logo=typescript)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

## 🎯 Overview

This bot earns LP fees from Meteora DLMM pools while minimizing directional exposure to SOL price movements by maintaining a short position on Drift Protocol. The result is a market-neutral strategy that profits from trading fees and funding rate arbitrage.

### Key Features

- ✅ **Automated Position Creation** - No manual setup required
- 📊 **Delta-Neutral Strategy** - Maintains ΔSOL ≈ 0 through automatic rebalancing
- 🔄 **Meteora DLMM Integration** - Concentrated liquidity with customizable ranges
- ⚡ **Drift Protocol Hedging** - Perpetual shorts for delta neutrality
- 🎯 **Jito Bundle Support** - MEV protection and guaranteed execution ordering
- 📈 **Real-time Pool Analytics** - Jupiter v6 + Meteora API integration
- 🛡️ **Risk Management** - Configurable limits on delta, margin, and funding rates
- 📝 **Comprehensive Logging** - Structured JSON logs with action journal

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
- **DriftEngine** - Handles perpetual short positions and collateral management
- **RiskController** - Enforces delta thresholds, margin requirements, funding rate caps
- **Bundler** - Executes transactions with Jito bundles and priority fees
- **Orchestrator** - Main hedge loop and emergency flow coordination

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

# Risk Parameters
DELTA_THRESHOLD_SOL=2
MIN_COLLATERAL_RATIO=0.15
MAX_SHORT_NOTIONAL_USD=12000
FUNDING_RATE_CAP_BPS=80

# Jito
USE_JITO=true
JITO_RELAY_URL=https://mainnet.block-engine.jito.wtf
PRIORITY_TIP_LAMPORTS=80000
```

### Running the Bot

```bash
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

**Note**: The main hedge loop and CLI commands are planned for future implementation. Currently, you can test individual modules using the test scripts above.

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
- ✅ Jito dynamic tip escalation
- ✅ Price oracle utilities

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
| `USE_JITO` | Enable Jito bundles | `true` |
| `PRIORITY_TIP_LAMPORTS` | Priority fee | `80000` |

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
- **Jito Bundles**: Enable for MEV protection on sensitive transactions
- **Risk Limits**: Set conservative limits for initial testing

## 📈 Monitoring

The bot logs all operations to:
- **Console**: Real-time activity (structured JSON)
- **Action Journal**: Historical execution log (`data/journal.json`)
- **State Snapshots**: Current position state (`data/state.json`)

### Key Metrics to Monitor

- **Delta**: Should stay within threshold
- **Collateral Ratio**: Should stay above minimum
- **Funding Rate**: Avoid positions when funding is extreme
- **Pool APR/APY**: From Meteora API analytics
- **Claimable Fees**: Accumulating trading fees

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

## 📝 License

MIT License - see [LICENSE](LICENSE) file for details.

## ⚠️ Disclaimer

This software is for educational purposes only. Use at your own risk. The authors are not responsible for any losses incurred from using this bot. Always test thoroughly on devnet/localnet before using with real funds.

## 🙏 Acknowledgments

- [Meteora](https://meteora.ag) - DLMM protocol
- [Drift Protocol](https://drift.trade) - Perpetual futures
- [Solana Agent Kit](https://github.com/sendaifun/solana-agent-kit) - Blockchain agent framework
- [meteora-lp-army-bot](https://github.com/user/meteora-lp-army-bot) - Inspiration for utilities

## 📞 Support

- **Issues**: [GitHub Issues](https://github.com/yourusername/delta_neutral_bot/issues)
- **Discussions**: [GitHub Discussions](https://github.com/yourusername/delta_neutral_bot/discussions)

---

**Built with ❤️ for the Solana ecosystem**
