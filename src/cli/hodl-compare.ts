#!/usr/bin/env node
/**
 * `pnpm hodl` — campaign-level HODL benchmark. READ-ONLY, no funds touched.
 *
 * Compares TOTAL portfolio equity (wallet SOL + wSOL + USDC, Meteora LP incl.
 * unclaimed fees, Jupiter Perps equity = collateral + price PnL − accrued
 * borrow fees) against three counterfactuals frozen at a baseline:
 * HODL-SOL, HODL-USDC, and HODL-as-is (the exact starting composition).
 *
 * The baseline lives in data/hodl-baseline.json (gitignored runtime state,
 * like the rest of data/). Set it once when the campaign starts; every later
 * run measures against it.
 *
 * Usage:
 *   pnpm hodl                       Compare now vs the stored baseline
 *   pnpm hodl --json                Same, as machine-readable JSON
 *   pnpm hodl --init                Capture CURRENT holdings as the baseline
 *   pnpm hodl --init --force        Overwrite an existing baseline
 *   pnpm hodl --init --date=2026-07-01T18:00:00Z --price=150.25 \
 *             --sol=2.5 --usdc=1200 [--note="Stage B go-live"]
 *                                   Manual/backdated baseline: you held 2.5 SOL
 *                                   + 1200 USDC when SOL was $150.25
 *   pnpm hodl --help
 *
 * Math lives in the pure src/modules/hodlBenchmark.ts (unit-tested); this CLI
 * only does I/O: on-chain reads, the baseline file, and rendering.
 */

import * as fs from 'fs';
import * as path from 'path';
import { PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddress } from '@solana/spl-token';
import { getConnection, getWalletKeypair } from '../utils/solana.js';
import { getConfig } from '../config/env.js';
import { getSolPrice } from '../core/priceOracle.js';
import { MeteoraAdapter } from '../modules/meteoraAdapter.js';
import { JupiterPerpsEngine } from '../modules/jupiterPerpsEngine.js';
import {
  buildBaseline,
  compareToHodl,
  computeEquityUsd,
  equityComponents,
  type EquityBreakdown,
  type HodlBaseline,
  type HodlComparison,
} from '../modules/hodlBenchmark.js';

// Local @solana/web3.js PublicKeys — do NOT import the jup-anchor copies from
// utils/jupiterPerps.ts here (dual-web3 casting gotcha, see CLAUDE.md).
const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const WSOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');

const BASELINE_PATH = path.resolve(process.cwd(), 'data', 'hodl-baseline.json');

// ----------------------------- baseline file ---------------------------------

function loadBaseline(): HodlBaseline | null {
  if (!fs.existsSync(BASELINE_PATH)) return null;
  let raw: HodlBaseline;
  try {
    raw = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf-8')) as HodlBaseline;
  } catch (e) {
    throw new Error(
      `Baseline file is not valid JSON: ${BASELINE_PATH} (${e instanceof Error ? e.message : String(e)}) — fix or overwrite it with --init --force`,
    );
  }
  if (
    !raw.capturedAt ||
    Number.isNaN(new Date(raw.capturedAt).getTime()) ||
    !(raw.solPriceUsd > 0) ||
    !(raw.totalUsd > 0) ||
    typeof raw.solSideAmount !== 'number' ||
    typeof raw.usdcSideAmount !== 'number'
  ) {
    throw new Error(`Baseline file is malformed: ${BASELINE_PATH} — overwrite it with --init --force`);
  }
  return raw;
}

function saveBaseline(b: HodlBaseline): void {
  fs.mkdirSync(path.dirname(BASELINE_PATH), { recursive: true });
  fs.writeFileSync(BASELINE_PATH, JSON.stringify(b, null, 2) + '\n');
}

// ----------------------------- on-chain reads --------------------------------

/**
 * ATA balance with fail-hard semantics: a missing ATA is a legitimate zero,
 * but an RPC failure propagates. (The dashboard's degrade-to-zero variant is
 * fine for a live panel; here a silent $0 would flip the money verdict or
 * poison a --init baseline.)
 */
