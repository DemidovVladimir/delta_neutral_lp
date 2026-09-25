/**
 * Adapter: van de Wouw pump.fun dataset (Zenodo 10.5281/zenodo.22306254, CC-BY-4.0).
 * One SQLite file `pumpfun_database.db` (23,971,725,312 bytes, md5 e7ff0d1edfe604331388ad423af4856c).
 *
 * Tape facts (verified on the file):
 *   trades(id, mint, signature UNIQUE, trader, is_buy, sol_amount REAL [SOL], token_amount REAL [raw],
 *          vsol_after REAL [SOL], price_per_token, slot [always 0], block_time [unix s], ...)
 *   tokens(mint, name, symbol, creator, created_at, vsol_start, vsol_peak, graduated, graduation_ts, ...)
 *   - no vToken, no real reserves, no fee fields, no slot, no in-block index
 *   - one row per signature: a transaction with several trade events keeps only one
 *   - bonding curve only (no PumpSwap trades)
 * So the clock is block_time seconds (tickSec = 1) and intra-second order comes from the reserve chain.
 *
 * Streaming conversion (low memory): rows are read in (mint, block_time, id) order through the DB's own
 * index idx_trades_mint_time_id and written column by column.
 *
 *   node --max-old-space-size=6000 --import tsx research/memecoins/backtest/adapters/vdw.ts \
 *     --db=research/memecoins/data/public/pumpfun_database.db --out=research/memecoins/data/public/cache/vdw
 */
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { buildChain, type RawRow } from '../chain.ts';
import type { MintMeta } from '../tape.ts';

export const MAYHEM_AGENT = 'BwWK17cbHxwWBKZkUYvzxLcNQ1YVyaFezduWbtm2de6s';

function arg(name: string, def?: string) {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : def;
}

class ColWriter {
  private buf: Int32Array | Uint8Array | Float64Array;
  private n = 0;
  private fd: number;
  constructor(file: string, private ty: 'i32' | 'u8' | 'f64') {
    this.fd = fs.openSync(file, 'w');
    const N = 1 << 20;
    this.buf = ty === 'i32' ? new Int32Array(N) : ty === 'u8' ? new Uint8Array(N) : new Float64Array(N);
  }
  push(v: number) { this.buf[this.n++] = v; if (this.n === this.buf.length) this.flush(); }
  flush() { if (this.n) { const b = this.buf.subarray(0, this.n); fs.writeSync(this.fd, Buffer.from(b.buffer, b.byteOffset, b.byteLength)); this.n = 0; } }
  close() { this.flush(); fs.closeSync(this.fd); void this.ty; }
}

