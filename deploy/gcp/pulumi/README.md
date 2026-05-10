# Pulumi GCP Deployment for Auto-Tune Bot

Simple, declarative infrastructure deployment using Pulumi.

## Why Pulumi?

- ✅ **Simple**: TypeScript infrastructure-as-code (same language as the bot)
- ✅ **Declarative**: Define what you want, Pulumi handles how
- ✅ **State Management**: Automatic state tracking and updates
- ✅ **Preview Changes**: See what will change before applying
- ✅ **Idempotent**: Safe to run multiple times

## Prerequisites

1. **Install Pulumi**
   ```bash
   curl -fsSL https://get.pulumi.com | sh
   ```

2. **Install Dependencies**
   ```bash
   cd deploy/gcp/pulumi
   npm install
   ```

3. **Configure GCP**
   ```bash
   gcloud auth login
   gcloud config set project YOUR_PROJECT_ID
   gcloud auth application-default login
   ```

4. **Prepare .env file**
   Create `.env` file in project root with your secrets.

   **API security env vars (added 2026-05-09 audit):** if you plan to expose the Hono API on the VM, set these *before* deploying — otherwise the API server fails-closed and POST endpoints return HTTP 503:

   ```bash
   # Generate once:
   #   openssl rand -hex 32
   API_KEY=<your-32-byte-hex>

   # Pin to your UI's exact origin in production:
   API_ALLOWED_ORIGINS=https://your-ui.example.com

   # Per-IP rate limit (default 10/min):
   API_RATE_LIMIT_PER_MIN=10
   ```

   If you only run `pnpm auto-tune` (no API), you can leave these unset; the auto-tune CLI bypasses the API server entirely.

   **Audit-bumped defaults to be aware of:** `SWAP_SLIPPAGE_BUFFER_PCT` now defaults to `3.0` (was `0.5`). `SWAP_HIGH_IMPACT_WARNING_PCT` is new (default `1.0`). See root `.env.example` for the full list.

## Quick Start

### 1. Initialize Pulumi Stack

```bash
cd deploy/gcp/pulumi

# Create new stack (e.g., "prod", "dev", "test")
pulumi stack init prod

# Configure GCP project
pulumi config set gcp:project YOUR_PROJECT_ID

# Optional: Configure region/zone (defaults to free tier)
pulumi config set gcp:region us-central1
pulumi config set gcp:zone us-central1-a

# IMPORTANT: Set up billing alerts (protects against charges)
# See BILLING_SETUP.md for detailed instructions
# Note: Use 'autotune:' namespace for billing configuration
pulumi config set --secret autotune:billingAccountId YOUR_BILLING_ACCOUNT_ID
pulumi config set autotune:budgetAlertEmails your-email@example.com
pulumi config set autotune:budgetAmount 1.0  # Alert at $1 USD
```

### 2. Deploy

```bash
# Preview changes
pulumi preview

# Deploy infrastructure
pulumi up
```

That's it! Pulumi will:
1. ✅ Enable required GCP APIs
2. ✅ Create service account
3. ✅ Upload secrets to Secret Manager
4. ✅ Build and push Docker image to GCR
5. ✅ Create e2-micro VM (FREE TIER)
6. ✅ Deploy and start container

### 3. Monitor

Use the convenient management script:

```bash
cd deploy/gcp/pulumi

# View live container logs
./scripts/manage.sh logs

# Check VM and container status
./scripts/manage.sh status

# View all available commands
./scripts/manage.sh help
```

Or use Pulumi outputs directly:

```bash
# View all output commands
pulumi stack output

# View logs
$(pulumi stack output logsCommand)

# SSH into VM
$(pulumi stack output sshCommand)
```

## Overnight-Run Runbook

Quick checklist for "I want to run this for a night and look at PnL in the
morning". Assumes `pulumi stack init` and `gcloud auth` are already done.

### 1. Pre-flight (one-time per code change)

```bash
# From project root — make sure code typechecks and tests pass before
# anything ships to GCP.
npx tsc --noEmit
pnpm test

# Confirm .env has at minimum:
#   RPC_URL=https://mainnet.helius-rpc.com/?api-key=...
#   PRIVATE_KEY=...
#   AUTO_TUNE_ENABLED=true
#   AUTO_CREATE_POSITIONS=true   # if you want the bot to create the position
#   METEORA_POOL_ADDRESS=...
#   AUTO_TUNE_DEPOSIT_TOKEN=SOL  # or USDC
#   AUTO_TUNE_DEPOSIT_AMOUNT=1
#   AUTO_TUNE_IMBALANCE_THRESHOLD=0.92
#
# Optional new flags (May 2026):
#   SEND_OPTIMIZED=true          # adaptive priority fee + tight CU limit (recommended)
#   STRATEGY_LABEL="my-experiment"  # human-friendly label for PnL DB rows
```

