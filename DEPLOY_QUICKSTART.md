# 🚀 Deploy Your Bot - Quickstart

Choose your deployment method and follow the steps below.

## 🎯 Which Option Should I Choose?

### Already have GCP? → **Use Pulumi** (FREE!)
Your bot already has Pulumi infrastructure configured. One command deployment!

### Want cheapest VPS? → **Use Hetzner** (€4.15/month)
Best price/performance ratio. EU-based with great specs.

### First time deploying? → **Use DigitalOcean** ($6/month + $200 credit)
Most beginner-friendly with excellent documentation.

---

## Option 1: GCP with Pulumi (⭐ RECOMMENDED)

**Cost:** FREE (12 months) + always-free e2-micro
**Time:** 15 minutes
**Your setup is already configured!**

### Prerequisites
```bash
# Install Pulumi
curl -fsSL https://get.pulumi.com | sh

# Install gcloud
# See: https://cloud.google.com/sdk/docs/install

# Authenticate
gcloud auth login
gcloud auth application-default login
gcloud auth configure-docker
```

### Deploy
```bash
# 1. Install Pulumi dependencies
pnpm deploy:gcp:setup

# 2. Update bun.lock in project root
bun install

# 3. Configure Pulumi
cd deploy/gcp/pulumi
pulumi stack init prod
pulumi config set gcp:project YOUR_PROJECT_ID
pulumi config set gcp:region us-central1
pulumi config set gcp:zone us-central1-a
pulumi config set envFile ../../../.env
cd ../../..

# 4. Preview changes (optional)
pnpm deploy:gcp:preview

# 5. Deploy!
pnpm deploy:gcp:up
```

### Monitor
```bash
# View logs
pnpm deploy:gcp:logs

# SSH into VM
pnpm deploy:gcp:ssh

# Check status
pnpm deploy:gcp:status
```

📖 **Full Guide:** [docs/GCP_PULUMI_DEPLOYMENT.md](docs/GCP_PULUMI_DEPLOYMENT.md)

---

## Option 2: Hetzner Cloud VPS

**Cost:** €4.15/month (~$4.50)
**Time:** 10 minutes
**Best value for money!**

### Steps

1. **Create Hetzner account**: https://www.hetzner.com/cloud

2. **Create server**:
   - Click "Add Server"
   - Location: Nuremberg (or any EU)
   - Image: Ubuntu 22.04
   - Type: **CPX11** (2 vCPU, 2GB RAM, 40GB SSD - €4.15/month)
   - SSH Key: Add your public key
   - Name: delta-neutral-bot
   - Click "Create & Buy"

3. **SSH into server**:
```bash
ssh root@YOUR_SERVER_IP
```

4. **Install Docker**:
```bash
curl -fsSL https://get.docker.com -o get-docker.sh
sh get-docker.sh
```

5. **Deploy bot**:
```bash
# Clone your repo
git clone https://github.com/yourusername/delta_neutral_bot.git
cd delta_neutral_bot

# Create .env file
nano .env
# Paste your RPC_URL, PRIVATE_KEY, etc.
# Save: Ctrl+X, Y, Enter

# Start bot
docker compose up -d

# View logs
docker compose logs -f
```

📖 **Full Guide:** [docs/DEPLOYMENT_OPTIONS.md](docs/DEPLOYMENT_OPTIONS.md)

---

## Option 3: DigitalOcean Droplet

**Cost:** $6/month (+ $200 free credit)
**Time:** 10 minutes
**Most beginner-friendly!**

### Steps

1. **Create DigitalOcean account**: https://www.digitalocean.com
   - Use referral link for $200 credit (60 days)

2. **Create Droplet**:
   - Click "Create" → "Droplets"
   - Image: **Marketplace** → "Docker on Ubuntu 22.04"
   - Plan: **Basic** → $6/month (1GB RAM, 1 vCPU, 25GB SSD)
   - Region: New York (or closest to you)
   - SSH Key: Add your public key
   - Name: delta-neutral-bot
   - Click "Create Droplet"

3. **SSH into Droplet**:
```bash
ssh root@YOUR_DROPLET_IP
```