async function readTokenBalance(owner: PublicKey, mint: PublicKey): Promise<number> {
  const connection = getConnection();
  const ata = await getAssociatedTokenAddress(mint, owner);
  const info = await connection.getAccountInfo(ata);
  if (!info) return 0; // ATA never created => genuinely zero balance
  const bal = await connection.getTokenAccountBalance(ata);
  return bal.value.uiAmount ?? 0;
}

/**
 * Collect the full equity breakdown. Unlike the dashboard, this FAILS HARD on
 * any degraded read (except "no LP pool configured") — a verdict about money
 * computed from partial data is worse than no verdict.
 */
async function collectBreakdown(): Promise<{
  breakdown: EquityBreakdown;
  walletAddress: string;
  hedgeEngine: JupiterPerpsEngine;
}> {
  const connection = getConnection();
  const walletPubkey = getWalletKeypair().publicKey;
  const cfg = getConfig();

  if (!cfg.meteoraPoolAddress) {
    console.error('⚠️  METEORA_POOL_ADDRESS not set — LP counted as zero');
  }
  const hedgeEngine = new JupiterPerpsEngine();

  // All sources in parallel; any single failure rejects the whole read
  // (fail-hard by design). The Meteora adapter is READ-ONLY so this observer
  // can never write state.json under a live auto-tune loop.
  const [solLamports, walletWsol, walletUsdc, priceData, exposure, hedge] = await Promise.all([
    connection.getBalance(walletPubkey),
    readTokenBalance(walletPubkey, WSOL_MINT),
    readTokenBalance(walletPubkey, USDC_MINT),
    getSolPrice(),
    cfg.meteoraPoolAddress
      ? new MeteoraAdapter({ readOnly: true }).getLpExposure()
      : Promise.resolve(null),
    hedgeEngine.initialize().then(() => hedgeEngine.getHedgeState()),
  ]);
  if (!(priceData.usd > 0)) throw new Error('SOL price unavailable — refusing to compute equity');

  const sides = [hedge.sides?.long, hedge.sides?.short].filter(
    (s): s is NonNullable<typeof s> => s != null,
  );

  const breakdown: EquityBreakdown = {
    solPriceUsd: priceData.usd,
    walletSol: solLamports / 1e9,
    walletWsol,
    walletUsdc,
    lpSol: exposure?.solAmount ?? 0,
    lpUsdc: exposure?.usdcAmount ?? 0,
    lpClaimableSol: exposure?.claimableSol ?? 0,
    lpClaimableUsdc: exposure?.claimableUsdc ?? 0,
    perpCollateralUsd: sides.reduce((sum, s) => sum + s.collateralUsd, 0),
    perpUnrealizedPnlUsd: sides.reduce((sum, s) => sum + s.unrealizedPnlUsd, 0),
    perpAccruedBorrowFeeUsd: sides.reduce((sum, s) => sum + s.accruedBorrowFeeUsd, 0),
  };
  return { breakdown, walletAddress: walletPubkey.toBase58(), hedgeEngine };
}

// ------------------------------- rendering -----------------------------------

const fmtUsd = (n: number) => (n < 0 ? '-' : n > 0 ? '+' : ' ') + '$' + Math.abs(n).toFixed(2);
const fmtUsdAbs = (n: number) => '$' + n.toFixed(2);
const fmtPct = (n: number) => (n >= 0 ? '+' : '') + n.toFixed(2) + '%';

function hr(char = '─', width = 78) {
  console.log(char.repeat(width));
}