### 2. Deploy

```bash
cd deploy/gcp/pulumi
pulumi up --yes
```

Pulumi will detect the local git short hash and inject it as
`STRATEGY_VERSION` so every PnL row stamps the actual commit. If the working
tree is dirty you'll see `-dirty` appended. If you *want* to override (e.g.
to pin a label), set `STRATEGY_VERSION=…` in `.env`.

The new Dockerfile installs `python3 / make / g++ / git` so better-sqlite3
compiles cleanly on Alpine when no prebuild matches. First build is ~3-4
minutes; rebuilds with the same image cache are <1 minute.

### 3. Watch it boot

```bash
# Startup script (Docker pull, env-file build, container start):
./scripts/manage.sh logs-startup

# Once container is up, follow live bot logs:
./scripts/manage.sh logs
```

Look for these lines on a healthy boot:

- `📈 PnL database opened { path: '/app/data/pnl.db' }`
- `AutoTuneOrchestrator initialized { enabled: true, ... }`
- `Auto-tune check cycle started`
- If `SEND_OPTIMIZED=true`: `📤 [sendOptimized:createPosition] sending { cuLimit, cuPriceMicroLamports, ... }`
- New validation gate (rare): `⚠️  Imbalance trigger fired but wallet is already 50/50 ±10%` — should never fire under normal trading; if it does, investigate.

### 4. Check PnL in the morning

The PnL CLI lives in the container, so the cleanest path is to copy
`pnl.db` down and run `pnpm pnl` locally:

```bash
# 1. SCP the DB down (read-only — does not interrupt the running bot).
gcloud compute scp \
  autotune-prod:/var/lib/autotune/data/pnl.db \
  /tmp/pnl.db \
  --zone=$(pulumi stack output instanceZone)

# 2. Run the inspector locally (uses /tmp/pnl.db via the same path the bot uses).
#    The CLI hard-codes data/pnl.db, so symlink it into your project:
ln -sf /tmp/pnl.db ./data/pnl.db
pnpm pnl
```

Or stay on the VM:

```bash
./scripts/manage.sh ssh
docker exec -it autotune-prod sh
cd /app && bun run src/cli/pnl.ts
```

What to look for on the report:

- **Realized PnL vs HODL-only-SOL** — over a full night you should beat HODL
  if SOL was choppy. If SOL trended hard one way, expect HODL to win.
- **Network fees by operation** — with `SEND_OPTIMIZED=true` the
  `create_position` and `withdraw_claim_close` rows should show ~30-70 %
  lower `fee_sol` totals than they did before the wrapper landed.
- **Recent rebalances** — count + average duration + claimed fees per event.
  Rebalance count per hour ≈ trigger threshold tightness.
- **Validation-gate hits in logs** — should be zero. If non-zero, investigate.

### 5. Stop the bot

```bash
./scripts/manage.sh stop    # stops the VM (keeps disk + state)
# … or
./scripts/manage.sh restart # bounces VM (re-pulls image, useful after pulumi up)
```

State files (`state.json`, `auto-tune-state.json`, `pnl.db`) live on the
boot disk under `/var/lib/autotune/data` and survive VM stop/start. They
do NOT survive `pulumi destroy`.

---

## Configuration Options

All configuration is done via `pulumi config`:

```bash
# Machine type (default: e2-micro for free tier)
pulumi config set autotune:machineType e2-micro

# Disk size in GB (default: 30, max for free tier)
pulumi config set autotune:diskSize 30

# Path to .env file (default: ../../../.env)
pulumi config set autotune:envFile /path/to/.env

# GCP zone (free tier zones: us-west1, us-central1, us-east1)
pulumi config set gcp:zone us-central1-a
```

## Managing Infrastructure

### Quick Management Commands

```bash
cd deploy/gcp/pulumi

# Restart VM and container (useful after fixing issues)
./scripts/manage.sh restart

# View live logs
./scripts/manage.sh logs

# Check status
./scripts/manage.sh status

# Stop VM (save costs)
./scripts/manage.sh stop

# Start VM
./scripts/manage.sh start

# SSH into VM
./scripts/manage.sh ssh

# View all commands
./scripts/manage.sh help
```

