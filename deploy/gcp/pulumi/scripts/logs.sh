#!/bin/bash
# Quick script to view auto-tune logs

set -e

# Get VM details from Pulumi stack
INSTANCE_NAME=$(pulumi stack output instanceName 2>/dev/null || echo "autotune-prod")
INSTANCE_ZONE=$(pulumi stack output instanceZone 2>/dev/null || echo "europe-west1-b")

echo "📋 Viewing logs for: $INSTANCE_NAME"
echo ""

# Check what type of logs to show
case "${1:-container}" in
  startup)
    echo "📜 Startup script logs:"
    echo ""
    gcloud compute ssh "$INSTANCE_NAME" --zone="$INSTANCE_ZONE" \
      --command='sudo journalctl -u google-startup-scripts.service -n 100 --no-pager'
    ;;

  startup-live)
    echo "📜 Startup script logs (live):"
    echo ""
    gcloud compute ssh "$INSTANCE_NAME" --zone="$INSTANCE_ZONE" \
      --command='sudo journalctl -u google-startup-scripts.service -f'
    ;;

  container|*)
    echo "🐳 Container logs (live):"
    echo ""
    gcloud compute ssh "$INSTANCE_NAME" --zone="$INSTANCE_ZONE" \
      --command='docker logs -f autotune 2>&1'
    ;;
esac
