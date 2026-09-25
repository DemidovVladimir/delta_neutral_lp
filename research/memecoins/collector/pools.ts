/**
 * PumpSwap scope since v3: ONLY the canonical pools of coins that graduate while we collect.
 *
 * Measured 2026-09-25 (why this shape):
 *   - program-wide PumpSwap logsSubscribe: ~4.4 GB/h download, 0.74 M trades/h (mostly old, bot-traded coins);
 *   - per-pool logsSubscribe on the ~20 freshest graduates: ~1.1-2.1 GB/h (bots hammer fresh pools; ~9.5 KB of
 *     log traffic per real trade), so trade-level coverage is affordable only for a short window after migration;
 *   - accountSubscribe/getMultipleAccounts on pool vaults: ~23 MB/h for 20 fresh pools.
 * Therefore, per graduated coin:
 *   Tier A  trade level  — per-pool logsSubscribe from BEFORE the migration (the pool address is a PDA of the mint,
 *                          pre-subscribed once the curve is >= ~85 % sold) until migration + W minutes (default 1:
 *                          ~6 MB of log traffic per graduate in its first minute, ~15 MB in its first two);
 *   Tier B  state level  — vault balances + Pool.virtual_quote_reserves polled with getMultipleAccounts (dataSlice)
 *                          every 3 s (first 15 min), 15 s (to 6 h), 120 s (to 78 h = max hold + entry offset).
 */
import WebSocket from 'ws';
import bs58 from 'bs58';
import { PublicKey } from '@solana/web3.js';
import { extractLogEvents, PUMP_AMM_PROGRAM, PUMP_PROGRAM, WSOL_MINT } from './decode.ts';
import type { Processor } from './processor.ts';
import { rpcCall, RpcError } from './rpc.ts';
import type { Store, TradeRow } from './store.ts';

const PUMP_PK = new PublicKey(PUMP_PROGRAM), AMM_PK = new PublicKey(PUMP_AMM_PROGRAM);
const IDX0 = Buffer.from([0, 0]);

/** Canonical PumpSwap pool of a pump.fun coin: PDA("pool", 0u16, PDA("pool-authority", mint; pump), mint, quote; amm). */
export function canonicalPool(mint: string, quoteMint: string | null): string {
  const m = new PublicKey(mint);
  const [auth] = PublicKey.findProgramAddressSync([Buffer.from('pool-authority'), m.toBuffer()], PUMP_PK);
  const [pool] = PublicKey.findProgramAddressSync([Buffer.from('pool'), IDX0, auth.toBuffer(), m.toBuffer(), new PublicKey(quoteMint ?? WSOL_MINT).toBuffer()], AMM_PK);
  return pool.toBase58();
}

export interface PoolCtx {
  store: Store; processor: Processor;
  log: (m: string) => void; logThrottled: (k: string, m: string, ms?: number) => void;
  seenSig: (s: string) => boolean; markSig: (s: string) => void;
  queueGap: (stream: string, address: string, from: number, to: number, reason: string) => void;
  tipSlot: () => number | null;           // latest slot seen on the pump stream
  wsUrl: string; httpUrls: string[]; commitment: string;
  logsMinutes: number; armRealTokens: number; trackHours: number; stopping: () => boolean;
}

interface Tracked {
  pool: string; mint: string; quoteMint: string | null; migrateSlot: number; registeredAt: number;
  baseVault: string | null; quoteVault: string | null; pollUntil: number; logsUntil: number;
  lastVaultPoll: number; lastVirtPoll: number; base: bigint | null; quote: bigint | null; virt: bigint | null;
}

/** Per-pool logsSubscribe connections. mainnet-beta closes a connection ("1013 Too many subscriptions attempted")
 *  after a burst of ~80 subscribe calls, so each connection takes at most MAX_ATTEMPTS subscriptions and new
 *  ones go to a fresh connection; drained old connections are closed. */
