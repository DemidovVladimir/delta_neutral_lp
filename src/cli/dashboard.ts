#!/usr/bin/env node
/**
 * Hedge Dashboard CLI (ADR-014, Step 5a) — READ-ONLY observability panel.
 *
 * A terminal dashboard (blessed-contrib) showing wallet balances, SOL price,
 * Meteora LP exposure, the Drift hedge state, and net ΔSOL vs the rebalance
 * band. It performs NO writes and sends NO transactions.
 *
 * Usage:
 *   pnpm dashboard                 Live panel, refresh every 5s (needs a TTY)
 *   pnpm dashboard --interval=2000 Live panel, custom refresh interval (ms)
 *   pnpm dashboard --mock          Render with deterministic fake data (layout check)
 *   pnpm dashboard --json          Print one real snapshot as JSON and exit (no TTY)
 *   pnpm dashboard --mock --json   Print the fake snapshot as JSON (fully offline)
 *   pnpm dashboard --help
 *
 * Quit the live panel with q / Esc / Ctrl-C.
 */

import { getConnection, getWalletKeypair } from '../utils/solana.js';
import { getConfig } from '../config/env.js';
import { log } from '../utils/logger.js';
import { MeteoraAdapter } from '../modules/meteoraAdapter.js';
import { JupiterPerpsEngine } from '../modules/jupiterPerpsEngine.js';
import {
  collectSnapshot,
  mockSnapshot,
  type DashboardSnapshot,
  type HedgeStatus,
  type SnapshotSources,
} from '../modules/dashboardData.js';
import { blessed, contrib } from '../utils/dashboardLib.js';

// ----------------------------- formatting helpers -----------------------------

function fmt(n: number, d = 2): string {
  if (!Number.isFinite(n)) return '∞';
  return n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}
function shortAddr(a: string): string {
  return a.length > 12 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a;
}
/** JSON replacer so non-finite numbers (e.g. collateralRatio = Infinity) read clearly. */
function jsonReplacer(_k: string, v: unknown): unknown {
  return typeof v === 'number' && !Number.isFinite(v) ? String(v) : v;
}

// ----------------------------- dependency wiring -----------------------------

function initMeteora(): MeteoraAdapter | null {
  const cfg = getConfig();
  if (!cfg.meteoraPoolAddress) return null;
  try {
    return new MeteoraAdapter();
  } catch {
    return null;
  }
}

async function initHedge(): Promise<{ hedgeEngine: JupiterPerpsEngine | null; status: HedgeStatus; detail?: string }> {
  const hedgeEngine = new JupiterPerpsEngine();
  try {
    await hedgeEngine.initialize();
    return { hedgeEngine, status: 'active' };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await hedgeEngine.shutdown().catch(() => {});
    return { hedgeEngine: null, status: 'error', detail: msg };
  }
}

// ------------------------------- rendering -----------------------------------

function buildUi() {
  const screen = blessed.screen({ smartCSR: true, title: 'Delta-Neutral Hedge Dashboard' });
  const grid = new contrib.grid({ rows: 12, cols: 12, screen });

  const tableOpts = (label: string, widths: number[]) => ({
    label,
    keys: false,
    interactive: false,
    columnSpacing: 2,
    columnWidth: widths,
  });

  const walletTable = grid.set(0, 0, 4, 6, contrib.table, tableOpts(' Wallet & Price ', [14, 26]));
  const lpTable = grid.set(0, 6, 4, 6, contrib.table, tableOpts(' LP Exposure (Meteora) ', [14, 24]));
  const hedgeTable = grid.set(4, 0, 4, 6, contrib.table, tableOpts(' Hedge (Jupiter SOL short) ', [16, 24]));
  const deltaGauge = grid.set(4, 6, 2, 6, contrib.gauge, { label: ' Net ΔSOL vs Band ' });
  const collatGauge = grid.set(6, 6, 2, 6, contrib.gauge, { label: ' Collateral Health ' });
  const logBox = grid.set(8, 0, 4, 12, contrib.log, { label: ' Events (read-only — no funds touched) ', bufferLength: 60 });

  return { screen, walletTable, lpTable, hedgeTable, deltaGauge, collatGauge, logBox };
}

