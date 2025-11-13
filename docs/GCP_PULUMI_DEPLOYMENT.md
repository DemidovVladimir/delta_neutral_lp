# GCP Deployment with Pulumi (UPDATED FOR DOCKER)

This guide walks you through deploying your Docker-based delta-neutral bot to Google Cloud Platform using Pulumi Infrastructure as Code.

> **✅ Already Configured**: Your project has a complete Pulumi setup in `deploy/gcp/pulumi/`. This guide shows you how to use it with your updated Docker configuration.

## Quick Summary

**What you have:**
- ✅ Pulumi IaC setup (`deploy/gcp/pulumi/index.ts`)
- ✅ GCP Compute Engine e2-micro (FREE TIER)
- ✅ Secret Manager for RPC_URL and PRIVATE_KEY
- ✅ Docker image pushed to GCR
- ✅ Auto-restart and health monitoring
- ✅ Budget alerts ($1/month threshold)

**Cost:** ~$0/month (within GCP Free Tier)

---

## Prerequisites

### 1. Install Required Tools

```bash
# Install Pulumi
curl -fsSL https://get.pulumi.com | sh

# Install gcloud CLI
# See: https://cloud.google.com/sdk/docs/install

# Authenticate with GCP
gcloud auth login
gcloud auth application-default login

# Configure Docker for GCR
gcloud auth configure-docker
```

### 2. Set Up GCP Project

```bash
# Create new project (or use existing)
gcloud projects create your-autotune-project --name="Delta Neutral Bot"

# Set project
gcloud config set project your-autotune-project

# Enable billing (required even for free tier)
# Go to: https://console.cloud.google.com/billing
```

### 3. Prepare Environment

```bash
# Navigate to Pulumi directory
cd deploy/gcp/pulumi

# Install dependencies
npm install

# Update bun.lock in root (for Docker build)
cd ../../..
bun install
```

---

## Configuration

### 1. Initialize Pulumi Stack

```bash
cd deploy/gcp/pulumi

# Create new stack (e.g., "prod")
pulumi stack init prod

# Or select existing stack
pulumi stack select prod
```

### 2. Configure Pulumi Settings

```bash
# Required: GCP project ID
pulumi config set gcp:project your-autotune-project

# Required: GCP region (use free tier region)
pulumi config set gcp:region us-central1
pulumi config set gcp:zone us-central1-a

# Required: Path to .env file (with RPC_URL and PRIVATE_KEY)
pulumi config set envFile ../../../.env

# Optional: Machine type (default: e2-micro - FREE TIER)
pulumi config set machineType e2-micro

# Optional: Disk size in GB (default: 30 - FREE TIER)
pulumi config set diskSize 30

# Optional: Budget alerts
pulumi config set autotune:budgetAmount 1.0
pulumi config set autotune:budgetAlertEmails your-email@example.com
pulumi config set autotune:billingAccountId 01XXXX-XXXXXX-XXXXXX
```

### 3. Verify Configuration

```bash
# View all config
pulumi config

# Should show:
# gcp:project                  your-autotune-project
# gcp:region                   us-central1
# gcp:zone                     us-central1-a
# envFile                      ../../../.env
# machineType                  e2-micro
# diskSize                     30
```

---

## Deployment

### 1. Preview Changes

```bash
# Dry run - see what will be created
pulumi preview
```

**Expected output:**
```
Previewing update (prod)

     Type                                    Name
 +   pulumi:pulumi:Stack                     autotune-gcp-prod
 +   ├─ gcp:projects:Service                 compute-api
 +   ├─ gcp:projects:Service                 secret-manager-api
 +   ├─ gcp:projects:Service                 logging-api
 +   ├─ gcp:secretmanager:Secret             autotune-rpc-url
 +   ├─ gcp:secretmanager:Secret             autotune-private-key
 +   ├─ gcp:serviceaccount:Account           autotune-sa
 +   ├─ docker:Image                         autotune-image
 +   └─ gcp:compute:Instance                 autotune-vm

Resources:
    + 15 to create
```

### 2. Deploy to GCP

```bash
# Deploy infrastructure
pulumi up --yes

# This will:
# 1. Enable GCP APIs
# 2. Create service account
# 3. Create secrets in Secret Manager
# 4. Build and push Docker image to GCR
# 5. Create e2-micro VM instance
# 6. Run startup script to deploy container
```

