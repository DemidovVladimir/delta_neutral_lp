/**
 * Bun + Hono API Server for Meteora LP UI
 *
 * Exposes REST endpoints using Hono framework for:
 * - Pool analytics and bin data
 * - Oracle price feeds (Pyth + Jupiter)
 * - LP position management (minimal API: create + withdraw-claim-close)
 * - Real-time price updates
 *
 * Security model:
 * - GET endpoints (read-only data) are open and CORS-protected.
 * - POST endpoints (LP position mutations — fund-affecting) require:
 *     1. A valid `X-API-Key` header matching `API_KEY` from env.
 *     2. A request origin in `API_ALLOWED_ORIGINS` (CORS).
 *     3. Rate-limit budget below `API_RATE_LIMIT_PER_MIN` per remote IP.
 *     4. Body validation (types, ranges, signedness).
 * - When `API_KEY` is unset the server fail-closes POST endpoints (503) so
 *   an accidentally-exposed port can never move funds without explicit auth.
 */

import { Hono, type Context, type Next } from 'hono';
import { cors } from 'hono/cors';
import { MeteoraAdapter } from '../modules/meteoraAdapter.js';
import { getSolPrice, getMultiTokenPrices } from '../core/priceOracle.js';
import { getConnection } from '../utils/solana.js';
import { PublicKey } from '@solana/web3.js';
import { getConfig } from '../config/env.js';
import { log } from '../utils/logger.js';
import { DLMM } from '../utils/dlmm.js';
import { getActiveBin, getPriceFromBinId } from '../utils/meteoraUtils.js';
import { DECIMALS } from '../config/constants.js';

const PORT = Number(process.env.API_PORT) || 3001;

// Initialize Hono app
const app = new Hono();
const config = getConfig();

