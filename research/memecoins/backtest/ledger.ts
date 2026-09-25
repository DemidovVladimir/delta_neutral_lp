/**
 * Variant ledger (PROTOCOL §1.3): research/memecoins/results/variant_ledger.csv, append-only.
 * One row per (variant, split, execution setting) evaluation. K counts DISTINCT variant ids.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const LEDGER = path.resolve(here, '..', 'results', 'variant_ledger.csv');
const HEADER = 'timestamp,code_hash,hypothesis,variant_id,params,exit,filter_set,latency_s,placement,model,size_sol,split,n_trades,mean,ci_lo,ci_hi,counts_toward_K\n';

export function codeHash(): string {
  const h = crypto.createHash('sha256');
  const files: string[] = [];
  const walk = (d: string) => { for (const f of fs.readdirSync(d).sort()) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else if (p.endsWith('.ts')) files.push(p); } };
  walk(here);
  for (const f of files) { h.update(path.relative(here, f)); h.update(fs.readFileSync(f)); }
  return h.digest('hex');
}

export interface LedgerRow {
  hypothesis: string; variantId: string; params: string; exit: string; filterSet: string;
  latency: number; placement: string; model: string; sizeSol: number; split: string;
  n: number; mean: number; lo: number; hi: number; countsTowardK: boolean;
}

export function appendLedger(rows: LedgerRow[], hash: string) {
  fs.mkdirSync(path.dirname(LEDGER), { recursive: true });
  if (!fs.existsSync(LEDGER)) fs.writeFileSync(LEDGER, HEADER);
  const ts = new Date().toISOString();
  const esc = (s: string) => (/[",]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const lines = rows.map((r) => [ts, hash, r.hypothesis, esc(r.variantId), esc(r.params), r.exit, esc(r.filterSet), r.latency, r.placement, r.model, r.sizeSol, r.split, r.n,
    Number.isFinite(r.mean) ? r.mean.toFixed(6) : '', Number.isFinite(r.lo) ? r.lo.toFixed(6) : '', Number.isFinite(r.hi) ? r.hi.toFixed(6) : '', r.countsTowardK ? 1 : 0].join(','));
  fs.appendFileSync(LEDGER, lines.join('\n') + '\n');
}
