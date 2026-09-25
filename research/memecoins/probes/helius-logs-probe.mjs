// Probe: Helius logsSubscribe bandwidth + event mix for pump.fun and PumpSwap.
// Credits per Helius docs: 2 credits per 0.1 MB uncompressed streamed + 1 per connection.
import WebSocket from 'ws';
import fs from 'fs';
const env = Object.fromEntries(fs.readFileSync('.env', 'utf8').split('\n').filter(l => /^RPC_URL=/.test(l)).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
const key = new URL(env.RPC_URL).searchParams.get('api-key');
const SECS = Number(process.argv[2] || 60);
const programs = { pump: '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P', amm: 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA' };
const disc = { 'bddb7fd34ee661ee': 'pump.TradeEvent', '1b72a94ddeeb6376': 'pump.CreateEvent', '5f72619cd42e9808': 'pump.CompleteEvent', 'bde95db95c94ea94': 'pump.CompletePumpAmmMigrationEvent', '67f4521f2cf57777': 'amm.BuyEvent', '3e2f370aa503dc2a': 'amm.SellEvent', 'b1310cd2a076a774': 'amm.CreatePoolEvent', 'e445a52e51cb9a1d': 'anchor.EventCPI' };
const st = {};
for (const [name, pid] of Object.entries(programs)) {
  const s = st[name] = { msgs: 0, bytes: 0, failed: 0, dataLines: {}, truncated: 0, sample: null, noData: 0 };
  const ws = new WebSocket(`wss://mainnet.helius-rpc.com/?api-key=${key}`);
  ws.on('open', () => ws.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'logsSubscribe', params: [{ mentions: [pid] }, { commitment: 'confirmed' }] })));
  ws.on('message', (d) => {
    s.bytes += d.length; const j = JSON.parse(d.toString());
    if (!j.params) { console.log(name, 'ctl', d.toString().slice(0, 200)); return; }
    s.msgs++; const v = j.params.result.value; if (v.err) s.failed++;
    let any = false;
    for (const l of v.logs) {
      if (l.startsWith('Log truncated')) s.truncated++;
      if (l.startsWith('Program data: ')) { any = true; const b = Buffer.from(l.slice(14), 'base64'); const k = disc[b.subarray(0, 8).toString('hex')] || ('?' + b.subarray(0, 8).toString('hex')); s.dataLines[k] = (s.dataLines[k] || 0) + 1; }
    }
    if (!any && !v.err) { s.noData++; if (!s.sample) s.sample = { sig: v.signature, slot: j.params.result.context.slot, logs: v.logs.slice(0, 40) }; }
  });
  ws.on('error', e => console.log(name, 'err', e.message));
}
setTimeout(() => {
  for (const [n, s] of Object.entries(st)) {
    const mbph = s.bytes / 1e6 * 3600 / SECS;
    console.log(n, JSON.stringify({ msgs: s.msgs, msgsPerSec: +(s.msgs / SECS).toFixed(1), failed: s.failed, noDataSuccess: s.noData, truncated: s.truncated, avgBytes: Math.round(s.bytes / Math.max(1, s.msgs)), MBperHour: +mbph.toFixed(0), creditsPerHour: Math.round(mbph * 20), dataLines: s.dataLines }));
    if (s.sample) console.log(n, 'sample-no-data', JSON.stringify(s.sample).slice(0, 3000));
  }
  process.exit(0);
}, SECS * 1000);