**Expected duration:** 3-5 minutes

### 3. Monitor Deployment

```bash
# Get stack outputs
pulumi stack output

# Should show:
# instanceName:          autotune-prod
# instanceZone:          us-central1-a
# dockerImage:           gcr.io/your-project/autotune-prod:v1234567890
# sshCommand:            gcloud compute ssh autotune-prod --zone=us-central1-a
# logsCommand:           gcloud compute ssh autotune-prod --zone=us-central1-a --command='docker logs -f autotune'
```

---

## Verification

### 1. Check VM Instance

```bash
# SSH into instance
pulumi stack output sshCommand | bash

# Inside VM: Check Docker container
docker ps

# Should show:
# CONTAINER ID   IMAGE                                              STATUS
# abc123         gcr.io/your-project/autotune-prod:v1234567890     Up 2 minutes
```

### 2. View Container Logs

```bash
# From your local machine
pulumi stack output logsCommand | bash

# Or inside VM
docker logs -f autotune
```

**Expected logs:**
```
21:06:48 [info] 🚀 Starting Auto-Tune CLI
21:06:48 [info] Auto-tune configuration {"enabled":true,"binCount":20}
21:06:48 [info] State loaded {"file":"data/state.json"}
21:06:48 [info] ✅ Auto-tune loop started successfully
21:06:48 [info] Position balanced - no action needed
```

### 3. Check State Persistence

```bash
# SSH and check data directory
gcloud compute ssh autotune-prod --zone=us-central1-a

# Inside VM
ls -la /var/lib/autotune/data/

# Should show:
# state.json
# auto-tune-state.json
# actions.json
```

---

## Management

### View Logs

```bash
# Container logs (real-time)
pulumi stack output logsCommand | bash

# Startup script logs
pulumi stack output startupLogsCommand | bash

# GCP Cloud Logging
gcloud logging read "resource.type=gce_instance" --limit 50
```

### Stop Instance (Save Costs)

```bash
# Stop instance (free tier still applies)
pulumi stack output stopCommand | bash

# Or directly
gcloud compute instances stop autotune-prod --zone=us-central1-a
```

### Start Instance

```bash
# Start instance
pulumi stack output startCommand | bash

# Or directly
gcloud compute instances start autotune-prod --zone=us-central1-a
```

### Restart Container

```bash
# SSH into instance
pulumi stack output sshCommand | bash

# Restart container
docker restart autotune

# Or rebuild from latest image
docker pull gcr.io/your-project/autotune-prod:latest
docker stop autotune && docker rm autotune
sudo systemctl restart google-startup-scripts.service
```

### Update Code

```bash
# 1. Commit changes to git
git add .
git commit -m "Update bot"

# 2. Rebuild and redeploy
cd deploy/gcp/pulumi
pulumi up --yes

# This rebuilds Docker image and restarts VM
```

---

## Troubleshooting

### Build Fails: Frozen Lockfile Error

```bash
# Update bun.lock
cd ../../..  # Back to project root
bun install

# Try deploy again
cd deploy/gcp/pulumi
pulumi up --yes
```

### Container Won't Start

```bash
# Check startup logs
pulumi stack output startupLogsCommand | bash

# SSH and check Docker
gcloud compute ssh autotune-prod --zone=us-central1-a
docker logs autotune
docker inspect autotune
```

### Secrets Not Loading

```bash
# Verify secrets exist
gcloud secrets list --filter="name:autotune-*"

# Check service account has access
gcloud secrets get-iam-policy autotune-rpc-url

# Grant access manually if needed
gcloud secrets add-iam-policy-binding autotune-rpc-url \
  --member='serviceAccount:autotune-prod-sa@PROJECT.iam.gserviceaccount.com' \
  --role='roles/secretmanager.secretAccessor'
```

### Out of Memory (1GB on e2-micro)

```bash
# Check memory usage
gcloud compute ssh autotune-prod --zone=us-central1-a --command='free -h'

# If needed, upgrade to e2-small (NOT FREE, ~$12/month)
pulumi config set machineType e2-small
pulumi up --yes
```

### Docker Image Not Found

```bash
# Verify image exists in GCR
gcloud container images list --repository=gcr.io/YOUR_PROJECT

# Re-authenticate Docker
gcloud auth configure-docker

# Manually push image
cd ../../..  # Back to project root
docker build -t gcr.io/YOUR_PROJECT/autotune-prod:latest .
docker push gcr.io/YOUR_PROJECT/autotune-prod:latest
```

