#!/usr/bin/env node
/**
 * `pnpm derisk` — the RED BUTTON (ADR-021): one command to exit the whole
 * strategy into USDC. Operator-triggered only; the bot never runs this.
 *
 *   1. Close ALL Meteora LP positions (withdraw + claim + close).
 *   2. Emergency-unwind ALL Jupiter Perps sides at any price.
 *   3. Fold idle wSOL back to native SOL.
 *   4. Swap all SOL above reserves → USDC.
 *
 * DRY-RUN by default — prints the plan and current holdings. `--live` sends.
 * `--no-gate` disables the ADR-020 oracle gate for the final swap (in a real
 * crash you want out even at a shaky quote; slippage tolerance still applies).
 * `--keep-hedge` leaves the perp short open (exit LP+spot only — the short
 * then makes the portfolio net SHORT, which is a deliberate directional bet).
 *
 * ⚠️  STOP THE SERVER BOT FIRST (`bash -c 'source deploy/hetzner/lib.sh;
 * remote "cd /opt/delta-bot && docker compose stop"'`) — a live loop will
 * happily re-create the LP position and re-hedge right after you exit.
 */

// --no-gate must land in the environment BEFORE the config singleton loads.
if (process.argv.includes('--no-gate')) {
  process.env.SWAP_ORACLE_GATE_BPS = '0';
}

import { MeteoraAdapter } from '../modules/meteoraAdapter.js';
import { JupiterPerpsEngine } from '../modules/jupiterPerpsEngine.js';
import { JupiterSwapper } from '../modules/jupiterSwapper.js';
import { getConfig } from '../config/env.js';
import { getConnection, getWalletKeypair } from '../utils/solana.js';
import { getSolPrice } from '../core/priceOracle.js';
import { log } from '../utils/logger.js';

const SOL_MINT = 'So11111111111111111111111111111111111111112';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

async function main() {
  const args = process.argv.slice(2);
  const live = args.includes('--live');
  const keepHedge = args.includes('--keep-hedge');
  const config = getConfig();
  const connection = getConnection();
  const wallet = getWalletKeypair();

  log.errorBanner(
    live
      ? '🚨 DERISK LIVE — exiting the whole strategy into USDC'
      : '🧯 DERISK DRY-RUN — printing the plan only (pass --live to execute)',
    { keepHedge, oracleGateBps: config.swapOracleGateBps }
  );
  log.warn(
    '⚠️  If the server bot is still running it will re-enter right after this. ' +
      'Stop it first: docker compose stop on the Hetzner host.'
  );

  const price = (await getSolPrice()).usd;
  const reserves = config.minimumWalletBalanceSol + config.rentReserveSol;

  // ── 1. LP positions ──────────────────────────────────────────────────────
  const meteora = new MeteoraAdapter();
  const mints = await meteora.discoverPositionsFromBlockchain();
  log.info(`Step 1 — LP positions to close: ${mints.length}`, { mints });
  if (live) {
    for (const mint of mints) {
      const res = await meteora.withdrawClaimAndClose(mint);
      log.info('LP position closed', { mint, ...res });
    }
  }

  // ── 2. Perp sides ─────────────────────────────────────────────────────────
  const engine = new JupiterPerpsEngine();
  await engine.initialize();
  if (keepHedge) {
    log.warn('Step 2 — SKIPPED (--keep-hedge): portfolio will be net SHORT after the SOL swap');
  } else {
    const unwind = await engine.emergencyUnwind({ dryRun: !live });
    log.info('Step 2 — perp emergency unwind', {
      action: unwind.action,
      detail: unwind.detail,
      signatures: unwind.signatures,
      simulated: unwind.simulated?.success,
    });
    if (live && (unwind.signatures?.length ?? 0) > 0) {
      // Keeper fill (TX2) returns collateral asynchronously — give it a moment
      // before reading balances for the swap step.
      log.info('Waiting 20s for keeper fills to land...');
      await new Promise((r) => setTimeout(r, 20_000));
    }
  }

  // ── 3. wSOL → native ─────────────────────────────────────────────────────
  const unwrap = await engine.unwrapWsol({ dryRun: !live });
  log.info('Step 3 — wSOL unwrap', { detail: unwrap.detail, signatures: unwrap.signatures });

  // ── 4. SOL → USDC ────────────────────────────────────────────────────────
  const balanceLamports = await connection.getBalance(wallet.publicKey);
  const walletSol = balanceLamports / 1e9;
  const solToSwap = Math.max(0, walletSol - reserves);
  log.info('Step 4 — swap SOL above reserves to USDC', {
    walletSol,
    reserves,
    solToSwap,
    approxUsd: solToSwap * price,
  });
  if (live && solToSwap > 0.005) {
    const swapper = new JupiterSwapper();
    const res = await swapper.executeSwap({
      inputMint: SOL_MINT,
      outputMint: USDC_MINT,
      amount: solToSwap,
      priceSolUsd: price,
      context: 'rebalance',
    });
    log.info('Swap executed', {
      signature: res.signature,
      inputAmount: res.inputAmount,
      outputAmount: res.outputAmount,
      status: res.status,
    });
  }

  const finalSol = (await connection.getBalance(wallet.publicKey)) / 1e9;
  log.info(live ? '✅ DERISK complete' : '🧯 DRY-RUN complete — nothing was sent', {
    finalWalletSol: finalSol,
  });
  process.exit(0);
}

main().catch((e) => {
  log.error('derisk failed', { error: e instanceof Error ? e.message : String(e) });
  process.exit(1);
});