function printBreakdown(b: EquityBreakdown, walletAddress: string): void {
  const perpEquity = equityComponents(b).perpEquityUsd;
  console.log(`  Wallet: ${walletAddress}`);
  console.log(`  SOL price: ${fmtUsdAbs(b.solPriceUsd)}`);
  console.log();
  console.log(`  wallet SOL:        ${b.walletSol.toFixed(6)} SOL  (${fmtUsdAbs(b.walletSol * b.solPriceUsd)})`);
  console.log(`  wallet wSOL:       ${b.walletWsol.toFixed(6)} SOL  (${fmtUsdAbs(b.walletWsol * b.solPriceUsd)})`);
  console.log(`  wallet USDC:       ${fmtUsdAbs(b.walletUsdc)}`);
  console.log(`  LP SOL:            ${b.lpSol.toFixed(6)} SOL  (${fmtUsdAbs(b.lpSol * b.solPriceUsd)})`);
  console.log(`  LP USDC:           ${fmtUsdAbs(b.lpUsdc)}`);
  console.log(`  LP unclaimed fees: ${b.lpClaimableSol.toFixed(6)} SOL + ${b.lpClaimableUsdc.toFixed(2)} USDC`);
  console.log(`  perp collateral:   ${fmtUsdAbs(b.perpCollateralUsd)}`);
  console.log(`  perp price PnL:    ${fmtUsd(b.perpUnrealizedPnlUsd)}`);
  console.log(`  perp borrow fees:  -${fmtUsdAbs(b.perpAccruedBorrowFeeUsd)} (accrued, unpaid)`);
  console.log(`  perp equity:       ${fmtUsd(perpEquity)}`);
}

const VERDICT_TEXT: Record<HodlComparison['verdict'], string> = {
  'beats-both': '✅ STRATEGY WINS — ahead of both HODL-SOL and HODL-USDC.',
  'beats-usdc-only':
    '➖ MIXED — ahead of HODL-USDC but BEHIND HODL-SOL (just holding SOL would have been richer).',
  'beats-sol-only':
    '➖ MIXED — ahead of HODL-SOL but BEHIND HODL-USDC (parking in stables would have been richer).',
  'loses-to-both':
    '❌ STRATEGY LOSING — behind BOTH benchmarks. If this persists, running the bot is not paying for its risk.',
};

function printComparison(baseline: HodlBaseline, cmp: HodlComparison): void {
  console.log();
  console.log('═'.repeat(78));
  console.log('  Delta-Neutral Bot — Strategy vs HODL');
  console.log('═'.repeat(78));

  console.log();
  console.log('BASELINE');
  hr();
  console.log(`  captured:    ${baseline.capturedAt} (${baseline.source})${baseline.note ? ` — ${baseline.note}` : ''}`);
  console.log(`  SOL price:   ${fmtUsdAbs(baseline.solPriceUsd)}`);
  console.log(`  composition: ${baseline.solSideAmount.toFixed(6)} SOL + ${baseline.usdcSideAmount.toFixed(2)} USDC`);
  console.log(`  total:       ${fmtUsdAbs(baseline.totalUsd)}`);
  console.log(`  elapsed:     ${cmp.elapsedDays.toFixed(2)} days`);

  console.log();
  console.log('STRATEGY (actual)');
  hr();
  console.log(`  equity now:  ${fmtUsdAbs(cmp.strategyTotalUsd)}`);
  console.log(`  PnL:         ${fmtUsd(cmp.strategyPnlUsd)}  (${fmtPct(cmp.strategyPnlPct)}, ~${fmtPct(cmp.strategyAprPct)} APR)`);

  console.log();
  console.log('VS HODL');
  hr();
  console.log(
    '  ' + 'benchmark'.padEnd(12) + 'value now'.padStart(12) + 'edge'.padStart(12) +
    'edge %'.padStart(10) + 'edge APR'.padStart(12),
  );
  for (const row of cmp.benchmarks) {
    console.log(
      '  ' +
        row.name.padEnd(12) +
        fmtUsdAbs(row.valueUsd).padStart(12) +
        fmtUsd(row.edgeUsd).padStart(12) +
        fmtPct(row.edgePct).padStart(10) +
        fmtPct(row.edgeAprPct).padStart(12),
    );
  }
  console.log();
  console.log(`  ${VERDICT_TEXT[cmp.verdict]}`);
  if (!cmp.aprMeaningful) {
    console.log('  ⚠️  Window under 3 days — annualized numbers are noise, judge USD edges only.');
  }
  console.log();
  console.log('═'.repeat(78));
  console.log();
}

// --------------------------------- main --------------------------------------

