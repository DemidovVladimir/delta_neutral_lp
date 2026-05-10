/**
 * sendOptimized — latency-preserving fee-minimization wrapper for
 * `sendRawTransaction` calls into Meteora.
 *
 * Two layered wins, both Solana-native, both zero-latency-cost:
 *
 *   1. Tight `setComputeUnitLimit` driven by a per-tx
 *      `simulateTransaction` round-trip. The Meteora SDK reserves up to
 *      ~1.4M CU "just in case" but real usage is 200-400k for
 *      `createPosition` and `removeLiquidity({shouldClaimAndClose:true})`.
 *      Priority fee = CU_limit × CU_price, so paying for unused units is
 *      pure waste. We simulate, read `unitsConsumed`, set the limit at
 *      `actual × 1.1`. Tighter blocks also land slightly faster (leader CU
 *      bucket has more room for our tx) so this is a fee win that doesn't
 *      cost latency.
 *
 *   2. Adaptive `setComputeUnitPrice` from Helius's
 *      `getPriorityFeeEstimate` JSON-RPC method. The Meteora SDK injects a
 *      static price (~50k µL/CU). Helius returns a percentile-based estimate
 *      computed from the *specific writable accounts* the tx touches — the
 *      pool, bin arrays, position NFT — so we pay the actual local fee
 *      market rather than a worst-case. On calm days this commonly drops
 *      from 50k µL/CU to 1-5k µL/CU; on busy days it bumps appropriately.
 *
 * The SDK already prepends ComputeBudget instructions to the transaction
 * it returns. We strip those before adding our own — otherwise Solana
 * uses the *first* setComputeUnitPrice it sees, and the SDK's would win.
 *
 * Failure modes are all fail-open:
 *   • simulation error → use a generous fallback limit (1.4M)
 *   • Helius unavailable → use a sane floor (1000 µL/CU)
 *   • non-Helius RPC → skip the priority-fee call entirely
 *
 * Gated behind the `SEND_OPTIMIZED` env flag (default off). When off, this
 * wrapper falls through to a plain blockhash-set + sign + send so the call
 * sites can switch over without behavioural risk on day one.
 */

import {
  Connection,
  Keypair,
  Transaction,
  ComputeBudgetProgram,
  PublicKey,
} from '@solana/web3.js';
import bs58 from 'bs58';
import { fetch } from 'undici';
import { log } from './logger.js';

export const COMPUTE_BUDGET_PROGRAM_ID = new PublicKey(
  'ComputeBudget111111111111111111111111111111',
);

// ──────────────────────────────────────────────────────────────────────────
// Tunables — kept centralized so they're easy to find.
// ──────────────────────────────────────────────────────────────────────────

/**
 * Multiplier on simulated `unitsConsumed`. 1.1 = pad by 10%. Tight enough
 * to capture savings, generous enough that minor SDK-version drift in CU
 * usage doesn't push us over and fail.
 */
const CU_LIMIT_HEADROOM = 1.1;

/** Hard ceiling so a runaway simulation can't ask for the whole 1.4M block. */
const CU_LIMIT_CEILING = 1_400_000;

/** Used when simulation fails — generous to avoid out-of-CU on send. */
const CU_LIMIT_FALLBACK = 600_000;

/**
 * Floor on adaptive priority-fee. Even when Helius reports 0 (truly quiet
 * network), we pay this minimum so we always make a leader's priority queue.
 * 1000 µL/CU × 400k CU = 400k µL = 0.0004 SOL ≈ $0.05 — negligible cost,
 * meaningful inclusion guarantee.
 */
const CU_PRICE_FLOOR = 1_000;

/**
 * Ceiling on adaptive priority-fee. Helius can return very high numbers
 * during a flash-mob congestion event; we cap so we don't accidentally pay
 * $5+ for a single tx while we're not watching. If you ever hit this
 * during a rebalance attempt, the orchestrator's retry logic will wait
 * and try again on the next cycle when the fee market has cooled.
 */
const CU_PRICE_CEILING = 5_000_000;

// ──────────────────────────────────────────────────────────────────────────
// Public API
// ──────────────────────────────────────────────────────────────────────────

export interface SendOptimizedParams {
  connection: Connection;
  /** Tx as returned from a Meteora SDK builder. May already contain ComputeBudget ixs. */
  tx: Transaction;
  /** Fee payer + primary signer. */
  wallet: Keypair;
  /** Extra signers (e.g. positionKeypair for createPosition). */
  additionalSigners?: Keypair[];
  /**
   * Operator-facing label for logs ("createPosition", "withdrawClaimAndClose").
   * Lets us correlate the optimization metrics with which call site ran.
   */
  label: string;
}

