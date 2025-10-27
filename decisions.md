# Architectural Decision Records (ADR)

**Project:** Delta-Neutral LP Bot

This document records important architectural decisions made during development.

---

## ADR-001: Use solana-agent-kit for Transaction Execution

**Date:** 2025-10-19
**Status:** Accepted
**Deciders:** Team
**Related:** Epic K, Epic N

### Context

We need a reliable way to execute Solana transactions with:
- Jito bundle support for atomic multi-tx operations
- Priority fee management during network congestion
- Direct control over transaction construction
- Lower latency than RPC-only solutions

### Decision

Use **solana-agent-kit** as the primary execution layer for all on-chain operations.

### Alternatives Considered

1. **Direct @solana/web3.js**
   - Pro: Maximum control, no abstraction
   - Con: Need to implement Jito integration ourselves
   - Con: More boilerplate code

2. **MCP (Model Context Protocol)**
   - Pro: Good for Claude integration
   - Con: Extra hop adds latency
   - Con: Limited control over bundle construction
   - Decision: Keep for diagnostics, not production execution

3. **Custom transaction builder**
   - Pro: Tailored to our exact needs
   - Con: Significant development time
   - Con: Maintenance burden

### Consequences

**Positive:**
- Built-in Jito bundle support
- Simplified codebase with agent-kit abstractions
- Active maintenance and community support
- Easier integration with Meteora, Drift, Jupiter

**Negative:**
- Dependency on external library
- Need to learn agent-kit API patterns
- Potential version lock-in

**Mitigation:**
- Keep agent-kit interfaces isolated in adapters
- Abstract critical paths to enable future replacement

---

## ADR-002: Band Rebalancing Over Continuous Hedging

**Date:** 2025-10-19
**Status:** Accepted
**Deciders:** Team
**Related:** Epic P

### Context

We need to decide how frequently to adjust the Drift short position to match LP exposure:
- Continuous: Rebalance on every small delta change
- Band-based: Rebalance only when delta exceeds threshold (e.g., �2 SOL)

### Decision

Use **band rebalancing** with configurable `DELTA_THRESHOLD_SOL` (default: 2 SOL).

### Rationale

1. **Cost Efficiency:**
   - Every rebalance costs transaction fees (~0.000005-0.01 SOL depending on priority)
   - Funding payments on small delta are negligible compared to tx costs

2. **Network Load:**
   - Reduces transaction volume during stable LP exposure
   - Less RPC load and rate limit exposure

3. **Slippage:**
   - Small rebalances (e.g., 0.1 SOL) suffer similar slippage % as larger ones
   - Better to batch adjustments

4. **Simplicity:**
   - Easier to test and reason about
   - Clear trigger conditions

### Consequences

**Positive:**
- Lower operational costs
- Simpler loop logic
- Reduced RPC/network load

**Negative:**
- Temporary delta exposure during band window
- Potential funding payments on unhedged delta

**Mitigation:**
- Set conservative band threshold (2 SOL = ~$300 exposure)
- Monitor funding rates closely
- Implement emergency tightening if funding spikes

---

## ADR-003: JSON-based State Persistence

**Date:** 2025-10-19
**Status:** Accepted
**Deciders:** Team
**Related:** Epic O, Task O2

### Context

Need to persist bot state between restarts and maintain audit trail of actions.

Options:
1. JSON files (state.json + journal.jsonl)
2. SQLite database
3. PostgreSQL database
4. No persistence (stateless)

### Decision

Use **JSON files** for MVP:
- `data/state.json` - Latest state snapshot
- `data/journal.jsonl` - Append-only action log (JSON Lines format)

### Rationale

1. **Simplicity:**
   - No database setup required
   - Easy to inspect and debug
   - Human-readable format

2. **MVP Scope:**
   - Single bot instance (no concurrent writes)
   - Moderate data volume
   - No complex queries needed

3. **Portability:**
   - Easy to backup and version
   - Can be committed to git (if sensitive data excluded)
   - Simple migration to database later

### Consequences

**Positive:**
- Fast MVP implementation
- Easy debugging and inspection
- No database maintenance overhead

**Negative:**
- Not suitable for multiple bot instances
- No transactional guarantees
- Limited query capabilities
- File I/O could become bottleneck at scale

**Future Migration Path:**
- When scaling beyond MVP, migrate to TimescaleDB or PostgreSQL
- Keep JSON as export/backup format
- Journal format (JSONL) is DB-friendly for bulk import

---

