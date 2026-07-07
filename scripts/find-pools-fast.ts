/**
 * Fast SOL/USDC DLMM pool finder: ~4 RPC calls total (vs 300k in the naive
 * script). Field offsets are taken from the LbPair layout and VERIFIED
 * against our own production pool before use; getProgramAccounts is
 * server-side memcmp-filtered to SOL/USDC pairs only.
 *
 * LbPair layout: 8 disc + StaticParameters(32: baseFactor u16 @8, ...) +
 * VariableParameters(32) + bumpSeed(1 @72) + binStepSeed(2 @73) + pairType(1) +
 * activeId(i32 @76) + binStep(u16 @80) + ...tokenXMint/tokenYMint (located
 * empirically via indexOf on the known pool).
 */
import { Connection, PublicKey } from '@solana/web3.js';

const RPC = process.env.RPC_URL!;
const PROGRAM = new PublicKey('LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo');
const SOL = new PublicKey('So11111111111111111111111111111111111111112');
const USDC = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const KNOWN_POOL = new PublicKey('5rCf1DM8LjKTw4YqhnoLcngyZYeNnQqztScTogYHAS6'); // binStep 4, base fee 0.04%

const BASE_FACTOR_OFF = 8;
const BIN_STEP_OFF = 80;

function findOffset(data: Buffer, needle: Buffer, label: string): number {
  const i = data.indexOf(needle);
  if (i < 0) throw new Error(`${label} not found`);
  if (data.indexOf(needle, i + 1) >= 0) throw new Error(`${label} ambiguous`);
  return i;
}

async function main() {
  const conn = new Connection(RPC, 'confirmed');
  const known = await conn.getAccountInfo(KNOWN_POOL);
  if (!known) throw new Error('known pool missing');
  const d = known.data;

  const offX = findOffset(d, SOL.toBuffer(), 'tokenXMint(SOL)');
  const offY = findOffset(d, USDC.toBuffer(), 'tokenYMint(USDC)');
  // Verify the layout against known ground truth before trusting it.
  const binStep = d.readUInt16LE(BIN_STEP_OFF);
  const seedStep = d.readUInt16LE(73); // bumpSeed u8 @72, binStepSeed [u8;2] @73
  const baseFactor = d.readUInt16LE(BASE_FACTOR_OFF);
  const baseFeePct = (binStep * baseFactor * 10) / 1e9 * 100;
  if (binStep !== 4 || seedStep !== 4) throw new Error(`layout check failed: binStep@80=${binStep} seed@73=${seedStep}`);
  if (Math.abs(baseFeePct - 0.04) > 1e-9) throw new Error(`layout check failed: baseFee=${baseFeePct}%`);
  console.log(`layout verified on known pool: offX=${offX} offY=${offY} binStep=${binStep} baseFee=${baseFeePct}%\n`);

  const results: any[] = [];
  for (const [xa, ya] of [[SOL, USDC], [USDC, SOL]] as const) {
    const accs = await conn.getProgramAccounts(PROGRAM, {
      filters: [
        { dataSize: 904 },
        { memcmp: { offset: offX, bytes: xa.toBase58() } },
        { memcmp: { offset: offY, bytes: ya.toBase58() } },
      ],
    });
    for (const a of accs) {
      const dd = a.account.data as Buffer;
      const bs = dd.readUInt16LE(BIN_STEP_OFF);
      const bfac = dd.readUInt16LE(BASE_FACTOR_OFF);
      results.push({
        address: a.pubkey.toBase58(),
        order: xa.equals(SOL) ? 'SOL/USDC' : 'USDC/SOL',
        binStep: bs,
        baseFeePct: +(((bs * bfac * 10) / 1e9) * 100).toFixed(4),
      });
    }
  }
  results.sort((a, b) => a.binStep - b.binStep || a.baseFeePct - b.baseFeePct);
  for (const r of results) {
    console.log(`${r.address}  order=${r.order}  binStep=${r.binStep}  baseFee=${r.baseFeePct}%`);
  }
  console.log(`\ntotal SOL/USDC pools: ${results.length}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
