#!/usr/bin/env bash
# Provision a Hetzner Cloud server for the bot (one-time).
#
# Requires: the hcloud CLI (`brew install hcloud`) and an API token from the
# Hetzner console (Project → Security → API tokens, read+write), either in
# HCLOUD_TOKEN or an active `hcloud context`.
#
# Creates a small shared-vCPU server with Docker preinstalled via cloud-init,
# then prints the IP to put into deploy/hetzner/host.env. Skip this script
# entirely if you already have a server — deploy.sh only needs SSH + Docker.
#
# Usage:
#   HCLOUD_TOKEN=... bash deploy/hetzner/provision.sh [server-name]
#   SERVER_TYPE=cpx11 LOCATION=nbg1 bash deploy/hetzner/provision.sh
#
# HCLOUD_TOKEN may also live in deploy/hetzner/host.env (gitignored).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -f "${SCRIPT_DIR}/host.env" ]]; then
  # shellcheck disable=SC1091
  source "${SCRIPT_DIR}/host.env"
fi
export HCLOUD_TOKEN="${HCLOUD_TOKEN:-}"
if [[ -z "${HCLOUD_TOKEN}" ]] && ! hcloud context active >/dev/null 2>&1; then
  echo "ERROR: no HCLOUD_TOKEN (env or deploy/hetzner/host.env) and no active hcloud context." >&2
  exit 1
fi

SERVER_NAME="${1:-delta-bot}"
SERVER_TYPE="${SERVER_TYPE:-cx22}"     # 2 vCPU / 4 GB, ~€4/mo. Alternative: cpx11 (AMD).
LOCATION="${LOCATION:-fsn1}"           # fsn1 Falkenstein, nbg1 Nuremberg, hel1 Helsinki
IMAGE="${IMAGE:-ubuntu-24.04}"
SSH_PUBKEY="${SSH_PUBKEY:-${HOME}/.ssh/id_ed25519.pub}"

if ! command -v hcloud >/dev/null 2>&1; then
  echo "ERROR: hcloud CLI not found. Install it: brew install hcloud" >&2
  exit 1
fi
if [[ ! -f "${SSH_PUBKEY}" ]]; then
  echo "ERROR: SSH public key not found at ${SSH_PUBKEY} (override with SSH_PUBKEY=...)" >&2
  exit 1
fi

# Upload the SSH key if this project doesn't have it yet (idempotent by name).
KEY_NAME="delta-bot-$(whoami)"
if ! hcloud ssh-key describe "${KEY_NAME}" >/dev/null 2>&1; then
  hcloud ssh-key create --name "${KEY_NAME}" --public-key-from-file "${SSH_PUBKEY}"
fi

# Docker via cloud-init; key-only SSH; a data dir the compose volume mounts into.
USER_DATA=$(cat <<'EOF'
#cloud-config
package_update: true
packages:
  - ca-certificates
  - curl
  - git
runcmd:
  - curl -fsSL https://get.docker.com | sh
  - systemctl enable --now docker
  - mkdir -p /opt/delta-bot/data
  - sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
  - systemctl reload ssh || systemctl reload sshd
EOF
)

hcloud server create \
  --name "${SERVER_NAME}" \
  --type "${SERVER_TYPE}" \
  --location "${LOCATION}" \
  --image "${IMAGE}" \
  --ssh-key "${KEY_NAME}" \
  --user-data "${USER_DATA}"

IP=$(hcloud server ip "${SERVER_NAME}")
echo
echo "✅ Server '${SERVER_NAME}' created: ${IP}"
echo
echo "Next steps:"
echo "  1. echo 'HETZNER_HOST=${IP}' >> deploy/hetzner/host.env   (copy host.env.example first)"
echo "  2. Wait ~2 minutes for cloud-init to finish installing Docker:"
echo "     ssh root@${IP} 'cloud-init status --wait && docker --version'"
echo "  3. pnpm deploy:hetzner"
