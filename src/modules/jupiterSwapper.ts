/**
 * Jupiter Swapper Module
 *
 * Provides token swap functionality using Jupiter V6 API.
 *
 * Purpose:
 * - Handle token swaps when position creation fails due to insufficient token balance
 * - Enable atomic bundling: swap + create position in single Jito bundle
 * - Auto-balance positions during rebalancing when one token drains
 *
 * Features:
 * - **Jupiter V6 API Integration**: Uses latest Jupiter swap aggregator
 * - **Transaction Builder**: Returns unsigned/signed transactions for bundling
 * - **Slippage Protection**: Configurable slippage tolerance
 * - **Atomic Bundling**: Bundle swap + position creation in single Jito bundle
 * - **Retry Logic**: Escalate Jito tips on failure (4k → 6k → 8k lamports)
 *
 * Use Cases:
 * 1. **Insufficient USDC**: Swap SOL → USDC, bundle with position creation
 * 2. **Insufficient SOL**: Swap USDC → SOL, bundle with position creation
 * 3. **Emergency rebalancing**: Quick token swaps to restore balance
 *
 * Flow:
 * 1. Try to create position with 50/50 distribution
 * 2. If fails due to insufficient token balance:
 *    a. Get swap transaction from Jupiter
 *    b. Bundle: [swap tx, create position tx] in Jito bundle
 *    c. If bundle fails: retry with higher Jito tip
 *
 * Configuration (via .env):
 * - SWAP_SLIPPAGE_BPS: Slippage tolerance in basis points (default: 50 = 0.5%)
 * - SWAP_ENABLED: Enable/disable swap functionality (default: true)
 * - USE_JITO: Enable Jito tips for swap transactions (default: true)
 *
 * @example
 * ```typescript
 * const swapper = new JupiterSwapper();
 *
 * // Get swap transaction (not executed yet)
 * const swapTx = await swapper.getSwapTransaction({
 *   inputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
 *   outputMint: 'So11111111111111111111111111111111111111112', // SOL
 *   amount: 100,
 *   slippageBps: 50,
 * });
 *
 * // Bundle with other transactions
 * const bundle = [swapTx, createPositionTx];
 * await jitoClient.sendBundle(bundle);
 * ```
 */

import { Connection, VersionedTransaction, PublicKey } from '@solana/web3.js';
import { getConnection, getWalletKeypair } from '../core/agentKit.js';
import { log } from '../utils/logger.js';
import { getConfig } from '../config/env.js';
import { TransactionError } from '../types/index.js';
import { fetch } from 'undici';

// Token mint addresses (Solana mainnet)
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

// Jupiter API endpoints
const JUPITER_QUOTE_API = 'https://quote-api.jup.ag/v6/quote';
const JUPITER_SWAP_API = 'https://quote-api.jup.ag/v6/swap';

export interface SwapParams {
  inputMint: string; // Token to swap from
  outputMint: string; // Token to swap to
  amount: number; // Amount in human-readable units (e.g., 100 USDC, 1.5 SOL)
  slippageBps?: number; // Slippage tolerance in basis points (default: 50 = 0.5%)
}

export interface SwapQuote {
  inputMint: string;
  outputMint: string;
  inAmount: string; // Raw amount (with decimals)
  outAmount: string; // Raw amount (with decimals)
  otherAmountThreshold: string; // Minimum output amount after slippage
  priceImpactPct: number;
  routePlan: any[];
}

export interface SwapTransactionResult {
  transaction: VersionedTransaction; // Unsigned transaction ready for bundling
  quote: SwapQuote; // Quote used for the swap
  inputAmount: number; // Human-readable input amount
  outputAmount: number; // Expected human-readable output amount
  priceImpactPct: number;
}

/**
 * Jupiter Swapper for token swaps
 */
export class JupiterSwapper {
  private config = getConfig();

  constructor() {
    log.info('JupiterSwapper initialized', {
      swapEnabled: this.config.swapEnabled ?? true,
      swapSlippageBps: this.config.swapSlippageBps ?? 50,
      useJito: this.config.useJito,
    });
  }

