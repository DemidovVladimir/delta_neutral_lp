/**
 * Pulumi Infrastructure for Auto-Tune Bot on GCP
 *
 * This deploys:
 * - Docker image to GCP Container Registry
 * - Secrets to GCP Secret Manager
 * - Compute Engine e2-micro instance (FREE TIER)
 * - Service account with minimal permissions
 * - Persistent disk for state storage
 *
 * Usage:
 *   pulumi up --yes    # Deploy
 *   pulumi destroy     # Clean up
 */

import * as pulumi from '@pulumi/pulumi';
import * as gcp from '@pulumi/gcp';
import * as docker from '@pulumi/docker';
import * as fs from 'fs';
import * as path from 'path';

// Configuration
const config = new pulumi.Config();
const gcpConfig = new pulumi.Config('gcp');
const autotuneConfig = new pulumi.Config('autotune'); // Namespace for autotune-specific config
const projectId = gcpConfig.require('project');
const region = gcpConfig.get('region') || 'us-central1';
const zone = gcpConfig.get('zone') || 'us-central1-a';
const envFile = config.get('envFile') || '../../../.env';
const machineType = config.get('machineType') || 'e2-micro';
const diskSize = parseInt(config.get('diskSize') || '30');

// Billing configuration (from autotune namespace)
const billingAccountId = autotuneConfig.get('billingAccountId') || undefined; // Optional: billing account ID
const budgetAlertEmails = autotuneConfig.get('budgetAlertEmails') || ''; // Comma-separated emails for budget alerts
const budgetAmountUsd = parseFloat(autotuneConfig.get('budgetAmount') || '1.0'); // Budget threshold in USD (default: $1)

// Stack name for resource naming
const stack = pulumi.getStack();
const baseName = `autotune-${stack}`;

// Enable required APIs
const computeApi = new gcp.projects.Service('compute-api', {
  service: 'compute.googleapis.com',
  project: projectId,
});

const secretManagerApi = new gcp.projects.Service('secret-manager-api', {
  service: 'secretmanager.googleapis.com',
  project: projectId,
});

const loggingApi = new gcp.projects.Service('logging-api', {
  service: 'logging.googleapis.com',
  project: projectId,
});

const billingBudgetsApi = new gcp.projects.Service('billing-budgets-api', {
  service: 'billingbudgets.googleapis.com',
  project: projectId,
});

// Create service account for the VM
const serviceAccount = new gcp.serviceaccount.Account('autotune-sa', {
  accountId: `${baseName}-sa`,
  displayName: 'Auto-Tune Bot Service Account',
  project: projectId,
}, { dependsOn: [computeApi] });

// Grant logging permissions
const loggingBinding = new gcp.projects.IAMMember('logging-writer', {
  project: projectId,
  role: 'roles/logging.logWriter',
  member: pulumi.interpolate`serviceAccount:${serviceAccount.email}`,
}, { dependsOn: [loggingApi] });

// Grant GCR/Artifact Registry read permissions (needed to pull Docker images)
const storageBinding = new gcp.projects.IAMMember('storage-object-viewer', {
  project: projectId,
  role: 'roles/storage.objectViewer',
  member: pulumi.interpolate`serviceAccount:${serviceAccount.email}`,
}, { dependsOn: [computeApi] });

// Also grant Artifact Registry reader role (for GCR v2 API)
const artifactRegistryBinding = new gcp.projects.IAMMember('artifact-registry-reader', {
  project: projectId,
  role: 'roles/artifactregistry.reader',
  member: pulumi.interpolate`serviceAccount:${serviceAccount.email}`,
}, { dependsOn: [computeApi] });

/**
 * Parse only RPC_URL and PRIVATE_KEY from .env file
 * All other config is hardcoded in staticConfig.ts
 */
function parseSecretsFromEnvFile(filePath: string): Record<string, string> {
  const envPath = path.resolve(__dirname, filePath);
  if (!fs.existsSync(envPath)) {
    throw new Error(`Environment file not found: ${envPath}`);
  }

  const content = fs.readFileSync(envPath, 'utf-8');
  const secrets: Record<string, string> = {};
  const requiredSecrets = ['RPC_URL', 'PRIVATE_KEY'];

  content.split('\n').forEach((line) => {
    line = line.trim();
    // Skip comments and empty lines
    if (line.startsWith('#') || line === '') return;

    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) {
      const key = match[1].trim();
      let value = match[2].trim();

      // Only extract RPC_URL and PRIVATE_KEY
      if (!requiredSecrets.includes(key)) return;

      // Remove quotes if present
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }

      // Skip placeholders
      if (value && !value.match(/<.*>/)) {
        secrets[key] = value;
      }
    }
  });

  // Validate that we got both secrets
  requiredSecrets.forEach(key => {
    if (!secrets[key]) {
      throw new Error(`Missing required secret in .env file: ${key}`);
    }
  });

  return secrets;
}

