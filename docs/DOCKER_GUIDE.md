# Docker Guide for Delta-Neutral Bot

This guide covers running the delta-neutral liquidity provision bot in Docker containers.

> **✅ Verified Working**: This guide reflects the actual working Docker configuration successfully deployed and tested.

## Prerequisites

- **Docker** installed ([Get Docker](https://docs.docker.com/get-docker/))
- **Docker Compose** installed (included with Docker Desktop)
- `.env` file configured with your settings (copy from `.env.example`)
- **Bun lockfile** up to date (run `bun install` before building)

## Quick Start

### 1. Prepare Environment Configuration

```bash
# Copy example environment file
cp .env.example .env

# Edit .env with your configuration
nano .env  # or vim, code, etc.
```

**Required configuration:**
- `RPC_URL`: Your Solana mainnet RPC endpoint (Helius, QuickNode, etc.)
- `PRIVATE_KEY`: Your wallet private key (base58 or comma-separated bytes)
- `LP_OWNER`: Your wallet public key
- `METEORA_POOL_ADDRESS`: Meteora DLMM pool address

**Important settings for auto-tune:**
- `AUTO_TUNE_ENABLED=true`: Enable automatic position rebalancing
- `AUTO_TUNE_DEPOSIT_AMOUNT=0.5`: Amount of SOL/USDC to use per position
- `MINIMUM_WALLET_BALANCE_SOL=0.2`: Permanent reserve (never touched)
- `RENT_RESERVE_SOL=0.1`: Temporary reserve for rent/fees

### 2. Update Dependencies (Important!)

```bash
# Update bun.lock to avoid frozen lockfile errors
bun install

# This ensures the lockfile matches your package.json
```

### 3. Build and Run with Docker Compose

```bash
# Build and start the bot
docker compose up -d

# View logs (follow mode)
docker compose logs -f

# Stop the bot
docker compose down
```

**Expected output on first run:**
- ✅ Image builds successfully (~10-15 seconds)
- ✅ Container starts and loads position state
- ✅ Auto-tune loop begins monitoring positions
- ✅ Health check starts (if using API server)

### 4. Alternative: Direct Docker Commands

```bash
# Build the image
docker build -t delta-neutral-bot .

# Run the container
docker run -d \
  --name delta-neutral-bot \
  --env-file .env \
  -v $(pwd)/data:/app/data \
  -p 3001:3001 \
  delta-neutral-bot

# View logs
docker logs -f delta-neutral-bot

# Stop the container
docker stop delta-neutral-bot
docker rm delta-neutral-bot
```

## Container Architecture

### Dockerfile Highlights

- **Base Image**: `oven/bun:1.3.1-alpine` (lightweight Bun runtime)
- **No Build Step**: Runs TypeScript directly with Bun (faster startup)
- **Non-Root User**: Runs as user `nodejs` (UID 1001) for security
- **Signal Handling**: Uses `dumb-init` for proper signal forwarding
- **Port**: Exposes 3001 for API server (optional)
- **Default Command**: `bun run src/cli/auto-tune.ts`

### Volume Mounts

The bot persists state to `/app/data` inside the container:

```
./data (host) ↔ /app/data (container)
```

**Persisted files:**
- `data/state.json`: Position state, exposure, NFT mints
- `data/auto-tune-state.json`: Auto-tune iteration count, rebalance history
- `data/actions.json`: Action journal (execution history)

### Environment Variables

All configuration is loaded from `.env` file via Docker Compose or `--env-file` flag.

## Common Operations

### View Real-Time Logs

```bash
# Follow logs
docker compose logs -f

# Last 100 lines
docker compose logs --tail=100

# Filter by service
docker compose logs -f delta-neutral-bot
```

### Check Container Status

```bash
# List running containers
docker ps

# Check resource usage
docker stats delta-neutral-bot

# Inspect container details
docker inspect delta-neutral-bot
```

### Access Container Shell

```bash
# Open shell in running container
docker compose exec delta-neutral-bot sh

# View files
docker compose exec delta-neutral-bot ls -la /app/data

# Check environment
docker compose exec delta-neutral-bot env
```

### Restart Container

```bash
# Restart with new .env changes
docker compose restart

# Force rebuild and restart
docker compose up -d --build
```

### View Persisted State

```bash
# View state files on host
cat data/state.json | jq .
cat data/auto-tune-state.json | jq .

# View from inside container
docker compose exec delta-neutral-bot cat /app/data/state.json
```

## Running Different Commands

### Auto-Tune Mode (Default)

```yaml
# In docker-compose.yml (already configured)
CMD ["bun", "run", "src/cli/auto-tune.ts"]
```

### API Server Mode

```yaml
# Modify docker-compose.yml:
command: ["bun", "run", "src/api/hono-server.ts"]
```

### Custom Command Override

```bash
# Run with custom command
docker compose run --rm delta-neutral-bot bun run src/test/mainnet-meteora-test.ts

# Or with docker directly
docker run --rm \
  --env-file .env \
  -v $(pwd)/data:/app/data \
  delta-neutral-bot \
  bun run src/api/hono-server.ts
```

## Verified Deployment Example

Here's what a successful deployment looks like:

```bash
$ docker compose up -d --build
# [+] Building 12.8s (11/14)
# ✅ Image built successfully
# ✅ Container delta-neutral-bot created
# ✅ Container delta-neutral-bot started

$ docker ps
# CONTAINER ID   IMAGE                                 STATUS
# 8be95334dac6   delta_neutral_bot-delta-neutral-bot   Up 8 seconds (health: starting)

$ docker compose logs --tail=20
# ✅ Auto-tune loop started successfully
# ✅ Position balanced - no action needed (35% SOL, 65% USDC)
# ✅ Auto-tune check cycle completed
```

## Production Deployment

### 1. Resource Limits (Optional)

The `docker-compose.yml` can include resource limits (commented out by default):

```yaml
deploy:
  resources:
    limits:
      cpus: '1.0'      # Max 1 CPU core
      memory: 512M     # Max 512MB RAM
    reservations:
      cpus: '0.5'      # Min 0.5 CPU core
      memory: 256M     # Min 256MB RAM
```

Adjust based on your needs and server capacity.

### 2. Health Checks (Optional)

Health check monitors API server endpoint (commented out by default):

```yaml
healthcheck:
  test: ["CMD", "wget", "--quiet", "--tries=1", "--spider", "http://localhost:3001/api/health"]
  interval: 30s
  timeout: 10s
  retries: 3
```

**Note**:
- Health check requires API server to be running
- For auto-tune only mode (default), the health check may fail but container will continue running
- To disable health checks, remove or comment out the `healthcheck` section in `docker-compose.yml`

### 3. Restart Policy

```yaml
restart: unless-stopped
```

Container automatically restarts on failure unless manually stopped.

### 4. Logging Configuration (Optional)

You can add logging limits to prevent disk space exhaustion:

```yaml
logging:
  driver: "json-file"
  options:
    max-size: "10m"   # Max 10MB per log file
    max-file: "3"      # Keep 3 log files (max 30MB total)
```

By default, Docker uses unlimited logging. Add this configuration if you're running in production.

### 5. Security Best Practices

- ✅ Non-root user (UID 1001)
- ✅ Read-only environment variables (never logged)
- ✅ Volume mount for state (data persistence)
- ✅ Alpine base image (minimal attack surface)
- ⚠️ **Never commit `.env` to version control**
- ⚠️ **Use secrets management for production** (Docker Swarm secrets, Kubernetes secrets, AWS Secrets Manager, etc.)

## Troubleshooting

### Frozen Lockfile Error

If you see `error: lockfile had changes, but lockfile is frozen`:

```bash
# Update the lockfile
bun install

# Rebuild the image
docker compose up -d --build
```

**Why this happens**: The Dockerfile was initially configured with `--frozen-lockfile` flag, which has been removed. If you still see this error, make sure your [Dockerfile](../Dockerfile:20) has `RUN bun install --production` (without `--frozen-lockfile`).

### Container Won't Start

```bash
# Check logs for errors
docker compose logs

# Check if .env file exists
ls -la .env

# Validate docker-compose.yml syntax
docker compose config
```

### "Version is Obsolete" Warning

The warning `the attribute 'version' is obsolete` is harmless. The `version` field has been removed from `docker-compose.yml` in the latest configuration.

```bash
# Verify your docker-compose.yml starts with:
head -n 5 docker-compose.yml
# Should show:
# services:
#   delta-neutral-bot:
```

### Out of Memory Errors

```bash
# Increase memory limit in docker-compose.yml
deploy:
  resources:
    limits:
      memory: 1G
```

### Permission Errors with Data Volume

```bash
# Fix ownership (if needed)
sudo chown -R 1001:1001 ./data

# Or run as current user (modify Dockerfile)
```

### Can't Access API Server

```bash
# Check if port is exposed
docker ps

# Test from inside container
docker compose exec delta-neutral-bot wget -O- http://localhost:3001/api/health

# Check firewall rules (if remote)
```

### State Files Not Persisting

```bash
# Verify volume mount
docker inspect delta-neutral-bot | grep -A 10 Mounts

# Check file permissions
docker compose exec delta-neutral-bot ls -la /app/data
```

## Multi-Container Setup (Advanced)

If you want to run both auto-tune and API server simultaneously:

```yaml
# Note: 'version' field is obsolete in modern Docker Compose
services:
  auto-tune:
    build: .
    container_name: delta-neutral-bot-autotune
    restart: unless-stopped
    env_file: .env
    volumes:
      - ./data:/app/data
    command: ["bun", "run", "src/cli/auto-tune.ts"]

  api-server:
    build: .
    container_name: delta-neutral-bot-api
    restart: unless-stopped
    env_file: .env
    volumes:
      - ./data:/app/data:ro  # Read-only for API
    ports:
      - "3001:3001"
    command: ["bun", "run", "src/api/hono-server.ts"]
    healthcheck:
      test: ["CMD", "wget", "--quiet", "--tries=1", "--spider", "http://localhost:3001/api/health"]
      interval: 30s
```

## Monitoring and Maintenance

### View Resource Usage

```bash
# Real-time stats
docker stats delta-neutral-bot

# Historical data (if using monitoring tools)
docker events --filter 'container=delta-neutral-bot'
```

### Backup State Files

```bash
# Backup data directory
tar -czf backup-$(date +%Y%m%d-%H%M%S).tar.gz ./data/

# Restore from backup
tar -xzf backup-20250113-120000.tar.gz
```

### Update Bot

```bash
# Pull latest code
git pull

# Rebuild and restart
docker compose up -d --build

# View updated logs
docker compose logs -f
```

## Environment-Specific Configurations

### Development

```bash
# Use local RPC (if running solana-test-validator)
RPC_URL=http://host.docker.internal:8899

# Mount source code for hot-reload (not recommended for Bun)
volumes:
  - ./src:/app/src:ro
```

### Production

```bash
# Use production RPC with high rate limits
RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_API_KEY

# Use Docker secrets for sensitive data
secrets:
  - source: private_key
    target: /run/secrets/private_key
```

## Actual Configuration Files

### Current docker-compose.yml

```yaml
services:
  delta-neutral-bot:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: delta-neutral-bot
    restart: unless-stopped

    env_file:
      - .env

    volumes:
      - ./data:/app/data

    healthcheck:
      test: ["CMD", "wget", "--quiet", "--tries=1", "--spider", "http://localhost:3001/api/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 10s

    ports:
      - "3001:3001"

    deploy:
      resources:
        limits:
          cpus: '1.0'
          memory: 512M
        reservations:
          cpus: '0.5'
          memory: 256M

    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"
```

### Key Dockerfile Instructions

```dockerfile
FROM oven/bun:1.3.1-alpine

# Install dumb-init for signal handling
RUN apk add --no-cache dumb-init

# Create non-root user
RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001

# Install dependencies (no --frozen-lockfile)
RUN bun install --production

# Default command
CMD ["bun", "run", "src/cli/auto-tune.ts"]
```

## Additional Resources

- [Dockerfile Reference](https://docs.docker.com/engine/reference/builder/)
- [Docker Compose Documentation](https://docs.docker.com/compose/)
- [Bun Docker Guide](https://bun.sh/docs/install/docker)
- [Project Documentation](../CLAUDE.md)

## Support

For issues related to:
- Docker configuration: Check Docker logs and troubleshooting section
- Bot functionality: See [CLAUDE.md](./CLAUDE.md) and project documentation
- Auto-tune mode: Review auto-tune configuration in `.env`
