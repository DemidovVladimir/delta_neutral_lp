//! Historical price loader: Binance klines REST API with a local CSV cache.
//!
//! SOLUSDC 1m candles; the cache lives in `simulator/data/` (gitignored) so
//! repeated backtests don't refetch. Binance allows 1000 candles per call —
//! the loader paginates.

use crate::path::Candle;
use std::fs;
use std::path::PathBuf;

const API: &str = "https://api.binance.com/api/v3/klines";

pub fn cache_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("data")
}

fn cache_file(symbol: &str, start_ms: i64, end_ms: i64) -> PathBuf {
    cache_dir().join(format!("{symbol}_1m_{start_ms}_{end_ms}.csv"))
}

/// Fetch 1m candles for `[start_ms, end_ms)`, transparently cached on disk.
pub fn fetch_1m(symbol: &str, start_ms: i64, end_ms: i64) -> Result<Vec<Candle>, String> {
    let cache = cache_file(symbol, start_ms, end_ms);
    if cache.exists() {
        return read_csv(&cache);
    }

    let mut candles = Vec::new();
    let mut cursor = start_ms;
    while cursor < end_ms {
        let url = format!(
            "{API}?symbol={symbol}&interval=1m&startTime={cursor}&endTime={end_ms}&limit=1000"
        );
        let rows: serde_json::Value = ureq::get(&url)
            .call()
            .map_err(|e| format!("binance request failed: {e}"))?
            .into_json()
            .map_err(|e| format!("binance response parse failed: {e}"))?;
        let rows = rows.as_array().ok_or("unexpected binance payload")?;
        if rows.is_empty() {
            break;
        }
        for r in rows {
            let t = r[0].as_i64().ok_or("bad kline time")?;
            let f = |i: usize| -> Result<f64, String> {
                r[i].as_str()
                    .ok_or("bad kline field")?
                    .parse::<f64>()
                    .map_err(|e| format!("bad kline number: {e}"))
            };
            candles.push(Candle {
                open_time_ms: t,
                open: f(1)?,
                high: f(2)?,
                low: f(3)?,
                close: f(4)?,
            });
        }
        let last = candles.last().unwrap().open_time_ms;
        if last + 60_000 <= cursor {
            break; // defensive: no forward progress
        }
        cursor = last + 60_000;
    }

    fs::create_dir_all(cache_dir()).map_err(|e| e.to_string())?;
    write_csv(&cache, &candles)?;
    Ok(candles)
}

fn write_csv(path: &PathBuf, candles: &[Candle]) -> Result<(), String> {
    let mut out = String::with_capacity(candles.len() * 48);
    for c in candles {
        out.push_str(&format!(
            "{},{},{},{},{}\n",
            c.open_time_ms, c.open, c.high, c.low, c.close
        ));
    }
    fs::write(path, out).map_err(|e| e.to_string())
}

fn read_csv(path: &PathBuf) -> Result<Vec<Candle>, String> {
    let raw = fs::read_to_string(path).map_err(|e| e.to_string())?;
    let mut candles = Vec::new();
    for line in raw.lines() {
        let mut parts = line.split(',');
        let mut next = || -> Result<&str, String> {
            parts.next().ok_or_else(|| format!("short csv line: {line}"))
        };
        candles.push(Candle {
            open_time_ms: next()?.parse().map_err(|e| format!("{e}"))?,
            open: next()?.parse().map_err(|e| format!("{e}"))?,
            high: next()?.parse().map_err(|e| format!("{e}"))?,
            low: next()?.parse().map_err(|e| format!("{e}"))?,
            close: next()?.parse().map_err(|e| format!("{e}"))?,
        });
    }
    Ok(candles)
}
