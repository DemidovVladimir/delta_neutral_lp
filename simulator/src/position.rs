//! A Spot-strategy DLMM position with exact per-bin inventory accounting.
//!
//! Mechanics (mirrors how the pool actually behaves):
//! - Bins whose price range is ABOVE the current price hold SOL (asks
//!   waiting to be sold); bins BELOW hold USDC (bids). The active bin holds
//!   a mix proportional to how far the price sits inside it.
//! - When the price sweeps a bin upward, that bin's SOL converts to USDC at
//!   the bin's mid price and the position earns `fee_rate_net` on the traded
//!   notional (LP fees are paid by the taker ON TOP of the swap — they are
//!   income, not taken from inventory). Downward sweeps mirror this.
//! - Fees therefore accrue ONLY while the price moves inside the range, and
//!   impermanent loss (value vs holding the deposit as-is) emerges from the
//!   conversion prices instead of being a bolted-on formula.
//!
//! Validated against live Campaign-2 observations: value-composition is
//! linear in price across the range — three on-chain snapshots match this
//! model to <0.1 percentage point (tests/golden.rs), and a full-range
//! traversal loses ≈ V·w/8, matching both theory and the measured
//! -0.081 USD average per closed position (strategy-analyzer, 2026-07-05).

use crate::bins::BinGeometry;

#[derive(Debug, Clone)]
pub struct SpotPosition {
    pub geometry: BinGeometry,
    pub lower: f64,
    pub n_bins: usize,
    /// SOL inventory per bin (non-zero only at/above the current price).
    pub sol: Vec<f64>,
    /// USDC inventory per bin (non-zero only at/below the current price).
    pub usdc: Vec<f64>,
    /// Where the price currently sits (fractional bin position).
    pub price: f64,
    /// Net LP fee rate on traded notional (base fee minus protocol share),
    /// e.g. 0.0004 * 0.9 for the production pool.
    pub fee_rate_net: f64,
    /// Cumulative LP fees earned, USD.
    pub fees_usd: f64,
    /// Deposit snapshot for hold-as-is comparison.
    pub deposit_sol: f64,
    pub deposit_usdc: f64,
}

impl SpotPosition {
    /// Open a position of `value_usd` across `n_bins` centered on `price`,
    /// split the way the bot does (bins above hold SOL, below hold USDC,
    /// active bin mixed by intra-bin fraction).
    pub fn open(geometry: BinGeometry, price: f64, n_bins: usize, value_usd: f64, fee_rate_net: f64) -> Self {
        let lower = geometry.centered_lower(price, n_bins);
        Self::open_with_range(geometry, lower, price, n_bins, value_usd, fee_rate_net)
    }

    /// Open with an explicit range (used by golden tests replaying real
    /// positions whose exact ranges are known from pnl.db / logs).
    pub fn open_with_range(
        geometry: BinGeometry,
        lower: f64,
        price: f64,
        n_bins: usize,
        value_usd: f64,
        fee_rate_net: f64,
    ) -> Self {
        let per_bin = value_usd / n_bins as f64;
        let mut sol = vec![0.0; n_bins];
        let mut usdc = vec![0.0; n_bins];
        let pos = geometry.bin_position(lower, price).clamp(0.0, n_bins as f64);
        for i in 0..n_bins {
            let mid = geometry.bin_mid(lower, i);
            let above = ((i as f64 + 1.0) - pos).clamp(0.0, 1.0); // fraction of bin above price
            sol[i] = per_bin * above / mid;
            usdc[i] = per_bin * (1.0 - above);
        }
        // SOL in upper bins is priced at each bin's mid, so the raw fill sums
        // to slightly less than `value_usd` at the CURRENT price. Normalize:
        // "a deposit worth value_usd right now", like the bot's 50/50 sizing.
        let raw_value: f64 =
            sol.iter().sum::<f64>() * price + usdc.iter().sum::<f64>();
        let scale = value_usd / raw_value;
        for i in 0..n_bins {
            sol[i] *= scale;
            usdc[i] *= scale;
        }
        let deposit_sol = sol.iter().sum();
        let deposit_usdc = usdc.iter().sum();
        Self {
            geometry,
            lower,
            n_bins,
            sol,
            usdc,
            price,
            fee_rate_net,
            fees_usd: 0.0,
            deposit_sol,
            deposit_usdc,
        }
    }

    pub fn upper(&self) -> f64 {
        self.geometry.upper_price(self.lower, self.n_bins)
    }

