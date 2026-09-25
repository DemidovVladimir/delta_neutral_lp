/**
 * Adapter: our own collector's SQLite (research/memecoins/data/memecoins.db, schema in
 * research/memecoins/collector/store.ts). Opened READ-ONLY; the collector is never touched.
 *
 * Loads the pump.fun CURVE trades (venue 0, SOL quote) of every coin whose CreateEvent time lies in
 * [createdFrom, createdTo), from any source (0 live websocket, 1 tx fetch, 2 Helius backfill / gap fill),
 * up to tradesTo. Streaming per mint through the (mint_id, slot) index into growable typed arrays.
 *
 * Differences from the public tape that matter:
 *   - clock = slot. tickSec = the slot time MEASURED on the loaded window (PROTOCOL §3.1 / G6), and a
 *     piecewise-linear slot -> unix mapping (anchors) for UTC-day bucketing and the downtime guard;
 *   - exact post-trade v_quote / v_token per trade; every trade event of a transaction is kept;
 *   - creator buy = curve SOL of the coin's first trade in reconstructed order, if it starts from the
 *     initial state, is by the creator, and is a buy (the same definition as on the public tape).
 *   - PumpSwap trades are not loaded (migration exits use the pool-opening state, as on the tape).
 *
 * Split guard (PROTOCOL §1.2): without A27_STAGE=validate|test the loader refuses windows reaching past the
 * planned train range: collection started 2026-09-25, 7 warm-up days + 32 train days -> 2026-11-03 00:00Z.
 */
import Database from 'better-sqlite3';
import { buildChain, type RawRow } from '../chain.ts';
import type { MintMeta, Tape } from '../tape.ts';
import { MAYHEM_AGENT } from './vdw.ts';

export const COLLECTION_START = Date.UTC(2026, 8, 25) / 1000; // 2026-09-25T00:00:00Z
export const PLAN = { warmupDays: 7, trainDays: 32 };
export const TRAIN_END = COLLECTION_START + (PLAN.warmupDays + PLAN.trainDays) * 86_400; // 2026-11-03T00:00:00Z

type TA = Float64Array | Int32Array | Uint8Array;
class Grow<T extends TA> {
  a: T; n = 0;
  constructor(private make: (n: number) => T, c = 1 << 20) { this.a = make(c); }
  push(v: number) { if (this.n === this.a.length) { const b = this.make(this.a.length * 2); b.set(this.a as never); this.a = b; } this.a[this.n++] = v; }
  /** exact-size copy; the growable buffer is released */
  take(): T { const out = this.a.slice(0, this.n) as T; this.a = this.make(0); return out; }
}
const F = (n: number) => new Float64Array(n), I = (n: number) => new Int32Array(n), U = (n: number) => new Uint8Array(n);

export interface CollectorLoad { tape: Tape; stats: Record<string, number | string> }

