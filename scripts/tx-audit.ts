#!/usr/bin/env node
/**
 * TRANSACTION AUDIT (operator standing order 2026-07-07, MANDATORY at every
 * срез): list EVERY transaction touching the wallet in the window — full
 * signature verbatim, who paid the network fee and how much, exactly how the
 * wallet's SOL / USDC / wSOL balances moved, a classification guess, and a
 * cross-check against the bot's own pnl.db records. The point is to audit
 * the bot's accounting from CHAIN data, not to trust it.
 *
 *   npx tsx scripts/tx-audit.ts --since 2026-07-07T00:00:00Z [--until <ISO>] [--db data/pnl.db]
 *
 * Totals printed at the end come with their formulas spelled out.
 * Read-only; uses getSignaturesForAddress + getParsedTransactions in batches.
 */
import { Connection, PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddress } from '@solana/spl-token';
import Database from 'better-sqlite3';
import { getConfig } from '../src/config/env.js';
import { getConnection, getWalletKeypair } from '../src/utils/solana.js';

const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const WSOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');
const METEORA_PROGRAM = 'LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo';
const PERPS_PROGRAM = 'PERPHjGBqRHArX4DySjwM6UJHiR3sWAatqfdBS2qQJu';
const JUPITER_V6 = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4';

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const sinceIso = flag('--since');
  if (!sinceIso) {
    console.error('Usage: npx tsx scripts/tx-audit.ts --since <ISO> [--until <ISO>] [--db data/pnl.db]');
    process.exit(1);
  }
  const untilIso = flag('--until');
  const sinceSec = Date.parse(sinceIso) / 1000;
  const untilSec = untilIso ? Date.parse(untilIso) / 1000 : Number.POSITIVE_INFINITY;
  const dbPath = flag('--db') ?? 'data/pnl.db';

  getConfig();
  const connection: Connection = getConnection();
  const wallet = getWalletKeypair().publicKey;
  const usdcAta = await getAssociatedTokenAddress(USDC_MINT, wallet);

  // Known signatures from the bot's own records, for cross-checking.
  const known = new Map<string, string>();
  try {
    const db = new Database(dbPath, { readonly: true });
    const collect = (label: string, sql: string, params: unknown[]) => {
      try {
        for (const row of db.prepare(sql).all(...params) as Record<string, string | null>[]) {
          for (const v of Object.values(row)) {
            if (typeof v === 'string' && v.length > 40) known.set(v.trim(), label);
          }
        }
      } catch (e) {
        console.error(`(cross-check ${label} unavailable: ${e instanceof Error ? e.message : e})`);
      }
    };
    collect('db:hedge_action', 'SELECT signature FROM hedge_actions WHERE signature IS NOT NULL AND taken_at >= ?', [sinceIso]);
    collect('db:rebalance', 'SELECT withdraw_signature, create_signature, swap_signature FROM rebalances WHERE triggered_at >= ?', [sinceIso]);
    collect('db:swap', "SELECT signature FROM swaps WHERE timestamp >= ?", [sinceIso]);
    db.close();
  } catch (e) {
    console.error(`(pnl.db cross-check unavailable: ${e instanceof Error ? e.message : e})`);
  }

  // Collect signatures in the window (paginated).
  const sigs: { signature: string; blockTime: number; err: unknown }[] = [];
  let before: string | undefined;
  for (;;) {
    const page = await connection.getSignaturesForAddress(wallet, { before, limit: 1000 });
    if (page.length === 0) break;
    for (const s of page) {
      const t = s.blockTime ?? 0;
      if (t < sinceSec) continue;
      if (t <= untilSec) sigs.push({ signature: s.signature, blockTime: t, err: s.err });
    }
    const oldest = page[page.length - 1];
    if ((oldest.blockTime ?? 0) < sinceSec) break;
    before = oldest.signature;
    if (sigs.length > 5000) {
      console.error('More than 5000 signatures in window — narrow the range.');
      process.exit(1);
    }
  }
  sigs.sort((a, b) => a.blockTime - b.blockTime);
  const failed = sigs.filter((s) => s.err !== null);
  const ok = sigs.filter((s) => s.err === null);
  console.log(`\nWindow ${sinceIso} → ${untilIso ?? 'now'}: ${sigs.length} transactions touching the wallet (${ok.length} ok, ${failed.length} failed)`);
  console.log('Failed txs cost the wallet nothing unless the wallet was the fee payer (flagged below).\n');

  const totals = {
    feeSol: 0,
    feeCount: 0,
    solIn: 0,
    solOut: 0,
    usdcIn: 0,
    usdcOut: 0,
    keeperTxs: 0,
    byClass: new Map<string, number>(),
  };

  for (let i = 0; i < sigs.length; i += 20) {
    const batch = sigs.slice(i, i + 20);
    const parsed = await connection.getParsedTransactions(
      batch.map((s) => s.signature),
      { maxSupportedTransactionVersion: 0 },
    );
    for (let j = 0; j < batch.length; j++) {
      const sig = batch[j];
      const tx = parsed[j];
      const when = new Date(sig.blockTime * 1000).toISOString();
      if (!tx || !tx.meta) {
        console.log(`${when}  ${sig.signature}  (unavailable from RPC)`);
        continue;
      }
      const keys = tx.transaction.message.accountKeys;
      const feePayer = keys[0].pubkey;
      const wePaidFee = feePayer.equals(wallet);
      const feeSol = wePaidFee ? (tx.meta.fee ?? 0) / 1e9 : 0;

      const wIdx = keys.findIndex((k) => k.pubkey.equals(wallet));
      const solDelta = wIdx >= 0 ? ((tx.meta.postBalances[wIdx] ?? 0) - (tx.meta.preBalances[wIdx] ?? 0)) / 1e9 : 0;

      const tokDelta = (mint: PublicKey): number => {
        const pre = tx.meta!.preTokenBalances?.find((b) => b.mint === mint.toBase58() && b.owner === wallet.toBase58());
        const post = tx.meta!.postTokenBalances?.find((b) => b.mint === mint.toBase58() && b.owner === wallet.toBase58());
        return (post?.uiTokenAmount.uiAmount ?? 0) - (pre?.uiTokenAmount.uiAmount ?? 0);
      };
      const usdcDelta = tokDelta(USDC_MINT);
      const wsolDelta = tokDelta(WSOL_MINT);

      const programIds = new Set(
        keys.map((k) => k.pubkey.toBase58()).filter((k) => [METEORA_PROGRAM, PERPS_PROGRAM, JUPITER_V6].includes(k)),
      );
      let klass = known.get(sig.signature) ?? '';
      if (!klass) {
        if (programIds.has(PERPS_PROGRAM)) klass = wePaidFee ? 'perps TX1 (ours)' : 'perps keeper TX2';
        else if (programIds.has(METEORA_PROGRAM)) klass = 'meteora LP';
        else if (programIds.has(JUPITER_V6)) klass = 'jupiter swap';
        else klass = wePaidFee ? 'other (ours)' : 'other (external)';
      }
      if (!wePaidFee && programIds.has(PERPS_PROGRAM)) totals.keeperTxs++;

      totals.feeSol += feeSol;
      if (wePaidFee) totals.feeCount++;
      if (solDelta > 0) totals.solIn += solDelta;
      else totals.solOut += -solDelta;
      if (usdcDelta > 0) totals.usdcIn += usdcDelta;
      else totals.usdcOut += -usdcDelta;
      totals.byClass.set(klass, (totals.byClass.get(klass) ?? 0) + 1);

      const failedMark = sig.err !== null ? '  ❌FAILED' : '';
      const parts = [
        `fee ${wePaidFee ? feeSol.toFixed(9) + ' SOL (wallet paid)' : '0 (payer: keeper/other)'}`,
        `ΔSOL ${solDelta >= 0 ? '+' : ''}${solDelta.toFixed(9)}`,
        `ΔUSDC ${usdcDelta >= 0 ? '+' : ''}${usdcDelta.toFixed(6)}`,
      ];
      if (wsolDelta !== 0) parts.push(`ΔwSOL ${wsolDelta >= 0 ? '+' : ''}${wsolDelta.toFixed(9)}`);
      console.log(`${when}  ${sig.signature}\n    ${klass}${failedMark}  |  ${parts.join('  |  ')}`);
    }
  }

  console.log('\n──────────────── TOTALS (formulas spelled out) ────────────────');
  console.log(`network fees PAID BY WALLET = Σ tx.meta.fee over txs where wallet is fee payer`);
  console.log(`  = ${totals.feeSol.toFixed(9)} SOL over ${totals.feeCount} txs (keeper-paid txs: ${totals.keeperTxs}, cost us 0)`);
  console.log(`wallet SOL moved:  in Σ(+ΔSOL) = +${totals.solIn.toFixed(9)}  |  out Σ(−ΔSOL) = −${totals.solOut.toFixed(9)}  |  net = ${(totals.solIn - totals.solOut).toFixed(9)}`);
  console.log(`wallet USDC moved: in Σ(+ΔUSDC) = +${totals.usdcIn.toFixed(6)}  |  out Σ(−ΔUSDC) = −${totals.usdcOut.toFixed(6)}  |  net = ${(totals.usdcIn - totals.usdcOut).toFixed(6)}`);
  console.log('  (ΔSOL/ΔUSDC are the wallet balance changes read from each tx pre/post balances —');
  console.log('   LP deposits show as out, LP withdrawals as in, position rent out on create / back on close,');
  console.log('   short collateral out on increase / back with PnL on decrease-fill.)');
  console.log('tx count by class:');
  for (const [k, v] of [...totals.byClass.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(v).padStart(4)}  ${k}`);
  }
  console.log('\nCross-check: rows classified db:* were found in pnl.db; perps/meteora/jupiter rows');
  console.log('WITHOUT a db:* tag are chain-visible actions the bot did not record — investigate those.');
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
