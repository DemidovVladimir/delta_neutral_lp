// Probe: Helius getTransactionsForAddress on a PROGRAM address with a slot window (cost: ~10-20 credits).
import fs from 'node:fs';
const rpc = fs.readFileSync('.env', 'utf8').split('\n').find(l => l.startsWith('RPC_URL='))!.slice(8).trim();
const pid = process.argv[2] || '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
const details = process.argv[3] || 'signatures';
const limit = Number(process.argv[4] || 100);
const slotNow = (await (await fetch('https://api.mainnet-beta.solana.com', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getSlot', params: [{ commitment: 'finalized' }] }) })).json()).result;
const from = slotNow - 300; // ~2 min ago
const t0 = Date.now();
const r = await fetch(rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getTransactionsForAddress', params: [pid, { transactionDetails: details, sortOrder: 'asc', limit, commitment: 'finalized', encoding: 'json', maxSupportedTransactionVersion: 1, filters: { slot: { gte: from, lt: from + 25 }, status: 'succeeded' } }] }) });
const txt = await r.text(); const ms = Date.now() - t0;
const j = JSON.parse(txt);
if (j.error) { console.log('ERR', JSON.stringify(j.error)); process.exit(0); }
const data = j.result.data; console.log('status', r.status, 'ms', ms, 'bytes', txt.length, 'n', data.length, 'paginationToken', j.result.paginationToken, 'slots', data[0]?.slot, data[data.length - 1]?.slot);
console.log('keys', Object.keys(data[0] || {}).join(','));
if (details === 'full' && data[0]) { const m = data[0].meta; console.log('meta keys', Object.keys(m).join(','), 'logs', m.logMessages?.length, 'inner', m.innerInstructions?.length, 'blockTime', data[0].blockTime, 'sig', data[0].transaction.signatures[0]); console.log('avg bytes/tx', Math.round(txt.length / data.length)); }
else console.log(JSON.stringify(data.slice(0, 2)));
