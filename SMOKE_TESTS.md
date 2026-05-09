# Smoke Test Runbook (post-audit verification)

**Purpose:** Verify the May 2026 audit-hardening pass behaves as designed before any production run with real funds. Complementary to `docs/TIERED_PROCEDURAL_RUNBOOK.md` (which covers operational concerns) — this document is specifically for **proving the audit fixes work end-to-end**.

**Read once before starting:** Each tier has explicit pass criteria and expected log lines. Do not promote to the next tier if the current tier's criteria don't all pass. The tiers escalate in risk: tier 0/1 use no funds, tier 2 uses tiny mainnet amounts, tier 3 uses your real configured deposit. There is no "tier 4" — once tier 3 is green you're running production.

**What this runbook covers** (cross-reference with `decisions.md` ADR-013):

- Per-token swap-input balance guards (BUG-003)
- Total-USD-value pre-flight
- Phase 1 retry + on-chain race recovery
- Phase 2 retry pre-flight balance re-check
- API security: fail-closed without API_KEY, CORS allowlist, rate limit, body validation (BUG-004)
- High-impact swap warning + real `priceImpactPct` propagation (BUG-006)
- Loud silent-scaling banner
- Always-logged position composition

---

## Tier 0 — Static checks (no chain, no funds)

Run all of these in the project root. Each one is fast (<60s) and zero-risk. Fail any of them → stop, fix, retry. Do not proceed to tier 1 with any of these red.

### 0.1 — Build passes

```bash
pnpm build
```

**Pass:** exits 0, no TypeScript errors emitted.
**Fail:** any TS error in `src/modules/swapPlanner.ts`, `src/modules/autoTuneOrchestrator.ts`, `src/modules/meteoraAdapter.ts`, `src/modules/jupiterSwapper.ts`, `src/api/hono-server.ts`, or `src/config/env.ts`.

### 0.2 — Unit tests pass

```bash
npx vitest run
```

**Pass:** `1 passed (20)` for `src/modules/swapPlanner.test.ts`. Total under 1 second.
**Critical assertion:** look for the test named `'production bug regression — wallet (0.258 SOL, 9.43 USDC), 4 SOL target throws on total-value pre-flight'`. If this is failing the live-bug class is not actually pinned — stop.

### 0.3 — `.env` is set correctly

```bash
test -f .env && grep -E '^(RPC_URL|PRIVATE_KEY|METEORA_POOL_ADDRESS|AUTO_TUNE_ENABLED|AUTO_TUNE_DEPOSIT_AMOUNT|MINIMUM_WALLET_BALANCE_SOL|RENT_RESERVE_SOL|SWAP_SLIPPAGE_BUFFER_PCT|SWAP_HIGH_IMPACT_WARNING_PCT)=' .env
```

**Pass:** all 9 vars echoed back with non-empty values. If you plan to use the API, also confirm `API_KEY` is set.
**Fail:** any of `RPC_URL`, `PRIVATE_KEY`, `METEORA_POOL_ADDRESS` missing or empty → bot will crash on startup.

### 0.4 — Buffer default reflects the audit bump

```bash
grep '^SWAP_SLIPPAGE_BUFFER_PCT' .env
```

**Pass:** value `>= 3.0`. (If you've explicitly tuned down for a thick pool, that's fine, but the default-from-fresh-clone should be 3.0.)
**Fail:** value `0.5` or unset (relies on stale default) → you'll see more Phase 2 retries under volatility than necessary.

---

## Tier 1 — Read-only mainnet (no funds moved)

Confirms the bot can connect to Solana, Meteora, Jupiter, and Pyth without producing any transactions. **No transactions sent at this tier.** Cost: zero.

### 1.1 — Start API server, verify GET endpoints

In one terminal:
```bash
pnpm api
```

**Expected log lines (in order):**
```
🚀 Bun + Hono API server starting on port 3001
API security configuration { apiKeyConfigured: <true|false>, allowedOrigins: [...], rateLimitPerMin: 10 }
```

