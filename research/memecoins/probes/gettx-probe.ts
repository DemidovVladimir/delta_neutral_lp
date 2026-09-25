// Probe: public RPC getTransaction (tx version 1) + decode of self-CPI event inner instructions.
import { decodeCpiEventIx, decodeLogLine, PUMP_PROGRAM, PUMP_AMM_PROGRAM } from '../collector/decode.ts';
const sig = process.argv[2];
const url = process.argv[3] || 'https://api.mainnet-beta.solana.com';
const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getTransaction', params: [sig, { encoding: 'json', maxSupportedTransactionVersion: 1, commitment: 'confirmed' }] }) });
const j = await r.json(); if (j.error) { console.log('ERR', JSON.stringify(j.error)); process.exit(0); }
const tx = j.result; const keys = [...tx.transaction.message.accountKeys, ...(tx.meta.loadedAddresses?.writable ?? []), ...(tx.meta.loadedAddresses?.readonly ?? [])];
console.log('version', tx.version, 'slot', tx.slot, 'blockTime', tx.blockTime, 'nkeys', keys.length);
for (const g of tx.meta.innerInstructions) for (const ix of g.instructions) { const pid = keys[ix.programIdIndex]; if (pid !== PUMP_PROGRAM && pid !== PUMP_AMM_PROGRAM) continue; const e = decodeCpiEventIx(ix.data); if (e) console.log('CPI', g.index, e.program, e.name, e.data.mint ?? e.data.pool, String(e.data.sol_amount ?? e.data.quote_amount_in ?? e.data.quote_amount_out)); }
for (const l of tx.meta.logMessages) { const e = decodeLogLine(l); if (e) console.log('LOG', e.program, e.name, e.data.mint ?? e.data.pool, String(e.data.sol_amount ?? e.data.quote_amount_in ?? e.data.quote_amount_out)); }
