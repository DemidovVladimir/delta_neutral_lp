/**
 * Bun + Hono API Server for Meteora LP UI
 *
 * Exposes REST endpoints using Hono framework for:
 * - Pool analytics and bin data
 * - Oracle price feeds (Pyth + Jupiter)
 * - LP position management (minimal API: create + withdraw-claim-close)
 * - Real-time price updates
 *
 * Note: This API server provides minimal endpoints focused on auto-tune bot functionality.
 * Only `createPosition()` and `withdrawClaimAndClose()` are exposed for LP operations.
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { MeteoraAdapter } from '../modules/meteoraAdapter.js';
import { getSolPrice, getMultiTokenPrices } from '../core/priceOracle.js';
import { getConnection } from '../utils/solana.js';
import { PublicKey } from '@solana/web3.js';
import DLMMModule from '@meteora-ag/dlmm';
import { getConfig } from '../config/env.js';
import { log } from '../utils/logger.js';
import { getActiveBin, getPriceFromBinId } from '../utils/meteoraUtils.js';
import { DECIMALS } from '../config/constants.js';

// @ts-ignore
const DLMM: any = DLMMModule.default || DLMMModule;

const PORT = Number(process.env.API_PORT) || 3001;

// Initialize Hono app
const app = new Hono();

// Enable CORS for all routes
app.use('*', cors());

// Initialize Meteora adapter (singleton)
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
    const config = getConfig();
    const connection = getConnection();
    const poolPubkey = new PublicKey(config.meteoraPoolAddress!);
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

// Create a new LP position
app.post('/api/positions/create', async (c) => {
  try {
    const body = await c.req.json();
    const { solAmount, usdcAmount, priceLower, priceUpper } = body;

    if (!solAmount || !priceLower || !priceUpper) {
      return c.json(
        {
          error: 'Missing required parameters',
          required: ['solAmount', 'priceLower', 'priceUpper'],
        },
        400
      );
    }

    const adapter = getMeteoraAdapter();
    const config = getConfig();

    const result = await adapter.createPosition({
      poolAddress: config.meteoraPoolAddress!,
      solAmount: parseFloat(solAmount),
      usdcAmount: parseFloat(usdcAmount || '0'),
      priceLower: parseFloat(priceLower),
      priceUpper: parseFloat(priceUpper),
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
    const body = await c.req.json();
    const { positionMint } = body;

    if (!positionMint) {
      return c.json({ error: 'Missing required parameter: positionMint' }, 400);
    }

    const adapter = getMeteoraAdapter();
    const result = await adapter.withdrawClaimAndClose(positionMint);

    return c.json({
      signature: result.signature,
      claimedFees: result.claimedFees,
      success: true,
      message: 'Withdraw + Claim + Close completed in 1 atomic transaction. Position closed and rent reclaimed (~0.057 SOL).'
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

// Start Bun server with Hono
log.info(`🚀 Bun + Hono API server starting on port ${PORT}`);
console.log(`🚀 Bun + Hono API server starting on port ${PORT}`);

export default {
  port: PORT,
  fetch: app.fetch,
};
