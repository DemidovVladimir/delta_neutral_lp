#!/usr/bin/env bash
# Shared config loader for the Hetzner deploy scripts.
#
# Server coordinates come from deploy/hetzner/host.env (gitignored) or the
# environment. Copy host.env.example to host.env and fill it in once.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

if [[ -f "${SCRIPT_DIR}/host.env" ]]; then
  # shellcheck disable=SC1091
  source "${SCRIPT_DIR}/host.env"
fi

HETZNER_HOST="${HETZNER_HOST:-}"
HETZNER_USER="${HETZNER_USER:-root}"
HETZNER_SSH_KEY="${HETZNER_SSH_KEY:-}"
REMOTE_DIR="${REMOTE_DIR:-/opt/delta-bot}"

ssh_args=()
if [[ -n "${HETZNER_SSH_KEY}" ]]; then
  ssh_args+=(-i "${HETZNER_SSH_KEY}")
fi

require_host() {
  if [[ -z "${HETZNER_HOST}" ]]; then
    echo "ERROR: HETZNER_HOST is not set." >&2
    echo "Copy deploy/hetzner/host.env.example to deploy/hetzner/host.env and fill it in," >&2
    echo "or export HETZNER_HOST=<server-ip>." >&2
    exit 1
  fi
}

remote() {
  ssh "${ssh_args[@]}" "${HETZNER_USER}@${HETZNER_HOST}" "$@"
}
