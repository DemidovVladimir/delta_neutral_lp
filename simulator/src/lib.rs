//! DLMM strategy simulator — stage 1 (ADR pending; tasks #6–8).
//!
//! Scope of this stage: exact per-bin position mechanics (fees + IL emerge
//! from conversions, not formulas), candle → price-leg replay, and a
//! Binance-backed historical loader. Golden tests pin the model to REAL
//! on-chain observations of Campaign 2 (see tests/golden.rs).
//!
//! Deliberately NOT here yet: the strategy loop (recenter threshold,
//! выдержка, hedge) — stage 2, task #7 — and the pnl.db authenticity replay
//! — stage 3, task #8.

pub mod bins;
pub mod data;
pub mod path;
pub mod position;
