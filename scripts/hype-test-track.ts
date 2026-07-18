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
 * data/hype-test-history.jsonl; the FIRST row of the file is the baseline
 * for the vs-hold benchmarks — mint-AGNOSTIC, because scripts/
 * hype-recenter.ts recreates the position on every recenter and the test
 * must read as ONE continuous experiment:
 *   hold-mix : keep the initial HYPE+SOL amounts untouched
 *   hold-SOL : the initial total converted to SOL on day one
 * Fees claimed at each recenter close come from data/hype-manager-state.json
 * and are folded into the fee totals. On top of the since-open view, every
 * run reports a trailing window (default 24h, --window <hours>) against the
 * stored snapshot closest to the window edge — the operator's "did
 * yesterday earn anything" readout.
 *
 *   npx tsx scripts/hype-test-track.ts [--wallet <pubkey>] [--window <hours>]
 *
 * RPC comes from .env (RPC_URL) or the environment.
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { Connection, PublicKey } from '@solana/web3.js';
import { DLMM } from '../src/utils/dlmm.js';

const POOL = new PublicKey('81GpCm4d13y8TozYtThabuSCLQN2o3bbrvDogXFPn8sA'); // HYPE/SOL step 20, base fee 0.2%
const SOL_MINT = 'So11111111111111111111111111111111111111112';
// The test runs from the BOT wallet since 2026-07-17T15:22Z (operator
// «Сделай сам»); the Campaign-4 baseline was adjusted by the exact
// carve-out so the test stays outside campaign measurement.
const DEFAULT_WALLET = 'F3YvPiLdniRPGpeKrbeGWR2zg2wPpzVuvqBA5BBJBQ5S';
const HISTORY = path.join(process.cwd(), 'data', 'hype-test-history.jsonl');
const MANAGER_STATE = path.join(process.cwd(), 'data', 'hype-manager-state.json');

interface Row {
  takenAt: string;
  wallet: string;
  pool: string;
  positionMint: string;
  priceSolPerHype: number;
  hypeAmount: number;
  solAmount: number;
  unclaimedFeeHype: number;
  unclaimedFeeSol: number;
  equitySol: number;
  // cumulative fees claimed by hype-recenter closes, as of this snapshot
  // (absent in pre-manager rows — treat as 0)
  claimedFeeSolTotal?: number;
  claimedFeeHypeTotal?: number;
}

const sign = (n: number) => (n >= 0 ? '+' : '');
const pct = (delta: number, base: number) =>
  base > 0 ? `${sign(delta)}${((delta / base) * 100).toFixed(3)}%` : 'n/a';

