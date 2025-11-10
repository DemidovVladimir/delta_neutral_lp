# GCP Deployment Guide for Auto-Tune Bot

This guide explains how to deploy the auto-tune bot to Google Cloud Platform (GCP) using the **free tier**.

## Prerequisites

1. **GCP Account** with free tier activated
2. **gcloud CLI** installed and authenticated
   ```bash
   gcloud auth login
   gcloud config set project YOUR_PROJECT_ID
   ```
3. **Docker** installed locally (for building images)
4. **.env file** configured with your secrets

## Architecture

The deployment uses:
- **Compute Engine e2-micro** instance (Free Tier: 1 instance/month in us-central1, us-west1, or us-east1)
- **Secret Manager** for secure environment variable storage
- **Cloud Logging** for centralized logs
- **Container Registry** for Docker image storage
- **Persistent Disk** (30GB standard - Free Tier)

## Deployment Steps

### 1. Prepare Your Environment

Make all deployment scripts executable:
```bash
chmod +x deploy/gcp/*.sh
```

### 2. Build and Push Docker Image

Build the Docker image locally:
```bash
docker build -t gcr.io/YOUR_PROJECT_ID/delta-neutral-autotune:latest .
```

Configure Docker for GCP:
```bash
gcloud auth configure-docker
```

Push the image:
```bash
docker push gcr.io/YOUR_PROJECT_ID/delta-neutral-autotune:latest
```

**OR** use Cloud Build (recommended):
```bash
gcloud builds submit --config=deploy/gcp/cloudbuild.yaml .
```

### 3. Create Secrets

Upload your `.env` file to Secret Manager:
```bash
./deploy/gcp/create-secrets.sh .env
```

This will create secrets with the prefix `autotune-*` (e.g., `autotune-rpc-url`, `autotune-private-key`, etc.)

**Verify secrets:**
```bash
gcloud secrets list --filter="name:autotune-*"
```

### 4. Deploy VM Instance

Deploy the Compute Engine instance:
```bash
./deploy/gcp/deploy-vm.sh autotune-bot us-central1-a
```

Arguments:
- `autotune-bot` - Instance name (optional, defaults to "autotune-bot")
- `us-central1-a` - Zone (optional, defaults to free tier zone)

The script will:
- ✅ Enable required APIs
- ✅ Create service account
- ✅ Grant Secret Manager access
- ✅ Create e2-micro VM (FREE TIER)
- ✅ Run startup script to deploy container

### 5. Monitor Deployment

**View startup script logs:**
```bash
gcloud compute instances get-serial-port-output autotune-bot --zone=us-central1-a
```

**SSH into instance:**
```bash
gcloud compute ssh autotune-bot --zone=us-central1-a
```

**View container logs:**
```bash
gcloud compute ssh autotune-bot --zone=us-central1-a --command='docker logs -f autotune'
```

**View Cloud Logging:**
```bash
gcloud logging read "resource.type=gce_instance AND resource.labels.instance_id=INSTANCE_ID" --limit 50 --format json
```

### 6. Verify Auto-Tune is Running

Check container status:
```bash
gcloud compute ssh autotune-bot --zone=us-central1-a --command='docker ps'
```

Check auto-tune state file:
```bash
gcloud compute ssh autotune-bot --zone=us-central1-a --command='cat /var/lib/autotune/data/auto-tune-state.json'
```

## Free Tier Limits

| Resource | Free Tier Limit | Usage |
|----------|----------------|-------|
| **Compute Engine** | 1 e2-micro instance/month | ✅ Used |
| **Regions** | us-west1, us-central1, us-east1 | ✅ us-central1-a |
| **Disk** | 30 GB standard persistent disk | ✅ 30 GB |
| **Egress** | 1 GB/month (North America) | ⚠️ Monitor |
| **Cloud Logging** | 50 GB/month | ✅ Used |
| **Secret Manager** | 6 active secret versions | ✅ ~15 secrets |

**Cost Estimate:** $0/month (within free tier limits)

⚠️ **Warning:** Exceeding free tier limits will incur charges. Monitor usage at: https://console.cloud.google.com/billing

## Managing the Instance

### Stop Instance (pause, save costs)
```bash
gcloud compute instances stop autotune-bot --zone=us-central1-a
```

### Start Instance
```bash
gcloud compute instances start autotune-bot --zone=us-central1-a
```

### Restart Container
```bash
gcloud compute ssh autotune-bot --zone=us-central1-a --command='docker restart autotune'
```

