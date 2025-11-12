# GCP Billing Setup with Budget Alerts

This guide explains how to deploy the auto-tune bot to GCP with **billing protection** to ensure you stay within the free tier and get notified before any charges occur.

## 🎯 Goal

- Deploy within GCP **free tier** ($0/month)
- Get **email alerts** when approaching spending limits
- **Prevent automatic billing** - you'll be notified instead of charged

## Prerequisites

1. **GCP Free Tier Account**
   - Sign up at https://cloud.google.com/free
   - $300 free credits for 90 days
   - Always-free tier after credits expire

2. **Billing Account ID**
   ```bash
   # Find your billing account ID
   gcloud billing accounts list
   ```
   Copy the `ACCOUNT_ID` (format: `012345-ABCDEF-6789AB`)

3. **Email for Alerts**
   - Use your personal email or a monitored email address
   - You'll receive alerts at 50%, 90%, and 100% of your budget threshold

## Quick Setup

### 1. Install Dependencies

```bash
cd deploy/gcp/pulumi
npm install
```

### 2. Configure Pulumi Stack

```bash
# Initialize stack
pulumi stack init prod

# Set GCP project
pulumi config set gcp:project YOUR_PROJECT_ID

# Set free tier zone
pulumi config set gcp:zone us-central1-a

# IMPORTANT: Set billing configuration
# Note: Must use 'autotune:' namespace prefix for these values
pulumi config set --secret autotune:billingAccountId 012345-ABCDEF-6789AB
pulumi config set autotune:budgetAlertEmails your-email@example.com
pulumi config set autotune:budgetAmount 1.0  # Alert threshold in USD

# Optional: Path to .env file (default: ../../../.env)
pulumi config set autotune:envFile /path/to/.env
```

### 3. Deploy

```bash
# Preview changes
pulumi preview

# Deploy infrastructure
pulumi up
```

Pulumi will create:
- ✅ Compute Engine e2-micro VM (FREE TIER)
- ✅ Secret Manager secrets for environment variables
- ✅ Service account with minimal permissions
- ✅ **Billing budget with email alerts**
- ✅ **Notification channels for alerts**

### 4. Verify Billing Alerts

Check that budget alerts were created:

```bash
# List budgets
gcloud billing budgets list --billing-account=YOUR_BILLING_ACCOUNT_ID

# List notification channels
gcloud alpha monitoring channels list
```

## Budget Alert Behavior

### Threshold Alerts

You'll receive email alerts at:

| Threshold | Amount (if $1 budget) | Action Required |
|-----------|----------------------|-----------------|
| **50%** | $0.50 | ⚠️ Monitor usage, check logs |
| **90%** | $0.90 | ⚠️⚠️ Investigate immediately, consider stopping VM |
| **100%** | $1.00 | 🚨 **STOP VM** to prevent charges |

### What Happens at 100%?

**Important:** GCP will **NOT automatically charge you** beyond your budget. However:
- Your services may be **suspended** if you exceed free tier limits
- You'll need to manually approve any charges beyond the free tier
- **Best practice:** Stop the VM immediately when you get the 100% alert

### Stop VM When Alerted

```bash
# Stop VM immediately (saves costs)
gcloud compute instances stop autotune-prod --zone=us-central1-a

# Check current billing status
gcloud billing projects describe YOUR_PROJECT_ID
```

## Free Tier Resources

The deployment uses **only** free tier resources:

| Resource | Free Tier Limit | Our Usage | Status |
|----------|----------------|-----------|--------|
| **Compute Engine** | 1 e2-micro/month (us-west1, us-central1, us-east1) | 1 e2-micro | ✅ Free |
| **Persistent Disk** | 30 GB standard | 30 GB | ✅ Free |
| **Egress Traffic** | 1 GB/month (North America) | ~100 MB/month | ✅ Free |
| **Cloud Logging** | 50 GB/month | ~1 GB/month | ✅ Free |
| **Secret Manager** | 6 active secret versions | ~15 secrets | ✅ Free |
| **Container Registry** | 5 GB storage | ~500 MB | ✅ Free |

**Expected Cost:** $0/month (within free tier)

## Monitoring Costs

### Real-Time Cost Monitoring

```bash
# View current billing
gcloud billing projects describe YOUR_PROJECT_ID

# Check budget status
gcloud billing budgets list --billing-account=YOUR_BILLING_ACCOUNT_ID --format=json

# View cost breakdown (last 30 days)
gcloud billing projects describe YOUR_PROJECT_ID --format="value(billingEnabled)"
```

### GCP Console Monitoring

