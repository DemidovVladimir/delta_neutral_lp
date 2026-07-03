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
import type {
  DeltaView,
  HedgeEngine,
  HedgeRebalanceResult,
  HedgeState,
  MutationResult,
  SimResult,
} from './hedgeEngine.js';
import { getConfig } from '../config/env.js';
import { getWalletKeypair } from '../utils/solana.js';
import { getSolPrice } from '../core/priceOracle.js';
import { log } from '../utils/logger.js';
import {
  anchor,
  BN,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  CUSTODY,
  JLP_POOL_ACCOUNT,
  JUPITER_PERPETUALS_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  USDC_DECIMALS_POW,
  USDC_MINT,
  USD_PRECISION,
  borrowAprPct,
  computeLiquidationPrice,
  deriveAta,
  findEventAuthorityPda,
  findPerpetualsPda,
  generatePositionRequestPda,
  generateShortSolPositionPda,
  getPerpsProgram,
} from '../utils/jupiterPerps.js';

/**
 * Default execution slippage for a perp request, in bps. Bounds the price the
 * keeper may fill at (for a short open, a price FLOOR below the oracle). No
 * dedicated config field yet — the controller can thread one through later;
 * for now the CLI exposes `--slippage-bps` to override per call.
 */
const DEFAULT_PERP_SLIPPAGE_BPS = 50;

/**
 * Price ceiling for a FULL close, in 6-dp USD (= $100,000). A short decrease
 * buys SOL back, so `priceSlippage` is a MAX price; a ceiling far above any SOL
 * price means "fill at any price" — a guaranteed close. Mirrors Jupiter's
 * reference repo. Partial decreases use a real ceiling (oracle * (1 + slip)).
 */
const FULL_CLOSE_PRICE_CEILING = new BN(100_000_000_000);

export class JupiterPerpsEngine implements HedgeEngine {
  readonly venue = 'jupiter-perps';

  private program: any;
  /** jup-anchor Keypair (signs write-side transactions). */
  private walletKeypair: any;
  private walletPubkey: any;
  private positionPda: any;
  private initialized = false;

  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.program = getPerpsProgram();
    // Build the keypair in jup-anchor's web3 from the project keypair's bytes,
    // so the signer and every PublicKey share one web3 copy (no dual-web3 cast).
    this.walletKeypair = anchor.web3.Keypair.fromSecretKey(getWalletKeypair().secretKey);
    this.walletPubkey = this.walletKeypair.publicKey;
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

    // Liquidation price (faithful Jupiter port). Needs the COLLATERAL custody
    // (USDC for a short) for the accrued-borrow-fee term; the SOL custody we
    // already fetched supplies the close-fee bps + max leverage. Defensive: a
    // failed custody fetch leaves liqPrice null rather than failing the read.
    let liquidationPrice: number | null = null;
    try {
      const collateralCustody = await this.program.account.custody.fetch(position.collateralCustody);
      liquidationPrice = computeLiquidationPrice(position, solCustody, collateralCustody);
    } catch (e) {
      log.warn('Failed to compute liquidation price', {
        error: e instanceof Error ? e.message : String(e),
      });
    }