If `apiKeyConfigured: false`, you'll also see:
```
⚠️  API_KEY is not set. POST /api/positions/* will return 503 until you set it.
```

This is correct fail-closed behaviour — the warning confirms the audit fix is in effect.

In another terminal:
```bash
curl -sf http://localhost:3001/api/health | jq
curl -sf http://localhost:3001/api/prices | jq '.sol'
curl -sf http://localhost:3001/api/pool/analytics | jq '.current_price, .liquidity'
curl -sf http://localhost:3001/api/positions | jq '.positionMints'
```

**Pass:** all four GETs return 200 with sensible data. Prices look plausible. `positionMints` is either empty (fresh wallet) or contains your existing position mint.

### 1.2 — Verify API fail-closed behaviour (no API_KEY set)

If you didn't set `API_KEY` in `.env`:
```bash
curl -i -X POST http://localhost:3001/api/positions/create \
  -H 'Content-Type: application/json' \
  -d '{"solAmount":0.01,"usdcAmount":0,"priceLower":160,"priceUpper":170}'
```

**Pass:** `HTTP/1.1 503 Service Unavailable` with body `{"error":"API authentication not configured", ...}`. The bot's funds are safe even if port 3001 is exposed.
**Fail:** any 200 response → the auth middleware is bypassed somewhere. Stop and re-verify.

### 1.3 — Verify API enforces auth (with API_KEY set)

Set `API_KEY=test-smoke-1` in `.env`, restart `pnpm api`, then:
```bash
# Wrong key — should be 401
curl -i -X POST http://localhost:3001/api/positions/create \
  -H 'Content-Type: application/json' \
  -H 'X-API-Key: wrong-key' \
  -d '{"solAmount":0.01,"usdcAmount":0,"priceLower":160,"priceUpper":170}'

# No key — should be 401
curl -i -X POST http://localhost:3001/api/positions/create \
  -H 'Content-Type: application/json' \
  -d '{"solAmount":0.01,"usdcAmount":0,"priceLower":160,"priceUpper":170}'
```

**Pass:** both return `401` with body `{"error":"Invalid or missing API key"}`. Server log shows:
```
Rejected POST request: invalid API key { path: '/api/positions/create', ip: ..., provided: '... '}
```

### 1.4 — Verify body validation rejects bad inputs

```bash
# Inverted price range — should be 400
curl -i -X POST http://localhost:3001/api/positions/create \
  -H 'Content-Type: application/json' \
  -H 'X-API-Key: test-smoke-1' \
  -d '{"solAmount":1,"usdcAmount":100,"priceLower":200,"priceUpper":150}'
```

**Pass:** `400 Bad Request`, body includes `"error":"priceLower must be strictly less than priceUpper"` and `"details":{"priceLower":200,"priceUpper":150}`.

```bash
# Zero amounts — should be 400
curl -i -X POST http://localhost:3001/api/positions/create \
  -H 'Content-Type: application/json' \
  -H 'X-API-Key: test-smoke-1' \
  -d '{"solAmount":0,"usdcAmount":0,"priceLower":160,"priceUpper":170}'

# Sanity ceiling — should be 400
curl -i -X POST http://localhost:3001/api/positions/create \
  -H 'Content-Type: application/json' \
  -H 'X-API-Key: test-smoke-1' \
  -d '{"solAmount":5000,"usdcAmount":0,"priceLower":160,"priceUpper":170}'
```

**Pass:** both return 400 with descriptive error messages.

### 1.5 — Verify rate limit (optional, 30s)

Spam the same endpoint > 10 times in one minute:
```bash
for i in {1..15}; do
  curl -s -o /dev/null -w "%{http_code} " -X POST http://localhost:3001/api/positions/create \
    -H 'Content-Type: application/json' \
    -H 'X-API-Key: test-smoke-1' \
    -d '{"solAmount":1,"usdcAmount":100,"priceLower":160,"priceUpper":170}'
done; echo
```

