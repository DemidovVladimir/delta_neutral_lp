# API Documentation

The Delta-Neutral LP Bot exposes a REST API server built with Hono framework and Bun runtime.

> **Auto-tune CLI does NOT use this API.** `pnpm auto-tune` calls `MeteoraAdapter` directly. The HTTP API is for an external/paired UI. If you don't run a UI, you can leave the API server off entirely.

## Starting the API Server

```bash
pnpm api
```

Server listens on port 3001 by default (configurable via `API_PORT`).

---

## Security model (read this before exposing port 3001)

GET endpoints are open and CORS-protected. POST endpoints — the ones that move funds — sit behind four layers of guards:

1. **CORS allowlist** (`API_ALLOWED_ORIGINS`). Browser-origin requests not in the list get no `Access-Control-Allow-Origin` header and the browser blocks the response.
2. **Per-IP rate limit** (`API_RATE_LIMIT_PER_MIN`, default 10). Returns HTTP 429 with `Retry-After` on overflow. Runs *before* auth so failed-auth attempts also count against the budget.
3. **API key auth** (`X-API-Key` header must equal `API_KEY` env). Constant-time compare. **Fail-closed:** when `API_KEY` is unset, POST endpoints return HTTP 503 — POSTs *cannot* fire on a default-configured server.
4. **Body validation** (types, ranges, sanity ceilings — `solAmount ≤ 1000`, `usdcAmount ≤ 1_000_000`, `priceLower < priceUpper`, etc). Returns HTTP 400 with field-level details.

### Configuring the guards

In `.env`:

```bash
# Generate a strong key once, paste it here:
#   openssl rand -hex 32
API_KEY=<your-32-byte-hex-string>

# Comma-separated. Production should pin to your UI's exact origin.
API_ALLOWED_ORIGINS=http://localhost:5173,http://localhost:3000

# 10 requests/minute per remote IP. 429 with Retry-After on overflow.
API_RATE_LIMIT_PER_MIN=10
```

If `API_KEY` is empty, the server logs a startup warning and any POST attempt returns:

```json
{
  "error": "API authentication not configured",
  "hint": "Set the API_KEY environment variable to enable mutating endpoints."
}
```

with status `503 Service Unavailable`. This is intentional fail-closed behaviour — a bot deployed without an API_KEY can never have its funds moved via the API even if the port is exposed.

---

## Endpoints

### Health Check (open)

**GET** `/api/health`

```json
{
  "status": "ok",
  "timestamp": 1699564800000
}
```

---

### Price Oracle (open)

**GET** `/api/prices`

Fetches current prices from Jupiter and Pyth.

```json
{
  "sol": 163.45,
  "multiToken": {
    "SOL": { "price": 163.45, "source": "jupiter" },
    "USDC": { "price": 1.0, "source": "jupiter" }
  },
  "timestamp": 1699564800000
}
```

---

### Pool Analytics (open)

**GET** `/api/pool/analytics`

Pool stats from Meteora DLMM API (cached 2.5s).

```json
{
  "address": "5rCf1DM8LjKTw4YqhnoLcngyZYeNnQqztScTogYHAS6",
  "name": "SOL-USDC",
  "mint_x": "So11111111111111111111111111111111111111112",
  "mint_y": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "liquidity": 2734567.89,
  "trade_volume_24h": 1234567.89,
  "fees_24h": 12345.67,
  "today_fees": 5678.90,
  "apr": 45.67,
  "apy": 56.78,
  "bin_step": 4,
  "current_price": 163.45
}
```

---

### Bin Distribution (open)

**GET** `/api/pool/bins`

Returns bins ±50 around the active bin with per-bin SOL/USDC amounts and USD liquidity.

```json
{
  "activeBin": { "binId": 12345, "price": 163.45 },
  "binStep": 4,
  "bins": [
    {
      "binId": 12340,
      "price": 163.21,
      "liquidity": 1234.56,
      "xAmount": 5.5,
      "yAmount": 332.0,
      "isActive": false
    }
  ],
  "totalLiquidity": 123456.78,
  "timestamp": 1699564800000
}
```

---

### Get Positions (open)

**GET** `/api/positions`

```json
{
  "exposure": {
    "totalSol": 0.5,
    "totalUsdc": 80.0,
    "perPosition": [...]
  },
  "positionMints": [
    "PositionNFT111111111111111111111111111111111"
  ],
  "timestamp": 1699564800000
}
```

---

### Create Position 🔐

**POST** `/api/positions/create`

**Headers required:**
```
Content-Type: application/json
X-API-Key: <API_KEY env value>
Origin: <one of API_ALLOWED_ORIGINS>      ← only checked for CORS preflight
```

**Body (validated):**
```json
{
  "solAmount": 10,
  "usdcAmount": 1000,
  "priceLower": 160.0,
  "priceUpper": 170.0
}
```

**Validation rules** (HTTP 400 with field-level `details` on failure):
- `solAmount`, `usdcAmount`: finite numbers ≥ 0. Strings are accepted and coerced.
- `usdcAmount` defaults to 0 if omitted.
- At least one of `solAmount` / `usdcAmount` must be > 0.
- `priceLower`: finite number ≥ 0.
- `priceUpper`: finite number ≥ 0, **strictly greater than `priceLower`**.
- Sanity ceilings: `solAmount ≤ 1000 SOL`, `usdcAmount ≤ 1_000_000 USDC`. (Tune in `hono-server.ts` if your wallet routinely opens larger positions.)

