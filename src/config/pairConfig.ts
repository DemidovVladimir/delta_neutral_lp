/**
 * Pair roles for the configured Meteora pool — the single place that knows
 * which mint plays which role in the LP machinery.
 *
 * The codebase grew up on SOL/USDC and names its two sides `sol`/`usdc`
 * everywhere (state fields, DB columns, log keys). Those names are ROLES,
 * not tokens:
 *   base  = pool tokenX — the volatile side (code's "sol" role)
 *   quote = pool tokenY — the measuring stick (code's "usdc" role)
 *
 * For the production SOL/USDC pool this module resolves to exactly the old
 * hardcoded constants, so behavior is bit-identical. For an X/SOL pool
 * (HYPE/SOL test instance, BACKLOG A20) base=HYPE, quote=SOL: amounts in
 * "usdc"-named fields are SOL amounts, prices are "quote per base" (SOL per
 * HYPE), and every "USD" figure in logs/DB is a SOL figure — the operator's
 * SOL-metric by construction.
 *
 * Roles are DERIVED from the pool on the first on-chain read
 * (initPairFromPool — call it wherever a DLMM instance is created); no
 * operator-entered mints or decimals. Until then getPair() returns the
 * SOL/USDC defaults, which keeps every read-only CLI that never touches the
 * pool working unchanged.
 */
import { log } from '../utils/logger.js';

export const NATIVE_SOL_MINT = 'So11111111111111111111111111111111111111112';
export const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

export interface PairConfig {
  /** pool tokenX — volatile side, the code's "sol" role */
  baseMint: string;
  baseDecimals: number;
  /** pool tokenY — quote side, the code's "usdc" role */
  quoteMint: string;
  quoteDecimals: number;
  /** true when the quote is real USDC — every legacy USD assumption holds */
  quoteIsUsd: boolean;
  /** base is native SOL → base balance is the wallet lamport balance */
  baseIsNativeSol: boolean;
  /** quote is native SOL → quote balance is the wallet lamport balance, and rent/fee reserves live on the QUOTE side */
  quoteIsNativeSol: boolean;
  initialized: boolean;
}

const SOL_USDC_DEFAULT: PairConfig = {
  baseMint: NATIVE_SOL_MINT,
  baseDecimals: 9,
  quoteMint: USDC_MINT,
  quoteDecimals: 6,
  quoteIsUsd: true,
  baseIsNativeSol: true,
  quoteIsNativeSol: false,
  initialized: false,
};

let current: PairConfig = { ...SOL_USDC_DEFAULT };

export function getPair(): PairConfig {
  return current;
}

/**
 * Derive pair roles from a live DLMM pool instance. Idempotent and cheap —
 * call from every code path that creates a DLMM instance. Accepts the SDK
 * pool object structurally (tokenX/tokenY with publicKey + mint.decimals)
 * to stay out of the SDK's type churn.
 */
export function initPairFromPool(pool: {
  tokenX: { publicKey: { toBase58(): string }; mint: { decimals: number } };
  tokenY: { publicKey: { toBase58(): string }; mint: { decimals: number } };
}): PairConfig {
  const baseMint = pool.tokenX.publicKey.toBase58();
  const quoteMint = pool.tokenY.publicKey.toBase58();
  if (current.initialized && current.baseMint === baseMint && current.quoteMint === quoteMint) {
    return current;
  }
  const next: PairConfig = {
    baseMint,
    baseDecimals: pool.tokenX.mint.decimals,
    quoteMint,
    quoteDecimals: pool.tokenY.mint.decimals,
    quoteIsUsd: quoteMint === USDC_MINT,
    baseIsNativeSol: baseMint === NATIVE_SOL_MINT,
    quoteIsNativeSol: quoteMint === NATIVE_SOL_MINT,
    initialized: true,
  };
  const changed = current.initialized;
  current = next;
  if (!next.quoteIsUsd || changed) {
    log.info('Pair roles derived from pool', {
      baseMint: next.baseMint,
      baseDecimals: next.baseDecimals,
      quoteMint: next.quoteMint,
      quoteDecimals: next.quoteDecimals,
      quoteIsUsd: next.quoteIsUsd,
      note: next.quoteIsUsd
        ? undefined
        : 'quote is NOT USDC — all "usd"-named figures are quote-token figures',
    });
  }
  return current;
}

/** Test-only escape hatch. */
export function __resetPairForTests(): void {
  current = { ...SOL_USDC_DEFAULT };
}
