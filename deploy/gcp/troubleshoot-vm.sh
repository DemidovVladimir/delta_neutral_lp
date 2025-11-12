#!/bin/bash
# Troubleshooting script for auto-tune VM deployment
# Run this on the GCP VM to diagnose issues

echo "==================================="
echo "Auto-Tune VM Troubleshooting"
echo "==================================="
echo ""

echo "1. Docker Installation Check:"
echo "-----------------------------------"
docker --version
echo ""

echo "2. All Containers (including stopped):"
echo "-----------------------------------"
docker ps -a
echo ""

echo "3. Docker Images:"
echo "-----------------------------------"
docker images
echo ""

echo "4. Startup Script Status:"
echo "-----------------------------------"
sudo systemctl status google-startup-scripts.service --no-pager
echo ""

echo "5. Startup Script Logs (last 50 lines):"
echo "-----------------------------------"
sudo journalctl -u google-startup-scripts.service -n 50 --no-pager
echo ""

echo "6. Container Logs (if container exists):"
echo "-----------------------------------"
if docker ps -a | grep -q autotune; then
    echo "Container exists, showing logs:"
    docker logs autotune 2>&1 | tail -100
else
    echo "Container 'autotune' not found"
fi
echo ""

echo "7. Data Directory:"
echo "-----------------------------------"
ls -la /var/lib/autotune/data/ 2>&1 || echo "Data directory doesn't exist"
echo ""

echo "8. Environment File Check:"
echo "-----------------------------------"
if [ -f /tmp/.env.autotune ]; then
    echo "Environment file exists (showing variable names only):"
    grep -E '^[A-Z_]+=.' /tmp/.env.autotune | cut -d= -f1 | sort
else
    echo "Environment file not found at /tmp/.env.autotune"
fi
echo ""

echo "9. GCR Authentication:"
echo "-----------------------------------"
gcloud auth list
echo ""

echo "10. Disk Space:"
echo "-----------------------------------"
df -h
echo ""

echo "11. Memory Usage:"
echo "-----------------------------------"
free -h
echo ""

echo "==================================="
echo "Troubleshooting Complete"
echo "==================================="
