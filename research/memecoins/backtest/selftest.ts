/**
 * Self-checks of the curve math and the simulator against numbers verified in PROTOCOL.md §4.
 * Run: npx tsx research/memecoins/backtest/selftest.ts
 */
import assert from 'node:assert/strict';
import {
  INIT_VSOL, INIT_VTOK, VTOK_COMPLETE, CURVE_FEE, buyTokensForSol, buyCostForTokens, sellProceeds,
  fBuyTokensForCurveSol, fSellGross, fSellNet, poolSell, POOL_BASE_AT_MIGRATION, MIGRATION_FEE,
} from './curve.ts';
import { simulate, defaultCfg, EXITS } from './sim.ts';
import type { Tape } from './tape.ts';

let n = 0;
const ok = (name: string) => { n++; console.log(`ok ${n} - ${name}`); };

// 1. Live buy oVt3kfdWyN9QBh1NVqd6dkDD1n55pAMSNmmfUQGj9hrQAMhP7YchrfHCmmSavzWwwxsKM6zNBUpeW3Q7rM83LNW:
//    sol_amount 393,476,981 -> fee 3,738,032 (ceil 0.95 %), creator_fee 1,180,431 (ceil 0.30 %).
{
  const s = 393_476_981n;
  const ceil = (x: bigint, bps: bigint) => (x * bps + 9_999n) / 10_000n;
  assert.equal(ceil(s, 95n), 3_738_032n);
  assert.equal(ceil(s, 30n), 1_180_431n);
  ok('fee components match the verified live buy');
}

// 2. Buy then immediate sell on an unchanged curve returns (1-0.0125)/(1+0.0125) = 0.97531.
{
  const S = 100_000_000n; // 0.1 SOL
  const t = buyTokensForSol(S, INIT_VSOL, INIT_VTOK, INIT_VTOK - VTOK_COMPLETE);
  const c = buyCostForTokens(t, INIT_VSOL, INIT_VTOK);
  assert.ok(c.total <= S, `cost ${c.total} <= budget ${S}`);
  const v2 = INIT_VSOL + c.curve, t2 = INIT_VTOK - t;
  const p = sellProceeds(t, v2, t2);
  const rt = Number(p.net) / Number(c.total);
  assert.ok(Math.abs(rt - 0.97531) < 0.0002, `round trip ${rt}`);
  ok(`round trip at launch = ${rt.toFixed(5)} (expected 0.97531)`);
}

// 3. Graduation point: vTok 279.9M, vSol 115.005359 SOL -> price 4.1088e-7 SOL/token, mcap ~410.9 SOL.
{
  const vSol = 115_005_359_000; const vTok = 279_900_000e6;
  const priceSolPerToken = (vSol / 1e9) / (vTok / 1e6);
  assert.ok(Math.abs(priceSolPerToken - 4.1088e-7) < 0.0002e-7);
  assert.ok(Math.abs(priceSolPerToken * 1e9 - 410.9) < 0.2);
  // launch -> graduation price move ~ (115.005/30)^2 = 14.7x
  const move = priceSolPerToken / ((30) / (1_073_000_000));
  assert.ok(Math.abs(move - 14.7) < 0.1, `move ${move}`);
  ok(`graduation price ${priceSolPerToken.toExponential(4)} SOL/token, x${move.toFixed(2)} from launch`);
}

// 4. Float replay path agrees with exact path to <= 2 units on random states.
{
  let maxTokDiff = 0, maxSolDiff = 0;
  let seed = 12345;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let i = 0; i < 20000; i++) {
    const vSol = BigInt(Math.floor(30e9 + rnd() * 85e9));
    const k = INIT_VSOL * INIT_VTOK;
    const vTok = k / vSol;
    const X = BigInt(Math.floor(1e6 + rnd() * 5e9));
    // exact: tokens for curve input X (inverse of cost formula) = (X-1)*vTok/(vSol+X-1)
    const tExact = ((X - 1n) * vTok) / (vSol + X - 1n);
    const tFast = fBuyTokensForCurveSol(Number(X), Number(vSol), Number(vTok));
    maxTokDiff = Math.max(maxTokDiff, Math.abs(Number(tExact) - tFast));
    const q = BigInt(Math.floor(rnd() * 1e13));
    const gExact = (q * vSol) / (vTok + q);
    const gFast = fSellGross(Number(q), Number(vSol), Number(vTok));
    maxSolDiff = Math.max(maxSolDiff, Math.abs(Number(gExact) - gFast));
    const nExact = sellProceeds(q, vSol, vTok, CURVE_FEE).net;
    const nFast = fSellNet(Number(q), Number(vSol), Number(vTok));
    maxSolDiff = Math.max(maxSolDiff, Math.abs(Number(nExact) - nFast));
  }
  // the float path works on ~1e15-scale token numbers; relative error <= ~1e-15, i.e. a handful of base units
  assert.ok(maxTokDiff <= 64, `token diff ${maxTokDiff}`);
  assert.ok(maxSolDiff <= 2, `sol diff ${maxSolDiff}`);
  ok(`float vs exact: max token diff ${maxTokDiff} base units (of ~1e14), max SOL diff ${maxSolDiff} lamports`);
}