---

## Cost Monitoring

### GCP Free Tier Limits

| Resource | Free Tier | Your Usage | Status |
|----------|-----------|------------|--------|
| **e2-micro** | 1 instance/month | 1 instance | ✅ Free |
| **Disk** | 30 GB standard | 30 GB | ✅ Free |
| **Egress** | 1 GB/month | ~100 MB | ✅ Free |
| **Cloud Logging** | 50 GB/month | ~1 GB | ✅ Free |
| **Secret Manager** | 6 active versions | 2 secrets | ✅ Free |

**Expected cost:** $0/month (within free tier)

### Budget Alerts

If configured, you'll receive email alerts at:
- 50% of budget ($0.50)
- 90% of budget ($0.90)
- 100% of budget ($1.00)

Check current spending:
```bash
# View billing
gcloud billing accounts describe YOUR_BILLING_ACCOUNT_ID

# View budget
gcloud billing budgets list --billing-account=YOUR_BILLING_ACCOUNT_ID
```

---

## Cleanup (Delete Everything)

```bash
# Destroy all infrastructure
pulumi destroy --yes

# This will:
# - Stop and delete VM instance
# - Delete Docker image from GCR
# - Delete secrets from Secret Manager
# - Delete service account
# - Disable GCP APIs
```

**Warning:** This deletes your auto-tune state files! Back them up first:

```bash
# Backup state before destroying
gcloud compute ssh autotune-prod --zone=us-central1-a --command='cat /var/lib/autotune/data/auto-tune-state.json' > backup-state.json
```

---

## Advanced Configuration

### Multi-Environment Setup

```bash
# Create dev stack
pulumi stack init dev
pulumi config set gcp:project your-project-dev
pulumi config set envFile ../../../.env.dev
pulumi up --yes

# Create prod stack
pulumi stack init prod
pulumi config set gcp:project your-project-prod
pulumi config set envFile ../../../.env
pulumi up --yes

# Switch between stacks
pulumi stack select dev
pulumi stack select prod
```

### Custom Regions (Europe)

```bash
# Use Europe region (still free tier eligible)
pulumi config set gcp:region europe-west1
pulumi config set gcp:zone europe-west1-b
```

Free tier regions:
- `us-west1` (Oregon)
- `us-central1` (Iowa) ⭐ Recommended
- `us-east1` (South Carolina)

### Preemptible Instances (Not Recommended)

```bash
# Cheaper but can be shut down anytime (not good for 24/7 bot)
# Edit index.ts and add:
# scheduling: {
#   preemptible: true,
# }
```

---

## Comparison with Other Options

| Feature | GCP Pulumi | Hetzner VPS | DigitalOcean |
|---------|-----------|-------------|--------------|
| **Cost** | $0/month (free tier) | €4.15/month | $6/month |
| **Setup** | 15 min (IaC) | 10 min (manual) | 10 min (manual) |
| **RAM** | 1 GB | 2 GB | 1 GB |
| **Specs** | 2 vCPU, 30GB SSD | 2 vCPU, 40GB SSD | 1 vCPU, 25GB SSD |
| **IaC** | ✅ Pulumi | ❌ Manual | ❌ Manual |
| **Secrets** | ✅ Secret Manager | ❌ Manual | ❌ Manual |
| **Monitoring** | ✅ Cloud Logging | ❌ Manual | ❌ Manual |
| **Budget Alerts** | ✅ Built-in | ❌ None | ❌ None |

**GCP Pulumi is best for:**
- ✅ Free tier (for 12 months or always-free resources)
- ✅ Infrastructure as Code
- ✅ Built-in monitoring and logging
- ✅ Budget alerts and cost control
- ✅ Enterprise-grade security (Secret Manager)

---

## Next Steps

1. ✅ Deploy to GCP using `pulumi up`
2. ✅ Verify bot is running with `pulumi stack output logsCommand | bash`
3. ✅ Set up budget alerts (optional)
4. ✅ Monitor via Cloud Logging
5. ✅ Back up state files regularly

## Support

For issues:
- Pulumi: [https://www.pulumi.com/docs/](https://www.pulumi.com/docs/)
- GCP Free Tier: [https://cloud.google.com/free](https://cloud.google.com/free)
- Project docs: [../CLAUDE.md](../CLAUDE.md)
