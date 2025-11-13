# Deployment Options for Delta-Neutral Bot

This guide compares different options for deploying the bot to remote infrastructure, prioritized by **simplicity** and **cost**.

## Quick Comparison Table

| Option | Monthly Cost | Setup Time | Simplicity | Best For |
|--------|-------------|------------|------------|----------|
| **DigitalOcean Droplet** | $4-6 | 10 min | ⭐⭐⭐⭐⭐ | Beginners, budget-conscious |
| **Hetzner Cloud** | €4.15 (~$4.50) | 10 min | ⭐⭐⭐⭐⭐ | EU-based, best price/performance |
| **AWS Lightsail** | $3.50-5 | 15 min | ⭐⭐⭐⭐ | AWS ecosystem integration |
| **Oracle Cloud Free Tier** | **FREE** | 20 min | ⭐⭐⭐ | Always free (limited resources) |
| **Fly.io** | $0-3 | 5 min | ⭐⭐⭐⭐⭐ | Easiest Docker deployment |
| **Railway** | $5 | 5 min | ⭐⭐⭐⭐⭐ | Developer-friendly, auto-deploy |
| **Render** | $7 | 5 min | ⭐⭐⭐⭐ | Simple, good for beginners |
| **AWS ECS Fargate** | $15-20 | 30 min | ⭐⭐ | Enterprise, scaling needs |
| **Home Server/Raspberry Pi** | $0 (+ electricity) | Variable | ⭐⭐⭐ | Own hardware, learning |

---

## 🏆 Top 3 Recommendations

### 1. **Hetzner Cloud** (BEST VALUE)

**Cost:** €4.15/month (~$4.50)
**Setup:** 10 minutes
**Simplicity:** ⭐⭐⭐⭐⭐

**Why it's the best:**
- Cheapest VPS with excellent specs (2 vCPU, 4GB RAM, 40GB SSD)
- Europe-based (excellent latency to Solana validators)
- Simple web interface + Docker pre-installed
- No bandwidth limits
- Best price/performance ratio

**Specs (CX11 instance):**
- 1 vCPU, 2GB RAM, 20GB SSD: €3.79/month
- **Recommended: CPX11** - 2 vCPU, 2GB RAM, 40GB SSD: €4.15/month

**Setup Steps:**
```bash
# 1. Create Hetzner account: https://www.hetzner.com/cloud
# 2. Create new server (CPX11, Ubuntu 22.04)
# 3. SSH into server
ssh root@your-server-ip

# 4. Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sh get-docker.sh

# 5. Clone your repo and deploy (see "Generic VPS Deployment" below)
```

**Pros:**
- ✅ Unbeatable price/performance
- ✅ EU-based (GDPR-compliant, low latency)
- ✅ Simple billing, no hidden costs
- ✅ Excellent uptime (99.9% SLA)

**Cons:**
- ❌ No free tier
- ❌ Limited to EU data centers (Germany, Finland)

---

### 2. **DigitalOcean Droplet** (MOST BEGINNER-FRIENDLY)

**Cost:** $4-6/month
**Setup:** 10 minutes
**Simplicity:** ⭐⭐⭐⭐⭐

**Why it's great:**
- Most beginner-friendly VPS provider
- Excellent documentation and tutorials
- Docker pre-installed with one-click apps
- Multiple data centers worldwide
- $200 free credit for new users (60 days)

**Specs (Basic Droplet):**
- $4/month: 512MB RAM, 1 vCPU, 10GB SSD (minimum)
- **Recommended: $6/month** - 1GB RAM, 1 vCPU, 25GB SSD, 1TB transfer

**Setup Steps:**
```bash
# 1. Create DigitalOcean account: https://www.digitalocean.com
#    Use referral link for $200 credit: https://m.do.co/c/[referral]
# 2. Create Droplet (Docker on Ubuntu 22.04 from Marketplace)
# 3. SSH into Droplet
ssh root@your-droplet-ip

# 4. Deploy (Docker already installed)
# See "Generic VPS Deployment" section below
```

**Pros:**
- ✅ Best documentation and tutorials
- ✅ $200 free credit for new users
- ✅ Docker pre-installed option
- ✅ Managed databases available
- ✅ Multiple regions (NYC, SF, Amsterdam, Singapore, etc.)

**Cons:**
- ❌ Slightly more expensive than Hetzner
- ❌ Bandwidth limits (1TB/month)

---

### 3. **Fly.io** (EASIEST DEPLOYMENT)

**Cost:** ~$0-3/month (free tier available)
**Setup:** 5 minutes
**Simplicity:** ⭐⭐⭐⭐⭐

**Why it's great:**
- Literally `fly launch` and you're done
- Docker-native platform
- Free tier: 3 shared-cpu-1x VMs with 256MB RAM
- Auto-scaling and zero-downtime deployments
- Global edge network

**Free Tier:**
- 3 shared-cpu-1x 256MB VMs (always free)
- 3GB persistent volume storage
- 160GB outbound data transfer

