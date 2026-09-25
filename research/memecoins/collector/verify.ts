/**
 * Completeness check of the collected dataset against the chain (read-only).
 *
 *   node --import tsx verify.ts --program [--venue=pump|amm|both] [--windows=5] [--window-slots=100]
 *   node --import tsx verify.ts --mints=<mint,mint,...> | --auto-mints=5
 *   node --import tsx verify.ts --tokens
 *   common: [--db=...] [--max-credits=3000] [--since-slot=N] [--until-slot=N]
 *
 * --program : ground truth = Helius getTransactionsForAddress(program, full, succeeded) for
 *             random slot windows inside the collected range; decoded with the same decoder;
 *             compared event-by-event (sig, idx) and field-by-field with the DB.
 *             Cost: 0.1 credit per tx (pump ~9 tx/slot, PumpSwap ~85 tx/slot).
 * --mints   : ground truth = getTransactionsForAddress(mint, signatures, succeeded) over the
 *             collected range (10 credits per 1000 sigs); chain txs not in the DB are fetched
 *             (public RPC first) and decoded to see whether they really contain a trade.
 * --tokens  : on-chain CreateEvent / migration events vs the independent PumpPortal feed (free).
 * --pools[=N]: PumpSwap scope (v3): trade-level windows of the N latest graduated pools vs Helius gTFA(pool).
 * --chain   : protocol gate G1 (free, DB only): for every coin/pool, the pre-trade REAL reserves
 *             rebuilt from trade i must equal the post-trade reserves of trade i-1 (ordered by
 *             slot, tx_index, idx). A break = a missed trade (or, on PumpSwap, a non-trade vault change).
 */
import Database from 'better-sqlite3';
import path from 'node:path';
import { extractTxEvents, PUMP_AMM_PROGRAM, PUMP_PROGRAM, type RpcTx } from './decode.ts';
import { CreditBudget, fetchTx, gtfaWindow, heliusUrl, rpcCall } from './rpc.ts';

