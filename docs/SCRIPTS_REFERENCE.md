# Scripts Reference

Complete reference for all npm/pnpm scripts available in this project.

## 📋 Quick Reference

```bash
# Local Development
pnpm auto-tune              # Run auto-tune locally
pnpm api                    # Run API server

# Docker (Local)
pnpm docker:up              # Start in Docker
pnpm docker:logs            # View logs
pnpm docker:down            # Stop Docker

# GCP Deployment
pnpm deploy:gcp:up          # Deploy to GCP
pnpm deploy:gcp:logs        # View GCP logs
pnpm deploy:gcp:destroy     # Delete from GCP
```

---

## 🚀 Local Development Scripts

### Auto-Tune Mode

```bash
# Start auto-tune orchestrator (REAL FUNDS!)
pnpm auto-tune

# Start with watch mode (visual display)
pnpm auto-tune:watch
```

**What it does:**
- Monitors Meteora DLMM positions
- Auto-rebalances when imbalanced (>90% in one token)
- Auto-compounds fees
- Maintains concentrated liquidity

**Use when:**
- Running bot locally for testing
- Development and debugging
- Monitoring positions manually

---

### API Server

```bash
# Start Hono API server on port 3001
pnpm api
```

**What it does:**
- Exposes REST API endpoints
- Provides pool analytics
- Position management endpoints
- Price oracle data

**Endpoints:**
- `GET /api/health` - Health check
- `GET /api/prices` - Oracle prices
- `GET /api/pool/analytics` - Pool data
- `GET /api/positions` - User positions

**Use when:**
- Building web UI for the bot
- Monitoring via HTTP requests
- Integration with other services

---

## 🐳 Docker Scripts

### Build & Run

```bash
# Build Docker image
pnpm docker:build

# Start container in background
pnpm docker:up

# Build and start (if code changed)
pnpm docker:rebuild
```

**What it does:**
- Builds Docker image with Bun runtime
- Runs auto-tune in container
- Persists state to `./data` directory
- Auto-restarts on failure

**Use when:**
- Testing Docker setup locally
- Preparing for production deployment
- Ensuring environment consistency

---

### Monitor & Control

```bash
# View real-time logs
pnpm docker:logs

# Restart container
pnpm docker:restart

# Stop and remove container
pnpm docker:down
```

**What it does:**
- `docker:logs` - Tails container logs (Ctrl+C to exit)
- `docker:restart` - Restarts without rebuilding
- `docker:down` - Stops and removes container (data persists)

**Use when:**
- Debugging issues
- Applying configuration changes
- Stopping bot temporarily

---

## ☁️ GCP Deployment Scripts

### Setup & Configuration

```bash
# Install Pulumi dependencies
pnpm deploy:gcp:setup

# View/edit Pulumi configuration
pnpm deploy:gcp:config

# Preview changes before deploying
pnpm deploy:gcp:preview
```

**What it does:**
- `setup` - Installs npm packages in `deploy/gcp/pulumi/`
- `config` - Shows current Pulumi configuration
- `preview` - Dry-run to see what will be created/changed

**Use when:**
- First time setup
- Checking configuration
- Reviewing changes before deployment

---

### Deploy & Destroy

```bash
# Deploy to GCP (creates all infrastructure)
pnpm deploy:gcp:up

# Destroy all GCP resources
pnpm deploy:gcp:destroy
```

**What it does:**

**`deploy:gcp:up`:**
- Enables GCP APIs
- Creates secrets in Secret Manager
- Builds and pushes Docker image to GCR
- Creates e2-micro VM instance
- Deploys container with auto-restart

**`deploy:gcp:destroy`:**
- Stops VM instance
- Deletes Docker image
- Removes secrets
- Deletes service account
- ⚠️ **Destroys state files** (backup first!)

**Use when:**
- Deploying to production
- Cleaning up resources
- Switching projects

---

### Monitor & Manage

```bash
# View container logs from GCP
pnpm deploy:gcp:logs

# SSH into GCP VM
pnpm deploy:gcp:ssh

# View stack status and outputs
pnpm deploy:gcp:status

# Stop VM instance (save costs)
pnpm deploy:gcp:stop

# Start VM instance
pnpm deploy:gcp:start
```

