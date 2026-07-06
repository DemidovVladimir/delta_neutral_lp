//! Bin price geometry for Meteora DLMM.
//!
//! Bin `i` covers prices `[base * (1+s)^i, base * (1+s)^(i+1))` where
//! `s = bin_step_bps / 10_000`. Verified against a live position of the
//! Campaign-2 bot: 20 bins at 4 bps spanned 80.46797060784459 →
//! 81.11416647995036, and (1.0004)^20 reproduces that ratio to < 1e-5
//! relative error (see tests/golden.rs).

#[derive(Debug, Clone, Copy)]
pub struct BinGeometry {
    /// Price multiplier per bin, e.g. 1.0004 for a 4 bps bin step.
    pub step: f64,
}

impl BinGeometry {
    pub fn from_bps(bin_step_bps: f64) -> Self {
        Self { step: 1.0 + bin_step_bps / 10_000.0 }
    }

    /// Upper price of a range starting at `lower` spanning `n` bins.
    pub fn upper_price(&self, lower: f64, n_bins: usize) -> f64 {
        lower * self.step.powi(n_bins as i32)
    }

    /// Lower price of an `n`-bin range centered (geometrically) on `price`.
    pub fn centered_lower(&self, price: f64, n_bins: usize) -> f64 {
        price / self.step.powf(n_bins as f64 / 2.0)
    }

    /// Boundary price between bin `i-1` and bin `i` of a range at `lower`.
    pub fn boundary(&self, lower: f64, i: usize) -> f64 {
        lower * self.step.powi(i as i32)
    }

    /// Geometric mid price of bin `i` — the effective conversion price when
    /// a swap sweeps the whole bin.
    pub fn bin_mid(&self, lower: f64, i: usize) -> f64 {
        self.boundary(lower, i) * self.step.sqrt()
    }

    /// Index of the bin containing `price` in a range at `lower`, clamped to
    /// `[0, n_bins]`-ish semantics: returns a *float* position so callers can
    /// see fractional progress inside the active bin. Values < 0 mean "below
    /// the range", > n_bins mean "above the range".
    pub fn bin_position(&self, lower: f64, price: f64) -> f64 {
        (price / lower).ln() / self.step.ln()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn boundary_and_position_roundtrip() {
        let g = BinGeometry::from_bps(4.0);
        let lower = 80.0;
        for i in 0..=20 {
            let p = g.boundary(lower, i);
            let pos = g.bin_position(lower, p);
            assert!((pos - i as f64).abs() < 1e-9, "bin {i}: pos {pos}");
        }
    }

    #[test]
    fn centered_range_contains_price_at_middle() {
        let g = BinGeometry::from_bps(4.0);
        let lower = g.centered_lower(80.0, 20);
        let upper = g.upper_price(lower, 20);
        assert!(lower < 80.0 && 80.0 < upper);
        let pos = g.bin_position(lower, 80.0);
        assert!((pos - 10.0).abs() < 1e-9);
    }
}
