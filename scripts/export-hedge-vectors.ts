/**
 * Export shared hedge-controller test vectors for the Rust simulator.
 *
 * Runs the PRODUCTION decision core (src/modules/hedgeController.ts) over
 * (a) the named cases mirrored from hedgeController.test.ts and (b) a
 * deterministic LCG-sampled grid of realistic states, and writes
 * (input, decision) pairs to simulator/fixtures/hedge-vectors.jsonl.
 * The Rust port must reproduce every decision (tests/vectors.rs) — this is
 * the "two executors, one truth table" verification instead of a parallel
 * TS simulator.
 *
 * Regenerate after ANY hedgeController.ts change:
 *   npx tsx scripts/export-hedge-vectors.ts
 *
 * JSONL (not .json) because the repo .gitignore excludes *.json.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decideHedgeAction, type HedgeDecisionInput } from '../src/modules/hedgeController.js';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'simulator', 'fixtures', 'hedge-vectors.jsonl');

function base(overrides: Partial<HedgeDecisionInput> = {}): HedgeDecisionInput {
  return {
    lpSol: 0,
    longSol: 0,
    shortSol: 0,
    longNotionalUsd: 0,
    shortNotionalUsd: 0,
    longCollateralUsd: 0,
    shortCollateralUsd: 0,
    carryCostBps: { long: 1200, short: 1200 },
    oraclePriceUsd: 100,
    walletSol: 10,
    walletReserveSol: 0.3,
    walletUsdc: 1_000_000,
    targetDeltaSol: 0,
    bandSol: 0.5,
    carryCapBps: 5000,
    maxHedgeNotionalUsd: 12_000,
    minCollateralRatio: 0.15,
    targetCollateralRatio: 1.0,
    nowMs: 1_000_000,
    lastActionAtMs: null,
    cooldownMs: 120_000,
    ...overrides,
  };
}

// (a) Named cases — one per behavior pinned in hedgeController.test.ts.
const named: HedgeDecisionInput[] = [
  base({ lpSol: 5, oraclePriceUsd: 0 }),
  base({ lpSol: 5, oraclePriceUsd: NaN }),
  base({ lpSol: 0.4 }),
  base({ lpSol: 0.5 }),
  base({ lpSol: 5, lastActionAtMs: 1_000_000 - 30_000 }),
  base({ lpSol: 5, lastActionAtMs: 1_000_000 - 120_001 }),
  base({ lpSol: 0.1, lastActionAtMs: 1_000_000 - 1_000 }),
  base({ lpSol: 5 }),
  base({ lpSol: 5, targetCollateralRatio: 0.33 }),
  base({ lpSol: 1, longSol: 5, longNotionalUsd: 500, longCollateralUsd: 500 }),
  base({ longSol: 5, longNotionalUsd: 500, longCollateralUsd: 500, targetDeltaSol: 3 }),
  base({ lpSol: 5 - 1e-12, longSol: 5, longNotionalUsd: 500, targetDeltaSol: 5 }),
  base({ lpSol: 1, shortSol: 3, shortNotionalUsd: 300, shortCollateralUsd: 300 }),
  base({ shortSol: 2, shortNotionalUsd: 200 }),
  base({ targetDeltaSol: 5 }),
  base({ targetDeltaSol: 5, walletSol: 5, walletReserveSol: 0.3 }),
  base({ targetDeltaSol: 5, walletSol: 0.35, walletReserveSol: 0.3 }),
  base({ lpSol: 5, carryCostBps: { long: 0, short: 6000 } }),
  base({ targetDeltaSol: 5, carryCostBps: { long: 6000, short: 0 } }),
  base({ lpSol: 5, carryCapBps: 0, carryCostBps: { long: 99999, short: 99999 } }),
  base({ lpSol: 130 }),
  base({ lpSol: 130, shortSol: 119.95, shortNotionalUsd: 11_995, shortCollateralUsd: 11_995 }),
  base({ lpSol: 5, walletUsdc: 50 }),
  base({ lpSol: 5, walletUsdc: 5 }),
  base({ lpSol: 5, targetCollateralRatio: 0.1 }),
  base({ shortSol: 2, shortNotionalUsd: 200, carryCostBps: { long: 99999, short: 99999 } }),
  base({ longSol: 2, shortSol: 1, longNotionalUsd: 200, shortNotionalUsd: 100 }),
];

// (b) Deterministic sampled grid — seeded LCG, NO Math.random (reproducible).
let seed = 0x5eed_2026 >>> 0;
const rnd = () => {
  seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
  return seed / 2 ** 32;
};
const pick = <T>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)];
const range = (lo: number, hi: number) => lo + rnd() * (hi - lo);

const sampled: HedgeDecisionInput[] = [];
for (let i = 0; i < 1000; i++) {
  const price = range(60, 120);
  const shortSol = pick([0, 0, range(0, 3)]);
  const longSol = shortSol > 0 && rnd() < 0.8 ? 0 : pick([0, 0, range(0, 2)]);
  const targetRatio = pick([0.33, 0.5, 1.0]);
  const curRatio = range(0.25, 1.0);
  sampled.push(
    base({
      lpSol: pick([0, range(0, 0.5), range(0, 3), range(2, 4)]),
      shortSol,
      shortNotionalUsd: shortSol * price,
      shortCollateralUsd: shortSol * price * curRatio,
      longSol,
      longNotionalUsd: longSol * price,
      longCollateralUsd: longSol * price * curRatio,
      carryCostBps: { long: range(0, 8000), short: range(0, 8000) },
      oraclePriceUsd: price,
      walletSol: range(0, 5),
      walletReserveSol: 0.3,
      walletUsdc: pick([range(0, 15), range(0, 60), range(0, 250), 1_000_000]),
      targetDeltaSol: pick([0, 0, 0, range(-1, 1), 5]),
      bandSol: pick([0.06, 0.25, 0.5]),
      carryCapBps: pick([0, 5000]),
      maxHedgeNotionalUsd: pick([range(50, 300), 12_000]),
      minCollateralRatio: 0.15,
      targetCollateralRatio: targetRatio,
      lastActionAtMs: pick([null, 1_000_000 - 30_000, 1_000_000 - 700_000]),
      cooldownMs: pick([0, 120_000, 600_000]),
    })
  );
}

const lines = [...named, ...sampled].map((input) => {
  const decision = decideHedgeAction(input);
  // Flatten to snake_case for the Rust side; JSON has no NaN — encode as null
  // and let the Rust loader map null back to NaN.
  const flat = {
    lp_sol: input.lpSol,
    long_sol: input.longSol,
    short_sol: input.shortSol,
    long_notional_usd: input.longNotionalUsd,
    short_notional_usd: input.shortNotionalUsd,
    long_collateral_usd: input.longCollateralUsd,
    short_collateral_usd: input.shortCollateralUsd,
    carry_cost_bps_long: input.carryCostBps.long,
    carry_cost_bps_short: input.carryCostBps.short,
    oracle_price_usd: Number.isNaN(input.oraclePriceUsd) ? null : input.oraclePriceUsd,
    wallet_sol: input.walletSol,
    wallet_reserve_sol: input.walletReserveSol,
    wallet_usdc: input.walletUsdc,
    target_delta_sol: input.targetDeltaSol,
    band_sol: input.bandSol,
    carry_cap_bps: input.carryCapBps,
    max_hedge_notional_usd: input.maxHedgeNotionalUsd,
    min_collateral_ratio: input.minCollateralRatio,
    target_collateral_ratio: input.targetCollateralRatio,
    now_ms: input.nowMs,
    last_action_at_ms: input.lastActionAtMs,
    cooldown_ms: input.cooldownMs,
  };
  const d: Record<string, unknown> = { action: decision.action };
  if ('sizeUsd' in decision) d.size_usd = decision.sizeUsd;
  if ('entirePosition' in decision) d.entire_position = decision.entirePosition;
  if ('withdrawCollateralUsd' in decision) d.withdraw_collateral_usd = decision.withdrawCollateralUsd;
  if ('collateralTokens' in decision) d.collateral_tokens = decision.collateralTokens;
  if ('adjustSol' in decision) d.adjust_sol = decision.adjustSol;
  return JSON.stringify({ input: flat, decision: d });
});

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, lines.join('\n') + '\n');
console.log(`wrote ${lines.length} vectors to ${OUT}`);
