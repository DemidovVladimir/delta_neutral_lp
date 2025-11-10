#!/bin/bash
# Script to create GCP Secret Manager secrets from .env file
# Usage: ./create-secrets.sh [env-file-path]

set -e

ENV_FILE="${1:-.env}"
PROJECT_ID=$(gcloud config get-value project)

if [ -z "${PROJECT_ID}" ]; then
    echo "❌ Error: No GCP project configured. Run: gcloud config set project YOUR_PROJECT_ID"
    exit 1
fi

if [ ! -f "${ENV_FILE}" ]; then
    echo "❌ Error: Environment file '${ENV_FILE}' not found"
    exit 1
fi

echo "🔐 Creating secrets in GCP Secret Manager for project: ${PROJECT_ID}"
echo "📄 Reading from: ${ENV_FILE}"
echo ""

# Read env file and create secrets
while IFS='=' read -r key value || [ -n "${key}" ]; do
    # Skip comments and empty lines
    if [[ ${key} =~ ^#.*$ ]] || [ -z "${key}" ]; then
        continue
    fi

    # Trim whitespace
    key=$(echo "${key}" | xargs)
    value=$(echo "${value}" | xargs)

    # Skip if value is empty or placeholder
    if [ -z "${value}" ] || [[ ${value} =~ \<.*\> ]]; then
        echo "⏭️  Skipping ${key} (empty or placeholder)"
        continue
    fi

    # Convert to lowercase and add prefix for secret name
    SECRET_NAME="autotune-$(echo ${key} | tr '[:upper:]' '[:lower:]' | tr '_' '-')"

    # Check if secret already exists
    if gcloud secrets describe "${SECRET_NAME}" --project="${PROJECT_ID}" &>/dev/null; then
        echo "📝 Updating existing secret: ${SECRET_NAME}"
        echo -n "${value}" | gcloud secrets versions add "${SECRET_NAME}" \
            --project="${PROJECT_ID}" \
            --data-file=-
    else
        echo "✨ Creating new secret: ${SECRET_NAME}"
        echo -n "${value}" | gcloud secrets create "${SECRET_NAME}" \
            --project="${PROJECT_ID}" \
            --replication-policy="automatic" \
            --data-file=-
    fi

    echo "✅ ${key} -> ${SECRET_NAME}"

done < "${ENV_FILE}"

echo ""
echo "🎉 All secrets created/updated successfully!"
echo ""
echo "📋 To grant access to a service account:"
echo "   gcloud secrets add-iam-policy-binding autotune-SECRET_NAME \\"
echo "     --member='serviceAccount:SERVICE_ACCOUNT@PROJECT.iam.gserviceaccount.com' \\"
echo "     --role='roles/secretmanager.secretAccessor'"
echo ""
echo "📋 To grant access to a Compute Engine instance:"
echo "   for secret in \$(gcloud secrets list --filter='name:autotune-*' --format='value(name)'); do"
echo "     gcloud secrets add-iam-policy-binding \${secret} \\"
echo "       --member='serviceAccount:INSTANCE_SERVICE_ACCOUNT' \\"
echo "       --role='roles/secretmanager.secretAccessor'"
echo "   done"
