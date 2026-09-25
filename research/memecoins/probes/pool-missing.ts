// Which trades of a tracked pool's trade-level window are missing from the DB? (Helius gTFA, ~10-60 credits)
import Database from 'better-sqlite3';
import { extractTxEvents } from '../collector/decode.ts';
import { heliusUrl, rpcCall } from '../collector/rpc.ts';
const pool = process.argv[2];
const db = new Database('data/memecoins.db', { readonly: true });
const t = db.prepare('SELECT migrate_slot, logs_to_slot, registered_at FROM tracked_pools WHERE pool = ?').get(pool) as any;
const r: any = await rpcCall(heliusUrl()!, 'getTransactionsForAddress', [pool, { transactionDetails: 'full', sortOrder: 'asc', limit: 1000, encoding: 'json', maxSupportedTransactionVersion: 1, filters: { slot: { gte: t.migrate_slot, lte: t.logs_to_slot }, status: 'succeeded' } }]);
const have = new Set((db.prepare('SELECT sig FROM trades_v WHERE pool = ?').all(pool) as any[]).map(x => x.sig));
for (const tx of r.data) { const sig = tx.transaction.signatures[0]; const n = extractTxEvents(tx).events.filter(e => (e.name === 'BuyEvent' || e.name === 'SellEvent') && e.data.pool === pool).length;
  if (n && !have.has(sig)) console.log('MISSING slot', tx.slot, '(+' + (tx.slot - t.migrate_slot) + ' slots)', 'txIndex', tx.transactionIndex, sig); }
console.log('window', t.migrate_slot, t.logs_to_slot, 'registered_at', new Date(t.registered_at).toISOString());
