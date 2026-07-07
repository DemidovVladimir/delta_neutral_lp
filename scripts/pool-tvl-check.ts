/**
 * TVL check for shortlisted DLMM pools: reads reserveX/reserveY pubkeys from
 * each LbPair account (offsets verified against the production pool) and
 * fetches token balances in two batched getMultipleAccounts calls.
 *
 * Usage: RPC_URL=... npx tsx scripts/pool-tvl-check.ts <pool1> <pool2> ...
 */
import { Connection, PublicKey } from '@solana/web3.js';

const RPC = process.env.RPC_URL!;
const SOL = new PublicKey('So11111111111111111111111111111111111111112');
const KNOWN_POOL = '5rCf1DM8LjKTw4YqhnoLcngyZYeNnQqztScTogYHAS6';
const OFF_X_MINT = 88;
const OFF_Y_MINT = 120;
const OFF_RESERVE_X = 152;
const OFF_RESERVE_Y = 184;
const BIN_STEP_OFF = 80;
const BASE_FACTOR_OFF = 8;

async function main() {
  const conn = new Connection(RPC, 'confirmed');
  const pools = process.argv.slice(2);
  if (!pools.length) throw new Error('pass pool addresses');
  const accs = await conn.getMultipleAccountsInfo([KNOWN_POOL, ...pools].map((p) => new PublicKey(p)));

  // Layout sanity on the known pool before trusting reserve offsets.
  const kd = accs[0]!.data;
  if (!new PublicKey(kd.subarray(OFF_X_MINT, OFF_X_MINT + 32)).equals(SOL)) {
    throw new Error('layout check failed: tokenXMint@88 is not SOL on the known pool');
  }

  const rows: { address: string; binStep: number; baseFeePct: number; rx: PublicKey; ry: PublicKey; xIsSol: boolean }[] = [];
  for (let i = 1; i < accs.length; i++) {
    const a = accs[i];
    if (!a) { console.log(`${pools[i - 1]}  MISSING`); continue; }
    const d = a.data;
    const bs = d.readUInt16LE(BIN_STEP_OFF);
    const bf = d.readUInt16LE(BASE_FACTOR_OFF);
    rows.push({
      address: pools[i - 1],
      binStep: bs,
      baseFeePct: +(((bs * bf * 10) / 1e9) * 100).toFixed(4),
      rx: new PublicKey(d.subarray(OFF_RESERVE_X, OFF_RESERVE_X + 32)),
      ry: new PublicKey(d.subarray(OFF_RESERVE_Y, OFF_RESERVE_Y + 32)),
      xIsSol: new PublicKey(d.subarray(OFF_X_MINT, OFF_X_MINT + 32)).equals(SOL),
    });
  }

  const reserveKeys = rows.flatMap((r) => [r.rx, r.ry]);
  const reserves = await conn.getMultipleAccountsInfo(reserveKeys);
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const rxAcc = reserves[i * 2];
    const ryAcc = reserves[i * 2 + 1];
    // SPL token account: amount u64 LE at offset 64.
    const xAmt = rxAcc ? Number(rxAcc.data.readBigUInt64LE(64)) : 0;
    const yAmt = ryAcc ? Number(ryAcc.data.readBigUInt64LE(64)) : 0;
    const sol = (r.xIsSol ? xAmt : yAmt) / 1e9;
    const usdc = (r.xIsSol ? yAmt : xAmt) / 1e6;
    console.log(
      `${r.address}  binStep=${r.binStep}  baseFee=${r.baseFeePct}%  reserves: ${sol.toFixed(2)} SOL + ${usdc.toFixed(0)} USDC`
    );
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
