/**
 * Applies the pre-stated futility rule (results/raw/futility-rule-prestated.md) mechanically to the raw
 * outputs and writes markdown tables + a per-variant CSV.
 *
 *   npx tsx research/memecoins/backtest/make-report.ts [--raw=research/memecoins/results/raw] [--suffix=]
 */
import fs from 'node:fs';
import path from 'node:path';

function arg(name: string, def?: string) { const a = process.argv.find((x) => x.startsWith(`--${name}=`)); return a ? a.slice(name.length + 3) : def; }
const raw = arg('raw', 'research/memecoins/results/raw')!;
const suffix = arg('suffix', '.fromStart.guard')!; // '.<g1>.<g5>'
const pct = (x: number | undefined, d = 1) => (x === undefined || !Number.isFinite(x) ? 'n/a' : `${(x * 100).toFixed(d)} %`);
const vid = (s: string) => s.replace(/\|/g, ' · ');
const sgn = (x: number | undefined, d = 1) => (x === undefined || !Number.isFinite(x) ? 'n/a' : `${x >= 0 ? '+' : ''}${(x * 100).toFixed(d)} %`);

interface Sm { n: number; days: number; mean: number; median: number; win: number; lo: number; hi: number; meanNoTop3: number; solWeighted: number; viaPoolShare: number }
interface VR { hyp: string; variantId: string; params: Record<string, unknown>; exit: string; nSignals: number; settings: Record<string, Sm> }

const lines: string[] = [];
const csv: string[] = ['hypothesis,variant_id,exit,n_signals,setting,n,days,mean,median,win,ci_lo,ci_hi,mean_no_top3,sol_weighted,via_pool_share'];
const verdicts: Record<string, string> = {};
const campaign: { anyPrimaryPositive: string[]; primaryBest: Record<string, number> } = { anyPrimaryPositive: [], primaryBest: {} };

for (const h of ['H01', 'H02', 'H03', 'H04', 'H05', 'H06', 'H08', 'H09', 'H10', 'H13', 'H17', 'H07']) {
  const f = path.join(raw, `${h}${suffix}.json`);
  if (!fs.existsSync(f)) continue;
  const j = JSON.parse(fs.readFileSync(f, 'utf8')) as { results: VR[] };
  const rs = j.results;
  for (const v of rs) for (const [st, s] of Object.entries(v.settings)) csv.push([h, `"${v.variantId}"`, v.exit, v.nSignals, st, s.n, s.days, s.mean, s.median, s.win, s.lo, s.hi, s.meanNoTop3, s.solWeighted, s.viaPoolShare].join(','));
  const under = rs.filter((v) => !v.settings.KILL || v.settings.KILL.n < 30 || v.settings.KILL.days < 5);
  const powered = rs.filter((v) => !under.includes(v));
  const dead = powered.filter((v) => v.settings.KILL.hi < 0);
  let verdict: string;
  if (h === 'H07') verdict = 'CONTROL ONLY (no point-in-time KOL list; no verdict)';
  else if (under.length / rs.length > 0.5) verdict = 'NOT-TESTABLE-ON-TAPE (more than 50 % of the grid underpowered)';
  else if (dead.length === powered.length) verdict = 'KILLED';
  else verdict = 'SURVIVES-FUTILITY';
  verdicts[h] = verdict;
  const prim = powered.map((v) => v.settings.PRIMARY).filter((s) => s && s.n >= 30);
  const posPrim = powered.filter((v) => v.settings.PRIMARY && v.settings.PRIMARY.n >= 1 && v.settings.PRIMARY.mean > 0);
  if (h !== 'H07') for (const v of posPrim) campaign.anyPrimaryPositive.push(`${vid(v.variantId)} (n=${v.settings.PRIMARY.n}, mean ${sgn(v.settings.PRIMARY.mean)})`);
  const allN = rs.reduce((a, v) => a + (v.settings.KILL?.n ?? 0), 0);
  lines.push(`### ${h}: ${verdict}`, '');
  const deadPrim = powered.filter((v) => v.settings.PRIMARY && v.settings.PRIMARY.hi < 0).length;
  const posPrimCI = powered.filter((v) => v.settings.PRIMARY && v.settings.PRIMARY.lo > 0).map((v) => v.variantId);
  lines.push(`Variants tested: ${rs.length} (powered ${powered.length}, dead at the kill setting ${dead.length}, underpowered ${under.length}). Trades over all variants at the kill setting: ${allN}.`);
  lines.push(`At the PRIMARY setting (L = 2 s, pessimistic) ${deadPrim} of ${powered.length} powered variants have an upper 95 % bound < 0; variants whose primary CI lies entirely above 0: ${posPrimCI.length ? posPrimCI.map((x) => '`' + vid(x) + '`').join(', ') : 'none'}.`);
  if (prim.length) {
    const means = prim.map((s) => s.mean).sort((a, b) => a - b);
    lines.push(`Primary setting (L = 2 s, pessimistic): variant means range ${sgn(means[0])} … ${sgn(means[means.length - 1])}, median variant ${sgn(means[Math.floor(means.length / 2)])}.`);
  }
  lines.push('');
  lines.push('| Variant | Signals | Kill n | Kill mean | Kill median | Kill 95 % CI | Kill win | Primary mean [CI] | No-insert mean | L = 10 s mean | Via pool |');
  lines.push('|---|---|---|---|---|---|---|---|---|---|---|');
  const order = [...rs].sort((a, b) => (b.settings.KILL?.hi ?? -9) - (a.settings.KILL?.hi ?? -9));
  const show = order.length <= 12 ? order : [...order.slice(0, 8), ...order.slice(-2)];
  for (const v of show) {
    const k = v.settings.KILL, p = v.settings.PRIMARY, ni = v.settings.NOINS, l10 = v.settings.L10;
    lines.push(`| \`${vid(v.variantId)}\` | ${v.nSignals} | ${k?.n ?? 0} | ${sgn(k?.mean)} | ${sgn(k?.median)} | [${sgn(k?.lo)}, ${sgn(k?.hi)}] | ${pct(k?.win, 0)} | ${sgn(p?.mean)} [${sgn(p?.lo)}, ${sgn(p?.hi)}] | ${sgn(ni?.mean)} | ${sgn(l10?.mean)} | ${pct(k?.viaPoolShare, 0)} |`);
  }
  if (order.length > 12) lines.push(`| … ${order.length - 10} more variants in \`variants${suffix}.csv\` | | | | | | | | | | |`);
  lines.push('');
}

