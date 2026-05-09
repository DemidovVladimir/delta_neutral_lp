# Tiered Procedural Runbook

This runbook is for operating the implemented Meteora DLMM auto-tune bot. Drift hedging is not implemented yet, so procedures below cover LP position management, Jupiter swaps, the Hono API, GCP deployment, and recovery from common failure states.

## Tier 0: Ground Rules

Use this tier before any local, production, or incident action.

1. Confirm workspace state:

   ```bash
   git status --short
   ```

2. Confirm you are in the project root:

   ```bash
   pwd
   ```

3. Confirm the environment file exists and is the one you intend to run:

   ```bash
   test -f .env && sed -n '1,220p' .env
   ```

4. Confirm the wallet is funded above reserves plus intended position size:

   - Required SOL reserve is `MINIMUM_WALLET_BALANCE_SOL + RENT_RESERVE_SOL`.
   - Position sizing requires roughly equal USD value on both sides.
   - If `AUTO_TUNE_DEPOSIT_TOKEN=SOL` and `AUTO_TUNE_DEPOSIT_AMOUNT=0.5`, expect the position to require about `0.5 SOL + (0.5 * SOL price) USDC`, before claimed fees and scaling.

5. Run static validation:

   ```bash
   pnpm build
   pnpm test
   ```

Proceed only if the validation result is understood. A failing test does not always mean production is broken, but it must be explained before live runs.

## Tier 1: Local Read-Only Verification

Use this tier when preparing a new config or checking that read-only integrations work.

1. Install dependencies if needed:

   ```bash
   pnpm install
   ```

2. Verify key environment values:

   ```bash
   rg '^(RPC_URL|AUTO_CREATE_POSITIONS|METEORA_POOL_ADDRESS|AUTO_TUNE_|SWAP_|MINIMUM_WALLET_BALANCE_SOL|RENT_RESERVE_SOL|API_)' .env
   ```

3. Build and run tests:

   ```bash
   pnpm build
   pnpm test
   ```

4. Start the read-capable API:

   ```bash
   pnpm api
   ```

5. In another shell, check read-only endpoints:

   ```bash
   curl http://localhost:3001/api/health
   curl http://localhost:3001/api/prices
   curl http://localhost:3001/api/pool/analytics
   curl http://localhost:3001/api/positions
   ```

Expected result:

- Health returns `status: ok`.
- Price endpoint returns SOL price data.
- Pool analytics returns the configured Meteora pool.
- Positions may be empty on a fresh wallet, but the endpoint should not fail because of auth.

Do not use POST endpoints in this tier.

## Tier 2: First Live Auto-Tune Run

Use this tier for the first real-funds run, after Tier 0 and Tier 1 pass.

1. Set conservative sizing in `.env`:

   ```bash
   AUTO_TUNE_ENABLED=true
   AUTO_CREATE_POSITIONS=true
   AUTO_TUNE_DEPOSIT_TOKEN=SOL
   AUTO_TUNE_DEPOSIT_AMOUNT=0.05
   AUTO_TUNE_BIN_COUNT=20
   AUTO_TUNE_IMBALANCE_THRESHOLD=0.8
   MINIMUM_WALLET_BALANCE_SOL=0.2
   RENT_RESERVE_SOL=0.1
   ```

2. Start watch mode:

   ```bash
   pnpm auto-tune:watch
   ```

3. Observe the first cycle:

   - If no position exists, it should run blockchain discovery, then create an initial position.
   - If a position exists, it should discover and monitor it.
   - It should not create duplicates. A safety discovery runs before creation.

4. Stop after the first successful position creation or monitoring cycle:

   ```text
   Ctrl+C
   ```

5. Inspect state:

   ```bash
   sed -n '1,220p' data/state.json
   sed -n '1,220p' data/auto-tune-state.json
   ```

Expected result:

