// Probe: which "mentions" key gives the cheapest complete per-pool trade stream for fresh graduated pools?
// Candidates per pool: pool account, quote vault, coin-creator-vault ATA. Also accountSubscribe(quote vault, base64+dataSlice).
import Database from 'better-sqlite3';
import WebSocket from 'ws';
import bs58 from 'bs58';
import { PublicKey } from '@solana/web3.js';
import { extractLogEvents } from '../collector/decode.ts';
import { rpcCall } from '../collector/rpc.ts';
const SECS = Number(process.argv[2] || 120);
const AMM = new PublicKey('pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA');
const ATA = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const db = new Database('data/memecoins.db', { readonly: true });
const pools = (db.prepare("SELECT pool FROM migrations WHERE kind='migrate' AND seen_logs=1 AND pool IS NOT NULL ORDER BY slot DESC LIMIT 12").all() as { pool: string }[]).map(r => r.pool);
const accts: any = await rpcCall('https://api.mainnet-beta.solana.com', 'getMultipleAccounts', [pools, { encoding: 'base64' }]);
const info = pools.map((p, i) => {
  const b = Buffer.from(accts.value[i].data[0], 'base64');
  const quoteMint = new PublicKey(b.subarray(75, 107)); const quoteVault = bs58.encode(b.subarray(171, 203)); const coinCreator = new PublicKey(b.subarray(211, 243));
  const [auth] = PublicKey.findProgramAddressSync([Buffer.from('creator_vault'), coinCreator.toBuffer()], AMM);
  const tokenProgram = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
  const [ccAta] = PublicKey.findProgramAddressSync([auth.toBuffer(), tokenProgram.toBuffer(), quoteMint.toBuffer()], ATA);
  return { pool: p, quoteVault, ccAta: ccAta.toBase58() };
});
const poolSet = new Set(pools);
type S = { msgs: number; bytes: number; failed: number; ownTrades: number; sigs: Set<string> };
const mk = (): S => ({ msgs: 0, bytes: 0, failed: 0, ownTrades: 0, sigs: new Set() });
const res: Record<string, S> = { pool: mk(), ccAta: mk() };
for (const kind of Object.keys(res)) {
  const ws = new WebSocket('wss://api.mainnet-beta.solana.com', { perMessageDeflate: false });
  ws.on('open', async () => { for (const x of info) { ws.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'logsSubscribe', params: [{ mentions: [(x as any)[kind]] }, { commitment: 'confirmed' }] })); await new Promise(r => setTimeout(r, 150)); } });
  ws.on('message', (d: Buffer) => { const j = JSON.parse(d.toString()); if (!j.params) { if (j.error) console.log(kind, 'err', JSON.stringify(j.error)); return; }
    const s = res[kind]; s.msgs++; s.bytes += d.length; const v = j.params.result.value; if (v.err) { s.failed++; return; }
    for (const e of extractLogEvents(v.logs).events) if ((e.name === 'BuyEvent' || e.name === 'SellEvent') && poolSet.has(e.data.pool)) { s.ownTrades++; s.sigs.add(v.signature); } });
  ws.on('close', (c, w) => console.log(kind, 'closed', c, String(w)));
}
// account-level alternative: quote vault balance stream
const acc = { msgs: 0, bytes: 0, sliceWorks: false };
const wa = new WebSocket('wss://api.mainnet-beta.solana.com', { perMessageDeflate: false });
wa.on('open', async () => { for (const x of info) { wa.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'accountSubscribe', params: [x.quoteVault, { commitment: 'confirmed', encoding: 'base64', dataSlice: { offset: 64, length: 8 } }] })); await new Promise(r => setTimeout(r, 150)); } });
wa.on('message', (d: Buffer) => { const j = JSON.parse(d.toString()); if (!j.params) { if (j.error) console.log('acct err', JSON.stringify(j.error)); return; } acc.msgs++; acc.bytes += d.length; const data = j.params.result.value.data[0]; if (Buffer.from(data, 'base64').length === 8) acc.sliceWorks = true; });
setTimeout(() => {
  const out: any = { pools: info.length, secs: SECS };
  for (const [k, s] of Object.entries(res)) out[k] = { msgs: s.msgs, failed: s.failed, ownTrades: s.ownTrades, ownTradeTxs: s.sigs.size, MBperHour: +(s.bytes / 1e6 * 3600 / SECS).toFixed(1), bytesPerOwnTrade: Math.round(s.bytes / Math.max(1, s.ownTrades)) };
  const P = res.pool.sigs; for (const k of ['ccAta']) out[k].missingVsPool = [...P].filter(x => !res[k].sigs.has(x)).length;
  out.accountSubscribeQuoteVault = { msgs: acc.msgs, MBperHour: +(acc.bytes / 1e6 * 3600 / SECS).toFixed(1), dataSliceHonoured: acc.sliceWorks };
  console.log(JSON.stringify(out, null, 1)); process.exit(0);
}, SECS * 1000);
