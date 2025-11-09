# MVP PRD — Delta‑Neutral LP Bot with **solana-agent-kit** (+ Jito Bundles & Priority)
**Version:** 2025-10-19T14:34:30Z

This PRD pivots the MVP to **solana‑agent‑kit** for full control over **Jito bundles**, **multi‑instruction atomic tx**, and **priority fees**. MCP can stay for dev tooling, but **production execution** routes through the Agent Kit for speed and reliability during volatility.

---

## 1) Why Agent Kit over MCP (for MVP)
- **Jito Bundles**: build N‑tx bundles with ordered inclusion + tips.
- **Atomic tx**: pack multiple instructions (withdraw → claim → swap → hedge) into a single transaction when CU allows.
- **Priority**: set `ComputeBudget` & priority fee per tx.
- **Lower latency**: direct signer + connection + relayer (no extra hop).

MCP can still be used by Claude for diagnostics and manual ops; the bot’s core loop and emergency flow run via **agent‑kit**.

---

## 2) Scope (MVP)
- Provide/withdraw liquidity on **Meteora DLMM** (SOL/USDC), claim fees.
- **Auto-Tune Feature** (implemented 2025-11-09): Automatic position rebalancing
  - Monitors position composition every interval (default: 30s)
  - Detects when position becomes imbalanced (>80% in one token)
  - Executes atomic rebalance (withdraw + claim + close + create in ONE transaction)
  - Auto-compounds claimed fees into new position
  - Simple threshold-based configuration (no BPS calculations needed)
- Maintain **Drift** short to keep `ΔSOL ≈ 0` (simple band rebalancing).
- Implement **Emergency Flow** as bundled, prioritized execution:
  1) Meteora withdraw (partial/full)
  2) Meteora claim fees
  3) (Optional) Jupiter swap SOL→USDC
  4) Drift hedge adjust to new LP exposure
- Observability: structured logs + minimal JSON persistence.
- Safe limits: min margin, funding cap, notional cap, Δ band.

Out of scope for MVP: GUI, optimizer (can be added later), backtests.

---

## 3) Configuration (.env)
```dotenv
# Core
RPC_URL=
PRIVATE_KEY=           # base58 array or comma-separated secret bytes
LP_OWNER=
METEORA_POSITION_MINTS=
DRIFT_MARKET_SOL_PERP=

# Risk
DELTA_THRESHOLD_SOL=2
MIN_COLLATERAL_RATIO=0.15
MAX_SHORT_NOTIONAL_USD=12000
FUNDING_RATE_CAP_BPS=80

# Priority & Bundles
USE_JITO=true
JITO_RELAY_URL=
PRIORITY_TIP_LAMPORTS=80000
MAX_COMPUTE_UNITS=1200000

# Auto-Tune (Implemented 2025-11-09)
AUTO_TUNE_ENABLED=false
AUTO_TUNE_BIN_COUNT=20
AUTO_TUNE_CHECK_INTERVAL_MS=30000
AUTO_TUNE_IMBALANCE_THRESHOLD=0.8
```

---

## 4) Architecture
```
Agent Orchestrator (TS, solana-agent-kit)
 ├─ MeteoraAdapter        ── DLMM exposure, deposit/withdraw, claim, atomicRebalance
 ├─ AutoTuneOrchestrator  ── Position monitoring & automatic rebalancing (NEW 2025-11-09)
 ├─ DriftEngine           ── get state, place perp orders, collateral ops
 ├─ Bundler               ── atomic tx builder, Jito bundle, priority fallback
 ├─ RiskController        ── Δ, margin, funding, notional limits
 └─ Persistence           ── JSON store + action journal + auto-tune state
```

---

## 5) Key Flows

### 5.1 Normal Hedge Loop (every 10–20s)
1. Get SOL price (Jup/Pyth via agent‑kit).
2. Read DLMM exposure → `lp_sol, lp_usdc`.
3. Read Drift → `short_sol, collateralUsd, marginRatio, funding`.
4. Compute `Δ = lp_sol - short_sol`. If `|Δ| ≥ band`, call `rebalanceToShortSol(target=lp_sol)`.

### 5.1a Auto-Tune Loop (every 30s, runs independently if enabled)
**Implemented 2025-11-09**
1. Get current pool active bin and price
2. Read position composition (SOL/USDC percentages)
3. Check imbalance: if position >80% in one token, trigger rebalance
4. Execute atomic rebalance (withdraw + claim + close + create in ONE transaction):
   - Withdraw 100% from current position
   - Claim all accumulated fees
   - Close empty position (reclaim rent)
   - Create new position centered at current price with:
     - Original funds + claimed fees (auto-compounding)
     - Fixed bin count (default: 20 bins)
     - Automatically calculated price range
