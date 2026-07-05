/**
 * Dashboard Data Layer (ADR-014, Step 5a)
 *
 * Collects a single read-only snapshot of everything the hedge operator needs
 * to see: wallet balances, SOL price, Meteora LP exposure, the Jupiter Perps
 * hedge state (incl. carry cost), and the derived net-ΔSOL vs the rebalance band.
 *
 * This module performs NO writes and renders nothing — it returns a plain
 * `DashboardSnapshot` object. Keeping data collection separate from rendering
 * means the snapshot can be dumped as JSON and validated deterministically
 * (`pnpm dashboard --json`) without a TTY or any blessed dependency, and the
 * layout can be exercised with `mockSnapshot()` without touching the network.
 */

import { Connection, PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddress } from '@solana/spl-token';
import { getSolPrice } from '../core/priceOracle.js';
import { getConfig } from '../config/env.js';
import { computeLpMidpointSol } from './hedgeController.js';
import type { MeteoraAdapter } from './meteoraAdapter.js';
import type { JupiterPerpsEngine } from './jupiterPerpsEngine.js';

const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');

/** High-level state of the hedge read. */
export type HedgeStatus = 'active' | 'disabled' | 'error';

export interface DashboardSnapshot {
  timestamp: number;
  wallet: {
    address: string;
    sol: number;
    usdc: number;
  };
  price: {
    solUsd: number;
    source: string;
  };
  lp: {
    available: boolean; // false if no pool/positions configured or read failed
    detail?: string; // why unavailable, when applicable
    solAmount: number;
    usdcAmount: number;
    totalUsd: number;
    claimableSol: number;
    claimableUsdc: number;
    positionCount: number;
  };
  hedge: {
    status: HedgeStatus;
    venue?: string; // e.g. 'jupiter-perps'
    detail?: string; // error text when status === 'error'
    perpBaseSol: number; // negative = short; 0 when none
    perpNotionalUsd: number;
    totalCollateralUsd: number;
    freeCollateralUsd: number;
    collateralRatio: number; // Infinity when no position
    carryRateBps: number; // annualised carry; NEGATIVE = the short PAYS (Jupiter borrow fee)
    liquidationPrice: number | null;
  };
  delta: {
    /** LP SOL figure the CONTROLLER sees (midpoint in ADR-019 mode, else live). */
    lpSol: number;
    /** Raw current LP SOL composition, regardless of hedge input mode. */
    lpSolLive: number;
    hedgeLpInput: 'live' | 'midpoint';
    shortSol: number; // magnitude of the short (0 if none)
    netDeltaSol: number; // lpSol + perpBaseSol; target ≈ 0
    bandSol: number; // deltaThresholdSol
    outOfBand: boolean;
  };
}

/** Inputs for a snapshot. The CLI owns the lifecycle of these long-lived deps. */
export interface SnapshotSources {
  connection: Connection;
  walletPubkey: PublicKey;
  /** Read-only LP adapter, or null when no pool is configured. */
  meteora: MeteoraAdapter | null;
  /** Initialized hedge engine when the read is live, else null. */
  hedgeEngine: JupiterPerpsEngine | null;
  /** Status decided by the CLI when it tried to initialize the engine. */
  hedgeStatus: HedgeStatus;
  hedgeDetail?: string;
  /** Rebalance band (DELTA_THRESHOLD_SOL). */
  deltaThresholdSol: number;
}

async function readWalletUsdc(connection: Connection, owner: PublicKey): Promise<number> {
  try {
    const ata = await getAssociatedTokenAddress(USDC_MINT, owner);
    const bal = await connection.getTokenAccountBalance(ata);
    return bal.value.uiAmount ?? 0;
  } catch {
    // No ATA yet (or RPC hiccup) => treat as zero USDC held.
    return 0;
  }
}

/**
 * Collect one read-only snapshot. Never throws for an individual source —
 * each section degrades to an "unavailable"/zero state with a `detail` note so
 * one failing read can't blank the whole panel.
 */
