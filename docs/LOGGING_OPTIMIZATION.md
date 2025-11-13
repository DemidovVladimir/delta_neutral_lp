# GCP Logging Optimization Guide

This document explains the logging optimizations implemented to reduce GCP Cloud Logging costs while maintaining visibility into bot operations.

## Overview

The bot now uses **dual-mode logging** with **intelligent sampling** to minimize log volume in production while maintaining full debug capabilities locally.

## Key Features

### 1. Dual-Mode Logging

**Local Development (Console Format):**
```
14:23:45 [info] Auto-tune check cycle started { iteration: 42, rebalanceCount: 3 }
14:23:46 [info] Position balance checked { solPercent: 45.2, usdcPercent: 54.8 }
```

**GCP Production (Structured JSON):**
```json
{
  "timestamp": "2025-01-13T14:23:45.123Z",
  "severity": "INFO",
  "message": "Auto-tune check cycle started",
  "iteration": 42,
  "rebalanceCount": 3
}
```

### 2. Log Sampling for Routine Operations

**Problem:** Auto-tune checks position every 10-30 seconds, generating ~2,880-8,640 log entries per day for routine checks alone.

**Solution:** Sample routine logs at 1-in-N rate (default: 1 in 10).

**Result:** ~90% reduction in routine log volume.

**What Gets Sampled:**
- ✅ Auto-tune check cycle started
- ✅ Position balance checked
- ✅ Position balanced - no action needed
- ✅ Auto-tune check cycle completed

**What NEVER Gets Sampled:**
- ❌ Rebalance operations (always logged)
- ❌ Transaction signatures (always logged)
- ❌ Errors and warnings (always logged)
- ❌ Position creation/withdrawal (always logged)
- ❌ Swap operations (always logged)

### 3. GCP Severity Mapping

Winston levels automatically map to GCP Cloud Logging severity:

| Winston Level | GCP Severity | Use Case |
|---------------|-------------|----------|
| `error` | `ERROR` | Failures, exceptions |
| `warn` | `WARNING` | Warnings, alerts |
| `info` | `INFO` | Important events |
| `debug` | `DEBUG` | Debugging info |

## Configuration

### Environment Variables

```bash
# Enable GCP structured logging (automatic in production)
NODE_ENV=production

# Configure log sampling rate (default: 10 = log 1 in 10)
LOG_SAMPLE_RATE=10
```

### GCP Detection

The logger automatically detects GCP environment based on:
- `NODE_ENV=production`
- `GCP_PROJECT` environment variable
- `K_SERVICE` (Cloud Run)
- `GAE_SERVICE` (App Engine)

## Cost Savings Estimate

### Before Optimization

**Routine logs:**
- Check cycle started: 1 log/cycle
- Position balance checked: 1 log/cycle
- Position balanced: 1 log/cycle
- Check cycle completed: 1 log/cycle

**Total:** 4 logs per cycle

**Daily volume (10s interval):**
- Cycles per day: 8,640
- Logs per day: **34,560 routine logs**
- Plus rebalance logs: ~50-100/day
- **Total: ~35,000 logs/day**

### After Optimization

**Routine logs (sampled at 1-in-10):**
- **3,456 routine logs/day** (90% reduction)
- Plus rebalance logs: ~50-100/day (unchanged)
- **Total: ~3,600 logs/day**

### GCP Cloud Logging Pricing

**Free tier:** 50 GiB/month (~1.6 GiB/day)

**Estimate (assuming 500 bytes per log entry):**
- Before: 35,000 × 500 bytes = **17.5 MB/day** (~525 MB/month)
- After: 3,600 × 500 bytes = **1.8 MB/day** (~54 MB/month)

**Result:** Both well within free tier, but 90% reduction reduces future scaling costs.

## Usage Examples

### In Code

```typescript
import { log } from '../utils/logger.js';

// Regular logging (always logged)
log.info('Rebalance triggered', { reason: 'imbalanced' });
log.error('Transaction failed', { signature: 'abc123' });

// Sampled logging (only 1-in-10 logged in production)
log.infoSampled('Auto-tune check cycle started', {
  iteration: this.state.iteration,
  rebalanceCount: this.state.rebalanceCount,
});
```

### Domain-Specific Helpers

```typescript
// Transaction logging (always logged)
log.transaction('abc123...', 'withdraw+claim+close', {
  claimedSol: 0.05,
  claimedUsdc: 8.5,
});

// Hedge adjustment logging (always logged)
log.hedge(2.5, 10.0, 7.5, {
  action: 'increase_short',
});

// Emergency logging (always logged with banner)
log.emergency('Price oracle stale', {
  lastUpdate: Date.now() - 120000,
});
```