// Create only 2 secrets in Secret Manager (RPC_URL and PRIVATE_KEY)
const secrets = parseSecretsFromEnvFile(envFile);
const secretResources: Record<string, gcp.secretmanager.Secret> = {};
const secretVersions: Record<string, gcp.secretmanager.SecretVersion> = {};

console.log(`📦 Creating ${Object.keys(secrets).length} secrets in GCP Secret Manager: ${Object.keys(secrets).join(', ')}`);

Object.entries(secrets).forEach(([key, value]) => {
  const secretName = `autotune-${key.toLowerCase().replace(/_/g, '-')}`;

  // Create secret
  const secret = new gcp.secretmanager.Secret(secretName, {
    secretId: secretName,
    project: projectId,
    replication: {
      auto: {},
    },
  }, { dependsOn: [secretManagerApi] });

  secretResources[key] = secret;

  // Add secret version with value
  const version = new gcp.secretmanager.SecretVersion(`${secretName}-v1`, {
    secret: secret.id,
    secretData: value,
  });

  secretVersions[key] = version;

  // Grant service account access to secret
  new gcp.secretmanager.SecretIamMember(`${secretName}-access`, {
    project: projectId,
    secretId: secret.secretId,
    role: 'roles/secretmanager.secretAccessor',
    member: pulumi.interpolate`serviceAccount:${serviceAccount.email}`,
  });
});

// Build and push Docker image to GCR
const imageName = `gcr.io/${projectId}/${baseName}`;

// Use timestamp-based tag to force rebuild on every deployment
const imageTag = `v${Date.now()}`;

const image = new docker.Image('autotune-image', {
  build: {
    context: path.resolve(__dirname, '../../..'),
    dockerfile: path.resolve(__dirname, '../../../Dockerfile'),
    platform: 'linux/amd64',
  },
  imageName: pulumi.interpolate`${imageName}:${imageTag}`,
  // Skip registry config - assumes Docker is already authenticated with GCR
  // Run: gcloud auth configure-docker before pulumi up
}, { dependsOn: [computeApi] });

// Create startup script that pulls and runs container
// Only fetches 2 secrets (RPC_URL and PRIVATE_KEY) - all other config is in staticConfig.ts
const startupScript = pulumi.all([image.imageName, ...Object.keys(secrets)]).apply(
  ([imageNameValue, ...secretKeys]) => `#!/bin/bash
set -e

echo "🚀 Starting auto-tune deployment"

# Install Docker
if ! command -v docker &> /dev/null; then
    echo "📦 Installing Docker..."
    curl -fsSL https://get.docker.com -o get-docker.sh
    sh get-docker.sh
    rm get-docker.sh
fi

# Configure Docker for GCR
gcloud auth configure-docker --quiet

# Pull image
echo "⬇️  Pulling image: ${imageNameValue}"
docker pull ${imageNameValue}

# Stop existing container
docker stop autotune 2>/dev/null || true
docker rm autotune 2>/dev/null || true

# Create data directory
mkdir -p /var/lib/autotune/data
chmod 700 /var/lib/autotune/data

# Fetch only 2 secrets from Secret Manager (RPC_URL and PRIVATE_KEY)
echo "🔑 Fetching 2 secrets from GCP Secret Manager..."
ENV_FILE="/tmp/.env.autotune"
rm -f \${ENV_FILE}

${secretKeys.map((key: string) => {
  const secretName = `autotune-${key.toLowerCase().replace(/_/g, '-')}`;
  return `echo "${key}=$(gcloud secrets versions access latest --secret=${secretName})" >> \${ENV_FILE}`;
}).join('\n')}

# Set NODE_ENV=production to use static config
echo "NODE_ENV=production" >> \${ENV_FILE}

chmod 600 \${ENV_FILE}

echo "✅ Secrets loaded: ${secretKeys.join(', ')}"
echo "✅ All other config loaded from staticConfig.ts"

# Run container
echo "🐳 Starting container..."
docker run -d \\
    --name autotune \\
    --restart unless-stopped \\
    --env-file \${ENV_FILE} \\
    -v /var/lib/autotune/data:/app/data \\
    --log-driver=gcplogs \\
    ${imageNameValue}

rm -f \${ENV_FILE}

echo "✅ Auto-tune started successfully!"
docker logs -f autotune
`
);

