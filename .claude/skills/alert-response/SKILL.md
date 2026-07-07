---
name: alert-response
description: Incident runbooks for every delta-bot alert (ntfy/Telegram push from the watchdog or a VITALS BREACH line). Use IMMEDIATELY when the operator pastes an alert, says "пришёл алерт/пуш", "сработала тревога", quotes a 🔴/🚨 message, or reports the bot looks dead. Triage first (scripts/triage.sh), then follow the matching runbook; live mutations only with explicit operator approval in this conversation.
---

# Alert response — от пуша до починки

## Iron rules (before anything)

1. **Triage first, mutate never (yet):** `bash scripts/triage.sh` (add
   `--chain` if RPC works) — read-only, one pass, ~30s. Paste the relevant
   snapshot lines into your reply so the operator sees the evidence.
2. **One incident = one narrative:** what fired, what the data shows, what
   you did, how you verified. Plain Russian, mechanism first (rule #1),
   «пул» = the shared Meteora pool ONLY; ours is «наша позиция».
3. **Live actions** (anything sending a transaction, restarting the
   container, editing prod .env) need the operator's «да» in THIS
   conversation — unless funds are actively bleeding (LP drain / imminent
   liquidation), in which case act on the safest containment step
   (`docker compose down` stops the loop; it never loses funds) and tell
   the operator what you did and why.
4. **Afterwards, always:** verify the alert stopped (recovery push arrives
   / VITALS line gone from fresh logs / watchdog exit 0), then record the
   incident in progress.md (and bugs.md if it revealed a defect).
5. Known-benign log noise (do NOT treat as incidents): the red banner
   «Imbalance trigger fired but wallet is already 50/50 ±10% — skipping
   alignment swap» (recenter path, informational); `bigint: Failed to load
   bindings` (pure-JS fallback); old 429 lines inside `hodl-cron.err` from
   past quota incidents.

## Emergency commands (memorize, all gated on operator unless bleeding)

```bash
bash -c 'source deploy/hetzner/lib.sh; remote "cd /opt/delta-bot && docker compose down"'   # stop the loop (safe)
bash -c 'source deploy/hetzner/lib.sh; remote "cd /opt/delta-bot && docker compose up -d"'  # start it again
pnpm hedge:emergency --live          # flatten ALL perp sides at any price
pnpm derisk --live [--keep-hedge]    # red button: LP + perps + all SOL → USDC (STOP THE LOOP FIRST)
npx tsx scripts/close-lp.ts --mint <positionMint> --live   # close ONE LP position, nothing else
RPC_URL=https://api.mainnet-beta.solana.com pnpm dashboard --json   # reads when Helius is dead
```

---

## Runbooks by alert text

### 🚨 «LP value more than 5% below its creation deposit»

Meaning: НАША позиция стоит на >5% меньше, чем мы в неё положили
(price-adjusted). Two very different causes — split them FIRST:

1. Triage + `--chain`. Look at composition and range: is the position
   ~100% one token and the price far outside `lowerPrice..upperPrice`?
2. **Deep out of range mid-crash** (composition ~100% SOL, price below the
   range, storm likely active): not theft — the position is a SOL bag
   lagging the recenter. Check the hedge clamped it (netΔ in band, short
   grew). If hedge is in band → machine is doing its job; monitor. If netΔ
   is positive and large → consider `pnpm derisk --live` (operator call).
3. **Tokens actually missing** (position IN range but value gap): worst
   case — treat as key/program compromise. IMMEDIATELY
   `docker compose down`, then `npx tsx scripts/tx-audit.ts --since <last
   known-good ISO> --db <fresh pnl.db>` and find the unexplained
   transaction (no db:* tag). If an unknown signer/destination drained
   funds: `pnpm derisk --live --no-gate` to consolidate what remains into
   USDC, then the operator moves everything to a FRESH wallet. Do not
   restart the bot on a compromised key.

### 🚨 «netΔ out of band for a sustained period»

Meaning: перекос между нашим SOL и шортом держится >15 минут — петля
коррекции не сходится.

1. Triage: find the last hedge_actions rows (pull fresh db):
   `sqlite3 pnl.db "SELECT taken_at, action, blocked_reason, round(net_delta_sol,3) FROM hedge_actions ORDER BY taken_at DESC LIMIT 20"`.
2. Diagnose by what the rows show:
   - `blocked` rows → see the blocked-streak runbook below (same causes).
   - alternating increase/decrease → churn loop: check the band value in
     logs, the clamp/freeze lines (🧊/regime), and wallet SOL swings;
     likely parameter/regime issue — collect evidence, propose, don't
     hot-patch.
   - actions happening but netΔ not converging → keeper fills failing:
     `tx-audit` the window; count `perps keeper TX2 ❌FAILED` — repeated
     failures mean Jupiter-side trouble; consider `pnpm hedge:emergency
     --live` if exposure is dangerous (operator call).
   - NO rows at all → BUG-015 class regression: the hedge is not running.
     Check `Hedge skipped`/hedge heartbeat in logs; escalate as a bug,
     restart the container as mitigation.

### 🚨 «hedge blocked for a sustained streak»

Meaning: бот хочет поправить шорт, но каждый цикл упирается в guard.

1. The `blocked_reason` column says exactly which guard:
   - `collateral` / affordable-size (BUG-013 family): wallet USDC starved.
     Fix paths: unwrap idle wSOL (`tsx src/cli/jupiter-hedge.ts --unwrap`),
     or free USDC by partial short decrease (paradoxically returns
     collateral), or operator tops up USDC. Verify wallet USDC after.
   - `carry cap`: borrow APR above `HEDGE_CARRY_CAP_BPS` — increases
     refused by design. If the exposure is dangerous, the operator decides:
     raise the cap in .env + redeploy, or hedge manually once
     (`pnpm hedge:rebalance --live`).
   - `notional cap`: gross notional at the auto-cap — should not happen
     (headroom-fill exists); treat as a bug, capture state, file it.
   - `cooldown`: normal for ≤10 min after a trade; a STREAK of cooldown
     blocks means trades keep happening — see the churn runbook.

### 🚨 «hedge disabled for this session after 5 consecutive failures»

1. The five errors are in the logs:
   `docker compose logs | grep "Hedge rebalance failed" | tail -5`.
2. Classify: RPC (`max usage reached`, timeouts) → fix the RPC problem
   first; venue (Jupiter API 5xx) → usually transient; logic (simulation
   failed) → read the message, likely a bug to file.
3. The hedge only re-arms on process restart:
   `docker compose restart` (state + cooldown persist). Verify the first
   cycles show the hedge heartbeat again, netΔ in band.
4. While disabled the LP runs UNHEDGED — if the cause needs long
   investigation, consider closing the perp AND the LP together
   (`pnpm derisk`) rather than leaving directional exposure.

### 🚨 «short/long liquidation price too close to spot»

Meaning: цена принудительного закрытия шорта ближе +25% к рынку (пол 1.3×
+ запас).

1. `pnpm jupiter:read` — collateral, notional, entry, liq per side.
2. Options, cheapest first:
   - the controller should be DECREASING the oversized side already —
     check why not (band? blocked? cooldown?);
   - partial close raises the ratio: `pnpm hedge:close --size-usd=<X>`
     (decreases withdraw collateral at the target ratio — compute the
     post-close ratio before sending: newRatio = (collateral −
     X×targetRatio) / (notional − X); show the formula filled in);
   - operator tops up collateral by increasing at a higher ratio
     (config change) — slower.
3. If liq is INSIDE 1.1× spot: this is bleeding — `pnpm hedge:emergency
   --live` beats liquidation fees (operator call, but urge hard).

### 🚨 «wallet SOL below the configured reserves»

1. Where did it go: `npx tsx scripts/tx-audit.ts --since <24h ago>` —
   look at ΔSOL out.
2. Free SOL fast: unwrap wSOL (`tsx src/cli/jupiter-hedge.ts --unwrap`);
   janitor reclaims rent automatically (or restart triggers it at boot).
3. Structural fix if recurring: LP deposits are sized too close to the
   wallet total — operator decision on sizing.

### 🚨 «wallet-paid network fees over 24h far above norm»

1. `npx tsx scripts/tx-audit.ts --since <24h ago>` — the class breakdown
   shows WHAT is spamming (ours vs keeper-paid; failed vs ok).
2. Runaway retry loop → `docker compose down`, read the loop's last
   actions, fix/file, restart.
3. Remember keeper-paid transactions cost us nothing — only wallet-paid
   fees count against the norm.

### 🚨 «perp notional above the ADR-022 auto-cap»

Should never fire (cap enforcement broken = bug). Capture `jupiter:read` +
the cycle logs, bring the notional under the cap manually
(`pnpm hedge:close --size-usd=<excess>`), file the bug. Operator approval
for the close.

### 🚨 «24h live hedge churn above 3× the auto-cap»

1. Pull fresh db, look at the day:
   `sqlite3 pnl.db "SELECT taken_at, action, round(size_usd,2), round(lp_sol,3) FROM hedge_actions WHERE dry_run=0 AND taken_at >= '<24h ago>' AND action != 'none' ORDER BY taken_at"`.
2. Flip-flop pattern (increase↔decrease same size) → the input is
   oscillating: check 🧊 freeze lines actually appear (BUG-015 regression?),
   wallet SOL swings around recenters, band vs input step sizes.
3. Containment while diagnosing: raise `HEDGE_COOLDOWN_MS` in .env +
   redeploy (operator call). Note the cause before tuning anything else.

### 🚨 «recenter rate above the churn red line»

1. `sqlite3 pnl.db "SELECT triggered_at FROM rebalances ORDER BY triggered_at DESC LIMIT 15"` — real cadence.
2. Chop regime: price oscillating across a range boundary. The выдержка
   (TREND_CONFIRM_MS) should be filtering — count «recenter skipped» lines;
   if it filters nothing, the oscillation period is longer than the window.
3. Options for the operator: temporarily raise TREND_CONFIRM_MS; ride it
   out if fees still beat costs (check `pnpm pnl` window numbers); storm
   threshold is for crashes, not chop — don't abuse it.

### 🔴 watchdog: «контейнер не запущен / в статусе X» or «0 завершённых циклов»

1. `triage.sh` section 1–2. If container missing/exited:
   `remote "cd /opt/delta-bot && docker compose logs --tail 50"` — read the
   death reason.
2. `max usage reached` → RPC quota (BUG-014): reads still work via the
   public endpoint; the fix is on the Helius dashboard (operator) — do NOT
   sit in a retry loop.
3. Crash on a fresh deploy → rollback: `git log --oneline -5`, redeploy the
   previous commit (`git checkout <prev> -- . && pnpm deploy:hetzner` is
   NOT the way — instead `git revert` or reset locally with the operator's
   ok, then deploy).
4. OOM (`oom=true` in triage) → check `free -m`, container limits; restart
   and watch.
5. Start it back: `remote "cd /opt/delta-bot && docker compose up -d"`,
   then verify cycles + hedge heartbeat + a recovery push arriving.

### 🔴 watchdog: «рестарты контейнера: N → M»

Crash-restart loop = same as above, but the bot is ALIVE-ish between
crashes. Grab the last logs before a restart boundary; the 5-error kill
switch + restart policy makes sustained RPC failure look exactly like this.

### 🔴 watchdog: «auto-tune-state.json не обновлялся Ns»

The loop is wedged (container up, cycles not completing). Check the last
started cycle in logs — a hung RPC call or the BUG-009 overlap guard. A
restart clears it; capture the last cycle's lines first for the bug file.

### 🔴 watchdog: «hodl-history.jsonl не обновлялся Nч»

The daily срез cron died (usually with the RPC key — BUG-014 pattern).
`remote "tail /opt/delta-bot/data/hodl-cron.err"`; run one row manually:
`remote "cd /opt/delta-bot && docker compose exec -T delta-neutral-bot ./node_modules/.bin/tsx src/cli/hodl-compare.ts --json > /dev/null"`,
then confirm the file's mtime moved.

### Нет утреннего «💚 живой» в 08:05Z

The watchdog ITSELF died (BUG-016 class). Check in order: root crontab
lines exist (`remote "crontab -l | grep watchdog"`), script exists and is
executable at `/opt/delta-bot/deploy/hetzner/watchdog.sh`, watchdog.env
exists (600, has NTFY_TOPIC + TELEGRAM_*), run it by hand and read stderr.
Remember: a deploy must NEVER delete watchdog.env (rsync exclude) — if it
did, that's a regression of BUG-016.

---

## After any incident

1. Verify: fresh `triage.sh` clean; recovery push received; for VITALS —
   the breach line stopped appearing in new logs (throttle is 10 min, so
   wait one throttle window before declaring victory).
2. Write it down: progress.md session note (what fired → root cause →
   action → verification); bugs.md if a defect was involved; memory if an
   operating rule changed.
3. If the incident window overlaps a срез, the срез MUST mention it (the
   hodl-check verification block will surface it anyway).
