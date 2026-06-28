/**
 * JupiterPerpsEngine — Jupiter Perpetuals backend for the hedge (ADR-015).
 *
 * Read side: reads the SHORT SOL position (if any), the SOL custody's borrow
 * rate (the carry cost), oracle price, collateral, and net ΔSOL. Mutations
 * (open/adjust/close via the request + keeper-fill flow) land in a later step
 * and stay `notImplemented` here for now.
 *
 * Why direct fetches (not a polling subscriber like Drift): Jupiter Perps data
 * we need is a couple of accounts (custody + our one position PDA). A direct
 * fetch per read is cheaper and simpler than maintaining a subscription, and
 * keeps the read side stateless.
 */

import type { LpExposure } from '../types/index.js';
import type { DeltaView, HedgeEngine, HedgeState } from './hedgeEngine.js';
import { getConfig } from '../config/env.js';
import { getWalletKeypair } from '../utils/solana.js';
import { getSolPrice } from '../core/priceOracle.js';
import { log } from '../utils/logger.js';
import {
  anchor,
  CUSTODY,
  USD_PRECISION,
  borrowAprPct,
  generateShortSolPositionPda,
  getPerpsProgram,
} from '../utils/jupiterPerps.js';

function notImplemented(method: string): never {
  throw new Error(`JupiterPerpsEngine.${method}() not implemented yet (ADR-015 write side)`);
}

export class JupiterPerpsEngine implements HedgeEngine {
  readonly venue = 'jupiter-perps';

  private program: any;
  private walletPubkey: any;
  private positionPda: any;
  private initialized = false;

  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.program = getPerpsProgram();
    // Derive the wallet pubkey in jup-anchor's web3 from the project keypair's bytes.
    this.walletPubkey = anchor.web3.Keypair.fromSecretKey(getWalletKeypair().secretKey).publicKey;
    this.positionPda = generateShortSolPositionPda(this.walletPubkey);
    this.initialized = true;
    log.info('JupiterPerpsEngine initialized (read-side)', {
      wallet: this.walletPubkey.toBase58(),
      shortPositionPda: this.positionPda.toBase58(),
    });
  }

  private assertInitialized(): void {
    if (!this.initialized) throw new Error('JupiterPerpsEngine.initialize() must be called first');
  }

  /** Fetch our SHORT SOL position, or null if it doesn't exist / is closed (sizeUsd == 0). */
  private async fetchOpenPosition(): Promise<any | null> {
    try {
      const pos = await this.program.account.position.fetch(this.positionPda);
      // Jupiter doesn't close position accounts; a closed position has sizeUsd == 0.
      return pos.sizeUsd.eqn(0) ? null : pos;
    } catch {
      // Account does not exist yet => no position.
      return null;
    }
  }

  async getHedgeState(): Promise<HedgeState> {
    this.assertInitialized();

    // Carry cost (always available, even with no position) + oracle price.
    const solCustody = await this.program.account.custody.fetch(CUSTODY.SOL);
    const carryAprPct = borrowAprPct(solCustody); // positive % cost
    const carryRateBps = -(carryAprPct * 100); // negative = the short PAYS

    const priceData = await getSolPrice().catch(() => null);
    const oraclePriceUsd = priceData?.usd ?? 0;

    const position = await this.fetchOpenPosition();

    if (!position) {
      return {
        venue: this.venue,
        perpBaseSol: 0,
        perpNotionalUsd: 0,
        totalCollateralUsd: 0,
        freeCollateralUsd: 0,
        collateralRatio: Infinity,
        carryRateBps,
        liquidationPrice: null,
        oraclePriceUsd,
      };
    }

    const notionalUsd = position.sizeUsd.toNumber() / USD_PRECISION;
    const collateralUsd = position.collateralUsd.toNumber() / USD_PRECISION;
    // Short → negative base. SOL exposure = notional / mark price.
    const perpBaseSol = oraclePriceUsd > 0 ? -(notionalUsd / oraclePriceUsd) : 0;
    const collateralRatio = notionalUsd > 0 ? collateralUsd / notionalUsd : Infinity;

    return {
      venue: this.venue,
      perpBaseSol,
      perpNotionalUsd: notionalUsd,
      totalCollateralUsd: collateralUsd,
      freeCollateralUsd: collateralUsd, // Jupiter has no separate "free" margin per position
      collateralRatio,
      carryRateBps,
      liquidationPrice: null, // TODO: compute from position (next step)
      oraclePriceUsd,
    };
  }

  async computeDelta(lpExposure: LpExposure): Promise<DeltaView> {
    const state = await this.getHedgeState();
    const lpSolExposure = lpExposure.solAmount;
    // Signed: LP long (+), short negative (perpBaseSol < 0) → perfect hedge sums to ~0.
    const netDeltaSol = lpSolExposure + state.perpBaseSol;
    const shortSol = Math.max(0, -state.perpBaseSol);
    return {
      lpSolExposure,
      shortSol,
      netDeltaSol,
      outOfBand: Math.abs(netDeltaSol) > getConfig().deltaThresholdSol,
    };
  }

  // --- Write side (request + keeper-fill flow) — implemented in the next step ---
  async rebalanceHedge(): Promise<never> {
    notImplemented('rebalanceHedge');
  }
  async emergencyUnwind(): Promise<never> {
    notImplemented('emergencyUnwind');
  }

  async shutdown(): Promise<void> {
    // Direct-fetch engine: no subscriptions to tear down.
    this.initialized = false;
  }
}
