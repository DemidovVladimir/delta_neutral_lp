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

If the Helius key answers `429 max usage reached` (credits exhausted — the
BUG-014 failure mode; local runs share the server's key), the срез still
works through the public endpoint:

```bash
RPC_URL=https://api.mainnet-beta.solana.com pnpm hodl
```

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

## MANDATORY report format (operator feedback 2026-07-05)

The operator was left unsure whether the bot is profitable because a report
labeled the HODL-USDC edge as «PnL к baseline» without naming it (they are
the SAME number: HODL-USDC = the frozen baseline total), and never gave a
one-line bottom line. Every срез MUST render this block, all three
benchmarks explicitly labeled in plain language, then ONE verdict sentence:

```
ВЕРДИКТ СРЕЗА (окно N дней):
  🤖 Бот vs «ничего не делать» (HODL-as-is):  ±X USD   ← ГЛАВНОЕ ЧИСЛО
  💵 Портфель vs «всё в USDC» (= PnL к baseline): ±Y USD
  🌊 Портфель vs «всё в SOL»:                  ±Z USD
Итог: <одно предложение: бот заработал/потерял X USD относительно
бездействия за N дней; тренд этого числа между срезами; когда финальный
вердикт кампании>.
```

Interpretation rules for the block:
- «Бот выгоден?» отвечает ТОЛЬКО строка vs HODL-as-is и её ТРЕНД между
  срезами — fees + hedge PnL − IL − все косты относительно полного
  бездействия. Один срез — точка; тренд — ответ.
- **MANDATORY decomposition when price moved since baseline (after срез #2,
  2026-07-08):** with target delta 0 the vs-as-is edge contains a MECHANICAL
  term = baseline_SOL × (P_now − P_baseline) × (−1) — i.e. baseline_SOL from
  data/hodl-baseline.json times how far price fell (positive on a drop: the
  hedge protected what the do-nothing benchmark lost; negative on a rise:
  the insurance premium). Subtract it; the remainder must ≈ the vs-USDC
  edge within cents (mismatch = neutrality leak → strategy-analyzer
  mirror-check). Report BOTH parts in plain words («из +4.91 против
  бездействия ~+6.56 — механика защиты от падения; чистое умение −1.65»).
  NEVER present the mechanical part as skill. Night-loss decomposition
  template and current norms: BACKLOG.md §C2, §C4.
- vs HODL-USDC (= PnL к baseline): ДО 2026-07-05T14:47Z дышал с ценой SOL
  (idle-кошелёк был нехеджирован); с ADR-021 (HEDGE_INCLUDE_WALLET_SOL) idle
  SOL входит в хедж-цель и дыхание должно прекратиться. Если этот edge
  ЗАМЕТНО дышит с ценой на пост-ADR-021 окне — это сигнал утечки
  нейтральности, гони hedge-economics mirror-check в strategy-analyzer.
- Never write a dollar sign followed by a digit in this file (skill-engine
  arg substitution) — use `N USD`.

## MANDATORY verification block (operator standing order 2026-07-07 — «доверие утеряно»)

Trust in self-reported numbers is REVOKED. Every срез MUST include, in the
report, all four of the following — no exceptions, no summaries-without-data:

1. **Log check — everything fired when it should have.** Pull the window's
   server logs and pnl.db (+WAL). Verify: hedge_actions row density has NO
   gaps >60s that don't match documented downtime (BUG-015 class); every
   recenter in `rebalances` has its ⚠️→✅ log pair; grep the window for
   `🚨 VITALS BREACH` (must be none — each one found goes in the report
   verbatim) and for ⏳/🧊/🌩/regime lines, and say what they show.
2. **Full transaction list.** Run
   `npx tsx scripts/tx-audit.ts --since <window start> --db <pulled pnl.db>`
   and include its per-transaction output in the report: FULL signature,
   who paid the fee and how much, ΔSOL / ΔUSDC per transaction,
   classification, db:* cross-check tags. Any perps/meteora/jupiter
   transaction WITHOUT a db:* tag must be explained or flagged as
   unexplained — never silently dropped.
3. **Totals with formulas.** The audit's totals section (fees = Σ tx.meta.fee
   where wallet paid; SOL/USDC in/out = Σ balance deltas) plus the equity
   formula WITH the actual numbers substituted:
   `equity = walletSOL×P + walletUSDC + (lpSOL×P + lpUSDC + unclaimed) +
   (collateral + perpUPnL − accruedBorrow)` — each term printed, then each
   benchmark edge as `equity − benchmark` with both numbers shown.
4. **Norms check.** State explicitly, with numbers: network fees in window
   vs norm (≈0.001–0.005 SOL/day); live hedge churn vs 3× auto-cap; LP value
   vs creation deposit; liquidation price ≥ 1.3× spot. Any breach = lead
   with it, not bury it.

Recall rule: never infer a MECHANISM from trade patterns alone — check row
density and the exact log lines first (BUG-015 was mis-narrated for two days
this way).

## After every срез: run the strategy analyzer

Once the срез is reported, invoke the `strategy-analyzer` project skill
(operator standing order, 2026-07-04): it re-verifies liveness, the fee
ledger, and parameter invariants against fresh pnl.db + on-chain data, and
either confirms the current strategy or proposes a change for the operator
to approve/reject. Skip only if the operator explicitly asked for the срез
number alone — the verification block above is NOT skippable even then.
