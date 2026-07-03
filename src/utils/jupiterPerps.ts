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

/**
 * SPL program ids + the USDC mint (the short's collateral token). Verbatim,
 * never abbreviated. We derive ATAs ourselves via PublicKey.findProgramAddressSync
 * (below) rather than pulling @solana/spl-token so every PublicKey lives in the
 * single jup-anchor web3 copy — no dual-web3 casting at the write boundary.
 */
export const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
export const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
/** Wrapped SOL mint — the collateral token of a LONG SOL position. */
export const SOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');
/** USDC raw token units = human amount * 1e6 (6 decimals). */
export const USDC_DECIMALS_POW = 1_000_000;
/** SOL raw units (lamports) = human amount * 1e9 (9 decimals). */
export const SOL_DECIMALS_POW = 1_000_000_000;

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

export type PositionSide = 'long' | 'short';

/**
 * Derive the SOL position PDA for a wallet and side. Jupiter collateralises
 * LONGS in the traded asset itself (collateralCustody = SOL custody, side byte
 * [1]) and SHORTS in stables (collateralCustody = USDC custody, side byte [2]).
 * Seeds verified against Jupiter's reference repo.
 */
export function generateSolPositionPda(walletAddress: any, side: PositionSide): any {
  const collateralCustody = side === 'long' ? CUSTODY.SOL : CUSTODY.USDC;
  const sideByte = side === 'long' ? 1 : 2;
  const [pda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from('position'),
      walletAddress.toBuffer(),
      JLP_POOL_ACCOUNT.toBuffer(),
      CUSTODY.SOL.toBuffer(),
      collateralCustody.toBuffer(),
      Buffer.from([sideByte]),
    ],
    JUPITER_PERPETUALS_PROGRAM_ID,
  );
  return pda;
}

/** PDA(["perpetuals"]) — the program's global config account (an instruction input). */
export function findPerpetualsPda(): any {
  const [pda] = PublicKey.findProgramAddressSync([Buffer.from('perpetuals')], JUPITER_PERPETUALS_PROGRAM_ID);
  return pda;
}

/** PDA(["__event_authority"]) — anchor self-CPI event-emit authority. */
export function findEventAuthorityPda(): any {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('__event_authority')],
    JUPITER_PERPETUALS_PROGRAM_ID,
  );
  return pda;
}

/**
 * Associated token account for (owner, mint). The manual derivation is the
 * canonical ATA formula and works for off-curve PDA owners too (e.g. the
 * positionRequest escrow), so we don't need spl-token's `allowOwnerOffCurve`.
 */
export function deriveAta(owner: any, mint: any): any {
  const [ata] = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  return ata;
}

/**
 * Hand-rolled SPL instructions for the LONG-side wSOL wrap/unwrap flow. Same
 * rationale as `deriveAta`: keeping every PublicKey inside the single
 * jup-anchor web3 copy means no spl-token import and no dual-web3 casting.
 */

/** ATA-program CreateIdempotent (discriminator byte 1): no-op if the ATA exists. */
export function createAtaIdempotentIx(payer: any, ata: any, owner: any, mint: any): any {
  return new anchor.web3.TransactionInstruction({
    programId: ASSOCIATED_TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: ata, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: anchor.web3.SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([1]),
  });
}

/** Token-program SyncNative (instruction 17): credit lamports sent to a wSOL ATA. */
export function createSyncNativeIx(ata: any): any {
  return new anchor.web3.TransactionInstruction({
    programId: TOKEN_PROGRAM_ID,
    keys: [{ pubkey: ata, isSigner: false, isWritable: true }],
    data: Buffer.from([17]),
  });
}

/** Token-program CloseAccount (instruction 9): unwraps a wSOL ATA back to native SOL. */
export function createCloseAccountIx(account: any, destination: any, owner: any): any {
  return new anchor.web3.TransactionInstruction({
    programId: TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: account, isSigner: false, isWritable: true },
      { pubkey: destination, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: false },
    ],
    data: Buffer.from([9]),
  });
}

export type RequestChange = 'increase' | 'decrease';

/**
 * Derive the positionRequest PDA for a market open/close request (write side).
 * Seeds mirror Jupiter's reference repo:
 *   ["position_request", position, counter(le u64), requestByte([1]inc/[2]dec)].
 * The counter randomises the PDA so back-to-back requests for the same position
 * don't collide on an existing (in-flight) request account. Pass an explicit
 * counter only to reproduce/inspect a known request PDA.
 */
