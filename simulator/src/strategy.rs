//! The full strategy loop: LP recenters (threshold + ADR-023 выдержка +
//! ADR-021 storm pause) and the perp hedge (midpoint/clamp input, ADR-022
//! auto-cap, cooldown), replayed over a price path with an equity ledger.
//!
//! The decision core is the vector-verified port in `hedge.rs`; this module
//! adds the orchestrator-level state machines (mirroring
//! `autoTuneOrchestrator.ts`) and the cost model. Cost-model calibration
//! against pnl.db is stage 3 — treat absolute dollars as provisional until
//! the authenticity gate passes; RELATIVE comparisons between parameter
//! sets are already meaningful.
//!
//! Simplification vs production (documented, revisit at stage 3): the idle
//! wallet SOL is a constant parameter (real recenters shuffle wallet
//! balances, but ADR-021 established the combined hedge input is
//! recenter-invariant, so a constant is faithful); perp longs are counted
//! but not executed (unreachable with target 0 and a non-negative bag).

use crate::bins::BinGeometry;
use crate::hedge::{
    auto_notional_cap_usd, decide, lp_delta_for_regime, lp_hedge_regime, Decision, HedgeInput,
    LpRegime,
};
use crate::position::SpotPosition;

#[derive(Debug, Clone)]
pub struct StrategyParams {
    pub n_bins: usize,
    pub bin_step_bps: f64,
    pub fee_rate_net: f64,
    /// One-sided composition share that triggers a recenter (0.92 in prod).
    pub imbalance_threshold: f64,
    /// ADR-023 выдержка, ms. 0 = react on first sight.
    pub trend_confirm_ms: i64,
    pub band_sol: f64,
    pub cooldown_ms: i64,
    pub target_collateral_ratio: f64,
    pub min_collateral_ratio: f64,
    /// Short-side borrow cost, bps APR (positive = we pay).
    pub carry_cost_bps: f64,
    pub carry_cap_bps: f64,
    pub cap_mult: f64,
    /// ADR-021 storm mode threshold, percent per 5 minutes. 0 disables.
    pub vol_pause_pct_5m: f64,
    /// Jupiter perps fee on traded notional (6 bps).
    pub perp_fee_rate: f64,
    pub network_fee_usd_per_recenter: f64,
    /// Fee + impact on the 50/50 rebalancing swap at recenter.
    pub swap_fee_rate: f64,
    pub lp_value_usd: f64,
    pub idle_wallet_sol: f64,
    pub wallet_usdc_start: f64,
    pub wallet_reserve_sol: f64,
    /// Stage-3 calibration: the pool price follows the exchange price
    /// LAZILY — arbitrage only moves the pool when the deviation exceeds
    /// roughly the pool fee, so sub-fee wiggles never sweep our bins.
    /// Fraction (0.0004 = 4 bps). 0 = pool mirrors the exchange exactly.
    pub arb_deadband: f64,
    /// Stage-3 calibration: a triggered recenter executes this many ticks
    /// (15s legs) AFTER confirmation — the real bot needs 7–15s, and during
    /// that gap the hedge sees the one-sided composition (this is what let
    /// the 98% clamp engage on the real whipsaw night). 0 = instant.
    pub recenter_latency_ticks: u32,
}

impl Default for StrategyParams {
    /// Production values as deployed 2026-07-06 (commit 0df7bf4).
    fn default() -> Self {
        Self {
            n_bins: 20,
            bin_step_bps: 4.0,
            fee_rate_net: 0.0004 * 0.9,
            imbalance_threshold: 0.92,
            trend_confirm_ms: 300_000,
            band_sol: 0.25,
            cooldown_ms: 600_000,
            target_collateral_ratio: 0.5,
            min_collateral_ratio: 0.15,
            carry_cost_bps: 550.0,
            carry_cap_bps: 5000.0,
            cap_mult: 1.25,
            vol_pause_pct_5m: 2.0,
            perp_fee_rate: 0.0006,
            network_fee_usd_per_recenter: 0.005,
            swap_fee_rate: 0.001,
            lp_value_usd: 98.5,
            idle_wallet_sol: 1.0,
            wallet_usdc_start: 60.0,
            wallet_reserve_sol: 0.3,
            // Calibrated 2026-07-06 against pnl.db (stage 3, task #8):
            // night window fit → fees +6%, recenter count −16%, per-trade
            // size $44 vs $42; OUT-OF-SAMPLE validation on the Jul-6 day
            // window: recenters 10/10 exact, perp trades 7/7 exact,
            // churn +5%, fees +11%.
            arb_deadband: 0.0002,
            recenter_latency_ticks: 1,
        }
    }
}

