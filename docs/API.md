# API Documentation

The Delta-Neutral LP Bot exposes a REST API server built with Hono framework and Bun runtime.

## Starting the API Server

```bash
pnpm api
```

Server runs on port 3001 by default (configurable via `API_PORT` environment variable).

## Endpoints

### Health Check

**GET** `/api/health`

Returns server health status.

**Response:**
```json
{
  "status": "ok",
  "timestamp": 1699564800000
}
```

---

### Price Oracle

**GET** `/api/prices`

Fetches current prices from Jupiter API v6 and Pyth oracles.

**Response:**
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

### Pool Analytics

**GET** `/api/pool/analytics`

Fetches real-time pool analytics from Meteora DLMM API.

**Response:**
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

### Bin Distribution

**GET** `/api/pool/bins`

Fetches bin distribution and liquidity data around the active bin.

**Response:**
```json
{
  "activeBin": {
    "binId": 12345,
    "price": 163.45
  },
  "binStep": 4,
  "bins": [
    {
      "binId": 12340,
      "price": 162.50,
      "liquidity": 50000.0,
      "xAmount": 150.5,
      "yAmount": 12000.0,
      "isActive": false
    },
    {
      "binId": 12345,
      "price": 163.45,
      "liquidity": 75000.0,
      "xAmount": 200.0,
      "yAmount": 15000.0,
      "isActive": true
    }
  ],
  "totalLiquidity": 2734567.89,
  "timestamp": 1699564800000
}
```

---

### Get Positions

**GET** `/api/positions`

Fetches user's LP positions and exposure.

**Response:**
```json
{
  "exposure": {
    "sol": 10.5,
    "usdc": 1234.56,
    "totalUsd": 2950.23
  },
  "positionMints": [
    "PositionNFT111111111111111111111111111111111"
  ],
  "timestamp": 1699564800000
}
```

---

### Create Position

**POST** `/api/positions/create`

Creates a new LP position with specified parameters.

**Request Body:**
```json
{
  "solAmount": 10,
  "usdcAmount": 1000,
  "priceLower": 160.0,
  "priceUpper": 170.0
}
```

**Response:**
```json
{
  "positionMint": "PositionNFT111111111111111111111111111111111",
  "signature": "5x...abc",
  "success": true
}
```

---

### Deposit to Position

**POST** `/api/positions/deposit`

Deposits additional funds to an existing position.

**Request Body:**
```json
{
  "sol": 5,
  "usdc": 500,
  "singleSided": false
}
```

**Response:**
```json
{
  "signature": "5x...abc",
  "success": true
}
```

---

### Withdraw from Position

**POST** `/api/positions/withdraw`

Withdraws funds from a position.

**Request Body:**
```json
{
  "percent": 50,
  "positionMint": "PositionNFT111111111111111111111111111111111"
}
```

**Response:**
```json
{
  "signature": "5x...abc",
  "success": true
}
```

---

### Claim Fees

**POST** `/api/positions/claim-fees`

Claims accumulated fees from all positions.

**Request Body:**
```json
{}
```

**Response:**
```json
{
  "claimedSol": 0.05,
  "claimedUsdc": 8.5,
  "signature": "5x...abc",
  "success": true
}
```

---

### Close Position

**POST** `/api/positions/close`

Closes an empty position and reclaims rent (~0.057 SOL).

**Important:** Position must be empty (100% withdrawn) before closing.

**Request Body:**
```json
{
  "positionMint": "PositionNFT111111111111111111111111111111111"
}
```

**Response:**
```json
{
  "signature": "5x...abc",
  "success": true,
  "message": "Position NFT closed and rent reclaimed (~0.057 SOL). Note: Bin array rent (~0.14 SOL) is non-refundable."
}
```

---

### Withdraw + Claim + Close (Atomic)

**POST** `/api/positions/withdraw-claim-close`

⚡ **ONE ATOMIC TRANSACTION** that performs:
1. Withdraw 100% liquidity
2. Claim all accumulated fees
3. Close position and reclaim rent

This endpoint uses the Meteora SDK's `shouldClaimAndClose=true` parameter to execute all three operations atomically within a single transaction. This is the same operation used in the auto-tune feature's first transaction.

**Request Body:**
```json
{
  "positionMint": "PositionNFT111111111111111111111111111111111"
}
```

**Response:**
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

**Benefits:**
- **Atomic execution**: All operations succeed or fail together
- **Cost efficient**: Only 1 transaction fee instead of 3
- **Faster**: Single confirmation instead of 3
- **Safer**: No partial state (e.g., no risk of withdrawing but forgetting to close)

**Example Usage:**
```bash
curl -X POST http://localhost:3001/api/positions/withdraw-claim-close \
  -H "Content-Type: application/json" \
  -d '{"positionMint": "PositionNFT111111111111111111111111111111111"}'
```

---

## Error Handling

All endpoints return errors in the following format:

```json
{
  "error": "Error description",
  "message": "Detailed error message"
}
```

HTTP status codes:
- `200` - Success
- `400` - Bad request (missing parameters)
- `500` - Server error

---

## CORS

CORS is enabled for all routes, allowing web UI integration.

---

## Implementation Details

- **Framework**: Hono (lightweight, fast web framework)
- **Runtime**: Bun (JavaScript runtime, faster than Node.js)
- **Port**: 3001 (configurable via `API_PORT` env var)
- **File**: `src/api/hono-server.ts`
- **Adapter**: Uses `MeteoraAdapter` singleton for on-chain operations

---

## Related Documentation

- [CLAUDE.md](../CLAUDE.md) - Project overview and architecture
- [progress.md](../progress.md) - Development progress and implementation notes
- [epics.md](../epics.md) - Feature epics and acceptance criteria
