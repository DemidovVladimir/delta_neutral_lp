/**
 * Coverage report of a backfill job: contiguous covered slot ranges (merged done chunks, plus the live collector
 * from its first slot), their UTC times, full UTC days covered, credits, rows, gaps.
 *   node --import tsx backfill-report.ts [--job=pump7d]
 * UTC day boundaries come from data/day-boundaries.json (first pump-program tx at each midnight, via Helius).
 */
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const opt = (n: string, d: string) => { const a = argv.find(x => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const DATA = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'data');
const JOB = opt('job', 'pump7d');
const db = new Database(path.join(DATA, 'memecoins.db'), { readonly: true });
const days: Record<string, { slot: number }> = JSON.parse(fs.readFileSync(path.join(DATA, 'day-boundaries.json'), 'utf8'));
const job = db.prepare('SELECT * FROM backfill_jobs WHERE name = ?').get(JOB) as any;
const chunks = db.prepare(`SELECT from_slot, to_slot, status, credits, txs, trades FROM backfill_chunks WHERE job = ? ORDER BY from_slot`).all(JOB) as any[];
const firstLive = (db.prepare('SELECT min(slot) AS s FROM trades WHERE source = 0').get() as any).s as number;

// merged covered ranges: done chunks, plus [firstLive, +inf) from the live collector
const ranges: [number, number][] = [];
for (const c of chunks.filter(c => c.status === 'done')) {
  const last = ranges[ranges.length - 1];
  if (last && c.from_slot <= last[1] + 1) last[1] = Math.max(last[1], c.to_slot); else ranges.push([c.from_slot, c.to_slot]);
}
const lastLive = (db.prepare('SELECT max(slot) AS s FROM trades WHERE source = 0').get() as any).s as number;
const last = ranges[ranges.length - 1];
if (last && last[1] + 1 >= firstLive) last[1] = Math.max(last[1], lastLive); else ranges.push([firstLive, lastLive]);

// slot -> approximate UTC time by linear interpolation between known midnights (error ≲ 1 min)
const pts = Object.entries(days).map(([d, v]) => [v.slot, Date.parse(`${d}T00:00:00Z`)] as [number, number]).sort((a, b) => a[0] - b[0]);
const lastTrade = db.prepare('SELECT max(slot) AS s, max(ts) AS t FROM trades WHERE source = 0').get() as any;
pts.push([lastTrade.s, lastTrade.t * 1000]);
function timeOf(slot: number): string {
  if (!Number.isFinite(slot)) return 'live (now)';
  for (let i = 1; i < pts.length; i++) if (slot <= pts[i][0] || i === pts.length - 1) {
    const [s0, t0] = pts[i - 1], [s1, t1] = pts[i];
    return new Date(t0 + (slot - s0) * (t1 - t0) / (s1 - s0)).toISOString().slice(0, 19) + 'Z';
  }
  return '?';
}
const covered = (a: number, b: number) => ranges.some(([x, y]) => x <= a && b <= y);
const dayNames = Object.keys(days).sort();
const fullDays: string[] = [], partial: string[] = [];
for (let i = 0; i + 1 < dayNames.length; i++) {
  const a = days[dayNames[i]].slot, b = days[dayNames[i + 1]].slot - 1;
  if (covered(a, b)) fullDays.push(dayNames[i]);
  else {
    const cov = ranges.reduce((s, [x, y]) => s + Math.max(0, Math.min(b, y) - Math.max(a, x) + 1), 0);
    if (cov > 0) partial.push(`${dayNames[i]} (${(100 * cov / (b - a + 1)).toFixed(1)} %)`);
  }
}
const byStatus: Record<string, number> = {}; for (const c of chunks) byStatus[c.status] = (byStatus[c.status] ?? 0) + 1;
const gaps = db.prepare(`SELECT from_slot, to_slot, reason FROM gaps WHERE stream = ?`).all(`backfill:${JOB}`) as any[];
const rows = db.prepare(`SELECT count(*) AS n FROM trades WHERE source = 2 AND venue = 0 AND slot < ?`).get(firstLive) as any;
const creates = db.prepare(`SELECT count(*) AS n FROM tokens WHERE seen_logs = 1 AND created_slot < ?`).get(firstLive) as any;
const migr = db.prepare(`SELECT count(*) AS n FROM migrations WHERE kind = 'migrate' AND slot < ?`).get(firstLive) as any;
console.log(JSON.stringify({
  job: { status: job.status, credits: job.credits, cap: job.max_credits, txs: job.txs, curveTrades: job.trades, wireGB: +(job.wire_bytes / 1e9).toFixed(2), rawGB: +(job.raw_bytes / 1e9).toFixed(2) },
  chunks: byStatus,
  liveCollector: { fromSlot: firstLive, toSlot: lastLive, from: timeOf(firstLive), to: timeOf(lastLive) },
  coveredRanges: ranges.map(([a, b]) => ({ fromSlot: a, toSlot: b, from: timeOf(a), to: timeOf(b), slots: b - a + 1 })),
  fullUtcDaysCovered: fullDays, partialDays: partial,
  backfillRows: { curveTradesBeforeLive: rows.n, createsBeforeLive: creates.n, migrationsBeforeLive: migr.n },
  errorChunkGaps: gaps,
  dbFileGB: +((fs.statSync(path.join(DATA, 'memecoins.db')).size) / 1e9).toFixed(2),
}, null, 1));
