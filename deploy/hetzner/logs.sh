#!/usr/bin/env bash
# Follow the bot's logs on the Hetzner server. Usage: pnpm logs:hetzner
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
require_host
exec ssh "${ssh_args[@]}" -t "${HETZNER_USER}@${HETZNER_HOST}" \
  "cd ${REMOTE_DIR} && docker compose logs -f --tail=200"