export function loadCollector(dbPath: string, opts: { createdFrom: number; createdTo: number; tradesTo: number }): CollectorLoad {
  const stage = process.env.A27_STAGE;
  if (opts.tradesTo > TRAIN_END && stage !== 'validate' && stage !== 'test') {
    throw new Error(`window reaches ${new Date(opts.tradesTo * 1000).toISOString()} past the planned train end ${new Date(TRAIN_END * 1000).toISOString()}; set A27_STAGE`);
  }
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  const toks = db.prepare(`SELECT t.mint, t.creator, t.created_ts, t.created_slot, t.name, t.symbol, t.quote_mint, t.is_mayhem, t.initial_buy_sol, k.id AS mint_id
      FROM tokens t JOIN keys k ON k.pubkey = t.mint
      WHERE t.seen_logs = 1 AND t.created_ts >= ? AND t.created_ts < ?`).all(opts.createdFrom, opts.createdTo) as {
    mint: string; creator: string | null; created_ts: number; created_slot: number | null; name: string | null; symbol: string | null;
    quote_mint: string | null; is_mayhem: number | null; initial_buy_sol: number | null; mint_id: number;
  }[];
  const q = db.prepare(`SELECT rowid, slot, ts, trader_id, is_buy, quote_amount, token_amount, v_quote, v_token, source
      FROM trades WHERE mint_id = ? AND venue = 0 AND quote_mint_id IS NULL AND ts < ? ORDER BY slot, rowid`).raw();
  const keyOf = db.prepare('SELECT pubkey FROM keys WHERE id = ?').pluck();
  const traderIdx = new Map<number, number>(); const traderKeyIds: number[] = [];
  const C = { tick: new Grow(I), isBuy: new Grow(U), sol: new Grow(F), tok: new Grow(F), vSol: new Grow(F), vTok: new Grow(F), gap: new Grow(F), trader: new Grow(I) };
  const B = 2000; const buckets = new Map<number, [number, number, number]>(); // floor(slot / B) -> [sum slot, sum ts, count], for the time mapping
  const off: number[] = []; const meta: MintMeta[] = [];
  const stats: Record<string, number> = { tokens: toks.length, nonSolQuote: 0, withTrades: 0, trades: 0, bySource0: 0, bySource1: 0, bySource2: 0, chainFromStart: 0, gapped: 0, creatorFirst: 0, creatorBuyMatchesTokensRow: 0, creatorBuyTokensRowPresent: 0, mayhem: 0 };
  let mayhemKey = -1;
  { const r = db.prepare('SELECT id FROM keys WHERE pubkey = ?').pluck().get(MAYHEM_AGENT) as number | undefined; if (r !== undefined) mayhemKey = r; }
  const creatorKeyStmt = db.prepare('SELECT id FROM keys WHERE pubkey = ?').pluck();
  let minSlot = Infinity, maxSlot = -Infinity, minTs = Infinity, maxTs = -Infinity;
  for (const tk of toks) {
    if (tk.quote_mint) { stats.nonSolQuote++; continue; } // U1
    const raw = q.all(tk.mint_id, opts.tradesTo) as [number, number, number, number, number, number, number, number, number, number][];
    const rows: RawRow[] = []; const vTokExact: number[] = [];
    let mayhem = !!tk.is_mayhem;
    for (const [rowid, slot, ts, tid, isBuy, qa, ta, vq, vt, src] of raw) {
      let ti = traderIdx.get(tid); if (ti === undefined) { ti = traderKeyIds.length; traderIdx.set(tid, ti); traderKeyIds.push(tid); }
      if (tid === mayhemKey) mayhem = true;
      rows.push({ tick: slot, ord: rowid, isBuy: isBuy === 1, sol: qa, tok: ta, vSolPost: vq, trader: ti });
      vTokExact.push(vt);
      stats[`bySource${src}`] = (stats[`bySource${src}`] ?? 0) + 1;
      if (slot < minSlot) minSlot = slot; if (slot > maxSlot) maxSlot = slot; if (ts < minTs) minTs = ts; if (ts > maxTs) maxTs = ts;
      { const k = Math.floor(slot / B); const e = buckets.get(k); if (e) { e[0] += slot; e[1] += ts; e[2]++; } else buckets.set(k, [slot, ts, 1]); }
    }
    off.push(C.tick.n);
    const base = C.tick.n;
    const creatorKey = tk.creator ? (creatorKeyStmt.get(tk.creator) as number | undefined) : undefined;
    const creatorTi = creatorKey !== undefined ? traderIdx.get(creatorKey) ?? -1 : -1;
    let t0 = tk.created_slot ?? (raw.length ? raw[0][1] : 0), t0Exact = false, creatorBuy = 0;
    let chainFromStart = false, gaps = 0, gapAbs = 0, completeIdx = -1;
    if (rows.length) {
      stats.withTrades++;
      const ch = buildChain(rows);
      for (let p = 0; p < ch.order.length; p++) {
        const r = rows[ch.order[p]];
        C.tick.push(r.tick); C.isBuy.push(r.isBuy ? 1 : 0); C.sol.push(r.sol); C.tok.push(r.tok);
        C.vSol.push(r.vSolPost); C.vTok.push(vTokExact[ch.order[p]]); C.gap.push(ch.gap[p]); C.trader.push(r.trader);
      }
      chainFromStart = ch.chainFromStart; gaps = ch.gaps; gapAbs = ch.gapAbs;
      if (ch.completePos >= 0) completeIdx = base + ch.completePos;
      const f = rows[ch.order[0]];
      if (chainFromStart && f.trader === creatorTi && f.isBuy) { t0Exact = true; creatorBuy = f.sol; t0 = f.tick; stats.creatorFirst++; }
      if (chainFromStart) stats.chainFromStart++;
      if (gaps > 0) stats.gapped++;
      if (tk.initial_buy_sol != null) { stats.creatorBuyTokensRowPresent++; if (t0Exact && Number(tk.initial_buy_sol) === creatorBuy) stats.creatorBuyMatchesTokensRow++; }
    }
    if (mayhem) stats.mayhem++;
    meta.push({
      mint: tk.mint, creator: tk.creator ?? '', name: tk.name ?? '', symbol: tk.symbol ?? '', createdAt: tk.created_ts, t0, t0Exact,
      creatorBuyLamports: creatorBuy, chainFromStart, g1Strict: rows.length > 0 && chainFromStart && gaps === 0, gaps, gapAbsLamports: gapAbs, mayhem, completeIdx,
    });
  }
  off.push(C.tick.n);
  const traders = traderKeyIds.map((id) => keyOf.get(id) as string);
  db.close();
  stats.trades = C.tick.n;
  // measured slot time and slot -> unix anchors (one anchor per 2,000-slot bucket: mean slot, mean ts + 0.5 s since ts is floor-second)
  const tickSec = maxSlot > minSlot ? (maxTs - minTs) / (maxSlot - minSlot) : 0.4;
  const at: number[] = [], au: number[] = [];
  for (const k of [...buckets.keys()].sort((a, b) => a - b)) { const e = buckets.get(k)!; at.push(e[0] / e[2]); au.push(e[1] / e[2] + 0.5); }
  const tape: Tape = {
    source: 'collector', tickSec, epoch: minTs - minSlot * tickSec, meta, off: Int32Array.from(off),
    tick: C.tick.take(), isBuy: C.isBuy.take(), sol: C.sol.take(), tok: C.tok.take(),
    vSol: C.vSol.take(), vTok: C.vTok.take(), gap: C.gap.take(), trader: C.trader.take(), traders,
    anchors: { tick: Float64Array.from(at), unix: Float64Array.from(au) },
  };
  return { tape, stats: { ...stats, measuredSlotSec: tickSec, minSlot, maxSlot, minTs, maxTs } };
}
