/**
 * Mainnet Integration Test for Meteora Adapter
 *
 * ⚠️  WARNING: This tests on REAL mainnet with REAL funds!
 *
 * This script:
 * 1. Checks wallet SOL and USDC balances
 * 2. Creates a balanced SOL/USDC position on Meteora
 * 3. Reads LP exposure
 *
 * Prerequisites:
 * 1. Mainnet wallet with at least 0.2 SOL (for deposit + fees)
 * 2. Mainnet wallet with at least 10 USDC
 * 3. .env.mainnet configured
 *
 * Usage:
 *   NODE_ENV=mainnet npx tsx src/test/mainnet-meteora-test.ts
 */

import { LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddress, getAccount } from '@solana/spl-token';
import { config } from 'dotenv';
import { MeteoraAdapter } from '../modules/meteoraAdapter.js';
import { initializeAgentKit, getWalletKeypair, getConnection } from '../core/agentKit.js';
import { getSolPrice } from '../core/priceOracle.js';
import { log } from '../utils/logger.js';
import { getConfig } from '../config/env.js';

// Load mainnet environment
config({ path: '.env.mainnet' });

const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');

interface TestResults {
  balanceCheck: boolean;
  positionCreation?: boolean;
  exposureRead?: boolean;
  errors: string[];
}

async function checkBalances(): Promise<{ sol: number; usdc: number }> {
  const connection = getConnection();
  const wallet = getWalletKeypair();

  // Check SOL balance
  const solBalance = await connection.getBalance(wallet.publicKey);
  const solAmount = solBalance / LAMPORTS_PER_SOL;

  // Check USDC balance
  let usdcAmount = 0;
  try {
    const usdcAta = await getAssociatedTokenAddress(
      USDC_MINT,
      wallet.publicKey,
      false,
      TOKEN_PROGRAM_ID
    );
    const usdcAccount = await getAccount(connection, usdcAta, 'confirmed', TOKEN_PROGRAM_ID);
    usdcAmount = Number(usdcAccount.amount) / 1_000_000;
  } catch (error) {
    log.warn('No USDC account found or insufficient balance');
  }

  return { sol: solAmount, usdc: usdcAmount };
}

async function runMainnetTest(): Promise<TestResults> {
  const results: TestResults = {
    balanceCheck: false,
    errors: [],
  };

  try {
    log.info('='.repeat(70));
    log.info('⚠️  MAINNET TEST - USING REAL FUNDS ⚠️');
    log.info('='.repeat(70));

    // Initialize
    log.info('\n[1/5] Initializing wallet...');
    await initializeAgentKit();
    const wallet = getWalletKeypair();
    const cfg = getConfig();

    log.info('Wallet:', wallet.publicKey.toBase58());
    log.info('Pool:', cfg.meteoraPoolAddress);

    // Check balances
    log.info('\n[2/5] Checking balances...');
    const balances = await checkBalances();

    log.info('Current balances:', {
      sol: balances.sol,
      usdc: balances.usdc,
    });

    // Verify sufficient balances
    const requiredSol = cfg.initialDepositSol! + 0.1; // Extra for fees
    const requiredUsdc = cfg.initialDepositUsdc!;

    if (balances.sol < requiredSol) {
      throw new Error(
        `Insufficient SOL. Have: ${balances.sol}, Need: ${requiredSol} (${cfg.initialDepositSol} + 0.1 for fees)`
      );
    }

    if (balances.usdc < requiredUsdc) {
      throw new Error(
        `Insufficient USDC. Have: ${balances.usdc}, Need: ${requiredUsdc}`
      );
    }

    results.balanceCheck = true;
    log.info('✅ Balance check passed');

    // Get price
    log.info('\n[3/5] Fetching SOL price...');
    const price = await getSolPrice();
    log.info('SOL price:', {
      usd: price.usd,
      source: price.source,
    });

    // Create position
    log.info('\n[4/5] Creating balanced position...');
    log.info('⚠️  This will use REAL funds on mainnet!');
    log.info('Position parameters:', {
      sol: cfg.initialDepositSol,
      usdc: cfg.initialDepositUsdc,
      total: `~$${(cfg.initialDepositSol! * price.usd + cfg.initialDepositUsdc!).toFixed(2)}`,
      priceRange: `${cfg.priceRangeBpsLower! / 100}% to ${cfg.priceRangeBpsUpper! / 100}%`,
    });

    log.info('\n⏳ Creating position (this may take 30-60 seconds)...');

    const adapter = new MeteoraAdapter();
    const created = await adapter.autoCreatePositionIfNeeded();

    if (created) {
      results.positionCreation = true;
      log.info('✅ Position created successfully!');
      log.info('Position mints:', adapter.getPositionMints());
    } else {
      log.warn('Position already exists');
    }

    // Read exposure
    log.info('\n[5/5] Reading LP exposure...');
    const exposure = await adapter.getLpExposure();

    log.info('LP Exposure:', {
      solAmount: exposure.solAmount,
      usdcAmount: exposure.usdcAmount,
      totalUsd: exposure.totalUsd,
      positionCount: exposure.positions.length,
    });

    if (exposure.positions.length > 0) {
      log.info('Position details:');
      exposure.positions.forEach((pos, idx) => {
        log.info(`  ${idx + 1}. ${pos.mint}`, {
          sol: pos.solAmount,
          usdc: pos.usdcAmount,
          value: pos.valueUsd,
        });
      });
    }

    results.exposureRead = true;
    log.info('✅ Exposure read successfully');

    return results;
  } catch (error) {
    const msg = `Test failed: ${error instanceof Error ? error.message : String(error)}`;
    results.errors.push(msg);
    log.error(msg, { error });
    return results;
  }
}

// Print summary
function printSummary(results: TestResults) {
  log.info('\n' + '='.repeat(70));
  log.info('MAINNET TEST SUMMARY');
  log.info('='.repeat(70));

  const tests = [
    { name: 'Balance Check', result: results.balanceCheck },
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
    log.info('\nErrors:');
    results.errors.forEach((err, idx) => {
      log.error(`${idx + 1}. ${err}`);
    });
  }

  log.info('='.repeat(70));
}

// Run test
(async () => {
  try {
    const results = await runMainnetTest();
    printSummary(results);

    const success = results.errors.length === 0 && results.balanceCheck;
    process.exit(success ? 0 : 1);
  } catch (error) {
    log.error('Fatal error:', error instanceof Error ? error : { error });
    process.exit(1);
  }
})();
