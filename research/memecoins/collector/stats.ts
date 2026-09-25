/**
 * Collection rates from the collector's own per-minute heartbeats + table counts (read-only).
 *   node --import tsx stats.ts [--db=path] [--since-min=60]
 */
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const opt = (n: string, d: string) => { const a = argv.find(x => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const DB = opt('db', path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'data', 'memecoins.db'));
const sinceMin = Number(opt('since-min', '0'));
const db = new Database(DB, { fileMustExist: true });
const hbs = (db.prepare('SELECT at, stats FROM heartbeats ORDER BY at').all() as { at: number; stats: string }[])
  .map(r => ({ at: r.at, s: JSON.parse(r.stats) }))
  .filter(r => !sinceMin || r.at >= Date.now() - sinceMin * 60_000);
if (hbs.length < 2) { console.log('not enough heartbeats yet'); process.exit(0); }
const hours = hbs.reduce((a, h) => a + h.s.minutes, 0) / 60;
const sum = (f: (s: any) => number) => hbs.reduce((a, h) => a + (f(h.s) || 0), 0);
const perH = (x: number) => Math.round(x / hours);
const ev = (k: string) => sum(s => s.events?.[k]);
const streamSum = (name: string, k: string) => sum(s => s.streams?.[name]?.[k]);
const first = hbs[0], last = hbs[hbs.length - 1];
const dbGrowthMb = last.s.dbMb - first.s.dbMb; const spanH = (last.at - first.at) / 3.6e6;
const fileMb = [DB, `${DB}-wal`].reduce((a, f) => { try { return a + fs.statSync(f).size / 1e6; } catch { return a; } }, 0);
const counts = db.prepare(`SELECT (SELECT max(rowid) FROM trades) AS trades, (SELECT count(*) FROM events) AS events, (SELECT count(*) FROM token_meta WHERE status = 'ok') AS metaOk, (SELECT count(*) FROM tokens) AS tokens, (SELECT count(*) FROM migrations WHERE kind='migrate') AS migrations,
  (SELECT count(*) FROM pools) AS pools, (SELECT count(*) FROM keys) AS keys, (SELECT count(*) FROM gaps) AS gaps,
  (SELECT coalesce(sum(to_slot - from_slot), 0) FROM gaps) AS gapSlots, (SELECT count(*) FROM gaps WHERE fill_status = 'filled') AS gapsFilled`).get();
const out = {
  window: { from: new Date(first.at).toISOString(), to: new Date(last.at).toISOString(), hours: +hours.toFixed(2) },
  perHour: {
    pumpTrades: perH(ev('pump.trade')), pumpswapTrades: perH(ev('amm.trade')), tokensCreated: perH(ev('pump.CreateEvent')),
    curveCompletions: perH(ev('pump.CompleteEvent')), migrations: perH(ev('pump.CompletePumpAmmMigrationEvent')), poolsCreated: perH(ev('amm.CreatePoolEvent')),
    initBoost: perH(ev('amm.InitBoostEvent')), boostBuyAndBurn: perH(ev('amm.BoostBuyAndBurnEvent')),
    tradeRowsInserted: perH(sum(s => s.tradesInserted)), duplicateRowsIgnored: perH(sum(s => s.tradesDup)),
    pumpportalCreates: perH(sum(s => s.pumpportal?.creates)), pumpportalMigrations: perH(sum(s => s.pumpportal?.migrations)),
    wsMsgs: { pump: perH(streamSum('pump', 'msgs')), amm: perH(streamSum('amm', 'msgs')) },
    wsDownloadMb: { pump: perH(streamSum('pump', 'bytes') / 1e6), amm: perH(streamSum('amm', 'bytes') / 1e6), graduatedPoolLogs: perH(sum(s => s.pools?.logBytes) / 1e6) },
    graduatedPools: { registered: perH(sum(s => s.pools?.registered)), armedBeforeMigration: perH(sum(s => s.pools?.armed)), lateSubscribe: perH(sum(s => s.pools?.lateSubscribe)),
      tradesFromPoolLogs: perH(sum(s => s.pools?.logTrades)), stateRows: perH(sum(s => s.pools?.states)), pollCalls: perH(sum(s => s.pools?.pollCalls)), pollErrors: perH(sum(s => s.pools?.pollErrors)),
      trackedNow: last.s.pools?.trackedPools ?? null },
    chainAudit: { pairs: perH(sum(s => s.chain?.pairs)), breaks: perH(sum(s => s.chain?.breaks)), phantomsRemoved: perH(sum(s => s.chain?.phantoms)), holesQueued: perH(sum(s => s.chain?.holes)) },
    wsFailedTxMsgs: { pump: perH(streamSum('pump', 'failed')), amm: perH(streamSum('amm', 'failed')) },
    truncatedLogs: perH(streamSum('pump', 'truncated') + streamSum('amm', 'truncated')),
    reconnects: perH(streamSum('pump', 'reconnects') + streamSum('amm', 'reconnects')),
    dbGrowthMb: +(dbGrowthMb / spanH).toFixed(1),
    heliusCredits: perH(Math.max(0, last.s.helius.total - (first.s.helius?.total ?? 0))),
    blocksFetchedForTxIndex: perH(sum(s => s.txIndex?.blocks)), blockListMb: perH(sum(s => s.txIndex?.kb) / 1000),
    rowsWithoutTxIndex: perH(sum(s => s.txIndex?.unresolvedRows)), metadataOk: perH(sum(s => s.meta?.ok)), metadataFailed: perH(sum(s => s.meta?.failed)),
    nonTradeEvents: perH(sum(s => Object.entries(s.events ?? {}).filter(([k]) => k !== 'pump.trade' && k !== 'amm.trade').reduce((a, [, v]) => a + (v as number), 0))),
  },
  wouldCostOnHeliusWs: { creditsPerHour: perH((streamSum('pump', 'bytes') + streamSum('amm', 'bytes') + sum(s => s.pools?.logBytes)) / 1e5 * 2) },
  lagSec: { last: last.s.lagSec, max: Math.max(...hbs.map(h => h.s.lagSec ?? 0)) },
  rssMb: { first: first.s.rssMb, last: last.s.rssMb, max: Math.max(...hbs.map(h => h.s.rssMb)) },
  files: { dbPlusWalMb: +fileMb.toFixed(1), diskFreeGb: last.s.diskFreeGb },
  totals: counts,
};
console.log(JSON.stringify(out, null, 2));
