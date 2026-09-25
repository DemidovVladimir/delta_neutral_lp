// Probe: exact PumpSwap vault-delta semantics. Pull one pool's txs (Helius gTFA full, ~30-60 credits),
// order by (slot, transactionIndex, event idx), and test which event fields reproduce the next event's
// pre-trade pool_quote_token_reserves.
import { extractTxEvents } from '../collector/decode.ts';
import { CreditBudget, gtfaWindow, heliusUrl, rpcCall } from '../collector/rpc.ts';
const pool = process.argv[2] || 'Cnbn7RV3YwrCqFMPP1x8zPdMGrithjaVArSVdZ8hUWCM';
const helius = heliusUrl()!; const budget = new CreditBudget(150, 150);
const tip = await rpcCall<number>('https://api.mainnet-beta.solana.com', 'getSlot', [{ commitment: 'confirmed' }]);
const evs: any[] = [];
await gtfaWindow(helius, pool, tip - 400, tip - 100, budget, (txs) => {
  for (const tx of txs as any[]) { if (tx.meta?.err) continue; let i = 0;
    for (const e of extractTxEvents(tx).events) if (e.program === 'amm' && (e.name === 'BuyEvent' || e.name === 'SellEvent') && e.data.pool === pool) evs.push({ slot: tx.slot, ti: tx.transactionIndex, i: i++, name: e.name, d: e.data }); }
});
evs.sort((a, b) => a.slot - b.slot || a.ti - b.ti || a.i - b.i);
const c: Record<string, number> = {}; let n = 0;
const bump = (k: string, ok: boolean) => { if (ok) c[k] = (c[k] ?? 0) + 1; };
for (let k = 1; k < evs.length; k++) {
  const p = evs[k - 1].d, q = evs[k].d; const dq = BigInt(q.pool_quote_token_reserves) - BigInt(p.pool_quote_token_reserves); const db = BigInt(q.pool_base_token_reserves) - BigInt(p.pool_base_token_reserves);
  n++;
  if (evs[k - 1].name === 'BuyEvent') {
    bump('buy.base=-base_amount_out', db === -BigInt(p.base_amount_out));
    bump('buy.quote=+quote_amount_in', dq === BigInt(p.quote_amount_in));
    bump('buy.quote=+quote_amount_in_with_lp_fee', dq === BigInt(p.quote_amount_in_with_lp_fee));
    bump('buy.quote=+quote_amount_in+lp_fee', dq === BigInt(p.quote_amount_in) + BigInt(p.lp_fee));
    bump('buy.quote=+user_quote_amount_in', dq === BigInt(p.user_quote_amount_in));
    bump('buy.quote=+min(qin,user)+lp_fee', dq === (BigInt(p.quote_amount_in) < BigInt(p.user_quote_amount_in) ? BigInt(p.quote_amount_in) : BigInt(p.user_quote_amount_in)) + BigInt(p.lp_fee));
    c['buy.n'] = (c['buy.n'] ?? 0) + 1; if (p.ix_name === 'buy_exact_quote_in') c['buy.exact_quote_in.n'] = (c['buy.exact_quote_in.n'] ?? 0) + 1;
  } else {
    bump('sell.base=+base_amount_in', db === BigInt(p.base_amount_in));
    bump('sell.quote=-quote_amount_out', dq === -BigInt(p.quote_amount_out));
    bump('sell.quote=-quote_amount_out_without_lp_fee', dq === -BigInt(p.quote_amount_out_without_lp_fee));
    bump('sell.quote=-(quote_amount_out-lp_fee)', dq === -(BigInt(p.quote_amount_out) - BigInt(p.lp_fee)));
    c['sell.n'] = (c['sell.n'] ?? 0) + 1;
  }
}
console.log(JSON.stringify({ pool, events: evs.length, pairs: n, credits: budget.total, virtual_quote_reserves: evs[0]?.d.virtual_quote_reserves?.toString(), counts: c }, null, 1));
