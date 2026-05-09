#!/usr/bin/env node
/**
 * Find actual positions on-chain for debugging
 */

import { Connection, PublicKey } from '@solana/web3.js';
import { getWalletKeypair, getConnection } from '../dist/utils/solana.js';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const DLMMModule = require('@meteora-ag/dlmm');
const DLMM = DLMMModule.default || DLMMModule;

async function main() {
  const connection = getConnection();
  const wallet = getWalletKeypair();
  const poolAddress = process.env.METEORA_POOL_ADDRESS || '5rCf1DM8LjKTw4YqhnoLcngyZYeNnQqztScTogYHAS6';
  const poolPubkey = new PublicKey(poolAddress);

  console.log('Searching for positions...');
  console.log('Wallet:', wallet.publicKey.toBase58());
  console.log('Pool:', poolAddress);
  console.log('');

  const dlmmPool = await DLMM.create(connection, poolPubkey);
  const { userPositions } = await dlmmPool.getPositionsByUserAndLbPair(wallet.publicKey);

  console.log(`Found ${userPositions.length} position(s):\n`);

  for (const pos of userPositions) {
    const solAmount = parseFloat(pos.positionData.totalXAmount.toString()) / 10 ** 9;
    const usdcAmount = parseFloat(pos.positionData.totalYAmount.toString()) / 10 ** 6;
    const feeSol = parseFloat(pos.positionData.feeX.toString()) / 10 ** 6;
    const feeUsdc = parseFloat(pos.positionData.feeY.toString()) / 10 ** 6;

    console.log('Position:', pos.publicKey.toBase58());
    console.log('  Bins:', pos.positionData.lowerBinId, '-', pos.positionData.upperBinId);
    console.log('  Liquidity:', solAmount.toFixed(6), 'SOL +', usdcAmount.toFixed(2), 'USDC');
    console.log('  Fees:', feeSol.toFixed(6), 'SOL +', feeUsdc.toFixed(2), 'USDC');
    console.log('');
  }
}

main().catch(console.error);
