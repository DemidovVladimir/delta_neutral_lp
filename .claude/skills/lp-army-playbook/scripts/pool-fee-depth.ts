/**
 * Read-only: for each pool, report
 *  (a) fee structure — base fee, current dynamic fee, max possible fee
 *  (b) liquidity depth — how pool TVL is distributed around the active bin
 *
 * Usage: RPC_URL=... npx tsx pool-fee-depth.ts <pool> [<pool> ...]
 */
import { Connection, PublicKey } from '@solana/web3.js';
import { createRequire } from 'module';

// The project runs as ESM ("type": "module"), and the DLMM SDK's ESM bundle
// crashes on a named BN import under Node 24 — load the CommonJS build the
// same way src/utils/dlmm.ts does.
const require = createRequire(import.meta.url);
const dlmmModule = require('@meteora-ag/dlmm');
const DLMM: any = dlmmModule.default || dlmmModule;

const RPC = process.env.RPC_URL!;
const WINDOWS = [10, 14, 25, 50, 100];

async function main() {
  const conn = new Connection(RPC, 'confirmed');
  const pools = process.argv.slice(2);

  for (const addr of pools) {
    console.log(`\n${'='.repeat(78)}\nPOOL ${addr}`);
    let dlmm;
    try {
      dlmm = await DLMM.create(conn, new PublicKey(addr));
    } catch (e) {
      console.log(`  FAILED to load: ${(e as Error).message}`);
      continue;
    }

    const binStep = dlmm.lbPair.binStep;
    const activeId = dlmm.lbPair.activeId;
    const fee = dlmm.getFeeInfo();
    const baseFeePct = Number(fee.baseFeeRatePercentage);
    const maxFeePct = Number(fee.maxFeeRatePercentage);
    let dynPct = NaN;
    try {
      dynPct = Number(await dlmm.getDynamicFee());
    } catch { /* older SDK path */ }

    console.log(`  binStep=${binStep}  activeId=${activeId}`);
    console.log(`  FEES: base=${baseFeePct.toFixed(4)}%  current=${dynPct.toFixed(4)}%  max=${maxFeePct.toFixed(4)}%`);
    console.log(`        current/base = ${(dynPct / baseFeePct).toFixed(3)}x   max/base = ${(maxFeePct / baseFeePct).toFixed(3)}x`);

    // ---- liquidity depth around the active bin ----
    const widest = Math.max(...WINDOWS);
    const bins = await dlmm.getBinsAroundActiveBin(widest, widest);
    const active = bins.binsById?.get?.(activeId) ?? bins.bins.find((b: any) => b.binId === activeId);
    const priceOfActive = active ? Number(active.pricePerToken) : NaN;
    console.log(`  active bin price = ${priceOfActive}`);

    // Pool totals straight from the reserve token accounts.
    const [rx, ry] = await conn.getMultipleAccountsInfo([dlmm.lbPair.reserveX, dlmm.lbPair.reserveY]);
    const decX = dlmm.tokenX.mint.decimals;
    const decY = dlmm.tokenY.mint.decimals;
    const totX = rx ? Number(rx.data.readBigUInt64LE(64)) / 10 ** decX : 0;
    const totY = ry ? Number(ry.data.readBigUInt64LE(64)) / 10 ** decY : 0;
    const totalUsd = totX * priceOfActive + totY;
    console.log(`  pool reserves: X=${totX.toFixed(4)}  Y=${totY.toFixed(4)}  → TVL ≈ ${totalUsd.toFixed(2)} (quote units)`);

    const val = (b: any) =>
      Number(b.xAmount) / 10 ** decX * Number(b.pricePerToken) + Number(b.yAmount) / 10 ** decY;

    for (const w of WINDOWS) {
      const inWin = bins.bins.filter((b: any) => Math.abs(b.binId - activeId) <= w);
      const usd = inWin.reduce((s: number, b: any) => s + val(b), 0);
      const share = totalUsd > 0 ? (usd / totalUsd) * 100 : 0;
      // Concentration multiplier: what an LP sitting only in this window earns
      // per dollar, versus the pool average, assuming all volume crosses the window.
      const mult = share > 0 ? 100 / share : Infinity;
      console.log(
        `  ±${String(w).padStart(3)} bins (${(2 * w + 1).toString().padStart(3)} bins, ±${((Math.pow(1 + binStep / 10000, w) - 1) * 100).toFixed(2)}%):` +
        ` ${usd.toFixed(2)} = ${share.toFixed(2)}% of TVL   → concentration ${mult.toFixed(1)}x`,
      );
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
