# Delta-Neutral Bot

Automated Solana liquidity operations for Meteora DLMM SOL/USDC positions, with auto-tune rebalancing, Jupiter Ultra swaps, position recovery, and an optional Hono API.

The implemented production path today is Meteora DLMM auto-tune. Drift perpetual hedging is still planned, so this repository is not yet a complete delta-neutral hedge bot. Treat it as a mainnet-capable Meteora position manager with the foundations for later Drift integration.

## Current Status

Implemented:

- Creates Meteora DLMM SOL/USDC positions from configuration or API input.
- Discovers wallet-owned Meteora positions directly from chain so state file loss does not lose position tracking.
- Monitors a single auto-tune position and rebalances when the configured range composition becomes too one-sided.
- Rebalances with Phase 1 withdraw/claim/close, optional Jupiter Ultra swap, then Phase 2 create position.
- Protects wallet SOL with permanent and rent/fee reserves.
- Tracks created position mints, auto-tune state, claimed fees, unclaimed fees, and transaction fees in JSON state files.
- Serves read-only pool, price, bin, and position data over Hono/Bun.
- Guards mutating API endpoints with `API_KEY`, CORS allowlist, body validation, and simple rate limiting.

Planned or incomplete:

- Drift hedge engine and actual short-perp management.
- Main hedge loop and risk controller.
- Emergency Drift unwind flows.
- Several package scripts still reference removed historical test files; use `pnpm test` and `pnpm build` as the reliable validation commands unless the missing scripts are restored.

## Architecture

```text
src/cli/auto-tune.ts
  Starts the auto-tune loop and optional watch mode.

src/modules/autoTuneOrchestrator.ts
  Owns the operational loop:
  discover position -> check composition -> withdraw/claim/close -> plan swap -> create centered position.

src/modules/meteoraAdapter.ts
  Wraps Meteora DLMM SDK calls:
  create position, discover positions, read LP exposure, fetch pool analytics, withdraw/claim/close.

src/modules/swapPlanner.ts
  Pure reserve-aware swap planner shared by initial-position and rebalance flows.

src/modules/jupiterSwapper.ts
  Jupiter Ultra order/sign/execute flow for SOL <-> USDC swaps.

src/core/priceOracle.ts
  Jupiter Lite price data plus Pyth Hermes SOL/USD validation.

src/modules/persistence.ts
  JSON state persistence under data/.

src/api/hono-server.ts
  Optional REST API for UI or operator tooling.
```

## Rebalance Flow

1. The bot discovers positions for the configured Meteora pool and wallet.
2. It reads active bin, position bin bounds, and token composition.
3. If SOL or USDC composition exceeds `AUTO_TUNE_IMBALANCE_THRESHOLD`, it starts a rebalance.
4. Phase 1 calls `withdrawClaimAndClose(positionMint)`, using Meteora SDK support to withdraw all liquidity, claim fees, and close the position in one transaction.
5. The bot calculates target deposits from `AUTO_TUNE_DEPOSIT_TOKEN`, `AUTO_TUNE_DEPOSIT_AMOUNT`, current SOL price, and claimed fees.
6. If the desired size is larger than reserve-adjusted wallet value, the bot scales the new position down and logs a loud warning.
7. `planSwapForDeposit()` determines whether a SOL->USDC or USDC->SOL swap is needed without touching `MINIMUM_WALLET_BALANCE_SOL` or `RENT_RESERVE_SOL`.
8. If needed, Jupiter Ultra performs the swap and the bot waits briefly for balances to settle.
9. Phase 2 creates a new centered DLMM position using `AUTO_TUNE_BIN_COUNT`.
10. State files are updated and transaction fees are tracked asynchronously.

## Quick Start

Install dependencies:

```bash
pnpm install
```

Create a local environment file:

```bash
cp .env.example .env
```

Minimum mainnet configuration:

```bash
RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_KEY
PRIVATE_KEY=YOUR_BASE58_PRIVATE_KEY

AUTO_CREATE_POSITIONS=true
METEORA_POOL_ADDRESS=5rCf1DM8LjKTw4YqhnoLcngyZYeNnQqztScTogYHAS6
METEORA_STRATEGY_TYPE=spot

AUTO_TUNE_ENABLED=true
AUTO_TUNE_BIN_COUNT=20
AUTO_TUNE_CHECK_INTERVAL_MS=30000
AUTO_TUNE_IMBALANCE_THRESHOLD=0.8
AUTO_TUNE_DEPOSIT_TOKEN=SOL
AUTO_TUNE_DEPOSIT_AMOUNT=0.1
AUTO_TUNE_MAX_RETRIES=3

SWAP_ENABLED=true
SWAP_SLIPPAGE_BPS=50
SWAP_SLIPPAGE_BUFFER_PCT=3.0
SWAP_HIGH_IMPACT_WARNING_PCT=1.0

MINIMUM_WALLET_BALANCE_SOL=0.2
RENT_RESERVE_SOL=0.1
```

