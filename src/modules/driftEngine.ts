/**
 * Drift Hedge Engine — INTERFACE SKELETON (design artifact, not yet wired)
 *
 * See decisions.md ADR-014. This file defines the contract for the perpetuals
 * hedge that makes the bot actually delta-neutral. Method bodies are
 * intentionally unimplemented (`throw notImplemented(...)`) so the shape can be
 * reviewed before any fund-handling code or the `@drift-labs/sdk` dependency
 * lands.
 *
 * Strategy (mirrors the existing adapter pattern; sits beside MeteoraAdapter):
 *  - Maintain a SOL-PERP SHORT sized to the LP's SOL exposure so net ΔSOL ≈ 0.
 *  - Band rebalancing (ADR-002): only adjust when |ΔSOL| > DELTA_THRESHOLD_SOL.
 *  - Risk guards before/after every adjustment: MIN_COLLATERAL_RATIO,
 *    MAX_SHORT_NOTIONAL_USD, FUNDING_RATE_CAP_BPS.
 *  - Emergency unwind path closes the short and (optionally) withdraws collateral.
 *
 * Key design decisions (ADR-014):
 *  - Build on the official `@drift-labs/sdk` (pin the `stable` dist-tag, e.g.
 *    2.156.0) — NOT the SendAI Agent Kit, NOT the `latest`/beta line.
 *  - Configure DriftClient for POLLING account subscription (not websocket) to
 *    keep RPC load friendly on the free-tier GCP box.
 *  - Single hedge sub-account; SOL-PERP market index from DRIFT_MARKET_SOL_PERP.
 *  - Default to market orders for fill reliability on rebalances (limit is a
 *    possible later optimisation for funding capture).
 *
 * @example
 * ```typescript
 * const drift = new DriftEngine();
 * await drift.initialize();
 * const lp = await meteoraAdapter.getLpExposure();   // { solAmount, usdcAmount }
 * await drift.rebalanceHedge(lp);                     // short ≈ lp.solAmount
 * // ...on shutdown / panic:
 * await drift.emergencyUnwind();
 * await drift.shutdown();
 * ```
 */

import type { LpExposure } from '../types/index.js';
import { getConfig } from '../config/env.js';
import { getConnection, getWalletKeypair } from '../utils/solana.js';
import { log } from '../utils/logger.js';
import {
  DriftClient,
  User,
  Wallet,
  BulkAccountLoader,
  convertToNumber,
  BASE_PRECISION,
  PRICE_PRECISION,
  QUOTE_PRECISION,
  calculateFormattedLiveFundingRate,
  getUserAccountPublicKeySync,
} from '../utils/drift.js';

/**
 * Account-loader poll interval (ms). At 1s, hedge reads stay fresh enough for
 * band rebalancing while keeping a free-tier RPC happy — the whole reason
 * ADR-014 chose polling over Drift's default websocket subscriptions.
 */
const DRIFT_POLLING_FREQUENCY_MS = 1000;

/** Drift spot-market index for USDC (the quote market) — the hedge's collateral. */
const USDC_SPOT_MARKET_INDEX = 0;

/** On-chain name tag for the hedge sub-account (cosmetic, ≤32 bytes). */
const HEDGE_SUBACCOUNT_NAME = 'Hedge';

/** Risk/sizing config for the hedge. To be wired into BotConfig + .env (ADR-014). */
export interface DriftConfig {
  /** Drift market index for SOL-PERP (typically 0). Env: DRIFT_MARKET_SOL_PERP */
  solPerpMarketIndex: number;
  /** Max net ΔSOL tolerated before a rebalance fires. Env: DELTA_THRESHOLD_SOL */
  deltaThresholdSol: number;
  /** Minimum collateral ratio (free collateral / notional). Env: MIN_COLLATERAL_RATIO */
  minCollateralRatio: number;
  /** Hard ceiling on short notional in USD. Env: MAX_SHORT_NOTIONAL_USD */
  maxShortNotionalUsd: number;
  /** Funding-rate cap (bps, annualised) above which we refuse to add/keep short. Env: FUNDING_RATE_CAP_BPS */
  fundingRateCapBps: number;
  /** Drift sub-account id used for the hedge (default 0). */
  subAccountId: number;
}

