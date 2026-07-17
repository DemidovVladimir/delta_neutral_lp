#!/usr/bin/env node
/**
 * Read-only tracker for the HYPE/SOL live LP test (2026-07-17, operator-
 * approved: small separate budget, hand-managed via the Meteora UI, the bot
 * stays on SOL/USDC). Measures what the simulator could not: REAL fee flow
 * in a pool where 84% of minutes have no trades (the traversal fee model is
 * half-blind there — its band was −2…+8 USD/month per 95 USD position).
 *
 * SOL-metric by design (operator 2026-07-17: no USD peg): everything is
 * valued in SOL. Each run appends one JSONL row to
 * data/hype-test-history.jsonl; the FIRST row of a position is the baseline
 * for the vs-hold benchmarks:
 *   hold-mix : keep the initial HYPE+SOL amounts untouched
 *   hold-SOL : the initial total converted to SOL on day one
 *
 *   RPC_URL=... npx tsx scripts/hype-test-track.ts [--wallet <pubkey>]
 *
 * Default wallet = the operator's hot wallet (the test runs OUTSIDE the
 * bot's wallet so Campaign-4 measurement stays clean).
 */
import fs from 'fs';
import path from 'path';
import { Connection, PublicKey } from '@solana/web3.js';
import { DLMM } from '../src/utils/dlmm.js';

const POOL = new PublicKey('81GpCm4d13y8TozYtThabuSCLQN2o3bbrvDogXFPn8sA'); // HYPE/SOL step 20, base fee 0.2%
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const DEFAULT_WALLET = 'F7p3dFrjRTbtRp8FRF6qHLomXbKRBzpvBLjtQcfcgmNe'; // operator hot wallet
const HISTORY = path.join(process.cwd(), 'data', 'hype-test-history.jsonl');

async function main() {
  const args = process.argv.slice(2);
  const wIdx = args.indexOf('--wallet');
  const wallet = new PublicKey(wIdx >= 0 ? args[wIdx + 1] : DEFAULT_WALLET);
  const rpc = process.env.RPC_URL;
  if (!rpc) throw new Error('RPC_URL is not set');
  const conn = new Connection(rpc, 'confirmed');

  const pool = await DLMM.create(conn, POOL);
  const decX = pool.tokenX.mint.decimals;
  const decY = pool.tokenY.mint.decimals;
  const solIsX = pool.tokenX.publicKey.toBase58() === SOL_MINT;
  const activeBin = await pool.getActiveBin();
  // pricePerToken = Y per X respecting decimals
  const pricePerToken = Number(activeBin.pricePerToken);
  // normalize to SOL per HYPE regardless of pool token order
  const priceSolPerHype = solIsX ? 1 / pricePerToken : pricePerToken;

  const { userPositions } = await pool.getPositionsByUserAndLbPair(wallet);
  if (!userPositions || userPositions.length === 0) {
    console.log(`Позиции в пуле ${POOL.toBase58()} у кошелька ${wallet.toBase58()} нет.`);
    console.log('Как только позиция появится — первый запуск станет базовой точкой.');
    return;
  }

  for (const pos of userPositions) {
    const d = pos.positionData;
    const xAmt = parseFloat(d.totalXAmount) / 10 ** decX;
    const yAmt = parseFloat(d.totalYAmount) / 10 ** decY;
    const xFee = parseFloat(d.feeX.toString()) / 10 ** decX;
    const yFee = parseFloat(d.feeY.toString()) / 10 ** decY;
    const hype = solIsX ? yAmt : xAmt;
    const sol = solIsX ? xAmt : yAmt;
    const feeHype = solIsX ? yFee : xFee;
    const feeSol = solIsX ? xFee : yFee;
    const equitySol = sol + feeSol + (hype + feeHype) * priceSolPerHype;

    const row = {
      takenAt: new Date().toISOString(),
      wallet: wallet.toBase58(),
      pool: POOL.toBase58(),
      positionMint: pos.publicKey.toBase58(),
      priceSolPerHype,
      hypeAmount: hype,
      solAmount: sol,
      unclaimedFeeHype: feeHype,
      unclaimedFeeSol: feeSol,
      equitySol,
    };

    let baseline: typeof row | null = null;
    if (fs.existsSync(HISTORY)) {
      const rows = fs
        .readFileSync(HISTORY, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l));
      baseline = rows.find((r) => r.positionMint === row.positionMint) ?? null;
    }

    console.log('════════ HYPE/SOL live-test — снимок (всё в SOL) ════════');
    console.log(`позиция:      ${pos.publicKey.toBase58()}`);
    console.log(`цена:         ${priceSolPerHype.toFixed(9)} SOL за HYPE`);
    console.log(`состав:       ${hype.toFixed(4)} HYPE + ${sol.toFixed(6)} SOL`);
    console.log(`комиссии:     ${feeHype.toFixed(4)} HYPE + ${feeSol.toFixed(6)} SOL (не собраны)`);
    console.log(`капитал:      ${equitySol.toFixed(6)} SOL`);
    if (baseline) {
      const holdMix = baseline.solAmount + baseline.hypeAmount * priceSolPerHype;
      const holdSol = baseline.equitySol;
      const days = (Date.now() - Date.parse(baseline.takenAt)) / 86400000;
      const feesSolTotal = feeSol + feeHype * priceSolPerHype;
      console.log(`с базовой точки ${baseline.takenAt} (${days.toFixed(2)} дня):`);
      console.log(`  vs держать смесь:  ${equitySol - holdMix >= 0 ? '+' : ''}${(equitySol - holdMix).toFixed(6)} SOL (= комиссии − проезды)`);
      console.log(`  vs держать SOL:    ${equitySol - holdSol >= 0 ? '+' : ''}${(equitySol - holdSol).toFixed(6)} SOL (+ курс HYPE)`);
      console.log(`  темп комиссий:     ${(feesSolTotal / Math.max(days, 0.01)).toFixed(6)} SOL/день с открытия`);
    } else {
      console.log('базовой точки ещё нет — эта строка станет ею.');
    }

    fs.mkdirSync(path.dirname(HISTORY), { recursive: true });
    fs.appendFileSync(HISTORY, JSON.stringify(row) + '\n');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
