/**
 * Turns decoded pump.fun / PumpSwap events of ONE transaction into store rows.
 * Shared by the live collector (websocket logs), the truncated-log tx fetcher and the
 * Helius backfill / gap filler, so every path produces identical (sig, idx) keys.
 *
 * Trade rows go to `sink.trades` (the live collector routes them through the block indexer
 * to attach tx_index); every NON-trade event (creates, completes, migrations, CreatePool,
 * InitBoost, BoostBuyAndBurn, fee/param changes, ...) goes to `sink.events` as JSON.
 */
import type { DecodedEvent } from './decode.ts';
import { WSOL_MINT } from './decode.ts';
import type { EventRow, Store, TradeRow } from './store.ts';

const SYSTEM_PROGRAM = '11111111111111111111111111111111';
const isSol = (m: string | null | undefined) => !m || m === SYSTEM_PROGRAM || m === WSOL_MINT;
const big = (v: unknown): bigint => (typeof v === 'bigint' ? v : BigInt((v as number) ?? 0));
const bigOrNull = (v: unknown): bigint | null => (v === undefined || v === null ? null : big(v));
const num = (v: unknown): number => Number(v ?? 0);
const json = (o: unknown) => JSON.stringify(o, (_, v) => (typeof v === 'bigint' ? v.toString() : v));

export interface PoolInfo { base: string; quote: string }
export type PoolResolver = (pools: string[]) => Promise<Map<string, PoolInfo | null>>;
export interface Sink { trades(rows: TradeRow[]): void; events(rows: EventRow[]): void }

interface PendingAmm { sig: string; idx: number; slot: number; txIndex: number | null; e: DecodedEvent; source: 0 | 1 | 2 }

/** Account-housekeeping events that carry no market information; dropped unless keepHousekeeping. */
export const HOUSEKEEPING_EVENTS = new Set(['InitUserVolumeAccumulatorEvent', 'CloseUserVolumeAccumulatorEvent', 'SyncUserVolumeAccumulatorEvent',
  'ExtendAccountEvent', 'DistributeFeeToHoldersEvent', 'ClaimCashbackEvent']);

export class Processor {
  pools: Map<string, PoolInfo>;
  private pendingPool = new Map<string, { items: PendingAmm[]; attempts: number; firstAt: number }>();
  counts: Record<string, number> = {};
  sink: Sink;
  onCreate: ((mint: string, uri: string) => void) | null = null;
  /** PumpSwap scope: when set, PumpSwap trades/events of pools for which it returns false are dropped at ingest. */
  ammFilter: ((pool: string, slot: number) => boolean) | null = null;
  /** Called for every CompletePumpAmmMigrationEvent BEFORE the tx's other events are processed. */
  onMigration: ((m: { mint: string; pool: string; quoteMint: string | null; slot: number; ts: number; sig: string }) => void) | null = null;
  /** Called for every stored pump.fun curve trade (curve-progress watcher). */
  onPumpTrade: ((t: TradeRow) => void) | null = null;
  keepHousekeeping = false;
  /** Drop ALL PumpSwap trade rows (events still pass ammFilter) — pump-program backfills see only the PumpSwap trades
   *  that happen to share a tx with a pump instruction, which is not a coherent PumpSwap dataset. */
  dropAmmTrades = false;

  constructor(private store: Store, private resolver: PoolResolver, sink?: Sink) {
    this.pools = store.loadPools();
    this.sink = sink ?? { trades: r => store.addTrades(r), events: r => store.addEvents(r) };
  }

  private bump(k: string, by = 1) { this.counts[k] = (this.counts[k] ?? 0) + by; }
  takeCounts() { const c = this.counts; this.counts = {}; return c; }
  pendingPoolTrades() { let n = 0; for (const v of this.pendingPool.values()) n += v.items.length; return n; }