type Ui = ReturnType<typeof buildUi>;

function applySnapshot(ui: Ui, s: DashboardSnapshot): void {
  ui.walletTable.setData({
    headers: ['Field', 'Value'],
    data: [
      ['Address', shortAddr(s.wallet.address)],
      ['SOL', fmt(s.wallet.sol, 4)],
      ['USDC', fmt(s.wallet.usdc, 2)],
      ['SOL price', `$${fmt(s.price.solUsd, 2)} (${s.price.source})`],
    ],
  });

  ui.lpTable.setData({
    headers: ['Field', 'Value'],
    data: s.lp.available
      ? [
          ['SOL', fmt(s.lp.solAmount, 4)],
          ['USDC', fmt(s.lp.usdcAmount, 2)],
          ['Value USD', `$${fmt(s.lp.totalUsd, 2)}`],
          ['Positions', String(s.lp.positionCount)],
          ['Claimable', `${fmt(s.lp.claimableSol, 4)} SOL / ${fmt(s.lp.claimableUsdc, 2)} USDC`],
        ]
      : [['status', 'unavailable'], ['reason', s.lp.detail ?? 'n/a']],
  });

  const h = s.hedge;
  ui.hedgeTable.setData({
    headers: ['Field', 'Value'],
    data:
      h.status === 'active'
        ? [
            ['Status', 'ACTIVE'],
            ['Perp base SOL', `${fmt(h.perpBaseSol, 4)}${h.perpBaseSol < 0 ? ' (short)' : ''}`],
            ['Notional USD', `$${fmt(h.perpNotionalUsd, 2)}`],
            ['Collateral USD', `$${fmt(h.freeCollateralUsd, 2)} / $${fmt(h.totalCollateralUsd, 2)}`],
            ['Collat ratio', fmt(h.collateralRatio, 3)],
            ['Carry (bps/yr)', `${fmt(h.carryRateBps, 0)} ${h.carryRateBps < 0 ? '(pays)' : h.carryRateBps > 0 ? '(earns)' : ''}`],
            ['Liq price', h.liquidationPrice === null ? 'n/a' : `$${fmt(h.liquidationPrice, 2)}`],
          ]
        : [['Status', h.status.toUpperCase()], ['Detail', h.detail ?? 'no hedge yet']],
  });

  // Net-delta gauge: percent of band consumed; label carries the verdict.
  const pctBand = s.delta.bandSol > 0 ? Math.min(100, (Math.abs(s.delta.netDeltaSol) / s.delta.bandSol) * 100) : 0;
  ui.deltaGauge.setLabel(
    ` Net ΔSOL ${fmt(s.delta.netDeltaSol, 3)} / ±${fmt(s.delta.bandSol, 2)}  ${s.delta.outOfBand ? 'OUT-OF-BAND' : 'IN-BAND'} `
  );
  ui.deltaGauge.setData([Math.round(pctBand)]);

  // Collateral health: rough proxy (free/notional). n/a when there's no position.
  const healthPct = Number.isFinite(h.collateralRatio) ? Math.max(0, Math.min(100, Math.round(h.collateralRatio * 100))) : 0;
  ui.collatGauge.setLabel(h.status === 'active' && Number.isFinite(h.collateralRatio) ? ' Collateral Health ' : ' Collateral Health (n/a) ');
  ui.collatGauge.setData([healthPct]);
}

// --------------------------------- main --------------------------------------

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Hedge Dashboard (ADR-014, Step 5a) — read-only, no funds touched

  pnpm dashboard                 Live panel, refresh every 5s (needs a TTY)
  pnpm dashboard --interval=2000 Live panel, custom refresh interval (ms)
  pnpm dashboard --mock          Render with deterministic fake data (layout check)
  pnpm dashboard --json          Print one real snapshot as JSON and exit (no TTY)
  pnpm dashboard --mock --json   Print the fake snapshot as JSON (fully offline)

