/**
 * SQLite store for the memecoin research dataset (WAL mode, batched writes).
 *
 * Space matters (PumpSwap alone is ~0.8M trade events/hour), so `trades` keeps pubkeys
 * as integer ids into a `keys` dictionary and dedupes on a 63-bit hash of (sig, idx).
 * Use the `trades_v` view for human-readable rows (full base58 mint/trader/pool).
 *
 * Reserve semantics (verified 2026-09-25 on the live chain):
 *   pump.fun TradeEvent reserves are POST-trade; PumpSwap Buy/SellEvent reserves are PRE-trade.
 *   The store normalizes both to POST-trade:
 *     PumpSwap buy : base -= base_amount_out ; quote vault += quote_amount_in_with_lp_fee
 *     PumpSwap sell: base += base_amount_in  ; quote vault -= quote_amount_out_without_lp_fee
 *   (999/999 consecutive events of one pool chained exactly with these rules.)
 */
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const SCHEMA_VERSION = 3;
export const MAYHEM_AGENT = 'BwWK17cbHxwWBKZkUYvzxLcNQ1YVyaFezduWbtm2de6s';
export const BOOST_AUTHORITY = 'HTVZVEQMBsNanubDPTs3CxDAEGNFQHJY8c1441iy2S5r';

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT);
CREATE TABLE IF NOT EXISTS keys(
  id INTEGER PRIMARY KEY,
  pubkey TEXT NOT NULL UNIQUE    -- base58 pubkeys; also short strings such as instruction names
);
CREATE TABLE IF NOT EXISTS tokens(
  mint TEXT PRIMARY KEY,
  creator TEXT, created_ts INTEGER, created_slot INTEGER, create_sig TEXT,
  name TEXT, symbol TEXT, uri TEXT,
  quote_mint TEXT,               -- NULL = SOL
  bonding_curve TEXT, token_program TEXT,
  is_mayhem INTEGER, is_cashback INTEGER, is_holder_reward INTEGER, creator_fee_bps INTEGER,
  launchpad TEXT,                -- 'pump' (on-chain) or PumpPortal's pool field ('pump', 'bonk', ...)
  initial_buy_sol INTEGER,       -- creator's buy inside the create tx (lamports / quote raw units, curve side)
  initial_buy_tokens INTEGER,    -- raw token units (6 decimals)
  seen_logs INTEGER NOT NULL DEFAULT 0,  -- 1 = CreateEvent decoded from chain
  seen_pp INTEGER NOT NULL DEFAULT 0,    -- 1 = PumpPortal subscribeNewToken reported it
  source TEXT,                   -- source that inserted the row first
  first_seen_at INTEGER          -- local unix ms
);
CREATE TABLE IF NOT EXISTS token_meta(
  mint TEXT PRIMARY KEY, uri TEXT, status TEXT,      -- 'ok' | 'http <code>' | 'error:<msg>' | 'bad-json'
  fetched_at INTEGER, attempts INTEGER,
  description TEXT, image TEXT, twitter TEXT, telegram TEXT, website TEXT,
  json TEXT                                          -- raw metadata JSON (capped at 32 KB)
);
CREATE TABLE IF NOT EXISTS trades(
  sig TEXT NOT NULL,             -- full base58 transaction signature
  idx INTEGER NOT NULL,          -- ordinal of this trade event inside the tx (execution order)
  slot INTEGER NOT NULL,
  tx_index INTEGER,              -- position of the tx inside its block (gTFA backfill; live getBlock only with --tx-index); usually NULL since v3
  ts INTEGER NOT NULL,           -- unix seconds from the event's own timestamp field
  venue INTEGER NOT NULL,        -- 0 = pump.fun bonding curve, 1 = PumpSwap AMM
  mint_id INTEGER,               -- keys.id of the traded token (NULL only if a PumpSwap pool could not be resolved)
  trader_id INTEGER NOT NULL,    -- keys.id of the event's user
  pool_id INTEGER,               -- keys.id of the PumpSwap pool (NULL on bonding curve)
  ix_id INTEGER,                 -- keys.id of the instruction name (buy, sell, buy_exact_sol_in, buy_exact_quote_in, buy_v2, ...)
  is_buy INTEGER NOT NULL,       -- 1 = trader bought the token
  quote_amount INTEGER NOT NULL, -- curve/pool-side quote amount EXCLUDING fees (lamports when quote is SOL)
  token_amount INTEGER NOT NULL, -- raw token units
  user_quote INTEGER,            -- what the trader actually paid (buy) / received (sell), quote units
  v_quote INTEGER, v_token INTEGER,  -- effective (virtual) reserves AFTER the trade (pump virtual; PumpSwap vault + virtual_quote_reserves)
  r_quote INTEGER, r_token INTEGER,  -- real reserves AFTER the trade (pump real_*; PumpSwap vault balances)
  virt_quote INTEGER,            -- PumpSwap Pool.virtual_quote_reserves (BOOST), NULL on the curve
  fee_protocol INTEGER, fee_creator INTEGER, fee_lp INTEGER,  -- quote units, additive
  fee_buyback INTEGER,           -- part of the protocol fee routed to buyback (NOT additive)
  fee_cashback INTEGER, fee_holder INTEGER,                   -- as emitted (cashback / holder-reward coins)
  quote_mint_id INTEGER,         -- keys.id of a non-SOL quote mint; NULL = SOL/WSOL
  source INTEGER NOT NULL,       -- 0 = websocket logs, 1 = tx fetch (truncated logs), 2 = Helius backfill / gap fill
  uid INTEGER NOT NULL UNIQUE    -- 63-bit hash of sig:idx (dedupe key)
);
CREATE INDEX IF NOT EXISTS trades_mint_slot ON trades(mint_id, slot);
CREATE INDEX IF NOT EXISTS trades_slot ON trades(slot);
CREATE TABLE IF NOT EXISTS events(
  sig TEXT NOT NULL, eidx INTEGER NOT NULL,          -- eidx = ordinal among ALL decoded events of the tx
  slot INTEGER NOT NULL, tx_index INTEGER, ts INTEGER,
  program TEXT NOT NULL, name TEXT NOT NULL,         -- every non-trade pump / PumpSwap event (creates, completes,
  mint TEXT, pool TEXT,                              -- migrations, CreatePool, InitBoost, BoostBuyAndBurn, fee/param
  data TEXT NOT NULL,                                -- changes, ...) with its full decoded body as JSON
  source INTEGER NOT NULL,
  PRIMARY KEY(sig, eidx)
);
CREATE INDEX IF NOT EXISTS events_name_slot ON events(name, slot);
CREATE TABLE IF NOT EXISTS migrations(
  mint TEXT NOT NULL,
  kind TEXT NOT NULL,            -- 'complete' (curve filled) | 'migrate' (PumpSwap pool created)
  sig TEXT, slot INTEGER, ts INTEGER,
  pool TEXT, quote_mint TEXT,
  sol_amount INTEGER, mint_amount INTEGER, migration_fee INTEGER,
  seen_logs INTEGER NOT NULL DEFAULT 0,
  seen_pp INTEGER NOT NULL DEFAULT 0,
  source TEXT, first_seen_at INTEGER,
  PRIMARY KEY(mint, kind)
);
CREATE TABLE IF NOT EXISTS pools(
  pool TEXT PRIMARY KEY,
  base_mint TEXT, quote_mint TEXT, creator TEXT, coin_creator TEXT,
  created_ts INTEGER, created_slot INTEGER, create_sig TEXT,
  source TEXT                    -- 'event' (CreatePoolEvent) | 'account' (fetched pool account)
);
CREATE TABLE IF NOT EXISTS wallet_labels(
  pubkey TEXT PRIMARY KEY, label TEXT NOT NULL, note TEXT
);
CREATE TABLE IF NOT EXISTS gaps(
  id INTEGER PRIMARY KEY,
  stream TEXT NOT NULL,          -- 'pump' | 'amm'
  from_slot INTEGER, to_slot INTEGER, from_at INTEGER, to_at INTEGER,
  reason TEXT,
  fill_status TEXT,              -- NULL = not attempted, 'filled', 'partial:<why>', 'skipped:<why>', 'error:<msg>'
  fill_txs INTEGER, fill_credits INTEGER, filled_at INTEGER
);
CREATE TABLE IF NOT EXISTS audits(
  at INTEGER PRIMARY KEY,        -- local unix ms
  venue TEXT NOT NULL, from_slot INTEGER, to_slot INTEGER,
  chain_events INTEGER, db_events INTEGER, matched INTEGER, pct REAL, credits INTEGER, endpoint TEXT
);
CREATE TABLE IF NOT EXISTS tracked_pools(
  pool TEXT PRIMARY KEY,          -- canonical PumpSwap pool of a coin that graduated while we were collecting
  mint TEXT NOT NULL, quote_mint TEXT,
  base_vault TEXT, quote_vault TEXT,
  migrate_slot INTEGER, migrate_ts INTEGER, registered_at INTEGER,   -- registered_at = local unix ms
  logs_from_slot INTEGER, logs_to_slot INTEGER,   -- slot range with TRADE-LEVEL coverage (per-pool logsSubscribe)
  logs_status TEXT,                 -- 'armed-before-migration' | 'subscribed-at-migration(+gapfill)' | ...
  poll_until INTEGER                -- local unix ms; reserve polling stops here
);
CREATE TABLE IF NOT EXISTS pool_states(
  pool_id INTEGER NOT NULL,         -- keys.id of the pool
  slot INTEGER NOT NULL,            -- context slot of the poll that saw this state
  base INTEGER, quote INTEGER,      -- vault balances (raw units): real reserves
  virt INTEGER,                     -- Pool.virtual_quote_reserves (BOOST virtual SOL); NULL = unchanged/not polled
  PRIMARY KEY(pool_id, slot)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS heartbeats(
  at INTEGER PRIMARY KEY,        -- local unix ms
  stats TEXT NOT NULL            -- JSON snapshot (per-minute counters)
);
CREATE VIEW IF NOT EXISTS trades_v AS
SELECT t.sig, t.idx, t.slot, t.tx_index, t.seq, t.ts,
       CASE t.venue WHEN 0 THEN 'pump' ELSE 'pumpswap' END AS venue,
       m.pubkey AS mint, w.pubkey AS trader, wl.label AS trader_label, p.pubkey AS pool, ix.pubkey AS ix_name, t.is_buy,
       CASE WHEN t.quote_mint_id IS NULL THEN t.quote_amount END AS sol_amount,
       t.quote_amount, t.token_amount, t.user_quote,
       t.v_quote, t.v_token, t.r_quote, t.r_token, t.virt_quote,
       CASE WHEN t.quote_mint_id IS NULL AND t.v_token > 0 THEN t.v_quote * 1.0e6 / t.v_token END AS market_cap_sol,
       coalesce(t.fee_protocol, 0) + coalesce(t.fee_creator, 0) + coalesce(t.fee_lp, 0) AS fee_total,
       t.fee_protocol, t.fee_creator, t.fee_lp, t.fee_buyback, t.fee_cashback, t.fee_holder,
       q.pubkey AS quote_mint,
       CASE t.source WHEN 0 THEN 'ws' WHEN 1 THEN 'txfetch' ELSE 'backfill' END AS source
FROM trades t
LEFT JOIN keys m ON m.id = t.mint_id
LEFT JOIN keys w ON w.id = t.trader_id
LEFT JOIN wallet_labels wl ON wl.pubkey = w.pubkey
LEFT JOIN keys p ON p.id = t.pool_id
LEFT JOIN keys ix ON ix.id = t.ix_id
LEFT JOIN keys q ON q.id = t.quote_mint_id;
`;

export interface TradeRow {
  sig: string; idx: number; slot: number; txIndex: number | null; ts: number; venue: 0 | 1;
  mint: string | null; trader: string; pool: string | null; ix: string | null; isBuy: boolean;
  quoteAmount: bigint; tokenAmount: bigint; userQuote: bigint | null;
  vQuote: bigint | null; vToken: bigint | null; rQuote: bigint | null; rToken: bigint | null; virtQuote: bigint | null;
  feeProtocol: bigint | null; feeCreator: bigint | null; feeLp: bigint | null; feeBuyback: bigint | null;
  feeCashback: bigint | null; feeHolder: bigint | null;
  quoteMint: string | null; source: 0 | 1 | 2;
}

export interface EventRow {
  sig: string; eidx: number; slot: number; txIndex: number | null; ts: number | null;
  program: string; name: string; mint: string | null; pool: string | null; data: string; source: 0 | 1 | 2;
}

export interface TokenRow {
  mint: string; creator?: string | null; createdTs?: number | null; createdSlot?: number | null; createSig?: string | null;
  name?: string | null; symbol?: string | null; uri?: string | null; quoteMint?: string | null; bondingCurve?: string | null;
  tokenProgram?: string | null; isMayhem?: boolean | null; isCashback?: boolean | null; isHolderReward?: boolean | null;
  creatorFeeBps?: bigint | number | null; launchpad?: string | null;
  initialBuySol?: bigint | number | null; initialBuyTokens?: bigint | number | null;
}

export interface MigrationRow {
  mint: string; kind: 'complete' | 'migrate'; sig?: string | null; slot?: number | null; ts?: number | null;
  pool?: string | null; quoteMint?: string | null; solAmount?: bigint | number | null; mintAmount?: bigint | number | null;
  migrationFee?: bigint | number | null;
}

export interface PoolRow {
  pool: string; baseMint: string; quoteMint: string; creator?: string | null; coinCreator?: string | null;
  createdTs?: number | null; createdSlot?: number | null; createSig?: string | null; source: 'event' | 'account';
}

export function tradeUid(sig: string, idx: number): bigint {
  const h = crypto.createHash('sha256').update(`${sig}:${idx}`).digest();
  return h.readBigUInt64LE(0) & 0x7fffffffffffffffn;
}

const n = <T,>(v: T | undefined): T | null => (v === undefined ? null : v);
const b = (v: boolean | null | undefined) => (v == null ? null : v ? 1 : 0);

export class Store {
  db: Database.Database;
  private keyCache = new Map<string, number>();
  private selKey: Database.Statement;
  private insKey: Database.Statement;
  private insTrade: Database.Statement;
  private insEvent: Database.Statement;
  private upTokenLogs: Database.Statement;
  private upTokenPp: Database.Statement;
  private setInitialBuy: Database.Statement;
  private upMigLogs: Database.Statement;
  private upMigPp: Database.Statement;
  private upPool: Database.Statement;
  private upMeta: Database.Statement;
  private pendingTrades: TradeRow[] = [];
  private pendingEvents: EventRow[] = [];
  private pendingOps: (() => void)[] = [];
  totals = { tradesInserted: 0, tradesDup: 0, eventsInserted: 0, tokensWritten: 0, migrationsWritten: 0, poolsWritten: 0 };

  constructor(public file: string) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new Database(file);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('busy_timeout = 10000');
    this.db.pragma('wal_autocheckpoint = 4000');
    const hasTrades = this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='trades'").get();
    if (hasTrades) {
      const cols = (this.db.prepare('PRAGMA table_info(trades)').all() as { name: string }[]).map(c => c.name);
      if (!cols.includes('r_quote')) throw new Error(`${file} has an older schema (v1); move it aside and start a fresh DB`);
      // v2 -> v3: per-coin intra-slot order reconstructed from the reserve chain (tx_index is no longer fetched)
      if (!cols.includes('seq')) this.db.exec('ALTER TABLE trades ADD COLUMN seq INTEGER');
    }
    this.db.exec('DROP VIEW IF EXISTS trades_v'); // recreated from SCHEMA so view changes apply to existing DBs
    this.db.exec(SCHEMA);
    const cols3 = (this.db.prepare('PRAGMA table_info(trades)').all() as { name: string }[]).map(c => c.name);
    if (!cols3.includes('seq')) this.db.exec('ALTER TABLE trades ADD COLUMN seq INTEGER');
    this.db.prepare("INSERT OR REPLACE INTO meta(k, v) VALUES ('schema_version', ?)").run(String(SCHEMA_VERSION));
    this.db.prepare("INSERT OR IGNORE INTO wallet_labels(pubkey, label, note) VALUES (?, 'mayhem_agent', 'pump.fun mayhem-mode agent (bot); exclude from buyer/volume features')").run(MAYHEM_AGENT);
    this.db.prepare("INSERT OR IGNORE INTO wallet_labels(pubkey, label, note) VALUES (?, 'boost_authority', 'PumpSwap BOOST vault authority (boost_buy_and_burn)')").run(BOOST_AUTHORITY);
    this.selKey = this.db.prepare('SELECT id FROM keys WHERE pubkey = ?');
    this.insKey = this.db.prepare('INSERT INTO keys(pubkey) VALUES (?)');
    this.insTrade = this.db.prepare(`INSERT OR IGNORE INTO trades
      (sig, idx, slot, tx_index, ts, venue, mint_id, trader_id, pool_id, ix_id, is_buy, quote_amount, token_amount, user_quote,
       v_quote, v_token, r_quote, r_token, virt_quote, fee_protocol, fee_creator, fee_lp, fee_buyback, fee_cashback, fee_holder,
       quote_mint_id, source, uid)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    this.insEvent = this.db.prepare(`INSERT OR IGNORE INTO events (sig, eidx, slot, tx_index, ts, program, name, mint, pool, data, source)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
    this.upTokenLogs = this.db.prepare(`INSERT INTO tokens
      (mint, creator, created_ts, created_slot, create_sig, name, symbol, uri, quote_mint, bonding_curve, token_program,
       is_mayhem, is_cashback, is_holder_reward, creator_fee_bps, launchpad, seen_logs, source, first_seen_at)
      VALUES (@mint, @creator, @createdTs, @createdSlot, @createSig, @name, @symbol, @uri, @quoteMint, @bondingCurve, @tokenProgram,
       @isMayhem, @isCashback, @isHolderReward, @creatorFeeBps, @launchpad, 1, @source, @now)
      ON CONFLICT(mint) DO UPDATE SET creator = excluded.creator, created_ts = excluded.created_ts, created_slot = excluded.created_slot,
        create_sig = excluded.create_sig, name = excluded.name, symbol = excluded.symbol, uri = excluded.uri, quote_mint = excluded.quote_mint,
        bonding_curve = excluded.bonding_curve, token_program = excluded.token_program, is_mayhem = excluded.is_mayhem,
        is_cashback = excluded.is_cashback, is_holder_reward = excluded.is_holder_reward, creator_fee_bps = excluded.creator_fee_bps, seen_logs = 1`);
    this.upTokenPp = this.db.prepare(`INSERT INTO tokens
      (mint, creator, create_sig, name, symbol, uri, bonding_curve, is_mayhem, launchpad, initial_buy_sol, initial_buy_tokens, seen_pp, source, first_seen_at)
      VALUES (@mint, @creator, @createSig, @name, @symbol, @uri, @bondingCurve, @isMayhem, @launchpad, @initialBuySol, @initialBuyTokens, 1, 'pumpportal', @now)
      ON CONFLICT(mint) DO UPDATE SET seen_pp = 1, launchpad = COALESCE(tokens.launchpad, excluded.launchpad)`);
    this.setInitialBuy = this.db.prepare('UPDATE tokens SET initial_buy_sol = ?, initial_buy_tokens = ? WHERE mint = ?');
    this.upMigLogs = this.db.prepare(`INSERT INTO migrations
      (mint, kind, sig, slot, ts, pool, quote_mint, sol_amount, mint_amount, migration_fee, seen_logs, source, first_seen_at)
      VALUES (@mint, @kind, @sig, @slot, @ts, @pool, @quoteMint, @solAmount, @mintAmount, @migrationFee, 1, @source, @now)
      ON CONFLICT(mint, kind) DO UPDATE SET sig = excluded.sig, slot = excluded.slot, ts = excluded.ts, pool = COALESCE(excluded.pool, migrations.pool),
        quote_mint = excluded.quote_mint, sol_amount = excluded.sol_amount, mint_amount = excluded.mint_amount, migration_fee = excluded.migration_fee, seen_logs = 1`);
    this.upMigPp = this.db.prepare(`INSERT INTO migrations (mint, kind, sig, pool, seen_pp, source, first_seen_at)
      VALUES (@mint, 'migrate', @sig, @pool, 1, 'pumpportal', @now)
      ON CONFLICT(mint, kind) DO UPDATE SET seen_pp = 1, pool = COALESCE(migrations.pool, excluded.pool)`);
    this.upPool = this.db.prepare(`INSERT INTO pools (pool, base_mint, quote_mint, creator, coin_creator, created_ts, created_slot, create_sig, source)
      VALUES (@pool, @baseMint, @quoteMint, @creator, @coinCreator, @createdTs, @createdSlot, @createSig, @source)
      ON CONFLICT(pool) DO UPDATE SET creator = COALESCE(excluded.creator, pools.creator), coin_creator = COALESCE(excluded.coin_creator, pools.coin_creator),
        created_ts = COALESCE(excluded.created_ts, pools.created_ts), created_slot = COALESCE(excluded.created_slot, pools.created_slot),
        create_sig = COALESCE(excluded.create_sig, pools.create_sig), source = CASE WHEN excluded.source = 'event' THEN 'event' ELSE pools.source END`);
    this.upMeta = this.db.prepare(`INSERT INTO token_meta (mint, uri, status, fetched_at, attempts, description, image, twitter, telegram, website, json)
      VALUES (@mint, @uri, @status, @at, @attempts, @description, @image, @twitter, @telegram, @website, @json)
      ON CONFLICT(mint) DO UPDATE SET uri = excluded.uri, status = excluded.status, fetched_at = excluded.fetched_at, attempts = excluded.attempts,
        description = excluded.description, image = excluded.image, twitter = excluded.twitter, telegram = excluded.telegram,
        website = excluded.website, json = excluded.json`);
  }

  keyId(pubkey: string): number {
    let id = this.keyCache.get(pubkey);
    if (id !== undefined) return id;
    const row = this.selKey.get(pubkey) as { id: number } | undefined;
    id = row ? row.id : Number(this.insKey.run(pubkey).lastInsertRowid);
    if (this.keyCache.size > 400_000) this.keyCache.clear(); // bounded memory; DB lookup covers misses
    this.keyCache.set(pubkey, id);
    return id;
  }

  loadPools(): Map<string, { base: string; quote: string }> {
    const m = new Map<string, { base: string; quote: string }>();
    for (const r of this.db.prepare('SELECT pool, base_mint, quote_mint FROM pools').all() as any[]) m.set(r.pool, { base: r.base_mint, quote: r.quote_mint });
    return m;
  }

  addTrades(rows: TradeRow[]) { for (const r of rows) this.pendingTrades.push(r); }
  addEvents(rows: EventRow[]) { for (const r of rows) this.pendingEvents.push(r); }
  queueToken(t: TokenRow, source: string) {
    this.pendingOps.push(() => {
      const r = this.upTokenLogs.run({ mint: t.mint, creator: n(t.creator), createdTs: n(t.createdTs), createdSlot: n(t.createdSlot), createSig: n(t.createSig),
        name: n(t.name), symbol: n(t.symbol), uri: n(t.uri), quoteMint: n(t.quoteMint), bondingCurve: n(t.bondingCurve), tokenProgram: n(t.tokenProgram),
        isMayhem: b(t.isMayhem), isCashback: b(t.isCashback), isHolderReward: b(t.isHolderReward), creatorFeeBps: n(t.creatorFeeBps),
        launchpad: t.launchpad ?? 'pump', source, now: Date.now() });
      if (r.changes) this.totals.tokensWritten++;
    });
  }
  queueInitialBuy(mint: string, sol: bigint, tokens: bigint) { this.pendingOps.push(() => { this.setInitialBuy.run(sol, tokens, mint); }); }
  queueTokenPp(t: TokenRow & { createSig?: string | null }) {
    this.pendingOps.push(() => {
      this.upTokenPp.run({ mint: t.mint, creator: n(t.creator), createSig: n(t.createSig), name: n(t.name), symbol: n(t.symbol), uri: n(t.uri),
        bondingCurve: n(t.bondingCurve), isMayhem: b(t.isMayhem), launchpad: n(t.launchpad),
        initialBuySol: n(t.initialBuySol), initialBuyTokens: n(t.initialBuyTokens), now: Date.now() });
    });
  }
  queueMigration(m: MigrationRow, source: string) {
    this.pendingOps.push(() => {
      const r = this.upMigLogs.run({ mint: m.mint, kind: m.kind, sig: n(m.sig), slot: n(m.slot), ts: n(m.ts), pool: n(m.pool), quoteMint: n(m.quoteMint),
        solAmount: n(m.solAmount), mintAmount: n(m.mintAmount), migrationFee: n(m.migrationFee), source, now: Date.now() });
      if (r.changes) this.totals.migrationsWritten++;
    });
  }
  queueMigrationPp(mint: string, sig: string | null, pool: string | null) {
    this.pendingOps.push(() => { this.upMigPp.run({ mint, sig, pool, now: Date.now() }); });
  }
  queuePool(p: PoolRow) {
    this.pendingOps.push(() => {
      const r = this.upPool.run({ pool: p.pool, baseMint: p.baseMint, quoteMint: p.quoteMint, creator: n(p.creator), coinCreator: n(p.coinCreator),
        createdTs: n(p.createdTs), createdSlot: n(p.createdSlot), createSig: n(p.createSig), source: p.source });
      if (r.changes) this.totals.poolsWritten++;
    });
  }
  queueMeta(m: { mint: string; uri: string; status: string; attempts: number; json?: string | null; description?: string | null; image?: string | null;
    twitter?: string | null; telegram?: string | null; website?: string | null }) {
    this.pendingOps.push(() => {
      this.upMeta.run({ mint: m.mint, uri: m.uri, status: m.status, at: Date.now(), attempts: m.attempts, json: n(m.json), description: n(m.description),
        image: n(m.image), twitter: n(m.twitter), telegram: n(m.telegram), website: n(m.website) });
    });
  }

  private insState: Database.Statement | null = null;
  queuePoolState(pool: string, slot: number, base: bigint | null, quote: bigint | null, virt: bigint | null) {
    this.pendingOps.push(() => {
      this.insState ??= this.db.prepare('INSERT OR REPLACE INTO pool_states(pool_id, slot, base, quote, virt) VALUES (?,?,?,?,?)');
      this.insState.run(this.keyId(pool), slot, base, quote, virt);
    });
  }

  pendingCount() { return this.pendingTrades.length + this.pendingEvents.length + this.pendingOps.length; }

  /** Write everything queued in one transaction. Returns number of trade rows actually inserted. */
  flush(): number {
    if (!this.pendingTrades.length && !this.pendingOps.length && !this.pendingEvents.length) return 0;
    const trades = this.pendingTrades; const ops = this.pendingOps; const events = this.pendingEvents;
    this.pendingTrades = []; this.pendingOps = []; this.pendingEvents = [];
    let inserted = 0, evIns = 0;
    // IMMEDIATE: take the write lock up front (waits up to busy_timeout). A deferred transaction that starts with
    // a SELECT fails instantly with SQLITE_BUSY when another connection (backfill.ts) commits in between.
    const tx = this.db.transaction(() => {
      for (const op of ops) op();
      for (const t of trades) {
        const r = this.insTrade.run(t.sig, t.idx, t.slot, t.txIndex, t.ts, t.venue,
          t.mint ? this.keyId(t.mint) : null, this.keyId(t.trader), t.pool ? this.keyId(t.pool) : null, t.ix ? this.keyId(t.ix) : null,
          t.isBuy ? 1 : 0, t.quoteAmount, t.tokenAmount, t.userQuote, t.vQuote, t.vToken, t.rQuote, t.rToken, t.virtQuote,
          t.feeProtocol, t.feeCreator, t.feeLp, t.feeBuyback, t.feeCashback, t.feeHolder,
          t.quoteMint ? this.keyId(t.quoteMint) : null, t.source, tradeUid(t.sig, t.idx));
        if (r.changes) inserted++; else this.totals.tradesDup++;
      }
      for (const e of events) {
        const r = this.insEvent.run(e.sig, e.eidx, e.slot, e.txIndex, e.ts, e.program, e.name, e.mint, e.pool, e.data, e.source);
        if (r.changes) evIns++;
      }
    });
    try { tx.immediate(); }
    catch (e) {
      // keep the rows for the next flush instead of dropping them (the transaction was rolled back)
      this.pendingTrades = trades.concat(this.pendingTrades); this.pendingEvents = events.concat(this.pendingEvents); this.pendingOps = ops.concat(this.pendingOps);
      this.keyCache.clear(); // ids inserted inside the rolled-back transaction are gone
      throw e;
    }
    this.totals.tradesInserted += inserted; this.totals.eventsInserted += evIns;
    return inserted;
  }

  recordGap(stream: string, fromSlot: number | null, toSlot: number | null, fromAt: number, toAt: number, reason: string): number {
    return Number(this.db.prepare('INSERT INTO gaps(stream, from_slot, to_slot, from_at, to_at, reason) VALUES (?,?,?,?,?,?)')
      .run(stream, fromSlot, toSlot, fromAt, toAt, reason).lastInsertRowid);
  }
  markGap(id: number, status: string, txs: number | null, credits: number | null) {
    this.db.prepare('UPDATE gaps SET fill_status = ?, fill_txs = ?, fill_credits = ?, filled_at = ? WHERE id = ?').run(status, txs, credits, Date.now(), id);
  }
  audit(a: { venue: string; from: number; to: number; chain: number; db: number; matched: number; credits: number; endpoint: string }) {
    this.db.prepare('INSERT OR REPLACE INTO audits(at, venue, from_slot, to_slot, chain_events, db_events, matched, pct, credits, endpoint) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run(Date.now(), a.venue, a.from, a.to, a.chain, a.db, a.matched, a.chain ? (100 * a.matched) / a.chain : null, a.credits, a.endpoint);
  }
  heartbeat(stats: object) {
    this.db.prepare('INSERT OR REPLACE INTO heartbeats(at, stats) VALUES (?, ?)').run(Date.now(), JSON.stringify(stats, (_, v) => (typeof v === 'bigint' ? v.toString() : v)));
  }

  close() {
    try { this.flush(); } catch { /* best effort */ }
    try { this.db.pragma('wal_checkpoint(TRUNCATE)'); } catch { /* ignore */ }
    this.db.close();
  }
}
