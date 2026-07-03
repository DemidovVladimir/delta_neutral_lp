/**
 * HODL Benchmark — campaign-level "was any of this worth it?" math.
 *
 * The per-position HODL columns in pnl.db reset at every LP rebalance and
 * ignore the hedge entirely. This module answers the operator's real question:
 * has the WHOLE strategy (Meteora LP + Jupiter Perps hedge + idle wallet
 * balances) outperformed simply holding, since a fixed baseline?
 *
 * Counterfactuals, all frozen at the baseline:
 *   HODL-SOL    the entire starting value converted to SOL at baseline price
 *   HODL-USDC   the entire starting value parked in USDC
 *   HODL-as-is  the exact starting composition, held untouched
 *
 * Strategy equity = wallet SOL + wallet wSOL + wallet USDC
 *                 + LP amounts (incl. unclaimed fees)
 *                 + Σ per perp side (collateral + price PnL − accrued borrow fees).
 *
 * Pure math and types only — NO I/O. The CLI (src/cli/hodl-compare.ts) owns
 * network reads and the baseline file, keeping this module unit-testable
 * (hodlBenchmark.test.ts).
 */

/** The frozen starting point every counterfactual is measured from. */
export interface HodlBaseline {
  /** ISO timestamp the baseline capital existed at. */
  capturedAt: string;
  /** SOL/USD price at that moment. */
  solPriceUsd: number;
  /** SOL-denominated holdings at baseline (wallet SOL + wSOL + LP SOL + claimable). */
  solSideAmount: number;
  /** USD-denominated holdings at baseline (USDC + perp equity in USD). */
  usdcSideAmount: number;
  /** Total baseline value: solSideAmount × solPriceUsd + usdcSideAmount. */
  totalUsd: number;
  /** How the baseline was set: 'captured' (live snapshot) or 'manual' (backdated). */
  source: 'captured' | 'manual';
  note?: string;
}

/** Every component of current portfolio equity, human units. */
export interface EquityBreakdown {
  solPriceUsd: number;
  walletSol: number;
  walletWsol: number;
  walletUsdc: number;
  lpSol: number;
  lpUsdc: number;
  lpClaimableSol: number;
  lpClaimableUsdc: number;
  /** Σ collateralUsd over open perp sides. */
  perpCollateralUsd: number;
  /** Σ price PnL over open perp sides (positive = in profit). */
  perpUnrealizedPnlUsd: number;
  /** Σ borrow fees accrued on open perp sides (a cost — subtracted). */
  perpAccruedBorrowFeeUsd: number;
}

/** The three aggregates every consumer of a breakdown needs. */
export interface EquityComponents {
  /** SOL-denominated units: wallet SOL + wSOL + LP SOL + claimable SOL. */
  solSideAmount: number;
  /** USD-denominated holdings: USDC + LP USDC + claimable USDC. */
  usdcSideUsd: number;
  /** Perp equity: collateral + price PnL − accrued borrow fees, USD. */
  perpEquityUsd: number;
}

export function equityComponents(b: EquityBreakdown): EquityComponents {
  return {
    solSideAmount: b.walletSol + b.walletWsol + b.lpSol + b.lpClaimableSol,
    usdcSideUsd: b.walletUsdc + b.lpUsdc + b.lpClaimableUsdc,
    perpEquityUsd: b.perpCollateralUsd + b.perpUnrealizedPnlUsd - b.perpAccruedBorrowFeeUsd,
  };
}

/** Total portfolio equity in USD for a breakdown. */
export function computeEquityUsd(b: EquityBreakdown): number {
  const c = equityComponents(b);
  return c.solSideAmount * b.solPriceUsd + c.usdcSideUsd + c.perpEquityUsd;
}

/**
 * Freeze a breakdown into a baseline. Perp equity counts toward the USDC side:
 * it is a USD-denominated claim (shorts literally hold USDC collateral; a
 * long's SOL collateral is booked by Jupiter as fixed collateralUsd and paid
 * out at that USD value regardless of where SOL goes).
 */
