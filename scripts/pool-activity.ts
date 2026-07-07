/**
 * On-chain activity check for DLMM pools: how often does each pool actually
 * trade, and is its price tracking the market? For the pool-switch due
 * diligence — a fat-fee pool only earns us fees if arbitrage keeps walking
 * its price through our bins.
 *
 * Per pool (2 RPC calls): last 1000 signatures → tx/hour over the covered
 * span + success rate; account data → activeId → pool price (verified
 * against the known production pool before trusting the formula).
 *
 * Usage: RPC_URL=... npx tsx scripts/pool-activity.ts <pool1> <pool2> ...
 */
import { Connection, PublicKey } from '@solana/web3.js';

const RPC = process.env.RPC_URL!;
const BIN_STEP_OFF = 80;
const ACTIVE_ID_OFF = 76;

async function main() {
  const conn = new Connection(RPC, 'confirmed');
  const pools = process.argv.slice(2);
  if (!pools.length) throw new Error('pass pool addresses');

  for (const pool of pools) {
    const pk = new PublicKey(pool);
    const [sigs, acc] = await Promise.all([
      conn.getSignaturesForAddress(pk, { limit: 1000 }),
      conn.getAccountInfo(pk),
    ]);
    if (!acc) { console.log(`${pool}  MISSING`); continue; }
    const binStep = acc.data.readUInt16LE(BIN_STEP_OFF);
    const activeId = acc.data.readInt32LE(ACTIVE_ID_OFF);
    // DLMM price per bin id: (1 + binStep/1e4)^activeId, in Y-lamports per
    // X-lamport; SOL(9)/USDC(6) UI price = that × 10^(9−6).
    const price = Math.pow(1 + binStep / 10_000, activeId) * 1e3;

    const newest = sigs[0]?.blockTime ?? 0;
    const oldest = sigs[sigs.length - 1]?.blockTime ?? 0;
    const spanH = (newest - oldest) / 3600;
    const failed = sigs.filter((s) => s.err !== null).length;
    const ok = sigs.length - failed;
    const perHour = spanH > 0 ? ok / spanH : 0;
    const ageMin = newest ? (Date.now() / 1000 - newest) / 60 : Infinity;

    console.log(
      `${pool}\n` +
        `  binStep=${binStep} activeId=${activeId} poolPrice=$${price.toFixed(4)}\n` +
        `  last ${sigs.length} sigs span ${spanH.toFixed(2)}h → ${perHour.toFixed(0)} successful tx/h (${failed} failed)\n` +
        `  newest tx ${ageMin.toFixed(1)} min ago`
    );
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
