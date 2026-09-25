/**
 * One summary table across data treatments (primary fromStart.guard + sensitivities strict.guard, fromStart.drop).
 *   npx tsx research/memecoins/backtest/make-summary.ts > research/memecoins/results/raw/summary.md
 */
import fs from 'node:fs';
import path from 'node:path';
const raw = 'research/memecoins/results/raw';
const tags = ['fromStart.guard', 'strict.guard', 'fromStart.drop'];
const vid = (s: string) => s.replace(/\|/g, ' · ');
const sgn = (x: number | undefined, d = 1) => (x === undefined || !Number.isFinite(x) ? 'n/a' : `${x >= 0 ? '+' : ''}${(x * 100).toFixed(d)} %`);
interface Sm { n: number; days: number; mean: number; median: number; win: number; lo: number; hi: number }
interface VR { variantId: string; settings: Record<string, Sm> }
const verd = Object.fromEntries(tags.map((t) => { const f = path.join(raw, `verdicts.${t}.json`); return [t, fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {}]; }));
const rows: string[] = [
  '| Hypothesis | Variants | Trades (kill setting, all variants) | Best variant at the kill point (mean / median / 95 % CI / win) | Primary L = 2 s: variants with CI upper bound < 0 | Primary: median variant mean | Verdict (primary treatment) | Strict G1 | G5 day-drop |',
  '|---|---|---|---|---|---|---|---|---|',
];
for (const h of ['H01', 'H02', 'H03', 'H04', 'H05', 'H06', 'H08', 'H09', 'H10', 'H13', 'H17', 'H07']) {
  const f = path.join(raw, `${h}.${tags[0]}.json`); if (!fs.existsSync(f)) continue;
  const rs = (JSON.parse(fs.readFileSync(f, 'utf8')).results as VR[]);
  const powered = rs.filter((v) => v.settings.KILL && v.settings.KILL.n >= 30 && v.settings.KILL.days >= 5);
  const best = [...powered].sort((a, b) => b.settings.KILL.hi - a.settings.KILL.hi)[0];
  const k = best?.settings.KILL;
  const nAll = rs.reduce((a, v) => a + (v.settings.KILL?.n ?? 0), 0);
  const primDead = powered.filter((v) => v.settings.PRIMARY?.hi < 0).length;
  const pm = powered.map((v) => v.settings.PRIMARY?.mean).filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  const med = pm[Math.floor(pm.length / 2)];
  rows.push(`| ${h} | ${rs.length} | ${nAll} | \`${vid(best?.variantId ?? '')}\`: ${sgn(k?.mean)} / ${sgn(k?.median)} / [${sgn(k?.lo)}, ${sgn(k?.hi)}] / ${k ? Math.round(k.win * 100) + ' %' : 'n/a'} (n ${k?.n}) | ${primDead} of ${powered.length} | ${sgn(med)} | **${verd[tags[0]][h] ?? 'n/a'}** | ${verd[tags[1]][h] ?? 'n/a'} | ${verd[tags[2]][h] ?? 'n/a'} |`);
}
rows.push('', '| Filter | Verdict (primary treatment) | Strict G1 | G5 day-drop |', '|---|---|---|---|');
for (const fid of ['F01', 'F02a', 'F02b', 'F03', 'F04', 'F05', 'F06', 'F07', 'F08', 'NOCB']) rows.push(`| ${fid} | **${verd[tags[0]][fid] ?? 'n/a'}** | ${verd[tags[1]][fid] ?? 'n/a'} | ${verd[tags[2]][fid] ?? 'n/a'} |`);
console.log(rows.join('\n'));