Quit the live panel with q / Esc / Ctrl-C.
`);
    process.exit(0);
  }

  const mock = args.includes('--mock');
  const json = args.includes('--json');
  const intervalArg = args.find((a) => a.startsWith('--interval='));
  const intervalMs = intervalArg ? Math.max(500, Number(intervalArg.split('=')[1]) || 5000) : 5000;

  // ---- JSON mode: collect one snapshot, print, exit. No blessed, no TTY. ----
  if (json) {
    let snap: DashboardSnapshot;
    let hedgeEngine: JupiterPerpsEngine | null = null;
    if (mock) {
      snap = mockSnapshot();
    } else {
      const connection = getConnection();
      const walletPubkey = getWalletKeypair().publicKey;
      const meteora = initMeteora();
      const hedge = await initHedge();
      hedgeEngine = hedge.hedgeEngine;
      const sources: SnapshotSources = {
        connection,
        walletPubkey,
        meteora,
        hedgeEngine: hedge.hedgeEngine,
        hedgeStatus: hedge.status,
        hedgeDetail: hedge.detail,
        deltaThresholdSol: getConfig().deltaThresholdSol,
      };
      snap = await collectSnapshot(sources);
    }
    console.log(JSON.stringify(snap, jsonReplacer, 2));
    if (hedgeEngine) await hedgeEngine.shutdown().catch(() => {});
    process.exit(0);
  }

  // ---- Render modes need a TTY. Fail clearly instead of letting blessed crash. ----
  if (!process.stdout.isTTY) {
    log.error('Dashboard render mode requires an interactive terminal (TTY). Use `--json` for non-interactive output.');
    process.exit(1);
  }

  // Wire deps (mock skips all network/SDK setup).
  let hedgeEngine: JupiterPerpsEngine | null = null;
  let sources: SnapshotSources | null = null;
  if (!mock) {
    const connection = getConnection();
    const walletPubkey = getWalletKeypair().publicKey;
    const meteora = initMeteora();
    const hedge = await initHedge();
    hedgeEngine = hedge.hedgeEngine;
    sources = {
      connection,
      walletPubkey,
      meteora,
      hedgeEngine: hedge.hedgeEngine,
      hedgeStatus: hedge.status,
      hedgeDetail: hedge.detail,
      deltaThresholdSol: getConfig().deltaThresholdSol,
    };
  }

  const ui = buildUi();
  let timer: ReturnType<typeof setInterval> | null = null;

  const teardown = async () => {
    if (timer) clearInterval(timer);
    try {
      ui.screen.destroy();
    } catch {
      /* ignore */
    }
    if (hedgeEngine) await hedgeEngine.shutdown().catch(() => {});
    process.exit(0);
  };
  ui.screen.key(['q', 'C-c', 'escape'], () => {
    void teardown();
  });

  const refresh = async () => {
    try {
      const snap = mock ? mockSnapshot() : await collectSnapshot(sources!);
      applySnapshot(ui, snap);
      ui.logBox.log(
        `${new Date(snap.timestamp).toLocaleTimeString()}  Δ ${fmt(snap.delta.netDeltaSol, 3)} SOL · hedge ${snap.hedge.status} · LP ${snap.lp.available ? 'ok' : 'n/a'}`
      );
      ui.screen.render();
    } catch (e) {
      ui.logBox.log(`refresh error: ${e instanceof Error ? e.message : String(e)}`);
      ui.screen.render();
    }
  };

  await refresh();
  // Mock is static (no point polling fake data); live mode polls.
  if (!mock) timer = setInterval(refresh, intervalMs);
  ui.logBox.log(mock ? 'MOCK data — layout check only. Press q to quit.' : `Live · refresh ${intervalMs}ms. Press q to quit.`);
  ui.screen.render();
}

main().catch((error) => {
  log.error('Unhandled error in dashboard CLI', {
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
  process.exit(1);
});
