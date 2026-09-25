// Probe: list a mint's successful txs in a slot window (Helius gTFA signatures, 10 credits) vs DB trade sigs.
import Database from 'better-sqlite3';
import { heliusUrl, rpcCall } from '../collector/rpc.ts';
const [mint, a, b] = process.argv.slice(2); const lo = Number(a), hi = Number(b);
const g: any = await rpcCall(heliusUrl()!, 'getTransactionsForAddress', [mint, { transactionDetails: 'signatures', sortOrder: 'asc', limit: 1000, filters: { slot: { gte: lo, lte: hi }, status: 'succeeded' } }]);
const db = new Database('data/memecoins.db', { readonly: true });
const have = new Set((db.prepare('SELECT DISTINCT sig FROM trades_v WHERE mint = ? AND slot BETWEEN ? AND ?').all(mint, lo, hi) as any[]).map(r => r.sig));
for (const r of g.data) console.log(r.slot, r.transactionIndex, have.has(r.signature) ? 'IN_DB ' : 'MISSING', r.signature);
