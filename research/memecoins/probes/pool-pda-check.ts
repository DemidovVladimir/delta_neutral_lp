// Probe: derive the canonical PumpSwap pool of a pump.fun mint and compare with observed migrations.
import Database from 'better-sqlite3';
import { PublicKey } from '@solana/web3.js';
const PUMP = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P'), AMM = new PublicKey('pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA');
const WSOL = new PublicKey('So11111111111111111111111111111111111111112');
const db = new Database('data/memecoins.db', { readonly: true });
const rows = db.prepare("SELECT m.mint, m.pool, t.quote_mint FROM migrations m LEFT JOIN tokens t ON t.mint = m.mint WHERE m.kind='migrate' AND m.seen_logs=1").all() as any[];
let ok = 0; const bad: string[] = [];
for (const r of rows) {
  const mint = new PublicKey(r.mint); const quote = r.quote_mint ? new PublicKey(r.quote_mint) : WSOL;
  const [auth] = PublicKey.findProgramAddressSync([Buffer.from('pool-authority'), mint.toBuffer()], PUMP);
  const idx = Buffer.alloc(2); idx.writeUInt16LE(0);
  const [pool] = PublicKey.findProgramAddressSync([Buffer.from('pool'), idx, auth.toBuffer(), mint.toBuffer(), quote.toBuffer()], AMM);
  if (pool.toBase58() === r.pool) ok++; else bad.push(`${r.mint} observed=${r.pool} derived=${pool.toBase58()}`);
}
console.log(JSON.stringify({ checked: rows.length, ok, bad: bad.slice(0, 3) }));