## ADR-004: Emergency Flow Execution Strategy

**Date:** 2025-10-19
**Status:** Accepted
**Deciders:** Team
**Related:** Epic P, Task P2

### Context

Emergency withdrawals require multiple operations in sequence:
1. Withdraw from LP
2. Claim fees
3. (Optional) Swap SOL � USDC
4. Adjust Drift hedge

Need to ensure atomic execution or reliable ordering during market volatility.

### Decision

Use **adaptive execution strategy**:
- **If total CU < MAX_COMPUTE_UNITS:** Pack all instructions into single atomic transaction
- **Else:** Split into 2-3 transactions and submit as Jito bundle with ordering guarantee
- **Fallback:** Sequential transactions with confirmation gating if Jito unavailable

### Alternatives Considered

1. **Always use Jito bundles**
   - Con: Unnecessary for simple cases
   - Con: Jito relay dependency even when atomic tx possible

2. **Always use sequential transactions**
   - Con: Risk of partial execution during congestion
   - Con: Slower execution

3. **Always pack into single atomic transaction**
   - Con: CU limits may prevent complex flows
   - Con: Transaction size limits

### Consequences

**Positive:**
- Optimal execution path for each scenario
- Atomic guarantees when possible
- Ordering guarantees via Jito when needed
- Graceful degradation if Jito unavailable

**Negative:**
- More complex execution logic
- Need to estimate CU accurately
- Multiple code paths to test

**Implementation Notes:**
- Simulate plan before execution to validate CU estimates
- Log which execution path was chosen
- Monitor Jito relay availability

---

## ADR-005: Automatic Meteora Position Creation

**Date:** 2025-10-19
**Status:** Accepted
**Deciders:** Team
**Related:** Epic L, Task L1, Task L2

### Context

Users need to provide liquidity to Meteora DLMM pools to run the bot. Traditional approach requires:
1. Manual position creation via Meteora UI
2. Copying position NFT mint addresses
3. Updating bot configuration

This creates friction for deployment and requires users to understand Meteora's UI.

### Decision

Implement **automatic position creation** with `AUTO_CREATE_POSITIONS` flag:
- Bot creates Meteora DLMM positions on first run (if enabled)
- Mints position NFTs automatically
- Persists created mint addresses to `data/state.json`
- No manual wallet/UI interaction required

Configuration supports two modes:
1. **Auto-create**: Specify pool, deposit amounts, and price range
2. **Existing**: Provide pre-created position NFT mints (legacy mode)

### Alternatives Considered

1. **Always require manual position creation**
   - Pro: Simpler bot logic
   - Pro: Users have full control over position parameters
   - Con: High deployment friction
   - Con: Requires Meteora UI knowledge
   - Con: Error-prone (wrong addresses, wrong pools)

2. **CLI wizard for position creation**
   - Pro: Guided user experience
   - Pro: Validation before creation
   - Con: Still requires manual step
   - Con: Doesn't support headless deployment

3. **Auto-create on every run**
   - Pro: Always fresh positions
   - Con: Would create duplicate positions
   - Con: Can't persist across restarts
   - Con: Wasted transaction fees

### Rationale

1. **User Experience:**
   - Zero-click deployment after config
   - No Meteora UI knowledge required
   - Reduces setup time from 15+ minutes to <1 minute

2. **Reliability:**
   - Eliminates user error (wrong addresses, wrong pools)
   - Ensures correct pool configuration
   - Bot validates parameters before creation

3. **Flexibility:**
   - Supports both auto-create and existing positions
   - Preserves backward compatibility
   - Advanced users can still pre-create positions

4. **Persistence:**
   - Created mints saved to state.json
   - Survives bot restarts
   - Can be backed up and restored

### Consequences

**Positive:**
- Dramatically improved onboarding experience
- Reduced user error
- Enables headless/automated deployments
- Bot can adjust position parameters dynamically in future

**Negative:**
- More complex Meteora adapter implementation
- Need to handle position creation failures
- Additional state management for created mints
- Initial transaction costs (one-time)

**Mitigation:**
- Comprehensive error handling for position creation
- Clear logging of created positions and mints
- Dry-run mode to validate parameters before creation
- Fallback to manual position mode if creation fails

**Implementation Notes:**
- Use solana-agent-kit's Meteora integration for position creation
- Price range specified in basis points from current price
- Support both balanced and single-sided deposits
- Validate wallet has sufficient balance before creation
- Save created mints immediately after success

