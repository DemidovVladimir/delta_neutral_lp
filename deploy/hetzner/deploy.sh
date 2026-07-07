#!/usr/bin/env bash
# Deploy (or redeploy) the bot to the Hetzner server. Idempotent.
#
# 1. rsync the source tree to $REMOTE_DIR (node_modules/data/.git excluded)
# 2. upload the env file as $REMOTE_DIR/.env (mode 0600)
# 3. docker compose up -d --build on the server
#
# Env file resolution: .env.hetzner in the repo root if present, else .env
# (with a loud warning — your local .env may hold dev-oriented settings).
# Override with ENV_FILE=path.
#
# Usage: pnpm deploy:hetzner        (or: bash deploy/hetzner/deploy.sh)
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
require_host

ENV_FILE="${ENV_FILE:-}"
if [[ -z "${ENV_FILE}" ]]; then
  if [[ -f "${REPO_ROOT}/.env.hetzner" ]]; then
    ENV_FILE="${REPO_ROOT}/.env.hetzner"
  elif [[ -f "${REPO_ROOT}/.env" ]]; then
    ENV_FILE="${REPO_ROOT}/.env"
    echo "⚠️  No .env.hetzner found — uploading your local .env verbatim." >&2
    echo "    Create .env.hetzner for server-specific config (recommended)." >&2
  else
    echo "ERROR: no .env.hetzner or .env found to upload." >&2
    exit 1
  fi
fi

echo "→ Syncing source to ${HETZNER_USER}@${HETZNER_HOST}:${REMOTE_DIR}"
# The container runs as the unprivileged `node` user (uid 1000); the
# bind-mounted data dir must be writable by it or every state save EACCESes.
remote "mkdir -p ${REMOTE_DIR}/data && chown -R 1000:1000 ${REMOTE_DIR}/data"
# --exclude 'watchdog.env': the server-only alert secrets sit at the target
# root and are NOT in the repo — without this exclude, --delete removes them
# (BUG-016: the 2026-07-07 deploys silently wiped the watchdog script + env,
# alerts were dead ~35 min). The watchdog SCRIPT is no longer copied to the
# root: root cron runs the repo copy deploy/hetzner/watchdog.sh directly, so
# every deploy refreshes it.
rsync -az --delete \
  -e "ssh ${ssh_args[*]:-}" \
  --exclude node_modules \
  --exclude .git \
  --exclude data \
  --exclude target \
  --exclude '.env*' \
  --exclude 'watchdog.env' \
  --exclude 'deploy/hetzner/host.env' \
  "${REPO_ROOT}/" "${HETZNER_USER}@${HETZNER_HOST}:${REMOTE_DIR}/"

echo "→ Uploading env file ($(basename "${ENV_FILE}")) as .env (0600)"
# Stamp the deployed commit into STRATEGY_VERSION: the image has no .git
# (rsync excludes it), and pnl.db rows group by this version.
GIT_HASH=$(git -C "${REPO_ROOT}" rev-parse --short HEAD 2>/dev/null || echo unknown)
TMP_ENV=$(mktemp)
trap 'rm -f "${TMP_ENV}"' EXIT
grep -v '^STRATEGY_VERSION=' "${ENV_FILE}" > "${TMP_ENV}" || true
echo "STRATEGY_VERSION=${GIT_HASH}" >> "${TMP_ENV}"
scp "${ssh_args[@]}" -q "${TMP_ENV}" "${HETZNER_USER}@${HETZNER_HOST}:${REMOTE_DIR}/.env"
remote "chmod 600 ${REMOTE_DIR}/.env"

echo "→ Building + starting the container"
remote "cd ${REMOTE_DIR} && docker compose up -d --build"

echo "→ Container status"
remote "cd ${REMOTE_DIR} && docker compose ps"

echo
echo "✅ Deployed. Follow logs with: pnpm logs:hetzner"