  handleTx(sig: string, slot: number, events: DecodedEvent[], source: 0 | 1 | 2, txIndex: number | null = null) {
    // migrations first, so that the pool created in this very tx is already "in scope" for its CreatePool/InitBoost events
    if (this.onMigration) for (const e of events) if (e.program === 'pump' && e.name === 'CompletePumpAmmMigrationEvent') {
      const d = e.data;
      try { this.onMigration({ mint: d.mint, pool: d.pool, quoteMint: isSol(d.quote_mint) ? null : d.quote_mint, slot, ts: num(d.timestamp), sig }); } catch { /* never block ingest */ }
    }
    const inScope = (pool: unknown) => !this.ammFilter || (typeof pool === 'string' && this.ammFilter(pool, slot));
    let idx = 0;
    const trades: TradeRow[] = [];
    const evRows: EventRow[] = [];
    const creates: { mint: string; creator: string; user: string }[] = [];
    const src = source === 0 ? 'logs' : source === 1 ? 'txfetch' : 'backfill';
    events.forEach((e, eidx) => {
      const d = e.data;
      if (e.program === 'pump' && e.name === 'TradeEvent') {
        this.bump('pump.trade');
        const row = this.normPump(e, sig, idx++, slot, txIndex, source);
        trades.push(row);
        if (this.onPumpTrade) { try { this.onPumpTrade(row); } catch { /* ignore */ } }
        return;
      }
      if (e.program === 'amm' && (e.name === 'BuyEvent' || e.name === 'SellEvent')) {
        const i = idx++;                      // idx counts ALL trade events of the tx (dedupe identity), kept or not
        if (this.dropAmmTrades || !inScope(d.pool)) { this.bump('amm.tradeOutOfScope'); return; }
        this.bump('amm.trade');
        const info = this.pools.get(d.pool);
        if (info) trades.push(this.normAmm(e, sig, i, slot, txIndex, source, info));
        else {
          const p = this.pendingPool.get(d.pool) ?? { items: [], attempts: 0, firstAt: Date.now() };
          p.items.push({ sig, idx: i, slot, txIndex, e, source });
          this.pendingPool.set(d.pool, p);
        }
        return;
      }
      // every other event is kept verbatim (minus pure account housekeeping and out-of-scope PumpSwap pools)
      if (!this.keepHousekeeping && HOUSEKEEPING_EVENTS.has(e.name)) { this.bump('housekeepingDropped'); return; }
      if (e.program === 'amm' && !inScope(d.pool)) { this.bump('amm.eventOutOfScope'); return; }
      this.bump(`${e.program}.${e.name}`);
      evRows.push({ sig, eidx, slot, txIndex, ts: d.timestamp !== undefined ? num(d.timestamp) : null, program: e.program, name: e.name,
        mint: (d.mint ?? d.base_mint ?? null) as string | null, pool: (d.pool ?? null) as string | null, data: json(d), source });
      if (e.program === 'pump' && e.name === 'CreateEvent') {
        this.store.queueToken({
          mint: d.mint, creator: d.creator ?? d.user, createdTs: num(d.timestamp), createdSlot: slot, createSig: sig,
          name: d.name, symbol: d.symbol, uri: d.uri, quoteMint: isSol(d.quote_mint) ? null : d.quote_mint,
          bondingCurve: d.bonding_curve, tokenProgram: d.token_program ?? null, isMayhem: d.is_mayhem_mode ?? null,
          isCashback: d.is_cashback_enabled ?? null, isHolderReward: d.is_holder_reward ?? null, creatorFeeBps: bigOrNull(d.creator_fee_bps), launchpad: 'pump',
        }, src);
        creates.push({ mint: d.mint, creator: d.creator ?? d.user, user: d.user });
        if (this.onCreate && d.uri) this.onCreate(d.mint, d.uri);
      } else if (e.program === 'pump' && e.name === 'CompleteEvent') {
        this.store.queueMigration({ mint: d.mint, kind: 'complete', sig, slot, ts: num(d.timestamp), quoteMint: isSol(d.quote_mint) ? null : d.quote_mint }, src);
      } else if (e.program === 'pump' && e.name === 'CompletePumpAmmMigrationEvent') {
        this.store.queueMigration({ mint: d.mint, kind: 'migrate', sig, slot, ts: num(d.timestamp), pool: d.pool, quoteMint: isSol(d.quote_mint) ? null : d.quote_mint,
          solAmount: d.sol_amount, mintAmount: d.mint_amount, migrationFee: d.pool_migration_fee }, src);
      } else if (e.program === 'amm' && e.name === 'CreatePoolEvent') {
        this.pools.set(d.pool, { base: d.base_mint, quote: d.quote_mint });
        this.store.queuePool({ pool: d.pool, baseMint: d.base_mint, quoteMint: d.quote_mint, creator: d.creator, coinCreator: d.coin_creator ?? null,
          createdTs: num(d.timestamp), createdSlot: slot, createSig: sig, source: 'event' });
        this.flushPendingFor(d.pool);
      }
    });
    // Creator's initial ("dev") buy = buys of the new mint inside the create transaction by the creator.
    for (const c of creates) {
      let sol = 0n, tok = 0n;
      for (const t of trades) if (t.mint === c.mint && t.isBuy && (t.trader === c.creator || t.trader === c.user)) { sol += t.quoteAmount; tok += t.tokenAmount; }
      this.store.queueInitialBuy(c.mint, sol, tok);
    }
    if (evRows.length) this.sink.events(evRows);
    if (trades.length) this.sink.trades(trades);
  }

