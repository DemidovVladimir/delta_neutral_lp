/**
 * Statistics (PROTOCOL §7): per-trade summaries and the UTC-day block bootstrap (canon rule 1).
 */

export interface Summary {
  n: number; days: number; mean: number; median: number; trim1: number; win: number;
  p5: number; p95: number; worst: number; best: number;
  meanNoTop3: number; meanNoTop1pct: number;
  solWeighted: number;           // sum pnl / sum basis
  lo: number; hi: number;        // 95 % day-block bootstrap CI of the mean per-trade return
  dailyMean: number;             // mean daily PnL (lamports) over days with >= 1 trade
  bestDayShare: number;          // share of total PnL from the best day
}

/** Seeded PRNG (mulberry32). */
export function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const q = (sorted: number[], p: number) => {
  if (!sorted.length) return NaN;
  const i = (sorted.length - 1) * p; const a = Math.floor(i), b = Math.ceil(i);
  return sorted[a] + (sorted[b] - sorted[a]) * (i - a);
};

/** Day-block bootstrap of the pooled mean (sum over resampled days / count). */
export function dayBootstrap(days: number[], vals: number[], B = 10_000, seed = 27): { lo: number; hi: number } {
  const byDay = new Map<number, [number, number]>();
  for (let i = 0; i < vals.length; i++) { const e = byDay.get(days[i]) ?? [0, 0]; e[0] += vals[i]; e[1]++; byDay.set(days[i], e); }
  const D = [...byDay.values()];
  if (D.length < 2) return { lo: NaN, hi: NaN };
  const rnd = mulberry(seed);
  const out = new Float64Array(B);
  for (let b = 0; b < B; b++) {
    let s = 0, n = 0;
    for (let k = 0; k < D.length; k++) { const d = D[Math.floor(rnd() * D.length)]; s += d[0]; n += d[1]; }
    out[b] = s / n;
  }
  const srt = Array.from(out).sort((x, y) => x - y);
  return { lo: q(srt, 0.025), hi: q(srt, 0.975) };
}

/** Paired day-block bootstrap of mean(A) - mean(B); days resampled jointly. */
export function pairedDiffBootstrap(daysA: number[], a: number[], daysB: number[], b: number[], B = 10_000, seed = 27): { diff: number; lo: number; hi: number } {
  const m = new Map<number, [number, number, number, number]>();
  for (let i = 0; i < a.length; i++) { const e = m.get(daysA[i]) ?? [0, 0, 0, 0]; e[0] += a[i]; e[1]++; m.set(daysA[i], e); }
  for (let i = 0; i < b.length; i++) { const e = m.get(daysB[i]) ?? [0, 0, 0, 0]; e[2] += b[i]; e[3]++; m.set(daysB[i], e); }
  const D = [...m.values()];
  const tot = D.reduce((s, e) => [s[0] + e[0], s[1] + e[1], s[2] + e[2], s[3] + e[3]], [0, 0, 0, 0]);
  const diff = tot[0] / tot[1] - tot[2] / tot[3];
  const rnd = mulberry(seed);
  const out: number[] = [];
  for (let k = 0; k < B; k++) {
    let sa = 0, na = 0, sb = 0, nb = 0;
    for (let i = 0; i < D.length; i++) { const e = D[Math.floor(rnd() * D.length)]; sa += e[0]; na += e[1]; sb += e[2]; nb += e[3]; }
    if (na > 0 && nb > 0) out.push(sa / na - sb / nb);
  }
  out.sort((x, y) => x - y);
  return { diff, lo: q(out, 0.025), hi: q(out, 0.975) };
}

export function summarize(rets: number[], pnls: number[], bases: number[], days: number[], B = 10_000): Summary {
  const n = rets.length;
  const nanS: Summary = { n, days: new Set(days).size, mean: NaN, median: NaN, trim1: NaN, win: NaN, p5: NaN, p95: NaN, worst: NaN, best: NaN, meanNoTop3: NaN, meanNoTop1pct: NaN, solWeighted: NaN, lo: NaN, hi: NaN, dailyMean: NaN, bestDayShare: NaN };
  if (!n) return nanS;
  const s = [...rets].sort((x, y) => x - y);
  const mean = rets.reduce((a, b) => a + b, 0) / n;
  const k1 = Math.floor(n * 0.01);
  const trimmed = s.slice(k1, n - k1);
  const trim1 = trimmed.reduce((a, b) => a + b, 0) / Math.max(1, trimmed.length);
  const top3 = s.slice(0, Math.max(0, n - 3));
  const top1 = s.slice(0, n - Math.max(1, Math.ceil(n * 0.01)));
  const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
  const byDay = new Map<number, number>();
  for (let i = 0; i < n; i++) byDay.set(days[i], (byDay.get(days[i]) ?? 0) + pnls[i]);
  const dayP = [...byDay.values()];
  const totP = dayP.reduce((a, b) => a + b, 0);
  const ci = dayBootstrap(days, rets, B);
  return {
    n, days: byDay.size, mean, median: q(s, 0.5), trim1, win: rets.filter((r) => r > 0).length / n,
    p5: q(s, 0.05), p95: q(s, 0.95), worst: s[0], best: s[n - 1], meanNoTop3: avg(top3), meanNoTop1pct: avg(top1),
    solWeighted: pnls.reduce((a, b) => a + b, 0) / bases.reduce((a, b) => a + b, 0),
    lo: ci.lo, hi: ci.hi, dailyMean: totP / byDay.size, bestDayShare: totP !== 0 ? Math.max(...dayP) / totP : NaN,
  };
}
