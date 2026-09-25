/**
 * Public-tape futility battery (PROTOCOL §14 "External pilot", rule: results/raw/futility-rule-prestated.md).
 *
 *   node --max-old-space-size=12000 --import tsx research/memecoins/backtest/run-futility.ts \
 *     --tape=research/memecoins/data/public/cache/vdw --g1=strict --only=H01,H02 [--out=research/memecoins/results/raw] [--no-ledger]
 *
 * For every variant (grid point x exit) it simulates each signal at four execution settings:
 *   KILL    L=0.4 s, optimistic placement, insert-and-replay, racing budget 0.0005 SOL   <- verdict setting
 *   PRIMARY L=2 s,   pessimistic, insert-and-replay, 0.0001 SOL                          <- PROTOCOL §7 headline
 *   NOINS   L=2 s,   pessimistic, no-insert (conservative)
 *   L10     L=10 s,  pessimistic, insert-and-replay
 * and writes <out>/<H>.json (per-variant summaries) + ledger rows (split "public-vdw-futility").
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadTape } from './tape.ts';
import { buildCtx, type Ctx } from './context.ts';
import { simulate, defaultCfg, EXITS, ALL_EXITS, type ExecCfg, type Signal, type Fill } from './sim.ts';
import { summarize, type Summary } from './stats.ts';
import { appendLedger, codeHash, type LedgerRow } from './ledger.ts';
import * as S from './signals.ts';

export const SETTINGS: Record<string, Partial<ExecCfg>> = {
  KILL: { L: 0.4, placement: 'opt', model: 'replay', budget: 500_000 },
  PRIMARY: { L: 2, placement: 'pess', model: 'replay', budget: 100_000 },
  NOINS: { L: 2, placement: 'pess', model: 'noinsert', budget: 100_000 },
  L10: { L: 10, placement: 'pess', model: 'replay', budget: 100_000 },
};

type Gen = (ctx: Ctx, org: Uint8Array, p: any) => S.SigOut; // eslint-disable-line @typescript-eslint/no-explicit-any
interface HDef { id: string; gen: Gen; grid: Record<string, unknown>[]; exits: string[] }

const cross = (o: Record<string, unknown[]>) => Object.entries(o).reduce<Record<string, unknown>[]>((acc, [k, vs]) => acc.flatMap((a) => vs.map((v) => ({ ...a, [k]: v }))), [{}]);

export const HYPS: HDef[] = [
  { id: 'H01', gen: S.H01, grid: cross({ V: [10, 20, 35], N: [25, 60], T: [60, 300] }), exits: ALL_EXITS },
  { id: 'H02', gen: S.H02, grid: cross({ W: [60, 180], U: [15, 30, 60] }), exits: ALL_EXITS },
  { id: 'H03', gen: S.H03, grid: cross({ D: [30, 120], F: [3, 8] }), exits: ALL_EXITS },
  { id: 'H04', gen: S.H04, grid: cross({ A: [300, 900], r: [0.6, 0.8] }), exits: ALL_EXITS },
  { id: 'H05', gen: S.H05, grid: cross({ P: [0.70, 0.85], Tfast: [120, 600] }), exits: ['XG', 'XT300', 'XB'] },
  { id: 'H06', gen: S.H06, grid: cross({ k: [2, 3], D: [60, 600] }), exits: ALL_EXITS },
  { id: 'H08', gen: S.H08, grid: cross({ nMin: [3, 10], g: [0.05, 0.15] }), exits: ALL_EXITS },
  { id: 'H09', gen: S.H09, grid: cross({ c: [3, 10], D: [10, 30] }), exits: ALL_EXITS },
  { id: 'H10', gen: S.H10, grid: cross({ Pk: [0.3, 0.5], D: [0.4, 0.6], mode: ['dip', 'recovery'] }), exits: ['XT300', 'XB', 'XR'] },
  { id: 'H17', gen: S.H17, grid: [{ lo: 0.05, hi: 0.2 }, { lo: 0.2, hi: 5 }, { lo: 5, hi: Infinity }], exits: ALL_EXITS },
];

export interface VariantResult {
  hyp: string; variantId: string; params: Record<string, unknown>; exit: string;
  nSignals: number; statuses: Record<string, Record<string, number>>;
  settings: Record<string, Summary & { viaPoolShare: number; abandonedPnlSol: number }>;
}

function arg(name: string, def?: string) {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : def;
}

export function runSignals(ctx: Ctx, signals: Signal[], exitId: string, setting: Partial<ExecCfg>): Fill[] {
  const cfg = defaultCfg(setting);
  return signals.map((s) => simulate(ctx.tape, s, EXITS[exitId], cfg));
}

export function summarizeFills(fills: Fill[]): Summary & { viaPoolShare: number; abandonedPnlSol: number } {
  const ok = fills.filter((f) => f.status === 'ok');
  const s = summarize(ok.map((f) => f.ret), ok.map((f) => f.pnl), ok.map((f) => f.basis), ok.map((f) => f.day));
  return { ...s, viaPoolShare: ok.length ? ok.filter((f) => f.viaPool).length / ok.length : NaN, abandonedPnlSol: fills.filter((f) => f.status !== 'ok').reduce((a, f) => a + f.pnl, 0) / 1e9 };
}

async function main() {
  const tapeDir = arg('tape', 'research/memecoins/data/public/cache/vdw')!;
  const g1 = (arg('g1', 'fromStart') as 'strict' | 'fromStart' | 'all');
  const g5 = (arg('g5', 'guard') as 'guard' | 'drop');
  const tag = `${g1}.${g5}`;
  const only = (arg('only', HYPS.map((h) => h.id).join(','))!).split(',');
  const outDir = arg('out', 'research/memecoins/results/raw')!;
  const settingsList = (arg('settings', Object.keys(SETTINGS).join(','))!).split(',');
  const noLedger = process.argv.includes('--no-ledger');
  const t0 = Date.now();
  const log = (s: string) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s] ${s}`);
  const tape = loadTape(tapeDir);
  log(`tape ${tape.source}: ${tape.meta.length} mints, ${tape.tick.length} trades`);
  const ctx = buildCtx(tape, { g1Mode: g1, warmupDays: 7, g5Mode: g5 }, log);
  log(`universe ${ctx.universe.reduce((a, b) => a + b, 0)} mints; analysis days from ${new Date(ctx.analysisFirstDay * 864e5).toISOString().slice(0, 10)}`);
  const org = S.organicFlags(ctx);
  log('organic flags done');
  const hash = codeHash();
  fs.mkdirSync(outDir, { recursive: true });
  const defs = HYPS.filter((x) => only.includes(x.id));
  if (only.includes('H07')) {
    // CONTROL ONLY: KOL list = kolscan snapshots of 2026-09-25 (not point-in-time for this tape)
    const dir = 'research/memecoins/notes/robinhood-and-social-data';
    const ws = new Set<string>();
    for (const f of ['kolscan_leaderboard_2026-09-25.json', 'kolscan_all_kols_2026-09-25.json']) {
      const p = path.join(dir, f); if (fs.existsSync(p)) for (const r of JSON.parse(fs.readFileSync(p, 'utf8'))) if (r.wallet) ws.add(r.wallet);
    }
    const kols = new Set<number>(); tape.traders.forEach((w, i) => { if (ws.has(w)) kols.add(i); });
    log(`H07 control: ${ws.size} KOL wallets in the snapshot, ${kols.size} of them trade on this tape`);
    defs.push({ id: 'H07', gen: S.H07, grid: [{ S: 0.5, kols }, { S: 2, kols }], exits: ALL_EXITS });
    defs.push({ id: 'H07', gen: S.H07, grid: [{ S: 0.5, kols, mirror: true }, { S: 2, kols, mirror: true }], exits: ['XT1800'] });
  }
  const byId = new Map<string, HDef[]>();
  for (const d of defs) { const a = byId.get(d.id) ?? []; a.push(d); byId.set(d.id, a); }
  for (const [hid, hdefs] of byId) {
    const h = { id: hid, gen: hdefs[0].gen, grid: hdefs.flatMap((d) => d.grid.map((g) => ({ ...g, __exits: d.exits }))), exits: [] as string[] };
    const results: VariantResult[] = [];
    const ledger: LedgerRow[] = [];
    for (const pp of h.grid) {
      const { __exits, ...p } = pp as Record<string, unknown> & { __exits: string[] };
      const sig = h.gen(ctx, org, p).signals;
      const pShow = Object.entries(p).filter(([k]) => k !== 'kols').map(([k, v]) => `${k}=${v}`).join(';');
      for (const ex of __exits) {
        const variantId = `${h.id}|${pShow}|${ex}`;
        const vr: VariantResult = { hyp: h.id, variantId, params: Object.fromEntries(Object.entries(p).filter(([k]) => k !== 'kols')), exit: ex, nSignals: sig.length, statuses: {}, settings: {} };
        for (const st of settingsList) {
          const fills = runSignals(ctx, sig, ex, SETTINGS[st]);
          const cnt: Record<string, number> = {}; for (const f of fills) cnt[f.status] = (cnt[f.status] ?? 0) + 1;
          vr.statuses[st] = cnt;
          const sm = summarizeFills(fills);
          vr.settings[st] = sm;
          const c = { ...defaultCfg(), ...SETTINGS[st] };
          ledger.push({ hypothesis: h.id, variantId, params: pShow, exit: ex, filterSet: 'none', latency: c.L, placement: c.placement, model: c.model, sizeSol: c.size / 1e9, split: `public-vdw-futility:${tag}`, n: sm.n, mean: sm.mean, lo: sm.lo, hi: sm.hi, countsTowardK: st === 'KILL' });
        }
        results.push(vr);
        const k = vr.settings.KILL, pr = vr.settings.PRIMARY;
        log(`${variantId} n=${vr.nSignals} KILL mean=${k?.mean?.toFixed(4)} [${k?.lo?.toFixed(4)},${k?.hi?.toFixed(4)}] PRIMARY mean=${pr?.mean?.toFixed(4)}`);
      }
    }
    fs.writeFileSync(path.join(outDir, `${h.id}.${tag}.json`), JSON.stringify({ hyp: h.id, g1, g5, codeHash: hash, results }, null, 1));
    if (!noLedger) appendLedger(ledger, hash);
    log(`${h.id} done: ${results.length} variants`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) main();