Build and run the unit tests:

```bash
pnpm build
pnpm test
```

Start auto-tune:

```bash
pnpm auto-tune
```

Start watch mode:

```bash
pnpm auto-tune:watch
```

Stop with `Ctrl+C`. The CLI handles `SIGINT` and `SIGTERM` by marking auto-tune state as stopped.

## Commands

Reliable commands:

```bash
pnpm build             # TypeScript compile
pnpm test              # Vitest unit tests
pnpm test:watch        # Vitest watch mode
pnpm auto-tune         # Main auto-tune loop; uses real funds on mainnet
pnpm auto-tune:watch   # Auto-tune with terminal status display
pnpm api               # Hono API on API_PORT or 3001
pnpm find-pools        # Query Meteora pools
pnpm docker:up         # Start Docker Compose service
pnpm docker:logs       # Follow Docker logs
pnpm docker:down       # Stop Docker Compose service
```

Deployment helpers:

```bash
pnpm deploy:gcp:setup
pnpm deploy:gcp:preview
pnpm deploy:gcp:up
pnpm deploy:gcp:logs
pnpm deploy:gcp:status
```

Stale or environment-specific commands:

- `pnpm test:mainnet` and `pnpm test:integration` currently point at removed `src/test/*` files in this worktree.
- `pnpm localnet:start` and `pnpm localnet:stop` are documented historically but are not present in `package.json`.

## Configuration Reference

Core:

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `RPC_URL` | Yes | none | Mainnet RPC endpoint. |
| `PRIVATE_KEY` | Yes | none | Base58 or supported wallet key format handled by `utils/solana.ts`. |
| `LP_OWNER` | No | none | Optional manual-position owner context. |
| `LOG_LEVEL` | No | `info` | Logger verbosity. |

Meteora:

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `AUTO_CREATE_POSITIONS` | No | `false` | Enables automatic initial position creation. |
| `METEORA_POOL_ADDRESS` | Required for auto-tune | none | DLMM pool address. |
| `METEORA_POSITION_MINTS` | No | empty | Manual mode position mints. |
| `INITIAL_DEPOSIT_SOL` | No | `0` | Used by legacy `autoCreatePositionIfNeeded()`, not the main auto-tune sizing path. |
| `INITIAL_DEPOSIT_USDC` | No | `0` | Used by legacy `autoCreatePositionIfNeeded()`, not the main auto-tune sizing path. |
| `METEORA_STRATEGY_TYPE` | No | `spot` | `spot`, `curve`, or `bidask`. |

Auto-tune:

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `AUTO_TUNE_ENABLED` | No | `false` | Must be `true` for `pnpm auto-tune`. |
| `AUTO_TUNE_BIN_COUNT` | No | `20` | Width of centered position in bins. |
| `AUTO_TUNE_CHECK_INTERVAL_MS` | No | `30000` | Loop interval. |
| `AUTO_TUNE_IMBALANCE_THRESHOLD` | No | `0.9` in code | Trigger when one side exceeds this fraction. `.env.example` currently uses `0.8`. |
| `AUTO_TUNE_DEPOSIT_TOKEN` | No | `SOL` | Base sizing token: `SOL` or `USDC`. |
| `AUTO_TUNE_DEPOSIT_AMOUNT` | No | `1.0` | Base amount before claimed-fee compounding. Start smaller for first live runs. |
| `AUTO_TUNE_MAX_RETRIES` | No | `3` | Phase 1 and Phase 2 retry budget. |

Swaps and reserves:

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `SWAP_ENABLED` | No | `true` | Disables Jupiter swaps when `false`. |
| `SWAP_SLIPPAGE_BPS` | No | `50` | Passed through the swap path where supported. |
| `SWAP_SLIPPAGE_BUFFER_PCT` | No | `3` | Extra input buffer used by the planner. |
| `SWAP_HIGH_IMPACT_WARNING_PCT` | No | `1` | Logs high-impact warnings from Jupiter order data. |
| `MINIMUM_WALLET_BALANCE_SOL` | No | `0.2` | Permanent reserve; planner will not spend it. |
| `RENT_RESERVE_SOL` | No | `0.1` | Temporary reserve for rent and transaction fees. |