- `data/state.json` contains `createdPositionMints`.
- `data/auto-tune-state.json` has `running: false` after graceful shutdown.
- No `UNCLOSED POSITION DETECTED`, `POSITION SCALED DOWN`, or swap insufficient-funds banner appears unless you intentionally underfunded the wallet.

## Tier 3: Routine Production Operation

Use this tier for normal unattended operation.

1. Confirm production config:

   ```bash
   rg '^(RPC_URL|AUTO_CREATE_POSITIONS|METEORA_POOL_ADDRESS|AUTO_TUNE_|SWAP_|MINIMUM_WALLET_BALANCE_SOL|RENT_RESERVE_SOL|LOG_LEVEL)' .env
   ```

2. Build before restart:

   ```bash
   pnpm build
   ```

3. Start the bot:

   ```bash
   pnpm auto-tune
   ```

4. Watch for required baseline logs:

   - `AutoTuneOrchestrator initialized`
   - `Position(s) found on blockchain` or `No position found - auto-creating initial position`
   - `Position balance checked`
   - `Position balanced - no action needed` or `Position imbalanced - triggering rebalance`

5. During rebalances, verify sequence:

   - Phase 1 withdraw/claim/close succeeds or retries.
   - Target position sizes are logged.
   - Optional swap logs exactly one planned direction unless retry pre-flight needs a top-up.
   - Position creation logs a new position mint.
   - Auto-tune state saves the new current mint.

6. Stop gracefully for maintenance:

   ```text
   Ctrl+C
   ```

Expected result:

- Consecutive errors stay at zero or recover after transient failures.
- Rebalance count increases only after successful complete rebalances.
- The old position is closed before the new position is created.

## Tier 4: API Operations

Use this tier when operating through HTTP clients or a UI.

1. Configure API security:

   ```bash
   API_KEY=<long-random-secret>
   API_ALLOWED_ORIGINS=http://localhost:5173
   API_RATE_LIMIT_PER_MIN=10
   ```

2. Start the API:

   ```bash
   pnpm api
   ```

3. Verify read-only endpoints:

   ```bash
   curl http://localhost:3001/api/health
   curl http://localhost:3001/api/positions
   ```

4. Create a position only after manually verifying amounts and price bounds:

   ```bash
   curl -X POST http://localhost:3001/api/positions/create \
     -H "Content-Type: application/json" \
     -H "X-API-Key: $API_KEY" \
     -d '{"solAmount":0.05,"usdcAmount":8,"priceLower":130,"priceUpper":150}'
   ```

5. Withdraw, claim, and close only with the exact intended mint:

   ```bash
   curl -X POST http://localhost:3001/api/positions/withdraw-claim-close \
     -H "Content-Type: application/json" \
     -H "X-API-Key: $API_KEY" \
     -d '{"positionMint":"POSITION_MINT"}'
   ```

Expected result:

- POST without `API_KEY` returns 503 when auth is not configured.
- POST with a wrong key returns 401.
- Bad request bodies return 400.
- Valid mutations return signatures.

## Tier 5: GCP Production

Use this tier for the Pulumi-managed GCP deployment.

1. Read deployment docs:

   ```bash
   sed -n '1,240p' deploy/gcp/pulumi/README.md
   sed -n '1,220p' deploy/gcp/pulumi/BILLING_SETUP.md
   ```

2. Preview infrastructure:

   ```bash
   pnpm deploy:gcp:preview
   ```

3. Deploy:

   ```bash
   pnpm deploy:gcp:up
   ```

4. Check status and logs:

   ```bash
   pnpm deploy:gcp:status
   pnpm deploy:gcp:logs
   ```

5. Inspect persistent state on the VM if needed:

   ```bash
   pnpm deploy:gcp:ssh
   sudo sed -n '1,220p' /var/lib/autotune/data/state.json
   sudo sed -n '1,220p' /var/lib/autotune/data/auto-tune-state.json
   ```

Expected result:

- The service restarts cleanly.
- The persistent state files survive deployment and VM restart.
- Logs show the same baseline auto-tune sequence as Tier 3.