/** A point-in-time read of the hedge — the controller's primary input. */
export interface HedgeState {
  /** Current SOL-PERP base position. Negative = short. Human units (SOL). */
  perpBaseSol: number;
  /** Notional of the perp position in USD (abs). */
  perpNotionalUsd: number;
  /** Total/free collateral on the Drift sub-account, USD. */
  totalCollateralUsd: number;
  freeCollateralUsd: number;
  /** Collateral ratio = freeCollateral / max(perpNotional, ε). */
  collateralRatio: number;
  /** Current funding rate for SOL-PERP, bps (sign: positive = shorts earn). */
  fundingRateBps: number;
  /** Estimated liquidation price for the short, USD. Null if no position. */
  liquidationPrice: number | null;
  /** Drift oracle mark price for SOL, USD. */
  oraclePriceUsd: number;
}

/** Net-delta view combining LP exposure with the current short. */
export interface DeltaView {
  /** SOL held long via the LP position. */
  lpSolExposure: number;
  /** SOL shorted on Drift (positive magnitude). */
  shortSol: number;
  /** Net ΔSOL = lpSolExposure − shortSol. Target ≈ 0. */
  netDeltaSol: number;
  /** True when |netDeltaSol| exceeds deltaThresholdSol (rebalance warranted). */
  outOfBand: boolean;
}

export type HedgeAction = 'none' | 'increase_short' | 'decrease_short' | 'blocked';

/** Result of a rebalance attempt. */
export interface HedgeRebalanceResult {
  action: HedgeAction;
  /** SOL size adjusted (signed: negative = added short). 0 if no-op/blocked. */
  adjustedSol: number;
  /** Reason when action === 'blocked' (e.g. funding cap, notional ceiling, low collateral). */
  blockedReason?: string;
  txSignatures: string[];
  deltaBefore: DeltaView;
  deltaAfter?: DeltaView;
}

/** Outcome of an on-chain simulation (dry-run): did the tx revert, and why. */
export interface SimResult {
  success: boolean;
  unitsConsumed?: number;
  logs?: string[];
  err?: unknown;
}

/** Result of a hedge mutation (create sub-account, deposit, withdraw). */
export interface MutationResult {
  action: 'init' | 'deposit' | 'withdraw';
  /** True = simulated only, nothing sent. False = a real transaction was sent. */
  dryRun: boolean;
  /** Present in dry-run: the simulation outcome. */
  simulated?: SimResult;
  /** Present on a live send: the transaction signature. */
  signature?: string;
  /** Human note (e.g. "sub-account already exists"). */
  detail?: string;
}

function notImplemented(method: string): never {
  throw new Error(`DriftEngine.${method}() not implemented — design skeleton only (ADR-014)`);
}

/**
 * Map the flat `BotConfig` (env-loaded, validated in `env.ts`) onto the
 * hedge-shaped `DriftConfig` the engine consumes. Lives here, not in `env.ts`,
 * so the config layer stays unaware of the engine (no import cycle) — the same
 * way `AutoTuneOrchestrator` builds its `AutoTuneConfig` from `getConfig()`.
 */
export function getDriftConfig(): DriftConfig {
  const cfg = getConfig();
  return {
    solPerpMarketIndex: cfg.driftMarketSolPerp,
    deltaThresholdSol: cfg.deltaThresholdSol,
    minCollateralRatio: cfg.minCollateralRatio,
    maxShortNotionalUsd: cfg.maxShortNotionalUsd,
    fundingRateCapBps: cfg.fundingRateCapBps,
    subAccountId: cfg.driftSubAccountId,
  };
}

export class DriftEngine {
  private driftClient!: InstanceType<typeof DriftClient>;
  private user!: InstanceType<typeof User>;
  /** Project-web3 Connection (cast — see dual-web3 note in connectClient). */
  private connection: any;
  private wallet!: InstanceType<typeof Wallet>;
  /** DriftClient built + subscribed — mutations can run (no user required). */
  private clientConnected = false;
  /** User account attached + read-ready — requires the sub-account to exist. */
  private initialized = false;
  /** Risk/sizing config, resolved from env at construction (ADR-014, Step 2). */
  protected readonly config: DriftConfig = getDriftConfig();