1. Go to [GCP Billing Console](https://console.cloud.google.com/billing)
2. Navigate to **Reports** → View cost breakdown by service
3. Check **Budgets & alerts** → Verify budget is active

### Common Cost Drivers (What to Watch)

⚠️ **Potential cost sources:**

1. **Egress Traffic** - Stay under 1 GB/month
   - Auto-tune makes RPC calls to Solana (minimal traffic)
   - Estimated: ~50-100 MB/month

2. **Persistent Disk** - Stay at 30 GB
   - Don't resize disk beyond 30 GB
   - Current usage: ~2 GB (Docker + state files)

3. **Compute Hours** - e2-micro is free 24/7
   - Keep machine type as `e2-micro`
   - Upgrading to `e2-small` costs ~$12/month

4. **Secret Manager** - 6 active versions free
   - Avoid creating multiple secret versions
   - Update existing versions instead

## Configuration Options

### Budget Amount

Default: $1.00 USD (recommended for free tier protection)

```bash
# Set budget to $5 (for testing/development)
pulumi config set autotune:budgetAmount 5.0

# Set budget to $0.50 (ultra-conservative)
pulumi config set autotune:budgetAmount 0.5
```

### Multiple Email Recipients

```bash
# Comma-separated emails for alerts
pulumi config set autotune:budgetAlertEmails "admin@example.com,team@example.com,alerts@example.com"
```

### Update Budget After Deployment

```bash
# Change budget threshold
pulumi config set autotune:budgetAmount 2.0

# Update deployment
pulumi up
```

## Disable Automatic Billing

**Critical for free tier protection:**

1. Go to [GCP Billing Settings](https://console.cloud.google.com/billing)
2. Select your billing account
3. Click **Payment settings**
4. **Disable automatic payments** (requires manual approval for charges)

This ensures you **must approve** any charges before they occur.

## What If I Get Charged?

If you accidentally exceed free tier:

### 1. Stop All Resources Immediately

```bash
# Stop VM
gcloud compute instances stop autotune-prod --zone=us-central1-a

# Verify no running instances
gcloud compute instances list
```

### 2. Review Billing Report

```bash
# View detailed billing
gcloud billing projects describe YOUR_PROJECT_ID

# Check cost breakdown
# Go to: https://console.cloud.google.com/billing/reports
```

### 3. Delete Resources (if needed)

```bash
# Destroy all Pulumi resources
pulumi destroy

# Verify all resources deleted
gcloud compute instances list
gcloud secrets list
```

### 4. Contact GCP Support

- Free tier users: https://cloud.google.com/support
- Explain you're using free tier and want to avoid charges
- GCP often waives small accidental charges for free tier users

## Best Practices

### 1. Start with Low Budget

```bash
# Set conservative budget for first month
pulumi config set autotune:budgetAmount 0.5
```

### 2. Monitor Weekly

```bash
# Check costs every week
gcloud billing projects describe YOUR_PROJECT_ID
```

### 3. Stop VM When Not Trading

```bash
# Stop VM on weekends or off-hours
gcloud compute instances stop autotune-prod --zone=us-central1-a

# Start when needed
gcloud compute instances start autotune-prod --zone=us-central1-a
```

### 4. Use Scheduled Runs (Alternative)

Instead of 24/7 operation, use Cloud Scheduler:
- Run auto-tune every hour instead of continuous monitoring
- Reduces compute time by 95%
- Still within free tier but with less frequent rebalancing

## Troubleshooting

### Budget Alerts Not Received

```bash
# Verify notification channels
gcloud alpha monitoring channels list

# Check budget configuration
gcloud billing budgets describe BUDGET_ID --billing-account=YOUR_BILLING_ACCOUNT_ID

# Test email delivery
gcloud alpha monitoring channels describe CHANNEL_ID
```

### Billing Account Not Found

```bash
# List all billing accounts
gcloud billing accounts list

# Link project to billing account
gcloud billing projects link YOUR_PROJECT_ID --billing-account=YOUR_BILLING_ACCOUNT_ID
```

### Budget Not Created

Check Pulumi config:
```bash
# Verify configuration
pulumi config get autotune:billingAccountId
pulumi config get autotune:budgetAlertEmails

# Re-deploy if missing
pulumi up
```

## Summary

✅ **Free Tier Protection:**
- Budget alerts at 50%, 90%, 100%
- Email notifications to your inbox
- Manual approval required for charges (if automatic billing disabled)

✅ **Resources Optimized for Free Tier:**
- e2-micro VM (always free in us-central1)
- 30 GB standard disk (always free)
- Minimal egress traffic (~100 MB/month)

✅ **Safety Measures:**
- Billing budget with email alerts
- Notification channels for multiple recipients
- Easy VM stop/start for cost control

**Expected Monthly Cost:** $0.00 (within free tier limits)

## Next Steps

1. **Deploy:** `pulumi up`
2. **Verify alerts:** Check email for budget confirmation
3. **Monitor:** Review billing weekly at https://console.cloud.google.com/billing
4. **Adjust:** Update budget threshold as needed

## Resources

- [GCP Free Tier](https://cloud.google.com/free)
- [Billing Budgets](https://cloud.google.com/billing/docs/how-to/budgets)
- [Cost Management](https://cloud.google.com/billing/docs/how-to/manage-costs)
- [Notification Channels](https://cloud.google.com/monitoring/support/notification-options)
