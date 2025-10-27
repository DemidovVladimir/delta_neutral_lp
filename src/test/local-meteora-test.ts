/**
 * Local Validator Integration Test for Meteora Adapter
 *
 * This script tests the Meteora adapter against a local Solana validator
 * with a mainnet-forked Meteora DLMM pool.
 *
 * Prerequisites:
 * 1. Start localnet with mainnet fork: npm run localnet:start
 *    (This clones the Meteora DLMM program and a real SOL/USDC pool from mainnet)
 * 2. Test wallet with SOL balance (airdropped automatically by start script)
 * 3. .env.local configured with mainnet pool address
 *
 * Usage:
 *   npm run test:local
 *   # or
 *   NODE_ENV=local pnpm tsx src/test/local-meteora-test.ts
 */

import { LAMPORTS_PER_SOL } from '@solana/web3.js';
import { config } from 'dotenv';
import { MeteoraAdapter } from '../modules/meteoraAdapter.js';
import { initializeAgentKit, getWalletKeypair, getConnection } from '../core/agentKit.js';
import { getSolPrice } from '../core/priceOracle.js';
import { log } from '../utils/logger.js';
import { getConfig } from '../config/env.js';

// Load local environment
config({ path: '.env.local' });

interface TestResults {
  validatorCheck: boolean;
  walletCheck: boolean;
  priceOracle: boolean;
  positionCreation?: boolean;
  exposureRead?: boolean;
  errors: string[];
}