**Pass:** first 10 responses are 4xx (probably 401 if your key is wrong, or some other validation/business error if it's right — that's fine), then `429 429 429 429 429`. Server log shows `Rate limit exceeded { ip: ..., count: 11, limit: 10 }`.

### 1.6 — Stop API server

`Ctrl+C` the `pnpm api` process. Don't proceed to tier 2 with the API still running unless you want to interact with it from a UI.

---

## Tier 2 — Mainnet, tiny amounts (real funds, controlled risk)

Use a wallet funded with **just enough to test, not your full deposit**. Recommended: 0.05 SOL + 5 USDC (≈ $13 at current prices). With reserves of `MINIMUM_WALLET_BALANCE_SOL=0.2` and `RENT_RESERVE_SOL=0.1`, this is *deliberately not enough* to fund a real position — that's the point: tier 2.1 verifies the bot rejects gracefully.

### 2.1 — Verify total-value pre-flight throws on insufficient wallet

Configure:
```bash
# In .env
AUTO_TUNE_ENABLED=true
AUTO_TUNE_DEPOSIT_TOKEN=SOL
AUTO_TUNE_DEPOSIT_AMOUNT=4   # Way more than the test wallet can fund
```

Run:
```bash
pnpm auto-tune
```

**Expected log lines (in order, on first cycle):**
```
🔍 Auto-tune check cycle started ...
Position balance checked ...                 ← always logged (de-sampled)
🆕 No position found - auto-creating initial position
Pool state ...
Calculated initial deposit amounts (balanced for centered range) ...
💰 Pre-flight wallet balance check ...
```

Then the **critical assertion** — the total-value pre-flight should throw with this message shape:
```
Wallet does not have enough total value to create initial position.
Have $<X> (<Y> SOL + <Z> USDC @ $<P>/SOL).
Need $<W> (<R> SOL + <S> USDC, including 0.1 SOL rent reserve and 0.2 SOL permanent minimum).
No swap can resolve this — reduce AUTO_TUNE_DEPOSIT_AMOUNT (currently 4) or deposit more funds.
```

**Pass:**
- Bot does NOT call Jupiter (no `🔄 Executing swap (Jupiter Ultra)` log line).
- Error message names `AUTO_TUNE_DEPOSIT_AMOUNT` with the right `currently <N>` value.
- Error message includes `No swap can resolve this`.

**Fail:**
- Any line containing `🔄 Swapping ... USDC → SOL` with an amount > your USDC balance → the per-branch guard or pre-flight is broken. **Stop the bot immediately** (Ctrl+C) and revisit fixes; check `bugs.md` BUG-003 to confirm the fix is still in code.
- Any line containing `Insufficient funds` from Jupiter → same problem.

`Ctrl+C` to stop. This tier verified the live-bug class is locked out.

### 2.2 — Verify successful initial position with tiny but sufficient amount

Top up the wallet to ~0.5 SOL + ~50 USDC. Adjust `AUTO_TUNE_DEPOSIT_AMOUNT` to fit:
```bash
# In .env
AUTO_TUNE_DEPOSIT_AMOUNT=0.05   # ~$8 at current SOL price; should be balanced with reserves
```

Run:
```bash
pnpm auto-tune
```

**Expected log lines (in order):**
```
🔍 Auto-tune check cycle started ...
🆕 No position found - auto-creating initial position
Pool state ...
Calculated initial deposit amounts (balanced for centered range) ...
💰 Pre-flight wallet balance check { hasSufficientSol: true, hasSufficientUsdc: true OR (one false, one true) }
```