export function convertVdw(dbPath: string, outDir: string) {
  const t0 = Date.now();
  fs.mkdirSync(outDir, { recursive: true });
  // The file is in WAL mode (header bytes 18-19 = 2) with no -wal present, so a read-only open cannot start.
  // Open our own downloaded copy normally (SQLite creates an empty -wal/-shm) and forbid writes.
  const db = new Database(dbPath, { fileMustExist: true });
  db.pragma('query_only = 1');
  const plan = db.prepare('EXPLAIN QUERY PLAN SELECT mint, id FROM trades ORDER BY mint, block_time, id').all();
  console.log('query plan:', JSON.stringify(plan));
  const tokens = db.prepare('SELECT mint, name, symbol, creator, created_at, vsol_start FROM tokens').all() as {
    mint: string; name: string | null; symbol: string | null; creator: string | null; created_at: number; vsol_start: number | null;
  }[];
  const tokByMint = new Map(tokens.map((t) => [t.mint, t]));
  let minCreated = Infinity; for (const t of tokens) if (t.created_at > 1e9 && t.created_at < minCreated) minCreated = t.created_at;
  const epoch = Math.floor(minCreated / 86_400) * 86_400 - 86_400;
  console.log(`tokens: ${tokens.length}; epoch ${new Date(epoch * 1000).toISOString()}`);

  const W = {
    tick: new ColWriter(path.join(outDir, 'tick.bin'), 'i32'), isBuy: new ColWriter(path.join(outDir, 'isBuy.bin'), 'u8'),
    sol: new ColWriter(path.join(outDir, 'sol.bin'), 'f64'), tok: new ColWriter(path.join(outDir, 'tok.bin'), 'f64'),
    vSol: new ColWriter(path.join(outDir, 'vSol.bin'), 'f64'), vTok: new ColWriter(path.join(outDir, 'vTok.bin'), 'f64'),
    gap: new ColWriter(path.join(outDir, 'gap.bin'), 'f64'), trader: new ColWriter(path.join(outDir, 'trader.bin'), 'i32'),
  };
  const off: number[] = [];
  const meta: MintMeta[] = [];
  const traderIdx = new Map<string, number>(); const traders: string[] = [];
  const seenMint = new Set<string>();
  let w = 0, nRows = 0, nullV = 0, slotNonZero = 0, minBt = Infinity, maxBt = -Infinity;
  const stat = { mintsWithTrades: 0, chainFromStart: 0, g1Strict: 0, mayhem: 0, complete: 0, completeFromStart: 0, gapsTotal: 0, creatorFirst: 0, tradesInG1Strict: 0, tradesInFromStart: 0 };

  const flush = (mint: string, rows: RawRow[]) => {
    seenMint.add(mint);
    const ti = tokByMint.get(mint);
    const creator = ti?.creator ?? '';
    const creatorId = traderIdx.get(creator) ?? -1;
    const mayhemId = traderIdx.get(MAYHEM_AGENT) ?? -2;
    let mayhem = !!ti && ti.vsol_start !== null && Math.abs(ti.vsol_start - 30) > 1e-9;
    const ch = buildChain(rows);
    off.push(w);
    for (let p = 0; p < ch.order.length; p++) {
      const r = rows[ch.order[p]];
      W.tick.push(r.tick); W.isBuy.push(r.isBuy ? 1 : 0); W.sol.push(r.sol); W.tok.push(r.tok);
      W.vSol.push(r.vSolPost); W.vTok.push(ch.vTok[p]); W.gap.push(ch.gap[p]); W.trader.push(r.trader);
      if (r.trader === mayhemId) mayhem = true;
    }
    const f = rows[ch.order[0]];
    let t0 = ti ? Math.floor(ti.created_at) - epoch : f.tick, t0Exact = false, creatorBuy = 0;
    if (ch.chainFromStart && f.trader === creatorId && f.isBuy) { t0 = f.tick; t0Exact = true; creatorBuy = f.sol; stat.creatorFirst++; }
    else if (t0 > f.tick) t0 = f.tick;
    const g1Strict = ch.chainFromStart && ch.gaps === 0;
    stat.mintsWithTrades++;
    if (ch.chainFromStart) { stat.chainFromStart++; stat.tradesInFromStart += rows.length; }
    if (g1Strict) { stat.g1Strict++; stat.tradesInG1Strict += rows.length; }
    if (mayhem) stat.mayhem++;
    if (ch.completePos >= 0) { stat.complete++; if (ch.chainFromStart) stat.completeFromStart++; }
    stat.gapsTotal += ch.gaps;
    meta.push({
      mint, creator, name: ti?.name ?? '', symbol: ti?.symbol ?? '', createdAt: ti?.created_at ?? 0, t0, t0Exact,
      creatorBuyLamports: creatorBuy, chainFromStart: ch.chainFromStart, g1Strict, gaps: ch.gaps, gapAbsLamports: ch.gapAbs,
      mayhem, completeIdx: ch.completePos >= 0 ? w + ch.completePos : -1,
    });
    w += ch.order.length;
  };

  const it = db.prepare('SELECT mint, id, trader, is_buy, sol_amount, token_amount, vsol_after, block_time, slot FROM trades ORDER BY mint, block_time, id').raw().iterate() as IterableIterator<[string, number, string, number, number, number, number | null, number, number | null]>;
  let cur: string | null = null; let rows: RawRow[] = [];
  for (const [mint, id, trader, isBuy, sol, tok, vsol, bt, slot] of it) {
    nRows++;
    if (vsol === null) { nullV++; continue; }
    if (slot) slotNonZero++;
    if (mint !== cur) { if (cur !== null && rows.length) flush(cur, rows); cur = mint; rows = []; }
    let ti = traderIdx.get(trader); if (ti === undefined) { ti = traders.length; traderIdx.set(trader, ti); traders.push(trader); }
    const tick = Math.floor(bt) - epoch;
    rows.push({ tick, ord: id, isBuy: isBuy === 1, sol: Math.round(sol * 1e9), tok: Math.round(tok), vSolPost: Math.round(vsol * 1e9), trader: ti });
    if (bt < minBt) minBt = bt; if (bt > maxBt) maxBt = bt;
    if (nRows % 2_000_000 === 0) console.log(`  ${nRows} rows, ${meta.length} mints (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  }
  if (cur !== null && rows.length) flush(cur, rows);
  db.close();
  // tokens that never traded on the tape
  for (const t of tokens) if (!seenMint.has(t.mint)) {
    off.push(w);
    meta.push({ mint: t.mint, creator: t.creator ?? '', name: t.name ?? '', symbol: t.symbol ?? '', createdAt: t.created_at, t0: Math.floor(t.created_at) - epoch, t0Exact: false, creatorBuyLamports: 0, chainFromStart: false, g1Strict: false, gaps: 0, gapAbsLamports: 0, mayhem: t.vsol_start !== null && Math.abs(t.vsol_start - 30) > 1e-9, completeIdx: -1 });
  }
  off.push(w);
  for (const c of Object.values(W)) c.close();
  fs.writeFileSync(path.join(outDir, 'off.bin'), Buffer.from(Int32Array.from(off).buffer));
  fs.writeFileSync(path.join(outDir, 'meta.json'), JSON.stringify({ source: 'vdw', tickSec: 1, epoch, meta }));
  fs.writeFileSync(path.join(outDir, 'traders.txt'), traders.join('\n'));
  const summary = { ...stat, tokens: tokens.length, mintsTotal: meta.length, rowsRead: nRows, tradesWritten: w, traders: traders.length, epoch, minBt, maxBt, nullVsol: nullV, slotNonZero, seconds: (Date.now() - t0) / 1000 };
  fs.writeFileSync(path.join(outDir, 'convert-summary.json'), JSON.stringify(summary, null, 2));
  console.log(summary);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  convertVdw(arg('db', 'research/memecoins/data/public/pumpfun_database.db')!, arg('out', 'research/memecoins/data/public/cache/vdw')!);
}
