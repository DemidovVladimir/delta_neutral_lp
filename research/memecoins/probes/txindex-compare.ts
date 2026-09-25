// Probe: is Helius gTFA `transactionIndex` the same as the position in getBlock(signatures)? (10 credits)
import { heliusUrl, rpcCall } from '../collector/rpc.ts';
const h = heliusUrl()!;
const tip = await rpcCall<number>('https://solana-rpc.publicnode.com', 'getSlot', [{ commitment: 'confirmed' }]);
const slot = tip - 200;
const g: any = await rpcCall(h, 'getTransactionsForAddress', ['6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P', { transactionDetails: 'signatures', sortOrder: 'asc', limit: 1000, filters: { slot: { gte: slot, lte: slot } } }]);
const blk: any = await rpcCall('https://solana-rpc.publicnode.com', 'getBlock', [slot, { encoding: 'json', transactionDetails: 'signatures', rewards: false, maxSupportedTransactionVersion: 1, commitment: 'confirmed' }]);
const pos = new Map<string, number>(blk.signatures.map((s: string, i: number) => [s, i]));
let same = 0; const diffs: string[] = [];
for (const r of g.data) { const p = pos.get(r.signature); if (p === r.transactionIndex) same++; else if (diffs.length < 5) diffs.push(`${r.signature} gtfa=${r.transactionIndex} block=${p}`); }
console.log(JSON.stringify({ slot, gtfaSigs: g.data.length, blockSigs: blk.signatures.length, sameIndex: same, diffs }));