// ─────────────────────────────────────────────────────────────────────────────
// CORS
// ─────────────────────────────────────────────────────────────────────────────
// Restrict to configured origins. Empty list == same-origin only (no
// `Access-Control-Allow-Origin` granted to cross-origin callers). The previous
// `cors()` call here used wildcard origin, which combined with unauthenticated
// POST endpoints meant any web page the operator visited could have fired
// fund-moving requests at localhost:3001.
const allowedOrigins = config.apiAllowedOrigins;
app.use(
  '*',
  cors({
    origin: (incomingOrigin) => {
      if (!incomingOrigin) return null;
      return allowedOrigins.includes(incomingOrigin) ? incomingOrigin : null;
    },
    allowHeaders: ['Content-Type', 'X-API-Key'],
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    credentials: false,
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// Rate limit (per remote IP, fixed-window, in-memory)
// ─────────────────────────────────────────────────────────────────────────────
// Applied only to mutating POST routes below. In-memory map is fine for a
// single-process bot; if we ever scale horizontally, swap for Redis-backed.
type Bucket = { count: number; windowStartMs: number };
const rateBuckets = new Map<string, Bucket>();
const WINDOW_MS = 60_000;

function getRemoteIp(c: Context): string {
  // Hono on Bun exposes the connection address via `c.env`/`c.req.raw`. Try a
  // few known headers (set by reverse proxies) before falling back to a
  // sentinel. We don't trust these for auth — only for grouping.
  return (
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
    c.req.header('x-real-ip') ||
    'unknown'
  );
}

async function rateLimitMiddleware(c: Context, next: Next) {
  const ip = getRemoteIp(c);
  const now = Date.now();
  const limit = config.apiRateLimitPerMin;
  const bucket = rateBuckets.get(ip);

  if (!bucket || now - bucket.windowStartMs >= WINDOW_MS) {
    rateBuckets.set(ip, { count: 1, windowStartMs: now });
    return next();
  }

  bucket.count += 1;
  if (bucket.count > limit) {
    const retryAfterSec = Math.ceil((WINDOW_MS - (now - bucket.windowStartMs)) / 1000);
    log.warn('Rate limit exceeded', { ip, count: bucket.count, limit });
    c.header('Retry-After', String(retryAfterSec));
    return c.json(
      { error: 'Rate limit exceeded', retryAfterSec, limitPerMin: limit },
      429
    );
  }
  return next();
}

// Periodic cleanup so the map doesn't grow unboundedly under unique-IP attack.
// Runs every 5 min; cheap, so no need to be smarter.
setInterval(() => {
  const now = Date.now();
  for (const [ip, bucket] of rateBuckets) {
    if (now - bucket.windowStartMs >= WINDOW_MS) rateBuckets.delete(ip);
  }
}, 5 * 60_000);

// ─────────────────────────────────────────────────────────────────────────────
// Auth (API key, fail-closed)
// ─────────────────────────────────────────────────────────────────────────────
// Constant-time string compare so a malicious caller can't time-side-channel
// the configured key out of us by sending varying-prefix guesses.
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

async function apiKeyAuthMiddleware(c: Context, next: Next) {
  const expected = config.apiKey;
  if (!expected) {
    // Fail-closed: refuse mutations until the operator deliberately sets a
    // key. Returning 503 (not 401) signals "the server is misconfigured for
    // this kind of request", which is the truth.
    log.warn('Rejecting POST request: API_KEY is not configured', {
      path: c.req.path,
      ip: getRemoteIp(c),
    });
    return c.json(
      {
        error: 'API authentication not configured',
        hint: 'Set the API_KEY environment variable to enable mutating endpoints.',
      },
      503
    );
  }
  const provided = c.req.header('x-api-key') ?? '';
  if (!timingSafeEqual(provided, expected)) {
    log.warn('Rejected POST request: invalid API key', {
      path: c.req.path,
      ip: getRemoteIp(c),
      provided: provided ? `${provided.slice(0, 4)}…(${provided.length} chars)` : '(none)',
    });
    return c.json({ error: 'Invalid or missing API key' }, 401);
  }
  return next();
}

// ─────────────────────────────────────────────────────────────────────────────
// Body validators
// ─────────────────────────────────────────────────────────────────────────────
// Plain functions that throw a typed error. Avoids pulling in zod for a
// two-endpoint surface.
class ValidationError extends Error {
  readonly details: Record<string, unknown>;
  constructor(message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'ValidationError';
    this.details = details;
  }
}

function asPositiveFiniteNumber(value: unknown, field: string): number {
  if (typeof value === 'string') value = Number(value);
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ValidationError(`${field} must be a finite number`, { field, value });
  }
  if (value < 0) {
    throw new ValidationError(`${field} must be >= 0`, { field, value });
  }
  return value;
}

function asNonEmptyString(value: unknown, field: string, maxLen = 100): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ValidationError(`${field} must be a non-empty string`, { field });
  }
  if (value.length > maxLen) {
    throw new ValidationError(`${field} too long (max ${maxLen})`, { field, length: value.length });
  }
  return value.trim();
}

function asValidPublicKey(value: unknown, field: string): string {
  const s = asNonEmptyString(value, field, 64);
  try {
    new PublicKey(s);
  } catch {
    throw new ValidationError(`${field} is not a valid Solana public key`, { field });
  }
  return s;
}

interface CreatePositionBody {
  solAmount: number;
  usdcAmount: number;
  priceLower: number;
  priceUpper: number;
}

function validateCreatePositionBody(body: unknown): CreatePositionBody {
  if (!body || typeof body !== 'object') {
    throw new ValidationError('Request body must be a JSON object');
  }
  const b = body as Record<string, unknown>;
  const solAmount = asPositiveFiniteNumber(b.solAmount, 'solAmount');
  const usdcAmount = asPositiveFiniteNumber(b.usdcAmount ?? 0, 'usdcAmount');
  const priceLower = asPositiveFiniteNumber(b.priceLower, 'priceLower');
  const priceUpper = asPositiveFiniteNumber(b.priceUpper, 'priceUpper');

  if (priceLower >= priceUpper) {
    throw new ValidationError('priceLower must be strictly less than priceUpper', {
      priceLower,
      priceUpper,
    });
  }
  if (solAmount === 0 && usdcAmount === 0) {
    throw new ValidationError('At least one of solAmount or usdcAmount must be > 0');
  }
  // Sanity ceilings — protect against a fat-finger from any client. Tune if
  // your wallet routinely opens larger positions.
  if (solAmount > 1_000) {
    throw new ValidationError('solAmount exceeds sanity ceiling (1000 SOL)', { solAmount });
  }
  if (usdcAmount > 1_000_000) {
    throw new ValidationError('usdcAmount exceeds sanity ceiling (1,000,000 USDC)', { usdcAmount });
  }
  return { solAmount, usdcAmount, priceLower, priceUpper };
}