    return {
      venue: this.venue,
      perpBaseSol,
      perpNotionalUsd: notionalUsd,
      totalCollateralUsd: collateralUsd,
      freeCollateralUsd: collateralUsd, // Jupiter has no separate "free" margin per position
      collateralRatio,
      carryRateBps,
      liquidationPrice,
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

  // --- Write side (request + keeper-fill flow, ADR-015) ---

  /**
   * Compile a single instruction into a v0 transaction (payer = our wallet).
   * Returns the unsigned tx plus the blockhash window so a live send can
   * confirm against the same blockhash it built with.
   */
  private async buildTx(ix: any): Promise<{ tx: any; blockhash: string; lastValidBlockHeight: number }> {
    const connection = this.program.provider.connection;
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
    const msg = new anchor.web3.TransactionMessage({
      payerKey: this.walletPubkey,
      recentBlockhash: blockhash,
      instructions: [ix],
    }).compileToV0Message();
    return { tx: new anchor.web3.VersionedTransaction(msg), blockhash, lastValidBlockHeight };
  }

  /**
   * Simulate an instruction on-chain WITHOUT sending. `replaceRecentBlockhash`
   * + `sigVerify: false` means the tx needs no real signature or funded
   * blockhash — only the on-chain effect (and our wallet's token balances) is
   * checked. A revert here (e.g. insufficient USDC for the collateral transfer)
   * is exactly the pre-send signal we want.
   */
  private async simulateIx(ix: any): Promise<SimResult> {
    const connection = this.program.provider.connection;
    const { tx } = await this.buildTx(ix);
    const res = await connection.simulateTransaction(tx, {
      sigVerify: false,
      replaceRecentBlockhash: true,
      commitment: 'confirmed',
    });
    return {
      success: res.value.err === null,
      err: res.value.err ?? undefined,
      logs: res.value.logs ?? undefined,
      unitsConsumed: res.value.unitsConsumed,
    };
  }

  /** Sign + send + confirm an instruction. Live path only. */
  private async sendIx(ix: any): Promise<string> {
    const connection = this.program.provider.connection;
    const { tx, blockhash, lastValidBlockHeight } = await this.buildTx(ix);
    tx.sign([this.walletKeypair]);
    const signature = await connection.sendTransaction(tx, {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
    });
    await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed');
    return signature;
  }

  /**
   * Open a new SHORT SOL position or increase the existing one (TX1 of the
   * request+keeper flow). We submit a `createIncreasePositionMarketRequest`
   * that escrows `collateralUsdc` USDC into the request ATA and asks for
   * `sizeUsd` of added short notional; a Jupiter keeper fills it (TX2) shortly
   * after, opening/growing the position at oracle price subject to the slippage
   * floor. DRY-RUN by default (simulate only); pass `dryRun: false` to send.
   *
   * `sizeUsd`         — short notional to ADD, in USD.
   * `collateralUsdc`  — USDC collateral to post for this request, token units.
   * `slippageBps`     — keeper fill bound; for a short open this is a price
   *                     FLOOR = oracle * (1 - slippageBps/1e4). Default 50 bps.
   */
  async openOrIncreaseShort(params: {
    sizeUsd: number;
    collateralUsdc: number;
    slippageBps?: number;
    dryRun?: boolean;
  }): Promise<MutationResult> {
    this.assertInitialized();
    const dryRun = params.dryRun ?? true;
    const slippageBps = params.slippageBps ?? DEFAULT_PERP_SLIPPAGE_BPS;

    if (!(params.sizeUsd > 0)) throw new Error('openOrIncreaseShort: sizeUsd must be positive');
    if (!(params.collateralUsdc > 0)) throw new Error('openOrIncreaseShort: collateralUsdc must be positive');
    if (!(slippageBps >= 0 && slippageBps < 10_000)) {
      throw new Error('openOrIncreaseShort: slippageBps must be in [0, 10000)');
    }

    // Oracle price is required: the keeper fill bound is priced off it, and we
    // refuse to send a request we can't bound.
    const priceData = await getSolPrice().catch(() => null);
    const oraclePriceUsd = priceData?.usd ?? 0;
    if (!(oraclePriceUsd > 0)) {
      throw new Error('openOrIncreaseShort: no oracle SOL price available — refusing to build request');
    }
    // Short = selling SOL exposure → protect with a price FLOOR below oracle.
    const minFillPriceUsd = oraclePriceUsd * (1 - slippageBps / 10_000);

    const { positionRequest, counter } = generatePositionRequestPda(this.positionPda, 'increase');
    const fundingAccount = deriveAta(this.walletPubkey, USDC_MINT); // our USDC ATA (collateral source)
    const positionRequestAta = deriveAta(positionRequest, USDC_MINT); // escrow ATA (created by the ix)

    const ix = await this.program.methods
      .createIncreasePositionMarketRequest({
        sizeUsdDelta: new BN(Math.round(params.sizeUsd * USD_PRECISION)),
        collateralTokenDelta: new BN(Math.round(params.collateralUsdc * USDC_DECIMALS_POW)),
        side: { short: {} },
        priceSlippage: new BN(Math.round(minFillPriceUsd * USD_PRECISION)),
        jupiterMinimumOut: null, // collateral already USDC → no internal swap
        counter,
      })
      .accounts({
        owner: this.walletPubkey,
        fundingAccount,
        perpetuals: findPerpetualsPda(),
        pool: JLP_POOL_ACCOUNT,
        position: this.positionPda,
        positionRequest,
        positionRequestAta,
        custody: CUSTODY.SOL,
        collateralCustody: CUSTODY.USDC,
        inputMint: USDC_MINT,
        referral: null,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
        eventAuthority: findEventAuthorityPda(),
        program: JUPITER_PERPETUALS_PROGRAM_ID,
      })
      .instruction();

    const detail =
      `short +$${params.sizeUsd} notional, ${params.collateralUsdc} USDC collateral, ` +
      `fill floor $${minFillPriceUsd.toFixed(2)} (oracle $${oraclePriceUsd.toFixed(2)}, ${slippageBps} bps), ` +
      `request ${positionRequest.toBase58()}`;

    if (dryRun) {
      return { action: 'open_or_increase_short', dryRun: true, simulated: await this.simulateIx(ix), detail };
    }
    const signature = await this.sendIx(ix);
    return {
      action: 'open_or_increase_short',
      dryRun: false,
      signatures: [signature],
      detail: `${detail} — request submitted; Jupiter keeper fills (TX2) asynchronously`,
    };
  }

  /**
   * Decrease or fully close the SHORT SOL position (TX1 of the request+keeper
   * flow). Submits a `createDecreasePositionMarketRequest`; a keeper fills it
   * (TX2), buying SOL back and returning USDC to our wallet. DRY-RUN by default.
   *
   * `entirePosition: true`  → full close (deltas ignored by the program;
   *                           `priceSlippage` = a high ceiling so it always fills).
   * partial (default)       → reduce the short by `sizeUsd` notional and
   *                           optionally withdraw `collateralUsd`; fill bound is
   *                           a price CEILING = oracle * (1 + slippageBps/1e4).
   *
   * With no open position the request would revert; in dry-run we still simulate
   * (so the wiring is exercised and the revert is shown), and live refuses to send.
   */
  async decreaseOrCloseShort(params: {
    entirePosition?: boolean;
    sizeUsd?: number;
    collateralUsd?: number;
    slippageBps?: number;
    dryRun?: boolean;
  }): Promise<MutationResult> {
    this.assertInitialized();
    const dryRun = params.dryRun ?? true;
    const entire = params.entirePosition ?? false;
    const slippageBps = params.slippageBps ?? DEFAULT_PERP_SLIPPAGE_BPS;

    if (!(slippageBps >= 0 && slippageBps < 10_000)) {
      throw new Error('decreaseOrCloseShort: slippageBps must be in [0, 10000)');
    }
    if (!entire && !(params.sizeUsd && params.sizeUsd > 0)) {
      throw new Error('decreaseOrCloseShort: a partial decrease needs sizeUsd > 0 (or pass entirePosition)');
    }
    const collateralUsd = params.collateralUsd ?? 0;
    if (!(collateralUsd >= 0)) throw new Error('decreaseOrCloseShort: collateralUsd must be >= 0');

    const position = await this.fetchOpenPosition();
    const noPosition = !position;

    // priceSlippage: full close = high ceiling (always fill); partial = a real
    // ceiling above oracle (a short decrease buys back, so MAX price protects us).
    let priceSlippage = FULL_CLOSE_PRICE_CEILING;
    let ceilingDetail = 'ceiling $100000 (full close — fill at any price)';
    if (!entire) {
      const priceData = await getSolPrice().catch(() => null);
      const oraclePriceUsd = priceData?.usd ?? 0;
      if (!(oraclePriceUsd > 0)) {
        throw new Error('decreaseOrCloseShort: no oracle SOL price available for the partial fill ceiling');
      }
      const maxFillPriceUsd = oraclePriceUsd * (1 + slippageBps / 10_000);
      priceSlippage = new BN(Math.round(maxFillPriceUsd * USD_PRECISION));
      ceilingDetail = `ceiling $${maxFillPriceUsd.toFixed(2)} (oracle $${oraclePriceUsd.toFixed(2)}, ${slippageBps} bps)`;
    }

    const { positionRequest, counter } = generatePositionRequestPda(this.positionPda, 'decrease');
    const receivingAccount = deriveAta(this.walletPubkey, USDC_MINT); // USDC proceeds land here
    const positionRequestAta = deriveAta(positionRequest, USDC_MINT);

    const ix = await this.program.methods
      .createDecreasePositionMarketRequest({
        collateralUsdDelta: new BN(entire ? 0 : Math.round(collateralUsd * USD_PRECISION)),
        sizeUsdDelta: new BN(entire ? 0 : Math.round(params.sizeUsd! * USD_PRECISION)),
        priceSlippage,
        jupiterMinimumOut: null,
        entirePosition: entire,
        counter,
      })
      .accounts({
        owner: this.walletPubkey,
        receivingAccount,
        perpetuals: findPerpetualsPda(),
        pool: JLP_POOL_ACCOUNT,
        position: this.positionPda,
        positionRequest,
        positionRequestAta,
        custody: CUSTODY.SOL,
        collateralCustody: CUSTODY.USDC,
        desiredMint: USDC_MINT,
        referral: null,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
        eventAuthority: findEventAuthorityPda(),
        program: JUPITER_PERPETUALS_PROGRAM_ID,
      })
      .instruction();

    const what = entire ? 'full close' : `decrease −$${params.sizeUsd} notional, withdraw ${collateralUsd} USDC`;
    const base = `short ${what}, ${ceilingDetail}, request ${positionRequest.toBase58()}`;
    const detail = noPosition ? `no open short position — request would revert; ${base}` : base;

    if (dryRun) {
      return { action: 'decrease_or_close_short', dryRun: true, simulated: await this.simulateIx(ix), detail };
    }
    if (noPosition) {
      return {
        action: 'decrease_or_close_short',
        dryRun: false,
        detail: 'no open short position — nothing to close/decrease (not sent)',
      };
    }
    const signature = await this.sendIx(ix);
    return {
      action: 'decrease_or_close_short',
      dryRun: false,
      signatures: [signature],
      detail: `${base} — request submitted; Jupiter keeper fills (TX2) asynchronously`,
    };
  }

  /**
   * THE CONTROLLER. Given current LP SOL exposure, bring the SHORT toward
   * `lpExposure.solAmount` so net ΔSOL ≈ 0 — but only when out of band
   * (|netΔSOL| > DELTA_THRESHOLD_SOL, ADR-002), and only if the risk guards pass:
   *   - INCREASE: carry ≤ HEDGE_CARRY_CAP_BPS, projected notional ≤
   *     MAX_SHORT_NOTIONAL_USD, projected collateral ratio ≥ MIN_COLLATERAL_RATIO.
   *     Collateral is sized to HEDGE_TARGET_COLLATERAL_RATIO × notionalDelta.
   *   - DECREASE/close: always allowed (reducing risk). Full close when the
   *     reduction meets/exceeds the current short.
   * Returns 'blocked' with a reason instead of forcing an unsafe trade, 'none'
   * when in band. DRY-RUN by default — the actual mutation only sends with
   * `opts.dryRun === false`.
   */
  async rebalanceHedge(
    lpExposure: LpExposure,
    opts: { dryRun?: boolean; slippageBps?: number } = {},
  ): Promise<HedgeRebalanceResult> {
    this.assertInitialized();
    const dryRun = opts.dryRun ?? true;
    const cfg = getConfig();

    const state = await this.getHedgeState();

    // Delta view derived from this single read (avoids a second getHedgeState).
    const lpSolExposure = lpExposure.solAmount;
    const netDeltaSol = lpSolExposure + state.perpBaseSol; // short is negative
    const shortSol = Math.max(0, -state.perpBaseSol);
    const deltaBefore: DeltaView = {
      lpSolExposure,
      shortSol,
      netDeltaSol,
      outOfBand: Math.abs(netDeltaSol) > cfg.deltaThresholdSol,
    };

    const blocked = (reason: string): HedgeRebalanceResult => ({
      action: 'blocked',
      adjustedSol: 0,
      blockedReason: reason,
      signatures: [],
      deltaBefore,
    });

    const price = state.oraclePriceUsd;
    if (!(price > 0)) return blocked('no oracle SOL price available');
    if (!deltaBefore.outOfBand) {
      return { action: 'none', adjustedSol: 0, signatures: [], deltaBefore };
    }

    const adjustSol = Math.abs(netDeltaSol);
    const notionalDeltaUsd = adjustSol * price;

    if (netDeltaSol > 0) {
      // Under-hedged → INCREASE the short by `adjustSol` SOL.
      const carryAprBps = -state.carryRateBps; // carryRateBps negative = pays; magnitude = cost bps
      if (cfg.hedgeCarryCapBps > 0 && carryAprBps > cfg.hedgeCarryCapBps) {
        return blocked(
          `carry ${(carryAprBps / 100).toFixed(2)}% APR exceeds cap ${(cfg.hedgeCarryCapBps / 100).toFixed(2)}%`,
        );
      }
      const projectedNotional = state.perpNotionalUsd + notionalDeltaUsd;
      if (projectedNotional > cfg.maxShortNotionalUsd) {
        return blocked(
          `projected short notional $${projectedNotional.toFixed(2)} exceeds max $${cfg.maxShortNotionalUsd}`,
        );
      }
      const collateralUsdc = notionalDeltaUsd * cfg.hedgeTargetCollateralRatio;
      const projectedRatio = projectedNotional > 0 ? (state.totalCollateralUsd + collateralUsdc) / projectedNotional : Infinity;
      if (projectedRatio < cfg.minCollateralRatio) {
        return blocked(
          `projected collateral ratio ${projectedRatio.toFixed(3)} below min ${cfg.minCollateralRatio}`,
        );
      }

      const mutation = await this.openOrIncreaseShort({
        sizeUsd: notionalDeltaUsd,
        collateralUsdc,
        slippageBps: opts.slippageBps,
        dryRun,
      });
      // adjustedSol signed: negative = added to the short.
      return { action: 'increase_short', adjustedSol: -adjustSol, signatures: mutation.signatures ?? [], deltaBefore, mutation };
    }

    // Over-hedged (netDeltaSol < 0) → DECREASE the short by `adjustSol` SOL.
    const entirePosition = adjustSol >= shortSol - 1e-9;
    const mutation = entirePosition
      ? await this.decreaseOrCloseShort({ entirePosition: true, slippageBps: opts.slippageBps, dryRun })
      : await this.decreaseOrCloseShort({
          sizeUsd: notionalDeltaUsd,
          // Withdraw collateral proportionally so the ratio stays ≈ target.
          collateralUsd: notionalDeltaUsd * cfg.hedgeTargetCollateralRatio,
          slippageBps: opts.slippageBps,
          dryRun,
        });
    return { action: 'decrease_short', adjustedSol: adjustSol, signatures: mutation.signatures ?? [], deltaBefore, mutation };
  }

  /**
   * EMERGENCY UNWIND — fully close the SHORT SOL position at any price
   * (guaranteed fill). Delegates to `decreaseOrCloseShort({ entirePosition: true })`,
   * which sets `priceSlippage` to the $100,000 ceiling ("fill at any price") so a
   * keeper fills even in a fast market — we accept worst-case slippage in exchange
   * for getting flat. No-op (not sent) when no short is open. DRY-RUN by default;
   * pass `dryRun: false` to actually submit the close request.
   */
  async emergencyUnwind(opts: { dryRun?: boolean } = {}): Promise<MutationResult> {
    this.assertInitialized();
    const dryRun = opts.dryRun ?? true;
    log.errorBanner('🚨 EMERGENCY UNWIND — full close of SHORT SOL position (fill at any price)', {
      dryRun,
    });
    const result = await this.decreaseOrCloseShort({ entirePosition: true, dryRun });
    return { ...result, action: 'emergency_unwind' };
  }

  async shutdown(): Promise<void> {
    // Direct-fetch engine: no subscriptions to tear down.
    this.initialized = false;
  }
}
