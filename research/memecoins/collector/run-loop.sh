#!/usr/bin/env bash
# Supervisor for collector.ts: restarts it after a crash, stops for good when
# data/collector.stop exists or on SIGTERM/SIGINT. Started by ctl.sh (nohup).
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
DATA="$(cd "$HERE/.." && pwd)/data"
STOP="$DATA/collector.stop"
cd "$HERE" || exit 1
child=0
quick=0   # consecutive runs that died within 2 minutes -> exponential backoff (15 s .. 10 min)
on_term() {
  touch "$STOP"
  if [ "$child" -ne 0 ]; then kill -TERM "$child" 2>/dev/null; wait "$child" 2>/dev/null; fi
  exit 0
}
trap on_term TERM INT
while [ ! -f "$STOP" ]; do
  started=$(date +%s)
  node --import tsx "$HERE/collector.ts" --log="$DATA/collector.log" "$@" &
  child=$!
  wait "$child"; code=$?
  if [ $(( $(date +%s) - started )) -lt 120 ]; then quick=$(( quick + 1 )); else quick=0; fi
  child=0
  [ -f "$STOP" ] && break
  # 3 = another instance holds the lock, 4 = disk guard tripped: do not restart
  if [ "$code" -eq 3 ] || [ "$code" -eq 4 ]; then
    echo "[$(date -u +%FT%TZ)] collector exited with $code — not restarting" >> "$DATA/collector.log"; break
  fi
  delay=$(( 15 * (1 << (quick > 5 ? 5 : quick)) )); [ "$delay" -gt 600 ] && delay=600
  echo "[$(date -u +%FT%TZ)] collector exited with $code; restarting in $delay s" >> "$DATA/collector.log"
  sleep "$delay" & wait $!
done