// ─────────────────────────────────────────────────────────────────────────────
// Routes
// ─────────────────────────────────────────────────────────────────────────────
let meteoraAdapter: MeteoraAdapter | null = null;

function getMeteoraAdapter(): MeteoraAdapter {
  if (!meteoraAdapter) {
    meteoraAdapter = new MeteoraAdapter();
  }
  return meteoraAdapter;
}

// Health check endpoint
app.get('/api/health', (c) => {
  return c.json({ status: 'ok', timestamp: Date.now() });
});

// Get prices from oracles (Pyth + Jupiter)
app.get('/api/prices', async (c) => {
  try {
    const [solPrice, multiTokenPrices] = await Promise.all([
      getSolPrice(),
      getMultiTokenPrices(),
    ]);

    return c.json({
      sol: solPrice,
      multiToken: multiTokenPrices,
      timestamp: Date.now(),
    });
  } catch (error) {
    log.error('Failed to fetch prices', { error });
    return c.json(
      {
        error: 'Failed to fetch prices',
        message: error instanceof Error ? error.message : String(error),
      },
      500
    );
  }
});

// Get pool analytics from Meteora API
app.get('/api/pool/analytics', async (c) => {
  try {
    const adapter = getMeteoraAdapter();
    const poolInfo = await adapter.getPoolAnalytics();
    return c.json(poolInfo);
  } catch (error) {
    log.error('Failed to fetch pool analytics', { error });
    return c.json(
      {
        error: 'Failed to fetch pool analytics',
        message: error instanceof Error ? error.message : String(error),
      },
      500
    );
  }
});

// Get bin distribution and active bin data
app.get('/api/pool/bins', async (c) => {
  try {
    const cfg = getConfig();
    const connection = getConnection();
    const poolPubkey = new PublicKey(cfg.meteoraPoolAddress!);
    const dlmmPool = await DLMM.create(connection, poolPubkey);

    const activeBinData = await getActiveBin(dlmmPool);
    const binStep = dlmmPool.lbPair.binStep;

    // Fetch bin arrays with liquidity data from the pool
    const binRange = 50;
    const minBinId = activeBinData.binId - binRange;
    const maxBinId = activeBinData.binId + binRange;

    // Get bin data from DLMM pool (includes liquidity amounts)
    const binArraysResponse = await dlmmPool.getBinsBetweenMinAndMaxPrice(
      minBinId,
      maxBinId
    );

    // Extract bins array from response object
    const binArrays = binArraysResponse.bins || [];

    // Process bins with liquidity data
    const bins = [];
    for (let binId = minBinId; binId <= maxBinId; binId++) {
      const price = getPriceFromBinId(binId, binStep, DECIMALS.SOL, DECIMALS.USDC);

      // Find bin data from DLMM (if it has liquidity)
      const binData = binArrays.find((b: any) => b.binId === binId);

      // Calculate total liquidity in USD for this bin
      let liquidityUsd = 0;
      let xAmount = 0;
      let yAmount = 0;

      if (binData) {
        // Convert lamports to tokens
        xAmount = parseFloat(binData.xAmount || '0') / 10 ** DECIMALS.SOL;
        yAmount = parseFloat(binData.yAmount || '0') / 10 ** DECIMALS.USDC;

        // Calculate USD value (SOL * price + USDC)
        liquidityUsd = (xAmount * price.toNumber()) + yAmount;
      }

      bins.push({
        binId,
        price: price.toNumber(),
        liquidity: liquidityUsd,
        xAmount, // SOL amount
        yAmount, // USDC amount
        isActive: binId === activeBinData.binId,
      });
    }

    return c.json({
      activeBin: {
        binId: activeBinData.binId,
        price: activeBinData.pricePerToken,
      },
      binStep,
      bins,
      totalLiquidity: bins.reduce((sum, b) => sum + b.liquidity, 0),
      timestamp: Date.now(),
    });
  } catch (error) {
    log.error('Failed to fetch bin data', { error });
    return c.json(
      {
        error: 'Failed to fetch bin data',
        message: error instanceof Error ? error.message : String(error),
      },
      500
    );
  }
});