API:

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `API_PORT` | No | `3001` | API server port. |
| `API_KEY` | Required for POST | unset | Mutating endpoints return 503 when unset. |
| `API_ALLOWED_ORIGINS` | No | `http://localhost:5173,http://localhost:3000` | Comma-separated CORS allowlist. |
| `API_RATE_LIMIT_PER_MIN` | No | `10` | Per-IP fixed-window limit for mutating routes. |

## API

Start the server:

```bash
pnpm api
```

Read-only endpoints:

- `GET /api/health`
- `GET /api/prices`
- `GET /api/pool/analytics`
- `GET /api/pool/bins`
- `GET /api/positions`

Mutating endpoints:

- `POST /api/positions/create`
- `POST /api/positions/withdraw-claim-close`

Mutating endpoints require `X-API-Key: <API_KEY>`. If `API_KEY` is unset, they fail closed with HTTP 503.

Example close request:

```bash
curl -X POST http://localhost:3001/api/positions/withdraw-claim-close \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_KEY" \
  -d '{"positionMint":"POSITION_MINT"}'
```

## State And Recovery

Local state is stored under `data/`:

- `data/state.json`: created position mints, fee accounting, LP fee state, transaction fee tracking.
- `data/auto-tune-state.json`: auto-tune iterations, last rebalance, current position mint, claimed/unclaimed fee summary.

The bot does not rely only on these files. On each check cycle it discovers positions from the blockchain via Meteora SDK and updates the saved mint list. In auto-tune mode it manages one position and uses the first discovered position if multiple exist, logging a warning for ignored positions.

For GCP deployment, the persistent paths documented by the project are:

- `/var/lib/autotune/data/state.json`
- `/var/lib/autotune/data/auto-tune-state.json`

## Operational Safety

- Run with small `AUTO_TUNE_DEPOSIT_AMOUNT` first.
- Keep `MINIMUM_WALLET_BALANCE_SOL` high enough for manual recovery.
- Keep `RENT_RESERVE_SOL` above expected Meteora position rent and network fees.
- Do not expose the API without `API_KEY` and a tight `API_ALLOWED_ORIGINS` list.
- Watch for warnings named `POSITION SCALED DOWN`, `HIGH PRICE IMPACT`, `UNCLOSED POSITION DETECTED`, and `Phase 1 failed`.
- If a swap planner error says no swap can resolve the wallet balance, deposit funds or reduce `AUTO_TUNE_DEPOSIT_AMOUNT`; retrying alone will not fix it.
- If Phase 1 reports a local timeout, the code rechecks chain state before retrying to avoid double-closing an already-settled position.

## Documentation

- [Tiered procedural runbook](docs/TIERED_PROCEDURAL_RUNBOOK.md)
- [Interactive Meteora pool tracker diagram](docs/interactive-meteora-pool-tracker-diagram.html)
- [API reference](docs/API.md)
- [Position tracking fix](docs/POSITION_TRACKING_FIX.md)
- [GCP Pulumi deployment](deploy/gcp/pulumi/README.md)
- [Billing setup](deploy/gcp/pulumi/BILLING_SETUP.md)
- [Troubleshooting](deploy/gcp/pulumi/TROUBLESHOOTING.md)
- [Profitability analysis](PROFITABILITY_ANALYSIS.md)
- [Profitability quick reference](PROFITABILITY_QUICK_REFERENCE.md)
- [Project progress](progress.md)
- [Architectural decisions](decisions.md)
- [Bug tracker](bugs.md)

## Development Notes

This repo has an active, dirty worktree. Before changing behavior, check `git status --short` and inspect modified files you plan to touch. Do not assume README, package scripts, or historical docs are authoritative; source files are the current implementation source of truth.

The strongest current test coverage is the pure swap planner test in `src/modules/swapPlanner.test.ts`. For operational changes, prefer adding small pure tests around planning/math first, then targeted integration checks against a controlled wallet.

## Disclaimer

This software can move real mainnet funds. It is experimental and incomplete as a full delta-neutral strategy until Drift hedge management is implemented. Use at your own risk, start with small amounts, and verify every configuration before running unattended.
