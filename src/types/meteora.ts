/**
 * Meteora DLMM-specific type definitions
 */

// Position state from on-chain data
export interface MeteoraPositionState {
  positionMint: string;
  poolAddress: string;
  lowerBinId: number;
  upperBinId: number;
  liquidity: bigint;
  feeOwed: {
    tokenX: bigint; // Usually SOL
    tokenY: bigint; // Usually USDC
  };
  rewardOwed: bigint[];
}

// Pool state information
export interface MeteoraPoolState {
  address: string;
  tokenMintX: string; // SOL mint
  tokenMintY: string; // USDC mint
  currentBinId: number;
  binStep: number; // Price step per bin
  baseFeeRate: number; // Base fee rate in BPS
}

// Price bin information
export interface PriceBin {
  binId: number;
  price: number; // Price in USD
  liquidity: bigint;
}
