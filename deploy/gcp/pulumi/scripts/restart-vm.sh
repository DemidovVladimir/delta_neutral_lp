#!/bin/bash
# Restart VM and trigger startup script to redeploy container
# This is useful after fixing IAM permissions or updating the Docker image

set -e

# Get VM details from Pulumi stack
INSTANCE_NAME=$(pulumi stack output instanceName)
INSTANCE_ZONE=$(pulumi stack output instanceZone)

echo "🔄 Restarting VM: $INSTANCE_NAME in zone $INSTANCE_ZONE"
echo ""

# Reset startup script flag so it runs again on boot
echo "📝 Resetting startup script flag..."
gcloud compute instances add-metadata "$INSTANCE_NAME" \
  --zone="$INSTANCE_ZONE" \
  --metadata=startup-script-status=NOT_RUN

# Reboot the VM (this will trigger startup script)
echo "🔄 Rebooting VM..."
gcloud compute instances reset "$INSTANCE_NAME" --zone="$INSTANCE_ZONE"

echo ""
echo "✅ VM restarted! Startup script will run automatically."
echo ""
echo "Wait 2-3 minutes for Docker installation and container startup..."
echo ""
echo "📋 To view logs:"
echo "   gcloud compute ssh $INSTANCE_NAME --zone=$INSTANCE_ZONE --command='docker logs -f autotune'"
echo ""
echo "🔍 To check startup progress:"
echo "   gcloud compute ssh $INSTANCE_NAME --zone=$INSTANCE_ZONE --command='sudo journalctl -u google-startup-scripts.service -f'"