**Future Enhancements:**
- Auto-adjust position ranges based on volatility
- Create multiple positions with different ranges
- Automatic rebalancing of concentrated liquidity
- Position migration to new pools

---

## ADR Template

Copy this template for future decisions:

```markdown
## ADR-XXX: [Decision Title]

**Date:** YYYY-MM-DD
**Status:** Proposed | Accepted | Deprecated | Superseded
**Deciders:** [Names/Roles]
**Related:** [Epic/Task references]

### Context

[Describe the problem or situation requiring a decision]
[Include relevant constraints, requirements, or background]

### Decision

[State the decision clearly and concisely]

### Alternatives Considered

1. **[Option 1]**
   - Pro:
   - Con:

2. **[Option 2]**
   - Pro:
   - Con:

### Rationale

[Explain why this decision was made]
[Include technical, business, or operational reasons]

### Consequences

**Positive:**
-
-

**Negative:**
-

**Mitigation:**
-

**Future Considerations:**
-
```

---

---

## ADR-006: DLMM SDK ESM/CommonJS Interop Strategy

**Date:** 2025-10-20
**Status:** Accepted
**Deciders:** Team
**Related:** Epic L

### Context

The @meteora-ag/dlmm SDK is a CommonJS module, but our project uses ESM (ES Modules). When importing the SDK in ESM, TypeScript's default import behavior doesn't correctly handle the module's default export, leading to runtime errors:

```typescript
import DLMM from '@meteora-ag/dlmm';
// DLMM.create is not a function (DLMM is the module wrapper, not the class)
```

This is a common issue when mixing ESM and CommonJS modules.

### Decision

Use a **runtime default export fallback pattern** to handle ESM/CommonJS interop:

```typescript
import DLMMModule from '@meteora-ag/dlmm';
import { StrategyType } from '@meteora-ag/dlmm';

// Handle ESM/CommonJS interop for DLMM class
const DLMM: any = DLMMModule.default || DLMMModule;
```

Type the DLMM variable as `any` to avoid complex TypeScript type gymnastics while maintaining runtime correctness.

### Alternatives Considered

1. **Use require() instead of import**
   - Pro: Works with CommonJS modules directly
   - Con: Mixing require/import is inconsistent
   - Con: Doesn't work well with TypeScript ESM project
   - Con: Can't use named imports for types (like StrategyType)

2. **Configure TypeScript with allowSyntheticDefaultImports**
   - Pro: Cleaner import syntax
   - Con: Only fixes compile-time, not runtime behavior
   - Con: Can still fail at runtime with ESM loaders
   - Con: Masks the underlying issue

3. **Create a wrapper module for the SDK**
   - Pro: Abstracts the interop logic
   - Pro: Provides better types
   - Con: Additional layer of indirection
   - Con: Maintenance burden
   - Con: Overkill for a single SDK

4. **Use @ts-expect-error or type assertions everywhere**
   - Pro: No runtime changes needed
   - Con: TypeScript loses all type checking for SDK
   - Con: Error-prone, easy to make mistakes
   - Con: No autocomplete/IntelliSense

### Rationale

The fallback pattern (`DLMMModule.default || DLMMModule`) is:
- **Simple**: One-line solution, easy to understand
- **Robust**: Works in both ESM and CommonJS environments
- **Runtime-safe**: Handles both modern and legacy module systems
- **Pragmatic**: Using `any` type avoids TypeScript complexity while maintaining correctness

This approach is widely used in the Node.js ecosystem for handling mixed module systems and is recommended by the TypeScript team for dynamic imports.

### Consequences

**Positive:**
- Works correctly at runtime in ESM environment
- Simple implementation, easy to maintain
- No changes needed to build configuration
- Compatible with tsx, ts-node, and compiled output
- Named imports (like StrategyType) work normally

**Negative:**
- Loses TypeScript type checking for DLMM class methods
- No autocomplete/IntelliSense for DLMM APIs
- Developers must refer to Meteora docs for method signatures

**Mitigation:**
- Document the DLMM API usage in code comments
- Add JSDoc annotations where needed
- Consider creating typed wrapper functions for commonly-used DLMM methods
- Keep this pattern isolated to meteoraAdapter.ts only

**Future Considerations:**
- If @meteora-ag/dlmm releases an ESM-native version, remove the fallback
- If we need extensive DLMM SDK usage, consider creating a typed wrapper module
- Monitor TypeScript/Node.js ecosystem for better interop solutions

---

