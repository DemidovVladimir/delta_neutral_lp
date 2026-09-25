/**
 * Reserve-chain reconstruction (PROTOCOL G1 + G4) shared by all adapters.
 *
 * Input: one mint's raw rows (arrival order), each with post-trade virtual SOL.
 * Output: execution order, per-trade unobserved-flow gap, post-trade vTok, completion index.
 *
 * Pre-trade vSol of a row = post - sol (buy) or post + sol (sell). Within one clock tick the
 * execution order is the order that makes pre(i) == post(i-1). Rows are linked into chains
 * inside the tick; the chain that continues the current state goes first, others follow in
 * arrival order, and every break is recorded as a gap (unobserved net SOL flow).
 */
import { INIT_VSOL_F, INIT_VTOK_F, VTOK_COMPLETE_F } from './curve.ts';

export const CHAIN_TOL = 2; // lamports (float rounding of SOL-denominated REAL columns)
export const COMPLETE_VSOL = 115_005_000_000; // curve completion ~115.005359 SOL (tolerant threshold)

export interface RawRow { tick: number; ord: number; isBuy: boolean; sol: number; tok: number; vSolPost: number; trader: number }

export interface ChainOut {
  order: number[];      // indices into rows, execution order
  gap: number[];        // per output position: unobserved net SOL before it (0 = continuous)
  vTok: number[];       // per output position: post-trade virtual tokens
  chainFromStart: boolean;
  gaps: number;
  gapAbs: number;
  completePos: number;  // output position of the completing trade, -1 if none
}

const pre = (r: RawRow) => (r.isBuy ? r.vSolPost - r.sol : r.vSolPost + r.sol);

export function buildChain(rows: RawRow[]): ChainOut {
  // group by tick (rows sorted by tick, then arrival)
  const idx = rows.map((_, i) => i).sort((a, b) => rows[a].tick - rows[b].tick || rows[a].ord - rows[b].ord);
  const order: number[] = [];
  const gap: number[] = [];
  let cur = INIT_VSOL_F;
  let first = true;
  let chainFromStart = true;
  let gaps = 0, gapAbs = 0;
  let g = 0;
  while (g < idx.length) {
    let h = g;
    while (h < idx.length && rows[idx[h]].tick === rows[idx[g]].tick) h++;
    const grp = idx.slice(g, h);
    if (grp.length === 1) {
      const r = rows[grp[0]];
      const d = pre(r) - cur;
      const isGap = Math.abs(d) > CHAIN_TOL;
      if (first && isGap) chainFromStart = false;
      order.push(grp[0]); gap.push(isGap ? d : 0);
      if (isGap) { gaps++; gapAbs += Math.abs(d); }
      cur = r.vSolPost;
    } else {
      // link rows: succ[a] = b if pre(b) == post(a)
      const used = new Set<number>();
      const remaining = new Set(grp);
      while (remaining.size) {
        // prefer the row continuing cur
        let pick = -1;
        for (const i of remaining) if (Math.abs(pre(rows[i]) - cur) <= CHAIN_TOL) { pick = i; break; }
        let isGap = false;
        if (pick < 0) {
          // choose a chain head: a remaining row with no remaining predecessor; earliest arrival
          for (const i of remaining) {
            const p = pre(rows[i]);
            let hasPred = false;
            for (const j of remaining) if (j !== i && Math.abs(rows[j].vSolPost - p) <= CHAIN_TOL) { hasPred = true; break; }
            if (!hasPred) { pick = i; break; }
          }
          if (pick < 0) pick = remaining.values().next().value as number; // cycle (should not happen)
          isGap = true;
        }
        const r = rows[pick];
        const d = pre(r) - cur;
        if (first && isGap) chainFromStart = false;
        order.push(pick); gap.push(isGap ? d : 0);
        if (isGap) { gaps++; gapAbs += Math.abs(d); }
        cur = r.vSolPost;
        remaining.delete(pick); used.add(pick);
        first = false;
      }
    }
    first = false;
    g = h;
  }
  // vTok: exact token chain while continuous; at a gap, re-anchor with the carried product K_eff
  const vTok: number[] = new Array(order.length);
  let vS = INIT_VSOL_F, vT = INIT_VTOK_F;
  let completePos = -1;
  for (let p = 0; p < order.length; p++) {
    const r = rows[order[p]];
    const preS = pre(r);
    if (gap[p] !== 0 || (p === 0 && Math.abs(preS - INIT_VSOL_F) > CHAIN_TOL)) {
      const K = vS * vT;
      vT = K / preS; vS = preS;
    }
    vT = r.isBuy ? vT - r.tok : vT + r.tok;
    vS = r.vSolPost;
    vTok[p] = vT;
    if (completePos < 0 && (r.vSolPost >= COMPLETE_VSOL || vT <= VTOK_COMPLETE_F + 1e6)) completePos = p;
  }
  return { order, gap, vTok, chainFromStart, gaps, gapAbs, completePos };
}
