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
breach_rule=""
recovered_rule=""

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
  # Vitals breaches (operator standing order 2026-07-07): the bot logs
  # 🚨 VITALS BREACH when perp notional exceeds the auto-cap, 24h hedge churn
  # exceeds 3× the cap, or LP value drops below half its creation deposit.
  # The first line of any breach is pushed verbatim.
  vitals=$(printf '%s' "$logs10m" | grep "VITALS BREACH" | head -1)
  # A6: the bot logs ✅ VITALS recovered when a latched breach releases
  # (VitalsLatch «двойной порог») — push it at LOW priority so episodes
  # close on the operator's phone too. Informational: never touches the
  # bad/ok state. Deduped via the state file (the 10m log window overlaps
  # two 5-min cron runs — without memory the same line would push twice).
  recovered=$(printf '%s' "$logs10m" | grep "VITALS recovered" | head -1)

  # 2026-07-10: a latched breach is SILENT while it holds — the breach line
  # ages out of the 10m window long before the condition clears, and the
  # watchdog used to push «✅ восстановился» while the metric was still bad
  # (wallet-reserve episode, 02:05Z). Track open episodes by rule text in the
  # state file; only the bot's explicit «✅ VITALS recovered» line closes one.
  [ -n "$vitals" ] && breach_rule=$(printf '%s' "$vitals" | sed -n 's/.*VITALS BREACH — \([^{]*\){.*/\1/p' | sed 's/ *$//')
  [ -n "${recovered:-}" ] && recovered_rule=$(printf '%s' "$recovered" | sed -n 's/.*VITALS recovered — \([^{]*\){.*/\1/p' | sed 's/ *$//')

  [ "$cycles" -eq 0 ] && problems="${problems}0 завершённых циклов за 10 мин — бот стоит;"
  [ "$quota" -gt 0 ] && problems="${problems}RPC отвечает 'max usage reached' (квота исчерпана!);"
  [ "$errors" -gt 20 ] && [ "$quota" -eq 0 ] && problems="${problems}${errors} строк с error за 10 мин;"
  [ -n "$vitals" ] && problems="${problems}${vitals};"
fi

# independent signal: the loop persists state every cycle
if [ -f "$BOT_DIR/data/auto-tune-state.json" ]; then
  age=$(( NOW - $(stat -c %Y "$BOT_DIR/data/auto-tune-state.json" 2>/dev/null || echo 0) ))
  [ "$age" -gt 600 ] && problems="${problems}auto-tune-state.json не обновлялся ${age}с;"
fi

# the daily hodl cron (00:17Z) must append a row — it shares the bot's RPC
# key and died silently with it in BUG-014; 25h staleness = the срез series
# has a hole RIGHT NOW.
if [ -f "$BOT_DIR/data/hodl-history.jsonl" ]; then
  hodl_age=$(( NOW - $(stat -c %Y "$BOT_DIR/data/hodl-history.jsonl" 2>/dev/null || echo 0) ))
  [ "$hodl_age" -gt 90000 ] && problems="${problems}hodl-history.jsonl не обновлялся $((hodl_age/3600))ч — дневной срез не пишется;"
fi

# ── open-vitals-episode ledger (2026-07-10) ─────────────────────────────────
# vitals_open holds `|`-separated rule texts of latched breaches whose
# recovery line has not been seen yet. A breach opens an episode; ONLY the
# bot's «✅ VITALS recovered — <rule>» line closes it.
vitals_open=$(state_get vitals_open)
if [ -n "$breach_rule" ] && ! printf '%s' "$vitals_open" | grep -qF "$breach_rule"; then
  vitals_open="${vitals_open:+$vitals_open|}$breach_rule"
fi
if [ -n "$recovered_rule" ] && [ -n "$vitals_open" ]; then
  vitals_open=$(printf '%s' "$vitals_open" | tr '|' '\n' | grep -vF "$recovered_rule" | paste -sd'|' -)
fi

# ── heartbeat mode: one quiet daily "still alive" push ──────────────────────
if [ "${1:-}" = "--heartbeat" ]; then
  if [ -z "$problems" ]; then
    iter=$(grep -o '"iteration":[0-9]*' "$BOT_DIR/data/auto-tune-state.json" 2>/dev/null | head -1 | cut -d: -f2)
    if [ -n "$vitals_open" ]; then
      notify default "💛 живой: итерация ${iter:-?}, рестартов ${restarts}; тревога ещё держится: ${vitals_open}"
    else
      notify default "💚 живой: итерация ${iter:-?}, рестартов ${restarts}, проблем нет"
    fi
  fi
  # persist the episode ledger even on heartbeat runs
  {
    echo "status=$(state_get status)"
    echo "restarts=$restarts"
    echo "last_alert=$(state_get last_alert)"
    echo "recovered=$(state_get recovered)"
    echo "vitals_open=$vitals_open"
  } > "$STATE_FILE"
  exit 0
fi

# ── alert with dedup + recovery message ─────────────────────────────────────
prev_status=$(state_get status)
last_alert=$(state_get last_alert); last_alert=${last_alert:-0}

if [ -n "${recovered:-}" ] && [ "$recovered" != "$(state_get recovered)" ]; then
  notify low "$recovered"
  echo "$(date -u +%FT%TZ) VITALS-RECOVERED pushed" >> "$LOG_FILE"
fi

if [ -n "$problems" ]; then
  echo "$(date -u +%FT%TZ) BAD: $problems" >> "$LOG_FILE"
  if [ "$prev_status" != "bad" ] || [ $(( NOW - last_alert )) -ge "$REALERT_SECS" ]; then
    notify urgent "🔴 ${problems}"
    last_alert=$NOW
  fi
  new_status=bad
else
  if [ "$prev_status" = "bad" ]; then
    if [ -n "$vitals_open" ]; then
      # the 10m log window went quiet but a latched breach never released —
      # do NOT claim recovery (02:05Z 2026-07-10 false «восстановился»)
      notify default "🟡 бот жив (циклы идут), но тревога ещё держится: ${vitals_open}"
      echo "$(date -u +%FT%TZ) OK-BUT-VITALS-OPEN: ${vitals_open}" >> "$LOG_FILE"
    else
      notify default "✅ восстановился: циклы идут, ошибок нет"
      echo "$(date -u +%FT%TZ) RECOVERED" >> "$LOG_FILE"
    fi
  fi
  new_status=ok
fi

{
  echo "status=$new_status"
  echo "restarts=$restarts"
  echo "last_alert=$last_alert"
  echo "recovered=${recovered:-}"
  echo "vitals_open=$vitals_open"
} > "$STATE_FILE"
