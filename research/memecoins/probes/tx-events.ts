// Print all decoded pump/PumpSwap events of one transaction (public RPC).
import { extractTxEvents } from '../collector/decode.ts';
import { rpcCall } from '../collector/rpc.ts';
const sig = process.argv[2]; const url = process.argv[3] || 'https://solana-rpc.publicnode.com';
const tx: any = await rpcCall(url, 'getTransaction', [sig, { encoding: 'json', maxSupportedTransactionVersion: 1, commitment: 'confirmed' }]);
const r = extractTxEvents(tx);
console.log('slot', tx.slot, 'err', JSON.stringify(tx.meta.err), 'via', r.via);
for (const e of r.events) console.log(e.program, e.name, JSON.stringify(e.data, (_, v) => typeof v === 'bigint' ? v.toString() : v));