async function checkLocalValidator(): Promise<boolean> {
  try {
    const connection = getConnection();
    const version = await connection.getVersion();
    const slot = await connection.getSlot();

    log.info('Local validator info:', {
      version: version['solana-core'],
      featureSet: version['feature-set'],
      slot,
    });

    return true;
  } catch (error) {
    log.error('Failed to connect to local validator:', {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

async function runLocalTests(): Promise<TestResults> {
  const results: TestResults = {
    validatorCheck: false,
    walletCheck: false,
    priceOracle: false,
    errors: [],
  };

  try {
    log.info('='.repeat(60));
    log.info('METEORA ADAPTER LOCAL VALIDATOR TEST');
    log.info('Testing with mainnet-forked pool');
    log.info('='.repeat(60));

    // Step 1: Check local validator connection
    log.info('\n[1/7] Checking local validator connection...');
    results.validatorCheck = await checkLocalValidator();

    if (!results.validatorCheck) {
      throw new Error(
        'Cannot connect to local validator. Is solana-test-validator running?'
      );
    }
    log.info('✅ Local validator check passed');

    // Step 2: Initialize and check wallet
    log.info('\n[2/7] Initializing wallet...');
    await initializeAgentKit();
    const wallet = getWalletKeypair();
    const connection = getConnection();
    const cfg = getConfig();

    const balance = await connection.getBalance(wallet.publicKey);
    const balanceSol = balance / LAMPORTS_PER_SOL;

    log.info('Wallet info:', {
      address: wallet.publicKey.toBase58(),
      balance: balanceSol,
    });

    if (balanceSol < 10) {
      log.warn(`Low SOL balance: ${balanceSol}. Requesting airdrop...`);
      try {
        const airdropSig = await connection.requestAirdrop(
          wallet.publicKey,
          10 * LAMPORTS_PER_SOL
        );
        const latestBlockhash = await connection.getLatestBlockhash();
        await connection.confirmTransaction({
          signature: airdropSig,
          ...latestBlockhash,
        });
        const newBalance = await connection.getBalance(wallet.publicKey);
        log.info(`Airdrop successful. New balance: ${newBalance / LAMPORTS_PER_SOL} SOL`);
      } catch (error) {
        throw new Error(`Airdrop failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    results.walletCheck = true;
    log.info('✅ Wallet check passed');

    // Step 3: Check price oracle (may use mock data for local)
    log.info('\n[3/7] Testing price oracle...');
    try {
      const priceData = await getSolPrice();
      log.info('SOL price:', {
        usd: priceData.usd,
        source: priceData.source,
        timestamp: new Date(priceData.timestamp).toISOString(),
      });
      results.priceOracle = true;
      log.info('✅ Price oracle working');
    } catch (error) {
      const msg = `Price oracle failed: ${error instanceof Error ? error.message : String(error)}`;
      log.warn(msg);
      log.warn('This is OK for local testing - will use fallback price');
      results.priceOracle = false;
    }

    // Step 4: Check Meteora program
    log.info('\n[4/7] Checking Meteora program...');
    if (!cfg.meteoraPoolAddress) {
      log.warn('⚠️  METEORA_POOL_ADDRESS not set in .env.local');
      log.info('');
      log.info('To use a mainnet-forked pool:');
      log.info('1. Run: npm run localnet:start');
      log.info('2. Set METEORA_POOL_ADDRESS in .env.local to a mainnet pool');
      log.info('   (e.g., 5rCf1DM8LjKTw4YqhnoLcngyZYeNnQqztScTogYHAS6)');
      log.info('');
      log.info('For now, skipping position creation tests...');
    } else {
      log.info('Pool address configured:', { poolAddress: cfg.meteoraPoolAddress });

      // Step 5: Initialize Meteora adapter
      log.info('\n[5/7] Initializing Meteora adapter...');
      const adapter = new MeteoraAdapter();

      const existingMints = adapter.getPositionMints();
      log.info('Existing position mints:', existingMints);

      // Step 6: Try to create position
      if (cfg.autoCreatePositions && existingMints.length === 0) {
        log.info('\n[6/7] Creating test position...');
        try {
          const created = await adapter.autoCreatePositionIfNeeded();

          if (created) {
            results.positionCreation = true;
            log.info('✅ Position created successfully');
            log.info('Position mints:', adapter.getPositionMints());
          } else {
            log.info('Position already exists, skipping creation');
          }
        } catch (error) {
          const msg = `Position creation failed: ${error instanceof Error ? error.message : String(error)}`;
          results.errors.push(msg);
          log.error(msg);
          log.error('Full error:', error instanceof Error ? error : { error });
          results.positionCreation = false;
        }
      }

      // Step 7: Try to read exposure
      log.info('\n[7/7] Reading LP exposure...');
      try {
        const exposure = await adapter.getLpExposure();

        log.info('LP Exposure:', {
          solAmount: exposure.solAmount,
          usdcAmount: exposure.usdcAmount,
          totalUsd: exposure.totalUsd,
          claimableSol: exposure.claimableSol,
          claimableUsdc: exposure.claimableUsdc,
          positionCount: exposure.positions.length,
        });

        if (exposure.positions.length > 0) {
          log.info('Position details:', exposure.positions);
        }

        results.exposureRead = true;
        log.info('✅ LP exposure read successfully');
      } catch (error) {
        const msg = `Failed to read LP exposure: ${error instanceof Error ? error.message : String(error)}`;
        results.errors.push(msg);
        log.error(msg);
        results.exposureRead = false;
      }
    }

    return results;
  } catch (error) {
    const msg = `Test suite failed: ${error instanceof Error ? error.message : String(error)}`;
    results.errors.push(msg);
    log.error(msg, { error: error instanceof Error ? error : { error } });
    return results;
  }
}

function printSummary(results: TestResults) {
  log.info('\n' + '='.repeat(60));
  log.info('LOCAL TEST SUMMARY');
  log.info('='.repeat(60));

  const tests = [
    { name: 'Local Validator Connection', result: results.validatorCheck },
    { name: 'Wallet Setup', result: results.walletCheck },
    { name: 'Price Oracle', result: results.priceOracle },
    { name: 'Position Creation', result: results.positionCreation },
    { name: 'Exposure Read', result: results.exposureRead },
  ];

  let passed = 0;
  let total = 0;

  for (const test of tests) {
    if (test.result !== undefined) {
      total++;
      if (test.result) passed++;
      const status = test.result ? '✅ PASS' : '❌ FAIL';
      log.info(`${status} - ${test.name}`);
    }
  }

  log.info('');
  log.info(`Results: ${passed}/${total} tests passed`);

  if (results.errors.length > 0) {
    log.info('\nErrors encountered:');
    results.errors.forEach((err, idx) => {
      log.error(`${idx + 1}. ${err}`);
    });
  }

  log.info('='.repeat(60));
}

// Run tests
(async () => {
  try {
    const results = await runLocalTests();
    printSummary(results);

    const allPassed =
      results.errors.length === 0 &&
      results.validatorCheck &&
      results.walletCheck;

    process.exit(allPassed ? 0 : 1);
  } catch (error) {
    log.error('Unhandled error in test suite:', error instanceof Error ? error : { error });
    process.exit(1);
  }
})();