  private normPump(e: DecodedEvent, sig: string, idx: number, slot: number, txIndex: number | null, source: 0 | 1 | 2): TradeRow {
    const d = e.data;
    const quoteMint = isSol(d.quote_mint) ? null : (d.quote_mint as string);
    const quote = quoteMint && d.quote_amount !== undefined ? big(d.quote_amount) : big(d.sol_amount);
    const feeP = big(d.fee), feeC = big(d.creator_fee);
    return {
      sig, idx, slot, txIndex, ts: num(d.timestamp), venue: 0, mint: d.mint, trader: d.user, pool: null, ix: d.ix_name ?? null, isBuy: !!d.is_buy,
      quoteAmount: quote, tokenAmount: big(d.token_amount), userQuote: d.is_buy ? quote + feeP + feeC : quote - feeP - feeC,
      // TradeEvent reserves are POST-trade
      vQuote: quoteMint && d.virtual_quote_reserves !== undefined ? big(d.virtual_quote_reserves) : big(d.virtual_sol_reserves),
      vToken: big(d.virtual_token_reserves),
      rQuote: quoteMint && d.real_quote_reserves !== undefined ? big(d.real_quote_reserves) : bigOrNull(d.real_sol_reserves),
      rToken: bigOrNull(d.real_token_reserves), virtQuote: null,
      feeProtocol: feeP, feeCreator: feeC, feeLp: null, feeBuyback: bigOrNull(d.buyback_fee),
      feeCashback: bigOrNull(d.cashback), feeHolder: bigOrNull(d.holder_rewards),
      quoteMint, source,
    };
  }

