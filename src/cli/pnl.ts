/**
 * `pnpm pnl` — read-only PnL inspector.
 *
 * Print:
 *   • Lifetime summary (rebalances, swaps, network fees, claimed LP fees,
 *     realized PnL vs each HODL benchmark)
 *   • Network-fee breakdown by transaction kind
 *   • Open positions with the latest snapshot's HODL diffs
 *   • Last N rebalances and swaps (default 10 each)
 *
 * Designed to be safe to run while the bot is live — opens the SQLite DB in
 * WAL mode (the writer doesn't block readers) and never writes.
 */

import {
  getLifetimeSummary,
  getFeeBreakdownByKind,
  getOpenPositions,
  getRecentRebalances,
  getRecentSwaps,
  getLatestSnapshotForPosition,
  getRebalanceDecomposition,
  getPositionLifetimeBuckets,
} from '../modules/pnlDb.js';
import { getStrategyVersion } from '../utils/strategyVersion.js';

const fmtUsd = (n: number) =>
  (n >= 0 ? ' ' : '-') + '$' + Math.abs(n).toFixed(2);
const fmt6 = (n: number) => n.toFixed(6);
const fmt2 = (n: number) => n.toFixed(2);

function hr(char = '─', width = 72) {
  console.log(char.repeat(width));
}

function header(label: string) {
  console.log();
  console.log(label);
  hr();
}