    /// Move the price to `to`, converting swept inventory and accruing fees.
    pub fn advance(&mut self, to: f64) {
        let from_pos = self.geometry.bin_position(self.lower, self.price);
        let to_pos = self.geometry.bin_position(self.lower, to);
        let n = self.n_bins as f64;

        if to_pos > from_pos {
            // Upward: sweep SOL → USDC over [from_pos, to_pos].
            let start = from_pos.max(0.0);
            let end = to_pos.min(n);
            let mut cursor = start;
            while cursor < end - 1e-12 {
                let bin = cursor.floor() as usize;
                let bin_end = (bin as f64 + 1.0).min(end);
                let frac_of_bin = bin_end - cursor; // fraction of this bin swept
                let bin_above_before = 1.0 - (cursor - bin as f64); // SOL fraction remaining in bin
                if bin_above_before > 1e-12 && self.sol[bin] > 0.0 {
                    let share = (frac_of_bin / bin_above_before).min(1.0);
                    let sol_out = self.sol[bin] * share;
                    let mid = self.geometry.bin_mid(self.lower, bin);
                    self.sol[bin] -= sol_out;
                    self.usdc[bin] += sol_out * mid;
                    self.fees_usd += sol_out * mid * self.fee_rate_net;
                }
                cursor = bin_end;
            }
        } else if to_pos < from_pos {
            // Downward: sweep USDC → SOL over [to_pos, from_pos].
            let start = from_pos.min(n);
            let end = to_pos.max(0.0);
            let mut cursor = start;
            while cursor > end + 1e-12 {
                let bin = (cursor - 1e-12).floor().max(0.0) as usize;
                let bin_start = (bin as f64).max(end);
                let frac_of_bin = cursor - bin_start;
                let bin_below_before = cursor.min(bin as f64 + 1.0) - bin as f64; // USDC fraction in bin
                if bin_below_before > 1e-12 && self.usdc[bin] > 0.0 {
                    let share = (frac_of_bin / bin_below_before).min(1.0);
                    let usdc_out = self.usdc[bin] * share;
                    let mid = self.geometry.bin_mid(self.lower, bin);
                    self.usdc[bin] -= usdc_out;
                    self.sol[bin] += usdc_out / mid;
                    self.fees_usd += usdc_out * self.fee_rate_net;
                }
                cursor = bin_start;
            }
        }
        self.price = to;
    }

    pub fn total_sol(&self) -> f64 {
        self.sol.iter().sum()
    }

    pub fn total_usdc(&self) -> f64 {
        self.usdc.iter().sum()
    }

    /// Marked-to-market position value (excludes earned fees).
    pub fn value_usd(&self, price: f64) -> f64 {
        self.total_sol() * price + self.total_usdc()
    }

    /// What the original deposit would be worth if simply held.
    pub fn hold_as_is_usd(&self, price: f64) -> f64 {
        self.deposit_sol * price + self.deposit_usdc
    }

    /// Impermanent loss so far (negative = LP worse than holding), fees NOT
    /// included — the caller decides how to net them.
    pub fn il_usd(&self, price: f64) -> f64 {
        self.value_usd(price) - self.hold_as_is_usd(price)
    }

    /// SOL share of position value, in percent — the exact figure the bot's
    /// `checkPositionBalance` logs (golden-tested against live snapshots).
    pub fn sol_percent(&self, price: f64) -> f64 {
        let v = self.value_usd(price);
        if v <= 0.0 {
            return 0.0;
        }
        100.0 * self.total_sol() * price / v
    }

    /// True while `price` is inside the range (fees can accrue).
    pub fn in_range(&self, price: f64) -> bool {
        price > self.lower && price < self.upper()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pos_20() -> SpotPosition {
        SpotPosition::open(BinGeometry::from_bps(4.0), 80.0, 20, 100.0, 0.0004 * 0.9)
    }

    #[test]
    fn opens_roughly_half_half() {
        let p = pos_20();
        let sol_pct = p.sol_percent(80.0);
        assert!((sol_pct - 50.0).abs() < 1.0, "sol% at center = {sol_pct}");
        assert!((p.value_usd(80.0) - 100.0).abs() < 0.01);
    }

    #[test]
    fn full_up_traversal_converts_all_to_usdc() {
        let mut p = pos_20();
        p.advance(p.upper() * 1.001);
        assert!(p.total_sol() < 1e-9);
        assert!(p.sol_percent(p.upper()) < 1e-6);
        // Volume swept = the SOL half (~$50) → fees ≈ 50 × 0.00036.
        let expected_fees = 50.0 * 0.0004 * 0.9;
        assert!(
            (p.fees_usd - expected_fees).abs() / expected_fees < 0.05,
            "fees {} vs {}",
            p.fees_usd,
            expected_fees
        );
    }

    #[test]
    fn full_down_traversal_converts_all_to_sol() {
        let mut p = pos_20();
        p.advance(p.lower * 0.999);
        assert!(p.total_usdc() < 1e-9);
        assert!(p.sol_percent(p.lower) > 99.999);
    }

    #[test]
    fn out_of_range_movement_accrues_nothing() {
        let mut p = pos_20();
        p.advance(p.upper() * 1.001);
        let fees_at_exit = p.fees_usd;
        p.advance(p.upper() * 1.05);
        p.advance(p.upper() * 1.002);
        assert_eq!(p.fees_usd, fees_at_exit);
    }

    #[test]
    fn round_trip_restores_inventory_and_pays_twice() {
        let mut p = pos_20();
        let sol0 = p.total_sol();
        p.advance(p.upper() * 1.0001);
        let fees_up = p.fees_usd;
        p.advance(80.0);
        // Bought the SOL back at the same mids → inventory restored…
        assert!((p.total_sol() - sol0).abs() / sol0 < 1e-6);
        // …and fees accrued on both legs.
        assert!(p.fees_usd > fees_up * 1.8);
        // No free lunch: IL ≈ 0 after a symmetric round trip.
        assert!(p.il_usd(80.0).abs() < 0.001);
    }
}