## ADR-007: Jupiter API v6 Upgrade

**Date:** 2025-10-27
**Status:** Accepted
**Deciders:** Team
**Related:** Epic K (Price Oracle), Integration improvements

### Context

The bot was using Jupiter API v4 for SOL/USD price fetching. Jupiter has since released v6 with improvements:
- Multi-token price fetching in a single request
- Direct token-to-token exchange rates via `vsToken` parameter
- Better rate limiting and error handling
- More efficient API usage

We needed to decide whether to upgrade and how to maintain backward compatibility.

### Decision

Upgrade to **Jupiter API v6** while maintaining backward compatibility:
- Add new `getMultiTokenPrices()` function for multi-token fetching
- Keep existing `getSolPrice()` function unchanged (uses v6 internally)
- Use `vsToken=So11111111111111111111111111111111111111112` for direct SOL/USDC rates
- Add new `TokenPrice` and `MultiTokenPriceResult` types

### Alternatives Considered

1. **Stay on Jupiter v4**
   - Pro: No migration work needed
   - Con: Missing efficiency improvements
   - Con: v4 may be deprecated in future

2. **Breaking change to v6 only**
   - Pro: Simpler codebase
   - Con: Breaks existing code
   - Con: Forces migration on all users

3. **Use different price source (e.g., only Pyth)**
   - Pro: On-chain price feeds
   - Con: Higher latency
   - Con: More complex setup

### Rationale

1. **Efficiency:** Multi-token fetching reduces API calls (2 calls → 1 call for SOL+USDC)
2. **Accuracy:** Direct SOL/USDC rate via vsToken parameter more accurate than SOL/USD + USDC/USD
3. **Backward Compatibility:** Existing code continues to work without changes
4. **Future-Proof:** v6 is latest stable API, likely to be maintained longer

### Consequences

**Positive:**
- More efficient API usage (fewer calls)
- Direct SOL/USDC exchange rate for delta calculations
- Backward compatible - no breaking changes
- Better error handling in v6

**Negative:**
- Slightly more complex code (two functions instead of one)
- Need to maintain both single and multi-token code paths

**Implementation Notes:**
- `fetchTokenPricesFromJupiter()` handles v6 API calls
- URL format: `https://price.jup.ag/v6/price?ids=mint1,mint2&vsToken=mint3`
- Response format changed - adapted in parser
- See [src/core/priceOracle.ts](src/core/priceOracle.ts) for implementation

---

## ADR-008: Meteora Pool Analytics Caching Strategy

**Date:** 2025-10-27
**Status:** Accepted
**Deciders:** Team
**Related:** Epic L, Integration improvements

### Context

Meteora provides a REST API for pool analytics (APR, APY, volume, fees, TVL):
- Endpoint: `https://dlmm-api.meteora.ag/pair/{poolAddress}`
- Returns comprehensive pool metadata
- Much faster than on-chain queries

We needed to decide:
1. Whether to use the API vs on-chain queries
2. How long to cache the data

### Decision

Use **Meteora DLMM API with 2.5-second caching**:
- Cache pool info in `MeteoraAdapter` instance
- TTL: 2500ms (2.5 seconds)
- Return cached data if still fresh
- Fetch new data when cache expires

### Alternatives Considered

1. **On-chain queries only**
   - Pro: Always accurate
   - Pro: No API dependency
   - Con: Much slower (multiple RPC calls)
   - Con: Higher RPC costs
   - Con: Some metrics not available on-chain (APR/APY)

2. **Longer cache (30-60 seconds)**
   - Pro: Fewer API calls
   - Con: Stale data on Solana (slots change every ~400ms)
   - Con: Risk using outdated pool state for decisions

3. **No caching**
   - Pro: Always fresh data
   - Con: Excessive API calls
   - Con: Rate limiting risk
   - Con: Slower performance

4. **Shorter cache (1 second)**
   - Pro: Fresher data
   - Con: Still may call API multiple times per second
   - Con: Minimal benefit over 2.5s

### Rationale

**2.5-second cache chosen because:**
1. **Solana block time:** ~400-500ms, so 2.5s = ~5-6 slots (reasonable freshness)
2. **API rate limits:** Prevents excessive calls to Meteora API
3. **Performance:** Reduces latency for repeated calls within same operation
4. **User feedback:** Based on domain knowledge that "2.5 seconds and data is stale in solana"

This balances freshness with efficiency. Pool analytics (APR, volume, fees) don't change drastically in 2.5s, so slight staleness is acceptable.