const MAX_ATTEMPTS = 40;
interface Conn { ws: WebSocket; attempts: number; subs: Map<number, string>; pending: Map<number, string>; lastSlot: number | null; open: boolean; bytes: number; msgs: number }

export class PoolTracker {
  tracked = new Map<string, Tracked>();          // pool -> state
  armed = new Map<string, { pool: string; armedAt: number; lastTradeAt: number }>(); // mint -> pre-subscribed pool
  private conns: Conn[] = [];
  private interrupted = new Map<string, { from: number; to: number }>(); // armed pools whose logs socket dropped
  private armedPools = new Set<string>();
  private active = new Map<string, Conn>();       // pool -> connection holding its logs subscription
  private reqId = 1000;
  stats = { armed: 0, disarmed: 0, registered: 0, lateSubscribe: 0, logMsgs: 0, logBytes: 0, logTrades: 0, pollCalls: 0, pollBytes: 0, states: 0, pollErrors: 0 };
  private cooldown = new Map<string, number>(); private rr = 0; private polling = false;

  constructor(private c: PoolCtx) {
    const rows = c.store.db.prepare('SELECT pool, mint, quote_mint, base_vault, quote_vault, migrate_slot, registered_at, poll_until FROM tracked_pools WHERE poll_until > ?').all(Date.now()) as any[];
    for (const r of rows) {
      this.tracked.set(r.pool, { pool: r.pool, mint: r.mint, quoteMint: r.quote_mint, migrateSlot: r.migrate_slot, registeredAt: r.registered_at,
        baseVault: r.base_vault, quoteVault: r.quote_vault, pollUntil: r.poll_until, logsUntil: r.registered_at + c.logsMinutes * 60_000,
        lastVaultPoll: 0, lastVirtPoll: 0, base: null, quote: null, virt: null });
      c.processor.pools.set(r.pool, { base: r.mint, quote: r.quote_mint ?? WSOL_MINT });
    }
    // Bootstrap: graduations already in the DB (e.g. collected by the v2 program-wide socket) get state polling too.
    const mig = c.store.db.prepare(`SELECT mint, pool, quote_mint, slot, ts FROM migrations WHERE kind = 'migrate' AND seen_logs = 1 AND pool IS NOT NULL
      AND ts > ? AND pool NOT IN (SELECT pool FROM tracked_pools)`).all(Math.floor(Date.now() / 1000) - c.trackHours * 3600) as any[];
    for (const m of mig) {
      const at = m.ts * 1000, until = at + c.trackHours * 3600_000;
      c.store.db.prepare(`INSERT OR IGNORE INTO tracked_pools(pool, mint, quote_mint, migrate_slot, migrate_ts, registered_at, logs_status, poll_until) VALUES (?,?,?,?,?,?,?,?)`)
        .run(m.pool, m.mint, m.quote_mint, m.slot, m.ts, at, m.slot < 450340295 ? 'state-only (graduation found by backfill)' : 'pre-v3 (program-wide PumpSwap socket)', until);
      this.tracked.set(m.pool, { pool: m.pool, mint: m.mint, quoteMint: m.quote_mint, migrateSlot: m.slot, registeredAt: at, baseVault: null, quoteVault: null,
        pollUntil: until, logsUntil: 0, lastVaultPoll: 0, lastVirtPoll: 0, base: null, quote: null, virt: null });
      c.processor.pools.set(m.pool, { base: m.mint, quote: m.quote_mint ?? WSOL_MINT });
    }
    // In scope = a tracked pool AND inside its trade-level window (migration .. + W minutes + 60 s margin). PumpSwap
    // trades of tracked pools that show up later inside pump-program txs (arb bundles) are dropped: storing them made
    // sparse, misleading post-window rows and costly reserve-chain "holes" (one fill fetched 11k txs / 1,120 credits).
    const winSlots = Math.round((c.logsMinutes * 60 + 60) / 0.2664);
    // Armed (pre-subscribed) pools are in scope too: the pool socket can deliver the snipes that land in the
    // migration slot BEFORE the pump socket delivers the migration itself (validation: 3 of 28 and 4 of 540 trades
    // in the migration slot were dropped this way). A pool that does not exist yet cannot trade, so any slot is fine.
    c.processor.ammFilter = (pool, slot) => {
      const t = this.tracked.get(pool);
      if (t) return slot >= t.migrateSlot && slot <= t.migrateSlot + winSlots;
      return this.armedPools.has(pool);
    };
  }