**What it does:**

**`deploy:gcp:logs`:**
- Streams Docker container logs from GCP VM
- Real-time output (Ctrl+C to exit)

**`deploy:gcp:ssh`:**
- Opens SSH connection to GCP VM
- Run commands directly on instance

**`deploy:gcp:status`:**
- Shows all Pulumi stack outputs
- VM name, zone, Docker image, SSH commands

**`deploy:gcp:stop/start`:**
- Stops/starts VM instance
- Free tier still applies when stopped

**Use when:**
- Monitoring production bot
- Debugging deployment issues
- Temporarily stopping bot

---

## 🧪 Testing Scripts

```bash
# Run all tests
pnpm test

# Run tests in watch mode
pnpm test:watch

# Test on mainnet (REAL FUNDS!)
pnpm test:mainnet

# Run integration tests
pnpm test:integration
```

**What it does:**
- `test` - Runs Vitest test suite
- `test:watch` - Watches for changes and re-runs
- `test:mainnet` - Tests Meteora operations on mainnet
- `test:integration` - Tests utilities and helpers

**Use when:**
- Development and debugging
- Validating changes
- Before deploying to production

---

## 🛠️ Utility Scripts

```bash
# Find SOL/USDC pools on mainnet
pnpm find-pools

# Build TypeScript
pnpm build

# Lint code
pnpm lint

# Format code
pnpm format
```

**What it does:**
- `find-pools` - Discovers Meteora DLMM pools
- `build` - Compiles TypeScript to JavaScript
- `lint` - Runs ESLint checks
- `format` - Formats code with Prettier

**Use when:**
- Setting up new pools
- Preparing for production build
- Code quality checks

---

## 📊 Common Workflows

### Local Development Workflow

```bash
# 1. Start auto-tune locally
pnpm auto-tune

# 2. In another terminal, start API server
pnpm api

# 3. Monitor logs
# (logs appear in terminal)
```

---

### Docker Development Workflow

```bash
# 1. Build and start
pnpm docker:up

# 2. View logs
pnpm docker:logs

# 3. Make code changes

# 4. Rebuild and restart
pnpm docker:rebuild

# 5. Stop when done
pnpm docker:down
```

---

### GCP Deployment Workflow

```bash
# 1. Setup (first time only)
pnpm deploy:gcp:setup

# 2. Configure
cd deploy/gcp/pulumi
pulumi stack init prod
pulumi config set gcp:project YOUR_PROJECT
pulumi config set gcp:region us-central1
pulumi config set gcp:zone us-central1-a
cd ../../..

# 3. Preview changes
pnpm deploy:gcp:preview

# 4. Deploy
pnpm deploy:gcp:up

# 5. Monitor
pnpm deploy:gcp:logs

# 6. Check status
pnpm deploy:gcp:status
```

---

### Update GCP Deployment

```bash
# 1. Make code changes locally
git add .
git commit -m "Update bot"

# 2. Rebuild and redeploy
pnpm deploy:gcp:up

# This rebuilds Docker image and restarts VM
```

---

### Backup Before Destroying

```bash
# 1. SSH into VM
pnpm deploy:gcp:ssh

# 2. Inside VM, backup state
cat /var/lib/autotune/data/auto-tune-state.json > backup-state.json
exit

# 3. Now safe to destroy
pnpm deploy:gcp:destroy
```

---

## 🔍 Troubleshooting Scripts

### Check Docker Status

```bash
# View running containers
docker ps

# View logs
pnpm docker:logs

# Inspect container
docker inspect delta-neutral-bot

# Check resource usage
docker stats delta-neutral-bot
```

---

### Check GCP Status

```bash
# View stack outputs
pnpm deploy:gcp:status

# SSH into VM
pnpm deploy:gcp:ssh

# Inside VM:
docker ps                    # Check container
docker logs -f autotune      # View logs
cat /var/lib/autotune/data/auto-tune-state.json  # Check state
```

---

### Fix Common Issues

**Frozen lockfile error:**
```bash
# Update lockfile
bun install

# Rebuild Docker
pnpm docker:rebuild
```

