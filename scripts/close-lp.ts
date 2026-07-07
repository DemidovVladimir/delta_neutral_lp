#!/usr/bin/env node
/**
 * Targeted LP close for pool migrations: withdraw + claim + close ONE
 * position by mint, via the same battle-tested MeteoraAdapter path the
 * auto-tune Phase 1 uses. Nothing else — no perp changes, no swaps
 * (that's `pnpm derisk`'s job).
 *
 * DRY-RUN by default: prints the position and what would happen.
 *
 *   npx tsx scripts/close-lp.ts --mint <positionMint> [--live]
 *
 * ⚠️  STOP THE SERVER BOT FIRST — a live loop would re-create the position
 * in the configured pool right after you close it.
 */
import { MeteoraAdapter } from '../src/modules/meteoraAdapter.js';
import { getConfig } from '../src/config/env.js';
import { log } from '../src/utils/logger.js';

async function main() {
  const args = process.argv.slice(2);
  const live = args.includes('--live');
  const mintIdx = args.indexOf('--mint');
  const mint = mintIdx >= 0 ? args[mintIdx + 1] : undefined;
  if (!mint) {
    console.error('Usage: npx tsx scripts/close-lp.ts --mint <positionMint> [--live]');
    process.exit(1);
  }
  const config = getConfig();
  log.info(live ? '🔴 close-lp LIVE' : '🧯 close-lp DRY-RUN (pass --live to execute)', {
    mint,
    pool: config.meteoraPoolAddress,
  });

  const meteora = new MeteoraAdapter();
  const found = await meteora.discoverPositionsFromBlockchain();
  log.info('Positions discovered in the configured pool', { found });
  if (!found.includes(mint)) {
    log.error('Position mint not found in the configured pool — refusing', { mint, found });
    process.exit(1);
  }
  if (!live) {
    log.info('DRY-RUN: would withdraw + claim + close this position, funds land in the wallet.');
    return;
  }
  const res = await meteora.withdrawClaimAndClose(mint);
  log.info('✅ LP position closed', { mint, ...res });
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
