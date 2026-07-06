//! Golden tests: the simulator's model pinned to REAL on-chain observations
//! of Campaign 2 (delta-neutral bot, wallet
//! F3YvPiLdniRPGpeKrbeGWR2zg2wPpzVuvqBA5BBJBQ5S, pool
//! 5rCf1DM8LjKTw4YqhnoLcngyZYeNnQqztScTogYHAS6, bin step 4 bps, 20 bins,
//! Spot). Every fixture below is copied verbatim from the production bot's
//! `Position balance checked` log lines of 2026-07-06 — if the model can't
//! reproduce reality it has no business recommending parameters.

use dlmm_simulator::bins::BinGeometry;
use dlmm_simulator::position::SpotPosition;

const BIN_STEP_BPS: f64 = 4.0;
const N_BINS: usize = 20;
/// Production pool: 0.04% base fee, 10% of it to the protocol.
const FEE_RATE_NET: f64 = 0.0004 * 0.9;

/// (current_price, lower_price, upper_price, sol_percent) — verbatim from
/// live logs (three separate positions during 2026-07-06).
const LIVE_COMPOSITION_SNAPSHOTS: &[(f64, f64, f64, f64)] = &[
    (80.6612869634628, 80.46797060784459, 81.11416647995036, 70.08),
    (80.33935050069807, 79.98670427356109, 80.56457080234985, 38.97),
    (80.8227386470824, 80.40363483539471, 81.0169072978923, 31.66),
];

#[test]
fn golden_bin_geometry_matches_live_range() {
    // A real 20-bin position spanned exactly this range.
    let g = BinGeometry::from_bps(BIN_STEP_BPS);
    let modeled_upper = g.upper_price(80.46797060784459, N_BINS);
    let real_upper = 81.11416647995036;
    let rel_err = (modeled_upper - real_upper).abs() / real_upper;
    assert!(rel_err < 1e-5, "modeled upper {modeled_upper} vs real {real_upper} (rel err {rel_err})");
}

#[test]
fn golden_composition_matches_three_live_snapshots() {
    // Recreate each position at its real range, walk the price to the
    // observed spot, and demand the bot's own solPercent within 0.75 pp.
    // (The walk direction matters — conversions are path-dependent — so we
    // enter at the range center like the bot's recenter does, then drift.)
    //
    // NOTE (found by this very test): the ln(upper/lower)/ln(step) of the
    // LOGGED ranges is 20, 18 and 19 steps respectively — the bot's logged
    // lower/upper bounds do not always span exactly AUTO_TUNE_BIN_COUNT
    // steps (boundary-vs-bin-center convention at creation). The bin COUNT
    // is therefore inferred from each snapshot's own bounds; pinning down
    // the exact creation convention is part of the stage-3 replay
    // (tasks #8) — it changes range width by up to 2 bins ≈ 0.08%.
    let g = BinGeometry::from_bps(BIN_STEP_BPS);
    for &(price, lower, upper, real_sol_pct) in LIVE_COMPOSITION_SNAPSHOTS {
        let n_bins = ((upper / lower).ln() / g.step.ln()).round() as usize;
        assert!((18..=20).contains(&n_bins), "unexpected bin span {n_bins}");
        let center = (lower * upper).sqrt();
        let mut p = SpotPosition::open_with_range(g, lower, center, n_bins, 98.5, FEE_RATE_NET);
        p.advance(price);
        let modeled = p.sol_percent(price);
        assert!(
            (modeled - real_sol_pct).abs() < 0.75,
            "at price {price} in [{lower}, {upper}] ({n_bins} bins): modeled {modeled:.2}% vs real {real_sol_pct}%"
        );
    }
}

#[test]
fn golden_full_traversal_il_matches_theory_and_campaign() {
    // Theory (and the strategy-analyzer scaling law verified 2026-07-05 on
    // live data): IL per full range traversal ≈ V·w/8. For V = $98.5 and a
    // 20-bin 4 bps range (w ≈ 0.8%) that is ≈ $0.098; the measured campaign
    // average per closed position was −$0.081 (mixed partial traversals).
    let g = BinGeometry::from_bps(BIN_STEP_BPS);
    let mut p = SpotPosition::open(g, 80.0, N_BINS, 98.5, FEE_RATE_NET);
    let w = (p.upper() - p.lower) / 80.0;
    let theory = 98.5 * w / 8.0;
    p.advance(p.upper());
    let il = -p.il_usd(p.upper()); // loss as a positive number
    assert!(
        (il - theory).abs() / theory < 0.15,
        "traversal IL {il:.4} vs theory V·w/8 = {theory:.4}"
    );
}

#[test]
fn golden_whipsaw_night_shape() {
    // Qualitative pin of the 2026-07-05→06 night: repeated full-range
    // whipsaw produces fees ∝ crossings while IL nets out ≈ 0 for the
    // SAME position — the night's realized damage came from RECENTERING
    // into one-sided compositions (selling the converted inventory at a
    // worse price), which is stage-2 strategy territory. Here we assert the
    // raw-position half of that story.
    let g = BinGeometry::from_bps(BIN_STEP_BPS);
    let mut p = SpotPosition::open(g, 80.0, N_BINS, 98.5, FEE_RATE_NET);
    let (lo, hi) = (p.lower * 0.999, p.upper() * 1.001);
    for _ in 0..10 {
        p.advance(hi);
        p.advance(lo);
        p.advance(80.0);
    }
    // 10 round trips ≈ 20 half-position sweeps + return legs; just pin the
    // proportionality band, exactness is stage 3's job.
    let per_round_trip = 98.5 * FEE_RATE_NET; // full V converted per round trip
    let expected = 10.0 * per_round_trip * 1.5; // + the return-to-center legs
    assert!(
        p.fees_usd > expected * 0.6 && p.fees_usd < expected * 1.4,
        "10 whipsaw round trips: fees {:.4} vs expected ≈ {:.4}",
        p.fees_usd,
        expected
    );
    // Symmetric whipsaw on ONE position: no realized IL drift.
    assert!(p.il_usd(80.0).abs() < 0.01, "il {}", p.il_usd(80.0));
}