export async function collectSnapshot(sources: SnapshotSources): Promise<DashboardSnapshot> {
  const { connection, walletPubkey, meteora, hedgeEngine, hedgeStatus, hedgeDetail, deltaThresholdSol } =
    sources;

  // --- Wallet + price (always attempted) ---
  const [solLamports, usdc, priceData] = await Promise.all([
    connection.getBalance(walletPubkey).catch(() => 0),
    readWalletUsdc(connection, walletPubkey),
    getSolPrice().catch(() => null),
  ]);
  const walletSol = solLamports / 1e9;
  const solUsd = priceData?.usd ?? 0;
  const priceSource = priceData?.source ?? 'unavailable';

  // --- LP exposure (Meteora) ---
  const lp: DashboardSnapshot['lp'] = {
    available: false,
    solAmount: 0,
    usdcAmount: 0,
    totalUsd: 0,
    claimableSol: 0,
    claimableUsdc: 0,
    positionCount: 0,
  };
  if (meteora) {
    try {
      const exp = await meteora.getLpExposure();
      lp.available = true;
      lp.solAmount = exp.solAmount;
      lp.usdcAmount = exp.usdcAmount;
      lp.totalUsd = exp.totalUsd;
      lp.claimableSol = exp.claimableSol;
      lp.claimableUsdc = exp.claimableUsdc;
      lp.positionCount = exp.positions.length;
    } catch (e) {
      lp.detail = e instanceof Error ? e.message : String(e);
    }
  } else {
    lp.detail = 'no pool configured';
  }

  // --- Hedge state (Jupiter Perps) ---
  const hedge: DashboardSnapshot['hedge'] = {
    status: hedgeStatus,
    detail: hedgeDetail,
    perpBaseSol: 0,
    perpNotionalUsd: 0,
    totalCollateralUsd: 0,
    freeCollateralUsd: 0,
    collateralRatio: Infinity,
    carryRateBps: 0,
    liquidationPrice: null,
  };
  if (hedgeStatus === 'active' && hedgeEngine) {
    try {
      const s = await hedgeEngine.getHedgeState();
      hedge.venue = s.venue;
      hedge.perpBaseSol = s.perpBaseSol;
      hedge.perpNotionalUsd = s.perpNotionalUsd;
      hedge.totalCollateralUsd = s.totalCollateralUsd;
      hedge.freeCollateralUsd = s.freeCollateralUsd;
      hedge.collateralRatio = s.collateralRatio;
      hedge.carryRateBps = s.carryRateBps;
      hedge.liquidationPrice = s.liquidationPrice;
    } catch (e) {
      hedge.status = 'error';
      hedge.detail = e instanceof Error ? e.message : String(e);
    }
  }

  // --- Net delta ---
  const config = getConfig();
  // Show the CONTROLLER's view (ADR-019): in 'midpoint' mode the hedge
  // targets the SOL half of LP value, not the live composition — a live-based
  // netΔ would false-alarm outOfBand on every intra-range swing while the
  // controller is perfectly in band. `lpSolLive` is kept alongside so the
  // operator still sees the raw composition.
  const lpSolLive = lp.available ? lp.solAmount : 0;
  const lpSolForDelta =
    config.hedgeLpInput === 'midpoint' && lp.available
      ? computeLpMidpointSol(lp.solAmount, lp.usdcAmount, solUsd)
      : lpSolLive;
  const netDeltaSol = lpSolForDelta + hedge.perpBaseSol;
  const shortSol = Math.max(0, -hedge.perpBaseSol);

  return {
    timestamp: Date.now(),
    wallet: { address: walletPubkey.toBase58(), sol: walletSol, usdc },
    price: { solUsd, source: priceSource },
    lp,
    hedge,
    delta: {
      lpSol: lpSolForDelta,
      lpSolLive,
      hedgeLpInput: config.hedgeLpInput,
      shortSol,
      netDeltaSol,
      bandSol: deltaThresholdSol,
      outOfBand: Math.abs(netDeltaSol) > deltaThresholdSol,
    },
  };
}

/** Deterministic fake snapshot for layout validation (`--mock`). No network. */
export function mockSnapshot(): DashboardSnapshot {
  const lpSol = 12.5;
  const perpBaseSol = -12.0; // short
  const netDeltaSol = lpSol + perpBaseSol;
  return {
    timestamp: 1_700_000_000_000,
    wallet: { address: 'MockWa11et1111111111111111111111111111111111', sol: 0.84, usdc: 1840.27 },
    price: { solUsd: 152.31, source: 'jupiter' },
    lp: {
      available: true,
      solAmount: lpSol,
      usdcAmount: 1840,
      totalUsd: 3744,
      claimableSol: 0.012,
      claimableUsdc: 1.4,
      positionCount: 1,
    },
    hedge: {
      status: 'active',
      venue: 'jupiter-perps',
      perpBaseSol,
      perpNotionalUsd: 1827.7,
      totalCollateralUsd: 1210,
      freeCollateralUsd: 980,
      collateralRatio: 0.536,
      carryRateBps: -1177, // negative = short pays borrow fee (~11.8% APR)
      liquidationPrice: 198.4,
    },
    delta: { lpSol, lpSolLive: lpSol, hedgeLpInput: 'live', shortSol: 12.0, netDeltaSol, bandSol: 2.0, outOfBand: Math.abs(netDeltaSol) > 2 },
  };
}