### Update Container (deploy new version)
```bash
# 1. Build and push new image
gcloud builds submit --config=deploy/gcp/cloudbuild.yaml .

# 2. SSH and pull new image
gcloud compute ssh autotune-bot --zone=us-central1-a

# 3. Inside VM:
docker pull gcr.io/YOUR_PROJECT_ID/delta-neutral-autotune:latest
docker stop autotune
docker rm autotune
sudo systemctl restart google-startup-scripts.service
exit
```

### Update Secrets
```bash
# Update specific secret
echo "new_value" | gcloud secrets versions add autotune-secret-name --data-file=-

# Update all from .env
./deploy/gcp/create-secrets.sh .env

# Restart container to load new secrets
gcloud compute ssh autotune-bot --zone=us-central1-a --command='sudo systemctl restart google-startup-scripts.service'
```

### Delete Instance
```bash
gcloud compute instances delete autotune-bot --zone=us-central1-a
```

## State Persistence

The auto-tune state (`data/auto-tune-state.json`) is persisted to a volume at `/var/lib/autotune/data` on the VM.

**Backup state file:**
```bash
gcloud compute ssh autotune-bot --zone=us-central1-a --command='cat /var/lib/autotune/data/auto-tune-state.json' > backup-state.json
```

**Restore state file:**
```bash
gcloud compute scp backup-state.json autotune-bot:/tmp/state.json --zone=us-central1-a
gcloud compute ssh autotune-bot --zone=us-central1-a --command='sudo mv /tmp/state.json /var/lib/autotune/data/auto-tune-state.json'
```

## Monitoring

### Health Check Script

The deployment includes a health check cron job that runs every 5 minutes:
- Checks if container is running
- Monitors consecutive errors
- Auto-restarts if unhealthy

**View health check logs:**
```bash
gcloud compute ssh autotune-bot --zone=us-central1-a --command='tail -f /var/log/autotune-health.log'
```

### Alerts (Optional)

Set up Cloud Monitoring alerts:
```bash
# Create alert for instance down
gcloud alpha monitoring policies create \
  --notification-channels=CHANNEL_ID \
  --display-name="Auto-Tune Instance Down" \
  --condition-display-name="Instance not running" \
  --condition-threshold-value=1 \
  --condition-threshold-duration=300s
```

## Troubleshooting

### Container won't start
```bash
# Check startup script logs
gcloud compute instances get-serial-port-output autotune-bot --zone=us-central1-a

# SSH and check Docker logs
gcloud compute ssh autotune-bot --zone=us-central1-a
docker logs autotune
```

### Secrets not loading
```bash
# Verify service account has access
gcloud secrets get-iam-policy autotune-rpc-url

# Grant access manually if needed
gcloud secrets add-iam-policy-binding autotune-rpc-url \
  --member='serviceAccount:autotune-bot-sa@PROJECT.iam.gserviceaccount.com' \
  --role='roles/secretmanager.secretAccessor'
```

### Out of memory
```bash
# Check memory usage
gcloud compute ssh autotune-bot --zone=us-central1-a --command='free -h'

# e2-micro has 1GB RAM - if not enough, upgrade to e2-small (not free tier)
# Note: This will incur charges (~$12/month)
gcloud compute instances set-machine-type autotune-bot \
  --machine-type=e2-small \
  --zone=us-central1-a
```

## Security Best Practices

1. ✅ **Secrets in Secret Manager** - Never commit `.env` to git
2. ✅ **Service Account** - Minimal permissions (Secret Manager + Logging)
3. ✅ **Non-root container** - Runs as nodejs user (UID 1001)
4. ✅ **No public IP** - Use IAP for SSH access (optional)
5. ✅ **Firewall** - No inbound ports open (auto-tune doesn't need them)
6. ✅ **Automated backups** - State file persisted to VM disk

## Cost Optimization

1. **Use preemptible instances** (not recommended for 24/7 auto-tune):
   ```bash
   --preemptible --maintenance-policy=TERMINATE
   ```

2. **Stop instance when not needed:**
   ```bash
   gcloud compute instances stop autotune-bot --zone=us-central1-a
   ```
   Free tier still applies to stopped instances (no compute charges)

3. **Monitor egress traffic** - Keep under 1GB/month

4. **Use Cloud Scheduler** for periodic runs (alternative to 24/7):
   - Run auto-tune once per hour instead of continuous monitoring
   - Reduces compute time significantly

## References

- [GCP Free Tier](https://cloud.google.com/free)
- [Compute Engine Pricing](https://cloud.google.com/compute/pricing)
- [Secret Manager](https://cloud.google.com/secret-manager/docs)
- [Container Registry](https://cloud.google.com/container-registry/docs)
- [Cloud Logging](https://cloud.google.com/logging/docs)