function main() {
  const v = getStrategyVersion();
  console.log();
  console.log('═'.repeat(72));
  console.log('  Delta-Neutral Bot — PnL Report');
  console.log('═'.repeat(72));
  console.log(
    `  Current strategy: ${v.gitHash}${v.isDirty ? ' (dirty)' : ''}` +
      (v.label ? ` "${v.label}"` : ''),
  );
  console.log(`  Detected at: ${v.detectedAt}`);

  // ───────────────────────────── LIFETIME SUMMARY ─────────────────────────
  const s = getLifetimeSummary();
  header('LIFETIME SUMMARY');
  console.log(`  Positions opened:        ${s.positionsOpened}`);
  console.log(`  Positions closed:        ${s.positionsClosed}`);
  console.log(`  Rebalances (success):    ${s.rebalanceCount}`);
  console.log(`  Jupiter swaps (success): ${s.swapCount}`);
  console.log();
  console.log(`  Network fees paid:       ${fmt6(s.totalNetworkFeesSol)} SOL  (~${fmtUsd(s.totalNetworkFeesUsd)})`);
  console.log(`  LP fees claimed:         ${fmt6(s.totalClaimedFeesSol)} SOL + ${fmt2(s.totalClaimedFeesUsdc)} USDC`);
  console.log();
  console.log(`  Realized PnL (vs deposit):       ${fmtUsd(s.realizedPnlUsd)}`);
  console.log(`  Realized PnL vs HODL-only-SOL:   ${fmtUsd(s.realizedHodlOnlySolPnlUsd)}`);
  console.log(`  Realized PnL vs HODL-only-USDC:  ${fmtUsd(s.realizedHodlOnlyUsdcPnlUsd)}`);
  console.log(`  Realized PnL vs HODL-50/50:      ${fmtUsd(s.realizedHodl5050PnlUsd)}`);

  // ───────────────────────────── FEE BREAKDOWN ───────────────────────────
  const feeRows = getFeeBreakdownByKind();
  if (feeRows.length > 0) {
    header('NETWORK FEES BY OPERATION');
    console.log('  ' + 'kind'.padEnd(24) + 'count'.padStart(7) + '  ' +
                'fee_sol'.padStart(12) + '  ' + 'fee_usd'.padStart(10));
    for (const r of feeRows) {
      console.log(
        '  ' +
          r.kind.padEnd(24) +
          String(r.count).padStart(7) +
          '  ' +
          fmt6(r.totalFeeSol).padStart(12) +
          '  ' +
          fmtUsd(r.totalFeeUsd).padStart(10),
      );
    }
  }

  // ───────────────────────────── OPEN POSITIONS ──────────────────────────
  const open = getOpenPositions();
  header('OPEN POSITIONS');
  if (open.length === 0) {
    console.log('  (none)');
  } else {
    for (const p of open) {
      console.log(`  position ${p.positionMint.slice(0, 12)}…   opened ${p.openedAt}`);
      console.log(`    deposit:        ${fmtUsd(p.depositTotalUsd)}`);
      console.log(`    strategy ver:   ${p.strategyVersion}`);

      const snap = getLatestSnapshotForPosition(p.id);
      if (snap) {
        const vsDeposit = snap.positionValueUsd - p.depositTotalUsd;
        const vsHodlSol = snap.positionValueUsd - snap.hodlOnlySolValueUsd;
        const vsHodlUsdc = snap.positionValueUsd - snap.hodlOnlyUsdcValueUsd;
        const vsHodl5050 = snap.positionValueUsd - snap.hodl5050ValueUsd;
        console.log(`    last snapshot:  ${snap.takenAt} @ $${fmt2(snap.currentPriceSolUsd)}/SOL`);
        console.log(`      position MTM:        ${fmtUsd(snap.positionValueUsd)}    (${fmtUsd(vsDeposit)} vs deposit)`);
        console.log(`      vs HODL-only-SOL:    ${fmtUsd(vsHodlSol)}`);
        console.log(`      vs HODL-only-USDC:   ${fmtUsd(vsHodlUsdc)}`);
        console.log(`      vs HODL-50/50:       ${fmtUsd(vsHodl5050)}`);
        console.log(`      unclaimed fees:      ${fmt6(snap.unclaimedFeesSol)} SOL + ${fmt2(snap.unclaimedFeesUsdc)} USDC`);
      } else {
        console.log('    (no snapshots yet)');
      }
    }
  }

  // ─────────────── LIFETIME BUCKETS (range-geometry / trend-tax) ─────────
  const buckets = getPositionLifetimeBuckets();
  if (buckets.length > 0) {
    header('POSITION LIFETIME BUCKETS (trend-tax check; net = fees + IL, LP-side)');
    console.log(
      '  ' + 'bucket'.padEnd(10) + 'n'.padStart(5) + 'avg life'.padStart(10) +
      'fees'.padStart(9) + 'IL'.padStart(9) + 'net'.padStart(9) + '  fees/|IL|',
    );
    for (const b of buckets) {
      const ratio = b.ilUsd !== 0 ? (b.feesUsd / Math.abs(b.ilUsd)).toFixed(2) : '—';
      console.log(
        '  ' + b.bucket.padEnd(10) + String(b.positions).padStart(5) +
        `${b.avgLifeMin}m`.padStart(10) + fmtUsd(b.feesUsd).padStart(9) +
        fmtUsd(b.ilUsd).padStart(9) + fmtUsd(b.netUsd).padStart(9) +
        ratio.padStart(11),
      );
    }
    console.log('  (<15min rows are recenters into a still-moving price — the trend tax)');
  }

  // ─────────────────── NET-RETURN DECOMPOSITION (ADR-020) ────────────────
  // Kamino-style split per closed position: net = fees + IL − swap − network.
  const decomp = getRebalanceDecomposition(15);
  header(`NET RETURN PER CLOSED POSITION (last ${decomp.length}; net = fees + IL − swap − network)`);
  if (decomp.length === 0) {
    console.log('  (none)');
  } else {
    console.log(
      '  ' + 'closed at'.padEnd(21) + 'life'.padStart(7) + 'fees'.padStart(9) +
      'IL'.padStart(9) + 'swap'.padStart(8) + 'netwk'.padStart(8) + 'NET'.padStart(9),
    );
    let tFees = 0, tIl = 0, tSwap = 0, tNet = 0, tNetwork = 0;
    for (const d of decomp) {
      tFees += d.feesUsd; tIl += d.ilUsd; tSwap += d.swapCostUsd;
      tNetwork += d.networkFeeUsd; tNet += d.netUsd;
      const life = d.lifetimeMinutes !== null ? `${d.lifetimeMinutes}m` : '—';
      console.log(
        '  ' + d.closedAt.slice(0, 19).padEnd(21) + life.padStart(7) +
        fmtUsd(d.feesUsd).padStart(9) + fmtUsd(d.ilUsd).padStart(9) +
        fmtUsd(d.swapCostUsd).padStart(8) + fmtUsd(d.networkFeeUsd).padStart(8) +
        fmtUsd(d.netUsd).padStart(9),
      );
    }
    hr();
    console.log(
      '  ' + 'TOTAL'.padEnd(28) +
      fmtUsd(tFees).padStart(9) + fmtUsd(tIl).padStart(9) +
      fmtUsd(tSwap).padStart(8) + fmtUsd(tNetwork).padStart(8) + fmtUsd(tNet).padStart(9),
    );
  }

  // ───────────────────────────── RECENT REBALANCES ───────────────────────
  const rebals = getRecentRebalances(10);
  header(`RECENT REBALANCES (last ${rebals.length})`);
  if (rebals.length === 0) {
    console.log('  (none)');
  } else {
    for (const r of rebals) {
      const status = r.success ? '✅' : '❌';
      const dur = r.durationMs ? `${(r.durationMs / 1000).toFixed(1)}s` : '—';
      const compo =
        r.triggerSolPct !== null && r.triggerUsdcPct !== null
          ? `${fmt2(r.triggerSolPct)}/${fmt2(r.triggerUsdcPct)}%`
          : '?/?%';
      console.log(
        `  ${status}  ${r.triggeredAt}  ${compo}  dur ${dur}  v=${r.strategyVersion.slice(0, 7)}`,
      );
      if (r.errorMessage) {
        console.log(`        error: ${r.errorMessage.substring(0, 72)}`);
      }
    }
  }

  // ───────────────────────────── RECENT SWAPS ────────────────────────────
  const swaps = getRecentSwaps(10);
  header(`RECENT SWAPS (last ${swaps.length})`);
  if (swaps.length === 0) {
    console.log('  (none)');
  } else {
    for (const sw of swaps) {
      const status = sw.success ? '✅' : '❌';
      const impact =
        sw.priceImpactPct !== null ? ` impact=${fmt2(sw.priceImpactPct)}%` : '';
      const out =
        sw.actualOutput !== null ? `→ ${fmt2(sw.actualOutput)}` : '(no output)';
      console.log(
        `  ${status}  ${sw.timestamp}  ${sw.direction}  ${fmt2(sw.inputAmount)} ${out}  [${sw.context}]${impact}`,
      );
    }
  }

  console.log();
  console.log('═'.repeat(72));
  console.log();
}

main();
