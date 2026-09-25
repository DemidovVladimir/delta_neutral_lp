// Probe: cheapest Helius query for one graduated pool's first minute of trades.
// Compare gTFA on (a) pool address, (b) quote vault address, (c) quote vault + tokenTransfer filter, (d) mint address.
import Database from 'better-sqlite3';
import { extractTxEvents } from '../collector/decode.ts';
import { heliusUrl, rpcCall } from '../collector/rpc.ts';
const h = heliusUrl()!;
const db = new Database('data/memecoins.db', { readonly: true });
const p = db.prepare("SELECT pool, mint, quote_vault, migrate_slot FROM tracked_pools WHERE quote_vault IS NOT NULL AND logs_status NOT LIKE 'pre-v3%' ORDER BY registered_at DESC LIMIT 1 OFFSET 1").get() as any;
const from = p.migrate_slot, to = p.migrate_slot + 225;
const run = async (label: string, address: string, extra: any = {}) => {
  let token: string | null = null, txs = 0, trades = 0, credits = 0, pages = 0;
  do {
    const cfg: any = { transactionDetails: 'full', sortOrder: 'asc', limit: 1000, encoding: 'json', maxSupportedTransactionVersion: 1, filters: { slot: { gte: from, lte: to }, status: 'succeeded', ...extra } };
    if (token) cfg.paginationToken = token;
    const r: any = await rpcCall(h, 'getTransactionsForAddress', [address, cfg], 120_000);
    pages++; txs += r.data.length; credits += Math.max(10, Math.ceil(r.data.length / 100) * 10);
    for (const tx of r.data) for (const e of extractTxEvents(tx).events) if ((e.name === 'BuyEvent' || e.name === 'SellEvent') && e.data.pool === p.pool) trades++;
    token = r.data.length < 1000 ? null : r.paginationToken;
  } while (token && pages < 5);
  console.log(JSON.stringify({ label, address, txs, poolTrades: trades, credits }));
};
console.log('pool', p.pool, 'mint', p.mint, 'window', from, to);
await run('pool', p.pool);
await run('quoteVault', p.quote_vault);
await run('quoteVault+tokenTransfer', p.quote_vault, { tokenTransfer: {} });
await run('mint', p.mint);