**If both sufficient:** no swap. Skip to position creation.
**If shortfall on one side:** look for either:
  ```
  ⚠️  Insufficient balance detected - swap will be required
  Swapping USDC → SOL to cover shortfall { missingSol: ..., swapAmountUsdc: ... }
  🔄 Swapping <N.NN> USDC → SOL
  🔄 Executing swap (Jupiter Ultra) ...
  ✅ Swap complete: <N.NNNN> received (impact: <X.XX>%)
  ```

After swap (or directly if no swap needed):
```
[adapter creates position]
✅ Position created successfully
```

**Pass:** position created, no errors, total elapsed under 30 seconds. State file at `data/auto-tune-state.json` updated with `lastPositionCreated`.

**Watch for:** if the swap impact warning fires (`⚠️  HIGH PRICE IMPACT on swap` errorBanner), that's the BUG-006 fix working — the swap still succeeded but you're getting visibility into pool conditions. Note the `bufferExceeded` flag.

### 2.3 — Verify successful rebalance

Let the bot run for at least 30 minutes, or wait until the position becomes imbalanced (track via `pnpm auto-tune:watch`). When a rebalance fires, **expected log lines**:

```
Position balance checked ...                    ← composition + price + range
⚠️  Position imbalanced - triggering rebalance ...
🔄 Rebalancing position <mint>...
Step 1: Creating DLMM pool instance...
Step 2: Fetching user positions...
✅ Position found
🔄 Calling Meteora SDK removeLiquidity...
✅ SDK removeLiquidity returned ...
SINGLE TRANSACTION submitted: Withdraw + Claim + Close { signature, solscan: ... }
✅ Withdraw + Claim + Close completed successfully (1 TX)
✅ Phase 1: Claimed <X.XXXX> SOL + <Y.YY> USDC
[plan swap if needed, execute swap if needed]
[create new position]
✅ Position created: <mint>...
✅ Rebalance complete in <N.N>s [(with swap)]
```

**Pass:**
- Phase 1 completes in a single transaction (`SINGLE TRANSACTION submitted`).
- If a swap was needed, you see the planning log with `solShortfall`/`usdcShortfall` and `bufferMultiplier: 1.03` (the bumped buffer default).
- New position created.
- Total rebalance time under 60 seconds.

**Watch for:**
- `removeLiquidity timeout after 90s` (only on extremely slow RPCs — should be rare). If it fires, the catch block does an on-chain re-check; you should see either `⚠️  Position is no longer on-chain despite local error — treating as a successful close` (recovery succeeded) or the error propagates (genuine failure).
- `🔄 Phase 1 retry N/M` with `Position no longer on-chain — previous attempt likely succeeded` — this is the on-chain race recovery doing its job.
- `🔄 Retry N/M — re-checking wallet state` followed by either `Retry pre-flight: wallet still covers target` or `⚠️  Retry N: wallet shifted — additional swap required` — Phase 2 retry pre-flight.
- `⚠️  POSITION SCALED DOWN to fit wallet balance` errorBanner — the silent-scaling fix; only fires when wallet doesn't fund the configured size.

---

## Tier 3 — Mainnet, configured deposit (production-ish)

Top up wallet to your real configured deposit, set `AUTO_TUNE_DEPOSIT_AMOUNT` to your production value, and let the bot run for at least one full rebalance cycle. This is the production smoke test.

### 3.1 — Run with watch mode for visual confirmation

```bash
pnpm auto-tune:watch
```

Watch the dashboard for:
- **Iteration counter incrementing** every `AUTO_TUNE_CHECK_INTERVAL_MS` (default 30s).
- **Position composition** updating (SOL %, USDC %, price, range bounds).
- **Rebalance triggered** when composition exceeds `AUTO_TUNE_IMBALANCE_THRESHOLD`.
- **No errors banner** persisting across cycles.

Run for at least **6 hours** before treating as green. Some failures only manifest under sustained operation:
- Slow-RPC timeouts in `withdrawClaimAndClose` (was 30s, now 90s — should not fire on healthy RPCs).
- Cumulative-fees-shifting-the-wallet that triggers the Phase 2 retry pre-flight.
- Pool liquidity thinning that triggers the high-impact warning.