// Get LP positions and exposure
app.get('/api/positions', async (c) => {
  try {
    const adapter = getMeteoraAdapter();
    const exposure = await adapter.getLpExposure();

    return c.json({
      exposure,
      positionMints: adapter.getPositionMints(),
      timestamp: Date.now(),
    });
  } catch (error) {
    log.error('Failed to fetch LP positions', { error });
    return c.json(
      {
        error: 'Failed to fetch LP positions',
        message: error instanceof Error ? error.message : String(error),
      },
      500
    );
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Mutating routes — guarded by rateLimit + apiKey + validation
// ─────────────────────────────────────────────────────────────────────────────
app.use('/api/positions/create', rateLimitMiddleware, apiKeyAuthMiddleware);
app.use('/api/positions/withdraw-claim-close', rateLimitMiddleware, apiKeyAuthMiddleware);

// Create a new LP position
app.post('/api/positions/create', async (c) => {
  try {
    const rawBody = await c.req.json().catch(() => null);

    let validated: CreatePositionBody;
    try {
      validated = validateCreatePositionBody(rawBody);
    } catch (err) {
      if (err instanceof ValidationError) {
        return c.json({ error: err.message, details: err.details }, 400);
      }
      throw err;
    }

    const adapter = getMeteoraAdapter();
    const cfg = getConfig();

    const result = await adapter.createPosition({
      poolAddress: cfg.meteoraPoolAddress!,
      solAmount: validated.solAmount,
      usdcAmount: validated.usdcAmount,
      priceLower: validated.priceLower,
      priceUpper: validated.priceUpper,
    });

    return c.json(result);
  } catch (error) {
    log.error('Failed to create position', { error });
    return c.json(
      {
        error: 'Failed to create position',
        message: error instanceof Error ? error.message : String(error),
      },
      500
    );
  }
});

// Withdraw 100%, claim fees, and close position in ONE ATOMIC transaction
app.post('/api/positions/withdraw-claim-close', async (c) => {
  try {
    const rawBody = await c.req.json().catch(() => null);
    let positionMint: string;
    try {
      if (!rawBody || typeof rawBody !== 'object') {
        throw new ValidationError('Request body must be a JSON object');
      }
      const b = rawBody as Record<string, unknown>;
      positionMint = asValidPublicKey(b.positionMint, 'positionMint');
    } catch (err) {
      if (err instanceof ValidationError) {
        return c.json({ error: err.message, details: err.details }, 400);
      }
      throw err;
    }

    const adapter = getMeteoraAdapter();
    const result = await adapter.withdrawClaimAndClose(positionMint);

    return c.json({
      signature: result.signature,
      claimedFees: result.claimedFees,
      success: true,
      message:
        'Withdraw + Claim + Close completed in 1 atomic transaction. Position closed and rent reclaimed (~0.057 SOL).',
    });
  } catch (error) {
    log.error('Failed to withdraw, claim, and close position', { error });
    return c.json(
      {
        error: 'Failed to withdraw, claim, and close position',
        message: error instanceof Error ? error.message : String(error),
      },
      500
    );
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Startup
// ─────────────────────────────────────────────────────────────────────────────
log.info(`🚀 Bun + Hono API server starting on port ${PORT}`);
log.info('API security configuration', {
  apiKeyConfigured: Boolean(config.apiKey),
  allowedOrigins: config.apiAllowedOrigins,
  rateLimitPerMin: config.apiRateLimitPerMin,
});
if (!config.apiKey) {
  log.warn(
    '⚠️  API_KEY is not set. POST /api/positions/* will return 503 until you set it. ' +
    'GET endpoints remain available. This is intentional fail-closed behaviour — set API_KEY ' +
    'in your environment to enable mutating endpoints.'
  );
}
console.log(`🚀 Bun + Hono API server starting on port ${PORT}`);

export default {
  port: PORT,
  fetch: app.fetch,
};