export interface SendOptimizedResult {
  signature: string;
  /** Blockhash used so the caller can pass it to `confirmTransaction`. */
  blockhash: string;
  /** Last valid block height matching `blockhash`. */
  lastValidBlockHeight: number;
  /** True if optimization actually ran (env flag on AND we got useful values). */
  optimized: boolean;
  /** What we set the CU limit to (or null if not touched). */
  cuLimit?: number;
  /** What we set the CU price to in microlamports per CU (or null if not touched). */
  cuPriceMicroLamports?: number;
}

/**
 * Optimized send. When `SEND_OPTIMIZED=true` strips the SDK's ComputeBudget
 * instructions, runs simulation + Helius priority-fee estimate, prepends
 * explicit ComputeBudget instructions with the adaptive values, re-signs,
 * and sends. When the env flag is off (default), falls through to a plain
 * sign-and-send so behaviour is identical to the pre-wrapper code path.
 */
export async function sendOptimized(
  params: SendOptimizedParams,
): Promise<SendOptimizedResult> {
  const { connection, tx, wallet, additionalSigners = [], label } = params;

  const optimizationEnabled =
    (process.env.SEND_OPTIMIZED ?? '').toLowerCase() === 'true';

  // Always set fee payer + a fresh blockhash up front — both code paths
  // need it, and `confirmTransaction` callers depend on getting the
  // matching pair back.
  tx.feePayer = wallet.publicKey;
  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash();
  tx.recentBlockhash = blockhash;

  if (!optimizationEnabled) {
    // Fall-through path: sign + send as-is. Mirror's the pre-wrapper code
    // that lives in meteoraAdapter today.
    tx.sign(wallet, ...additionalSigners);
    const signature = await connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
      maxRetries: 3,
    });
    return {
      signature,
      blockhash,
      lastValidBlockHeight,
      optimized: false,
    };
  }

  // ────────────────────────────── OPTIMIZED PATH ──────────────────────────

  // 1. Strip SDK-injected ComputeBudget instructions. We build a fresh
  //    instruction list so our values aren't shadowed by whatever the SDK
  //    emitted — Solana respects the *first* CU price/limit instruction it
  //    sees, so leaving the SDK's in front would defeat the whole exercise.
  const sdkComputeBudgetIxCount = tx.instructions.filter((ix) =>
    ix.programId.equals(COMPUTE_BUDGET_PROGRAM_ID),
  ).length;
  const businessIxs = tx.instructions.filter(
    (ix) => !ix.programId.equals(COMPUTE_BUDGET_PROGRAM_ID),
  );

  // 2. Simulate to discover real CU usage. We use a generous CU_LIMIT_CEILING
  //    for the simulation tx so simulation itself doesn't run out — what
  //    we care about is `unitsConsumed`, not whether sim's ceiling fits.
  let cuLimit = CU_LIMIT_FALLBACK;
  try {
    const simTx = new Transaction();
    simTx.feePayer = wallet.publicKey;
    simTx.recentBlockhash = blockhash;
    simTx.add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: CU_LIMIT_CEILING }),
    );
    for (const ix of businessIxs) simTx.add(ix);
    simTx.sign(wallet, ...additionalSigners);

    const sim = await connection.simulateTransaction(simTx);
    if (sim.value.err) {
      log.warn(
        `[sendOptimized:${label}] simulation returned err — using CU_LIMIT_FALLBACK`,
        { err: JSON.stringify(sim.value.err).slice(0, 200) },
      );
    } else if (
      typeof sim.value.unitsConsumed === 'number' &&
      sim.value.unitsConsumed > 0
    ) {
      cuLimit = Math.min(
        CU_LIMIT_CEILING,
        Math.ceil(sim.value.unitsConsumed * CU_LIMIT_HEADROOM),
      );
    } else {
      log.warn(
        `[sendOptimized:${label}] simulation returned no unitsConsumed — using CU_LIMIT_FALLBACK`,
      );
    }
  } catch (e) {
    log.warn(
      `[sendOptimized:${label}] simulation threw — using CU_LIMIT_FALLBACK`,
      { error: e instanceof Error ? e.message : String(e) },
    );
  }

  // 3. Get adaptive priority fee from Helius (if the RPC URL is Helius).
  let cuPriceMicroLamports = CU_PRICE_FLOOR;
  try {
    const helius = await getHeliusPriorityFeeEstimate({
      connection,
      // Send the tx WITHOUT signatures; Helius cares about the message
      // accounts, not the signers. Saves a sign step.
      txForEstimate: buildTxForEstimate(blockhash, wallet, businessIxs),
    });
    if (helius !== null) {
      cuPriceMicroLamports = Math.max(
        CU_PRICE_FLOOR,
        Math.min(CU_PRICE_CEILING, Math.ceil(helius)),
      );
    }
  } catch (e) {
    log.warn(
      `[sendOptimized:${label}] Helius priority-fee estimate failed — using floor`,
      { error: e instanceof Error ? e.message : String(e) },
    );
  }

  // 4. Build the final tx with our explicit ComputeBudget instructions.
  //    Mutating the original `tx` keeps signer plumbing simple — we just
  //    rewrite its instructions array.
  tx.instructions = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: cuLimit }),
    ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: cuPriceMicroLamports,
    }),
    ...businessIxs,
  ];

  // 5. Sign + send.
  tx.sign(wallet, ...additionalSigners);

  const estimatedFeeLamports = Math.ceil(
    (cuLimit * cuPriceMicroLamports) / 1_000_000,
  );

  log.info(`📤 [sendOptimized:${label}] sending`, {
    cuLimit,
    cuPriceMicroLamports,
    estimatedPriorityFeeLamports: estimatedFeeLamports,
    estimatedPriorityFeeSol: (estimatedFeeLamports / 1e9).toFixed(6),
    strippedSdkComputeBudgetIxs: sdkComputeBudgetIxCount,
  });

  const signature = await connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    preflightCommitment: 'confirmed',
    maxRetries: 3,
  });

  return {
    signature,
    blockhash,
    lastValidBlockHeight,
    optimized: true,
    cuLimit,
    cuPriceMicroLamports,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Internal helpers
// ──────────────────────────────────────────────────────────────────────────

/**
 * Build a tx skeleton suitable for handing to Helius. Helius reads the
 * account list to scope the percentile estimate; signatures aren't needed.
 */
function buildTxForEstimate(
  blockhash: string,
  wallet: Keypair,
  businessIxs: Transaction['instructions'],
): Transaction {
  const t = new Transaction();
  t.feePayer = wallet.publicKey;
  t.recentBlockhash = blockhash;
  for (const ix of businessIxs) t.add(ix);
  return t;
}

interface HeliusEstimateInput {
  connection: Connection;
  txForEstimate: Transaction;
}

/**
 * Call Helius's `getPriorityFeeEstimate` JSON-RPC method. Returns the
 * recommended µL/CU value or null when the RPC isn't Helius / the call
 * fails. Helius accepts the call on the same endpoint URL as standard
 * `sendRawTransaction`, using the same API key.
 */
async function getHeliusPriorityFeeEstimate(
  input: HeliusEstimateInput,
): Promise<number | null> {
  // Pull the endpoint from the connection. @solana/web3.js exposes this via
  // a private field; we tolerate undefined by skipping (still safe).
  const endpoint = (input.connection as any)._rpcEndpoint as string | undefined;
  if (!endpoint || !endpoint.includes('helius')) {
    return null;
  }

  // Helius docs: transaction parameter is base58 by default. We have bs58
  // already as a top-level dep; serialize unsigned (the API doesn't verify
  // signatures, only walks the message account list).
  const serialized = input.txForEstimate.serialize({
    requireAllSignatures: false,
    verifySignatures: false,
  });
  const txBase58 = bs58.encode(serialized);

  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: 'sendOptimized',
    method: 'getPriorityFeeEstimate',
    params: [
      {
        transaction: txBase58,
        // `recommended: true` returns Helius's curated middle-of-road
        // estimate that already balances inclusion vs cost. Avoids us
        // hand-picking percentiles per situation.
        options: { recommended: true },
      },
    ],
  });

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
  if (!res.ok) {
    log.warn('[sendOptimized] Helius getPriorityFeeEstimate non-200', {
      status: res.status,
    });
    return null;
  }
  const data = (await res.json()) as {
    error?: { message?: string };
    result?: { priorityFeeEstimate?: number };
  };
  if (data.error) {
    log.warn('[sendOptimized] Helius returned RPC error', {
      message: data.error.message,
    });
    return null;
  }
  const estimate = data.result?.priorityFeeEstimate;
  if (typeof estimate !== 'number' || !Number.isFinite(estimate)) {
    return null;
  }
  return estimate;
}
