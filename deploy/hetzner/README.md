# Hetzner Deployment

Single small VM + Docker Compose. No IaC framework — three shell scripts.

## One-time setup

### Option A — provision a new server (needs an API token)

```bash
brew install hcloud
export HCLOUD_TOKEN=...        # Hetzner console → project → Security → API tokens (read+write)
bash deploy/hetzner/provision.sh          # creates a CX22 (~€4/mo) with Docker via cloud-init
```

### Option B — bring your own server

Any Ubuntu/Debian box with Docker + the compose plugin works:

```bash
ssh root@<ip> 'curl -fsSL https://get.docker.com | sh && mkdir -p /opt/delta-bot/data'
```

### Point the scripts at the server

```bash
cp deploy/hetzner/host.env.example deploy/hetzner/host.env
# edit: HETZNER_HOST=<ip>   (host.env is gitignored)
```

### Server-side env

Create `.env.hetzner` in the repo root (gitignored, uploaded as the server's
`.env` on every deploy). Start from `.env.example`. The launch-relevant knobs:

```bash
# --- Stage A: everything observable, nothing spendable ---
AUTO_TUNE_ENABLED=true
AUTO_CREATE_POSITIONS=false     # flip to true at go-live
HEDGE_ENABLED=true
HEDGE_DRY_RUN=true              # flip to false at go-live
HEDGE_TARGET_DELTA_SOL=0        # delta-neutral
DELTA_THRESHOLD_SOL=0.15        # band — size it to ~10% of LP SOL exposure
MAX_HEDGE_NOTIONAL_USD=150      # hard ceiling for the small-stakes launch
HEDGE_TARGET_COLLATERAL_RATIO=0.33   # ~3x (ADR-016)
HEDGE_CARRY_CAP_BPS=5000        # refuse to grow the hedge above 50% APR carry
HEDGE_COOLDOWN_MS=120000
```

`deploy.sh` appends `STRATEGY_VERSION=<git hash>` automatically.

## Deploy / redeploy

```bash
pnpm deploy:hetzner    # rsync + upload .env + docker compose up -d --build
```

## Observe

```bash
pnpm logs:hetzner                          # follow container logs
pnpm ssh:hetzner                           # shell on the server
pnpm dashboard                             # local TUI — read-only, same wallet/RPC, works from anywhere
ssh <host> 'cd /opt/delta-bot && docker compose exec delta-neutral-bot bun run src/cli/pnl.ts'
```

The dashboard needs no server access at all — it reads the chain directly, so
LP exposure, hedge state, net-ΔSOL band and liquidation price are all visible
from your laptop while the bot runs on the server.

## Go-live checklist (Stage B)

1. Wallet funded: SOL for LP + fees, USDC for short collateral.
2. `.env.hetzner`: set `AUTO_CREATE_POSITIONS=true`, `HEDGE_DRY_RUN=false`,
   review `AUTO_TUNE_DEPOSIT_TOKEN/AMOUNT`, `DELTA_THRESHOLD_SOL`,
   `MAX_HEDGE_NOTIONAL_USD`.
3. `pnpm deploy:hetzner` (uploads env, restarts container).
4. Watch the first cycle end-to-end: `pnpm logs:hetzner`.

## Emergency

```bash
# Flatten the hedge (both sides, fill at any price) from ANY machine with the .env:
npx tsx src/cli/jupiter-hedge.ts --emergency --live

# Stop the bot on the server:
ssh <host> 'cd /opt/delta-bot && docker compose down'
```

State (`data/state.json`, `data/auto-tune-state.json`, `data/pnl.db`) lives in
the host-mounted `/opt/delta-bot/data` and survives restarts and redeploys
(rsync excludes `data/`).
