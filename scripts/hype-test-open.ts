#!/usr/bin/env node
/**
 * Open the HYPE/SOL live-test position (BACKLOG A20) from the BOT wallet —
 * operator 2026-07-17: «Сделай сам. Я вручную не хочу».
 *
 * DRY-RUN by default: prints the full plan (mints, amounts, bin range) and
 * exits. --live executes: swap half the budget SOL→HYPE via Jupiter Ultra
 * (raw amounts — HYPE is unknown to jupiterSwapper's decimals table), then
 * open a ±10-bin (≈±2%) Spot position via the same SDK call the production
 * adapter uses.
 *
 * Deliberately does NOT touch state.json / the bot's position list: the
 * test position lives in a DIFFERENT pool and must stay invisible to the
 * bot loop AND to Campaign-4 equity (the baseline is adjusted by the exact
 * SOL outflow afterwards — see BACKLOG A20).
 *
 *   RPC_URL/PRIVATE_KEY from .env
 *   npx tsx scripts/hype-test-open.ts [--sol 0.54] [--live]
 */
import { Keypair, VersionedTransaction } from '@solana/web3.js';
import BN from 'bn.js';
import { DLMM, StrategyType } from '../src/utils/dlmm.js';
import { getConfig } from '../src/config/env.js';
import { getConnection, getWalletKeypair } from '../src/utils/solana.js';
import { sendOptimized } from '../src/utils/sendOptimized.js';
import { log } from '../src/utils/logger.js';

const POOL = '81GpCm4d13y8TozYtThabuSCLQN2o3bbrvDogXFPn8sA'; // HYPE/SOL step 20, base fee 0.2%
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const HALF_RANGE_BINS = 10; // ±10 bins @ step 20 ≈ ±2% (the sim's bins20 config)

