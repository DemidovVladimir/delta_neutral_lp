import { createRequire } from 'module';
import { initPairFromPool } from '../config/pairConfig.js';

const require = createRequire(import.meta.url);

/**
 * Load Meteora DLMM through its CommonJS build.
 *
 * The SDK's ESM bundle imports `BN` as a named export from
 * `@coral-xyz/anchor`. Under Node 24, Anchor's CommonJS package no longer
 * exposes that synthetic named export, which crashes before our code starts.
 * The CommonJS bundle reads `anchor.BN` at runtime, which is present.
 */
const dlmmModule = require('@meteora-ag/dlmm');

const DLMMClass: any = dlmmModule.default || dlmmModule;

// Every pool instance the process creates flows through DLMM.create — wrap
// it once so pair roles (base/quote mints + decimals) are always derived
// from the actual pool instead of hardcoded SOL/USDC constants. Fail-open:
// a pool object the shape probe doesn't recognize just skips the init.
const origCreate = DLMMClass.create.bind(DLMMClass);
DLMMClass.create = async (...args: any[]) => {
  const pool = await origCreate(...args);
  try {
    if (pool?.tokenX?.publicKey && pool?.tokenY?.publicKey) initPairFromPool(pool);
  } catch {
    /* pair init must never break pool reads */
  }
  return pool;
};

export const DLMM: any = DLMMClass;
export const StrategyType: any = dlmmModule.StrategyType;
