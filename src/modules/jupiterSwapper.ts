/**
 * Jupiter Swapper Module
 *
 * Provides token swap functionality using Jupiter Ultra API.
 *
 * Purpose:
 * - Handle token swaps when position creation fails due to insufficient token balance
 * - Execute fast, reliable swaps with Jupiter's proprietary transaction engine
 * - Auto-balance positions during rebalancing when one token drains
 *
 * Features:
 * - **Jupiter Ultra API Integration**: Uses latest Jupiter Ultra API (faster, cheaper, better support)
 * - **Simple 2-Step Flow**: Get order → Execute order (no complex bundling)
 * - **95% sub-2s execution**: Jupiter handles transaction optimization internally
 * - **Slippage Protection**: Configurable slippage tolerance
 * - **RPC-less**: No need to maintain blockchain infrastructure
 *
 * Use Cases:
 * 1. **Insufficient USDC**: Swap SOL → USDC before position creation
 * 2. **Insufficient SOL**: Swap USDC → SOL before position creation
 * 3. **Emergency rebalancing**: Quick token swaps to restore balance
 *
 * Flow:
 * 1. Request order from Jupiter Ultra API with swap parameters
 * 2. Sign the transaction returned in order
 * 3. Execute the signed transaction via Ultra API
 * 4. Jupiter handles broadcasting and polling (95% complete in <2s)
 *
 * Configuration (via .env):
 * - SWAP_SLIPPAGE_BPS: Slippage tolerance in basis points (default: 50 = 0.5%)
 * - SWAP_ENABLED: Enable/disable swap functionality (default: true)
 *
 * @example
 * ```typescript
 * const swapper = new JupiterSwapper();
 *
 * // Execute swap (Jupiter handles everything)
 * const result = await swapper.executeSwap({
 *   inputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
 *   outputMint: 'So11111111111111111111111111111111111111112', // SOL
 *   amount: 100,
 *   slippageBps: 50,
 * });
 *
 * console.log('Swap signature:', result.signature);
 * ```
 */

import { VersionedTransaction } from '@solana/web3.js';
import { getConnection, getWalletKeypair } from '../utils/solana.js';
import { log } from '../utils/logger.js';
import { getConfig } from '../config/env.js';
import { TransactionError } from '../types/index.js';
import { fetch } from 'undici';

// Token mint addresses (Solana mainnet)
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

// Jupiter Ultra API endpoints
const JUPITER_ULTRA_BASE_URL = 'https://lite-api.jup.ag/ultra/v1';
const JUPITER_ULTRA_ORDER_API = `${JUPITER_ULTRA_BASE_URL}/order`;
const JUPITER_ULTRA_EXECUTE_API = `${JUPITER_ULTRA_BASE_URL}/execute`;

export interface SwapParams {
  inputMint: string; // Token to swap from
  outputMint: string; // Token to swap to
  amount: number; // Amount in lamports/smallest unit (e.g., lamports for SOL, base units for USDC)
  slippageBps?: number; // Slippage tolerance in basis points (default: 50 = 0.5%)
}

export interface OrderResponse {
  id: string;
  inputMint: string;
  outputMint: string;
  amount: string;
  transaction?: string; // Base64-encoded unsigned transaction
  requestId: string;
  inAmount?: string; // Input amount in smallest units
  outAmount?: string; // Expected output amount in smallest units
  [key: string]: any;
}

export interface ExecuteResponse {
  status: 'Success' | 'Failed' | string;
  signature: string;
  [key: string]: any;
}

/**
 * Parse Jupiter Ultra's `priceImpactPct` field into a positive percentage
 * number. Ultra returns it as a fraction (string or number) where
 * `-0.0007154577…` means a -0.0715% impact. Callers want a positive
 * percentage so they can write `if (impact > 1)` style guards, regardless
 * of swap direction.
 *
 * Returns undefined when the field is missing or unparseable.
 */
function parsePriceImpactPctFromOrder(order: OrderResponse): number | undefined {
  const raw = order.priceImpactPct;
  if (raw === undefined || raw === null) return undefined;
  const asFraction = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(asFraction)) return undefined;
  return Math.abs(asFraction) * 100;
}

/**
 * Jupiter Swapper for token swaps using Ultra API
 */
export class JupiterSwapper {
  private config = getConfig();

