// Print log lines of one transaction around pump/PumpSwap activity (public RPC).
import { rpcCall } from '../collector/rpc.ts';
const sig = process.argv[2]; const url = process.argv[3] || 'https://solana-rpc.publicnode.com';
const tx: any = await rpcCall(url, 'getTransaction', [sig, { encoding: 'json', maxSupportedTransactionVersion: 1, commitment: 'confirmed' }]);
const logs: string[] = tx.meta.logMessages; console.log('n logs', logs.length);
for (const l of logs) console.log(l.length > 160 ? l.slice(0, 160) + '…(' + l.length + ')' : l);
