import { createRequire } from 'module';

const require = createRequire(import.meta.url);

/**
 * Load blessed / blessed-contrib through their CommonJS builds.
 *
 * Both are CommonJS and this project is ESM; requiring them is the robust path
 * (same rationale as `src/utils/dlmm.ts`). Neither
 * ships first-class TypeScript types, so they're typed `any` here — the
 * dashboard is the only consumer and keeps its blessed usage localised.
 */
export const contrib: any = require('blessed-contrib');
export const blessed: any = require('blessed');