function argValue(args: string[], name: string): string | undefined {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit?.split('=').slice(1).join('=');
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
HODL benchmark — read-only, no funds touched

  pnpm hodl                       Compare current equity vs the stored baseline
  pnpm hodl --json                Same, as JSON
  pnpm hodl --init                Capture current holdings as the baseline
  pnpm hodl --init --force        Overwrite an existing baseline
  pnpm hodl --init --date=<ISO> --price=<SOL_USD> --sol=<amount> --usdc=<amount>
                                  Manual/backdated baseline
  Baseline file: ${BASELINE_PATH}
`);
    process.exit(0);
  }

  const json = args.includes('--json');
  const init = args.includes('--init');
  const force = args.includes('--force');

  if (init) {
    // A malformed existing file must not block --force — that's exactly the
    // state --force exists to recover from.
    let existing: HodlBaseline | null = null;
    let malformed: string | null = null;
    try {
      existing = loadBaseline();
    } catch (e) {
      malformed = e instanceof Error ? e.message : String(e);
    }
    if ((existing || malformed) && !force) {
      console.error(
        existing
          ? `Baseline already exists (captured ${existing.capturedAt}, $${existing.totalUsd.toFixed(2)}).`
          : `Existing baseline file is unreadable: ${malformed}`,
      );
      console.error('Re-running --init would move the goalposts — pass --force to overwrite.');
      process.exit(1);
    }

    const date = argValue(args, 'date');
    const price = argValue(args, 'price');
    let baseline: HodlBaseline;

    if (date || price || argValue(args, 'sol') || argValue(args, 'usdc')) {
      // Manual/backdated baseline.
      const solAmount = Number(argValue(args, 'sol') ?? 0);
      const usdcAmount = Number(argValue(args, 'usdc') ?? 0);
      const priceNum = Number(price);
      if (!date || Number.isNaN(new Date(date).getTime())) {
        throw new Error('Manual baseline needs --date=<ISO timestamp>');
      }
      if (!(priceNum > 0)) throw new Error('Manual baseline needs --price=<SOL/USD at that date>');
      if (!(solAmount >= 0) || !(usdcAmount >= 0) || solAmount + usdcAmount <= 0) {
        throw new Error('Manual baseline needs --sol and/or --usdc starting amounts');
      }
      baseline = {
        capturedAt: new Date(date).toISOString(),
        solPriceUsd: priceNum,
        solSideAmount: solAmount,
        usdcSideAmount: usdcAmount,
        totalUsd: solAmount * priceNum + usdcAmount,
        source: 'manual',
        note: argValue(args, 'note'),
      };
    } else {
      const { breakdown, hedgeEngine } = await collectBreakdown();
      baseline = buildBaseline(breakdown, new Date().toISOString(), argValue(args, 'note'));
      await hedgeEngine.shutdown().catch(() => {});
    }

    saveBaseline(baseline);
    console.log(`Baseline saved to ${BASELINE_PATH}:`);
    console.log(JSON.stringify(baseline, null, 2));
    process.exit(0);
  }

  // ---- compare mode ----
  const baseline = loadBaseline();
  if (!baseline) {
    console.error(`No baseline yet (${BASELINE_PATH}).`);
    console.error('Run `pnpm hodl --init` (current holdings) or the manual --date/--price/--sol/--usdc form.');
    process.exit(1);
  }

  const { breakdown, walletAddress, hedgeEngine } = await collectBreakdown();
  const strategyTotalUsd = computeEquityUsd(breakdown);
  const comparison = compareToHodl(
    baseline,
    strategyTotalUsd,
    breakdown.solPriceUsd,
    new Date().toISOString(),
  );

  if (json) {
    console.log(JSON.stringify({ walletAddress, baseline, breakdown, comparison }, null, 2));
  } else {
    printComparison(baseline, comparison);
    console.log('CURRENT EQUITY BREAKDOWN');
    hr();
    printBreakdown(breakdown, walletAddress);
    console.log();
  }
  await hedgeEngine.shutdown().catch(() => {});
  process.exit(0);
}

main().catch((error) => {
  console.error(`hodl-compare failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
