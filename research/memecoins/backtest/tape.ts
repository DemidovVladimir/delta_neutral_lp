/**
 * Canonical columnar tape shared by every data adapter (public tapes, our collector).
 *
 * Trades are stored globally, grouped by mint (off[m] .. off[m+1]-1), in EXECUTION order
 * (rebuilt from the reserve chain, PROTOCOL G4). Money is in lamports, tokens in raw base
 * units (6 dp), as float64 holding integers (< 2^53).
 *
 * Clock: `tick` is an integer clock with resolution `tickSec` seconds.
 *   - our collector: slots (tickSec = 0.4)
 *   - van de Wouw tape: block_time seconds (tickSec = 1), because its slot column is empty.
 */
import fs from 'node:fs';
import path from 'node:path';

export interface MintMeta {
  mint: string;
  creator: string;
  name: string;
  symbol: string;
  createdAt: number;     // source creation time (unix s), informational
  t0: number;            // creation tick (exact when t0Exact)
  t0Exact: boolean;      // t0 taken from the creator's create-tx buy (chain starts at the initial state)
  creatorBuyLamports: number; // creator's buy inside the create tx (0 = none observed)
  chainFromStart: boolean;    // first observed trade starts from vSol = 30 SOL
  g1Strict: boolean;          // continuous chain from the initial state through the last trade
  gaps: number;               // number of chain breaks
  gapAbsLamports: number;     // sum |unobserved net flow|
  mayhem: boolean;
  completeIdx: number;        // global index of the trade that completed the curve, -1 if none
}

export interface Tape {
  source: string;
  tickSec: number;
  epoch: number;         // unix seconds of tick 0 (for UTC-day bucketing): unix = epoch + tick*tickSec
  meta: MintMeta[];
  off: Int32Array;       // length nMints+1
  tick: Int32Array;
  isBuy: Uint8Array;
  sol: Float64Array;     // curve SOL amount (excl. fees), lamports
  tok: Float64Array;     // token amount, raw units
  vSol: Float64Array;    // virtual SOL AFTER the trade, lamports (exact from the event)
  vTok: Float64Array;    // virtual tokens AFTER the trade, raw units (chain / K-derived)
  gap: Float64Array;     // unobserved net SOL flow just before this trade (0 = chain continuous)
  trader: Int32Array;    // index into traders[]
  traders: string[];
  /** optional piecewise-linear tick -> unix mapping (slot clocks: real slot time drifts around its mean) */
  anchors?: { tick: Float64Array; unix: Float64Array };
}

export const nTrades = (t: Tape) => t.tick.length;
export function unixOf(t: Tape, tick: number): number {
  const a = t.anchors;
  if (!a || a.tick.length < 2) return t.epoch + tick * t.tickSec;
  const n = a.tick.length;
  if (tick <= a.tick[0]) return a.unix[0] + (tick - a.tick[0]) * t.tickSec;
  if (tick >= a.tick[n - 1]) return a.unix[n - 1] + (tick - a.tick[n - 1]) * t.tickSec;
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (a.tick[mid] <= tick) lo = mid; else hi = mid; }
  return a.unix[lo] + ((tick - a.tick[lo]) * (a.unix[hi] - a.unix[lo])) / (a.tick[hi] - a.tick[lo]);
}
export const dayOf = (t: Tape, tick: number) => Math.floor(unixOf(t, tick) / 86_400);
export const dayStr = (day: number) => new Date(day * 86_400_000).toISOString().slice(0, 10);

const COLS: [keyof Tape, 'i32' | 'u8' | 'f64'][] = [
  ['off', 'i32'], ['tick', 'i32'], ['isBuy', 'u8'], ['sol', 'f64'], ['tok', 'f64'],
  ['vSol', 'f64'], ['vTok', 'f64'], ['gap', 'f64'], ['trader', 'i32'],
];

export function saveTape(dir: string, t: Tape) {
  fs.mkdirSync(dir, { recursive: true });
  for (const [k] of COLS) {
    const a = t[k] as unknown as ArrayBufferView;
    fs.writeFileSync(path.join(dir, `${String(k)}.bin`), Buffer.from(a.buffer, a.byteOffset, a.byteLength));
  }
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ source: t.source, tickSec: t.tickSec, epoch: t.epoch, meta: t.meta }));
  fs.writeFileSync(path.join(dir, 'traders.txt'), t.traders.join('\n'));
}

export function loadTape(dir: string): Tape {
  const j = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
  const out: Record<string, unknown> = { source: j.source, tickSec: j.tickSec, epoch: j.epoch, meta: j.meta };
  for (const [k, ty] of COLS) {
    const b = fs.readFileSync(path.join(dir, `${String(k)}.bin`));
    const aligned = b.byteOffset % 8 === 0;
    const ab = aligned ? b.buffer : b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
    const o = aligned ? b.byteOffset : 0;
    out[k] = ty === 'i32' ? new Int32Array(ab, o, b.byteLength / 4) : ty === 'u8' ? new Uint8Array(ab, o, b.byteLength) : new Float64Array(ab, o, b.byteLength / 8);
  }
  out.traders = fs.readFileSync(path.join(dir, 'traders.txt'), 'utf8').split('\n');
  return out as unknown as Tape;
}

/** Last index i in [lo, hi) with tick[i] <= x, or lo-1 if none. */
export function lastAtOrBefore(tick: Int32Array, lo: number, hi: number, x: number): number {
  let a = lo, b = hi; // find first index with tick > x
  while (a < b) { const m = (a + b) >>> 1; if (tick[m] <= x) a = m + 1; else b = m; }
  return a - 1;
}