export function buildBaseline(
  b: EquityBreakdown,
  capturedAt: string,
  note?: string,
): HodlBaseline {
  const c = equityComponents(b);
  const solSideAmount = c.solSideAmount;
  const usdcSideAmount = c.usdcSideUsd + c.perpEquityUsd;
  return {
    capturedAt,
    solPriceUsd: b.solPriceUsd,
    solSideAmount,
    usdcSideAmount,
    totalUsd: solSideAmount * b.solPriceUsd + usdcSideAmount,
    source: 'captured',
    note,
  };
}

export type HodlBenchmarkName = 'HODL-SOL' | 'HODL-USDC' | 'HODL-as-is';

export interface BenchmarkRow {
  name: HodlBenchmarkName;
  /** What this counterfactual would be worth now, USD. */
  valueUsd: number;
  /** strategy − counterfactual, USD. Positive = the strategy is ahead. */
  edgeUsd: number;
  /** edgeUsd as % of the counterfactual value. */
  edgePct: number;
  /** edgePct annualized (0 when elapsed time is 0). */
  edgeAprPct: number;
}

export type HodlVerdict =
  | 'beats-both'
  | 'beats-usdc-only'
  | 'beats-sol-only'
  | 'loses-to-both';

export interface HodlComparison {
  elapsedDays: number;
  /** True when the window is long enough for annualized numbers to mean much. */
  aprMeaningful: boolean;
  strategyTotalUsd: number;
  /** Strategy PnL vs its own baseline value (not vs a counterfactual). */
  strategyPnlUsd: number;
  strategyPnlPct: number;
  strategyAprPct: number;
  benchmarks: BenchmarkRow[];
  /** Verdict vs the two pure benchmarks (HODL-SOL and HODL-USDC). */
  verdict: HodlVerdict;
}

/** Days between two ISO timestamps, never negative. */
function daysBetween(fromIso: string, toIso: string): number {
  const ms = new Date(toIso).getTime() - new Date(fromIso).getTime();
  return Math.max(0, ms / 86_400_000);
}

function annualize(pct: number, elapsedDays: number): number {
  return elapsedDays > 0 ? pct * (365 / elapsedDays) : 0;
}

/** Windows under 3 days are fee-cycle noise — annualized numbers mislead. */
const APR_MEANINGFUL_MIN_DAYS = 3;

export function compareToHodl(
  baseline: HodlBaseline,
  strategyTotalUsd: number,
  currentSolPriceUsd: number,
  nowIso: string,
): HodlComparison {
  const elapsedDays = daysBetween(baseline.capturedAt, nowIso);

  const hodlSolValue = (baseline.totalUsd / baseline.solPriceUsd) * currentSolPriceUsd;
  const hodlUsdcValue = baseline.totalUsd;
  const hodlAsIsValue =
    baseline.solSideAmount * currentSolPriceUsd + baseline.usdcSideAmount;

  const row = (name: HodlBenchmarkName, valueUsd: number): BenchmarkRow => {
    const edgeUsd = strategyTotalUsd - valueUsd;
    const edgePct = valueUsd > 0 ? (edgeUsd / valueUsd) * 100 : 0;
    return { name, valueUsd, edgeUsd, edgePct, edgeAprPct: annualize(edgePct, elapsedDays) };
  };

  const benchmarks: BenchmarkRow[] = [
    row('HODL-SOL', hodlSolValue),
    row('HODL-USDC', hodlUsdcValue),
    row('HODL-as-is', hodlAsIsValue),
  ];

  const beatsSol = benchmarks[0].edgeUsd >= 0;
  const beatsUsdc = benchmarks[1].edgeUsd >= 0;
  const verdict: HodlVerdict = beatsSol
    ? beatsUsdc
      ? 'beats-both'
      : 'beats-sol-only'
    : beatsUsdc
      ? 'beats-usdc-only'
      : 'loses-to-both';

  const strategyPnlUsd = strategyTotalUsd - baseline.totalUsd;
  const strategyPnlPct =
    baseline.totalUsd > 0 ? (strategyPnlUsd / baseline.totalUsd) * 100 : 0;

  return {
    elapsedDays,
    aprMeaningful: elapsedDays >= APR_MEANINGFUL_MIN_DAYS,
    strategyTotalUsd,
    strategyPnlUsd,
    strategyPnlPct,
    strategyAprPct: annualize(strategyPnlPct, elapsedDays),
    benchmarks,
    verdict,
  };
}