4. **Deploy bot** (Docker already installed!):
```bash
# Clone your repo
git clone https://github.com/yourusername/delta_neutral_bot.git
cd delta_neutral_bot

# Create .env file
nano .env
# Paste your RPC_URL, PRIVATE_KEY, etc.
# Save: Ctrl+X, Y, Enter

# Start bot
docker compose up -d

# View logs
docker compose logs -f
```

📖 **Full Guide:** [docs/DEPLOYMENT_OPTIONS.md](docs/DEPLOYMENT_OPTIONS.md)

---

## Option 4: Fly.io (Easiest Deploy)

**Cost:** $0-3/month
**Time:** 5 minutes
**Simplest deployment!**

### Prerequisites
```bash
# Install flyctl
curl -L https://fly.io/install.sh | sh

# Login
flyctl auth login
```

### Deploy
```bash
# In project root
flyctl launch

# Follow prompts:
# - App name: delta-neutral-bot
# - Region: Choose closest
# - Postgres: No
# - Redis: No

# Deploy
flyctl deploy

# View logs
flyctl logs
```

⚠️ **Note:** Free tier has 256MB RAM which may be tight for Solana bot.

📖 **Full Guide:** [docs/DEPLOYMENT_OPTIONS.md](docs/DEPLOYMENT_OPTIONS.md)

---

## 📊 Quick Comparison

| Option | Cost | Time | Difficulty | Best For |
|--------|------|------|------------|----------|
| **GCP Pulumi** | FREE | 15 min | Medium | Already configured! |
| **Hetzner** | €4.15 | 10 min | Easy | Best value |
| **DigitalOcean** | $6 | 10 min | Easy | Beginners |
| **Fly.io** | $0-3 | 5 min | Very Easy | Quick test |

---

## ✅ Verification Checklist

After deployment, verify your bot is running:

```bash
# Check container status (local Docker)
docker ps
pnpm docker:logs

# Or for GCP deployment
pnpm deploy:gcp:logs
pnpm deploy:gcp:status

# Check state file (local)
cat data/auto-tune-state.json

# Check state file (GCP)
pnpm deploy:gcp:ssh
# Then inside VM: cat /var/lib/autotune/data/auto-tune-state.json
```

**Expected logs:**
- ✅ "Auto-tune loop started successfully"
- ✅ "Position balanced - no action needed (XX% SOL, XX% USDC)"
- ✅ "Auto-tune check cycle completed"

---

## 🆘 Troubleshooting

### Container won't start
```bash
# Check logs
docker logs delta-neutral-bot

# Common issues:
# - Missing .env file
# - Invalid RPC_URL or PRIVATE_KEY
# - Frozen lockfile error (run: bun install)
```

### Swap transaction fails (compute units)
✅ **Already fixed!** The Jupiter swapper now uses `dynamicComputeUnitLimit: true`.

If you still see errors, ensure your code is up to date:
```bash
git pull origin main
docker compose up -d --build
```

### Position not creating
Check wallet balance:
```bash
# Needs minimum:
# - 0.5 SOL (for AUTO_TUNE_DEPOSIT_AMOUNT)
# - 0.2 SOL (MINIMUM_WALLET_BALANCE_SOL)
# - 0.1 SOL (RENT_RESERVE_SOL)
# Total: ~0.8 SOL minimum
```

---

## 📚 Full Documentation

- **[Scripts Reference](docs/SCRIPTS_REFERENCE.md)** - All npm/pnpm commands explained ⭐
- **[Deployment Summary](docs/DEPLOYMENT_SUMMARY.md)** - Compare all options
- **[GCP Pulumi Guide](docs/GCP_PULUMI_DEPLOYMENT.md)** - Full GCP deployment
- **[Deployment Options](docs/DEPLOYMENT_OPTIONS.md)** - All VPS providers
- **[Docker Guide](docs/DOCKER_GUIDE.md)** - Local Docker setup
- **[Project Docs](CLAUDE.md)** - Bot configuration and architecture

---

## 🎯 Recommended Path

1. **Try GCP Pulumi first** (it's FREE and already configured!)
2. If GCP feels too complex → **Use Hetzner** (best value)
3. If budget isn't an issue → **Use DigitalOcean** (easiest)

Good luck! 🚀
