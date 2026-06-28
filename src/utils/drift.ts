import { createRequire } from 'module';

const require = createRequire(import.meta.url);

/**
 * Load the Drift protocol SDK through its CommonJS build.
 *
 * `@drift-labs/sdk` ships as CommonJS (`"type": "commonjs"`, main
 * `lib/node/index.js`) while this project is ESM. Importing named runtime
 * values directly via ESM is fragile across Node versions — the same class of
 * failure we hit with the Meteora SDK (see `src/utils/dlmm.ts`). Requiring the
 * module and re-exporting its members is robust at runtime; the
 * `as typeof import(...)` cast preserves the SDK's full TypeScript types, so we
 * lose no type-safety and tsc still verifies every symbol below actually
 * exists on the installed version (pinned `stable`, 2.156.0 — ADR-014).
 */
const drift = require('@drift-labs/sdk') as typeof import('@drift-labs/sdk');

export const {
  // Core clients
  DriftClient,
  User,
  Wallet,
  // Polling-mode account loader (ADR-014: polling, not websockets)
  BulkAccountLoader,
  // Math helpers + fixed-point precision constants
  convertToNumber,
  BASE_PRECISION,
  PRICE_PRECISION,
  QUOTE_PRECISION,
  calculateFormattedLiveFundingRate,
  // Pure PDA deriver — computes a sub-account address WITHOUT requiring the
  // user to be loaded (unlike client.getUserAccountPublicKey, which throws if
  // the user isn't attached). Used for the on-chain existence check.
  getUserAccountPublicKeySync,
} = drift;
