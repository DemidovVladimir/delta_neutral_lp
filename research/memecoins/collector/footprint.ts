/**
 * Disk footprint of the LIVE collector since a point in time, isolated from backfill rows that share the DB:
 * live rows added per table x measured bytes/row (dbstat: table + its indexes).
 *   node --import tsx footprint.ts --since=<unix ms> [--db=path]
 */
import Database from 'better-sqlite3';
import path from 'node:path';

const argv = process.argv.slice(2);
const opt = (n: string, d: string) => { const a = argv.find(x => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const DB = opt('db', path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'data', 'memecoins.db'));
const since = Number(opt('since', String(Date.now() - 3600_000)));
const db = new Database(DB, { readonly: true });
const hours = (Date.now() - since) / 3.6e6;
// slot at `since`: first heartbeat after it knows the pump stream slot
const hb = db.prepare('SELECT stats FROM heartbeats WHERE at >= ? ORDER BY at LIMIT 1').get(since) as { stats: string } | undefined;
const slot0 = hb ? (JSON.parse(hb.stats).streams?.pump?.lastSlot ?? 0) - 250 : 0;
const size = (names: string[]) => {
  const r = db.prepare(`SELECT sum(pgsize) AS b FROM dbstat WHERE name IN (${names.map(() => '?').join(',')})`).get(...names) as { b: number };
  return r.b ?? 0;
};
const idx = (table: string) => (db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = ?").all(table) as { name: string }[]).map(r => r.name);
const tables: Record<string, { liveRows: number; totalRows: number }> = {
  trades: { liveRows: (db.prepare('SELECT count(*) AS n FROM trades WHERE slot >= ?').get(slot0) as any).n, totalRows: (db.prepare('SELECT count(*) AS n FROM trades').get() as any).n },
  events: { liveRows: (db.prepare('SELECT count(*) AS n FROM events WHERE slot >= ?').get(slot0) as any).n, totalRows: (db.prepare('SELECT count(*) AS n FROM events').get() as any).n },
  pool_states: { liveRows: (db.prepare('SELECT count(*) AS n FROM pool_states WHERE slot >= ?').get(slot0) as any).n, totalRows: (db.prepare('SELECT count(*) AS n FROM pool_states').get() as any).n },
  token_meta: { liveRows: (db.prepare('SELECT count(*) AS n FROM token_meta WHERE fetched_at >= ?').get(since) as any).n, totalRows: (db.prepare('SELECT count(*) AS n FROM token_meta').get() as any).n },
  tokens: { liveRows: (db.prepare('SELECT count(*) AS n FROM tokens WHERE first_seen_at >= ?').get(since) as any).n, totalRows: (db.prepare('SELECT count(*) AS n FROM tokens').get() as any).n },
  heartbeats: { liveRows: (db.prepare('SELECT count(*) AS n FROM heartbeats WHERE at >= ?').get(since) as any).n, totalRows: (db.prepare('SELECT count(*) AS n FROM heartbeats').get() as any).n },
};
// keys first referenced by rows in the window (backfill rows have older slots, so a wallet already seen by the
// backfill does not count as new — as in the eventual full dataset)
const keysNew = (db.prepare(`SELECT count(*) AS n FROM (SELECT trader_id, min(slot) AS m FROM trades GROUP BY trader_id) WHERE m >= ?`).get(slot0) as any).n;
const out: any = { hours: +hours.toFixed(2), fromSlot: slot0, tables: {} };
let totalBytes = 0;
for (const [t, v] of Object.entries(tables)) {
  const bytes = size([t, ...idx(t), `sqlite_autoindex_${t}_1`]);
  const perRow = v.totalRows ? bytes / v.totalRows : 0;
  const liveBytes = perRow * v.liveRows; totalBytes += liveBytes;
  out.tables[t] = { liveRowsPerHour: Math.round(v.liveRows / hours), bytesPerRow: Math.round(perRow), MBperHour: +(liveBytes / 1e6 / hours).toFixed(2) };
}
const keyBytes = size(['keys', 'sqlite_autoindex_keys_1']) / Math.max(1, (db.prepare('SELECT count(*) AS n FROM keys').get() as any).n);
totalBytes += keysNew * keyBytes;
out.tables.keys = { newKeysPerHour: Math.round(keysNew / hours), bytesPerRow: Math.round(keyBytes), MBperHour: +(keysNew * keyBytes / 1e6 / hours).toFixed(2) };
out.totalMBperHour = +(totalBytes / 1e6 / hours).toFixed(1);
out.totalGBperDay = +(totalBytes / 1e9 / hours * 24).toFixed(2);
console.log(JSON.stringify(out, null, 1));
