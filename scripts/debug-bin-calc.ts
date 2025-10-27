/**
 * Debug bin calculation for Meteora position
 */

import { Connection, PublicKey } from '@solana/web3.js';
import DLMMModule from '@meteora-ag/dlmm';

// @ts-ignore
const DLMM: any = DLMMModule.default || DLMMModule;

const RPC_URL = 'http://127.0.0.1:8899';
const POOL_ADDRESS = '5rCf1DM8LjKTw4YqhnoLcngyZYeNnQqztScTogYHAS6';
const SOL_PRICE = 198.95;
const RANGE_BPS_LOWER = -500; // -5%
const RANGE_BPS_UPPER = 500;  // +5%

function priceToNearestBinId(binStep: number, price: number): number {
  const stepSize = 1 + binStep / 10000;
  const binId = Math.round(Math.log(price) / Math.log(stepSize));
  return binId;
}

async function main() {
  console.log('🔍 Debugging Meteora bin calculation\n');

  const connection = new Connection(RPC_URL, 'confirmed');
  const poolPubkey = new PublicKey(POOL_ADDRESS);

  const dlmmPool = await DLMM.create(connection, poolPubkey);

  console.log('Pool Info:');
  console.log('  Bin Step:', dlmmPool.lbPair.binStep);
  console.log('  Active Bin ID:', dlmmPool.lbPair.activeId);
  console.log('');

  // Get active bin price
  const activeBin = await dlmmPool.getActiveBin();
  console.log('Active Bin:');
  console.log('  Bin ID:', activeBin.binId);
  console.log('  Price:', activeBin.price);
  console.log('');

  // Calculate our price range
  const priceLower = SOL_PRICE * (1 + RANGE_BPS_LOWER / 10000);
  const priceUpper = SOL_PRICE * (1 + RANGE_BPS_UPPER / 10000);

  console.log('Desired Price Range:');
  console.log('  Lower:', priceLower);
  console.log('  Upper:', priceUpper);
  console.log('');

  // Calculate bin IDs
  const minBinId = priceToNearestBinId(dlmmPool.lbPair.binStep, priceLower);
  const maxBinId = priceToNearestBinId(dlmmPool.lbPair.binStep, priceUpper);
  const width = maxBinId - minBinId + 1;

  console.log('Calculated Bins:');
  console.log('  Min Bin ID:', minBinId);
  console.log('  Max Bin ID:', maxBinId);
  console.log('  Width:', width, 'bins');
  console.log('');

  if (width > 70) {
    console.log('❌ Position width EXCEEDS maximum (70 bins)');
  } else {
    console.log('✅ Position width is within limits');
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Error:', error);
    process.exit(1);
  });