// Create Compute Engine instance
const instance = new gcp.compute.Instance('autotune-vm', {
  name: baseName,
  zone: zone,
  machineType: machineType,

  bootDisk: {
    initializeParams: {
      image: 'debian-cloud/debian-12',
      size: diskSize,
      type: 'pd-standard',
    },
  },

  networkInterfaces: [{
    network: 'default',
    // No external IP to save costs - use IAP for SSH
    accessConfigs: [{
      // Uncomment for external IP (not recommended for security)
      // natIp: '',
    }],
  }],

  serviceAccount: {
    email: serviceAccount.email,
    scopes: ['cloud-platform'],
  },

  metadataStartupScript: startupScript,

  tags: ['autotune-bot'],

  labels: {
    app: 'autotune',
    managed: 'pulumi',
  },
}, {
  dependsOn: [
    computeApi,
    serviceAccount,
    image,
    loggingBinding,
    storageBinding,
    artifactRegistryBinding,
    ...Object.values(secretVersions),
  ],
});

// Create billing budget with email alerts
// This prevents automatic billing beyond free tier - you'll get alerts instead
let budget: gcp.billing.Budget | undefined;

if (billingAccountId && budgetAlertEmails) {
  budget = new gcp.billing.Budget('autotune-budget', {
    billingAccount: billingAccountId,
    displayName: `${baseName} Budget Alert`,

    budgetFilter: {
      projects: [`projects/${projectId}`],
      // Only alert on the specific project to avoid false positives
    },

    amount: {
      specifiedAmount: {
        currencyCode: 'USD',
        units: budgetAmountUsd.toString(),
      },
    },

    thresholdRules: [
      {
        thresholdPercent: 0.5,  // Alert at 50% of budget ($0.50)
        spendBasis: 'CURRENT_SPEND',
      },
      {
        thresholdPercent: 0.9,  // Alert at 90% of budget ($0.90)
        spendBasis: 'CURRENT_SPEND',
      },
      {
        thresholdPercent: 1.0,  // Alert at 100% of budget ($1.00)
        spendBasis: 'CURRENT_SPEND',
      },
    ],

    allUpdatesRule: {
      monitoringNotificationChannels: budgetAlertEmails.split(',').map(email => {
        const channel = new gcp.monitoring.NotificationChannel(`email-${email.trim()}`, {
          displayName: `Budget Alert - ${email.trim()}`,
          type: 'email',
          labels: {
            email_address: email.trim(),
          },
        });
        return channel.id;
      }),
      disableDefaultIamRecipients: false,
    },
  }, { dependsOn: [billingBudgetsApi] });
}

// Outputs
export const instanceName = instance.name;
export const instanceZone = instance.zone;
export const instanceMachineType = instance.machineType;
export const serviceAccountEmail = serviceAccount.email;
export const dockerImage = image.imageName;
export const secretCount = Object.keys(secrets).length;

// Helpful commands
export const sshCommand = pulumi.interpolate`gcloud compute ssh ${instance.name} --zone=${zone}`;
export const logsCommand = pulumi.interpolate`gcloud compute ssh ${instance.name} --zone=${zone} --command='docker logs -f autotune'`;
export const startupLogsCommand = pulumi.interpolate`gcloud compute ssh ${instance.name} --zone=${zone} --command='sudo journalctl -u google-startup-scripts.service -n 100 --no-pager'`;
export const stopCommand = pulumi.interpolate`gcloud compute instances stop ${instance.name} --zone=${zone}`;
export const startCommand = pulumi.interpolate`gcloud compute instances start ${instance.name} --zone=${zone}`;
export const restartCommand = pulumi.interpolate`gcloud compute instances reset ${instance.name} --zone=${zone}`;

// Billing budget outputs (only if budget was created)
export const budgetName = budget ? budget.displayName : 'Not configured (set budgetAlertEmails and billingAccountId)';
export const budgetThreshold = budget ? pulumi.interpolate`$${budgetAmountUsd} USD` : 'Not configured';
export const budgetEnabled = budget ? 'true' : 'false';

// Don't use pulumi.log.info with Output values - they'll be shown in stack outputs instead
