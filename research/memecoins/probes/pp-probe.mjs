import WebSocket from 'ws';
const ws = new WebSocket('wss://pumpportal.fun/api/data');
const t0 = Date.now();
let n = 0; const samples = {};
ws.on('open', () => {
  console.log('open');
  ws.send(JSON.stringify({ method: 'subscribeNewToken' }));
  ws.send(JSON.stringify({ method: 'subscribeMigration' }));
});
ws.on('message', (d) => {
  n++;
  const s = d.toString();
  let j; try { j = JSON.parse(s); } catch { console.log('raw', s); return; }
  const k = j.txType || j.message || Object.keys(j).join(',');
  if (!samples[k]) { samples[k] = 1; console.log('SAMPLE', k, s.slice(0, 1500)); } else samples[k]++;
});
ws.on('close', (c, r) => console.log('close', c, r.toString()));
ws.on('error', (e) => console.log('error', e.message));
setTimeout(() => { console.log('count', n, 'in', (Date.now()-t0)/1000, 's', JSON.stringify(samples)); ws.close(); process.exit(0); }, 40000);
