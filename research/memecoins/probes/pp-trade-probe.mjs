// Probe: does PumpPortal subscribeTokenTrade deliver without an API key?
import WebSocket from 'ws';
const ws = new WebSocket('wss://pumpportal.fun/api/data');
const t0 = Date.now(); const counts = {}; let shown = 0;
ws.on('open', () => { ws.send(JSON.stringify({ method: 'subscribeNewToken' })); });
ws.on('message', (d) => {
  const s = d.toString(); let j; try { j = JSON.parse(s); } catch { console.log('raw', s); return; }
  const k = j.txType || ('msg:' + (j.message || j.errors || Object.keys(j).join(',')));
  counts[k] = (counts[k] || 0) + 1;
  if (j.txType === 'create') ws.send(JSON.stringify({ method: 'subscribeTokenTrade', keys: [j.mint] }));
  if (!j.txType || ((j.txType === 'buy' || j.txType === 'sell') && shown < 2)) { if (j.txType) shown++; console.log(k, s.slice(0, 1200)); }
});
ws.on('close', (c, r) => console.log('close', c, r.toString()));
ws.on('error', (e) => console.log('error', e.message));
setTimeout(() => { console.log('counts in', (Date.now()-t0)/1000, 's', JSON.stringify(counts)); process.exit(0); }, 60000);