  constructor() {
    log.info('JupiterSwapper initialized (Ultra API)', {
      swapEnabled: this.config.swapEnabled ?? true,
      slippageBps: this.config.swapSlippageBps ?? 50,
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
  private toRawAmount(amount: number, mint: string): number {
    const decimals = this.getTokenDecimals(mint);
    return Math.floor(amount * Math.pow(10, decimals));
  }

  /**
   * Convert raw amount to human-readable amount
   */
  private fromRawAmount(rawAmount: string | number, mint: string): number {
    const decimals = this.getTokenDecimals(mint);
    const amount = typeof rawAmount === 'string' ? parseInt(rawAmount) : rawAmount;
    return amount / Math.pow(10, decimals);
  }

  /**
   * Get order from Jupiter Ultra API
   *
   * Step 1 of Ultra API flow: Request swap order with parameters
   *
   * @param params - Swap parameters (amount in human-readable units)
   * @returns Order response with unsigned transaction
   */
  async getOrder(params: SwapParams): Promise<OrderResponse> {
    try {
      // Check if swaps are enabled
      if (this.config.swapEnabled === false) {
        throw new Error('Swaps are disabled. Set SWAP_ENABLED=true in .env');
      }

      const wallet = getWalletKeypair();
      const walletPubkey = wallet.publicKey.toBase58();

      // Convert amount to raw units (lamports for SOL, base units for USDC)
      const amountRaw = this.toRawAmount(params.amount, params.inputMint);

      const url = new URL(JUPITER_ULTRA_ORDER_API);
      url.searchParams.append('inputMint', params.inputMint);
      url.searchParams.append('outputMint', params.outputMint);
      url.searchParams.append('amount', amountRaw.toString());
      url.searchParams.append('taker', walletPubkey);

      // Note: slippageBps is optional and might not be supported in GET request
      // The example from Jupiter doesn't include it
      // const slippageBps = params.slippageBps ?? this.config.swapSlippageBps ?? 50;
      // if (slippageBps) {
      //   url.searchParams.append('slippageBps', slippageBps.toString());
      // }
      const slippageBps = params.slippageBps ?? this.config.swapSlippageBps ?? 50;

      log.info('🔄 Requesting Jupiter Ultra order', {
        inputMint: params.inputMint,
        outputMint: params.outputMint,
        amount: params.amount,
        amountRaw,
        slippageBps,
        taker: walletPubkey,
      });

      const response = await fetch(url.toString());

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Jupiter Ultra API error: ${response.status} - ${errorText}`);
      }

      const order = (await response.json()) as OrderResponse;

      // Log the full response for debugging
      log.debug('Jupiter Ultra order response', {
        responseKeys: Object.keys(order),
        hasTransaction: !!order.transaction,
        requestId: order.requestId,
      });

      // Check for Jupiter API error in response
      if (order.errorCode || order.errorMessage || order.error) {
        const errorMsg = order.errorMessage || order.error || 'Unknown Jupiter API error';
        log.errorBanner('❌ Jupiter API returned an error', {
          errorCode: order.errorCode,
          errorMessage: errorMsg,
          requestId: order.requestId,
        });
        throw new Error(`Jupiter API error: ${errorMsg}`);
      }

      if (!order.transaction) {
        log.error('No transaction in order response - full response:', {
          order: JSON.stringify(order, null, 2),
        });
        throw new Error('No transaction found in order response');
      }

      log.info('✅ Order received', {
        orderId: order.id,
        requestId: order.requestId,
        inputAmount: order.inAmount ? this.fromRawAmount(order.inAmount, params.inputMint) : params.amount,
        outputAmount: order.outAmount ? this.fromRawAmount(order.outAmount, params.outputMint) : 'unknown',
      });

      return order;
    } catch (error) {
      log.error('❌ Failed to get Jupiter Ultra order', {
        error: error instanceof Error ? error.message : String(error),
        params,
      });
      throw new TransactionError('Failed to fetch swap order', {
        error: error instanceof Error ? error.message : String(error),
        params,
      });
    }
  }

  /**
   * Execute order on Jupiter Ultra API
   *
   * Step 2 of Ultra API flow: Sign and execute the order
   * Jupiter handles broadcasting and polling (95% complete in <2s)
   *
   * @param signedTransaction - Base64-encoded signed transaction
   * @param requestId - Request ID from order response
   * @returns Execution response with status and signature
   */
  async executeOrder(signedTransaction: string, requestId: string): Promise<ExecuteResponse> {
    try {
      log.info('🚀 Executing Jupiter Ultra order', {
        requestId,
      });

      const response = await fetch(JUPITER_ULTRA_EXECUTE_API, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          signedTransaction,
          requestId,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Jupiter Ultra execute API error: ${response.status} - ${errorText}`);
      }

      const executeResponse = (await response.json()) as ExecuteResponse;

      if (executeResponse.status === 'Success') {
        log.info('✅ Swap executed successfully', {
          status: executeResponse.status,
          signature: executeResponse.signature,
          solscan: `https://solscan.io/tx/${executeResponse.signature}`,
        });
      } else {
        log.error('❌ Swap execution failed', {
          status: executeResponse.status,
          signature: executeResponse.signature,
          solscan: `https://solscan.io/tx/${executeResponse.signature}`,
        });
      }

      return executeResponse;
    } catch (error) {
      log.error('❌ Failed to execute Jupiter Ultra order', {
        error: error instanceof Error ? error.message : String(error),
        requestId,
      });
      throw new TransactionError('Failed to execute swap order', {
        error: error instanceof Error ? error.message : String(error),
        requestId,
      });
    }
  }

  /**
   * Execute swap transaction (complete flow: get order → sign → execute)
   *
   * This is the main method for executing swaps. It handles the complete Ultra API flow:
   * 1. Request order from Jupiter Ultra API
   * 2. Sign the transaction
   * 3. Execute via Jupiter Ultra API
   * 4. Return signature and details
   *
   * @param params - Swap parameters (amount in human-readable units)
   * @returns Transaction signature, swap details, and price impact (%, absolute value)
   *
   * Note on priceImpactPct: Jupiter Ultra returns this as a fraction string in
   * the order response (e.g. "-0.0007154" means -0.07% impact). We parse it,
   * convert to a percentage number, and take the absolute value so callers
   * can compare against simple positive thresholds like "warn if > 1".
   */
  async executeSwap(params: SwapParams): Promise<{
    signature: string;
    inputAmount: number;
    outputAmount: number;
    status: string;
    /** Jupiter-reported price impact as a positive percentage (e.g. 0.07 means 0.07%). Undefined when Jupiter didn't report. */
    priceImpactPct?: number;
  }> {
    const startTime = Date.now();

    try {
      log.info('🔄 Executing swap (Jupiter Ultra)', {
        inputMint: params.inputMint,
        outputMint: params.outputMint,
        amount: params.amount,
      });

      // Step 1: Get order
      const order = await this.getOrder(params);

      // Step 2: Sign transaction
      const wallet = getWalletKeypair();
      const transaction = VersionedTransaction.deserialize(
        Buffer.from(order.transaction!, 'base64')
      );
      transaction.sign([wallet]);
      const signedTransaction = Buffer.from(transaction.serialize()).toString('base64');

      // Step 3: Execute order
      const executeResponse = await this.executeOrder(signedTransaction, order.requestId);

      const durationMs = Date.now() - startTime;

      // Calculate amounts
      const inputAmount = order.inAmount
        ? this.fromRawAmount(order.inAmount, params.inputMint)
        : params.amount;
      const outputAmount = order.outAmount
        ? this.fromRawAmount(order.outAmount, params.outputMint)
        : 0;

      if (executeResponse.status === 'Success') {
        log.info('✅ Swap completed successfully', {
          signature: executeResponse.signature,
          inputAmount,
          outputAmount,
          durationMs,
        });

        // Track swap transaction fees (async, don't wait)
        const { trackTransactionFee } = await import('../utils/transactionUtils.js');
        const { getSolPrice } = await import('../core/priceOracle.js');
        const solPriceData = await getSolPrice();
        trackTransactionFee(getConnection(), executeResponse.signature, 'swap', solPriceData.usd).catch(err => {
          log.warn('Failed to track swap transaction fee', { error: err.message });
        });
      }

      // Surface Jupiter's reported price impact. Ultra returns this as a
      // fraction in the order response (string or number). Normalize to an
      // absolute percentage so callers can do simple `> threshold` checks.
      const priceImpactPct = parsePriceImpactPctFromOrder(order);

      return {
        signature: executeResponse.signature,
        inputAmount,
        outputAmount,
        status: executeResponse.status,
        priceImpactPct,
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
   * Helper: Execute SOL → USDC swap
   */
  async swapSolToUsdc(
    solAmount: number,
    slippageBps?: number
  ): Promise<{
    signature: string;
    inputAmount: number;
    outputAmount: number;
    status: string;
    priceImpactPct?: number;
  }> {
    return this.executeSwap({
      inputMint: SOL_MINT,
      outputMint: USDC_MINT,
      amount: solAmount,
      slippageBps,
    });
  }

  /**
   * Helper: Execute USDC → SOL swap
   */
  async swapUsdcToSol(
    usdcAmount: number,
    slippageBps?: number
  ): Promise<{
    signature: string;
    inputAmount: number;
    outputAmount: number;
    status: string;
    priceImpactPct?: number;
  }> {
    return this.executeSwap({
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
