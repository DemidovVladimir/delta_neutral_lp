/**
 * JupiterPerpsEngine — Jupiter Perpetuals backend for the hedge (ADR-015/017).
 *
 * Read side: reads BOTH SOL position PDAs (long + short), the custodies' borrow
 * rates (the carry cost — charged on each side's COLLATERAL custody: USDC for
 * shorts, SOL for longs), oracle price, collateral, and net ΔSOL.
 *
 * Write side: open/increase and decrease/close on EITHER side via the
 * request + keeper-fill flow (TX1 = our market request, TX2 = a Jupiter keeper
 * fills it asynchronously seconds later). Shorts post USDC collateral; longs
 * post pre-wrapped wSOL (Jupiter collateralises longs in the traded asset).
 * All mutations are DRY-RUN by default.
 *
 * The decision logic lives in the pure `hedgeController.decideHedgeAction` —
 * `rebalanceHedge` here is just read → decide → execute → report.
 *
 * Why direct fetches (not a polling subscriber): the data we need is a handful
 * of accounts; a direct fetch per read is cheaper and simpler than maintaining
 * a subscription, and keeps the read side stateless.
 */

import type { LpExposure } from '../types/index.js';
import type {
  DeltaView,
  HedgeEngine,
  HedgeRebalanceResult,
  HedgeSideState,
  HedgeState,
  MutationResult,
  SimResult,
} from './hedgeEngine.js';
import { decideHedgeAction } from './hedgeController.js';
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
  SOL_DECIMALS_POW,
  SOL_MINT,
  TOKEN_PROGRAM_ID,
  USDC_DECIMALS_POW,
  USDC_MINT,
  USD_PRECISION,
  borrowAprPct,
  computeLiquidationPrice,
  createAtaIdempotentIx,
  createCloseAccountIx,
  createSyncNativeIx,
  deriveAta,
  findEventAuthorityPda,
  findPerpetualsPda,
  generatePositionRequestPda,
  generateSolPositionPda,
  getPerpsProgram,
  type PositionSide,
} from '../utils/jupiterPerps.js';

export type { PositionSide };

/**
 * Default execution slippage for a perp request, in bps. Bounds the price the
 * keeper may fill at. The CLI and the controller can override per call.
 */
const DEFAULT_PERP_SLIPPAGE_BPS = 50;

/**
 * Guaranteed-fill bounds for FULL closes, in 6-dp USD. A short decrease buys
 * SOL back → `priceSlippage` is a MAX price, so a ceiling far above any SOL
 * price ($100,000) means "fill at any price". A long decrease sells → a FLOOR,
 * so the mirror is a floor of $0.000001. Mirrors Jupiter's reference repo.
 */
const FULL_CLOSE_SHORT_PRICE_CEILING = new BN(100_000_000_000);
const FULL_CLOSE_LONG_PRICE_FLOOR = new BN(1);

/** Everything that differs between the two sides, in one place. */
interface SideWiring {
  side: PositionSide;
  sideEnum: { long: Record<string, never> } | { short: Record<string, never> };
  collateralCustody: any;
  /** Mint of the collateral/proceeds token (USDC for short, wSOL for long). */
  collateralMint: any;
  /** Raw units per human unit of the collateral token. */
  collateralDecimalsPow: number;
}

export class JupiterPerpsEngine implements HedgeEngine {
  readonly venue = 'jupiter-perps';