async function main() {
  const args = process.argv.slice(2);
  const live = args.includes('--live');
  const solIdx = args.indexOf('--sol');
  const budgetSol = solIdx >= 0 ? parseFloat(args[solIdx + 1]) : 0.54;
  if (!(budgetSol > 0 && budgetSol < 1.5)) throw new Error(`подозрительный бюджет: ${budgetSol} SOL`);

  getConfig(); // loads .env (RPC_URL, PRIVATE_KEY)
  const connection = getConnection();
  const wallet = getWalletKeypair();

  const pool = await DLMM.create(connection, new (await import('@solana/web3.js')).PublicKey(POOL));
  const solIsX = pool.tokenX.publicKey.toBase58() === SOL_MINT;
  const hypeMint = (solIsX ? pool.tokenY.publicKey : pool.tokenX.publicKey).toBase58();
  const hypeDec = solIsX ? pool.tokenY.mint.decimals : pool.tokenX.mint.decimals;
  const active = await pool.getActiveBin();
  const minBinId = active.binId - HALF_RANGE_BINS;
  const maxBinId = active.binId + HALF_RANGE_BINS;

  const swapSol = budgetSol / 2;
  const lpSol = budgetSol / 2;
  const preSol = (await connection.getBalance(wallet.publicKey)) / 1e9;

  log.info(live ? '🔴 hype-test-open LIVE' : '🧯 hype-test-open DRY-RUN (пропусти --live чтобы исполнить)', {
    pool: POOL,
    wallet: wallet.publicKey.toBase58(),
    hypeMint,
    hypeDecimals: hypeDec,
    solIsX,
    activeBin: active.binId,
    pricePerToken: active.pricePerToken,
    range: { minBinId, maxBinId, bins: maxBinId - minBinId + 1, approxPct: '±2%' },
    budgetSol,
    plan: `swap ${swapSol} SOL → HYPE, потом LP ${lpSol} SOL + весь полученный HYPE, Spot`,
    walletSolBefore: preSol,
  });
  if (!live) return;

  // ── Step 1: swap half the budget SOL → HYPE (Jupiter Ultra, raw amounts) ──
  const lamports = Math.floor(swapSol * 1e9);
  const orderUrl = new URL('https://lite-api.jup.ag/ultra/v1/order');
  orderUrl.searchParams.append('inputMint', SOL_MINT);
  orderUrl.searchParams.append('outputMint', hypeMint);
  orderUrl.searchParams.append('amount', String(lamports));
  orderUrl.searchParams.append('taker', wallet.publicKey.toBase58());
  const orderResp = await fetch(orderUrl.toString());
  if (!orderResp.ok) throw new Error(`Ultra order: ${orderResp.status} ${await orderResp.text()}`);
  const order: any = await orderResp.json();
  if (order.errorCode || order.errorMessage || order.error) {
    throw new Error(`Ultra order error: ${order.errorMessage || order.error} (code ${order.errorCode})`);
  }
  if (!order.transaction) throw new Error('Ultra order: no transaction in response');
  log.info('✅ Ultra order', {
    requestId: order.requestId,
    inLamports: order.inAmount,
    outHypeRaw: order.outAmount,
    priceImpactPct: order.priceImpactPct,
  });

  const vtx = VersionedTransaction.deserialize(Buffer.from(order.transaction, 'base64'));
  vtx.sign([wallet]);
  const execResp = await fetch('https://lite-api.jup.ag/ultra/v1/execute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      signedTransaction: Buffer.from(vtx.serialize()).toString('base64'),
      requestId: order.requestId,
    }),
  });
  if (!execResp.ok) throw new Error(`Ultra execute: ${execResp.status} ${await execResp.text()}`);
  const exec: any = await execResp.json();
  log.info(exec.status === 'Success' ? '✅ Swap исполнен' : '❌ Swap НЕ исполнен', {
    status: exec.status,
    signature: exec.signature,
    solscan: `https://solscan.io/tx/${exec.signature}`,
  });
  if (exec.status !== 'Success') throw new Error(`swap failed: ${JSON.stringify(exec)}`);

  // ── Step 2: read the actual HYPE balance and open the LP position ──
  const { PublicKey } = await import('@solana/web3.js');
  let hypeRaw = 0n;
  for (let i = 0; i < 10; i++) {
    const accs = await connection.getParsedTokenAccountsByOwner(wallet.publicKey, {
      mint: new PublicKey(hypeMint),
    });
    hypeRaw = BigInt(accs.value[0]?.account.data.parsed.info.tokenAmount.amount ?? '0');
    if (hypeRaw > 0n) break;
    await new Promise((r) => setTimeout(r, 2000));
  }
  if (hypeRaw === 0n) throw new Error('HYPE не появился на кошельке после свопа — позицию не открываю');
  log.info('HYPE получен', { hypeRaw: hypeRaw.toString(), hype: Number(hypeRaw) / 10 ** hypeDec });

  const solRawBN = new BN(Math.floor(lpSol * 1e9));
  const hypeRawBN = new BN(hypeRaw.toString());
  const positionKeypair = Keypair.generate();
  const tx = await pool.initializePositionAndAddLiquidityByStrategy({
    positionPubKey: positionKeypair.publicKey,
    totalXAmount: solIsX ? solRawBN : hypeRawBN,
    totalYAmount: solIsX ? hypeRawBN : solRawBN,
    strategy: { minBinId, maxBinId, strategyType: StrategyType.Spot },
    user: wallet.publicKey,
    slippage: 0.005,
  });
  const sendResult = await sendOptimized({
    connection,
    tx,
    wallet,
    additionalSigners: [positionKeypair],
    label: 'hypeTestOpen',
  });
  await connection.confirmTransaction({
    signature: sendResult.signature,
    blockhash: sendResult.blockhash,
    lastValidBlockHeight: sendResult.lastValidBlockHeight,
  });

  const postSol = (await connection.getBalance(wallet.publicKey)) / 1e9;
  log.info('✅ Тестовая позиция HYPE/SOL открыта', {
    positionMint: positionKeypair.publicKey.toBase58(),
    signature: sendResult.signature,
    solscan: `https://solscan.io/tx/${sendResult.signature}`,
    walletSolBefore: preSol,
    walletSolAfter: postSol,
    solOutflowTotal: preSol - postSol,
    next: 'запусти scripts/hype-test-track.ts --wallet <bot wallet> (первая строка = базовая точка) и скорректируй baseline Кампании 4 на solOutflowTotal',
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
