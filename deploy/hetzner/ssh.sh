#!/usr/bin/env bash
# SSH into the Hetzner server. Usage: pnpm ssh:hetzner
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
require_host
exec ssh "${ssh_args[@]}" "${HETZNER_USER}@${HETZNER_HOST}"