### Update Secrets

1. Edit `.env` file with new values
2. Run `pulumi up` - Pulumi will detect changes and update only what changed

```bash
# Pulumi will show exactly what changed
pulumi preview

# Apply changes
pulumi up
```

### Update Container Image

1. Make code changes
2. Run `pulumi up` - Pulumi will rebuild and redeploy

```bash
pulumi up
```

### Stop VM (save costs)

```bash
gcloud compute instances stop autotune-prod --zone=us-central1-a
```

### Start VM

```bash
gcloud compute instances start autotune-prod --zone=us-central1-a
```

### View State File

```bash
gcloud compute ssh autotune-prod --zone=us-central1-a --command='cat /var/lib/autotune/data/auto-tune-state.json'
```

### Destroy Everything

```bash
# Preview what will be deleted
pulumi destroy --preview

# Delete all resources
pulumi destroy
```

## Multiple Environments

Pulumi stacks make it easy to manage multiple environments:

```bash
# Production
pulumi stack init prod
pulumi config set gcp:project my-prod-project
pulumi up

# Development
pulumi stack init dev
pulumi config set gcp:project my-dev-project
pulumi config set autotune:machineType e2-small  # More resources for dev
pulumi up

# Switch between stacks
pulumi stack select prod
pulumi stack select dev
```

## Cost Breakdown

| Resource | Cost | Notes |
|----------|------|-------|
| e2-micro VM | **$0** | Free tier: 1 instance/month |
| 30GB standard disk | **$0** | Free tier: 30GB/month |
| Secrets (15 secrets) | **$0** | Free tier: 6 active versions |
| Container Registry | **$0** | Free tier: 1GB storage |
| Egress | **$0** | Free tier: 1GB/month |
| **Total** | **$0/month** | ✅ Within free tier |

⚠️ **Warning**: Upgrading machine type or disk size may incur charges.

## Troubleshooting

### Build fails

```bash
# Check Docker is running
docker ps

# Verify gcloud auth
gcloud auth list
gcloud auth application-default login
```

### Secrets not loading

```bash
# Verify .env file path
pulumi config get autotune:envFile

# Check secrets were created
gcloud secrets list --filter="name:autotune-*"
```

### VM won't start

```bash
# Check startup script logs
gcloud compute instances get-serial-port-output autotune-prod --zone=us-central1-a

# SSH and check Docker
gcloud compute ssh autotune-prod --zone=us-central1-a
docker ps
docker logs autotune
```

### Pulumi state is out of sync

```bash
# Refresh state from cloud
pulumi refresh

# Import existing resource (if created manually)
pulumi import gcp:compute/instance:Instance autotune-vm projects/PROJECT/zones/ZONE/instances/NAME
```

## Advanced: CI/CD Integration

```yaml
# .github/workflows/deploy.yml
name: Deploy Auto-Tune

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install Pulumi
        uses: pulumi/actions@v5

      - name: Configure GCP
        uses: google-github-actions/auth@v2
        with:
          credentials_json: ${{ secrets.GCP_CREDENTIALS }}

      - name: Deploy with Pulumi
        run: |
          cd deploy/gcp/pulumi
          npm install
          pulumi stack select prod
          pulumi up --yes
        env:
          PULUMI_ACCESS_TOKEN: ${{ secrets.PULUMI_ACCESS_TOKEN }}
```

## Comparison: Bash Scripts vs Pulumi

| Aspect | Bash Scripts | Pulumi |
|--------|--------------|--------|
| **Complexity** | 400+ lines | 200 lines |
| **State Management** | Manual | Automatic |
| **Idempotent** | ❌ No | ✅ Yes |
| **Preview Changes** | ❌ No | ✅ Yes |
| **Type Safety** | ❌ No | ✅ TypeScript |
| **Error Handling** | Manual | Automatic |
| **Dependencies** | Manual | Automatic |
| **Multi-Environment** | Separate scripts | Single codebase |

## Next Steps

1. **Set up monitoring**: Add Cloud Monitoring alerts
2. **Enable backups**: Snapshot the persistent disk
3. **Add health checks**: Implement health check endpoint
4. **CI/CD**: Automate deployment with GitHub Actions
5. **Scaling**: Add Cloud Scheduler for periodic runs

## Resources

- [Pulumi GCP Documentation](https://www.pulumi.com/docs/clouds/gcp/)
- [GCP Free Tier](https://cloud.google.com/free)
- [Pulumi Examples](https://github.com/pulumi/examples)
