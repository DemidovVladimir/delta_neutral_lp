#!/usr/bin/env bash
# Memecoin collector control: start | stop | restart | status | tail
#   bash research/memecoins/collector/ctl.sh start [collector flags...]
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
DATA="$(cd "$HERE/.." && pwd)/data"
PID="$DATA/collector.pid"; STOP="$DATA/collector.stop"; LOG="$DATA/collector.log"; DB="$DATA/memecoins.db"
mkdir -p "$DATA"
running() { [ -f "$PID" ] && kill -0 "$(cat "$PID")" 2>/dev/null; }
case "${1:-status}" in
  start)
    shift
    if running; then echo "already running (supervisor pid $(cat "$PID"))"; exit 0; fi
    rm -f "$STOP"
    cd "$HERE" || exit 1
    nohup bash "$HERE/run-loop.sh" "$@" >> "$DATA/collector.out" 2>&1 &
    echo $! > "$PID"
    sleep 3
    if running; then echo "started: supervisor pid $(cat "$PID"), node pid $(cat "$DATA/collector.lock" 2>/dev/null)"; echo "log: $LOG"; else echo "failed to start — see $DATA/collector.out"; exit 1; fi
    ;;
  stop)
    if ! running; then echo "not running"; rm -f "$PID"; exit 0; fi
    touch "$STOP"; kill -TERM "$(cat "$PID")"
    for _ in $(seq 1 30); do running || break; sleep 1; done
    if running; then echo "still running after 30 s; kill -9 $(cat "$PID") and node pid $(cat "$DATA/collector.lock" 2>/dev/null) if needed"; exit 1; fi
    rm -f "$PID"; echo "stopped"
    ;;
  status)
    if running; then echo "RUNNING supervisor pid $(cat "$PID"), node pid $(cat "$DATA/collector.lock" 2>/dev/null)"; else echo "NOT RUNNING"; fi
    [ -f "$LOG" ] && { echo "--- last heartbeat:"; grep ' HB ' "$LOG" | tail -n 1 | cut -c1-900; echo "--- last non-heartbeat lines:"; grep -v ' HB ' "$LOG" | tail -n 5 | cut -c1-300; }
    if [ -f "$DB" ] && command -v sqlite3 >/dev/null; then
      echo "--- db ($(du -h "$DB" | cut -f1) + wal $(du -h "$DB-wal" 2>/dev/null | cut -f1)):"
      sqlite3 "$DB" "SELECT 'trades(max rowid)', max(rowid) FROM trades; SELECT 'tokens', count(*) FROM tokens; SELECT 'migrations', count(*) FROM migrations; SELECT 'pools', count(*) FROM pools; SELECT 'gaps', count(*), coalesce(sum(to_slot-from_slot),0) || ' slots', sum(fill_status LIKE 'filled%') || ' filled' FROM gaps; SELECT 'last trade ts', datetime(max(ts),'unixepoch') FROM trades WHERE rowid > (SELECT max(rowid) - 1000 FROM trades); SELECT 'tracked pools (polling now)', count(*), sum(logs_status LIKE 'armed%') || ' armed-before-migration' FROM tracked_pools WHERE poll_until > strftime('%s','now')*1000; SELECT 'pool_states rows', count(*) FROM pool_states; SELECT 'audit', datetime(at/1000,'unixepoch'), substr(venue,1,12), matched || '/' || chain_events, round(pct,2) || '%', endpoint FROM audits ORDER BY at DESC LIMIT 5;" 2>&1
    fi
    ;;
  restart)
    # mainnet-beta answered HTTP 413 to immediate reconnects after a stop; a 30 s pause avoids the fallback detour
    shift; bash "$0" stop && sleep 30 && bash "$0" start "$@" ;;
  bf-start)
    # historical backfill job (resumable): bash ctl.sh bf-start --job=pump7d --from-time=2026-09-18T00:00:00Z [--workers=4 --max-mbps=8 --max-credits=2600000]
    shift; JOBN=$(printf '%s\n' "$@" | sed -n 's/^--job=//p'); JOBN=${JOBN:-pump7d}
    if [ -f "$DATA/backfill-$JOBN.pid" ] && kill -0 "$(cat "$DATA/backfill-$JOBN.pid")" 2>/dev/null; then echo "backfill $JOBN already running (pid $(cat "$DATA/backfill-$JOBN.pid"))"; exit 0; fi
    cd "$HERE" || exit 1
    nohup node --import tsx "$HERE/backfill-job.ts" "$@" >> "$DATA/backfill-$JOBN.out" 2>&1 &
    sleep 5; echo "backfill $JOBN started (pid $(cat "$DATA/backfill-$JOBN.pid" 2>/dev/null)); log: $DATA/backfill-$JOBN.log" ;;
  bf-stop)
    JOBN=${2:-pump7d}; if [ -f "$DATA/backfill-$JOBN.pid" ]; then kill -TERM "$(cat "$DATA/backfill-$JOBN.pid")" && echo "stop signal sent to backfill $JOBN (it saves its cursor and exits; resume with bf-start --job=$JOBN)"; else echo "backfill $JOBN not running"; fi ;;
  bf-status)
    JOBN=${2:-pump7d}
    if [ -f "$DATA/backfill-$JOBN.pid" ] && kill -0 "$(cat "$DATA/backfill-$JOBN.pid")" 2>/dev/null; then echo "backfill $JOBN RUNNING (pid $(cat "$DATA/backfill-$JOBN.pid"))"; else echo "backfill $JOBN not running"; fi
    grep PROGRESS "$DATA/backfill-$JOBN.log" 2>/dev/null | tail -n 1 | cut -c1-600
    sqlite3 "$DB" "SELECT name, status, credits, txs, trades, round(wire_bytes/1e9,2) || ' GB wire', round(raw_bytes/1e9,2) || ' GB raw' FROM backfill_jobs WHERE name = '$JOBN';" 2>&1 ;;
  tail) tail -n "${2:-20}" "$LOG" ;;
  *) echo "usage: ctl.sh start|stop|restart|status|tail [n]|bf-start [args]|bf-stop [job]|bf-status [job]"; exit 2 ;;
esac