5. Save rebalance state and continue monitoring

**Key Features:**
- All operations in SINGLE transaction for atomicity (75% fee savings vs 4 separate txs)
- Uses partialSign for wallet + position keypair signatures
- Normal Jito priority to avoid overpaying
- Simple threshold-based configuration (no BPS calculations needed)

### 5.2 Emergency Flow (bundled)
Trigger: margin buffer low, price shock, RPC congestion, or manual.
Plan (priority ordered):
- Ix1: Meteora withdraw (param: percent/full, single‑sided out optional)
- Ix2: Meteora claim fees
- Ix3: Jupiter swap (SOL→USDC) if risk‑off
- Ix4: Drift adjust to match new `lp_sol`
**Execution strategy**
- If CU < limit → **single atomic tx** (pack all ixs + ComputeBudget + priority fees).
- Else → split into **2–3 tx** and send as **Jito bundle** with `PRIORITY_TIP_LAMPORTS`.

### 5.3 Fallback
- If Jito unavailable → send sequential tx with high priority fee; confirmation gating between steps.

---

## 6) Module Contracts (stubs)

```ts
// src/modules/meteoraAdapter.ts
export type LpExposure = { solAmount:number; usdcAmount:number; totalUsd:number; claimableSol:number; claimableUsdc:number; };
export class MeteoraAdapter {
  constructor(private owner: string, private positionMints: string[]) {}
  async getLpExposure(): Promise<LpExposure> { /* agent-kit call */ throw new Error('TODO'); }
  async depositToLp(a:{ usdc?:number; sol?:number; singleSided?:'sol'|'usdc' }): Promise<string> { throw new Error('TODO'); }
  async withdrawFromLp(a:{ percent?:number; amount?:number; singleSidedOut?:'sol'|'usdc' }): Promise<string> { throw new Error('TODO'); }
  async claimFees(): Promise<{ sol:number; usdc:number; sig:string }> { throw new Error('TODO'); }

  // NEW: Auto-tune atomic rebalance (implemented 2025-11-09)
  async atomicRebalance(params: {
    oldPositionMint: string;
    newPositionParams: {
      solAmount: number;
      usdcAmount: number;
      priceLower: number;
      priceUpper: number;
    };
  }): Promise<{
    signature: string;
    newPositionMint: string;
    claimedFees: { sol: number; usdc: number };
  }> {
    // Extracts instructions from SDK methods (removeLiquidity, claimAllRewards, closePosition, initializePositionAndAddLiquidityByStrategy)
    // Combines all into SINGLE Transaction with partialSign(wallet, newPositionKeypair)
    // Uses 'normal' Jito priority
    throw new Error('IMPLEMENTED - see src/modules/meteoraAdapter.ts');
  }
}
```

```ts
// src/modules/autoTuneOrchestrator.ts (NEW - implemented 2025-11-09)
export type AutoTuneState = { iteration:number; running:boolean; lastCheck:number; lastRebalance:number; rebalanceCount:number; consecutiveErrors:number; currentPositionMint?:string; };
export type PositionBalance = { solPercent:number; usdcPercent:number; isImbalanced:boolean; currentPrice:number; lowerPrice:number; upperPrice:number; reason?:string; };
export class AutoTuneOrchestrator {
  async start(): Promise<void> { /* starts monitoring loop */ }
  async stop(): Promise<void> { /* stops gracefully */ }
  private async runCheckCycle(): Promise<void> { /* checks position, triggers rebalance if needed */ }
  private async checkPositionBalance(): Promise<PositionBalance | null> { /* reads position composition */ }
  private async executeRebalance(): Promise<RebalanceResult> { /* calls atomicRebalance() */ }
}
```

```ts
// src/modules/driftEngine.ts
export type DriftState = { shortSol:number; collateralUsd:number; marginRatio:number; fundingBpsDay:number; };
export class DriftEngine {
  constructor(private marketIndex: number) {}
  async getState(): Promise<DriftState> { /* agent-kit */ throw new Error('TODO'); }
  async rebalanceToShortSol(a:{ targetSol:number; price:number; maxSlippageBps:number }): Promise<string> { throw new Error('TODO'); }
  async topUpCollateral(a:{ usdc:number }): Promise<string> { throw new Error('TODO'); }
  async withdrawCollateral(a:{ usdc:number }): Promise<string> { throw new Error('TODO'); }
}
```

