/**
 * H13 walk-forward ML composite (ceiling test), HYPOTHESES §5.
 *   Features at age a (point-in-time), target = net return under XB at L = 2 s (PRIMARY setting),
 *   gradient boosting retrained weekly on the trailing 14 days, trade when prediction > θ.
 *   Grid: a ∈ {60, 300} s, θ ∈ {0, +5 %}, 3 configs listed in advance -> 12 variants.
 * The 3 configs (fixed before any run): C1 depth 2 / 150 trees / lr 0.05; C2 depth 3 / 300 / 0.03;
 * C3 depth 4 / 400 / 0.02 / min leaf 200. All: 32 quantile bins, min leaf 100 (C3: 200), row subsample 0.8.
 * Training rows must have their XB exit resolved before the retrain time (entry >= 1 h before it).
 *
 *   node --max-old-space-size=12000 --import tsx research/memecoins/backtest/h13.ts --tape=... --g1=strict
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadTape, lastAtOrBefore, dayOf } from './tape.ts';
import { buildCtx, type Ctx } from './context.ts';
import { simulate, defaultCfg, EXITS, type Signal } from './sim.ts';
import { summarize } from './stats.ts';
import { appendLedger, codeHash, type LedgerRow } from './ledger.ts';
import { SETTINGS, type VariantResult } from './run-futility.ts';
import { organicFlags } from './signals.ts';
import { INIT_VSOL_F, RS_GRAD_F, TOTAL_SUPPLY_F } from './curve.ts';

function arg(name: string, def?: string) { const a = process.argv.find((x) => x.startsWith(`--${name}=`)); return a ? a.slice(name.length + 3) : def; }

export const FEATURES = ['nTrades', 'nBuys', 'nSells', 'buySol', 'sellSol', 'progress', 'uBuyers', 'uSellers', 'bsCount', 'bsSol', 'priceChgHalf', 'ddFromPeak',
  'tradesLast10s', 'tradesLast30s', 'creatorBuySol', 'creatorSoldFrac', 'bundleN', 'bundleTokShare', 'sniperN', 'sniperTokShare',
  'orgBuyers', 'orgNetSol', 'orgHHI', 'ringFirst20', 'botTradeShare', 'top10Share', 'wstarBuyers', 'hourUTC', 'creatorPrior', 'creatorPriorGrads'];

export function features(ctx: Ctx, org: Uint8Array, m: number, sigIdx: number, tSig: number): number[] {
  const { tape } = ctx; const lo = tape.off[m];
  const creator = ctx.creatorId[m]; const d = ctx.mintDay[m];
  const bundle = ctx.bundleOf(m), snip = ctx.sniperOf(m), ring = ctx.ring.get(d), bot = ctx.bot.get(d), ws = ctx.wstar.get(d);
  let nB = 0, nS = 0, bS = 0, sS = 0, cB = 0, cBt = 0, cSt = 0, bundleTok = 0, snipTok = 0, orgNet = 0, botN = 0, last10 = 0, last30 = 0;
  const buyers = new Set<number>(), sellers = new Set<number>(), orgBuy = new Map<number, number>(), hold = new Map<number, number>(), wsB = new Set<number>();
  let peak = 0, halfS = INIT_VSOL_F; const halfT = ctx.t0[m] + (tSig - ctx.t0[m]) / 2;
  const first20: number[] = [];
  for (let i = lo; i <= sigIdx; i++) {
    const w = tape.trader[i], b = tape.isBuy[i] === 1;
    if (b) { nB++; bS += tape.sol[i]; buyers.add(w); if (first20.length < 20 && w !== creator && !first20.includes(w)) first20.push(w); }
    else { nS++; sS += tape.sol[i]; sellers.add(w); }
    if (w === creator) { if (b) { cB += tape.sol[i]; cBt += tape.tok[i]; } else cSt += tape.tok[i]; }
    if (b && bundle.has(w)) bundleTok += tape.tok[i];
    if (b && snip.has(w)) snipTok += tape.tok[i];
    if (org[i]) { orgNet += b ? tape.sol[i] : -tape.sol[i]; if (b) orgBuy.set(w, (orgBuy.get(w) ?? 0) + tape.sol[i]); }
    if (bot?.has(w)) botN++;
    if (b && ws?.has(w)) wsB.add(w);
    hold.set(w, (hold.get(w) ?? 0) + (b ? tape.tok[i] : -tape.tok[i]));
    if (tape.vSol[i] > peak) peak = tape.vSol[i];
    if (tape.tick[i] <= halfT) halfS = tape.vSol[i];
    if (tape.tick[i] > tSig - ctx.secToTicks(10)) last10++;
    if (tape.tick[i] > tSig - ctx.secToTicks(30)) last30++;
  }
  const n = nB + nS; const vS = sigIdx >= lo ? tape.vSol[sigIdx] : INIT_VSOL_F;
  let oTot = 0; for (const v of orgBuy.values()) oTot += v; let hhi = 0; for (const v of orgBuy.values()) hhi += (v / (oTot || 1)) ** 2;
  const top10 = [...hold.values()].filter((v) => v > 0).sort((a, b) => b - a).slice(0, 10).reduce((a, b) => a + b, 0);
  const list = ctx.creatorLaunches.get(creator) ?? []; const t = ctx.t0[m], day30 = 30 * 86_400 / ctx.tickSec;
  const prior = list.filter((x) => ctx.t0[x] < t && ctx.t0[x] >= t - day30);
  return [n, nB, nS, bS / 1e9, sS / 1e9, (vS - INIT_VSOL_F) / RS_GRAD_F, buyers.size, sellers.size, nB / (nS + 1), bS / (sS + 1e7),
    (vS / halfS) ** 2, peak > 0 ? (vS / peak) ** 2 : 1, last10, last30, cB / 1e9, cBt > 0 ? cSt / cBt : 0, bundle.size, bundleTok / TOTAL_SUPPLY_F, snip.size, snipTok / TOTAL_SUPPLY_F,
    orgBuy.size, orgNet / 1e9, hhi, ring ? first20.filter((w) => ring.has(w)).length : 0, n ? botN / n : 0, top10 / TOTAL_SUPPLY_F, wsB.size,
    new Date((tape.epoch + tSig * ctx.tickSec) * 1000).getUTCHours(), prior.length, prior.filter((x) => ctx.completeTick[x] < t).length];
}

// ---------------------------------------------------------------- histogram gradient boosting (squared loss)
interface Cfg { depth: number; trees: number; lr: number; minLeaf: number }
export const CONFIGS: Record<string, Cfg> = { C1: { depth: 2, trees: 150, lr: 0.05, minLeaf: 100 }, C2: { depth: 3, trees: 300, lr: 0.03, minLeaf: 100 }, C3: { depth: 4, trees: 400, lr: 0.02, minLeaf: 200 } };
type Node = { f: number; thr: number; l: Node | number; r: Node | number };

export function fitGBM(X: number[][], y: number[], cfg: Cfg, seed: number, importance?: Float64Array) {
  const nF = X[0].length, n = y.length, NB = 32;
  const edges: number[][] = [];
  for (let f = 0; f < nF; f++) { const v = X.map((r) => r[f]).sort((a, b) => a - b); const e: number[] = []; for (let b = 1; b < NB; b++) e.push(v[Math.floor((b * (n - 1)) / NB)]); edges.push([...new Set(e)]); }
  const bin = X.map((r) => r.map((v, f) => { const e = edges[f]; let lo = 0, hi = e.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (v <= e[mid]) hi = mid; else lo = mid + 1; } return lo; }));
  const base = y.reduce((a, b) => a + b, 0) / n;
  const pred = new Float64Array(n).fill(base);
  const trees: Node[] = [];
  let s = seed >>> 0; const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  const build = (idx: number[], res: Float64Array, depth: number): Node | number => {
    const sum = idx.reduce((a, i) => a + res[i], 0);
    if (depth === 0 || idx.length < 2 * cfg.minLeaf) return sum / idx.length;
    let best = { gain: 0, f: -1, b: -1 };
    const tot2 = (sum * sum) / idx.length;
    for (let f = 0; f < nF; f++) {
      const nb = edges[f].length + 1; const cs = new Float64Array(nb), cc = new Int32Array(nb);
      for (const i of idx) { cs[bin[i][f]] += res[i]; cc[bin[i][f]]++; }
      let ls = 0, lc = 0;
      for (let b = 0; b < nb - 1; b++) {
        ls += cs[b]; lc += cc[b]; const rc = idx.length - lc;
        if (lc < cfg.minLeaf || rc < cfg.minLeaf) continue;
        const g = (ls * ls) / lc + ((sum - ls) * (sum - ls)) / rc - tot2;
        if (g > best.gain) best = { gain: g, f, b };
      }
    }
    if (best.f < 0) return sum / idx.length;
    if (importance) importance[best.f] += best.gain;
    const L: number[] = [], R: number[] = [];
    for (const i of idx) (bin[i][best.f] <= best.b ? L : R).push(i);
    return { f: best.f, thr: edges[best.f][best.b], l: build(L, res, depth - 1), r: build(R, res, depth - 1) };
  };
  const res = new Float64Array(n);
  const evalT = (t: Node | number, x: number[]): number => (typeof t === 'number' ? t : evalT(x[t.f] <= t.thr ? t.l : t.r, x));
  for (let k = 0; k < cfg.trees; k++) {
    for (let i = 0; i < n; i++) res[i] = y[i] - pred[i];
    const idx: number[] = []; for (let i = 0; i < n; i++) if (rnd() < 0.8) idx.push(i);
    const t = build(idx, res, cfg.depth);
    if (typeof t === 'number') break;
    trees.push(t);
    for (let i = 0; i < n; i++) pred[i] += cfg.lr * evalT(t, X[i]);
  }
  return (x: number[]) => base + trees.reduce((a, t) => a + cfg.lr * evalT(t, x), 0);
}

async function main() {
  const t0 = Date.now(); const log = (s: string) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s] ${s}`);
  const g1 = (arg('g1', 'fromStart') as 'strict' | 'fromStart' | 'all');
  const g5 = (arg('g5', 'guard') as 'guard' | 'drop');
  const tag = `${g1}.${g5}`;
  const outDir = arg('out', 'research/memecoins/results/raw')!;
  const tape = loadTape(arg('tape', 'research/memecoins/data/public/cache/vdw')!);
  const ctx = buildCtx(tape, { g1Mode: g1, warmupDays: 7, g5Mode: g5 }, log);
  const org = organicFlags(ctx);
  const hash = codeHash();
  const results: VariantResult[] = []; const ledger: LedgerRow[] = [];
  for (const age of [60, 300]) {
    // rows: every universe coin not complete by age a (all days: training may use warm-up days)
    const rows: { m: number; sig: Signal; day: number; x: number[]; y: number; kill: number; killOk: boolean; fills: Record<string, ReturnType<typeof simulate>> }[] = [];
    for (let m = 0; m < ctx.nM; m++) {
      if (!ctx.universe[m]) continue;
      const tSig = ctx.t0[m] + ctx.secToTicks(age);
      const sigIdx = lastAtOrBefore(tape.tick, tape.off[m], tape.off[m + 1], Math.floor(tSig));
      const ci = tape.meta[m].completeIdx; if (ci >= 0 && sigIdx >= ci) continue;
      const sig = { m, tSig, sigIdx };
      const fills: Record<string, ReturnType<typeof simulate>> = {};
      for (const st of Object.keys(SETTINGS)) fills[st] = simulate(tape, sig, EXITS.XB, defaultCfg(SETTINGS[st]));
      if (fills.PRIMARY.status !== 'ok') continue;
      rows.push({ m, sig, day: dayOf(tape, tSig), x: features(ctx, org, m, sigIdx, tSig), y: fills.PRIMARY.ret, kill: fills.KILL.ret, killOk: fills.KILL.status === 'ok', fills });
    }
    log(`age ${age}: ${rows.length} rows`);
    const firstEvalDay = ctx.firstDay + 14;
    for (const [cid, cfg] of Object.entries(CONFIGS)) {
      const preds = new Map<number, number>(); // row index -> prediction
      for (let wk = firstEvalDay; wk <= ctx.lastDay; wk += 7) {
        const trainEnd = wk * 86_400; // retrain at 00:00 UTC of the week's first day
        const tr = rows.map((r, i) => i).filter((i) => rows[i].day >= wk - 14 && rows[i].day < wk && (tape.epoch + rows[i].sig.tSig * ctx.tickSec) < trainEnd - 3600);
        if (tr.length < 500) continue;
        const model = fitGBM(tr.map((i) => rows[i].x), tr.map((i) => rows[i].y), cfg, wk);
        for (let i = 0; i < rows.length; i++) if (rows[i].day >= wk && rows[i].day < wk + 7 && ctx.signalOk(rows[i].sig.tSig)) preds.set(i, model(rows[i].x));
        log(`  ${cid} week ${new Date(wk * 864e5).toISOString().slice(0, 10)}: trained on ${tr.length}`);
      }
      for (const theta of [0, 0.05]) {
        const sel = [...preds.entries()].filter(([, p]) => p > theta).map(([i]) => i);
        const variantId = `H13|a=${age};theta=${theta};cfg=${cid}|XB`;
        const vr: VariantResult = { hyp: 'H13', variantId, params: { a: age, theta, cfg: cid }, exit: 'XB', nSignals: sel.length, statuses: {}, settings: {} };
        for (const st of Object.keys(SETTINGS)) {
          const ok = sel.map((i) => rows[i].fills[st]).filter((f) => f.status === 'ok');
          const sm = summarize(ok.map((f) => f.ret), ok.map((f) => f.pnl), ok.map((f) => f.basis), ok.map((f) => f.day));
          vr.settings[st] = { ...sm, viaPoolShare: ok.filter((f) => f.viaPool).length / Math.max(1, ok.length), abandonedPnlSol: 0 };
          const c = { ...defaultCfg(), ...SETTINGS[st] };
          ledger.push({ hypothesis: 'H13', variantId, params: JSON.stringify(vr.params), exit: 'XB', filterSet: 'none', latency: c.L, placement: c.placement, model: c.model, sizeSol: 0.1, split: `public-vdw-futility:${tag}`, n: sm.n, mean: sm.mean, lo: sm.lo, hi: sm.hi, countsTowardK: st === 'KILL' });
        }
        // also the out-of-fold universe mean (all predicted rows) for reference
        const allOk = [...preds.keys()].map((i) => rows[i].fills.PRIMARY);
        (vr as unknown as Record<string, unknown>).oofUniverseMean = allOk.reduce((a, f) => a + f.ret, 0) / Math.max(1, allOk.length);
        results.push(vr);
        log(`${variantId}: n=${vr.settings.KILL.n} KILL mean=${vr.settings.KILL.mean.toFixed(4)} [${vr.settings.KILL.lo.toFixed(4)},${vr.settings.KILL.hi.toFixed(4)}] PRIMARY mean=${vr.settings.PRIMARY.mean.toFixed(4)}`);
      }
    }
  }
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, `H13.${tag}.json`), JSON.stringify({ hyp: 'H13', g1, g5, codeHash: hash, features: FEATURES, results }, null, 1));
  if (!process.argv.includes('--no-ledger')) appendLedger(ledger, hash);
  log('H13 done');
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) main();