**Success response:**
```json
{
  "positionMint": "PositionNFT111111111111111111111111111111111",
  "signature": "5x...abc",
  "success": true
}
```

**Example:**
```bash
curl -X POST http://localhost:3001/api/positions/create \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_KEY" \
  -d '{"solAmount":10,"usdcAmount":1000,"priceLower":160,"priceUpper":170}'
```

---

### Withdraw + Claim + Close (Atomic) 🔐

**POST** `/api/positions/withdraw-claim-close`

**Headers required:** same as Create Position.

⚡ **One atomic transaction** that:
1. Withdraws 100% liquidity
2. Claims all accumulated fees
3. Closes position and reclaims rent (~0.057 SOL)

Uses Meteora SDK's `shouldClaimAndClose=true`. Same operation as Phase 1 of the auto-tune rebalance.

**Body (validated):**
```json
{
  "positionMint": "PositionNFT111111111111111111111111111111111"
}
```

**Validation:**
- `positionMint`: non-empty string ≤ 64 chars, must construct as a valid Solana `PublicKey`.

**Success response:**
```json
{
  "signature": "5x...abc",
  "claimedFees": {
    "sol": 0.05,
    "usdc": 8.5
  },
  "success": true,
  "message": "Withdraw + Claim + Close completed in 1 atomic transaction. Position closed and rent reclaimed (~0.057 SOL)."
}
```

**Notes on robustness:** The underlying `MeteoraAdapter.withdrawClaimAndClose` has a 90s ceiling on the SDK build step (was 30s — that was too aggressive on slow RPCs) and re-checks chain state on errors. If the SDK rejects locally but the transaction settled on-chain (e.g., `confirmTransaction` blockhash expired), the adapter returns a synthetic success rather than throwing — preventing the caller from attempting a double-close. In that recovery case `signature` is `"unknown-after-error-recovery"` and `claimedFees` is `{ sol: 0, usdc: 0 }` (we lost local visibility into the exact amounts).

**Example:**
```bash
curl -X POST http://localhost:3001/api/positions/withdraw-claim-close \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_KEY" \
  -d '{"positionMint":"PositionNFT111111111111111111111111111111111"}'
```

---

## Error Handling

Standard error shape:

```json
{
  "error": "Short summary",
  "message": "Detailed message"
}
```

For validation failures, the body is:

```json
{
  "error": "<field> must be a finite number",
  "details": { "field": "solAmount", "value": "abc" }
}
```

For rate-limit overflow, the body is:

```json
{
  "error": "Rate limit exceeded",
  "retryAfterSec": 47,
  "limitPerMin": 10
}
```

…with HTTP `Retry-After: 47` set on the response.

**Status codes used:**

| Code | Meaning |
|------|---------|
| 200 | Success |
| 400 | Validation error (body shape, range, sanity ceiling) |
| 401 | Missing or invalid `X-API-Key` |
| 429 | Rate limit exceeded — see `Retry-After` header |
| 500 | Server-side error (Solana RPC, Meteora SDK, etc.) |
| 503 | `API_KEY` not configured — POST endpoints fail-closed |

---

## CORS

The previous implementation used wildcard CORS, which combined with unauthenticated POSTs created a fund-loss surface (any web page the operator visited could fire `fetch('http://localhost:3001/api/positions/create')`). That's now closed:

- `API_ALLOWED_ORIGINS` is a comma-separated allowlist.
- Default: `http://localhost:5173, http://localhost:3000` (common dev ports).
- Origins not in the list get no `Access-Control-Allow-Origin` header. Browsers block the response.
- `allowHeaders`: `Content-Type`, `X-API-Key`. `allowMethods`: `GET`, `POST`, `OPTIONS`. `credentials: false`.

Production should pin this to the exact origin of the UI you ship — don't leave the localhost default in place on a public VM.

---

## Implementation Details

- **Hono framework** with **Bun runtime** for high performance and low latency.
- **Singleton adapter pattern** — `MeteoraAdapter` is created once and reused.
- **DLMM pool instance** is created per request to ensure fresh state.
- **Body parser** uses `c.req.json().catch(() => null)` so malformed JSON falls into the validation path with HTTP 400 instead of HTTP 500.
- **Constant-time API key compare** in the auth middleware to defend against timing-side-channel probing.
- **Per-IP rate limiter** uses an in-memory fixed-window map with periodic cleanup. For multi-instance deployments, swap for a Redis-backed implementation.

---

## Auto-Tune State Tracking

The auto-tune feature persists state to `data/auto-tune-state.json` (separate from the API's request handling). The API can read but doesn't write this file directly.

State fields tracked:
- `iteration` — count of check cycles
- `rebalanceCount` — successful rebalances
- `lastRebalance` — timestamp
- `currentPositionMint` — active position
- `consecutiveErrors` — stops bot at 5
- `totalClaimedFees: { sol, usdc }` — aggregated
- `lastPositionCreated: { positionMint, initialDeposit, timestamp }`
- `unclaimedFees: { sol, usdc }` — reset to 0 after each rebalance

---

## Related Documentation

- [README.md](../README.md) — Project overview and quickstart
- [CLAUDE.md](../CLAUDE.md) — Architecture & development guide
- [SMOKE_TESTS.md](../SMOKE_TESTS.md) — Procedural smoke-test runbook (run before mainnet)
- [decisions.md](../decisions.md) — Architectural decision records
- [.env.example](../.env.example) — Full environment variable reference
