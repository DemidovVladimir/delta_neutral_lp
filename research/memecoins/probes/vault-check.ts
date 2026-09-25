// Probe: is PumpSwap event pool_quote_token_reserves the REAL vault balance? Compare the DB's last post-trade
// r_quote for quiet pools with the live quote-vault token balance and Pool.virtual_quote_reserves.
import Database from 'better-sqlite3';
import bs58 from 'bs58';
import { rpcCall } from '../collector/rpc.ts';
const u = 'https://api.mainnet-beta.solana.com';
const db = new Database('data/memecoins.db', { readonly: true });
const rows = db.prepare(`SELECT k.pubkey AS pool, max(t.slot) AS s, count(*) AS n FROM trades t JOIN keys k ON k.id = t.pool_id
  WHERE t.venue = 1 AND t.virt_quote > 0 GROUP BY t.pool_id HAVING n BETWEEN 3 AND 40 ORDER BY s LIMIT 4`).all() as any[];
for (const r of rows) {
  const last = db.prepare(`SELECT r_quote, v_quote, virt_quote, slot FROM trades WHERE pool_id = (SELECT id FROM keys WHERE pubkey = ?) ORDER BY slot DESC, tx_index DESC, idx DESC LIMIT 1`).get(r.pool) as any;
  const a: any = await rpcCall(u, 'getAccountInfo', [r.pool, { encoding: 'base64', commitment: 'confirmed' }]);
  const b = Buffer.from(a.value.data[0], 'base64');
  const qta = bs58.encode(b.subarray(171, 203));
  const bal: any = await rpcCall(u, 'getTokenAccountBalance', [qta, { commitment: 'confirmed' }]);
  const off = 8 + 1 + 2 + 32 * 7 + 8 + 32 + 1 + 1; // virtual_quote_reserves (i128) after lp_supply, coin_creator, is_mayhem, is_cashback
  const vq = b.readBigUInt64LE(off);
  console.log(JSON.stringify({ pool: r.pool, lastTradeSlot: last.slot, db_r_quote_post: last.r_quote, vault_now: bal.value.amount, vault_ctx_slot: bal.context.slot, db_virt: last.virt_quote, pool_virtual_quote_reserves: vq.toString() }));
}