**Paid (if exceeded):**
- $1.94/month per additional shared-cpu-1x VM
- $0.15/GB storage

**Setup Steps:**
```bash
# 1. Install flyctl
curl -L https://fly.io/install.sh | sh

# 2. Login
flyctl auth login

# 3. Create fly.toml in project root
flyctl launch

# 4. Deploy
flyctl deploy

# 5. View logs
flyctl logs
```

**Pros:**
- ✅ Easiest deployment (literally 3 commands)
- ✅ Free tier available
- ✅ Auto-scaling built-in
- ✅ Zero-downtime deployments
- ✅ Global edge network

**Cons:**
- ❌ Free tier RAM (256MB) may be tight for Solana bot
- ❌ Persistent storage costs extra
- ❌ Can get expensive if you exceed free tier

---

## Other Notable Options

### 4. **Oracle Cloud Free Tier** (ALWAYS FREE)

**Cost:** $0 (forever free)
**Setup:** 20 minutes
**Simplicity:** ⭐⭐⭐

**Always Free Resources:**
- 2 AMD-based VMs (1/8 OCPU, 1GB RAM each)
- OR 4 Arm-based VMs (up to 4 cores, 24GB RAM total)
- 200GB block storage
- 10TB outbound data transfer/month

**Why it's interesting:**
- Completely free, no credit card required after trial
- ARM instances have generous specs (4 cores, 24GB RAM)
- No time limits (always free)

**Setup Steps:**
```bash
# 1. Create Oracle Cloud account: https://www.oracle.com/cloud/free/
# 2. Create compute instance (Ubuntu 22.04, ARM Ampere A1)
# 3. Configure security rules (allow port 22, 3001)
# 4. SSH and deploy
```

**Pros:**
- ✅ **COMPLETELY FREE**
- ✅ Very generous ARM specs
- ✅ No time limits
- ✅ Good for learning/testing

**Cons:**
- ❌ Complex UI (Oracle Cloud is enterprise-focused)
- ❌ ARM architecture (may need to rebuild Docker images)
- ❌ Accounts sometimes get suspended (fraud protection)
- ❌ Slower provisioning

---

### 5. **Railway** (DEVELOPER-FRIENDLY)

**Cost:** $5/month (includes $5 credit)
**Setup:** 5 minutes
**Simplicity:** ⭐⭐⭐⭐⭐

**Why developers love it:**
- GitHub integration (auto-deploy on push)
- Simple pricing: $5/month for $5 usage credit
- Docker support out of the box
- Beautiful UI and developer experience
- Built-in logging and metrics

**Pricing:**
- $5/month subscription (includes $5 usage credit)
- Additional usage: ~$0.001/hour per 0.5 vCPU + 0.5GB RAM

**Setup Steps:**
```bash
# 1. Sign up: https://railway.app
# 2. Connect GitHub repo
# 3. Railway auto-detects Dockerfile
# 4. Deploy with one click
# 5. Add environment variables in dashboard
```

**Pros:**
- ✅ Amazing developer experience
- ✅ Auto-deploy on git push
- ✅ Built-in monitoring and logs
- ✅ Easy environment variable management
- ✅ No server management needed

**Cons:**
- ❌ More expensive than VPS for 24/7 workloads
- ❌ $5/month minimum
- ❌ Usage-based pricing can be unpredictable

---

### 6. **AWS Lightsail** (AWS SIMPLICITY)

**Cost:** $3.50-5/month
**Setup:** 15 minutes
**Simplicity:** ⭐⭐⭐⭐

**Why choose Lightsail:**
- Simplest way to use AWS
- Fixed monthly pricing (no surprises)
- Includes 1TB bandwidth
- Integration with other AWS services

**Pricing:**
- $3.50/month: 512MB RAM, 1 vCPU, 20GB SSD
- **Recommended: $5/month** - 1GB RAM, 1 vCPU, 40GB SSD, 2TB transfer

**Setup Steps:**
```bash
# 1. AWS Console → Lightsail
# 2. Create instance (Ubuntu 22.04)
# 3. Enable Docker blueprint (optional)
# 4. SSH via browser or terminal
# 5. Deploy
```

**Pros:**
- ✅ AWS ecosystem integration
- ✅ Fixed pricing (no surprises)
- ✅ Good global coverage
- ✅ Free tier: 3 months free on $5 instance

**Cons:**
- ❌ AWS account complexity
- ❌ Not as cheap as Hetzner/DO
- ❌ Data transfer limits

---

## Generic VPS Deployment Guide

Once you have a VPS (DigitalOcean, Hetzner, Lightsail, etc.), follow these steps:

### 1. Initial Server Setup

```bash
# SSH into your server
ssh root@your-server-ip

# Update system
apt update && apt upgrade -y

# Install Docker (if not pre-installed)
curl -fsSL https://get.docker.com -o get-docker.sh
sh get-docker.sh

# Install Docker Compose
apt install docker-compose-plugin -y

# Verify installation
docker --version
docker compose version
```