  private assertInitialized(): void {
    if (!this.initialized) {
      throw new Error('DriftEngine.initialize() must be called before reads/trades');
    }
  }

  /**
   * Build + subscribe the DriftClient in polling mode. Does NOT require the
   * hedge sub-account to exist, so setup mutations (create account, first
   * deposit) can run before there's anything to read. Idempotent.
   */
  private async connectClient(): Promise<void> {
    if (this.clientConnected) return;

    // The tree carries two structurally-identical copies of @solana/web3.js
    // (the project's, and one nested under @drift-labs/sdk — the multi-lockfile
    // artifact noted in ADR-014). They're interchangeable at runtime but TS
    // treats them as distinct types, so we cast at this single SDK boundary.
    this.connection = getConnection() as any;
    this.wallet = new Wallet(getWalletKeypair() as any);

    // Polling subscription: one BulkAccountLoader batches all account reads
    // into periodic getMultipleAccounts calls instead of opening websockets.
    const accountLoader = new BulkAccountLoader(this.connection, 'confirmed', DRIFT_POLLING_FREQUENCY_MS);

    this.driftClient = new DriftClient({
      connection: this.connection,
      wallet: this.wallet,
      env: 'mainnet-beta',
      accountSubscription: { type: 'polling', accountLoader },
      activeSubAccountId: this.config.subAccountId,
      // Deliberately NOT passing `subAccountIds`: with it set, subscribe()
      // eagerly preloads that user and the SDK emits a noisy null-deref log
      // when the sub-account doesn't exist yet. We attach the user ourselves
      // (in initialize()) only after confirming it exists on-chain.
      perpMarketIndexes: [this.config.solPerpMarketIndex],
      spotMarketIndexes: [USDC_SPOT_MARKET_INDEX],
    });

    const subscribed = await this.driftClient.subscribe();
    if (!subscribed) {
      throw new Error('DriftEngine: DriftClient failed to subscribe (RPC/account-load error)');
    }
    this.clientConnected = true;
  }

  /** Derive the hedge sub-account PDA (pure — no user load required). */
  private hedgeUserPda() {
    return getUserAccountPublicKeySync(
      this.driftClient.program.programId,
      this.wallet.publicKey,
      this.config.subAccountId
    );
  }

  /** True when the hedge sub-account exists on-chain. */
  private async subAccountExists(): Promise<boolean> {
    const info = await this.connection.getAccountInfo(this.hedgeUserPda());
    return info !== null;
  }