  private program: any;
  /** jup-anchor Keypair (signs write-side transactions). */
  private walletKeypair: any;
  private walletPubkey: any;
  private positionPdas!: { long: any; short: any };
  private initialized = false;

  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.program = getPerpsProgram();
    // Build the keypair in jup-anchor's web3 from the project keypair's bytes,
    // so the signer and every PublicKey share one web3 copy (no dual-web3 cast).
    this.walletKeypair = anchor.web3.Keypair.fromSecretKey(getWalletKeypair().secretKey);
    this.walletPubkey = this.walletKeypair.publicKey;
    this.positionPdas = {
      long: generateSolPositionPda(this.walletPubkey, 'long'),
      short: generateSolPositionPda(this.walletPubkey, 'short'),
    };
    this.initialized = true;
    log.info('JupiterPerpsEngine initialized', {
      wallet: this.walletPubkey.toBase58(),
      longPositionPda: this.positionPdas.long.toBase58(),
      shortPositionPda: this.positionPdas.short.toBase58(),
    });
  }

  private assertInitialized(): void {
    if (!this.initialized) throw new Error('JupiterPerpsEngine.initialize() must be called first');
  }

  private sideWiring(side: PositionSide): SideWiring {
    return side === 'long'
      ? {
          side,
          sideEnum: { long: {} },
          collateralCustody: CUSTODY.SOL,
          collateralMint: SOL_MINT,
          collateralDecimalsPow: SOL_DECIMALS_POW,
        }
      : {
          side,
          sideEnum: { short: {} },
          collateralCustody: CUSTODY.USDC,
          collateralMint: USDC_MINT,
          collateralDecimalsPow: USDC_DECIMALS_POW,
        };
  }

  /** Fetch one side's position, or null if it doesn't exist / is closed (sizeUsd == 0). */
  private async fetchOpenPosition(side: PositionSide): Promise<any | null> {
    try {
      const pos = await this.program.account.position.fetch(this.positionPdas[side]);
      // Jupiter doesn't close position accounts; a closed position has sizeUsd == 0.
      return pos.sizeUsd.eqn(0) ? null : pos;
    } catch {
      // Account does not exist yet => no position.
      return null;
    }
  }

  /**
   * One consolidated read of everything the controller needs: both position
   * PDAs, both custodies (fee/carry/liq math), oracle price, wallet SOL.
   */
  private async readSides(): Promise<{
    long: (HedgeSideState & { position: any }) | null;
    short: (HedgeSideState & { position: any }) | null;
    solCustody: any;
    usdcCustody: any;
    oraclePriceUsd: number;
    walletSol: number;
  }> {
    const connection = this.program.provider.connection;
    const [longPos, shortPos, solCustody, usdcCustody, priceData, walletLamports] =
      await Promise.all([
        this.fetchOpenPosition('long'),
        this.fetchOpenPosition('short'),
        this.program.account.custody.fetch(CUSTODY.SOL),
        this.program.account.custody.fetch(CUSTODY.USDC),
        getSolPrice().catch(() => null),
        connection.getBalance(this.walletPubkey).catch(() => 0),
      ]);

    // Carry accrues on the side's COLLATERAL custody: SOL for longs, USDC for
    // shorts (this is also where the liq-price port reads the accrued rate).
    const longCarryBps = -(borrowAprPct(solCustody) * 100);
    const shortCarryBps = -(borrowAprPct(usdcCustody) * 100);

    const toSideState = (
      position: any,
      collateralCustody: any,
      carryRateBps: number,
    ): (HedgeSideState & { position: any }) | null => {
      if (!position) return null;
      let liquidationPrice: number | null = null;
      try {
        liquidationPrice = computeLiquidationPrice(position, solCustody, collateralCustody);
      } catch (e) {
        log.warn('Failed to compute liquidation price', {
          error: e instanceof Error ? e.message : String(e),
        });
      }
      return {
        position,
        notionalUsd: position.sizeUsd.toNumber() / USD_PRECISION,
        collateralUsd: position.collateralUsd.toNumber() / USD_PRECISION,
        liquidationPrice,
        carryRateBps,
      };
    };

    return {
      long: toSideState(longPos, solCustody, longCarryBps),
      short: toSideState(shortPos, usdcCustody, shortCarryBps),
      solCustody,
      usdcCustody,
      oraclePriceUsd: priceData?.usd ?? 0,
      walletSol: walletLamports / SOL_DECIMALS_POW,
    };
  }

  async getHedgeState(): Promise<HedgeState> {
    this.assertInitialized();
    const sides = await this.readSides();
    const price = sides.oraclePriceUsd;

    const longSol = sides.long && price > 0 ? sides.long.notionalUsd / price : 0;
    const shortSol = sides.short && price > 0 ? sides.short.notionalUsd / price : 0;

    if (sides.long && sides.short) {
      log.errorBanner('⚠️ BOTH hedge sides open — controller never does this (manual trades?)', {
        longNotionalUsd: sides.long.notionalUsd,
        shortNotionalUsd: sides.short.notionalUsd,
      });
    }

    // The "primary" side for the flat fields: the open one; the larger one if
    // both are open (anomaly); the short when flat (it's the delta-neutral
    // default, so its carry is the prospective cost an operator cares about).
    const primary =
      sides.long && sides.short
        ? sides.long.notionalUsd >= sides.short.notionalUsd
          ? sides.long
          : sides.short
        : (sides.long ?? sides.short);

    const notionalUsd = (sides.long?.notionalUsd ?? 0) + (sides.short?.notionalUsd ?? 0);
    const collateralUsd = (sides.long?.collateralUsd ?? 0) + (sides.short?.collateralUsd ?? 0);
    const shortCarryFallback = -(borrowAprPct(sides.usdcCustody) * 100);

    return {
      venue: this.venue,
      perpBaseSol: longSol - shortSol,
      perpNotionalUsd: notionalUsd,
      totalCollateralUsd: collateralUsd,
      freeCollateralUsd: collateralUsd, // Jupiter has no separate "free" margin per position
      collateralRatio: notionalUsd > 0 ? collateralUsd / notionalUsd : Infinity,
      carryRateBps: primary?.carryRateBps ?? shortCarryFallback,
      liquidationPrice: primary?.liquidationPrice ?? null,
      oraclePriceUsd: price,
      sides: {
        long: sides.long ? stripPosition(sides.long) : null,
        short: sides.short ? stripPosition(sides.short) : null,
      },
    };
  }

  async computeDelta(lpExposure: LpExposure): Promise<DeltaView> {
    const state = await this.getHedgeState();
    return this.deltaViewFrom(lpExposure.solAmount, state.perpBaseSol);
  }

  private deltaViewFrom(lpSolExposure: number, perpBaseSol: number): DeltaView {
    const cfg = getConfig();
    const netDeltaSol = lpSolExposure + perpBaseSol;
    return {
      lpSolExposure,
      shortSol: Math.max(0, -perpBaseSol),
      longSol: Math.max(0, perpBaseSol),
      netDeltaSol,
      targetDeltaSol: cfg.hedgeTargetDeltaSol,
      outOfBand: Math.abs(netDeltaSol - cfg.hedgeTargetDeltaSol) > cfg.deltaThresholdSol,
    };
  }

  // --- Write side (request + keeper-fill flow, ADR-015/017) ---

  /**
   * Compile instructions into a v0 transaction (payer = our wallet). Returns
   * the unsigned tx plus the blockhash window so a live send can confirm
   * against the same blockhash it built with.
   */
  private async buildTx(ixs: any[]): Promise<{ tx: any; blockhash: string; lastValidBlockHeight: number }> {
    const connection = this.program.provider.connection;
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
    const msg = new anchor.web3.TransactionMessage({
      payerKey: this.walletPubkey,
      recentBlockhash: blockhash,
      instructions: ixs,
    }).compileToV0Message();
    return { tx: new anchor.web3.VersionedTransaction(msg), blockhash, lastValidBlockHeight };
  }

  /**
   * Simulate instructions on-chain WITHOUT sending. `replaceRecentBlockhash`
   * + `sigVerify: false` means the tx needs no real signature or funded
   * blockhash — only the on-chain effect (and our wallet's token balances) is
   * checked. A revert here (e.g. insufficient collateral) is exactly the
   * pre-send signal we want.
   */
  private async simulateIxs(ixs: any[]): Promise<SimResult> {
    const connection = this.program.provider.connection;
    const { tx } = await this.buildTx(ixs);
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

  /** Sign + send + confirm instructions. Live path only. */
  private async sendIxs(ixs: any[]): Promise<string> {
    const connection = this.program.provider.connection;
    const { tx, blockhash, lastValidBlockHeight } = await this.buildTx(ixs);
    tx.sign([this.walletKeypair]);
    const signature = await connection.sendTransaction(tx, {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
    });
    await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed');
    return signature;
  }

  /**
   * Open a new SOL position or increase the existing one on `side` (TX1 of the
   * request+keeper flow). Submits a `createIncreasePositionMarketRequest` that
   * escrows the collateral into the request ATA; a Jupiter keeper fills it
   * (TX2) shortly after, at oracle price subject to the slippage bound.
   * DRY-RUN by default; pass `dryRun: false` to send.
   *
   * `sizeUsd`          — notional to ADD, in USD.
   * `collateralTokens` — collateral for this request, in the side's collateral
   *                      token units: USDC for a short, SOL for a long (the SOL
   *                      is wrapped to wSOL inside the same transaction).
   * `slippageBps`      — keeper fill bound. Short = a price FLOOR
   *                      oracle*(1 − bps/1e4) (selling exposure); long = a
   *                      price CEILING oracle*(1 + bps/1e4) (buying).
   */
  async openOrIncrease(params: {
    side: PositionSide;
    sizeUsd: number;
    collateralTokens: number;
    slippageBps?: number;
    dryRun?: boolean;
  }): Promise<MutationResult> {
    this.assertInitialized();
    const dryRun = params.dryRun ?? true;
    const slippageBps = params.slippageBps ?? DEFAULT_PERP_SLIPPAGE_BPS;
    const wiring = this.sideWiring(params.side);
    const action = `open_or_increase_${params.side}`;

    if (!(params.sizeUsd > 0)) throw new Error('openOrIncrease: sizeUsd must be positive');
    if (!(params.collateralTokens > 0)) throw new Error('openOrIncrease: collateralTokens must be positive');
    if (!(slippageBps >= 0 && slippageBps < 10_000)) {
      throw new Error('openOrIncrease: slippageBps must be in [0, 10000)');
    }

    // Oracle price is required: the keeper fill bound is priced off it, and we
    // refuse to send a request we can't bound.
    const priceData = await getSolPrice().catch(() => null);
    const oraclePriceUsd = priceData?.usd ?? 0;
    if (!(oraclePriceUsd > 0)) {
      throw new Error('openOrIncrease: no oracle SOL price available — refusing to build request');
    }
    // Short = selling SOL exposure → FLOOR below oracle. Long = buying → CEILING above.
    const boundPriceUsd =
      params.side === 'short'
        ? oraclePriceUsd * (1 - slippageBps / 10_000)
        : oraclePriceUsd * (1 + slippageBps / 10_000);

    const positionPda = this.positionPdas[params.side];
    const { positionRequest, counter } = generatePositionRequestPda(positionPda, 'increase');
    const fundingAccount = deriveAta(this.walletPubkey, wiring.collateralMint);
    const positionRequestAta = deriveAta(positionRequest, wiring.collateralMint);
    const collateralRaw = Math.round(params.collateralTokens * wiring.collateralDecimalsPow);

    const requestIx = await this.program.methods
      .createIncreasePositionMarketRequest({
        sizeUsdDelta: new BN(Math.round(params.sizeUsd * USD_PRECISION)),
        collateralTokenDelta: new BN(collateralRaw),
        side: wiring.sideEnum,
        priceSlippage: new BN(Math.round(boundPriceUsd * USD_PRECISION)),
        jupiterMinimumOut: null, // collateral is already the custody token → no internal swap
        counter,
      })
      .accounts({
        owner: this.walletPubkey,
        fundingAccount,
        perpetuals: findPerpetualsPda(),
        pool: JLP_POOL_ACCOUNT,
        position: positionPda,
        positionRequest,
        positionRequestAta,
        custody: CUSTODY.SOL,
        collateralCustody: wiring.collateralCustody,
        inputMint: wiring.collateralMint,
        referral: null,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
        eventAuthority: findEventAuthorityPda(),
        program: JUPITER_PERPETUALS_PROGRAM_ID,
      })
      .instruction();

    // Long collateral is native SOL: wrap it into the wSOL funding ATA inside
    // the same TX (create idempotent → transfer lamports → syncNative), and
    // close the funding ATA afterwards — by then the request ix has escrowed
    // the collateral, so closing just unwraps any remainder back to native.
    // The escrow ATA (positionRequestAta) is the keeper's input, not this one.
    const ixs =
      params.side === 'long'
        ? [
            createAtaIdempotentIx(this.walletPubkey, fundingAccount, this.walletPubkey, SOL_MINT),
            anchor.web3.SystemProgram.transfer({
              fromPubkey: this.walletPubkey,
              toPubkey: fundingAccount,
              lamports: collateralRaw,
            }),
            createSyncNativeIx(fundingAccount),
            requestIx,
            createCloseAccountIx(fundingAccount, this.walletPubkey, this.walletPubkey),
          ]
        : [requestIx];

    const boundWord = params.side === 'short' ? 'floor' : 'ceiling';
    const collateralWord = params.side === 'short' ? 'USDC' : 'SOL (wrapped)';
    const detail =
      `${params.side} +$${params.sizeUsd} notional, ${params.collateralTokens} ${collateralWord} collateral, ` +
      `fill ${boundWord} $${boundPriceUsd.toFixed(2)} (oracle $${oraclePriceUsd.toFixed(2)}, ${slippageBps} bps), ` +
      `request ${positionRequest.toBase58()}`;

    if (dryRun) {
      return { action, dryRun: true, simulated: await this.simulateIxs(ixs), detail };
    }
    const signature = await this.sendIxs(ixs);
    return {
      action,
      dryRun: false,
      signatures: [signature],
      detail: `${detail} — request submitted; Jupiter keeper fills (TX2) asynchronously`,
    };
  }

  /**
   * Decrease or fully close the SOL position on `side` (TX1 of the
   * request+keeper flow). Submits a `createDecreasePositionMarketRequest`; a
   * keeper fills it (TX2) and returns proceeds to our wallet — USDC for a
   * short, wSOL for a long (call `unwrapWsol` afterwards; the receiving ATA
   * must survive until TX2, so it cannot be closed in TX1). DRY-RUN by default.
   *
   * `entirePosition: true` → full close (deltas ignored by the program; the
   *   fill bound is "fill at any price": $100k ceiling for shorts, $0.000001
   *   floor for longs).
   * partial (default) → reduce by `sizeUsd` notional and optionally withdraw
   *   `collateralUsd`; the fill bound is a CEILING oracle*(1+slip) for a short
   *   (buying back) and a FLOOR oracle*(1−slip) for a long (selling).
   */
  async decreaseOrClose(params: {
    side: PositionSide;
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
    const wiring = this.sideWiring(params.side);
    const action = `decrease_or_close_${params.side}`;

    if (!(slippageBps >= 0 && slippageBps < 10_000)) {
      throw new Error('decreaseOrClose: slippageBps must be in [0, 10000)');
    }
    if (!entire && !(params.sizeUsd && params.sizeUsd > 0)) {
      throw new Error('decreaseOrClose: a partial decrease needs sizeUsd > 0 (or pass entirePosition)');
    }
    const collateralUsd = params.collateralUsd ?? 0;
    if (!(collateralUsd >= 0)) throw new Error('decreaseOrClose: collateralUsd must be >= 0');

    const position = await this.fetchOpenPosition(params.side);
    const noPosition = !position;

    // Fill bound: full close = guaranteed fill; partial = a real bound off the
    // oracle in the direction that protects us (short buys back → MAX price,
    // long sells → MIN price).
    let priceSlippage =
      params.side === 'short' ? FULL_CLOSE_SHORT_PRICE_CEILING : FULL_CLOSE_LONG_PRICE_FLOOR;
    let boundDetail =
      params.side === 'short'
        ? 'ceiling $100000 (full close — fill at any price)'
        : 'floor $0.000001 (full close — fill at any price)';
    if (!entire) {
      const priceData = await getSolPrice().catch(() => null);
      const oraclePriceUsd = priceData?.usd ?? 0;
      if (!(oraclePriceUsd > 0)) {
        throw new Error('decreaseOrClose: no oracle SOL price available for the partial fill bound');
      }
      const bound =
        params.side === 'short'
          ? oraclePriceUsd * (1 + slippageBps / 10_000)
          : oraclePriceUsd * (1 - slippageBps / 10_000);
      priceSlippage = new BN(Math.round(bound * USD_PRECISION));
      boundDetail = `${params.side === 'short' ? 'ceiling' : 'floor'} $${bound.toFixed(2)} (oracle $${oraclePriceUsd.toFixed(2)}, ${slippageBps} bps)`;
    }

    const positionPda = this.positionPdas[params.side];
    const { positionRequest, counter } = generatePositionRequestPda(positionPda, 'decrease');
    const receivingAccount = deriveAta(this.walletPubkey, wiring.collateralMint);
    const positionRequestAta = deriveAta(positionRequest, wiring.collateralMint);

    const requestIx = await this.program.methods
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
        position: positionPda,
        positionRequest,
        positionRequestAta,
        custody: CUSTODY.SOL,
        collateralCustody: wiring.collateralCustody,
        desiredMint: wiring.collateralMint,
        referral: null,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
        eventAuthority: findEventAuthorityPda(),
        program: JUPITER_PERPETUALS_PROGRAM_ID,
      })
      .instruction();

    // A long's proceeds land in the wSOL receiving ATA during the keeper's
    // TX2, so the ATA must exist AND persist — create it idempotently here,
    // never close it in this transaction. `unwrapWsol` reclaims it later.
    const ixs =
      params.side === 'long'
        ? [
            createAtaIdempotentIx(this.walletPubkey, receivingAccount, this.walletPubkey, SOL_MINT),
            requestIx,
          ]
        : [requestIx];

    const what = entire
      ? 'full close'
      : `decrease −$${params.sizeUsd} notional, withdraw $${collateralUsd} collateral`;
    const base = `${params.side} ${what}, ${boundDetail}, request ${positionRequest.toBase58()}`;
    const detail = noPosition ? `no open ${params.side} position — request would revert; ${base}` : base;

    if (dryRun) {
      return { action, dryRun: true, simulated: await this.simulateIxs(ixs), detail };
    }
    if (noPosition) {
      return {
        action,
        dryRun: false,
        detail: `no open ${params.side} position — nothing to close/decrease (not sent)`,
      };
    }
    const signature = await this.sendIxs(ixs);
    return {
      action,
      dryRun: false,
      signatures: [signature],
      detail: `${base} — request submitted; Jupiter keeper fills (TX2) asynchronously`,
    };
  }

  /**
   * Unwrap any wSOL sitting in our ATA back to native SOL. A long decrease
   * pays proceeds as wSOL (the receiving ATA must outlive the keeper fill, so
   * it can't be closed in TX1); the orchestrator calls this on later cycles —
   * after the keeper-fill cooldown — to fold the SOL back into the wallet.
   * No-op when the ATA doesn't exist or is empty.
   */
  async unwrapWsol(opts: { dryRun?: boolean } = {}): Promise<MutationResult> {
    this.assertInitialized();
    const dryRun = opts.dryRun ?? true;
    const connection = this.program.provider.connection;
    const wsolAta = deriveAta(this.walletPubkey, SOL_MINT);

    const balance = await connection
      .getTokenAccountBalance(wsolAta, 'confirmed')
      .then((r: any) => Number(r?.value?.amount ?? 0))
      .catch(() => null);
    if (balance === null) {
      return { action: 'unwrap_wsol', dryRun, detail: 'no wSOL ATA — nothing to unwrap (not sent)' };
    }

    const ix = createCloseAccountIx(wsolAta, this.walletPubkey, this.walletPubkey);
    const detail = `close wSOL ATA ${wsolAta.toBase58()} (${balance / SOL_DECIMALS_POW} wSOL + rent → native SOL)`;
    if (dryRun) {
      return { action: 'unwrap_wsol', dryRun: true, simulated: await this.simulateIxs([ix]), detail };
    }
    const signature = await this.sendIxs([ix]);
    return { action: 'unwrap_wsol', dryRun: false, signatures: [signature], detail };
  }

  /**
   * THE CONTROLLER. Given current LP SOL exposure, steer the hedge so
   * net ΔSOL ≈ HEDGE_TARGET_DELTA_SOL — but only when out of band
   * (|netΔ − target| > DELTA_THRESHOLD_SOL, ADR-002), one mutation per call.
   * Decision logic is the pure `decideHedgeAction` (see hedgeController.ts for
   * the decision table and guard set). DRY-RUN by default.
   *
   * `opts.lastActionAtMs` — timestamp of the previous LIVE mutation; within
   * HEDGE_COOLDOWN_MS the controller returns 'none' so an async keeper fill
   * (TX2) can land before we act on stale position state.
   */
  async rebalanceHedge(
    lpExposure: LpExposure,
    opts: {
      dryRun?: boolean;
      slippageBps?: number;
      lastActionAtMs?: number | null;
      targetDeltaSol?: number;
    } = {},
  ): Promise<HedgeRebalanceResult> {
    this.assertInitialized();
    const dryRun = opts.dryRun ?? true;
    const cfg = getConfig();
    const targetDeltaSol = opts.targetDeltaSol ?? cfg.hedgeTargetDeltaSol;

    const sides = await this.readSides();
    const price = sides.oraclePriceUsd;
    const longSol = sides.long && price > 0 ? sides.long.notionalUsd / price : 0;
    const shortSol = sides.short && price > 0 ? sides.short.notionalUsd / price : 0;

    const lpSolExposure = lpExposure.solAmount;
    const netDeltaSol = lpSolExposure + longSol - shortSol;
    const deltaBefore: DeltaView = {
      lpSolExposure,
      shortSol,
      longSol,
      netDeltaSol,
      targetDeltaSol,
      outOfBand: Math.abs(netDeltaSol - targetDeltaSol) > cfg.deltaThresholdSol,
    };

    const decision = decideHedgeAction({
      lpSol: lpSolExposure,
      longSol,
      shortSol,
      longNotionalUsd: sides.long?.notionalUsd ?? 0,
      shortNotionalUsd: sides.short?.notionalUsd ?? 0,
      longCollateralUsd: sides.long?.collateralUsd ?? 0,
      shortCollateralUsd: sides.short?.collateralUsd ?? 0,
      carryCostBps: {
        long: Math.max(0, -(sides.long?.carryRateBps ?? -(borrowAprPct(sides.solCustody) * 100))),
        short: Math.max(0, -(sides.short?.carryRateBps ?? -(borrowAprPct(sides.usdcCustody) * 100))),
      },
      oraclePriceUsd: price,
      walletSol: sides.walletSol,
      walletReserveSol: cfg.minimumWalletBalanceSol + cfg.rentReserveSol,
      targetDeltaSol,
      bandSol: cfg.deltaThresholdSol,
      carryCapBps: cfg.hedgeCarryCapBps,
      maxHedgeNotionalUsd: cfg.maxHedgeNotionalUsd,
      minCollateralRatio: cfg.minCollateralRatio,
      targetCollateralRatio: cfg.hedgeTargetCollateralRatio,
      nowMs: Date.now(),
      lastActionAtMs: opts.lastActionAtMs ?? null,
      cooldownMs: cfg.hedgeCooldownMs,
    });

    if (decision.action === 'none') {
      return { action: 'none', adjustedSol: 0, signatures: [], deltaBefore, blockedReason: decision.reason };
    }
    if (decision.action === 'blocked') {
      return { action: 'blocked', adjustedSol: 0, blockedReason: decision.reason, signatures: [], deltaBefore };
    }

    let mutation: MutationResult;
    if ('collateralTokens' in decision) {
      mutation = await this.openOrIncrease({
        side: decision.action === 'increase_long' ? 'long' : 'short',
        sizeUsd: decision.sizeUsd,
        collateralTokens: decision.collateralTokens,
        slippageBps: opts.slippageBps,
        dryRun,
      });
    } else {
      mutation = await this.decreaseOrClose({
        side: decision.action === 'decrease_long' ? 'long' : 'short',
        entirePosition: decision.entirePosition,
        sizeUsd: decision.entirePosition ? undefined : decision.sizeUsd,
        collateralUsd: decision.entirePosition ? undefined : decision.withdrawCollateralUsd,
        slippageBps: opts.slippageBps,
        dryRun,
      });
    }

    return {
      action: decision.action,
      adjustedSol: decision.adjustSol,
      signatures: mutation.signatures ?? [],
      deltaBefore,
      mutation,
    };
  }

  /**
   * EMERGENCY UNWIND — fully close EVERY open side at any price (guaranteed
   * fill: $100k ceiling for the short, $0.000001 floor for the long). We accept
   * worst-case slippage in exchange for getting flat. No-op when nothing is
   * open. DRY-RUN by default; pass `dryRun: false` to actually submit.
   */
  async emergencyUnwind(opts: { dryRun?: boolean } = {}): Promise<MutationResult> {
    this.assertInitialized();
    const dryRun = opts.dryRun ?? true;
    log.errorBanner('🚨 EMERGENCY UNWIND — full close of ALL hedge positions (fill at any price)', {
      dryRun,
    });
    const results: MutationResult[] = [];
    for (const side of ['short', 'long'] as PositionSide[]) {
      results.push(await this.decreaseOrClose({ side, entirePosition: true, dryRun }));
    }
    const signatures = results.flatMap((r) => r.signatures ?? []);
    const simulated = results.find((r) => r.simulated && !r.simulated.success)?.simulated ??
      results.find((r) => r.simulated)?.simulated;
    return {
      action: 'emergency_unwind',
      dryRun,
      signatures: signatures.length ? signatures : undefined,
      simulated,
      detail: results.map((r) => `${r.action}: ${r.detail}`).join(' | '),
    };
  }

  async shutdown(): Promise<void> {
    // Direct-fetch engine: no subscriptions to tear down.
    this.initialized = false;
  }
}

/** Drop the raw decoded position from a side state (internal only). */
function stripPosition(s: HedgeSideState & { position: any }): HedgeSideState {
  const { position: _position, ...rest } = s;
  return rest;
}