export function generatePositionRequestPda(
  position: any,
  requestChange: RequestChange,
  counter?: any,
): { positionRequest: any; counter: any } {
  const c = counter ?? new BN(Math.floor(Math.random() * 1_000_000_000));
  const requestByte = requestChange === 'increase' ? 1 : 2;
  const [positionRequest] = PublicKey.findProgramAddressSync(
    [
      Buffer.from('position_request'),
      position.toBuffer(),
      c.toArrayLike(Buffer, 'le', 8),
      Buffer.from([requestByte]),
    ],
    JUPITER_PERPETUALS_PROGRAM_ID,
  );
  return { positionRequest, counter: c };
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

/**
 * Liquidation price for an open position, in human USD. Faithful port of
 * Jupiter's reference `getLiquidationPrice` (julianfssen repo). The position is
 * liquidated once its loss (price move against it) plus close + already-accrued
 * borrow fees exhausts the margin down to the maintenance level (sizeUsd / maxLeverage):
 *   - priceImpactFeeBps = ceil(sizeUsd * 1e4 / pricing.tradeImpactFeeScalar)
 *   - closeFeeUsd       = sizeUsd * (decreasePositionBps + priceImpactFeeBps) / 1e4
 *   - borrowFeeUsd      = (collateralCustody.cumulativeInterestRate − position.snapshot)
 *                         * sizeUsd / RATE_POWER   (carry accrued so far)
 *   - maxLossUsd        = sizeUsd / maxLeverage + closeFeeUsd + borrowFeeUsd
 *   - maxPriceDiff      = |maxLossUsd − collateralUsd| * entryPrice / sizeUsd
 *   - SHORT (healthy: margin > maxLoss): liquidated when price RISES, so
 *     liq = entry + diff (above entry); LONG is the mirror (liq below entry).
 *     The degenerate under-margined branch (maxLoss > margin) flips the sign and
 *     is kept only to stay faithful to Jupiter's reference. (See the switch below.)
 *
 * `position` is the raw decoded position; `custody` is the MARKET custody
 * (= SOL for our short, supplies fee bps + max leverage); `collateralCustody`
 * is the COLLATERAL custody (= USDC for a short, supplies the accrued borrow
 * rate). Returns a positive USD number, or null when there is no position
 * (sizeUsd == 0) or required config is missing/degenerate.
 */
export function computeLiquidationPrice(
  position: any,
  custody: any,
  collateralCustody: any,
): number | null {
  if (!position || position.sizeUsd.isZero()) return null;
  const maxLeverage = custody?.pricing?.maxLeverage;
  if (!maxLeverage || maxLeverage.isZero()) return null;

  const scalar = custody?.pricing?.tradeImpactFeeScalar;
  const priceImpactFeeBps =
    scalar && !scalar.isZero() ? divCeil(position.sizeUsd.mul(BPS_POWER), scalar) : new BN(0);
  const totalFeeBps = custody.decreasePositionBps.add(priceImpactFeeBps);
  const closeFeeUsd = position.sizeUsd.mul(totalFeeBps).div(BPS_POWER);

  const borrowFeeUsd = collateralCustody.fundingRateState.cumulativeInterestRate
    .sub(position.cumulativeInterestSnapshot)
    .mul(position.sizeUsd)
    .div(RATE_POWER);

  const totalFeeUsd = closeFeeUsd.add(borrowFeeUsd);
  const maxLossUsd = position.sizeUsd.mul(BPS_POWER).div(maxLeverage).add(totalFeeUsd);
  const marginUsd = position.collateralUsd;

  const maxPriceDiff = maxLossUsd.sub(marginUsd).abs().mul(position.price).div(position.sizeUsd);

  const isLong = !!position.side.long;
  const underMargined = maxLossUsd.gt(marginUsd);
  let liqBn: any;
  if (isLong) {
    liqBn = underMargined ? position.price.add(maxPriceDiff) : position.price.sub(maxPriceDiff);
  } else {
    liqBn = underMargined ? position.price.sub(maxPriceDiff) : position.price.add(maxPriceDiff);
  }

  const liq = liqBn.toNumber() / USD_PRECISION;
  return liq > 0 ? liq : 0;
}