/** Measured 2026-09-25 (getBlockTime over 100k slots): 0.2664 s per slot (~225 slots/min). */
const SLOT_SEC = 0.2664;
const argv = process.argv.slice(2);
const opt = (n: string, d: string) => { const a = argv.find(x => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const has = (n: string) => argv.includes(`--${n}`) || argv.some(x => x.startsWith(`--${n}=`));
const DB = opt('db', path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'data', 'memecoins.db'));
const HELIUS = heliusUrl();
const maxCredits = Number(opt('max-credits', '3000'));
const budget = new CreditBudget(maxCredits, maxCredits);
const PUBLIC = ['https://solana-rpc.publicnode.com', 'https://api.mainnet-beta.solana.com'];
const db = new Database(DB, { readonly: true, fileMustExist: true });
const TRADE = new Set(['pump.TradeEvent', 'amm.BuyEvent', 'amm.SellEvent']);

const range = db.prepare('SELECT min(slot) AS lo, max(slot) AS hi FROM trades WHERE source = 0').get() as { lo: number; hi: number };
const tip = await rpcCall<number>(PUBLIC[0], 'getSlot', [{ commitment: 'confirmed' }]);
const lo = Number(opt('since-slot', String(range.lo + 50)));
const hi = Math.min(Number(opt('until-slot', String(range.hi - 50))), tip - 60);
console.log(`db=${DB}\ncollected live range: slots ${range.lo}..${range.hi}; checking ${lo}..${hi} (${hi - lo} slots ≈ ${((hi - lo) * SLOT_SEC / 60).toFixed(0)} min); budget ${maxCredits} credits`);

interface TruthEv { key: string; sig: string; venue: 'pump' | 'pumpswap'; mint?: string; pool?: string; trader: string; token: string; quote: string }
function truthEvents(tx: RpcTx): TruthEv[] {
  const sig = tx.transaction.signatures[0];
  const { events } = extractTxEvents(tx);
  const out: TruthEv[] = []; let idx = 0;
  for (const e of events) {
    if (!TRADE.has(`${e.program}.${e.name}`)) continue;
    const d = e.data; const i = idx++;
    if (e.program === 'pump') out.push({ key: `${sig}:${i}`, sig, venue: 'pump', mint: d.mint, trader: d.user, token: String(d.token_amount), quote: String(d.quote_mint && d.quote_mint !== '11111111111111111111111111111111' ? d.quote_amount : d.sol_amount) });
    else {
      // same normalization as processor.ts: buy quote = min(quote_amount_in, user_quote_amount_in)
      const q = e.name === 'BuyEvent' ? (d.user_quote_amount_in !== undefined && d.user_quote_amount_in < d.quote_amount_in ? d.user_quote_amount_in : d.quote_amount_in) : d.quote_amount_out;
      out.push({ key: `${sig}:${i}`, sig, venue: 'pumpswap', pool: d.pool, trader: d.user, token: String(e.name === 'BuyEvent' ? d.base_amount_out : d.base_amount_in), quote: String(q) });
    }
  }
  return out;
}

async function programCheck() {
  if (!HELIUS) throw new Error('no Helius RPC_URL in .env');
  // since v3 PumpSwap is collected only for graduated pools (see --pools); the program-wide check is pump only by default
  const venues = opt('venue', 'pump') === 'both' ? ['pump', 'amm'] : [opt('venue', 'pump')];
  const nWin = Number(opt('windows', '5')); const wSlots = Number(opt('window-slots', '100'));
  const summary: Record<string, any> = {};
  for (const v of venues) {
    const address = v === 'pump' ? PUMP_PROGRAM : PUMP_AMM_PROGRAM; const venue = v === 'pump' ? 'pump' : 'pumpswap';
    const slotsPer = v === 'amm' ? Math.max(10, Math.round(wSlots / 4)) : wSlots;
    let truthN = 0, dbN = 0, dbWsN = 0, matched = 0, matchedWs = 0, fieldMismatch = 0, extra = 0, txs = 0, credits = 0;
    const missingExamples: string[] = [];
    for (let w = 0; w < nWin; w++) {
      const from = Math.round(lo + ((hi - lo - slotsPer) * (w + 0.5)) / nWin); const to = from + slotsPer - 1;
      const truth = new Map<string, TruthEv>();
      const r = await gtfaWindow(HELIUS, address, from, to, budget, (page) => { for (const tx of page) { if (tx.meta?.err) continue; for (const e of truthEvents(tx)) if (e.venue === venue) truth.set(e.key, e); } });
      txs += r.txs; credits += r.credits;
      if (!r.complete) { console.log(`  [${v}] window ${from}..${to} incomplete (${r.reason}) — stopping`); break; }
      const rows = db.prepare(`SELECT sig, idx, source, mint, trader, pool, token_amount, quote_amount, venue FROM trades_v WHERE slot BETWEEN ? AND ? AND venue = ?`).all(from, to, venue) as any[];
      const dbKeys = new Map(rows.map(r => [`${r.sig}:${r.idx}`, r]));
      let m = 0, mw = 0, mis = 0, ex = 0;
      for (const [k, t] of truth) {
        const row = dbKeys.get(k);
        if (!row) { if (missingExamples.length < 5) missingExamples.push(k); continue; }
        m++; if (row.source === 'ws') mw++;
        const okMint = t.venue === 'pump' ? row.mint === t.mint : row.pool === t.pool;
        if (!okMint || row.trader !== t.trader || String(row.token_amount) !== t.token || String(row.quote_amount) !== t.quote) {
          // reversed PumpSwap pools swap token/quote sides by design
          if (!(t.venue === 'pumpswap' && String(row.token_amount) === t.quote && String(row.quote_amount) === t.token)) mis++;
        }
      }
      for (const k of dbKeys.keys()) if (!truth.has(k)) ex++;
      truthN += truth.size; dbN += rows.length; dbWsN += rows.filter(r => r.source === 'ws').length; matched += m; matchedWs += mw; fieldMismatch += mis; extra += ex;
      console.log(`  [${v}] window ${from}..${to}: chain ${truth.size} trade events (${r.txs} txs, ${r.credits} cr) | db ${rows.length} | matched ${m} (${(100 * m / Math.max(1, truth.size)).toFixed(2)}%), ws-only ${mw} | field mismatches ${mis} | db-extra ${ex}`);
    }
    summary[v] = { chainEvents: truthN, dbEvents: dbN, matched, pct: +(100 * matched / Math.max(1, truthN)).toFixed(3), wsOnlyPct: +(100 * matchedWs / Math.max(1, truthN)).toFixed(3), fieldMismatch, dbExtra: extra, txs, credits, missingExamples };
  }
  console.log('PROGRAM-CHECK ' + JSON.stringify(summary));
}

async function mintCheck(mints: string[]) {
  if (!HELIUS) throw new Error('no Helius RPC_URL in .env');
  const results: any[] = [];
  for (const mint of mints) {
    const chainSigs = new Set<string>(); let token: string | null = null; let calls = 0;
    do {
      if (!budget.canSpend(10)) { console.log('budget exhausted'); break; }
      const cfg: any = { transactionDetails: 'signatures', sortOrder: 'asc', limit: 1000, commitment: 'confirmed', filters: { slot: { gte: lo, lte: hi }, status: 'succeeded' } };
      if (token) cfg.paginationToken = token;
      const page = await rpcCall<{ data: { signature: string }[]; paginationToken: string | null }>(HELIUS, 'getTransactionsForAddress', [mint, cfg], 60_000);
      budget.spend(10); calls++;
      for (const s of page.data) chainSigs.add(s.signature);
      token = page.data.length < 1000 ? null : page.paginationToken;
    } while (token);
    const dbRows = db.prepare(`SELECT DISTINCT sig FROM trades_v WHERE mint = ? AND slot BETWEEN ? AND ?`).all(mint, lo, hi) as { sig: string }[];
    const dbSigs = new Set(dbRows.map(r => r.sig));
    const mintPools = new Set((db.prepare('SELECT pool FROM pools WHERE base_mint = ? OR quote_mint = ?').all(mint, mint) as { pool: string }[]).map(r => r.pool));
    const notInDb = [...chainSigs].filter(s => !dbSigs.has(s));
    const dbNotOnChain = [...dbSigs].filter(s => !chainSigs.has(s)).length;
    // classify chain txs we do not have: do they actually contain a trade of this mint?
    let missingTrades = 0, nonTrade = 0, unknown = 0; const missingExamples: string[] = [];
    for (const sig of notInDb.slice(0, 60)) {
      let tx: RpcTx | null = null;
      try { tx = await fetchTx(sig, PUBLIC, HELIUS, budget); } catch { /* unknown */ }
      if (!tx) { unknown++; continue; }
      // PumpSwap events carry the pool, not the mint: count only trades in one of THIS mint's pools
      // (a tx can touch the mint account while trading another pool, e.g. an arbitrage route)
      const evs = truthEvents(tx).filter(e => e.mint === mint || (e.venue === 'pumpswap' && e.pool !== undefined && mintPools.has(e.pool)));
      if (evs.length) { missingTrades++; if (missingExamples.length < 5) missingExamples.push(sig); } else nonTrade++;
      await new Promise(r => setTimeout(r, 250));
    }
    const sampled = Math.min(notInDb.length, 60);
    const estMissing = sampled ? Math.round(missingTrades * notInDb.length / sampled) : 0;
    const chainTradeTxs = dbSigs.size + estMissing;
    const r = { mint, chainTxsTouchingMint: chainSigs.size, dbTradeTxs: dbSigs.size, chainTxsNotInDb: notInDb.length, dbNotOnChain, sampled, ofWhichTrades: missingTrades, nonTrade, unknown,
      capturedPct: +(100 * dbSigs.size / Math.max(1, chainTradeTxs)).toFixed(3), sigCalls: calls, missingExamples };
    results.push(r);
    console.log(`  ${mint}: chain txs ${chainSigs.size}, db trade txs ${dbSigs.size}, chain-not-in-db ${notInDb.length} (sampled ${sampled}: ${missingTrades} trades, ${nonTrade} non-trade, ${unknown} unfetched) => captured ${r.capturedPct}%`);
  }
  console.log('MINT-CHECK ' + JSON.stringify({ lo, hi, credits: budget.total, results }));
}

function autoMints(n: number): string[] {
  const out: string[] = [];
  const q = (sql: string, ...a: any[]) => (db.prepare(sql).all(...a) as { mint: string }[]).map(r => r.mint).filter(m => m && !out.includes(m));
  // 1) the most-traded bonding-curve token created inside the window
  out.push(...q(`SELECT t.mint FROM tokens t JOIN keys k ON k.pubkey = t.mint JOIN trades tr ON tr.mint_id = k.id WHERE t.created_slot BETWEEN ? AND ? AND tr.slot BETWEEN ? AND ? GROUP BY t.mint ORDER BY count(*) DESC LIMIT 1`, lo, hi, lo, hi));
  // 2) a token that migrated inside the window (both venues)
  out.push(...q(`SELECT mint FROM migrations WHERE kind = 'migrate' AND slot BETWEEN ? AND ? ORDER BY slot LIMIT 1`, lo, hi));
  // 3) the busiest PumpSwap token in the window, 4) a mid-activity PumpSwap token
  const amm = q(`SELECT k.pubkey AS mint FROM trades tr JOIN keys k ON k.id = tr.mint_id WHERE tr.venue = 1 AND tr.slot BETWEEN ? AND ? GROUP BY tr.mint_id ORDER BY count(*) DESC LIMIT 40`, lo, hi);
  if (amm[0]) out.push(amm[0]); if (amm[20]) out.push(amm[20]);
  // 5) a quiet bonding-curve token (median activity) created in the window
  const quiet = q(`SELECT t.mint FROM tokens t JOIN keys k ON k.pubkey = t.mint JOIN trades tr ON tr.mint_id = k.id WHERE t.created_slot BETWEEN ? AND ? GROUP BY t.mint HAVING count(*) BETWEEN 5 AND 60 ORDER BY t.created_slot LIMIT 1`, lo, hi);
  if (quiet[0]) out.push(quiet[0]);
  return out.slice(0, n);
}

function tokenCheck() {
  const t = db.prepare(`SELECT count(*) AS n, sum(seen_logs) AS logs, sum(seen_pp) AS pp, sum(seen_logs AND seen_pp) AS both,
      sum(seen_pp AND NOT seen_logs) AS ppOnly, sum(seen_logs AND NOT seen_pp) AS logsOnly FROM tokens
      WHERE first_seen_at BETWEEN (SELECT min(at) FROM heartbeats) AND (SELECT max(at) FROM heartbeats) - 120000`).get() as any;
  const byPad = db.prepare(`SELECT coalesce(launchpad,'?') AS pad, count(*) AS n, sum(seen_logs) AS logs, sum(seen_pp) AS pp FROM tokens GROUP BY 1`).all();
  const ppOnly = db.prepare(`SELECT mint, launchpad FROM tokens WHERE seen_pp AND NOT seen_logs AND first_seen_at < (SELECT max(at) FROM heartbeats) - 120000 LIMIT 10`).all();
  const m = db.prepare(`SELECT kind, count(*) AS n, sum(seen_logs) AS logs, sum(seen_pp) AS pp, sum(seen_logs AND seen_pp) AS both FROM migrations GROUP BY kind`).all();
  console.log('TOKEN-CHECK ' + JSON.stringify({ tokens: t, byLaunchpad: byPad, ppOnlyExamples: ppOnly, migrations: m }));
}

if (has('program')) await programCheck();
if (has('mints') || has('auto-mints')) {
  const mints = has('mints') ? opt('mints', '').split(',').filter(Boolean) : autoMints(Number(opt('auto-mints', '5')));
  console.log('mints: ' + mints.join(' '));
  await mintCheck(mints);
}
if (has('tokens')) tokenCheck();
if (has('chain')) chainCheck();
if (has('pools')) await poolsCheck(Number(opt('pools', '3')) || 3);

/** PumpSwap scope check: trade-level windows of the most recent tracked pools vs Helius gTFA on the pool address. */
async function poolsCheck(n: number) {
  if (!HELIUS) throw new Error('no Helius RPC_URL in .env');
  const pools = db.prepare(`SELECT pool, mint, migrate_slot, logs_to_slot, logs_status FROM tracked_pools WHERE logs_to_slot IS NOT NULL ORDER BY registered_at DESC LIMIT ?`).all(n) as any[];
  const out: any[] = [];
  for (const p of pools) {
    const from = p.migrate_slot, to = p.logs_to_slot;
    const truth = new Set<string>();
    const r = await gtfaWindow(HELIUS, p.pool, from, to, budget, (page) => {
      for (const tx of page) if (tx.meta && !tx.meta.err) for (const e of truthEvents(tx)) if (e.venue === 'pumpswap' && e.pool === p.pool) truth.add(e.key);
    }, { limit: 500 });
    const rows = db.prepare(`SELECT sig, idx FROM trades_v WHERE pool = ? AND slot BETWEEN ? AND ?`).all(p.pool, from, to) as any[];
    const have = new Set(rows.map(x => `${x.sig}:${x.idx}`));
    let matched = 0; const miss: string[] = []; for (const k of truth) { if (have.has(k)) matched++; else if (miss.length < 3) miss.push(k); }
    const res = { pool: p.pool, mint: p.mint, slots: `${from}..${to}`, logsStatus: p.logs_status, chainTrades: truth.size, dbTrades: rows.length, matched,
      pct: +(100 * matched / Math.max(1, truth.size)).toFixed(3), credits: r.credits, complete: r.complete, missingExamples: miss };
    out.push(res);
    console.log(`  pool ${p.pool} ${from}..${to} (${p.logs_status}): chain ${truth.size}, db ${rows.length}, matched ${matched} (${res.pct}%), ${r.credits} cr`);
    if (!r.complete) break;
  }
  console.log('POOLS-CHECK ' + JSON.stringify(out));
}

function chainCheck() {
  const rows = db.prepare(`
    WITH t AS (
      SELECT venue, coalesce(pool_id, mint_id) AS part, mint_id, sig, slot, tx_index, idx, is_buy, quote_amount, token_amount, r_quote, r_token, fee_lp,
             LAG(r_quote) OVER w AS pq, LAG(r_token) OVER w AS pt, LAG(sig) OVER w AS psig
      FROM trades
      WHERE slot BETWEEN ? AND ? AND quote_mint_id IS NULL AND user_quote IS NOT NULL AND r_quote IS NOT NULL
      WINDOW w AS (PARTITION BY venue, coalesce(pool_id, mint_id) ORDER BY slot, coalesce(seq, 0), coalesce(tx_index, 1000000000), idx))
    SELECT venue, part, sig, psig, slot, tx_index,
      CASE WHEN venue = 0 THEN
        ((CASE WHEN is_buy THEN r_quote - quote_amount ELSE r_quote + quote_amount END) = pq AND (CASE WHEN is_buy THEN r_token + token_amount ELSE r_token - token_amount END) = pt)
      ELSE
        ((CASE WHEN is_buy THEN r_quote - (quote_amount + fee_lp) ELSE r_quote + (quote_amount - fee_lp) END) = pq AND (CASE WHEN is_buy THEN r_token + token_amount ELSE r_token - token_amount END) = pt)
      END AS ok
    FROM t WHERE pq IS NOT NULL`).all(lo, hi) as any[];
  const agg: Record<string, { pairs: number; breaks: number; parts: Set<number>; badParts: Set<number>; nullIdx: number; examples: string[] }> = {};
  for (const r of rows) {
    const k = r.venue === 0 ? 'pump' : 'pumpswap';
    const a = agg[k] ??= { pairs: 0, breaks: 0, parts: new Set(), badParts: new Set(), nullIdx: 0, examples: [] };
    a.pairs++; a.parts.add(r.part); if (r.tx_index === null) a.nullIdx++;
    if (!r.ok) { a.breaks++; a.badParts.add(r.part); if (a.examples.length < 6) a.examples.push(`${r.psig} -> ${r.sig}`); }
  }
  const out: any = {};
  for (const [k, a] of Object.entries(agg)) out[k] = { pairs: a.pairs, breaks: a.breaks, continuityPct: +(100 * (1 - a.breaks / Math.max(1, a.pairs))).toFixed(4),
    coinsOrPools: a.parts.size, withAnyBreak: a.badParts.size, withAnyBreakPct: +(100 * a.badParts.size / Math.max(1, a.parts.size)).toFixed(3), rowsWithoutTxIndex: a.nullIdx, breakExamples: a.examples };
  console.log('CHAIN-CHECK ' + JSON.stringify({ lo, hi, ...out }));
}
console.log(`helius credits spent by this run: ${budget.total}`);
