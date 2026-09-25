// Probe: (1) traffic of per-pool logsSubscribe on in-window graduated PumpSwap pools,
//        (2) how many logsSubscribe subscriptions one mainnet-beta connection accepts (random, silent pubkeys).
import Database from 'better-sqlite3';
import WebSocket from 'ws';
import crypto from 'node:crypto';
import bs58 from 'bs58';
import { extractLogEvents } from '../collector/decode.ts';
const SECS = Number(process.argv[2] || 180); const N_RANDOM = Number(process.argv[3] || 3000);
const URL = 'wss://api.mainnet-beta.solana.com';
const db = new Database('data/memecoins.db', { readonly: true });
const pools = (db.prepare("SELECT pool FROM migrations WHERE kind='migrate' AND seen_logs=1 AND pool IS NOT NULL").all() as { pool: string }[]).map(r => r.pool);
const st = { msgs: 0, bytes: 0, failed: 0, trades: 0, acks: 0, errs: 0 };
const a = new WebSocket(URL, { perMessageDeflate: false });
a.on('open', () => pools.forEach((p, i) => a.send(JSON.stringify({ jsonrpc: '2.0', id: i + 1, method: 'logsSubscribe', params: [{ mentions: [p] }, { commitment: 'confirmed' }] }))));
a.on('message', (d: Buffer) => { const j = JSON.parse(d.toString()); if (!j.params) { if (j.error) st.errs++; else st.acks++; return; }
  st.msgs++; st.bytes += d.length; const v = j.params.result.value; if (v.err) { st.failed++; return; }
  for (const e of extractLogEvents(v.logs).events) if (e.name === 'BuyEvent' || e.name === 'SellEvent') st.trades++; });
// subscription-limit test
const r = { sent: 0, acks: 0, errs: 0, firstErr: '', tAll: 0, closed: '' }; const t0 = Date.now();
const b = new WebSocket(URL, { perMessageDeflate: false });
b.on('open', () => { for (let i = 0; i < N_RANDOM; i++) { b.send(JSON.stringify({ jsonrpc: '2.0', id: i + 1, method: 'logsSubscribe', params: [{ mentions: [bs58.encode(crypto.randomBytes(32))] }, { commitment: 'confirmed' }] })); r.sent++; } });
b.on('message', (d: Buffer) => { const j = JSON.parse(d.toString()); if (j.error) { r.errs++; if (!r.firstErr) r.firstErr = JSON.stringify(j.error).slice(0, 200); } else if (j.result !== undefined) { r.acks++; if (r.acks === N_RANDOM) r.tAll = Date.now() - t0; } });
b.on('close', (c, why) => { r.closed = `${c} ${why}`; });
b.on('error', e => { r.closed = 'error ' + e.message; });
setTimeout(() => {
  console.log(JSON.stringify({ pools: pools.length, poolSubs: { acks: st.acks, errs: st.errs }, secs: SECS, msgs: st.msgs, failed: st.failed, trades: st.trades,
    MBperHour: +(st.bytes / 1e6 * 3600 / SECS).toFixed(1), tradesPerHour: Math.round(st.trades * 3600 / SECS), bytesPerMsg: Math.round(st.bytes / Math.max(1, st.msgs)) }));
  console.log(JSON.stringify({ randomSubs: r }));
  process.exit(0);
}, SECS * 1000);
