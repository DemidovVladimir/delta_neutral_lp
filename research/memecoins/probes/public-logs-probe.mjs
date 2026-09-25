// Probe: free public websocket endpoints for logsSubscribe (pump + PumpSwap).
import WebSocket from 'ws';
const SECS = Number(process.argv[2] || 45);
const url = process.argv[3] || 'wss://api.mainnet-beta.solana.com';
const programs = { pump: '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P', amm: 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA' };
const disc = { 'bddb7fd34ee661ee': 'pump.TradeEvent', '1b72a94ddeeb6376': 'pump.CreateEvent', '67f4521f2cf57777': 'amm.BuyEvent', '3e2f370aa503dc2a': 'amm.SellEvent' };
const st = {};
for (const [name, pid] of Object.entries(programs)) {
  const s = st[name] = { msgs: 0, bytes: 0, failed: 0, ev: {}, slots: new Set(), closes: [] };
  const ws = new WebSocket(url);
  ws.on('open', () => ws.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'logsSubscribe', params: [{ mentions: [pid] }, { commitment: 'confirmed' }] })));
  ws.on('message', (d) => {
    s.bytes += d.length; const j = JSON.parse(d.toString());
    if (!j.params) { console.log(name, 'ctl', d.toString().slice(0, 300)); return; }
    s.msgs++; const v = j.params.result.value; if (v.err) s.failed++; s.slots.add(j.params.result.context.slot);
    for (const l of v.logs) if (l.startsWith('Program data: ')) { const k = disc[Buffer.from(l.slice(14, 26), 'base64').toString('hex')]; if (k) s.ev[k] = (s.ev[k] || 0) + 1; }
  });
  ws.on('close', (c, r) => { s.closes.push(c + ':' + r); console.log(name, 'close', c, r.toString()); });
  ws.on('error', e => console.log(name, 'err', e.message));
}
setTimeout(() => {
  for (const [n, s] of Object.entries(st)) console.log(n, JSON.stringify({ url, msgs: s.msgs, perSec: +(s.msgs / SECS).toFixed(1), failed: s.failed, MBperHour: Math.round(s.bytes / 1e6 * 3600 / SECS), slots: s.slots.size, ev: s.ev, closes: s.closes }));
  process.exit(0);
}, SECS * 1000);