  /**
   * Simulate instructions WITHOUT sending. `buildTransaction` assembles with
   * Drift's own web3 (sidestepping the dual-web3 mismatch); simulation skips
   * sig-verify and replaces the blockhash, so nothing needs signing or funding
   * the fee — only the on-chain effect is checked.
   */
  private async simulate(ixs: any[]): Promise<SimResult> {
    const tx = await this.driftClient.buildTransaction(ixs, undefined, 0);
    const res = await this.connection.simulateTransaction(tx, {
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

  /**
   * Construct/subscribe the DriftClient (polling mode), ensure the hedge
   * sub-account exists, and subscribe the `User` account for cheap reads.
   * Idempotent — safe to call once at startup.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    await this.connectClient();

    // Existence check WITHOUT tripping the SDK's eager-load (see connectClient).
    const userPk = this.hedgeUserPda();
    if (!(await this.subAccountExists())) {
      await this.shutdown().catch(() => {});
      throw new Error(
        `DriftEngine: Drift sub-account ${this.config.subAccountId} does not exist on-chain ` +
          `for wallet ${this.wallet.publicKey.toBase58()}. Create it + deposit USDC collateral ` +
          `first (the first hedge mutation, Step 5).`
      );
    }

    await this.driftClient.addUser(this.config.subAccountId);
    this.user = this.driftClient.getUser(this.config.subAccountId);
    this.initialized = true;
    log.info('DriftEngine initialized (read-side, polling mode)', {
      subAccountId: this.config.subAccountId,
      userAccount: userPk.toBase58(),
      solPerpMarketIndex: this.config.solPerpMarketIndex,
      pollMs: DRIFT_POLLING_FREQUENCY_MS,
    });
  }

  /** Read the current hedge state (position, collateral, funding, liq price, oracle). */
  async getHedgeState(): Promise<HedgeState> {
    this.assertInitialized();
    const idx = this.config.solPerpMarketIndex;

    // Oracle mark price (PRICE_PRECISION = 1e6).
    const oracleData = this.driftClient.getOracleDataForPerpMarket(idx);
    const oraclePriceUsd = convertToNumber(oracleData.price, PRICE_PRECISION);

    // Perp position. baseAssetAmount is BASE_PRECISION (1e9); negative = short.
    const pos = this.user.getPerpPosition(idx);
    const perpBaseSol = pos ? convertToNumber(pos.baseAssetAmount, BASE_PRECISION) : 0;
    const perpNotionalUsd = pos
      ? Math.abs(convertToNumber(this.user.getPerpPositionValue(idx, oracleData), QUOTE_PRECISION))
      : 0;

    // Collateral (QUOTE_PRECISION = 1e6 USD). collateralRatio is ∞ with no
    // position open — there is nothing to be under-collateralised against.
    const totalCollateralUsd = convertToNumber(this.user.getTotalCollateral(), QUOTE_PRECISION);
    const freeCollateralUsd = convertToNumber(this.user.getFreeCollateral(), QUOTE_PRECISION);
    const collateralRatio = perpNotionalUsd > 0 ? freeCollateralUsd / perpNotionalUsd : Infinity;

    // Funding rate, annualised, short side, in bps.
    // NOTE: the sign convention (positive = shorts earn) must be confirmed on
    // the read-only mainnet smoke test against Drift's UI before any guard
    // (FUNDING_RATE_CAP_BPS) is allowed to act on it. Read-only for now.
    let fundingRateBps = 0;
    const market = this.driftClient.getPerpMarketAccount(idx);
    if (market) {
      const mmOracleData = this.driftClient.getMMOracleDataForPerpMarket(idx);
      const funding = calculateFormattedLiveFundingRate(market, mmOracleData, oracleData, 'year');
      fundingRateBps = funding.shortRate * 100; // percent → bps
    }

    // Liquidation price (PRICE_PRECISION). Drift returns ≤0 when N/A.
    const liqRaw = convertToNumber(this.user.liquidationPrice(idx), PRICE_PRECISION);
    const liquidationPrice = perpBaseSol !== 0 && liqRaw > 0 ? liqRaw : null;

    return {
      perpBaseSol,
      perpNotionalUsd,
      totalCollateralUsd,
      freeCollateralUsd,
      collateralRatio,
      fundingRateBps,
      liquidationPrice,
      oraclePriceUsd,
    };
  }

  /**
   * Pure-ish delta computation: combine LP SOL exposure with the current short
   * to produce the net ΔSOL and whether it's outside the rebalance band.
   * (Reads the short from getHedgeState; LP exposure is passed in.)
   */
  async computeDelta(lpExposure: LpExposure): Promise<DeltaView> {
    const state = await this.getHedgeState();
    const lpSolExposure = lpExposure.solAmount;

    // Net exposure is signed addition: LP is long (+), the short is negative
    // (perpBaseSol < 0), so a perfect hedge sums to ~0. shortSol is the display
    // magnitude of the short (0 if, unexpectedly, the perp is long).
    const netDeltaSol = lpSolExposure + state.perpBaseSol;
    const shortSol = Math.max(0, -state.perpBaseSol);

    return {
      lpSolExposure,
      shortSol,
      netDeltaSol,
      outOfBand: Math.abs(netDeltaSol) > this.config.deltaThresholdSol,
    };
  }

  /**
   * THE CONTROLLER. Given current LP exposure, bring the SOL-PERP short toward
   * `lpExposure.solAmount` so net ΔSOL ≈ 0 — but only if out of band (ADR-002),
   * and only if all risk guards pass:
   *   - projected short notional ≤ maxShortNotionalUsd
   *   - resulting collateralRatio ≥ minCollateralRatio
   *   - |fundingRateBps| within fundingRateCapBps (don't pay to stay short)
   * Returns 'blocked' with a reason rather than forcing an unsafe trade.
   */
  async rebalanceHedge(lpExposure: LpExposure): Promise<HedgeRebalanceResult> {
    void lpExposure;
    notImplemented('rebalanceHedge');
  }

  /**
   * Create the hedge sub-account if it doesn't exist. Dry-run simulates the
   * initialize transaction; live actually creates it (costs ~SOL rent, which is
   * reclaimable). No-op with a `detail` note when the account already exists.
   */
  async ensureSubAccount(opts: { dryRun?: boolean } = {}): Promise<MutationResult> {
    const dryRun = opts.dryRun ?? true;
    await this.connectClient();

    if (await this.subAccountExists()) {
      return { action: 'init', dryRun, detail: 'sub-account already exists on-chain' };
    }

    const [ixs] = await this.driftClient.getInitializeUserAccountIxs(
      this.config.subAccountId,
      HEDGE_SUBACCOUNT_NAME
    );

    if (dryRun) {
      return { action: 'init', dryRun: true, simulated: await this.simulate(ixs) };
    }

    const [signature] = await this.driftClient.initializeUserAccount(
      this.config.subAccountId,
      HEDGE_SUBACCOUNT_NAME
    );
    return { action: 'init', dryRun: false, signature };
  }

  /**
   * Deposit USDC collateral into the hedge sub-account. Requires the
   * sub-account to exist first (run `ensureSubAccount` / `hedge --init`) — keeps
   * each mutation independently validatable. Dry-run builds + simulates and
   * sends nothing; live sends the deposit.
   */
  async depositCollateral(usdcAmount: number, opts: { dryRun?: boolean } = {}): Promise<MutationResult> {
    const dryRun = opts.dryRun ?? true;
    if (!(usdcAmount > 0)) {
      throw new Error('depositCollateral: usdcAmount must be a positive number');
    }
    await this.connectClient();

    if (!(await this.subAccountExists())) {
      throw new Error(
        'depositCollateral: hedge sub-account does not exist yet — run `pnpm hedge --init` first'
      );
    }

    const marketIndex = USDC_SPOT_MARKET_INDEX;
    const ata = await this.driftClient.getAssociatedTokenAccount(marketIndex);
    const amountBN = this.driftClient.convertToSpotPrecision(marketIndex, usdcAmount);
    const depositIxs = await this.driftClient.getDepositTxnIx(
      amountBN,
      marketIndex,
      ata,
      this.config.subAccountId
    );

    if (dryRun) {
      return { action: 'deposit', dryRun: true, simulated: await this.simulate(depositIxs) };
    }

    const signature = await this.driftClient.deposit(amountBN, marketIndex, ata, this.config.subAccountId);
    return { action: 'deposit', dryRun: false, signature };
  }

  /** Withdraw USDC collateral from the hedge sub-account (respects margin). */
  async withdrawCollateral(usdcAmount: number): Promise<string> {
    void usdcAmount;
    notImplemented('withdrawCollateral');
  }

  /**
   * Emergency: market-close the entire short immediately, ignoring the band.
   * Used by the orchestrator's panic path and on graceful shutdown.
   */
  async emergencyUnwind(): Promise<HedgeRebalanceResult> {
    notImplemented('emergencyUnwind');
  }

  /** Unsubscribe and tear down the DriftClient connection. */
  async shutdown(): Promise<void> {
    if (!this.clientConnected) return;
    // Best-effort teardown — failing to unsubscribe shouldn't mask a shutdown.
    await this.driftClient.unsubscribe().catch(() => {});
    this.clientConnected = false;
    this.initialized = false;
    log.info('DriftEngine shut down');
  }
}