```ts
// src/modules/bundler.ts
export type PlanStep = { label:string; ix:any; };
export type Plan = { steps:PlanStep[]; };
export class Bundler {
  buildAtomicTx(_:Plan): any { /* pack ixs + ComputeBudget + fee */ throw new Error('TODO'); }
  async sendJitoBundle(txs:any[], tipLamports:number): Promise<string> { /* agent-kit jito */ throw new Error('TODO'); }
  async sendWithPriority(tx:any, tipLamports:number): Promise<string> { /* priority fee fallback */ throw new Error('TODO'); }
  async simulatePlan(_:Plan): Promise<{ok:boolean; errors?:string[]}> { return { ok:true }; }
}
```

```ts
// src/modules/riskController.ts
export function checkLimits(p:{ lpSol:number; price:number; shortSol:number; collateralUsd:number; fundingBpsDay:number; }, cfg:any){
  const notional = Math.abs(p.lpSol * p.price);
  if (notional > cfg.MAX_SHORT_NOTIONAL_USD) throw new Error('Notional cap');
  const collat = p.collateralUsd / Math.max(1, notional);
  if (collat < cfg.MIN_COLLATERAL_RATIO) throw new Error('Collateral low');
  if (p.fundingBpsDay > cfg.FUNDING_RATE_CAP_BPS) throw new Error('Funding high');
  return { delta: p.lpSol - p.shortSol, collat, notional };
}
```

---

## 7) Epics & Tasks (Claude‑ready YAML)

```yaml
epics:
  - id: K
    title: Bootstrap & Agent Kit Wiring
    tasks:
      - id: K1
        title: Project init, config, logger, env
      - id: K2
        title: AgentKit init (connection, wallet), price oracle helper

  - id: L
    title: Meteora DLMM Adapter
    tasks:
      - id: L0
        title: Auto-create positions (optional mode)
      - id: L1
        title: Read exposure from position NFTs (lp_sol/usdc)
      - id: L2
        title: Deposit / Withdraw (single-sided support)
      - id: L3
        title: Claim fees
      - id: L4
        title: "Auto-tune: Atomic rebalancing (withdraw+claim+close+create) (NEW 2025-11-09)"

  - id: M
    title: Drift Hedge Engine
    tasks:
      - id: M1
        title: Read state (short, collateral, margin, funding)
      - id: M2
        title: RebalanceToShortSol (with slippage + CU limits)
      - id: M3
        title: Collateral ops (deposit/withdraw)

  - id: N
    title: Bundles & Priority
    tasks:
      - id: N1
        title: Atomic tx builder (ComputeBudget + priority fee)
      - id: N2
        title: Jito bundle submission (ordered multi‑tx)
      - id: N3
        title: Fallback path with confirmation gating

  - id: O
    title: Risk & Persistence
    tasks:
      - id: O1
        title: Limits (Δ, margin, funding) + enforcement
      - id: O2
        title: JSON persistence (state + journal)

  - id: P
    title: Orchestrator & Emergency Flow
    tasks:
      - id: P1
        title: Hedge loop (compute Δ, rebalance)
      - id: P2
        title: Emergency plan (withdraw → claim → swap → hedge)
      - id: P3
        title: Simulation + dry‑run flag for mainnet testing
```

---

## 8) Acceptance Criteria
- End‑to‑end: deposit → stable hedge → forced rebalance works on‑chain.
- Emergency plan executes as **atomic tx** or **Jito bundle** with clear ordering.
- Priority fee / CU config is applied; fallback path lands reliably.
- No liquidation in controlled testing; Δ maintained within band ≥95% cycles.
- Structured logs and a journal capture actions & results.

---

## 9) Quick CLI (examples)
```bash
# Start loop
pnpm tsx src/cli/start.ts

# Auto-tune (NEW - implemented 2025-11-09)
pnpm auto-tune              # Start auto-tune loop
pnpm auto-tune --help       # Show auto-tune help

# Manual ops
pnpm tsx src/cli/lp.ts deposit --usdc 12000
pnpm tsx src/cli/lp.ts withdraw --percent 50 --singleOut usdc
pnpm tsx src/cli/drift.ts rebalance
pnpm tsx src/cli/fees.ts claim

# Emergency
pnpm tsx src/cli/emergency.ts --full
```
