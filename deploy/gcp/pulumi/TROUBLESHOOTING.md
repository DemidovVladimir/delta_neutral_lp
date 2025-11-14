# Pulumi GCP Deployment Troubleshooting

## Billing Budget Authentication Error

### Error Message
```
Error 403: Your application is authenticating by using local Application Default Credentials.
The billingbudgets.googleapis.com API requires a quota project, which is not set by default.
```

### Root Cause
The GCP Billing Budgets API requires a quota project to be set when using Application Default Credentials (ADC). This is a security measure to ensure API usage is tracked against a specific project.

### Solution 1: Set Quota Project (Recommended)

Run this command to configure your ADC with a quota project:

```bash
gcloud auth application-default set-quota-project auto-tune-477718
```

Then retry the deployment:

```bash
pulumi up
```

### Solution 2: Re-authenticate with Quota Project

If Solution 1 doesn't work, re-authenticate with the quota project flag:

```bash
gcloud auth application-default login --project=auto-tune-477718
```

Then retry:

```bash
pulumi up
```

### Solution 3: Manual Budget Creation (Alternative)

If you prefer to create the billing budget manually:

1. **Update Pulumi config to skip budget creation:**
   ```bash
   pulumi config rm autotune:budgetAlertEmails
   ```

2. **Retry deployment:**
   ```bash
   pulumi up
   ```

3. **Manually create budget via GCP Console:**
   - Go to [GCP Billing Budgets](https://console.cloud.google.com/billing/budgets)
   - Click "Create Budget"
   - Select project: `auto-tune-477718`
   - Set budget amount: $1.00 USD
   - Add alert thresholds: 50%, 90%, 100%
   - Add notification email: `uncojet@gmail.com`
   - Click "Finish"

### Verification

After applying the solution, verify the budget was created:

```bash
gcloud billing budgets list --billing-account=01CE0A-B16945-956B20
```

## Current Deployment Status

From your most recent deployment:

✅ **Successfully Created (73 resources):**
- GCP APIs enabled (compute, secretmanager, logging, billing-budgets)
- Service account with minimal permissions
- 27 secrets uploaded to Secret Manager
- Docker image built and pushed to GCR
- Email notification channel created

❌ **Failed (2 resources):**
- `gcp:billing:Budget` - Authentication error (needs quota project)
- `gcp:compute:Instance` - Not created yet (blocked by stack failure)

### Next Steps

1. Apply Solution 1 or Solution 2 above
2. Run `pulumi up` again to complete the deployment
3. Verify VM is created and running:
   ```bash
   pulumi stack output sshCommand
   pulumi stack output logsCommand
   ```

The bot deployment will complete once the billing budget issue is resolved. The VM and auto-tune bot will start automatically.

## Other Common Issues

### Issue: "Compute Engine API has not been used"

**Symptom:** Warning about Compute Engine API not being enabled.

**Solution:** This is a timing issue. The Pulumi deployment enables the API automatically. Wait 2-3 minutes for API activation to propagate, then run:

```bash
pulumi up
```

### Issue: Docker image push fails

**Symptom:** "Push completed without reporting a digest"

**Solution:** This is usually a benign warning. Verify the image was pushed:

```bash
gcloud container images list
gcloud container images describe gcr.io/auto-tune-477718/autotune-prod:latest
```

If the image is missing, manually push:

```bash
# From project root
docker build -t gcr.io/auto-tune-477718/autotune-prod:latest .
docker push gcr.io/auto-tune-477718/autotune-prod:latest
```

### Issue: Secrets not loading in VM

**Symptom:** Container fails to start with "missing environment variable" errors.

**Solution:** Verify secrets were created:

```bash
gcloud secrets list --filter="name:autotune-*"
```

If secrets are missing, manually create them:

```bash
# From project root
cd deploy/gcp
./create-secrets.sh ../../.env
```

## Getting Help

- **Pulumi Docs:** https://www.pulumi.com/docs/clouds/gcp/
- **GCP Billing API:** https://cloud.google.com/billing/docs/how-to/budgets
- **GCP Authentication:** https://cloud.google.com/docs/authentication/provide-credentials-adc