  inScope(pool: string) { return this.tracked.has(pool); }

  // ---------------------------------------------------------------- arming (pre-subscribe before migration)
  onPumpTrade(t: TradeRow) {
    if (!t.mint || t.rToken === null) return;
    const a = this.armed.get(t.mint);
    if (a) { a.lastTradeAt = Date.now(); return; }
    if (t.rToken > BigInt(this.c.armRealTokens)) return;
    let pool: string; try { pool = canonicalPool(t.mint, t.quoteMint); } catch { return; }
    if (this.tracked.has(pool)) return;
    this.armed.set(t.mint, { pool, armedAt: Date.now(), lastTradeAt: Date.now() });
    this.armedPools.add(pool);
    this.c.processor.pools.set(pool, { base: t.mint, quote: t.quoteMint ?? WSOL_MINT });
    this.stats.armed++;
    this.subscribe(pool);
  }

  // ---------------------------------------------------------------- migration: pool enters scope
  onMigration(m: { mint: string; pool: string; quoteMint: string | null; slot: number; ts: number; sig: string }) {
    if (this.tracked.has(m.pool)) return;
    const now = Date.now();
    const t: Tracked = { pool: m.pool, mint: m.mint, quoteMint: m.quoteMint, migrateSlot: m.slot, registeredAt: now, baseVault: null, quoteVault: null,
      pollUntil: now + this.c.trackHours * 3600_000, logsUntil: now + this.c.logsMinutes * 60_000, lastVaultPoll: 0, lastVirtPoll: 0, base: null, quote: null, virt: null };
    this.tracked.set(m.pool, t);
    this.armedPools.delete(m.pool);
    this.c.processor.pools.set(m.pool, { base: m.mint, quote: m.quoteMint ?? WSOL_MINT });
    this.stats.registered++;
    const a = this.armed.get(m.mint);
    let status: string;
    // "armed before" only if the subscription existed before the migration landed (gap-fill replays arm and migrate
    // in the same page, seconds or minutes after the fact — that is a late subscription)
    if (a && a.pool === m.pool && this.active.has(m.pool) && a.armedAt <= m.ts * 1000 + 2_000) { status = 'armed-before-migration'; this.armed.delete(m.mint); }
    else {
      if (a && a.pool !== m.pool) this.unsubscribe(a.pool);
      if (a) this.armed.delete(m.mint);
      this.subscribe(m.pool);
      this.stats.lateSubscribe++;
      status = 'subscribed-at-migration+gapfill';
      const tip = this.c.tipSlot() ?? m.slot;
      this.c.queueGap(`pool:${m.pool}`, m.pool, m.slot, Math.max(m.slot, tip) + 3, 'pool subscribed after migration');
    }
    const intr = this.interrupted.get(m.pool);
    if (intr) {
      this.interrupted.delete(m.pool);
      if (intr.to >= m.slot) this.c.queueGap(`pool:${m.pool}`, m.pool, Math.max(m.slot, intr.from), intr.to, 'pool logs connection dropped around the migration');
    }
    this.c.store.db.prepare(`INSERT OR REPLACE INTO tracked_pools(pool, mint, quote_mint, migrate_slot, migrate_ts, registered_at, logs_from_slot, logs_status, poll_until)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(m.pool, m.mint, m.quoteMint, m.slot, m.ts, now, m.slot, status, t.pollUntil);
    this.c.log(`[pools] tracking ${m.pool} (mint ${m.mint}) from slot ${m.slot}: ${status}`);
  }

  /** A gap on the pump stream: pools whose trade-level window overlaps it need a per-pool fill. */
  onPumpGap(from: number, to: number) {
    const w = Math.round(this.c.logsMinutes * 60 / 0.2664);
    for (const t of this.tracked.values()) {
      const lo = t.migrateSlot, hi = t.migrateSlot + w;
      if (lo <= to && hi >= from) this.c.queueGap(`pool:${t.pool}`, t.pool, Math.max(lo, from), Math.min(hi, to), 'restart/outage inside trade-level window');
    }
  }

  // ---------------------------------------------------------------- per-pool log subscriptions
  private newConn(): Conn {
    const ws = new WebSocket(this.c.wsUrl, { perMessageDeflate: false, maxPayload: 64 * 1024 * 1024 });
    const conn: Conn = { ws, attempts: 0, subs: new Map(), pending: new Map(), lastSlot: null, open: false, bytes: 0, msgs: 0 };
    ws.on('open', () => { conn.open = true; for (const [id, pool] of conn.pending) this.sendSub(conn, id, pool); });
    ws.on('message', (d: Buffer) => this.onMessage(conn, d));
    ws.on('error', (e) => this.c.logThrottled('poolws', `[pools] ws error: ${e.message}`, 60_000));
    ws.on('close', (code) => this.onClose(conn, code));
    this.conns.push(conn);
    return conn;
  }
  private sendSub(conn: Conn, id: number, pool: string) {
    conn.ws.send(JSON.stringify({ jsonrpc: '2.0', id, method: 'logsSubscribe', params: [{ mentions: [pool] }, { commitment: this.c.commitment }] }));
  }
  private subscribe(pool: string) {
    if (this.active.has(pool) || this.c.stopping()) return;
    let conn = this.conns[this.conns.length - 1];
    if (!conn || conn.attempts >= MAX_ATTEMPTS || conn.ws.readyState > WebSocket.OPEN) conn = this.newConn();
    const id = this.reqId++; conn.attempts++; conn.pending.set(id, pool); this.active.set(pool, conn);
    if (conn.open) this.sendSub(conn, id, pool);
  }
  private unsubscribe(pool: string) {
    const conn = this.active.get(pool); if (!conn) return;
    this.active.delete(pool);
    for (const [sid, p] of conn.subs) if (p === pool) {
      conn.subs.delete(sid);
      try { conn.ws.send(JSON.stringify({ jsonrpc: '2.0', id: this.reqId++, method: 'logsUnsubscribe', params: [sid] })); } catch { /* ignore */ }
    }
    for (const [id, p] of conn.pending) if (p === pool) conn.pending.delete(id);
    const newest = this.conns[this.conns.length - 1];
    if (conn !== newest && conn.subs.size === 0 && conn.pending.size === 0) { try { conn.ws.close(); } catch { /* ignore */ } }
  }
  private onClose(conn: Conn, code: number) {
    this.conns = this.conns.filter(x => x !== conn);
    if (this.c.stopping()) return;
    const pools = [...this.active.entries()].filter(([, c]) => c === conn).map(([p]) => p);
    if (!pools.length) return;
    this.c.log(`[pools] logs connection closed (${code}) with ${pools.length} active pool subscriptions — resubscribing`);
    const tip = this.c.tipSlot();
    for (const p of pools) {
      this.active.delete(p);
      const t = this.tracked.get(p);
      if (conn.lastSlot === null || tip === null || tip <= conn.lastSlot) continue;
      if (t) this.c.queueGap(`pool:${p}`, p, conn.lastSlot, tip + 3, `pool logs connection closed (${code})`);
      else this.interrupted.set(p, { from: conn.lastSlot, to: tip + 3 }); // armed pool: a gap only matters if it migrates inside it
    }
    setTimeout(() => {
      const now = Date.now();
      for (const p of pools) { const t = this.tracked.get(p); if ((t && t.logsUntil > now) || [...this.armed.values()].some(a => a.pool === p)) this.subscribe(p); }
    }, 2000);
  }
  private onMessage(conn: Conn, d: Buffer) {
    conn.bytes += d.length; this.stats.logBytes += d.length;
    let j: any; try { j = JSON.parse(d.toString()); } catch { return; }
    if (!j.params) {
      if (j.id !== undefined && conn.pending.has(j.id)) {
        const pool = conn.pending.get(j.id)!; conn.pending.delete(j.id);
        if (j.error) { this.c.logThrottled('poolsub', `[pools] subscribe error for ${pool}: ${JSON.stringify(j.error)}`); this.active.delete(pool); }
        else if (this.active.get(pool) === conn) conn.subs.set(j.result, pool);
        else { try { conn.ws.send(JSON.stringify({ jsonrpc: '2.0', id: this.reqId++, method: 'logsUnsubscribe', params: [j.result] })); } catch { /* ignore */ } }
      }
      return;
    }
    conn.msgs++; this.stats.logMsgs++;
    const slot: number = j.params.result.context.slot; const v = j.params.result.value;
    if (conn.lastSlot === null || slot > conn.lastSlot) conn.lastSlot = slot;
    if (v.err || /^1{64,88}$/.test(v.signature) || this.c.seenSig(v.signature)) return; // all-zero placeholder signature = never landed
    const { events } = extractLogEvents(v.logs ?? []);
    if (!events.length) return;
    this.c.markSig(v.signature);
    try { this.c.processor.handleTx(v.signature, slot, events, 0); } catch (e: any) { this.c.logThrottled('poolproc', `[pools] process error: ${e?.message ?? e}`); }
    for (const e of events) if (e.name === 'BuyEvent' || e.name === 'SellEvent') this.stats.logTrades++;
  }

  // ---------------------------------------------------------------- housekeeping (every second)
  tick() {
    const now = Date.now();
    for (const [mint, a] of this.armed) if (now - a.lastTradeAt > 20 * 60_000) { this.armed.delete(mint); this.armedPools.delete(a.pool); this.unsubscribe(a.pool); this.stats.disarmed++; }
    for (const t of this.tracked.values()) {
      if (t.logsUntil <= now && this.active.has(t.pool)) {
        const conn = this.active.get(t.pool)!;
        this.unsubscribe(t.pool);
        this.c.store.db.prepare('UPDATE tracked_pools SET logs_to_slot = ? WHERE pool = ?').run(conn.lastSlot, t.pool);
      }
      if (t.pollUntil <= now) { this.tracked.delete(t.pool); }
    }
    if (!this.polling) { this.polling = true; this.poll().catch(() => {}).finally(() => { this.polling = false; }); }
  }

  // ---------------------------------------------------------------- state polling
  private url(): string | null {
    for (let k = 0; k < this.c.httpUrls.length; k++) {
      const u = this.c.httpUrls[(this.rr++) % this.c.httpUrls.length];
      if ((this.cooldown.get(u) ?? 0) <= Date.now()) return u;
    }
    return null;
  }
  private async gma(keys: string[], slice: { offset: number; length: number } | null): Promise<{ slot: number; value: any[] } | null> {
    const u = this.url(); if (!u) return null;
    try {
      const cfg: any = { encoding: 'base64', commitment: 'confirmed' }; if (slice) cfg.dataSlice = slice;
      const r = await rpcCall<{ context: { slot: number }; value: any[] }>(u, 'getMultipleAccounts', [keys, cfg], 15_000);
      this.stats.pollCalls++; this.stats.pollBytes += keys.length * (slice ? 60 : 500);
      return { slot: r.context.slot, value: r.value };
    } catch (e: any) {
      this.stats.pollErrors++;
      if (e instanceof RpcError && (e.status === 429 || e.status === 403 || e.code === 429)) this.cooldown.set(u, Date.now() + 30_000);
      return null;
    }
  }
  private record(t: Tracked, slot: number, base: bigint | null, quote: bigint | null, virt: bigint | null) {
    const nb = base ?? t.base, nq = quote ?? t.quote, nv = virt ?? t.virt;
    if (nb === t.base && nq === t.quote && nv === t.virt) return;
    t.base = nb; t.quote = nq; t.virt = nv;
    this.c.store.queuePoolState(t.pool, slot, nb, nq, nv); this.stats.states++;
  }
  private async poll() {
    const now = Date.now();
    const list = [...this.tracked.values()];
    // 1) resolve vault addresses (+ initial virt) from the pool account
    const unresolved = list.filter(t => !t.baseVault).slice(0, 100);
    if (unresolved.length) {
      const r = await this.gma(unresolved.map(t => t.pool), null);
      if (r) unresolved.forEach((t, i) => {
        const a = r.value[i]; if (!a) return;
        const b = Buffer.from(a.data[0], 'base64'); if (b.length < 261) return;
        t.baseVault = bs58.encode(b.subarray(139, 171)); t.quoteVault = bs58.encode(b.subarray(171, 203));
        this.c.store.db.prepare('UPDATE tracked_pools SET base_vault = ?, quote_vault = ? WHERE pool = ?').run(t.baseVault, t.quoteVault, t.pool);
        this.record(t, r.slot, null, null, (b.readBigInt64LE(253) << 64n) + b.readBigUInt64LE(245)); t.lastVirtPoll = now;
      });
    }
    const age = (t: Tracked) => now - t.registeredAt;
    const vaultEvery = (t: Tracked) => (age(t) < 15 * 60_000 ? 3_000 : age(t) < 6 * 3600_000 ? 15_000 : 120_000);
    const virtEvery = (t: Tracked) => (age(t) < 15 * 60_000 ? 3_000 : age(t) < 6 * 3600_000 ? 60_000 : 600_000);
    // 2) vault balances (token amount = u64 at offset 64 for SPL Token and Token-2022 accounts)
    const dueV = list.filter(t => t.baseVault && now - t.lastVaultPoll >= vaultEvery(t)).sort((a, b) => a.lastVaultPoll - b.lastVaultPoll).slice(0, 50);
    if (dueV.length) {
      const r = await this.gma(dueV.flatMap(t => [t.baseVault!, t.quoteVault!]), { offset: 64, length: 8 });
      if (r) dueV.forEach((t, i) => {
        t.lastVaultPoll = now;
        const ab = r.value[2 * i], aq = r.value[2 * i + 1];
        const base = ab ? Buffer.from(ab.data[0], 'base64').readBigUInt64LE(0) : null, quote = aq ? Buffer.from(aq.data[0], 'base64').readBigUInt64LE(0) : null;
        this.record(t, r.slot, base, quote, null);
      });
    }
    // 3) Pool.virtual_quote_reserves (i128 at offset 245) — changes only with BOOST activity / config
    const dueP = list.filter(t => t.baseVault && now - t.lastVirtPoll >= virtEvery(t)).sort((a, b) => a.lastVirtPoll - b.lastVirtPoll).slice(0, 100);
    if (dueP.length) {
      const r = await this.gma(dueP.map(t => t.pool), { offset: 245, length: 16 });
      if (r) dueP.forEach((t, i) => {
        t.lastVirtPoll = now; const a = r.value[i]; if (!a) return;
        const b = Buffer.from(a.data[0], 'base64'); if (b.length < 16) return;
        this.record(t, r.slot, null, null, (b.readBigInt64LE(8) << 64n) + b.readBigUInt64LE(0));
      });
    }
  }

  takeStats() {
    const s = { ...this.stats, trackedPools: this.tracked.size, armedNow: this.armed.size, logSubs: this.active.size, logConns: this.conns.length };
    this.stats = { armed: 0, disarmed: 0, registered: 0, lateSubscribe: 0, logMsgs: 0, logBytes: 0, logTrades: 0, pollCalls: 0, pollBytes: 0, states: 0, pollErrors: 0 };
    return s;
  }
  closeAll() { for (const c of this.conns) { try { c.ws.close(); } catch { /* ignore */ } } }
}
