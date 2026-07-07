#!/usr/bin/env bash
# One-command incident snapshot (operator standing order 2026-07-07: every
# alert must be resolvable fast). Read-only: gathers the state needed to
# diagnose ANY vitals/watchdog alert in one pass. Run from the repo root:
#
#   bash scripts/triage.sh            # server-side snapshot (no local RPC)
#   bash scripts/triage.sh --chain    # + local on-chain reads (hedge state, dashboard)
#
# Companion runbooks: .claude/skills/alert-response/SKILL.md
set -u
cd "$(dirname "$0")/.." || exit 1
source deploy/hetzner/lib.sh

echo "══════════════ TRIAGE $(date -u +%FT%TZ) ══════════════"

echo ""
echo "── 1. Container ─────────────────────────────────────────"
remote 'docker inspect delta-neutral-bot --format "status={{.State.Status}} restarts={{.RestartCount}} started={{.State.StartedAt}} oom={{.State.OOMKilled}}" 2>&1 || echo "CONTAINER MISSING"'

echo ""
echo "── 2. VITALS / errors (last 30 min) ─────────────────────"
remote 'cd /opt/delta-bot && docker compose logs --since 30m 2>/dev/null | grep -c "check cycle completed" | xargs -I{} echo "cycles completed: {}"; docker compose logs --since 30m 2>/dev/null | grep "VITALS BREACH" | tail -5; docker compose logs --since 30m 2>/dev/null | grep -iE "error|Failed" | grep -v "bigint" | tail -8'

echo ""
echo "── 3. Last cycle & hedge heartbeat ──────────────────────"
remote 'cd /opt/delta-bot && docker compose logs --since 30m 2>/dev/null | grep -E "Hedge:|Hedge |Position balance|Rebalance|regime|frozen|storm" | tail -12'

echo ""
echo "── 3b. Persistent log (survives deploys/restarts) ───────"
remote 'tail -5 /opt/delta-bot/data/logs/bot.log 2>/dev/null; echo "history depth:"; ls -la /opt/delta-bot/data/logs/ 2>/dev/null | tail -3'

echo ""
echo "── 4. Watchdog & crons ──────────────────────────────────"
remote 'tail -3 /opt/delta-bot/data/watchdog.log 2>/dev/null; cat /opt/delta-bot/data/watchdog.state 2>/dev/null; ls -la /opt/delta-bot/watchdog.env /opt/delta-bot/deploy/hetzner/watchdog.sh 2>&1 | awk "{print \$NF, \$1}"; echo "hodl-history age(h): $(( ( $(date +%s) - $(stat -c %Y /opt/delta-bot/data/hodl-history.jsonl 2>/dev/null || echo 0) ) / 3600 ))"; tail -2 /opt/delta-bot/data/hodl-cron.err 2>/dev/null'

echo ""
echo "── 5. Server disk / mem ─────────────────────────────────"
remote 'df -h / | tail -1; free -m | head -2 | tail -1'

if [ "${1:-}" = "--chain" ]; then
  echo ""
  echo "── 6. On-chain: hedge state (local RPC) ─────────────────"
  pnpm --silent jupiter:read 2>&1 | grep -E "Hedge state|Carry" | tail -4
  echo ""
  echo "── 7. On-chain: full snapshot (local RPC) ───────────────"
  pnpm --silent dashboard --json 2>/dev/null | sed -n '/^{/,$p' | python3 -c '
import json, sys
d = json.load(sys.stdin)
w, lp, h, de = d.get("wallet", {}), d.get("lp", {}), d.get("hedge", {}), d.get("delta", {})
print(f"price: {d.get(\"price\", {}).get(\"solUsd\")}")
print(f"wallet: {w.get(\"sol\")} SOL + {w.get(\"usdc\")} USDC")
print(f"nasha positsiya: {lp.get(\"totalUsd\")} USD (sol {lp.get(\"solAmount\")}, usdc {lp.get(\"usdcAmount\")})")
print(f"short: notional {h.get(\"perpNotionalUsd\")} USD, collateral {h.get(\"totalCollateralUsd\")} USD, liq {h.get(\"liquidationPrice\")}")
print(f"netDelta: {de.get(\"netDeltaSol\")} (band {de.get(\"bandSol\")}, outOfBand {de.get(\"outOfBand\")})")
' || echo "(dashboard snapshot failed — RPC issue? try RPC_URL=https://api.mainnet-beta.solana.com)"
fi

echo ""
echo "── Next steps ───────────────────────────────────────────"
echo "Fresh db pull (ALWAYS both files) for tx-audit / SQL:"
echo "  bash -c 'source deploy/hetzner/lib.sh; scp \"\${ssh_args[@]}\" \"\${HETZNER_USER}@\${HETZNER_HOST}:/opt/delta-bot/data/pnl.db*\" /tmp/'"
echo "Transaction audit of a window:"
echo "  npx tsx scripts/tx-audit.ts --since <ISO> --db /tmp/pnl.db"
echo "Runbooks: .claude/skills/alert-response/SKILL.md"