  private normAmm(e: DecodedEvent, sig: string, idx: number, slot: number, txIndex: number | null, source: 0 | 1 | 2, info: PoolInfo | null): TradeRow {
    const d = e.data; const buyEv = e.name === 'BuyEvent';
    const baseAmt = big(buyEv ? d.base_amount_out : d.base_amount_in);
    let quoteAmt = big(buyEv ? d.quote_amount_in : d.quote_amount_out);
    let userQuote = d.user_quote_amount_in !== undefined || d.user_quote_amount_out !== undefined ? big(buyEv ? d.user_quote_amount_in : d.user_quote_amount_out) : null;
    // BuyEvent semantics differ by instruction: `buy` (exact base out) reports quote_amount_in = pool-side amount and
    // user_quote_amount_in = gross incl. fees; `buy_exact_quote_in` reports them the other way round. Normalize:
    // quote_amount = pool-side (smaller), user_quote = gross paid (larger). Sells are consistent already.
    if (buyEv && userQuote !== null && userQuote < quoteAmt) { const t = quoteAmt; quoteAmt = userQuote; userQuote = t; }
    const lp = big(d.lp_fee);
    // Event reserves are PRE-trade -> convert to POST-trade (verified exact on a live pool).
    const basePre = big(d.pool_base_token_reserves), quotePre = big(d.pool_quote_token_reserves);
    const basePost = buyEv ? basePre - baseAmt : basePre + baseAmt;
    const quotePost = buyEv ? quotePre + quoteAmt + lp : quotePre - (quoteAmt - lp);
    const virt = d.virtual_quote_reserves !== undefined ? big(d.virtual_quote_reserves) : 0n;
    const fees = { feeProtocol: big(d.protocol_fee), feeCreator: big(d.coin_creator_fee), feeLp: lp, feeBuyback: bigOrNull(d.buyback_fee),
      feeCashback: bigOrNull(d.cashback), feeHolder: bigOrNull(d.holder_rewards) };
    const common = { sig, idx, slot, txIndex, ts: num(d.timestamp), venue: 1 as const, trader: d.user as string, pool: d.pool as string, ix: (d.ix_name ?? (buyEv ? 'buy' : 'sell')) as string, source };
    if (info && isSol(info.base) && !isSol(info.quote)) {
      // Reversed pool (base = WSOL): a "buy" of base is a SELL of the token. Fees are charged in token units there -> not recorded.
      return { ...common, mint: info.quote, isBuy: !buyEv, quoteAmount: baseAmt, tokenAmount: quoteAmt, userQuote: null,
        vQuote: basePost, vToken: quotePost + virt, rQuote: basePost, rToken: quotePost, virtQuote: virt || null,
        feeProtocol: null, feeCreator: null, feeLp: null, feeBuyback: null, feeCashback: null, feeHolder: null, quoteMint: null };
    }
    return { ...common, mint: info ? info.base : null, isBuy: buyEv, quoteAmount: quoteAmt, tokenAmount: baseAmt, userQuote,
      vQuote: quotePost + virt, vToken: basePost, rQuote: quotePost, rToken: basePost, virtQuote: virt, ...fees,
      quoteMint: info && !isSol(info.quote) ? info.quote : null };
  }

  private flushPendingFor(pool: string) {
    const p = this.pendingPool.get(pool); const info = this.pools.get(pool);
    if (!p || !info) return;
    this.pendingPool.delete(pool);
    this.sink.trades(p.items.map(x => this.normAmm(x.e, x.sig, x.idx, x.slot, x.txIndex, x.source, info)));
  }

  /** Resolve pools seen in trades but not in the cache (batched account fetch). */
  async resolvePending(maxAttempts = 6) {
    if (!this.pendingPool.size) return;
    const ask = [...this.pendingPool.keys()].slice(0, 100);
    let res: Map<string, PoolInfo | null>;
    try { res = await this.resolver(ask); } catch { res = new Map(); }
    for (const pool of ask) {
      const info = res.get(pool);
      const p = this.pendingPool.get(pool); if (!p) continue;
      if (info) {
        this.pools.set(pool, info);
        this.store.queuePool({ pool, baseMint: info.base, quoteMint: info.quote, source: 'account' });
        this.flushPendingFor(pool);
      } else if (++p.attempts >= maxAttempts) {
        // Give up: keep the trades with mint unknown (pool id is still recorded).
        this.pendingPool.delete(pool);
        this.bump('amm.unresolvedPoolTrades', p.items.length);
        this.sink.trades(p.items.map(x => this.normAmm(x.e, x.sig, x.idx, x.slot, x.txIndex, x.source, null)));
      }
    }
  }

  /** On shutdown: write whatever is still waiting for pool resolution (mint unknown). */
  drainUnresolved() {
    for (const [pool, p] of this.pendingPool) {
      this.sink.trades(p.items.map(x => this.normAmm(x.e, x.sig, x.idx, x.slot, x.txIndex, x.source, this.pools.get(pool) ?? null)));
    }
    this.pendingPool.clear();
  }
}
