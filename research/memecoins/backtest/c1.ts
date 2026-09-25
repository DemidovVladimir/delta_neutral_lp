/**
 * C1 confirmatory test (HYPOTHESES.md Amendment A1.4 / A1.5 + erratum A1.1). Frozen: do not change the rule.
 *
 *   node --max-old-space-size=8000 --import tsx research/memecoins/backtest/c1.ts --look=1   # backfilled week 2026-09-18 .. 2026-09-24
 *   node --max-old-space-size=8000 --import tsx research/memecoins/backtest/c1.ts --look=2   # live 2026-09-25 .. 2026-10-22, run >= 2026-10-23 01:00Z
 *   [--look1-result=PASS-1|CONTINUE|VOID]  (look 2 needs look 1's outcome)  [--to=YYYY-MM-DD] (look-2 void extension, <= 2026-11-02)
 *
 * C1 = H17 creator buy in [0.05, 0.2) SOL, exit XB; L = 2 s pessimistic, insert-and-replay, 0.1 SOL.
 * Decision statistic: mean per-trade net return; day-block bootstrap (UTC signal days, 10,000, seed 27);
 * one-sided alpha 0.025 per look (Bonferroni over 2 looks) -> the 2.5th percentile.
 */
import fs from 'node:fs';
import Database from 'better-sqlite3';
import { loadCollector } from './adapters/collector.ts';
import { buildCtx } from './context.ts';
import { simulate, defaultCfg, EXITS, type Fill } from './sim.ts';
import { SETTINGS } from './run-futility.ts';
import { H17 } from './signals.ts';
import { summarize, dayBootstrap } from './stats.ts';
import { dayOf, dayStr } from './tape.ts';
import { appendLedger, codeHash } from './ledger.ts';

