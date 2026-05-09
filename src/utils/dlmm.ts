import { createRequire } from 'module';

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

export const DLMM: any = dlmmModule.default || dlmmModule;
export const StrategyType: any = dlmmModule.StrategyType;
