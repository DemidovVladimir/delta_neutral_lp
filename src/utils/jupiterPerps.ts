import { createRequire } from 'module';
import { getConfig } from '../config/env.js';
import { getWalletKeypair } from './solana.js';

/**
 * Jupiter Perpetuals loader + constants + on-chain math (ADR-015 pivot).
 *
 * Drift is down post-exploit (see ADR-014/ADR-015), so the hedge is built on
 * Jupiter Perps instead. There is no official TS SDK — we parse the program's
 * Anchor IDL directly (the approach Jupiter's docs point to). The IDL is the
 * old (anchor 0.29) format which the project's top-level anchor 0.32 cannot
 * parse, so we load an isolated `jup-anchor` alias (= @coral-xyz/anchor@0.29)
 * here and nowhere else. Addresses are verbatim from Jupiter's reference repo
 * (julianfssen/jupiter-perps-anchor-idl-parsing) and verified live on-chain.
 */
const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-var-requires
const anchor: any = require('jup-anchor'); // @coral-xyz/anchor@0.29 (reads old IDL)
// eslint-disable-next-line @typescript-eslint/no-var-requires
const idl: any = require('../idl/jupiter-perps-idl.json');

const { PublicKey, Keypair, Connection } = anchor.web3;
export const BN = anchor.BN;
export { anchor };

// --- Program + account addresses (verified live, see jupiterPerps smoke test) ---
export const JUPITER_PERPETUALS_PROGRAM_ID = new PublicKey('PERPHjGBqRHArX4DySjwM6UJHiR3sWAatqfdBS2qQJu');
export const DOVES_PROGRAM_ID = new PublicKey('DoVEsk76QybCEHQGzkvYPWLQu9gzNoZZZt3TPiL597e');
export const JLP_POOL_ACCOUNT = new PublicKey('5BUwFW4nRbftYTDMbgxykoFWqWHPzahFSNAaaaJtVKsq');

/** Custody accounts (the per-asset pools). Short SOL uses SOL as market, USDC as collateral. */
export const CUSTODY = {
  SOL: new PublicKey('7xS2gz2bTp3fwCC7knJvUWTEU9Tycczu6VhJYKgi1wdz'),
  USDC: new PublicKey('G18jKKXQwBbrHeiK3C9MRXhkHsLHf7XgCSisykV46EZa'),
};

/** sizeUsd / collateralUsd / price are fixed-point with 6 decimals. */
export const USD_PRECISION = 1_000_000;
const RATE_POWER = new BN(1_000_000_000);
const DEBT_POWER = RATE_POWER;
const BPS_POWER = new BN(10_000);
const HOURS_IN_A_YEAR = 24 * 365;

/** Ceil division for BN (matches Jupiter's reference `divCeil`). Non-negative inputs. */
function divCeil(a: any, b: any): any {
  const q = a.div(b);
  return a.mod(b).isZero() ? q : q.addn(1);
}

/**
 * Build a read/write-capable anchor Program for the Jupiter Perpetuals program.
 * Uses a dedicated jup-anchor web3 Connection (from RPC_URL) so all PublicKeys
 * and the Program share one web3 copy — no dual-web3 casting needed.
 */
export function getPerpsProgram(): any {
  const connection = new Connection(getConfig().rpcUrl, 'confirmed');
  const wallet = new anchor.Wallet(Keypair.fromSecretKey(getWalletKeypair().secretKey));
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: 'confirmed' });
  return new anchor.Program(idl, JUPITER_PERPETUALS_PROGRAM_ID, provider);
}

/** Derive the SHORT SOL position PDA for a wallet (collateral = USDC, side = short [2]). */
export function generateShortSolPositionPda(walletAddress: any): any {
  const [pda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from('position'),
      walletAddress.toBuffer(),
      JLP_POOL_ACCOUNT.toBuffer(),
      CUSTODY.SOL.toBuffer(),
      CUSTODY.USDC.toBuffer(),
      Buffer.from([2]), // Side::Short
    ],
    JUPITER_PERPETUALS_PROGRAM_ID,
  );
  return pda;
}

/** getDebt — outstanding borrow-lend debt scaled to token units (Jupiter ref). */
function getDebt(custody: any): any {
  return divCeil(BN.max(custody.debt.sub(custody.borrowLendInterestsAccured), new BN(0)), DEBT_POWER);
}

/**
 * Hourly borrow rate (jump-curve mechanism), in RATE_POWER units. Faithful port
 * of Jupiter's `getHourlyBorrowRate`. SOL custody uses the jump mechanism
 * (hourlyFundingDbps == 0); the linear path is intentionally omitted.
 */
function hourlyBorrowRate(custody: any): any {
  const debt = getDebt(custody);
  const owned = custody.assets.owned.add(debt);
  const locked = custody.assets.locked.add(debt);
  if (!(owned.gtn(0) && locked.gtn(0))) return new BN(0);

  const util = locked.mul(RATE_POWER).div(owned);
  const { minRateBps, maxRateBps, targetRateBps, targetUtilizationRate } = custody.jumpRateState;

  let yearlyRate: any;
  if (util.lte(targetUtilizationRate)) {
    yearlyRate = divCeil(targetRateBps.sub(minRateBps).mul(util), targetUtilizationRate)
      .add(minRateBps)
      .mul(RATE_POWER)
      .div(BPS_POWER);
  } else {
    const rateDiff = BN.max(new BN(0), maxRateBps.sub(targetRateBps));
    const utilDiff = BN.max(new BN(0), util.sub(targetUtilizationRate));
    const denom = BN.max(new BN(0), RATE_POWER.sub(targetUtilizationRate));
    if (denom.isZero()) throw new Error('jupiterPerps: borrow-rate denominator is 0');
    yearlyRate = divCeil(rateDiff.mul(utilDiff), denom).add(targetRateBps).mul(RATE_POWER).div(BPS_POWER);
  }
  return yearlyRate.divn(HOURS_IN_A_YEAR);
}

/**
 * Annualised borrow APR (%) for a custody — the carry cost of holding a perp
 * position against it. This is what a SOL short pays continuously on Jupiter
 * (there is no funding income, only this cost).
 */
export function borrowAprPct(custody: any): number {
  return (hourlyBorrowRate(custody).toNumber() / RATE_POWER.toNumber()) * HOURS_IN_A_YEAR * 100;
}