## Viewing Logs in GCP

### Cloud Logging Console

1. Go to: [Cloud Logging Console](https://console.cloud.google.com/logs)
2. Filter by resource: `Compute Engine VM Instance`
3. Filter by severity: `INFO`, `WARNING`, `ERROR`
4. Search by fields:
   ```
   jsonPayload.iteration > 100
   jsonPayload.rebalanceCount > 0
   jsonPayload.sampled = true
   ```

### Example Query

**Find all rebalance operations:**
```
resource.type="gce_instance"
jsonPayload.message=~"Rebalance"
```

**Find sampled logs:**
```
resource.type="gce_instance"
jsonPayload.sampled=true
```

**Find errors only:**
```
resource.type="gce_instance"
severity="ERROR"
```

## CLI Commands

```bash
# View logs via Pulumi (streams in real-time)
pnpm deploy:gcp:logs

# View logs via gcloud (last 100 lines)
gcloud compute ssh autotune-prod --zone=us-central1-a \
  --command='docker logs -f autotune'

# View startup logs
gcloud compute ssh autotune-prod --zone=us-central1-a \
  --command='sudo journalctl -u google-startup-scripts.service -n 100'
```

## Adjusting Log Sampling

### Increase Sampling (More Logs)

```bash
# Log 1 in 5 routine checks (less aggressive sampling)
LOG_SAMPLE_RATE=5
```

### Decrease Sampling (Fewer Logs)

```bash
# Log 1 in 20 routine checks (more aggressive sampling)
LOG_SAMPLE_RATE=20
```

### Disable Sampling (All Logs)

```bash
# Log everything (not recommended for production)
LOG_SAMPLE_RATE=1
```

## Best Practices

1. **Use sampled logging for high-frequency routine operations**
   - Position checks (every 10-30s)
   - Health checks
   - Periodic status updates

2. **Never sample important events**
   - Transactions (signatures needed for debugging)
   - Errors and warnings
   - Rebalance operations
   - User actions

3. **Use structured metadata**
   ```typescript
   // Good: Structured metadata for filtering
   log.info('Position created', {
     positionMint: 'abc123',
     solAmount: 1.5,
     usdcAmount: 270,
   });

   // Bad: Everything in message string
   log.info(`Position created: abc123, 1.5 SOL, 270 USDC`);
   ```

4. **Keep messages concise**
   - GCP charges by ingested volume
   - Message + metadata should be < 1 KB per log entry

## Monitoring Recommendations

1. **Set up alerts for:**
   - `severity=ERROR` (any error)
   - `jsonPayload.consecutiveErrors > 3` (repeated failures)
   - `jsonPayload.rebalanceCount > 10` (unusual activity)

2. **Review sampled logs periodically:**
   - Check if sampling rate is appropriate
   - Ensure important events aren't being missed

3. **Track log volume:**
   - Monitor GCP Cloud Logging usage
   - Adjust `LOG_SAMPLE_RATE` if needed

## Troubleshooting

### Logs Not Appearing in GCP Console

**Check:**
1. `NODE_ENV=production` is set in container
2. Container is using `--log-driver=gcplogs`
3. Service account has `roles/logging.logWriter` permission

**Verify:**
```bash
# SSH into VM
pnpm deploy:gcp:ssh

# Check container environment
docker exec autotune env | grep NODE_ENV

# Check container logs locally
docker logs autotune | tail -20
```

### Too Many Logs

**Increase sampling rate:**
```bash
# Edit Pulumi startup script
# Change: LOG_SAMPLE_RATE=10
# To: LOG_SAMPLE_RATE=20

# Redeploy
pnpm deploy:gcp:up
```

### Too Few Logs

**Decrease sampling rate:**
```bash
# Edit Pulumi startup script
# Change: LOG_SAMPLE_RATE=10
# To: LOG_SAMPLE_RATE=5

# Redeploy
pnpm deploy:gcp:up
```

## Summary

- ✅ **Dual-mode logging**: Console for dev, JSON for GCP
- ✅ **90% log reduction**: via intelligent sampling
- ✅ **Zero information loss**: Important events always logged
- ✅ **Cost optimized**: Well within GCP free tier
- ✅ **Easy configuration**: Single environment variable
- ✅ **Structured queries**: Filter by any field in GCP Console

**Next steps:**
1. Deploy to GCP: `pnpm deploy:gcp:up`
2. Monitor logs: `pnpm deploy:gcp:logs`
3. Adjust sampling if needed: Edit `LOG_SAMPLE_RATE` in Pulumi index.ts
