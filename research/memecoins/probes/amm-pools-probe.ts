// Probe: which PumpSwap pools carry the Buy/Sell event volume, and what are their base/quote mints?
import WebSocket from 'ws';
import bs58 from 'bs58';
import { decodeLogLine, PUMP_AMM_PROGRAM, PUMP_PROGRAM } from '../collector/decode.ts';
const SECS = Number(process.argv[2] || 40);
const pools = new Map<string, number>(); let pumpTrades = 0, ammTrades = 0, incomplete = 0; const pumpQuote = new Map<string, number>();
const sample: Record<string, any> = {};
for (const pid of [PUMP_PROGRAM, PUMP_AMM_PROGRAM]) {
  const ws = new WebSocket('wss://api.mainnet-beta.solana.com');
  ws.on('open', () => ws.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'logsSubscribe', params: [{ mentions: [pid] }, { commitment: 'confirmed' }] })));
  ws.on('message', (d) => {
    const j = JSON.parse(d.toString()); if (!j.params) return; const v = j.params.result.value; if (v.err) return;
    for (const l of v.logs) { const e = decodeLogLine(l); if (!e) continue; if (!e.complete) incomplete++;
      if (!sample[e.name]) sample[e.name] = { sig: v.signature, data: e.data };
      if (e.name === 'TradeEvent' && pid === PUMP_PROGRAM) { pumpTrades++; const q = e.data.quote_mint ?? 'none'; pumpQuote.set(q, (pumpQuote.get(q) || 0) + 1); }
      if ((e.name === 'BuyEvent' || e.name === 'SellEvent') && pid === PUMP_AMM_PROGRAM) { ammTrades++; pools.set(e.data.pool, (pools.get(e.data.pool) || 0) + 1); }
    }
  });
}
setTimeout(async () => {
  const top = [...pools.entries()].sort((a, b) => b[1] - a[1]);
  console.log(JSON.stringify({ pumpTrades, ammTrades, pools: pools.size, incomplete, pumpQuote: Object.fromEntries(pumpQuote) }));
  const head = top.slice(0, 15);
  const r = await fetch('https://api.mainnet-beta.solana.com', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getMultipleAccounts', params: [head.map(x => x[0]), { encoding: 'base64', dataSlice: { offset: 43, length: 64 } }] }) }).then(r => r.json());
  head.forEach(([p, n], i) => { const a = r.result?.value?.[i]; const b = a ? Buffer.from(a.data[0], 'base64') : null; console.log(p, n, (100 * n / ammTrades).toFixed(1) + '%', b ? bs58.encode(b.subarray(0, 32)) : '?', b ? bs58.encode(b.subarray(32, 64)) : '?'); });
  const cum = (k: number) => top.slice(0, k).reduce((s, x) => s + x[1], 0) / ammTrades;
  console.log('top10 share', cum(10).toFixed(3), 'top50', cum(50).toFixed(3), 'top200', cum(200).toFixed(3));
  const ser = (o: any) => JSON.stringify(o, (_, v) => typeof v === 'bigint' ? v.toString() : v);
  for (const k of ['TradeEvent', 'CreateEvent', 'BuyEvent']) if (sample[k]) console.log('SAMPLE', k, ser(sample[k]).slice(0, 2500));
  process.exit(0);
}, SECS * 1000);
