---
name: hodl-check
description: Compare the bot's whole-strategy performance (Meteora LP + Jupiter Perps hedge + wallet) against HODL-SOL and HODL-USDC counterfactuals. Use when the user asks whether the strategy is beating HODL, whether the bot is worth running, "как дела по сравнению с ходлом", profitability vs just holding, or wants the campaign-level PnL verdict.
---

# HODL Check — is the strategy beating just holding?

Answers the operator's core question: since the campaign baseline, has the
whole strategy (LP fees + hedge carry + IL + swap/network costs, all already
reflected in on-chain equity) outperformed (a) holding everything in SOL and
(b) holding everything in USDC?

## How to run

```bash
pnpm hodl            # human-readable report
pnpm hodl --json     # machine-readable (walletAddress, baseline, breakdown, comparison)
```

Read-only, safe while the bot is live. Reads everything on-chain (RPC), so it
works from this machine — it does NOT need the Hetzner pnl.db. Requires a
populated `.env` (`RPC_URL`, `PRIVATE_KEY`).

Every compare run also appends one JSONL row (full breakdown included) to
`data/hodl-history.jsonl` — the experiment's time series. The CANONICAL
history lives on the Hetzner server (`/opt/delta-bot/data/hodl-history.jsonl`),
fed by a daily root crontab at 00:17 UTC that runs the CLI inside the
container. Fetch it for trend analysis with:

```bash
bash -c 'source deploy/hetzner/lib.sh; remote "cat /opt/delta-bot/data/hodl-history.jsonl"'
```

Rows carry `baselineCapturedAt` — filter on it when the baseline was ever
re-initialized, so campaigns don't mix.

## Baseline (required once per campaign)

The comparison is measured from `data/hodl-baseline.json`. If `pnpm hodl` says
there is no baseline:

1. Ask the user what the campaign started with — do NOT guess. Options:
   - `pnpm hodl --init` — freeze CURRENT holdings as the baseline (right when
     starting a new campaign).
   - `pnpm hodl --init --date=<ISO> --price=<SOL_USD> --sol=<SOL> --usdc=<USDC>`
     — backdate to the real campaign start (amounts held then + SOL price then).
2. Never re-init an existing baseline unless the user explicitly says the
   campaign restarted (`--force` moves the goalposts and invalidates history).

## How to interpret for the user

- The `verdict` field is the headline: `beats-both` / `beats-usdc-only` /
  `beats-sol-only` / `loses-to-both`. Report it first, with the USD edges.
- A delta-neutral strategy is SUPPOSED to lag HODL-SOL when SOL pumps hard and
  beat it when SOL dumps — one mixed verdict after a big price move is not a
  failure. The signal that matters over time: the strategy should beat
  **HODL-as-is** (that edge ≈ fees earned − IL − carry − costs) and its USD
  equity should grind up vs **HODL-USDC**.
- `aprMeaningful: false` (window < 3 days) → quote USD edges only, warn that
  annualized numbers are noise.
- Persistent `loses-to-both` with a meaningful window → recommend reviewing
  whether to keep the bot running; suggest `pnpm pnl` (on Hetzner via
  `pnpm ssh:hetzner` — pnl.db lives there) for the fee/cost breakdown of why.
- Perp borrow fees in the breakdown are accrued-but-unpaid — they are already
  subtracted from equity; don't double-count them as a future cost.
- Answer the user in Russian; keep report numbers in USD/SOL as printed.
  Always show wallet addresses and identifiers in full, never abbreviated.

## After every срез: run the strategy analyzer

Once the срез is reported, invoke the `strategy-analyzer` project skill
(operator standing order, 2026-07-04): it re-verifies liveness, the fee
ledger, and parameter invariants against fresh pnl.db + on-chain data, and
either confirms the current strategy or proposes a change for the operator
to approve/reject. Skip only if the operator explicitly asked for the срез
number alone.
