// Synthetic check of the H13 gradient-boosting regressor: y = 2*x0 - x1^2 + noise; test R^2 must be high.
import { fitGBM, CONFIGS } from './h13.ts';
let s = 7; const r = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
const mk = (n: number) => { const X: number[][] = [], y: number[] = []; for (let i = 0; i < n; i++) { const x = [r() * 2 - 1, r() * 2 - 1, r(), r()]; X.push(x); y.push(2 * x[0] - x[1] * x[1] + (r() - 0.5) * 0.2); } return { X, y }; };
const tr = mk(5000), te = mk(2000);
for (const [k, c] of Object.entries(CONFIGS)) {
  const t0 = Date.now(); const f = fitGBM(tr.X, tr.y, c, 1);
  const my = te.y.reduce((a, b) => a + b, 0) / te.y.length;
  const ssr = te.X.reduce((a, x, i) => a + (te.y[i] - f(x)) ** 2, 0), sst = te.y.reduce((a, v) => a + (v - my) ** 2, 0);
  console.log(k, 'test R2', (1 - ssr / sst).toFixed(3), `${Date.now() - t0} ms`);
  if (1 - ssr / sst < 0.8) { console.error('GBM FAILED'); process.exit(1); }
}