## Tier 6: Incident Response

Use this tier when logs show errors or the bot stops itself after five consecutive errors.

### A. Jupiter order returns no transaction or insufficient funds

Symptoms:

- `Jupiter API returned an error`
- `No transaction found in order response`
- `Swap failed - current wallet balances`

Procedure:

1. Read the logged wallet balances and swap params.
2. Compare available value against target:

   - Available SOL for swaps is wallet SOL minus `MINIMUM_WALLET_BALANCE_SOL + RENT_RESERVE_SOL`.
   - Available value must cover target SOL plus target USDC.

3. If total value is too low, deposit funds or reduce `AUTO_TUNE_DEPOSIT_AMOUNT`.
4. If price impact is high, reduce `AUTO_TUNE_DEPOSIT_AMOUNT` or increase `SWAP_SLIPPAGE_BUFFER_PCT`.
5. Restart only after the wallet or config change is complete.

### B. Position scaled down

Symptoms:

- `POSITION SCALED DOWN to fit wallet balance`

Procedure:

1. Treat it as an operator action item, not a successful steady state.
2. Decide whether smaller size is acceptable.
3. If not acceptable, deposit the missing side or reduce `AUTO_TUNE_DEPOSIT_AMOUNT` to the logged recommendation.
4. Continue monitoring the next rebalance. The warning will recur until sizing and wallet value align.

### C. Phase 1 withdraw/claim/close fails

Symptoms:

- `Phase 1 attempt ... failed`
- `Phase 1 (Withdraw+Claim+Close) failed - position still exists on-chain`

Procedure:

1. Do not clear state.
2. Let the retry loop re-discover the position.
3. If retries are exhausted, verify the position on chain or in the Meteora UI.
4. If the position still exists, restart auto-tune after RPC stability returns.
5. If the position is already closed despite a local timeout, the next retry detects this and treats Phase 1 as complete with unknown claimed-fee amounts.

### D. Unclosed position detected after swap failure

Symptoms:

- `UNCLOSED POSITION DETECTED`

Procedure:

1. Stop auto-tune.
2. Inspect `data/state.json` and `data/auto-tune-state.json`.
3. Verify the listed position mint on Meteora.
4. If the position is valid and should be managed, restart auto-tune and let blockchain discovery pick it up.
5. If manual intervention is required, close the position through Meteora or the API endpoint, then verify no stale mints remain in state.

### E. API mutation rejected

Symptoms:

- HTTP 503: API authentication not configured.
- HTTP 401: invalid or missing API key.
- HTTP 429: rate limited.

Procedure:

1. For 503, set `API_KEY` and restart `pnpm api`.
2. For 401, fix the `X-API-Key` header.
3. For 429, wait for `Retry-After` or raise `API_RATE_LIMIT_PER_MIN` deliberately.
4. Confirm `API_ALLOWED_ORIGINS` contains the UI origin if browser calls fail CORS.

## Tier 7: Manual State Review

Use this tier before editing or deleting state files.

1. Stop all bot/API processes.
2. Backup state:

   ```bash
   cp data/state.json data/state.json.bak
   cp data/auto-tune-state.json data/auto-tune-state.json.bak
   ```

3. Inspect chain reality first using the bot's next discovery cycle where possible.
4. Only edit state when chain state and saved state are known to diverge.
5. Prefer removing stale closed mints over deleting the entire state file.
6. Restart auto-tune and confirm discovery logs match expected positions.

## Escalation Checklist

Escalate to code changes when:

- The same deterministic planner error appears despite adequate balances.
- Phase 1 succeeds on chain but the bot repeatedly treats it as failed.
- The bot creates or attempts to create duplicate positions.
- Transaction fee or LP fee accounting corrupts state.
- API auth or validation allows an unintended mutation.

When filing a bug, update `bugs.md` with logs, wallet balances, transaction signatures, config values, expected behavior, and actual behavior.