**GCP deployment fails:**
```bash
# Check Pulumi config
pnpm deploy:gcp:config

# Verify GCP authentication
gcloud auth list
gcloud auth application-default login

# Preview changes
pnpm deploy:gcp:preview
```

**Container won't start:**
```bash
# Check logs
pnpm docker:logs

# Verify .env file exists
ls -la .env

# Test config
pnpm build
```

---

## 🎯 Script Aliases (Alternative Commands)

You can also use these shorter aliases:

```bash
# npm/pnpm are interchangeable
npm run docker:up
pnpm docker:up

# Use yarn if preferred
yarn docker:up
```

---

## 📖 Full Script List

| Script | Command | Description |
|--------|---------|-------------|
| `auto-tune` | `tsx src/cli/auto-tune.ts` | Run auto-tune locally |
| `auto-tune:watch` | `tsx src/cli/auto-tune.ts --watch` | Auto-tune with watch mode |
| `api` | `bun run src/api/hono-server.ts` | Start API server |
| `build` | `tsc` | Build TypeScript |
| `test` | `vitest` | Run tests |
| `test:watch` | `vitest --watch` | Watch tests |
| `test:mainnet` | `tsx src/test/mainnet-meteora-test.ts` | Test on mainnet |
| `test:integration` | `tsx src/test/integration-test.ts` | Integration tests |
| `find-pools` | `tsx scripts/find-mainnet-pools.ts` | Find pools |
| `lint` | `eslint src --ext .ts` | Lint code |
| `format` | `prettier --write "src/**/*.ts"` | Format code |
| **Docker** | | |
| `docker:build` | `docker compose build` | Build image |
| `docker:up` | `docker compose up -d` | Start container |
| `docker:down` | `docker compose down` | Stop container |
| `docker:logs` | `docker compose logs -f` | View logs |
| `docker:restart` | `docker compose restart` | Restart container |
| `docker:rebuild` | `docker compose up -d --build` | Rebuild & restart |
| **GCP Deploy** | | |
| `deploy:gcp:setup` | `cd deploy/gcp/pulumi && npm install` | Setup Pulumi |
| `deploy:gcp:config` | `cd deploy/gcp/pulumi && pulumi config` | View config |
| `deploy:gcp:preview` | `cd deploy/gcp/pulumi && pulumi preview` | Preview changes |
| `deploy:gcp:up` | `cd deploy/gcp/pulumi && pulumi up` | Deploy |
| `deploy:gcp:destroy` | `cd deploy/gcp/pulumi && pulumi destroy` | Destroy |
| `deploy:gcp:logs` | `cd deploy/gcp/pulumi && pulumi stack output logsCommand \| bash` | View logs |
| `deploy:gcp:ssh` | `cd deploy/gcp/pulumi && pulumi stack output sshCommand \| bash` | SSH to VM |
| `deploy:gcp:status` | `cd deploy/gcp/pulumi && pulumi stack output` | Stack status |
| `deploy:gcp:stop` | `cd deploy/gcp/pulumi && pulumi stack output stopCommand \| bash` | Stop VM |
| `deploy:gcp:start` | `cd deploy/gcp/pulumi && pulumi stack output startCommand \| bash` | Start VM |

---

## 💡 Tips

1. **Use `pnpm` for faster installs** (recommended)
2. **Chain commands** with `&&`:
   ```bash
   pnpm build && pnpm docker:rebuild
   ```
3. **Run in background** with nohup:
   ```bash
   nohup pnpm auto-tune > auto-tune.log 2>&1 &
   ```
4. **Monitor multiple logs**:
   ```bash
   # Terminal 1
   pnpm docker:logs

   # Terminal 2
   pnpm deploy:gcp:logs
   ```

---

## 🆘 Getting Help

- **Script not working?** Check [package.json](../package.json:7-35) for exact command
- **Docker issues?** See [DOCKER_GUIDE.md](DOCKER_GUIDE.md)
- **GCP issues?** See [GCP_PULUMI_DEPLOYMENT.md](GCP_PULUMI_DEPLOYMENT.md)
- **General help?** See [CLAUDE.md](../CLAUDE.md)
