/**
 * Bun Native HTTP Server for Meteora LP UI
 *
 * Exposes REST endpoints using Bun's native HTTP server for:
 * - Pool analytics and bin data
 * - Oracle price feeds (Pyth + Jupiter)
 * - LP position management
 * - Real-time price updates
 */

import { MeteoraAdapter } from '../modules/meteoraAdapter.js';
import { getSolPrice, getMultiTokenPrices } from '../core/priceOracle.js';
import { getConnection } from '../core/agentKit.js';
import { PublicKey } from '@solana/web3.js';
import DLMMModule from '@meteora-ag/dlmm';
import { getConfig } from '../config/env.js';
import { log } from '../utils/logger.js';
import { getActiveBin, getPriceFromBinId } from '../utils/meteoraUtils.js';
import { DECIMALS } from '../config/constants.js';

// @ts-ignore
const DLMM: any = DLMMModule.default || DLMMModule;

const PORT = process.env.API_PORT || 3001;

// Initialize Meteora adapter (singleton)
let meteoraAdapter: MeteoraAdapter | null = null;

function getMeteoraAdapter(): MeteoraAdapter {
  if (!meteoraAdapter) {
    meteoraAdapter = new MeteoraAdapter();
  }
  return meteoraAdapter;
}

// Helper function to create JSON response
function jsonResponse(data: any, status: number = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

// Router function
async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method;

  // Handle CORS preflight
  if (method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }

  try {
    // Health check
    if (path === '/api/health' && method === 'GET') {
      return jsonResponse({ status: 'ok', timestamp: Date.now() });
    }

    // Get prices from oracles
    if (path === '/api/prices' && method === 'GET') {
      const [solPrice, multiTokenPrices] = await Promise.all([
        getSolPrice(),
        getMultiTokenPrices(),
      ]);

      return jsonResponse({
        sol: solPrice,
        multiToken: multiTokenPrices,
        timestamp: Date.now(),
      });
    }

    // Get list of available pools
    if (path === '/api/pools' && method === 'GET') {
      const config = getConfig();
      const poolAddresses = config.meteoraPoolAddresses || [];

      return jsonResponse({
        pools: poolAddresses,
        count: poolAddresses.length,
        timestamp: Date.now(),
      });
    }

    // Get pool analytics
    if (path === '/api/pool/analytics' && method === 'GET') {
      const adapter = getMeteoraAdapter();
      const poolInfo = await adapter.getPoolAnalytics();
      return jsonResponse(poolInfo);
    }

    // Get bin distribution
    if (path === '/api/pool/bins' && method === 'GET') {
      const config = getConfig();
      const connection = getConnection();

      // Use primary pool address (first in array)
      const poolAddresses = config.meteoraPoolAddresses || [];
      if (poolAddresses.length === 0) {
        return jsonResponse({ error: 'No pool addresses configured' }, 400);
      }

      const poolPubkey = new PublicKey(poolAddresses[0]);
      const dlmmPool = await DLMM.create(connection, poolPubkey);

      const activeBinData = await getActiveBin(dlmmPool);
      const binStep = dlmmPool.lbPair.binStep;

      // Calculate bins around active bin
      const binRange = 50;
      const bins = [];

      for (let offset = -binRange; offset <= binRange; offset++) {
        const binId = activeBinData.binId + offset;
        const price = getPriceFromBinId(binId, binStep, DECIMALS.SOL, DECIMALS.USDC);

        bins.push({
          binId,
          price: price.toNumber(),
          isActive: binId === activeBinData.binId,
        });
      }

      return jsonResponse({
        activeBin: {
          binId: activeBinData.binId,
          price: activeBinData.pricePerToken,
        },
        binStep,
        bins,
        timestamp: Date.now(),
      });
    }

    // Get LP positions
    if (path === '/api/positions' && method === 'GET') {
      const adapter = getMeteoraAdapter();
      const exposure = await adapter.getLpExposure();

      return jsonResponse({
        exposure,
        positionMints: adapter.getPositionMints(),
        timestamp: Date.now(),
      });
    }

    // Create position
    if (path === '/api/positions/create' && method === 'POST') {
      const body = await req.json();
      const { solAmount, usdcAmount, priceLower, priceUpper, poolAddress } = body;

      if (!solAmount || !priceLower || !priceUpper) {
        return jsonResponse(
          {
            error: 'Missing required parameters',
            required: ['solAmount', 'priceLower', 'priceUpper'],
          },
          400
        );
      }

      const adapter = getMeteoraAdapter();
      const config = getConfig();

      // Get available pools
      const availablePoolAddresses = config.meteoraPoolAddresses || [];
      if (availablePoolAddresses.length === 0) {
        return jsonResponse({ error: 'No pool addresses configured' }, 400);
      }

      // Use specified pool or default to primary pool
      const selectedPoolAddress = poolAddress || availablePoolAddresses[0];

      // Validate pool is in configured pools
      if (!availablePoolAddresses.includes(selectedPoolAddress)) {
        return jsonResponse(
          {
            error: 'Invalid pool address',
            message: `Pool ${selectedPoolAddress} is not in configured pools`,
            availablePools: availablePoolAddresses,
          },
          400
        );
      }

      const result = await adapter.createPosition({
        poolAddress: selectedPoolAddress,
        solAmount: parseFloat(solAmount),
        usdcAmount: parseFloat(usdcAmount || '0'),
        priceLower: parseFloat(priceLower),
        priceUpper: parseFloat(priceUpper),
      });

      return jsonResponse(result);
    }

    // Deposit to position
    if (path === '/api/positions/deposit' && method === 'POST') {
      const body = await req.json();
      const { sol, usdc, singleSided } = body;

      const adapter = getMeteoraAdapter();
      const signature = await adapter.depositToLp({
        sol: sol ? parseFloat(sol) : undefined,
        usdc: usdc ? parseFloat(usdc) : undefined,
        singleSided: singleSided || undefined,
      });

      return jsonResponse({ signature, success: true });
    }

    // Withdraw from position
    if (path === '/api/positions/withdraw' && method === 'POST') {
      const body = await req.json();
      const { percent } = body;

      if (!percent) {
        return jsonResponse({ error: 'Missing required parameter: percent' }, 400);
      }

      const adapter = getMeteoraAdapter();
      const signature = await adapter.withdrawFromLp({
        percent: parseFloat(percent),
      });

      return jsonResponse({ signature, success: true });
    }

    // Claim fees
    if (path === '/api/positions/claim-fees' && method === 'POST') {
      const adapter = getMeteoraAdapter();
      const result = await adapter.claimFees();
      return jsonResponse(result);
    }

    // 404
    return jsonResponse({ error: 'Not found', path }, 404);
  } catch (error) {
    log.error('API error', {
      path,
      method,
      error: error instanceof Error ? error.message : String(error),
    });

    return jsonResponse(
      {
        error: 'Internal server error',
        message: error instanceof Error ? error.message : String(error),
      },
      500
    );
  }
}

// Start Bun HTTP server
const server = Bun.serve({
  port: PORT,
  fetch: handleRequest,
});

log.info(`🚀 Bun API server running on http://localhost:${server.port}`);
console.log(`🚀 Bun API server running on http://localhost:${server.port}`);

export default server;
