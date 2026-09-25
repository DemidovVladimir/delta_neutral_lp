/**
 * Reserve-chain engine (protocol gate G1) and per-coin intra-slot order.
 *
 * Every pump.fun TradeEvent and (normalized) PumpSwap Buy/SellEvent carries post-trade REAL reserves; the
 * pre-trade reserves follow exactly from the trade amounts. Within one coin (bonding curve) or pool, trade i's
 * pre-trade reserves must equal trade i-1's post-trade reserves. This module
 *   - orders each coin's trades inside a slot by solving that chain greedily -> `trades.seq` (0,1,2,... per
 *     coin and slot), which replaces the costly block-position fetch (tx_index) for per-coin ordering;
 *   - reports breaks: a break = a missed trade, a phantom row (tx that never landed) or a non-trade vault
 *     change (PumpSwap deposit/withdraw).
 * Only SOL-quoted rows with real reserves participate (non-SOL pairs and reversed pools are skipped).
 */
import type Database from 'better-sqlite3';

export interface ChainRow {
  rowid: number; sig: string; slot: number; venue: number; part: number; mint_id: number | null; pool_id: number | null;
  is_buy: number; quote_amount: number; token_amount: number; r_quote: number; r_token: number; fee_lp: number | null; seq: number | null;
}
export interface Break { venue: number; part: number; prev: ChainRow; row: ChainRow }

const pre = (r: ChainRow): [number, number] => {
  const q = r.venue === 0 ? r.quote_amount : r.quote_amount + (r.is_buy ? 1 : -1) * (r.fee_lp ?? 0);
  return r.is_buy ? [r.r_quote - q, r.r_token + r.token_amount] : [r.r_quote + q, r.r_token - r.token_amount];
};

export function loadChainRows(db: Database.Database, lo: number, hi: number, venue: number | null = null): ChainRow[] {
  return db.prepare(`SELECT rowid, sig, slot, venue, coalesce(pool_id, mint_id) AS part, mint_id, pool_id, is_buy, quote_amount, token_amount,
      r_quote, r_token, fee_lp, seq
    FROM trades WHERE slot BETWEEN ? AND ? AND quote_mint_id IS NULL AND user_quote IS NOT NULL AND r_quote IS NOT NULL ${venue === null ? '' : 'AND venue = ' + Number(venue)}
    ORDER BY venue, part, slot, coalesce(tx_index, 1000000000), rowid`).all(lo, hi) as ChainRow[];
}

/** Solve per-coin intra-slot order; returns seq assignments and chain breaks. Rows must be sorted by (venue, part, slot, rowid). */
export function solve(rows: ChainRow[]): { seq: Map<number, number>; breaks: Break[]; pairs: number; parts: number } {
  const seq = new Map<number, number>(); const breaks: Break[] = []; let pairs = 0; const partsSeen = new Set<string>();
  let i = 0;
  while (i < rows.length) {
    const venue = rows[i].venue, part = rows[i].part; partsSeen.add(`${venue}:${part}`);
    let j = i; while (j < rows.length && rows[j].venue === venue && rows[j].part === part) j++;
    let state: [number, number] | null = null; let prev: ChainRow | null = null;
    let k = i;
    while (k < j) {
      const slot = rows[k].slot; let e = k; while (e < j && rows[e].slot === slot) e++;
      const left = rows.slice(k, e); let n = 0;
      while (left.length) {
        let pick = -1;
        if (state) for (let x = 0; x < left.length; x++) { const p = pre(left[x]); if (p[0] === state[0] && p[1] === state[1]) { pick = x; break; } }
        const r = left.splice(pick >= 0 ? pick : 0, 1)[0];
        if (state && prev) { pairs++; if (pick < 0) breaks.push({ venue, part, prev, row: r }); }
        seq.set(r.rowid, n++); state = [r.r_quote, r.r_token]; prev = r;
      }
      k = e;
    }
    i = j;
  }
  return { seq, breaks, pairs, parts: partsSeen.size };
}

export function writeSeq(db: Database.Database, seq: Map<number, number>, rows: ChainRow[]) {
  const up = db.prepare('UPDATE trades SET seq = ? WHERE rowid = ?');
  const byId = new Map(rows.map(r => [r.rowid, r.seq]));
  db.transaction(() => { for (const [rowid, s] of seq) if (byId.get(rowid) !== s) up.run(s, rowid); }).immediate();
}