// filters
const ff = path.join(raw, `filters${suffix}.json`);
if (fs.existsSync(ff)) {
  const j = JSON.parse(fs.readFileSync(ff, 'utf8'));
  lines.push('### B_naive (enter every universe coin; PROTOCOL §7 benchmark)', '');
  lines.push('| Entry age | Exit | Setting | n | mean | median | 95 % CI | win | SOL-weighted |', '|---|---|---|---|---|---|---|---|---|');
  for (const b of j.naive) lines.push(`| ${b.age} s | ${b.exit} | ${b.setting} | ${b.n} | ${sgn(b.mean)} | ${sgn(b.median)} | [${sgn(b.lo)}, ${sgn(b.hi)}] | ${pct(b.win, 0)} | ${sgn(b.solWeighted)} |`);
  lines.push('');
  const groups = new Map<string, any[]>(); // eslint-disable-line @typescript-eslint/no-explicit-any
  for (const r of j.results) { const k = `${r.filter}|${JSON.stringify(r.params)}`; const a = groups.get(k) ?? []; a.push(r); groups.set(k, a); }
  const byFilter = new Map<string, { killed: boolean; supported: boolean; any: boolean }[]>();
  lines.push('### Filters, standalone (Δ = flagged − unflagged mean net return; primary setting)', '');
  lines.push('| Filter | Params | Cell | Flagged n | Unflagged n | Flagged mean | Unflagged mean | Δ | Δ 95 % CI |', '|---|---|---|---|---|---|---|---|---|');
  for (const [k, rows] of groups) {
    const prim = rows.filter((r) => r.setting === 'PRIMARY');
    const valid = prim.filter((r) => r.nFlagged >= 30 && r.nUnflagged >= 30);
    const killed = valid.length > 0 && valid.every((r) => r.lo > 0);
    const supported = valid.filter((r) => r.hi < 0).length >= 3;
    const fid = k.split('|')[0];
    const a = byFilter.get(fid) ?? []; a.push({ killed, supported, any: valid.length > 0 }); byFilter.set(fid, a);
    for (const r of prim) lines.push(`| ${r.filter} | \`${JSON.stringify(r.params)}\` | age ${r.age} s, ${r.exit} | ${r.nFlagged} | ${r.nUnflagged} | ${sgn(r.meanFlagged)} | ${sgn(r.meanUnflagged)} | ${sgn(r.diff)} | [${sgn(r.lo)}, ${sgn(r.hi)}] |`);
  }
  lines.push('');
  lines.push('| Filter | Verdict (pre-stated rule B) |', '|---|---|');
  for (const [fid, pts] of byFilter) {
    const v = !pts.some((p) => p.any) ? 'NOT-TESTABLE-ON-TAPE (too few flagged/unflagged)' : pts.filter((p) => p.any).every((p) => p.killed) ? 'KILLED' : pts.some((p) => p.supported) ? 'SUPPORTED-ON-TAPE (cannot promote)' : 'SURVIVES-FUTILITY (inconclusive)';
    verdicts[fid] = v;
    lines.push(`| ${fid} | ${v} |`);
  }
  lines.push('');
  lines.push('### F02 (b) exit override (paired: override − base, on naive positions where the dev dump fires during the hold)', '');
  lines.push('| Params | Cell | Setting | n | mean Δ | 95 % CI |', '|---|---|---|---|---|---|');
  let f02bKilled = true, f02bAny = false;
  for (const r of j.f02b) {
    lines.push(`| \`${JSON.stringify(r.params)}\` | age ${r.age} s, ${r.exit} | ${r.setting} | ${r.n} | ${sgn(r.meanDiff)} | [${sgn(r.lo)}, ${sgn(r.hi)}] |`);
    if (r.setting === 'PRIMARY' && r.n >= 30) { f02bAny = true; if (!(r.hi < 0)) f02bKilled = false; }
  }
  verdicts.F02b = !f02bAny ? 'NOT-TESTABLE-ON-TAPE' : f02bKilled ? 'KILLED' : 'SURVIVES-FUTILITY';
  lines.push('', `F02 (b) verdict: ${verdicts.F02b}`, '');
}

lines.push('### PROTOCOL §11.1 campaign-level check (information)', '');
lines.push(campaign.anyPrimaryPositive.length ? `Variants of H01–H13 with a positive mean at the primary setting (L = 2 s): ${campaign.anyPrimaryPositive.length}.\n\n${campaign.anyPrimaryPositive.slice(0, 40).map((s) => `- ${s}`).join('\n')}` : 'No H01–H13 variant has a positive mean at the primary setting.');
fs.writeFileSync(path.join(raw, `tables${suffix}.md`), lines.join('\n') + '\n');
fs.writeFileSync(path.join(raw, `variants${suffix}.csv`), csv.join('\n') + '\n');
fs.writeFileSync(path.join(raw, `verdicts${suffix}.json`), JSON.stringify(verdicts, null, 1));
console.log(verdicts);
