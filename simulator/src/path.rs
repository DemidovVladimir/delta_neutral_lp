//! Price-path handling: candles → ordered price legs.
//!
//! A candle is replayed as open → nearer extreme → farther extreme → close,
//! which preserves the full high-low sweep (the thing that generates fees
//! and IL) at 1-minute resolution. Sub-minute chop inside one bin is below
//! this model's resolution — the stage-3 authenticity gate against pnl.db
//! decides whether that error matters.

#[derive(Debug, Clone, Copy, serde::Deserialize, serde::Serialize)]
pub struct Candle {
    pub open_time_ms: i64,
    pub open: f64,
    pub high: f64,
    pub low: f64,
    pub close: f64,
}

impl Candle {
    /// The price legs this candle sweeps, in replay order.
    pub fn legs(&self) -> [f64; 3] {
        let up_first = (self.high - self.open) <= (self.open - self.low);
        if up_first {
            [self.high, self.low, self.close]
        } else {
            [self.low, self.high, self.close]
        }
    }
}

/// Flatten candles into a single ordered sequence of (time_ms, price) points,
/// starting from the first candle's open.
pub fn to_price_points(candles: &[Candle]) -> Vec<(i64, f64)> {
    let mut pts = Vec::with_capacity(candles.len() * 4);
    for c in candles {
        if pts.is_empty() {
            pts.push((c.open_time_ms, c.open));
        }
        // Spread the three legs across the candle interval for timestamping;
        // exact intra-candle timing is unknowable, equal spacing is fine.
        let legs = c.legs();
        for (k, price) in legs.iter().enumerate() {
            pts.push((c.open_time_ms + (k as i64 + 1) * 15_000, *price));
        }
    }
    pts
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn legs_visit_extremes_and_close() {
        let c = Candle { open_time_ms: 0, open: 100.0, high: 101.0, low: 98.0, close: 99.0 };
        // Low is farther from open than high → high first.
        assert_eq!(c.legs(), [101.0, 98.0, 99.0]);
    }

    #[test]
    fn price_points_cover_all_candles() {
        let candles = vec![
            Candle { open_time_ms: 0, open: 100.0, high: 100.5, low: 99.5, close: 100.2 },
            Candle { open_time_ms: 60_000, open: 100.2, high: 100.8, low: 100.0, close: 100.6 },
        ];
        let pts = to_price_points(&candles);
        assert_eq!(pts.len(), 1 + 3 * candles.len());
        assert_eq!(pts[0].1, 100.0);
        assert_eq!(pts.last().unwrap().1, 100.6);
    }
}
