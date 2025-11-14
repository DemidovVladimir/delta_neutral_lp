#!/bin/bash
# Auto-tune VM management script
# Usage: ./manage.sh [command]

set -e

cd "$(dirname "$0")/.."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Helper function to get stack outputs
get_output() {
  pulumi stack output "$1" 2>/dev/null || echo ""
}

# Get VM details
INSTANCE_NAME=$(get_output instanceName)
INSTANCE_ZONE=$(get_output instanceZone)

if [ -z "$INSTANCE_NAME" ]; then
  echo -e "${RED}❌ Error: Pulumi stack not found or VM not deployed${NC}"
  echo "Run 'pulumi up' first to deploy the infrastructure"
  exit 1
fi

# Parse command
COMMAND="${1:-help}"

case "$COMMAND" in
  deploy)
    echo -e "${BLUE}🚀 Deploying infrastructure...${NC}"
    pulumi up
    ;;

  restart)
    echo -e "${YELLOW}🔄 Restarting VM and container...${NC}"
    echo ""
    echo "This will reboot the VM and trigger the startup script."
    echo ""
    read -p "Continue? (y/N) " -n 1 -r
    echo ""
    if [[ $REPLY =~ ^[Yy]$ ]]; then
      echo "Rebooting VM..."
      gcloud compute instances reset "$INSTANCE_NAME" --zone="$INSTANCE_ZONE" --quiet

      echo ""
      echo -e "${GREEN}✅ VM restarted!${NC}"
      echo ""
      echo "Wait 2-3 minutes for:"
      echo "  - VM to boot"
      echo "  - Startup script to run"
      echo "  - Docker image to be pulled"
      echo "  - Container to start"
      echo ""
      echo "Then check logs with:"
      echo "  ./scripts/manage.sh logs"
      echo ""
      echo "Or watch startup progress:"
      echo "  ./scripts/manage.sh logs-startup"
    fi
    ;;

  logs)
    echo -e "${BLUE}📋 Viewing container logs (live)...${NC}"
    echo "Press Ctrl+C to exit"
    echo ""
    gcloud compute ssh "$INSTANCE_NAME" --zone="$INSTANCE_ZONE" \
      --command='docker logs -f autotune-prod 2>&1'
    ;;

  logs-startup)
    echo -e "${BLUE}📜 Viewing startup script logs...${NC}"
    echo ""
    gcloud compute ssh "$INSTANCE_NAME" --zone="$INSTANCE_ZONE" \
      --command='sudo journalctl -u google-startup-scripts.service -n 100 --no-pager'
    ;;

  status)
    echo -e "${BLUE}📊 VM and Container Status${NC}"
    echo ""

    # VM status
    VM_STATUS=$(gcloud compute instances describe "$INSTANCE_NAME" --zone="$INSTANCE_ZONE" --format="value(status)")
    echo -e "VM Status: ${GREEN}$VM_STATUS${NC}"

    # Container status
    echo ""
    echo "Container Status:"
    gcloud compute ssh "$INSTANCE_NAME" --zone="$INSTANCE_ZONE" \
      --command='docker ps -a --filter name=autotune --format "table {{.Names}}\t{{.Status}}\t{{.Image}}"' \
      2>/dev/null || echo "  (Unable to connect)"

    # State file
    echo ""
    echo "Auto-tune State:"
    gcloud compute ssh "$INSTANCE_NAME" --zone="$INSTANCE_ZONE" \
      --command='[ -f /var/lib/autotune/data/auto-tune-state.json ] && cat /var/lib/autotune/data/auto-tune-state.json | jq -r "{iteration, rebalanceCount, consecutiveErrors, lastCheck}" 2>/dev/null || echo "  State file not found"' \
      2>/dev/null || echo "  (Unable to read state)"
    ;;

  ssh)
    echo -e "${BLUE}🔌 Connecting to VM via SSH...${NC}"
    gcloud compute ssh "$INSTANCE_NAME" --zone="$INSTANCE_ZONE"
    ;;

  stop)
    echo -e "${YELLOW}⏸️  Stopping VM...${NC}"
    gcloud compute instances stop "$INSTANCE_NAME" --zone="$INSTANCE_ZONE"
    echo -e "${GREEN}✅ VM stopped${NC}"
    ;;

  start)
    echo -e "${GREEN}▶️  Starting VM...${NC}"
    gcloud compute instances start "$INSTANCE_NAME" --zone="$INSTANCE_ZONE"
    echo -e "${GREEN}✅ VM started${NC}"
    ;;

  info)
    echo -e "${BLUE}ℹ️  Infrastructure Information${NC}"
    echo ""
    pulumi stack output
    ;;

  help|*)
    echo "Auto-tune VM Management Script"
    echo ""
    echo "Usage: ./manage.sh [command]"
    echo ""
    echo "Commands:"
    echo "  deploy          - Deploy/update infrastructure with Pulumi"
    echo "  restart         - Restart VM and retrigger startup script"
    echo "  logs            - View live container logs"
    echo "  logs-startup    - View startup script logs (for debugging)"
    echo "  status          - Show VM and container status"
    echo "  ssh             - SSH into the VM"
    echo "  stop            - Stop the VM (saves costs)"
    echo "  start           - Start the VM"
    echo "  info            - Show all Pulumi stack outputs"
    echo "  help            - Show this help message"
    echo ""
    echo "Examples:"
    echo "  ./manage.sh deploy          # Deploy infrastructure"
    echo "  ./manage.sh logs            # Watch live logs"
    echo "  ./manage.sh restart         # Restart VM and container"
    echo "  ./manage.sh status          # Check status"
    ;;
esac
