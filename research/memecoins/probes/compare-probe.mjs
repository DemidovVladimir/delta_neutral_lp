// Probe: run public RPC and Helius logsSubscribe side by side on one program; compare signature sets.
import WebSocket from 'ws';
import fs from 'fs';
const SECS = Number(process.argv[2] || 60);
const pid = process.argv[3] || '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
const rpc = fs.readFileSync('.env', 'utf8').split('\n').find(l => l.startsWith('RPC_URL=')).slice(8).trim();
const key = new URL(rpc).searchParams.get('api-key');
const urls = { public: 'wss://api.mainnet-beta.solana.com', helius: `wss://mainnet.helius-rpc.com/?api-key=${key}` };
const disc = { 'bddb7fd34ee661ee': 'pump.TradeEvent', '1b72a94ddeeb6376': 'pump.CreateEvent', '67f4521f2cf57777': 'amm.BuyEvent', '3e2f370aa503dc2a': 'amm.SellEvent' };
const st = {}; const t0 = Date.now(); let tStart = 0;
for (const [name, url] of Object.entries(urls)) {
  const s = st[name] = { ok: new Map(), bytes: 0, lat: [], ev: 0 };
  const ws = new WebSocket(url);
  ws.on('open', () => ws.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'logsSubscribe', params: [{ mentions: [pid] }, { commitment: 'confirmed' }] })));
  ws.on('message', (d) => {
    s.bytes += d.length; const j = JSON.parse(d.toString()); if (!j.params) return;
    const v = j.params.result.value; if (v.err) return;
    let n = 0; for (const l of v.logs) if (l.startsWith('Program data: ') && disc[Buffer.from(l.slice(14, 26), 'base64').subarray(0, 8).toString('hex')]) n++;
    if (n) { s.ok.set(v.signature, { slot: j.params.result.context.slot, t: Date.now() }); s.ev += n; }
  });
  ws.on('close', (c, r) => console.log(name, 'close', c, r.toString()));
  ws.on('error', e => console.log(name, 'err', e.message));
}
setTimeout(() => {
  // compare only within the slot window both streams covered (trim 5s at the edges)
  const all = [...st.public.ok.values(), ...st.helius.ok.values()].map(x => x.slot);
  const lo = Math.min(...all) + 15, hi = Math.max(...all) - 15;
  const inW = m => new Set([...m].filter(([, x]) => x.slot >= lo && x.slot <= hi).map(([k]) => k));
  const P = inW(st.public.ok), H = inW(st.helius.ok); const U = new Set([...P, ...H]);
  const both = [...P].filter(x => H.has(x)).length;
  // latency: for sigs in both, delta arrival (public - helius)
  const d = []; for (const k of P) if (H.has(k)) d.push(st.public.ok.get(k).t - st.helius.ok.get(k).t); d.sort((a, b) => a - b);
  console.log(JSON.stringify({ pid, window_slots: [lo, hi], union: U.size, public: P.size, helius: H.size, both, publicPct: +(100 * P.size / U.size).toFixed(2), heliusPct: +(100 * H.size / U.size).toFixed(2), publicMinusHeliusMs_p50: d[d.length >> 1], p90: d[Math.floor(d.length * 0.9)], MBph: { public: Math.round(st.public.bytes / 1e6 * 3600 / SECS), helius: Math.round(st.helius.bytes / 1e6 * 3600 / SECS) } }));
  const missP = [...H].filter(x => !P.has(x)).slice(0, 3), missH = [...P].filter(x => !H.has(x)).slice(0, 3);
  console.log('missing_in_public', JSON.stringify(missP)); console.log('missing_in_helius', JSON.stringify(missH));
  process.exit(0);
}, SECS * 1000);
