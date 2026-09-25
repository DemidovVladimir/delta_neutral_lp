/**
 * Standalone filter tests (HYPOTHESES §6 (i)) on a public tape, plus B_naive.
 *
 *   node --max-old-space-size=12000 --import tsx research/memecoins/backtest/run-filters.ts \
 *     --tape=research/memecoins/data/public/cache/vdw --g1=strict [--redpump=research/memecoins/data/public/redpump/red_pump_2026_v1_launches.jsonl.gz]
 *
 * Naive entry into every universe coin at age 30 s and 120 s (+L), exits XT300 and XB (4 cells),
 * settings PRIMARY (verdict for filters) and KILL. Per filter grid point and cell:
 * Δ = mean(flagged) - mean(unflagged), paired day-block bootstrap 95 % CI.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { loadTape, lastAtOrBefore } from './tape.ts';
import { buildCtx, type Ctx } from './context.ts';
import { simulate, defaultCfg, EXITS, type Signal, type Fill } from './sim.ts';
import { pairedDiffBootstrap, summarize } from './stats.ts';
import { appendLedger, codeHash, type LedgerRow } from './ledger.ts';
import { SETTINGS } from './run-futility.ts';
import * as S from './signals.ts';

function arg(name: string, def?: string) { const a = process.argv.find((x) => x.startsWith(`--${name}=`)); return a ? a.slice(name.length + 3) : def; }

function naiveSignals(ctx: Ctx, age: number): Signal[] {
  const out: Signal[] = []; const { tape } = ctx;
  for (let m = 0; m < ctx.nM; m++) {
    if (!ctx.universe[m]) continue;
    const tSig = ctx.t0[m] + ctx.secToTicks(age);
    const sigIdx = lastAtOrBefore(tape.tick, tape.off[m], tape.off[m + 1], Math.floor(tSig));
    const ci = tape.meta[m].completeIdx;
    if (ci >= 0 && sigIdx >= ci) continue;
    if (!ctx.signalOk(tSig)) continue;
    out.push({ m, tSig, sigIdx });
  }
  return out;
}

interface FilterDef { id: string; params: Record<string, unknown>; flag: (m: number, s: Signal) => boolean | null }

async function main() {
  const t0 = Date.now(); const log = (s: string) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s] ${s}`);
  const g1 = (arg('g1', 'fromStart') as 'strict' | 'fromStart' | 'all');
  const g5 = (arg('g5', 'guard') as 'guard' | 'drop');
  const tag = `${g1}.${g5}`;
  const outDir = arg('out', 'research/memecoins/results/raw')!;
  const tape = loadTape(arg('tape', 'research/memecoins/data/public/cache/vdw')!);
  const ctx = buildCtx(tape, { g1Mode: g1, warmupDays: 7, g5Mode: g5 }, log);
  const hash = codeHash();

  // RED-PUMP socials (F08) joined on mint
  const socials = new Map<string, { x: boolean; w: boolean; tg: boolean }>();
  const rp = arg('redpump', 'research/memecoins/data/public/redpump/red_pump_2026_v1_launches.jsonl.gz')!;
  if (fs.existsSync(rp)) {
    for (const line of zlib.gunzipSync(fs.readFileSync(rp)).toString('utf8').split('\n')) {
      if (!line) continue; const j = JSON.parse(line); if (!socials.has(j.mint)) socials.set(j.mint, { x: !!j.has_twitter, w: !!j.has_website, tg: !!j.has_telegram });
    }
  }
  log(`RED-PUMP socials: ${socials.size} mints`);

  const f06 = S.makeF06(ctx);
  const f02cache = new Map<string, Int32Array>();
  const f02idx = (x: number, T: number) => {
    const k = `${x}|${T}`; let a = f02cache.get(k);
    if (!a) { a = new Int32Array(ctx.nM).fill(-1); for (let m = 0; m < ctx.nM; m++) if (ctx.universe[m]) a[m] = S.F02flagIdx(ctx, m, { x, T }); f02cache.set(k, a); }
    return a;
  };
  const filters: FilterDef[] = [];
  for (const b of [1, 3]) for (const s of [10, 25]) filters.push({ id: 'F01', params: { b, s }, flag: (m, sg) => S.F01(ctx, m, sg, { b, s }) });
  for (const x of [50, 90]) for (const T of [60, 600]) filters.push({ id: 'F02a', params: { x, T }, flag: (m, sg) => { const i = f02idx(x, T)[m]; return i >= 0 && i <= sg.sigIdx; } });
  for (const h of [5, 15]) filters.push({ id: 'F03', params: { h }, flag: (m, sg) => S.F03(ctx, m, sg, { h }) });
  for (const c of [25, 40]) filters.push({ id: 'F04', params: { c }, flag: (m, sg) => S.F04(ctx, m, sg, { c }) });
  for (const n of [5, 20]) filters.push({ id: 'F05', params: { n }, flag: (m, sg) => S.F05(ctx, m, sg, { n }) });
  filters.push({ id: 'F06', params: {}, flag: (m, sg) => f06(m, sg) });
  for (const w of [10, 30]) filters.push({ id: 'F07', params: { w, note: 'WT2 only' }, flag: (m, sg) => S.F07(ctx, m, sg, { w }) });
  filters.push({ id: 'F08', params: { v: 'no X/TG/website' }, flag: (m) => { const s = socials.get(tape.meta[m].mint); return s ? !(s.x || s.w || s.tg) : null; } });
  filters.push({ id: 'F08', params: { v: 'no Telegram' }, flag: (m) => { const s = socials.get(tape.meta[m].mint); return s ? !s.tg : null; } });
  filters.push({ id: 'NOCB', params: { v: 'no creator buy (H17 filter use)' }, flag: (m) => (tape.meta[m].chainFromStart ? !tape.meta[m].t0Exact : null) });

  const results: unknown[] = []; const ledger: LedgerRow[] = []; const naive: unknown[] = [];
  const f02b: unknown[] = [];
  for (const age of [30, 120]) {
    const sigs = naiveSignals(ctx, age);
    log(`naive age ${age}s: ${sigs.length} signals`);
    for (const ex of ['XT300', 'XB']) {
      for (const st of ['PRIMARY', 'KILL']) {
        const cfg = defaultCfg(SETTINGS[st]);
        const fills: Fill[] = sigs.map((s) => simulate(tape, s, EXITS[ex], cfg));
        const okI = fills.map((f, i) => (f.status === 'ok' ? i : -1)).filter((i) => i >= 0);
        const sm = summarize(okI.map((i) => fills[i].ret), okI.map((i) => fills[i].pnl), okI.map((i) => fills[i].basis), okI.map((i) => fills[i].day));
        naive.push({ age, exit: ex, setting: st, ...sm });
        log(`  B_naive age=${age} ${ex} ${st}: n=${sm.n} mean=${sm.mean.toFixed(4)} [${sm.lo.toFixed(4)},${sm.hi.toFixed(4)}] median=${sm.median.toFixed(4)} solW=${sm.solWeighted.toFixed(4)}`);
        for (const f of filters) {
          const fa: number[] = [], fd: number[] = [], ua: number[] = [], ud: number[] = [];
          for (const i of okI) {
            const fl = f.flag(sigs[i].m, sigs[i]); if (fl === null) continue;
            if (fl) { fa.push(fills[i].ret); fd.push(fills[i].day); } else { ua.push(fills[i].ret); ud.push(fills[i].day); }
          }
          const d = fa.length && ua.length ? pairedDiffBootstrap(fd, fa, ud, ua) : { diff: NaN, lo: NaN, hi: NaN };
          const mf = fa.length ? fa.reduce((a, b) => a + b, 0) / fa.length : NaN, mu = ua.length ? ua.reduce((a, b) => a + b, 0) / ua.length : NaN;
          results.push({ filter: f.id, params: f.params, age, exit: ex, setting: st, nFlagged: fa.length, nUnflagged: ua.length, meanFlagged: mf, meanUnflagged: mu, diff: d.diff, lo: d.lo, hi: d.hi });
          ledger.push({ hypothesis: f.id, variantId: `${f.id}|${JSON.stringify(f.params)}|naive${age}`, params: JSON.stringify(f.params), exit: ex, filterSet: 'standalone', latency: cfg.L, placement: cfg.placement, model: cfg.model, sizeSol: 0.1, split: `public-vdw-futility:${tag}`, n: fa.length, mean: d.diff, lo: d.lo, hi: d.hi, countsTowardK: st === 'PRIMARY' && age === 30 && ex === 'XT300' });
        }
        // F02(b): exit override on the same naive positions
        for (const x of [50, 90]) for (const T of [60, 600]) {
          const idx = f02idx(x, T);
          const dv: number[] = [], dd: number[] = [], zv: number[] = [];
          for (const i of okI) {
            const s = sigs[i]; const fi = idx[s.m];
            if (fi < 0 || fi <= s.sigIdx) continue;
            const g = simulate(tape, { ...s, overrideIdx: fi }, EXITS[ex], cfg);
            if (g.status !== 'ok') continue;
            dv.push(g.ret - fills[i].ret); dd.push(fills[i].day); zv.push(0);
          }
          const d = dv.length ? pairedDiffBootstrap(dd, dv, dd, zv) : { diff: NaN, lo: NaN, hi: NaN };
          f02b.push({ filter: 'F02b', params: { x, T }, age, exit: ex, setting: st, n: dv.length, meanDiff: d.diff, lo: d.lo, hi: d.hi });
          ledger.push({ hypothesis: 'F02b', variantId: `F02b|${JSON.stringify({ x, T })}|naive${age}`, params: JSON.stringify({ x, T }), exit: ex, filterSet: 'exit-override', latency: cfg.L, placement: cfg.placement, model: cfg.model, sizeSol: 0.1, split: `public-vdw-futility:${tag}`, n: dv.length, mean: d.diff, lo: d.lo, hi: d.hi, countsTowardK: st === 'PRIMARY' && age === 30 && ex === 'XT300' });
        }
      }
    }
  }
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, `filters.${tag}.json`), JSON.stringify({ g1, g5, codeHash: hash, naive, results, f02b }, null, 1));
  if (!process.argv.includes('--no-ledger')) appendLedger(ledger, hash);
  log('filters done');
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) main();
