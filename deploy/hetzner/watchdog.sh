#!/usr/bin/env bash
# Host-level liveness watchdog for the delta-neutral bot (BUG-014 response:
# the bot crash-looped for 15h on RPC quota exhaustion and nobody was told).
#
# Installed by deploy/hetzner/install-watchdog.sh as a root cron job:
#   */5 * * * *  /opt/delta-bot/watchdog.sh
#   5 8 * * *    /opt/delta-bot/watchdog.sh --heartbeat
#
# Alerts go to any configured channel: an ntfy.sh push topic (free, no
# account; subscribe at https://ntfy.sh/<topic>) and/or a Telegram bot
# (sendMessage to a fixed chat_id). All channel credentials are secrets —
# they live ONLY in /opt/delta-bot/watchdog.env on the server
# (NTFY_TOPIC=... / TELEGRAM_BOT_TOKEN=... / TELEGRAM_CHAT_ID=...),
# never in the repo.
set -u

BOT_DIR=/opt/delta-bot
cd "$BOT_DIR" || exit 1

NTFY_TOPIC=""
TELEGRAM_BOT_TOKEN=""
TELEGRAM_CHAT_ID=""
[ -f "$BOT_DIR/watchdog.env" ] && . "$BOT_DIR/watchdog.env"
if [ -z "$NTFY_TOPIC" ] && { [ -z "$TELEGRAM_BOT_TOKEN" ] || [ -z "$TELEGRAM_CHAT_ID" ]; }; then
  echo "$(date -u +%FT%TZ) no alert channel configured — create /opt/delta-bot/watchdog.env" >&2
  exit 1
fi

STATE_FILE="$BOT_DIR/data/watchdog.state"
LOG_FILE="$BOT_DIR/data/watchdog.log"
REALERT_SECS=3600   # while broken, re-alert at most once an hour
NOW=$(date +%s)

# keep our own log small
if [ -f "$LOG_FILE" ] && [ "$(stat -c %s "$LOG_FILE" 2>/dev/null || echo 0)" -gt 1048576 ]; then
  : > "$LOG_FILE"
fi

notify() { # $1 = priority, $2 = message
  if [ -n "$NTFY_TOPIC" ]; then
    curl -s -m 10 -H "Title: delta-bot @ $(hostname)" -H "Priority: $1" \
      -d "$2" "https://ntfy.sh/${NTFY_TOPIC}" >/dev/null 2>&1
  fi
  if [ -n "$TELEGRAM_BOT_TOKEN" ] && [ -n "$TELEGRAM_CHAT_ID" ]; then
    curl -s -m 10 "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
      --data-urlencode "chat_id=${TELEGRAM_CHAT_ID}" \
      --data-urlencode "text=delta-bot @ $(hostname): $2" >/dev/null 2>&1
  fi
}

state_get() { grep "^$1=" "$STATE_FILE" 2>/dev/null | head -1 | cut -d= -f2-; }

cid=$(docker compose ps -q 2>/dev/null | head -1)
restarts=-1
problems=""

if [ -z "$cid" ]; then
  problems="контейнер не запущен;"
else
  status=$(docker inspect -f '{{.State.Status}}' "$cid" 2>/dev/null || echo unknown)
  [ "$status" != "running" ] && problems="${problems}контейнер в статусе ${status};"

  restarts=$(docker inspect -f '{{.RestartCount}}' "$cid" 2>/dev/null || echo -1)
  prev_restarts=$(state_get restarts)
  if [ -n "$prev_restarts" ] && [ "$restarts" -gt "$prev_restarts" ] 2>/dev/null; then
    problems="${problems}рестарты контейнера: ${prev_restarts} → ${restarts};"
  fi

  logs10m=$(docker compose logs --since 10m 2>/dev/null)
  cycles=$(printf '%s' "$logs10m" | grep -c "check cycle completed")
  errors=$(printf '%s' "$logs10m" | grep -c "error")
  quota=$(printf '%s' "$logs10m" | grep -c "max usage reached")

  [ "$cycles" -eq 0 ] && problems="${problems}0 завершённых циклов за 10 мин — бот стоит;"
  [ "$quota" -gt 0 ] && problems="${problems}RPC отвечает 'max usage reached' (квота исчерпана!);"
  [ "$errors" -gt 20 ] && [ "$quota" -eq 0 ] && problems="${problems}${errors} строк с error за 10 мин;"
fi

# independent signal: the loop persists state every cycle
if [ -f "$BOT_DIR/data/auto-tune-state.json" ]; then
  age=$(( NOW - $(stat -c %Y "$BOT_DIR/data/auto-tune-state.json" 2>/dev/null || echo 0) ))
  [ "$age" -gt 600 ] && problems="${problems}auto-tune-state.json не обновлялся ${age}с;"
fi

# ── heartbeat mode: one quiet daily "still alive" push ──────────────────────
if [ "${1:-}" = "--heartbeat" ]; then
  if [ -z "$problems" ]; then
    iter=$(grep -o '"iteration":[0-9]*' "$BOT_DIR/data/auto-tune-state.json" 2>/dev/null | head -1 | cut -d: -f2)
    notify default "💚 живой: итерация ${iter:-?}, рестартов ${restarts}, проблем нет"
  fi
  exit 0
fi

# ── alert with dedup + recovery message ─────────────────────────────────────
prev_status=$(state_get status)
last_alert=$(state_get last_alert); last_alert=${last_alert:-0}

if [ -n "$problems" ]; then
  echo "$(date -u +%FT%TZ) BAD: $problems" >> "$LOG_FILE"
  if [ "$prev_status" != "bad" ] || [ $(( NOW - last_alert )) -ge "$REALERT_SECS" ]; then
    notify urgent "🔴 ${problems}"
    last_alert=$NOW
  fi
  new_status=bad
else
  if [ "$prev_status" = "bad" ]; then
    notify default "✅ восстановился: циклы идут, ошибок нет"
    echo "$(date -u +%FT%TZ) RECOVERED" >> "$LOG_FILE"
  fi
  new_status=ok
fi

{
  echo "status=$new_status"
  echo "restarts=$restarts"
  echo "last_alert=$last_alert"
} > "$STATE_FILE"