const arg = (n: string, d?: string) => { const a = process.argv.find((x) => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const DB = arg('db', 'research/memecoins/data/memecoins.db')!;
const look = Number(arg('look', '1'));
const D = (s: string) => Date.parse(`${s}T00:00:00Z`) / 1000;
const win = arg('smoke-from') ? { from: D(arg('smoke-from')!), to: D(arg('smoke-to')!), minDays: 0, minTrades: 0 } : look === 1
  ? { from: D('2026-09-18'), to: D('2026-09-25'), minDays: 5, minTrades: 100 }
  : { from: D('2026-09-25'), to: arg('to') ? D(arg('to')!) + 86_400 : D('2026-10-23'), minDays: 10, minTrades: 300 };
if (look === 2 && win.to > D('2026-11-03')) throw new Error('look-2 window may not pass 2026-11-03 00:00Z');
const t0 = Date.now(); const log = (s: string) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s] ${s}`);

const { tape, stats } = loadCollector(DB, { createdFrom: win.from, createdTo: win.to, tradesTo: win.to + 3 * 3600 });
log(`loaded: ${JSON.stringify(stats)}`);
const ctx = buildCtx(tape, { g1Mode: 'fromStart', warmupDays: 0, g5Mode: 'guard' }, log);
const SMOKE = process.argv.includes('--smoke'); // mechanics check with a NON-C1 bucket; no decision, files or ledger
const sigs = H17(ctx, new Uint8Array(0), SMOKE ? { lo: 0.2, hi: 5 } : { lo: 0.05, hi: 0.2 }).signals.filter((s) => {
  const c = tape.meta[s.m].createdAt; return c >= win.from && c < win.to;
});
const deltaSlots = Math.ceil(2 / tape.tickSec - 1e-9);
log(`measured slot time ${tape.tickSec.toFixed(4)} s -> L = 2 s = ${deltaSlots} slots; time stop 1800 s = ${(1800 / tape.tickSec).toFixed(0)} slots; C1 signals ${sigs.length}`);

const out: Record<string, unknown> = { look, window: [new Date(win.from * 1000).toISOString(), new Date(win.to * 1000).toISOString()], load: stats, measuredSlotSec: tape.tickSec, deltaSlotsL2: deltaSlots, nSignals: sigs.length, settings: {} };
const fillsBy: Record<string, Fill[]> = {};
for (const st of ['PRIMARY', 'KILL', 'NOINS', 'L10']) {
  const cfg = defaultCfg(SETTINGS[st]);
  const fills = sigs.map((s) => simulate(tape, s, EXITS.XB, cfg));
  fillsBy[st] = fills;
  const ok = fills.filter((f) => f.status === 'ok');
  const sm = summarize(ok.map((f) => f.ret), ok.map((f) => f.pnl), ok.map((f) => f.basis), ok.map((f) => f.day), 10_000);
  const cnt: Record<string, number> = {}; for (const f of fills) cnt[f.status] = (cnt[f.status] ?? 0) + 1;
  (out.settings as Record<string, unknown>)[st] = { ...sm, statuses: cnt, viaPoolShare: ok.filter((f) => f.viaPool).length / Math.max(1, ok.length), exitReasons: ok.reduce<Record<string, number>>((a, f) => { a[f.reason] = (a[f.reason] ?? 0) + 1; return a; }, {}) };
  if (!SMOKE) log(`${st}: n=${sm.n} days=${sm.days} mean=${(sm.mean * 100).toFixed(2)} % CI [${(sm.lo * 100).toFixed(2)}, ${(sm.hi * 100).toFixed(2)}] median=${(sm.median * 100).toFixed(2)} % win=${(sm.win * 100).toFixed(1)} %`);
}

if (SMOKE) {
  const st = (out.settings as Record<string, { n: number; days: number; statuses: unknown; viaPoolShare: number }>);
  console.log(JSON.stringify({ smoke: true, bucket: '[0.2,5) SOL (not C1)', load: stats, nSignals: sigs.length, primary: { n: st.PRIMARY.n, days: st.PRIMARY.days, statuses: st.PRIMARY.statuses } }, null, 1));
  process.exit(0);
}
// ---------------- decision (PRIMARY only)
const P = (out.settings as Record<string, { n: number; days: number; mean: number; lo: number; hi: number }>).PRIMARY;
let decision: string;
if (P.days < win.minDays || P.n < win.minTrades) decision = 'VOID';
else if (look === 1) decision = P.hi < 0 ? 'KILL' : P.mean > 0 && P.lo > 0 ? 'PASS-1' : 'CONTINUE';
else {
  const l1 = arg('look1-result', 'CONTINUE');
  decision = l1 === 'PASS-1' ? (P.mean > 0 ? 'CONFIRMED' : 'KILLED (failed replication)') : P.mean > 0 && P.lo > 0 ? 'CONFIRMED' : 'KILLED';
}
out.decision = decision;
log(`DECISION look ${look}: ${decision}`);

// ---------------- reported only
const okP = fillsBy.PRIMARY.filter((f) => f.status === 'ok');
const perDay = new Map<number, { n: number; sum: number; pnl: number }>();
for (const f of okP) { const e = perDay.get(f.day) ?? { n: 0, sum: 0, pnl: 0 }; e.n++; e.sum += f.ret; e.pnl += f.pnl; perDay.set(f.day, e); }
out.perDay = [...perDay.entries()].sort((a, b) => a[0] - b[0]).map(([d, e]) => ({ day: dayStr(d), n: e.n, mean: e.sum / e.n, pnlSol: e.pnl / 1e9 }));
// PROTOCOL day gates: G1 (> 2 % of the day's mints with chain gaps) and G5 (> 1 % of minutes with zero curve trades)
const mintsByDay = new Map<number, { n: number; gapped: number }>();
for (const m of tape.meta) { if (!m.chainFromStart) continue; const d = dayOf(tape, m.t0); const e = mintsByDay.get(d) ?? { n: 0, gapped: 0 }; e.n++; if (m.gaps > 0) e.gapped++; mintsByDay.set(d, e); }
const downByDay = new Map<number, number>();
for (let k = 0; k < ctx.downMinute.length; k++) if (ctx.downMinute[k]) { const d = Math.floor(((ctx.minute0 + k) * 60) / 86_400); downByDay.set(d, (downByDay.get(d) ?? 0) + 1); }
const gate = [...perDay.keys()].sort((a, b) => a - b).map((d) => ({ day: dayStr(d), g1GappedShare: (mintsByDay.get(d)?.gapped ?? 0) / Math.max(1, mintsByDay.get(d)?.n ?? 0), g5DownMinutes: downByDay.get(d) ?? 0 }));
const keep = new Set(gate.filter((g) => g.g1GappedShare <= 0.02 && g.g5DownMinutes <= 14.4).map((g) => g.day));
const okG = okP.filter((f) => keep.has(dayStr(f.day)));
const ciG = okG.length ? dayBootstrap(okG.map((f) => f.day), okG.map((f) => f.ret)) : { lo: NaN, hi: NaN };
out.protocolGates = { perDay: gate, keptDays: [...keep], n: okG.length, mean: okG.reduce((a, f) => a + f.ret, 0) / Math.max(1, okG.length), lo: ciG.lo, hi: ciG.hi };
// fee fields of C1 coins: share whose charged curve fee differs from 125 bps (> 1 bps) on any trade
{
  const db = new Database(DB, { readonly: true, fileMustExist: true });
  const qf = db.prepare(`SELECT t.quote_amount, t.fee_protocol, t.fee_creator FROM trades t JOIN keys k ON k.id = t.mint_id WHERE k.pubkey = ? AND t.venue = 0 AND t.quote_amount > 0 LIMIT 50`).raw();
  let coins = 0, off = 0, noFee = 0;
  for (const s of sigs) {
    coins++; let bad = false, any = false;
    for (const [qa, fp, fc] of qf.all(tape.meta[s.m].mint) as [number, number | null, number | null][]) {
      if (fp === null || fc === null) continue; any = true;
      const bps = ((fp + fc) / qa) * 1e4; if (Math.abs(bps - 125) > 1) bad = true;
    }
    if (!any) noFee++; if (bad) off++;
  }
  db.close();
  out.feeCheck = { coins, coinsWithFeeNot125bps: off, coinsWithoutFeeFields: noFee };
}
out.codeHash = codeHash();
fs.writeFileSync(`research/memecoins/results/raw/c1-look${look}.json`, JSON.stringify(out, null, 1));
appendLedger(['PRIMARY', 'KILL', 'NOINS', 'L10'].map((st) => {
  const s = (out.settings as Record<string, { n: number; mean: number; lo: number; hi: number }>)[st]; const c = { ...defaultCfg(), ...SETTINGS[st] };
  return { hypothesis: 'H17', variantId: 'H17|lo=0.05;hi=0.2|XB', params: 'lo=0.05;hi=0.2 (C1)', exit: 'XB', filterSet: 'none', latency: c.L, placement: c.placement, model: c.model, sizeSol: 0.1, split: `collector-C1-look${look}`, n: s.n, mean: s.mean, lo: s.lo, hi: s.hi, countsTowardK: false };
}), out.codeHash as string);
console.log(JSON.stringify({ decision, primary: P, protocolGates: { n: (out.protocolGates as { n: number }).n, mean: (out.protocolGates as { mean: number }).mean }, feeCheck: out.feeCheck }, null, 1));
