/**
 * Wallet Janitor — reclaims rent from ZERO-BALANCE token accounts the wallet
 * owns (legacy dust ATAs: old memecoins, dead tokens). Each empty ATA locks
 * ~0.002 SOL of rent forever; closing returns it to the wallet.
 *
 * Safety rules:
 * - Only accounts with amount === 0 and state !== 'frozen' are touched.
 * - wSOL is NEVER touched: a long-decrease keeper fill (TX2) needs the wSOL
 *   ATA to outlive TX1 (see jupiterPerpsEngine); `unwrapWsol()` owns that
 *   lifecycle.
 * - USDC is NEVER touched: it's the working collateral/quote account.
 * - Fail-safe: any error is logged and swallowed — hygiene must never break
 *   the trading loop.
 */
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import { log } from '../utils/logger.js';

const TOKEN_PROGRAM = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const TOKEN_2022_PROGRAM = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
const WSOL_MINT = 'So11111111111111111111111111111111111111112';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

/** Mints the janitor must never close, even when empty. */
export const JANITOR_PROTECTED_MINTS = new Set([WSOL_MINT, USDC_MINT]);

const CLOSE_BATCH_SIZE = 4;

export interface ClosableAccount {
  ata: string;
  mint: string;
  programId: string;
  rentLamports: number;
}

/**
 * Pure filter: which parsed token accounts are safe to close?
 * Exported for unit tests.
 */
export function selectClosableAccounts(
  accounts: Array<{
    pubkey: string;
    programId: string;
    mint: string;
    amount: string;
    state: string;
    rentLamports: number;
  }>
): ClosableAccount[] {
  return accounts
    .filter(
      (a) => a.amount === '0' && a.state !== 'frozen' && !JANITOR_PROTECTED_MINTS.has(a.mint)
    )
    .map((a) => ({
      ata: a.pubkey,
      mint: a.mint,
      programId: a.programId,
      rentLamports: a.rentLamports,
    }));
}

function closeAccountIx(programId: PublicKey, account: PublicKey, owner: PublicKey) {
  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: account, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: true }, // rent destination
      { pubkey: owner, isSigner: true, isWritable: false }, // authority
    ],
    data: Buffer.from([9]), // SPL Token / Token-2022 CloseAccount
  });
}

/**
 * Find and close all safe-to-close empty token accounts. Returns the number
 * closed and the rent reclaimed (lamports). Never throws.
 */
export async function closeEmptyTokenAccounts(
  connection: Connection,
  keypair: Keypair,
  dryRun: boolean
): Promise<{ closed: number; reclaimedLamports: number }> {
  try {
    const owner = keypair.publicKey;
    const raw: Parameters<typeof selectClosableAccounts>[0] = [];
    for (const programId of [TOKEN_PROGRAM, TOKEN_2022_PROGRAM]) {
      const res = await connection.getParsedTokenAccountsByOwner(owner, { programId });
      for (const { pubkey, account } of res.value) {
        const info = account.data.parsed.info;
        raw.push({
          pubkey: pubkey.toBase58(),
          programId: programId.toBase58(),
          mint: info.mint,
          amount: info.tokenAmount.amount,
          state: info.state,
          rentLamports: account.lamports,
        });
      }
    }

    const targets = selectClosableAccounts(raw);
    if (targets.length === 0) return { closed: 0, reclaimedLamports: 0 };

    const totalRent = targets.reduce((s, t) => s + t.rentLamports, 0);
    log.info('🧹 Wallet janitor: empty token accounts found', {
      count: targets.length,
      reclaimableSol: totalRent / 1e9,
      dryRun,
    });
    if (dryRun) return { closed: 0, reclaimedLamports: 0 };

    let closed = 0;
    let reclaimed = 0;
    for (let i = 0; i < targets.length; i += CLOSE_BATCH_SIZE) {
      const chunk = targets.slice(i, i + CLOSE_BATCH_SIZE);
      const attempt = async (batch: ClosableAccount[]) => {
        const tx = new Transaction();
        for (const t of batch) {
          tx.add(
            closeAccountIx(new PublicKey(t.programId), new PublicKey(t.ata), owner)
          );
        }
        const sig = await sendAndConfirmTransaction(connection, tx, [keypair], {
          commitment: 'confirmed',
        });
        closed += batch.length;
        reclaimed += batch.reduce((s, t) => s + t.rentLamports, 0);
        log.info('🧹 Wallet janitor: closed empty token accounts', {
          count: batch.length,
          atas: batch.map((t) => t.ata),
          signature: sig,
        });
      };
      try {
        await attempt(chunk);
      } catch (batchError) {
        // One refusing account (e.g. a token-2022 extension) must not block
        // the rest — retry one-by-one and skip the bad apple.
        log.warn('Wallet janitor batch failed, retrying individually', {
          error: batchError instanceof Error ? batchError.message : String(batchError),
        });
        for (const t of chunk) {
          try {
            await attempt([t]);
          } catch (oneError) {
            log.warn('Wallet janitor: cannot close account, skipping', {
              ata: t.ata,
              mint: t.mint,
              error: oneError instanceof Error ? oneError.message : String(oneError),
            });
          }
        }
      }
    }
    if (closed > 0) {
      log.info('🧹 Wallet janitor done', { closed, reclaimedSol: reclaimed / 1e9 });
    }
    return { closed, reclaimedLamports: reclaimed };
  } catch (error) {
    log.warn('Wallet janitor failed (non-fatal)', {
      error: error instanceof Error ? error.message : String(error),
    });
    return { closed: 0, reclaimedLamports: 0 };
  }
}
