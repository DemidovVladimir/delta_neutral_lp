//! Demo runner: replay a price window through one static 20-bin position and
//! print the fee/IL ledger. Strategy loop (recenters, выдержка, hedge) lands
//! in stage 2 — this binary exists to smoke the pipeline end-to-end.
//!
//! Usage:
//!   cargo run --release -- --demo                        # synthetic whipsaw
//!   cargo run --release -- --from 2026-07-05T14:47:00Z --hours 20   # Binance SOLUSDC

use dlmm_simulator::bins::BinGeometry;
use dlmm_simulator::data::fetch_1m;
use dlmm_simulator::path::{to_price_points, Candle};
use dlmm_simulator::position::SpotPosition;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let candles = if args.iter().any(|a| a == "--demo") {
        synthetic_whipsaw()
    } else {
        let from = flag(&args, "--from").expect("--from <ISO8601> or --demo");
        let hours: i64 = flag(&args, "--hours").map(|h| h.parse().expect("--hours <n>")).unwrap_or(24);
        let start_ms = parse_iso_ms(&from);
        let end_ms = start_ms + hours * 3_600_000;
        fetch_1m("SOLUSDC", start_ms, end_ms).expect("binance fetch")
    };

    let points = to_price_points(&candles);
    let first_price = points[0].1;
    let geometry = BinGeometry::from_bps(4.0);
    let mut position = SpotPosition::open(geometry, first_price, 20, 98.5, 0.0004 * 0.9);
    println!(
        "position: 20 bins, [{:.4}, {:.4}], value $98.50, open @ {:.4}",
        position.lower,
        position.upper(),
        first_price
    );

    let mut exits = 0u32;
    let mut was_in_range = true;
    for &(_, price) in &points[1..] {
        position.advance(price);
        let in_range = position.in_range(price);
        if was_in_range && !in_range {
            exits += 1;
        }
        was_in_range = in_range;
    }

    let last_price = points.last().unwrap().1;
    println!("candles: {} | price {:.4} → {:.4}", candles.len(), first_price, last_price);
    println!("range exits (would-be recenter triggers): {exits}");
    println!("fees earned:        ${:.4}", position.fees_usd);
    println!("impermanent loss:   ${:.4}", position.il_usd(last_price));
    println!("net (fees + IL):    ${:.4}", position.fees_usd + position.il_usd(last_price));
    println!(
        "composition now:    {:.2}% SOL / {:.2}% USDC",
        position.sol_percent(last_price),
        100.0 - position.sol_percent(last_price)
    );
}

fn flag(args: &[String], name: &str) -> Option<String> {
    args.iter().position(|a| a == name).and_then(|i| args.get(i + 1)).cloned()
}

/// Minimal ISO8601 (UTC, `YYYY-MM-DDTHH:MM:SSZ`) → epoch ms, no chrono dep.
fn parse_iso_ms(s: &str) -> i64 {
    let bytes = s.as_bytes();
    let num = |from: usize, to: usize| -> i64 { s[from..to].parse().expect("iso8601 digits") };
    assert!(bytes.len() >= 20 && bytes[19] == b'Z', "expected YYYY-MM-DDTHH:MM:SSZ");
    let (y, mo, d) = (num(0, 4), num(5, 7), num(8, 10));
    let (h, mi, sec) = (num(11, 13), num(14, 16), num(17, 19));
    // Days since epoch via civil-from-days inverse (Howard Hinnant's algo).
    let y_adj = if mo <= 2 { y - 1 } else { y };
    let era = y_adj.div_euclid(400);
    let yoe = y_adj - era * 400;
    let doy = (153 * (if mo > 2 { mo - 3 } else { mo + 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    ((days * 86_400) + h * 3_600 + mi * 60 + sec) * 1_000
}

fn synthetic_whipsaw() -> Vec<Candle> {
    // 12 hours of 1m candles oscillating ±0.6% around $80 with a slow drift —
    // roughly the July 5–6 night's texture.
    (0..720)
        .map(|i| {
            let t = i as f64;
            let base = 80.0 + 0.3 * (t / 240.0).sin() - t * 0.0005;
            let wave = 0.48 * (t / 17.0).sin();
            let open = base + wave;
            let close = base + 0.48 * ((t + 1.0) / 17.0).sin();
            Candle {
                open_time_ms: i * 60_000,
                open,
                high: open.max(close) + 0.05,
                low: open.min(close) - 0.05,
                close,
            }
        })
        .collect()
}
