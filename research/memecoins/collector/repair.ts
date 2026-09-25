/**
 * Repair rows whose tx_index is NULL (free public RPC, read-only on chain):
 *   - getTransaction(sig): null  -> the websocket reported a tx that never landed ("phantom"): delete its rows
 *   - found                      -> set the real slot and the tx position from getBlock(slot, signatures)
 * Safe to run while the collector is running.  node --import tsx repair.ts [--db=path] [--limit=5000]
 */
import Database from 'better-sqlite3';
import path from 'node:path';
import { rpcCall } from './rpc.ts';

const argv = process.argv.slice(2);
const opt = (n: string, d: string) => { const a = argv.find(x => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const DB = opt('db', path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'data', 'memecoins.db'));
const limit = Number(opt('limit', '5000'));
const URLS = ['https://solana-rpc.publicnode.com', 'https://api.mainnet-beta.solana.com'];
const db = new Database(DB); db.pragma('busy_timeout = 15000');
const sigs = db.prepare(`SELECT sig, min(slot) AS slot FROM (SELECT sig, slot FROM trades WHERE tx_index IS NULL UNION ALL SELECT sig, slot FROM events WHERE tx_index IS NULL)
  GROUP BY sig ORDER BY slot LIMIT ?`).all(limit) as { sig: string; slot: number }[];
console.log(`${sigs.length} transactions with NULL tx_index`);
const blocks = new Map<number, Map<string, number>>();
async function call<T>(method: string, params: unknown[]): Promise<T> {
  let last: unknown;
  for (const u of URLS) { try { return await rpcCall<T>(u, method, params, 20_000); } catch (e) { last = e; } }
  throw last;
}
let dropped = 0, fixed = 0, unknown = 0; const droppedSigs: string[] = [];
for (const { sig } of sigs) {
  let tx: any;
  try { tx = await call<any>('getTransaction', [sig, { encoding: 'json', maxSupportedTransactionVersion: 1, commitment: 'confirmed' }]); }
  catch { unknown++; continue; }
  if (!tx) {
    db.transaction(() => { db.prepare('DELETE FROM trades WHERE sig = ?').run(sig); db.prepare('DELETE FROM events WHERE sig = ?').run(sig); }).immediate();
    dropped++; if (droppedSigs.length < 10) droppedSigs.push(sig); continue;
  }
  let map = blocks.get(tx.slot);
  if (!map) {
    try {
      const b = await call<{ signatures: string[] }>('getBlock', [tx.slot, { encoding: 'json', transactionDetails: 'signatures', rewards: false, maxSupportedTransactionVersion: 1, commitment: 'confirmed' }]);
      map = new Map(b.signatures.map((s, i) => [s, i])); blocks.set(tx.slot, map);
      if (blocks.size > 50) blocks.delete(blocks.keys().next().value!);
    } catch { unknown++; continue; }
  }
  const idx = map.get(sig) ?? null;
  db.transaction(() => {
    db.prepare('UPDATE trades SET slot = ?, tx_index = ? WHERE sig = ?').run(tx.slot, idx, sig);
    db.prepare('UPDATE events SET slot = ?, tx_index = ? WHERE sig = ?').run(tx.slot, idx, sig);
  }).immediate();
  fixed++;
  await new Promise(r => setTimeout(r, 150));
}
console.log('REPAIR ' + JSON.stringify({ checked: sigs.length, fixed, droppedNeverLanded: dropped, unknown, droppedExamples: droppedSigs }));