  /**
   * Get token decimals for mint address
   */
  private getTokenDecimals(mint: string): number {
    if (mint === SOL_MINT) return 9;
    if (mint === USDC_MINT) return 6;
    throw new Error(`Unknown token mint: ${mint}`);
  }

  /**
   * Convert human-readable amount to raw amount (with decimals)
   */
  private toRawAmount(amount: number, mint: string): string {
    const decimals = this.getTokenDecimals(mint);
    const rawAmount = Math.floor(amount * Math.pow(10, decimals));
    return rawAmount.toString();
  }

  /**
   * Convert raw amount to human-readable amount
   */
  private fromRawAmount(rawAmount: string, mint: string): number {
    const decimals = this.getTokenDecimals(mint);
    return parseInt(rawAmount) / Math.pow(10, decimals);
  }

  /**
   * Fetch swap quote from Jupiter API
   */
  async getQuote(params: SwapParams): Promise<SwapQuote> {
    try {
      const slippageBps = params.slippageBps ?? this.config.swapSlippageBps ?? 50;
      const inputAmount = this.toRawAmount(params.amount, params.inputMint);

      const url = new URL(JUPITER_QUOTE_API);
      url.searchParams.append('inputMint', params.inputMint);
      url.searchParams.append('outputMint', params.outputMint);
      url.searchParams.append('amount', inputAmount);
      url.searchParams.append('slippageBps', slippageBps.toString());
      url.searchParams.append('onlyDirectRoutes', 'false');
      url.searchParams.append('asLegacyTransaction', 'false'); // Use versioned transactions

      log.debug('Fetching Jupiter swap quote', {
        inputMint: params.inputMint,
        outputMint: params.outputMint,
        amount: params.amount,
        slippageBps,
        url: url.toString(),
      });

      const response = await fetch(url.toString());

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Jupiter API error: ${response.status} - ${errorText}`);
      }

      const quote = (await response.json()) as SwapQuote;

      log.info('Jupiter quote received', {
        inputAmount: this.fromRawAmount(quote.inAmount, params.inputMint),
        outputAmount: this.fromRawAmount(quote.outAmount, params.outputMint),
        priceImpactPct: quote.priceImpactPct,
        routes: quote.routePlan.length,
      });

      return quote;
    } catch (error) {
      log.error('Failed to fetch Jupiter quote', {
        error: error instanceof Error ? error.message : String(error),
        params,
      });
      throw new TransactionError('Failed to fetch swap quote', {
        error: error instanceof Error ? error.message : String(error),
        params,
      });
    }
  }

  /**
   * Get swap transaction (unsigned, ready for bundling)
   *
   * Returns an unsigned VersionedTransaction that can be:
   * 1. Signed and bundled with other transactions (e.g., create position)
   * 2. Submitted as Jito bundle with priority fees
   * 3. Retried with higher tips if bundle fails
   *
   * @param params - Swap parameters
   * @returns Unsigned swap transaction and quote details
   */
  async getSwapTransaction(params: SwapParams): Promise<SwapTransactionResult> {
    try {
      // Check if swaps are enabled
      if (this.config.swapEnabled === false) {
        throw new Error('Swaps are disabled. Set SWAP_ENABLED=true in .env');
      }

      log.info('🔄 Preparing swap transaction', {
        inputMint: params.inputMint,
        outputMint: params.outputMint,
        amount: params.amount,
        slippageBps: params.slippageBps ?? this.config.swapSlippageBps ?? 50,
      });

      // 1. Get swap quote
      const quote = await this.getQuote(params);

      // 2. Get swap transaction from Jupiter
      const wallet = getWalletKeypair();
      const walletPubkey = wallet.publicKey.toBase58();

      log.debug('Requesting swap transaction from Jupiter', {
        userPublicKey: walletPubkey,
      });

      const swapResponse = await fetch(JUPITER_SWAP_API, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          quoteResponse: quote,
          userPublicKey: walletPubkey,
          wrapAndUnwrapSol: true, // Automatically wrap/unwrap SOL
          dynamicComputeUnitLimit: true, // Let Jupiter optimize compute units
          prioritizationFeeLamports: this.config.priorityTipLamports ?? 80000,
        }),
      });

      if (!swapResponse.ok) {
        const errorText = await swapResponse.text();
        throw new Error(`Jupiter swap API error: ${swapResponse.status} - ${errorText}`);
      }

      const { swapTransaction } = (await swapResponse.json()) as { swapTransaction: string };

      // 3. Deserialize transaction (do NOT sign yet - for bundling)
      const transactionBuf = Buffer.from(swapTransaction, 'base64');
      const transaction = VersionedTransaction.deserialize(transactionBuf);

      const inputAmount = this.fromRawAmount(quote.inAmount, params.inputMint);
      const outputAmount = this.fromRawAmount(quote.outAmount, params.outputMint);

      log.info('✅ Swap transaction prepared (unsigned)', {
        inputAmount,
        outputAmount,
        priceImpactPct: quote.priceImpactPct,
      });

      return {
        transaction,
        quote,
        inputAmount,
        outputAmount,
        priceImpactPct: quote.priceImpactPct,
      };
    } catch (error) {
      log.error('❌ Failed to prepare swap transaction', {
        error: error instanceof Error ? error.message : String(error),
        params,
      });

      throw new TransactionError('Swap transaction preparation failed', {
        error: error instanceof Error ? error.message : String(error),
        params,
      });
    }
  }

  /**
   * Execute swap transaction immediately (for standalone swaps)
   *
   * Use this when you want to execute a swap without bundling.
   * For bundled operations (swap + create position), use getSwapTransaction() instead.
   *
   * @param params - Swap parameters
   * @returns Transaction signature and swap details
   */
  async executeSwap(params: SwapParams): Promise<{
    signature: string;
    inputAmount: number;
    outputAmount: number;
    priceImpactPct: number;
  }> {
    const startTime = Date.now();

    try {
      log.info('🔄 Executing standalone swap', params);

      // Get swap transaction
      const swapTx = await this.getSwapTransaction(params);

      // Sign transaction
      const wallet = getWalletKeypair();
      swapTx.transaction.sign([wallet]);

      // Execute transaction
      const connection = getConnection();
      const signature = await connection.sendTransaction(swapTx.transaction, {
        skipPreflight: true,
        maxRetries: 3,
      });

      log.debug('Swap transaction sent', { signature });

      // Confirm transaction
      const confirmation = await connection.confirmTransaction(signature, 'confirmed');

      if (confirmation.value.err) {
        throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
      }

      const durationMs = Date.now() - startTime;

      log.info('✅ Swap executed successfully', {
        signature,
        inputAmount: swapTx.inputAmount,
        outputAmount: swapTx.outputAmount,
        priceImpactPct: swapTx.priceImpactPct,
        durationMs,
      });

      return {
        signature,
        inputAmount: swapTx.inputAmount,
        outputAmount: swapTx.outputAmount,
        priceImpactPct: swapTx.priceImpactPct,
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;

      log.error('❌ Swap execution failed', {
        error: error instanceof Error ? error.message : String(error),
        params,
        durationMs,
      });

      throw new TransactionError('Swap execution failed', {
        error: error instanceof Error ? error.message : String(error),
        params,
        durationMs,
      });
    }
  }

  /**
   * Helper: Get SOL → USDC swap transaction
   */
  async getSwapSolToUsdcTx(
    solAmount: number,
    slippageBps?: number
  ): Promise<SwapTransactionResult> {
    return this.getSwapTransaction({
      inputMint: SOL_MINT,
      outputMint: USDC_MINT,
      amount: solAmount,
      slippageBps,
    });
  }

  /**
   * Helper: Get USDC → SOL swap transaction
   */
  async getSwapUsdcToSolTx(
    usdcAmount: number,
    slippageBps?: number
  ): Promise<SwapTransactionResult> {
    return this.getSwapTransaction({
      inputMint: USDC_MINT,
      outputMint: SOL_MINT,
      amount: usdcAmount,
      slippageBps,
    });
  }

  /**
   * Helper: Calculate optimal swap amount to balance position
   *
   * When position is completely one-sided, swap to achieve ~50/50 balance
   * based on current price and target position value.
   *
   * @param solAmount - Current SOL balance
   * @param usdcAmount - Current USDC balance
   * @param solPrice - Current SOL price in USD
   * @param targetSolPercent - Target SOL percentage (default: 50%)
   * @returns Swap parameters or null if already balanced
   */
  calculateRebalanceSwap(
    solAmount: number,
    usdcAmount: number,
    solPrice: number,
    targetSolPercent: number = 50
  ): SwapParams | null {
    const totalValueUsd = solAmount * solPrice + usdcAmount;
    const solValueUsd = solAmount * solPrice;
    const usdcValueUsd = usdcAmount;

    const solPercent = totalValueUsd > 0 ? (solValueUsd / totalValueUsd) * 100 : 0;
    const usdcPercent = totalValueUsd > 0 ? (usdcValueUsd / totalValueUsd) * 100 : 0;

    log.debug('Calculating rebalance swap', {
      solAmount,
      usdcAmount,
      solPrice,
      totalValueUsd,
      solPercent,
      usdcPercent,
      targetSolPercent,
    });

    // If position is >95% in SOL, swap to reach target balance
    if (solPercent > 95) {
      const targetSolValueUsd = totalValueUsd * (targetSolPercent / 100);
      const excessSolValueUsd = solValueUsd - targetSolValueUsd;
      const swapAmount = excessSolValueUsd / solPrice;

      log.info('Position heavily in SOL, swapping to reach target balance', {
        solPercent,
        swapAmount,
        targetSolPercent,
      });

      return {
        inputMint: SOL_MINT,
        outputMint: USDC_MINT,
        amount: swapAmount,
      };
    }

    // If position is >95% in USDC, swap to reach target balance
    if (usdcPercent > 95) {
      const targetUsdcValueUsd = totalValueUsd * ((100 - targetSolPercent) / 100);
      const excessUsdcValueUsd = usdcValueUsd - targetUsdcValueUsd;
      const swapAmount = excessUsdcValueUsd;

      log.info('Position heavily in USDC, swapping to reach target balance', {
        usdcPercent,
        swapAmount,
        targetSolPercent,
      });

      return {
        inputMint: USDC_MINT,
        outputMint: SOL_MINT,
        amount: swapAmount,
      };
    }

    // Position is already balanced enough
    log.debug('Position is balanced, no swap needed', {
      solPercent,
      usdcPercent,
      targetSolPercent,
    });

    return null;
  }

  /**
   * Helper: Check if wallet has sufficient balance for position creation
   *
   * @param requiredSol - Required SOL amount
   * @param requiredUsdc - Required USDC amount
   * @returns Object indicating which token is insufficient
   */
  async checkBalance(
    requiredSol: number,
    requiredUsdc: number
  ): Promise<{
    hasSufficientSol: boolean;
    hasSufficientUsdc: boolean;
    actualSol: number;
    actualUsdc: number;
    needsSwap: boolean;
  }> {
    try {
      const connection = getConnection();
      const wallet = getWalletKeypair();

      // Check SOL balance
      const solBalance = await connection.getBalance(wallet.publicKey);
      const actualSol = solBalance / Math.pow(10, 9);

      // Check USDC balance (need to implement token account lookup)
      // For now, we'll assume USDC balance check happens at transaction time
      const actualUsdc = 0; // TODO: Implement USDC balance check

      const hasSufficientSol = actualSol >= requiredSol;
      const hasSufficientUsdc = actualUsdc >= requiredUsdc;
      const needsSwap = !hasSufficientSol || !hasSufficientUsdc;

      log.debug('Balance check', {
        required: { sol: requiredSol, usdc: requiredUsdc },
        actual: { sol: actualSol, usdc: actualUsdc },
        sufficient: { sol: hasSufficientSol, usdc: hasSufficientUsdc },
        needsSwap,
      });

      return {
        hasSufficientSol,
        hasSufficientUsdc,
        actualSol,
        actualUsdc,
        needsSwap,
      };
    } catch (error) {
      log.error('Failed to check balance', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