async function main() {
  const args = process.argv.slice(2);
  const wIdx = args.indexOf('--wallet');
  const wallet = new PublicKey(wIdx >= 0 ? args[wIdx + 1] : DEFAULT_WALLET);
  const winIdx = args.indexOf('--window');
  const windowHours = winIdx >= 0 ? parseFloat(args[winIdx + 1]) : 24;
  const rpc = process.env.RPC_URL;
  if (!rpc) throw new Error('RPC_URL is not set (нет ни в окружении, ни в .env)');
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

  // Fees claimed by hype-recenter.ts at each close (0/0 until it has run).
  let claimedFees = { sol: 0, hype: 0 };
  let recenters = 0;
  try {
    const ms = JSON.parse(fs.readFileSync(MANAGER_STATE, 'utf8'));
    claimedFees = { sol: ms.claimedFeeSolTotal ?? 0, hype: ms.claimedFeeHypeTotal ?? 0 };
    recenters = ms.recenters ?? 0;
  } catch {
    /* manager has not run yet */
  }

  const { userPositions } = await pool.getPositionsByUserAndLbPair(wallet);
  if (!userPositions || userPositions.length === 0) {
    console.log(`Позиции в пуле ${POOL.toBase58()} у кошелька ${wallet.toBase58()} нет.`);
    console.log(
      'Либо тест ещё не открыт (первый запуск после открытия станет базовой точкой),'
    );
    console.log('либо hype-recenter прямо сейчас пересоздаёт позицию — повтори через минуту.');
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

    const row: Row = {
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
      claimedFeeSolTotal: claimedFees.sol,
      claimedFeeHypeTotal: claimedFees.hype,
    };

    // Mint-agnostic: recenters change the position mint, the test is one
    // continuous experiment — every row of this pool counts.
    let history: Row[] = [];
    if (fs.existsSync(HISTORY)) {
      history = fs
        .readFileSync(HISTORY, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l))
        .filter((r: Row) => r.pool === row.pool);
    }
    const baseline = history[0] ?? null;
    // Trailing-window anchor: the stored snapshot whose age is closest to
    // the requested window (sparse history makes "first row older than N
    // hours" overshoot badly).
    const now = Date.now();
    const windowMs = windowHours * 3600000;
    let windowRow: Row | null = null;
    for (const r of history) {
      const dist = Math.abs(now - Date.parse(r.takenAt) - windowMs);
      if (!windowRow || dist < Math.abs(now - Date.parse(windowRow.takenAt) - windowMs))
        windowRow = r;
    }

    console.log('════════ HYPE/SOL live-test — снимок (всё в SOL) ════════');
    console.log(`позиция:      ${pos.publicKey.toBase58()}`);
    console.log(`цена:         ${priceSolPerHype.toFixed(9)} SOL за HYPE`);
    console.log(`состав:       ${hype.toFixed(4)} HYPE + ${sol.toFixed(6)} SOL`);
    console.log(`комиссии:     ${feeHype.toFixed(4)} HYPE + ${feeSol.toFixed(6)} SOL (не собраны)`);
    console.log(`капитал:      ${equitySol.toFixed(6)} SOL`);
    if (recenters > 0)
      console.log(
        `пересозданий: ${recenters} (собрано при них: ${claimedFees.hype.toFixed(4)} HYPE + ${claimedFees.sol.toFixed(6)} SOL — вложены обратно)`
      );

    if (baseline) {
      const holdMix = baseline.solAmount + baseline.hypeAmount * priceSolPerHype;
      const holdSol = baseline.equitySol;
      const days = (now - Date.parse(baseline.takenAt)) / 86400000;
      const feesSolTotal =
        feeSol + claimedFees.sol + (feeHype + claimedFees.hype) * priceSolPerHype;
      const feePctPerDay = (feesSolTotal / Math.max(days, 0.01) / baseline.equitySol) * 100;
      console.log('');
      console.log(`── с открытия ${baseline.takenAt} (${days.toFixed(2)} дня) ──`);
      console.log(
        `  капитал:           ${sign(equitySol - holdSol)}${(equitySol - holdSol).toFixed(6)} SOL (${pct(equitySol - holdSol, holdSol)})`
      );
      console.log(
        `  vs держать смесь:  ${sign(equitySol - holdMix)}${(equitySol - holdMix).toFixed(6)} SOL (${pct(equitySol - holdMix, holdMix)})  ← чистый эффект LP`
      );
      console.log(
        `  комиссии:          ${feesSolTotal.toFixed(6)} SOL всего, темп ${(feesSolTotal / Math.max(days, 0.01)).toFixed(6)} SOL/день ≈ ${feePctPerDay.toFixed(3)}%/день ≈ ${(feePctPerDay * 30).toFixed(2)}%/мес`
      );
    } else {
      console.log('базовой точки ещё нет — эта строка станет ею.');
    }

    if (windowRow && baseline && windowRow.takenAt !== baseline.takenAt) {
      const wDays = (now - Date.parse(windowRow.takenAt)) / 86400000;
      const wHoldMix = windowRow.solAmount + windowRow.hypeAmount * priceSolPerHype;
      // Cumulative fee counter (claimed at recenters + currently unclaimed)
      // now vs at the window row — survives recenters resetting unclaimed.
      const wFees =
        feeSol + claimedFees.sol + (feeHype + claimedFees.hype) * priceSolPerHype -
        (windowRow.unclaimedFeeSol +
          (windowRow.claimedFeeSolTotal ?? 0) +
          (windowRow.unclaimedFeeHype + (windowRow.claimedFeeHypeTotal ?? 0)) * priceSolPerHype);
      console.log('');
      console.log(`── окно ${windowHours}ч: с ${windowRow.takenAt} (${wDays.toFixed(2)} дня) ──`);
      console.log(
        `  капитал:           ${sign(equitySol - windowRow.equitySol)}${(equitySol - windowRow.equitySol).toFixed(6)} SOL (${pct(equitySol - windowRow.equitySol, windowRow.equitySol)})`
      );
      console.log(
        `  vs держать смесь:  ${sign(equitySol - wHoldMix)}${(equitySol - wHoldMix).toFixed(6)} SOL (${pct(equitySol - wHoldMix, wHoldMix)})  ← чистый эффект LP`
      );
      console.log(
        `  комиссии за окно:  ${wFees.toFixed(6)} SOL${wFees < 0 ? ' (отрицательно быть не должно — проверь учёт)' : ''}`
      );
    } else if (baseline) {
      console.log('');
      console.log(`(окно ${windowHours}ч пока совпадает с открытием — снимков старше нет)`);
    }

    fs.mkdirSync(path.dirname(HISTORY), { recursive: true });
    fs.appendFileSync(HISTORY, JSON.stringify(row) + '\n');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