### 3.2 — Verify state file is consistent

After the first successful rebalance:
```bash
cat data/auto-tune-state.json | jq '{
  iteration,
  rebalanceCount,
  lastRebalance,
  currentPositionMint,
  consecutiveErrors,
  totalClaimedFees,
  lastPositionCreated
}'
```

**Pass:**
- `consecutiveErrors: 0`.
- `currentPositionMint` matches the on-chain position (verify via Solscan).
- `totalClaimedFees.sol` and `.usdc` are non-zero after at least one rebalance.
- `lastPositionCreated.timestamp` recent.

### 3.3 — Pull a full causal trail for one rebalance from logs

Pick the most recent rebalance from logs and confirm you can trace, in order:

1. `Position balance checked` (precondition state — composition + price + range)
2. `⚠️  Position imbalanced - triggering rebalance` (decision)
3. Phase 1 logs with TX signature
4. (if swap) `🔄 Executing swap (Jupiter Ultra)` → `✅ Swap complete (impact: X.XX%)`
5. (if high impact) `⚠️  HIGH PRICE IMPACT on swap` errorBanner — for visibility, not a failure
6. Phase 2 logs with new position mint
7. `✅ Rebalance complete in N.Ns`

If any of these are missing, the de-sampled-logging fix isn't fully in effect or some upstream log was sampled out. Investigate before treating tier 3 as green.

---

## Failure modes and what to do

| Symptom | Most likely cause | Action |
|---------|-------------------|--------|
| `No transaction in order response` from Jupiter | Pre-audit code path somehow re-introduced | Stop bot. Check `git log src/modules/swapPlanner.ts`. Confirm BUG-003 fix still in place. |
| Bot keeps trying to swap with empty wallet | Total-value pre-flight bypassed | Stop bot. Re-run tier 0 unit tests; the `'production bug regression'` test pins this. |
| API POST returns 200 without `X-API-Key` | Auth middleware not running | Stop API. Check `app.use('/api/positions/create', rateLimitMiddleware, apiKeyAuthMiddleware)` in `hono-server.ts`. Restart and re-run tier 1.3. |
| `removeLiquidity timeout after 30s` | Old timeout not bumped | Check `src/modules/meteoraAdapter.ts` for `REMOVE_LIQUIDITY_TIMEOUT_MS = 90_000`. |
| Phase 1 fails and bot loops on a closed position | On-chain race recovery not running | Check `isPositionStillOnChain` private method + the catch block in `withdrawClaimAndClose`. |
| Phase 2 retry succeeds but the wallet was clearly insufficient | Retry pre-flight skipped | Check the `if (attempt > 1)` block at the top of the retry loop. |
| `📊 Position scaled down to fit wallet balance` shows `log.warn` | Promotion to errorBanner reverted | Check `log.errorBanner('⚠️  POSITION SCALED DOWN ...')` in `executeRebalance`. |

For full operational scenarios (genuine failures, not smoke-test failures), see `docs/TIERED_PROCEDURAL_RUNBOOK.md` Tier 6 (Incident Response).

---

## When you're done

Tier 3 green for at least 6 hours, multiple rebalances observed, no persistent errors → the audit fixes work end-to-end on real funds. Now you can:

- Increase capital toward your full target.
- Continue to monitor `data/auto-tune-state.json` and the structured logs.
- (Eventually) plan the Drift hedge engine — that's the next major architectural piece, gated on this smoke-test sequence.

If anything in Tier 0–3 doesn't match the expected output, **don't push past it**. The audit fixes form a defensive funnel — every layer is load-bearing. A single bypassed guard is enough to re-introduce the live bug class.

---

## Document history

- **2026-05-09** — Created. Authored alongside the audit-hardening pass (ADR-013).