### 2. Deploy Your Bot

```bash
# Clone your repository
git clone https://github.com/yourusername/delta_neutral_bot.git
cd delta_neutral_bot

# Create .env file (IMPORTANT!)
nano .env
# Paste your configuration and save (Ctrl+X, Y, Enter)

# Update dependencies
docker run --rm -v $(pwd):/app -w /app oven/bun:1.3.1-alpine bun install

# Or if you have bun locally:
bun install
# Then copy bun.lock to server

# Build and start
docker compose up -d

# View logs
docker compose logs -f
```

### 3. Monitor and Manage

```bash
# Check status
docker ps

# View logs
docker compose logs -f

# Restart
docker compose restart

# Stop
docker compose down

# Update code
git pull
docker compose up -d --build
```

### 4. Auto-Restart on Server Reboot

```bash
# Docker Compose already has `restart: unless-stopped`
# This ensures your bot restarts automatically on server reboot

# Verify
docker inspect delta-neutral-bot | grep -A 5 RestartPolicy
```

### 5. Set Up Monitoring (Optional but Recommended)

```bash
# Install monitoring tools
apt install htop

# Monitor resources
htop

# Check disk usage
df -h

# Check logs size
du -sh /var/lib/docker/containers/
```

---

## Security Best Practices for VPS

### 1. Secure SSH Access

```bash
# Disable root login
nano /etc/ssh/sshd_config
# Set: PermitRootLogin no

# Create sudo user
adduser botuser
usermod -aG sudo botuser

# Use SSH keys instead of passwords
ssh-copy-id botuser@your-server-ip

# Restart SSH
systemctl restart sshd
```

### 2. Enable Firewall

```bash
# Install UFW
apt install ufw

# Allow SSH
ufw allow 22/tcp

# Allow API (if exposing externally)
ufw allow 3001/tcp

# Enable firewall
ufw enable

# Check status
ufw status
```

### 3. Automatic Security Updates

```bash
# Install unattended-upgrades
apt install unattended-upgrades
dpkg-reconfigure --priority=low unattended-upgrades
```

### 4. Monitor Failed Login Attempts

```bash
# Install fail2ban
apt install fail2ban

# Enable and start
systemctl enable fail2ban
systemctl start fail2ban
```

---

## Cost Comparison (24/7 Operation)

| Provider | Monthly Cost | Specs | Annual Cost | Notes |
|----------|-------------|-------|-------------|-------|
| **Hetzner CPX11** | €4.15 | 2 vCPU, 2GB RAM | €49.80 (~$54) | Best value |
| **DigitalOcean** | $6 | 1 vCPU, 1GB RAM | $72 | + $200 free credit |
| **Oracle Free** | $0 | 4 vCPU, 24GB RAM (ARM) | $0 | Always free |
| **AWS Lightsail** | $5 | 1 vCPU, 1GB RAM | $60 | 3 months free |
| **Fly.io** | ~$3 | Shared CPU, 256MB | $36 | May need upgrade |
| **Railway** | ~$10-15 | Variable | $120-180 | Usage-based |
| **Render** | $7 | 0.5 vCPU, 512MB | $84 | Simple pricing |

---

## My Recommendation: Start Here

### For Absolute Beginners:
**DigitalOcean Droplet ($6/month)**
- Most beginner-friendly
- Excellent documentation
- $200 free credit to start

### For Best Value:
**Hetzner Cloud CPX11 (€4.15/month)**
- Best price/performance
- Professional infrastructure
- Simple billing

### For Free Option:
**Oracle Cloud Free Tier**
- Completely free forever
- Generous ARM specs
- Good for learning

### For Easiest Deployment:
**Fly.io (Free tier or ~$3/month)**
- Literally 3 commands to deploy
- No server management
- Great for Docker apps

---

## Next Steps

1. **Choose your provider** based on priorities (cost, simplicity, features)
2. **Follow the setup guide** for your chosen provider
3. **Deploy using Docker Compose** (already configured!)
4. **Monitor logs** to ensure bot is running correctly
5. **Set up alerts** (optional: email/Discord notifications)

## Additional Resources

- [Docker Security Best Practices](https://docs.docker.com/engine/security/)
- [Linux Server Hardening Guide](https://www.digitalocean.com/community/tutorials/how-to-harden-openssh-on-ubuntu-20-04)
- [Monitoring with Prometheus + Grafana](https://grafana.com/docs/grafana/latest/getting-started/)

---

## Support

Need help choosing or setting up? Consider:
- Budget: Under $5/month → **Hetzner** or **Oracle Free**
- Simplicity: First deployment → **DigitalOcean** or **Fly.io**
- Learning: Want to learn DevOps → **VPS (any)**
- Production: High uptime needs → **AWS/GCP** with monitoring