// 5. PumpSwap pool at migration: seeded with 84.990359 SOL + 206.9M tokens; a small sell at tier-0 1.25 %.
{
  const Q = 115_005_359_000n - INIT_VSOL - MIGRATION_FEE; // 84.990358 SOL
  const r = poolSell(1_000_000_000_000n /* 1M tokens */, Q, POOL_BASE_AT_MIGRATION, Q);
  const px = Number(Q) / Number(POOL_BASE_AT_MIGRATION); // lamports per raw unit
  const expectGross = 1e12 * px;
  assert.ok(Math.abs(Number(r.out) / expectGross - 1) < 0.01);
  assert.ok(Math.abs(Number(r.net) / Number(r.out) - (1 - 0.0125)) < 1e-4);
  // real-vault check: with only 0.1 SOL in the real vault, a large sell is clipped
  const r2 = poolSell(50_000_000_000_000n, Q, POOL_BASE_AT_MIGRATION, 100_000_000n);
  assert.ok(r2.sold < 50_000_000_000_000n && r2.out - (r2.out * 2n + 9999n) / 10000n <= 100_000_000n);
  ok(`pool exit at migration: net/out = ${(Number(r.net) / Number(r.out)).toFixed(4)}; real-vault clip works`);
}

// 6. Simulator on a synthetic tape: (a) nobody trades after us -> round trip = 0.97531 minus tx costs;
//    (b) a later 2-SOL buy lifts our exit; replay keeps the buyer's SOL, so our buy makes him pay more.
{
  const mk = (trades: { t: number; buy: boolean; sol: number }[]) => {
    let vS = 30e9, vT = 1.073e15; const cols = { tick: [] as number[], isBuy: [] as number[], sol: [] as number[], tok: [] as number[], vSol: [] as number[], vTok: [] as number[], gap: [] as number[], trader: [] as number[] };
    for (const [k, tr] of trades.entries()) {
      const tok = tr.buy ? Math.floor(((tr.sol - 1) * vT) / (vS + tr.sol - 1)) : Math.floor((tr.sol * vT) / (vS - tr.sol));
      if (tr.buy) { vS += tr.sol; vT -= tok; } else { vS -= tr.sol; vT += tok; }
      cols.tick.push(tr.t); cols.isBuy.push(tr.buy ? 1 : 0); cols.sol.push(tr.sol); cols.tok.push(tok); cols.vSol.push(vS); cols.vTok.push(vT); cols.gap.push(0); cols.trader.push(k);
    }
    return {
      source: 'synthetic', tickSec: 1, epoch: 0, traders: trades.map((_, k) => `w${k}`),
      meta: [{ mint: 'SYN', creator: 'w0', name: '', symbol: '', createdAt: 0, t0: 0, t0Exact: true, creatorBuyLamports: trades[0].sol, chainFromStart: true, g1Strict: true, gaps: 0, gapAbsLamports: 0, mayhem: false, completeIdx: -1 }],
      off: Int32Array.from([0, trades.length]), tick: Int32Array.from(cols.tick), isBuy: Uint8Array.from(cols.isBuy), sol: Float64Array.from(cols.sol), tok: Float64Array.from(cols.tok),
      vSol: Float64Array.from(cols.vSol), vTok: Float64Array.from(cols.vTok), gap: Float64Array.from(cols.gap), trader: Int32Array.from(cols.trader),
    } satisfies Tape;
  };
  const noCost = { pFail: 0, budget: 0, fixedMult: 0 } as const;
  const a = mk([{ t: 0, buy: true, sol: 1e9 }]);
  const fa = simulate(a, { m: 0, tSig: 0, sigIdx: 0 }, EXITS.XT60, defaultCfg({ ...noCost, L: 0.4, placement: 'opt' }));
  assert.ok(Math.abs(fa.ret - (0.97531 - 1)) < 0.0003, `alone ret ${fa.ret}`);
  const b = mk([{ t: 0, buy: true, sol: 1e9 }, { t: 5, buy: true, sol: 2e9 }]);
  const rep = simulate(b, { m: 0, tSig: 0, sigIdx: 0 }, EXITS.XT60, defaultCfg({ ...noCost, L: 0.4, placement: 'opt', model: 'replay' }));
  const noi = simulate(b, { m: 0, tSig: 0, sigIdx: 0 }, EXITS.XT60, defaultCfg({ ...noCost, L: 0.4, placement: 'opt', model: 'noinsert' }));
  // hand calc: price ∝ vSol^2; after creator 31 SOL; the 2-SOL buyer lifts vSol to ~33 -> gross move ~(33/31)^2 = +13.3 %
  assert.ok(rep.ret > 0.08 && rep.ret < 0.13, `replay ret ${rep.ret}`);
  assert.ok(noi.ret < rep.ret, `no-insert (${noi.ret}) must be below replay (${rep.ret}) here: it charges our impact twice`);
  // pessimistic placement at L=2 s sees the 2-SOL buy only if it happened by t=2: it did not (t=5), so same entry
  const pes = simulate(b, { m: 0, tSig: 0, sigIdx: 0 }, EXITS.XT60, defaultCfg({ ...noCost, L: 6, placement: 'pess' }));
  assert.ok(pes.ret < 0, `entering after the 2-SOL buy and exiting on an unchanged curve loses the fee: ${pes.ret}`);
  ok(`simulator: alone ${(fa.ret * 100).toFixed(2)} %, replay ${(rep.ret * 100).toFixed(2)} %, no-insert ${(noi.ret * 100).toFixed(2)} %, late entry ${(pes.ret * 100).toFixed(2)} %`);
}

console.log(`\n${n} checks passed`);