### Consequences

**Positive:**
- Fast pool analytics without on-chain queries
- Prevents API rate limiting
- Good balance of freshness vs performance
- Rich data (APR, APY, volume, fees, TVL)

**Negative:**
- Potential 2.5s stale data
- Dependency on Meteora API availability
- Need to handle API failures

**Mitigation:**
- Cache is instance-scoped (not global), so multiple bots don't share stale data
- Clear logging of cache age
- Fallback to on-chain if API fails (future enhancement)

**Implementation Notes:**
- Cache in `MeteoraAdapter`: `poolInfo` + `poolInfoLastFetched` timestamp
- Check `Date.now() - poolInfoLastFetched < 2500` before returning cached data
- See [src/modules/meteoraAdapter.ts:102-123](src/modules/meteoraAdapter.ts#L102-L123)

---

## ADR-009: Documentation Standards

**Date:** 2025-10-27
**Status:** Accepted
**Deciders:** Team
**Related:** All Epics (Documentation quality)

### Context

As the codebase grew, we needed consistent documentation standards for:
- File-level module documentation
- Function-level JSDoc comments
- Type definitions
- Configuration constants
- README and guides

Without standards, documentation becomes inconsistent, incomplete, or outdated.

### Decision

Implement **comprehensive JSDoc documentation standards**:

1. **File-level docstrings** for every module with:
   - Module overview
   - Key features list
   - Implementation details
   - Usage examples
   - Status (✅ implemented vs 🔜 planned)

2. **Function-level JSDoc** with:
   - Description of what function does
   - `@param` tags for all parameters
   - `@returns` tag for return value
   - `@throws` tag if applicable
   - `@example` for non-obvious usage

3. **Type definitions** with:
   - Interface purpose
   - Field descriptions
   - Units/precision notes
   - Usage examples

4. **Configuration constants** with:
   - Inline comments explaining each value
   - Trade-offs of different values
   - Examples or formulas

5. **Markdown docs** with:
   - Clear structure and navigation
   - Code examples
   - Implementation status
   - Links to related docs

### Alternatives Considered

1. **Minimal inline comments only**
   - Pro: Less documentation overhead
   - Con: Poor developer experience
   - Con: Hard to onboard new developers
   - Con: Code intent unclear

2. **External wiki/docs site**
   - Pro: Rich formatting options
   - Pro: Searchable
   - Con: Separate from code (gets out of sync)
   - Con: Extra tooling needed

3. **Auto-generated API docs (TypeDoc)**
   - Pro: Always in sync with code
   - Con: No examples or context
   - Con: Still need manual docs for architecture

### Rationale

**Comprehensive inline docs chosen because:**
1. **Discoverability:** Documentation lives with code in IDE
2. **Maintainability:** Updated in same PR as code changes
3. **Developer Experience:** IntelliSense shows docs on hover
4. **Onboarding:** New developers can understand code faster
5. **AI-Friendly:** Claude Code and other AI tools can read inline docs

### Consequences

**Positive:**
- Better developer experience (IDE autocomplete with docs)
- Easier onboarding for new contributors
- Documentation stays in sync with code
- Clear implementation status (what's done vs planned)
- Examples prevent misuse of APIs

**Negative:**
- More upfront documentation work
- Need to update docs when code changes
- Can become verbose if over-documented

**Mitigation:**
- Use templates for consistency (see DOCUMENTATION_GUIDE.md)
- Focus on "why" not "what" (code shows "what")
- Keep examples concise and practical
- Review docs in PR process

**Implementation Notes:**
- Created DOCUMENTATION_GUIDE.md with standards and templates
- Updated all core modules with comprehensive docstrings
- Added implementation status markers (✅ vs 🔜)
- See commits from 2025-10-27 for examples

---

## Decision Index

- ADR-001: Use solana-agent-kit for Transaction Execution
- ADR-002: Band Rebalancing Over Continuous Hedging
- ADR-003: JSON-based State Persistence
- ADR-004: Emergency Flow Execution Strategy
- ADR-005: Automatic Meteora Position Creation
- ADR-006: DLMM SDK ESM/CommonJS Interop Strategy
- ADR-007: Jupiter API v6 Upgrade
- ADR-008: Meteora Pool Analytics Caching Strategy (2.5s TTL)
- ADR-009: Documentation Standards

---

## Decision Status

- **Accepted:** 9
- **Proposed:** 0
- **Deprecated:** 0
- **Superseded:** 0