#[derive(Debug, Default)]
pub struct SimReport {
    pub equity_start: f64,
    pub equity_end: f64,
    pub hold_as_is_end: f64,
    /// The срез metric: strategy equity minus doing nothing with the same mix.
    pub edge_vs_hold: f64,
    pub lp_fees_usd: f64,
    pub perp_fees_usd: f64,
    pub carry_paid_usd: f64,
    pub swap_cost_usd: f64,
    pub network_cost_usd: f64,
    pub recenters: u32,
    pub recenters_skipped_by_confirm: u32,
    pub storm_pauses: u32,
    pub perp_trades: u32,
    pub perp_notional_traded_usd: f64,
    pub unsupported_long_decisions: u32,
    pub final_net_delta_sol: f64,
}

struct ShortState {
    sol: f64,
    notional_usd: f64,
    collateral_usd: f64,
    entry_price: f64, // notional-weighted average
}

pub fn run(params: &StrategyParams, points: &[(i64, f64)]) -> SimReport {
    let g = BinGeometry::from_bps(params.bin_step_bps);
    let p0 = points[0].1;
    let mut lp = SpotPosition::open(g, p0, params.n_bins, params.lp_value_usd, params.fee_rate_net);
    let mut wallet_usdc = params.wallet_usdc_start;
    let wallet_sol = params.idle_wallet_sol + params.wallet_reserve_sol;
    let mut short = ShortState { sol: 0.0, notional_usd: 0.0, collateral_usd: 0.0, entry_price: p0 };

    let mut report = SimReport::default();
    let deposit_sol0 = lp.deposit_sol + params.idle_wallet_sol + params.wallet_reserve_sol;
    let deposit_usdc0 = lp.deposit_usdc + params.wallet_usdc_start;
    report.equity_start = deposit_sol0 * p0 + deposit_usdc0;

    // Orchestrator state machines.
    let mut imbalance_since: Option<i64> = None;
    let mut lp_regime = LpRegime::In;
    let mut pending_regime: Option<(LpRegime, i64)> = None;
    let mut last_action_at: Option<i64> = None;
    let mut storm_active = false;
    let mut price_window: Vec<(i64, f64)> = Vec::new();
    let mut claimed_fees_marker = 0.0; // fees already moved to the wallet
    // Stage-3 mechanics: lazy pool price + in-flight recenter countdown.
    let mut pool_price = p0;
    let mut pending_recenter: Option<u32> = None;

    let mut prev_t = points[0].0;
    for &(t, price) in &points[1..] {
        // The pool follows the exchange only when arbitrage clears the
        // dead-band; sub-fee wiggles never reach our bins.
        if price > pool_price * (1.0 + params.arb_deadband) {
            pool_price = price / (1.0 + params.arb_deadband);
        } else if price < pool_price * (1.0 - params.arb_deadband) {
            pool_price = price / (1.0 - params.arb_deadband);
        }
        lp.advance(pool_price);

        // Carry accrual on the open short.
        let dt_ms = (t - prev_t).max(0) as f64;
        let carry = short.notional_usd * params.carry_cost_bps / 10_000.0 * dt_ms
            / (365.25 * 86_400.0 * 1000.0);
        short.collateral_usd -= carry;
        report.carry_paid_usd += carry;
        prev_t = t;

        // Storm window (rolling ~6 min, ref sample >= 4 min old, hysteresis /2).
        price_window.push((t, price));
        price_window.retain(|&(ts, _)| t - ts <= 360_000);
        if params.vol_pause_pct_5m > 0.0 {
            if let Some(&(_, ref_p)) = price_window.iter().find(|&&(ts, _)| t - ts >= 240_000) {
                let move_pct = (price / ref_p - 1.0).abs() * 100.0;
                if storm_active {
                    if move_pct < params.vol_pause_pct_5m / 2.0 {
                        storm_active = false;
                    }
                } else if move_pct > params.vol_pause_pct_5m {
                    storm_active = true;
                    report.storm_pauses += 1;
                }
            }
        }

        // --- LP recenter with выдержка + execution latency ------------------
        let sol_pct = lp.sol_percent(pool_price) / 100.0;
        let imbalanced = sol_pct >= params.imbalance_threshold || sol_pct <= 1.0 - params.imbalance_threshold;
        if imbalanced {
            imbalance_since.get_or_insert(t);
        } else {
            if let Some(since) = imbalance_since {
                if params.trend_confirm_ms > 0 && t - since < params.trend_confirm_ms {
                    report.recenters_skipped_by_confirm += 1;
                }
            }
            imbalance_since = None;
        }
        let confirmed = imbalanced
            && imbalance_since.map_or(false, |since| t - since >= params.trend_confirm_ms);

        // A confirmed trigger starts execution; once in flight it completes
        // regardless (the real bot does not cancel a running rebalance).
        if confirmed && !storm_active && pending_recenter.is_none() {
            pending_recenter = Some(params.recenter_latency_ticks);
        }
        let mut lp_mutated = false;
        match pending_recenter {
            Some(0) => {
                // Withdraw + claim: inventory and earned fees go to the wallet…
                let fresh_fees = lp.fees_usd - claimed_fees_marker;
                let withdrawn_sol = lp.total_sol();
                let withdrawn_usdc = lp.total_usdc() + fresh_fees;
                let value = withdrawn_sol * pool_price + withdrawn_usdc;
                // …swap toward 50/50 (fee + impact on the swapped notional)…
                let swap_notional = (withdrawn_sol * pool_price - value / 2.0).abs();
                let swap_cost = swap_notional * params.swap_fee_rate;
                let network = params.network_fee_usd_per_recenter;
                wallet_usdc += fresh_fees - swap_cost - network;
                report.lp_fees_usd += fresh_fees;
                report.swap_cost_usd += swap_cost;
                report.network_cost_usd += network;
                // …and redeposit the same principal, recentered.
                lp = SpotPosition::open(
                    g,
                    pool_price,
                    params.n_bins,
                    value - fresh_fees.min(value),
                    params.fee_rate_net,
                );
                claimed_fees_marker = 0.0;
                report.recenters += 1;
                imbalance_since = None;
                pending_recenter = None;
                lp_mutated = true;
            }
            Some(k) => pending_recenter = Some(k - 1),
            None => {}
        }

        // --- Hedge (skipped the cycle the LP mutated, like the orchestrator) --
        if lp_mutated {
            continue;
        }
        // Clamp regime with выдержка; storms commit immediately (ADR-023).
        let candidate = lp_hedge_regime(lp.total_sol(), lp.total_usdc(), pool_price, lp_regime);
        if candidate != lp_regime {
            let since = match pending_regime {
                Some((pend, s)) if pend == candidate => s,
                _ => {
                    pending_regime = Some((candidate, t));
                    t
                }
            };
            if storm_active || t - since >= params.trend_confirm_ms {
                lp_regime = candidate;
                pending_regime = None;
            }
        } else {
            pending_regime = None;
        }
        let lp_delta = lp_delta_for_regime(lp_regime, lp.total_sol(), lp.total_usdc(), pool_price);
        let lp_full_value_sol = lp.total_sol() + lp.total_usdc() / pool_price;
        let cap = auto_notional_cap_usd(
            params.idle_wallet_sol + lp_full_value_sol,
            price,
            params.cap_mult,
            0.0,
        );

        let input = HedgeInput {
            lp_sol: lp_delta + params.idle_wallet_sol,
            long_sol: 0.0,
            short_sol: short.sol,
            long_notional_usd: 0.0,
            short_notional_usd: short.notional_usd,
            long_collateral_usd: 0.0,
            short_collateral_usd: short.collateral_usd,
            carry_cost_bps_long: params.carry_cost_bps,
            carry_cost_bps_short: params.carry_cost_bps,
            oracle_price_usd: Some(price),
            wallet_sol,
            wallet_reserve_sol: params.wallet_reserve_sol,
            wallet_usdc,
            target_delta_sol: 0.0,
            band_sol: params.band_sol,
            carry_cap_bps: params.carry_cap_bps,
            max_hedge_notional_usd: cap,
            min_collateral_ratio: params.min_collateral_ratio,
            target_collateral_ratio: params.target_collateral_ratio,
            now_ms: t,
            last_action_at_ms: last_action_at,
            cooldown_ms: params.cooldown_ms,
        };

        match decide(&input) {
            Decision::IncreaseShort { size_usd, collateral_tokens, .. } => {
                let fee = size_usd * params.perp_fee_rate;
                let new_notional = short.notional_usd + size_usd;
                short.entry_price = (short.entry_price * short.notional_usd + price * size_usd)
                    / new_notional;
                short.notional_usd = new_notional;
                short.sol += size_usd / price;
                wallet_usdc -= collateral_tokens;
                short.collateral_usd += collateral_tokens - fee;
                report.perp_fees_usd += fee;
                report.perp_trades += 1;
                report.perp_notional_traded_usd += size_usd;
                last_action_at = Some(t);
            }
            Decision::DecreaseShort { size_usd, entire_position, withdraw_collateral_usd, .. } => {
                let fee = size_usd * params.perp_fee_rate;
                let realized =
                    (short.entry_price - price) / short.entry_price * size_usd;
                let withdraw = if entire_position { short.collateral_usd } else { withdraw_collateral_usd };
                wallet_usdc += withdraw + realized - fee;
                short.collateral_usd -= withdraw;
                short.notional_usd = (short.notional_usd - size_usd).max(0.0);
                short.sol = (short.sol - size_usd / price).max(0.0);
                if entire_position {
                    short.sol = 0.0;
                    short.notional_usd = 0.0;
                    short.collateral_usd = 0.0;
                }
                report.perp_fees_usd += fee;
                report.perp_trades += 1;
                report.perp_notional_traded_usd += size_usd;
                last_action_at = Some(t);
            }
            Decision::IncreaseLong { .. } | Decision::DecreaseLong { .. } => {
                report.unsupported_long_decisions += 1;
            }
            Decision::None { .. } | Decision::Blocked { .. } => {}
        }
    }

    let p_end = points.last().unwrap().1;
    let unclaimed = lp.fees_usd - claimed_fees_marker;
    report.lp_fees_usd += unclaimed;
    let short_unrealized = (short.entry_price - p_end) / short.entry_price * short.notional_usd;
    report.equity_end = wallet_usdc
        + wallet_sol * p_end
        + lp.value_usd(p_end)
        + unclaimed
        + short.collateral_usd
        + short_unrealized;
    report.hold_as_is_end = deposit_sol0 * p_end + deposit_usdc0;
    report.edge_vs_hold = report.equity_end - report.hold_as_is_end;
    report.final_net_delta_sol =
        lp_delta_for_regime(lp_regime, lp.total_sol(), lp.total_usdc(), pool_price)
            + params.idle_wallet_sol
            - short.sol;
    report
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::path::{to_price_points, Candle};

    fn whipsaw_candles(minutes: usize) -> Vec<Candle> {
        (0..minutes)
            .map(|i| {
                let t = i as f64;
                let base = 80.0 + 0.32 * (t / 180.0).sin();
                let wave = 0.45 * (t / 13.0).sin();
                let open = base + wave;
                let close = base + 0.45 * ((t + 1.0) / 13.0).sin();
                Candle {
                    open_time_ms: (i as i64) * 60_000,
                    open,
                    high: open.max(close) + 0.04,
                    low: open.min(close) - 0.04,
                    close,
                }
            })
            .collect()
    }

    #[test]
    fn confirm_window_reduces_recenters_mechanically() {
        // MECHANICS only: the выдержка must cut recenter count and register
        // skips. Whether it wins in DOLLARS depends on the excursion-length
        // distribution of the price path (on fast mean-reverting synthetic
        // waves instant reaction can win by keeping the range centered) —
        // that question is settled by the stage-3 replay on REAL paths,
        // never asserted on synthetic ones.
        let points = to_price_points(&whipsaw_candles(720));
        let with = run(&StrategyParams::default(), &points);
        let without = run(
            &StrategyParams { trend_confirm_ms: 0, ..StrategyParams::default() },
            &points,
        );
        assert!(
            with.recenters < without.recenters,
            "выдержка should cut recenters: {} vs {}",
            with.recenters,
            without.recenters
        );
        assert!(with.recenters_skipped_by_confirm > 0);
    }

    #[test]
    fn flat_market_is_near_noop() {
        let candles: Vec<Candle> = (0..240)
            .map(|i| Candle {
                open_time_ms: (i as i64) * 60_000,
                open: 80.0,
                high: 80.001,
                low: 79.999,
                close: 80.0,
            })
            .collect();
        let r = run(&StrategyParams::default(), &to_price_points(&candles));
        assert_eq!(r.recenters, 0);
        assert!(r.edge_vs_hold.abs() < 0.35, "flat edge {}", r.edge_vs_hold);
        assert!(r.unsupported_long_decisions == 0);
    }

    #[test]
    fn hedge_keeps_net_delta_in_band() {
        let points = to_price_points(&whipsaw_candles(720));
        let r = run(&StrategyParams::default(), &points);
        assert!(
            r.final_net_delta_sol.abs() <= StrategyParams::default().band_sol + 0.05,
            "net delta {}",
            r.final_net_delta_sol
        );
    }
}
