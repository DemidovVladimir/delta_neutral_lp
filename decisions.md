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

Configuration supports one mode:

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

## ADR-010: Dynamic Jito Tipping with 5-Second Cache

**Date:** 2025-10-28
**Status:** Accepted
**Deciders:** Team
**Related:** Epic N (Transaction Execution), jitoUtils.ts

### Context

The bot was using static Jito tip escalation (4k→6k→8k lamports) for bundle submissions. This approach had limitations:
- Tips not adjusted to current network conditions
- May overpay when network is quiet
- May underpay when network is congested (lower landing rate)
- No visibility into current tip market

Jito provides a Bundle Tips API that exposes real-time tip floor percentiles (p25/p50/p75/p95/p99) based on recently landed bundles.

We needed to decide:
1. Whether to use dynamic tipping vs static
2. How long to cache tip data
3. What fallback values to use when API unavailable

### Decision

Implement **dynamic Jito tipping with 5-second cache**:
- Fetch real-time tip percentiles from Jito Bundle Tips API
- Cache for 5 seconds (TIP_CACHE_TTL_MS = 5000)
- Priority-based tip selection (low/normal/high/urgent/critical)
- Exponential escalation on retry (1.0x → 1.5x → 2.25x → 3.38x)
- Cost-aware capping based on transaction value
- Conservative fallback tips when API unavailable

### Alternatives Considered

1. **Keep static tips (4k→6k→8k lamports)**
   - Pro: Simple, no API dependency
   - Pro: Predictable costs
   - Con: Not adaptive to network conditions
   - Con: May waste money or get low landing rate
   - Con: No visibility into tip market

2. **Longer cache (30-60 seconds)**
   - Pro: Fewer API calls
   - Con: Stale data in fast-changing network
   - Con: May use outdated tip floors
   - Con: Solana blocks every ~400ms, 30s+ is too stale

3. **No caching (fetch every time)**
   - Pro: Always fresh data
   - Con: Excessive API calls
   - Con: Rate limiting risk
   - Con: Added latency on every transaction

4. **Use Helius priority fee API instead**
   - Pro: Alternative data source
   - Con: Different metric (priority fees vs Jito tips)
   - Con: Not specific to Jito bundles
   - Con: Extra dependency

### Rationale

**5-second cache chosen because:**
1. **Network freshness:** 5s = ~10-12 Solana slots, reasonable freshness for tip market
2. **API rate limits:** Prevents excessive calls to Jito API
3. **Performance:** Reduces latency for multiple txs within same operation
4. **User feedback:** User explicitly requested "5 seconds caching at max"

**Dynamic tipping benefits:**
1. **Cost efficiency:** Pay appropriate tips for network conditions (lower when quiet)
2. **Landing rate:** Higher tips when network congested (better bundle success)
3. **Market awareness:** Visibility into current tip environment
4. **Proven strategy:** Based on meteora-lp-army-bot production experience

**Exponential escalation (1.5x per retry):**
- Start conservative (p50 or p75)
- Escalate aggressively on failure (1.5x, 2.25x, 3.38x)
- Signals urgency to validators
- Proven effective in production

### Consequences

**Positive:**
- Adaptive tip pricing based on real-time network conditions
- Better cost efficiency (don't overpay in quiet periods)
- Higher landing rates (pay more when needed)
- Visibility into Jito tip market via API
- Cost-aware capping prevents runaway tips

**Negative:**
- Dependency on Jito Bundle Tips API
- Slightly more complex code than static tips
- Need to handle API failures with fallbacks
- Cache adds state management

**Mitigation:**
- Conservative fallback tips (p99: 100k lamports = $0.02) when API unavailable
- 5-second cache prevents API rate limiting
- Clear logging of tip amounts and sources
- Cost-aware capping prevents excessive tips

**Implementation Notes:**
- API: `https://bundles-api-rest.jito.wtf/api/v1/bundles/tip_floor`
- Priority mapping: `low→p25, normal→p50, high→p75, urgent→p95, critical→p99`
- Fallback tips researched from Jito's 1k minimum + real-world usage
- See [src/utils/jitoUtils.ts](src/utils/jitoUtils.ts) for implementation

---

## ADR-011: Jupiter Lite API v3 Migration

**Date:** 2025-10-28
**Status:** Accepted
**Deciders:** Team
**Related:** Epic K (Price Oracle), priceOracle.ts

### Context

The bot was using Jupiter API v6 endpoint (`price.jup.ag/v6/price`) for SOL/USD price fetching. During testing, we encountered DNS resolution failures:

```
Error: fetch failed
Cause: queryA ENODATA price.jup.ag
```

**Key findings:**
- `curl` successfully resolves and fetches from price.jup.ag
- Node.js v24 native fetch() fails with DNS error
- Issue specific to Node.js DNS resolver on macOS
- System DNS (used by curl) works fine, but Node DNS resolver doesn't

Jupiter provides multiple API endpoints:
1. `price.jup.ag/v6/price` - Main Jupiter Price API v6
2. `lite-api.jup.ag/price/v3` - Jupiter Lite API v3 (alternative endpoint)

### Decision

Migrate to **Jupiter Lite API v3** (`lite-api.jup.ag/price/v3`):
- Switch endpoint from price.jup.ag to lite-api.jup.ag
- Use undici's fetch for more reliable DNS resolution
- Update response parsing for v3 API format
- Add technical documentation about DNS issue

### Alternatives Considered

1. **Fix DNS resolution on user's system**
   - Pro: Fixes root cause
   - Con: Not under our control
   - Con: May affect other users with same macOS/Node v24 setup
   - Con: Not a robust solution

2. **Implement Pyth on-chain oracle**
   - Pro: On-chain price feeds, no DNS dependency
   - Con: Much higher complexity (SDK integration, feed addresses)
   - Con: Higher latency (on-chain queries)
   - Con: Attempted but Pyth feeds returned garbage data
   - Con: Overkill for DNS issue

3. **Use Switchboard on-chain oracle**
   - Pro: Alternative on-chain oracle
   - Con: Similar complexity to Pyth
   - Con: Attempted but feeds returned incorrect data
   - Con: Overkill for simple API endpoint issue

4. **Downgrade to Jupiter v4**
   - Pro: Older endpoint might work
   - Con: Loses v6 features (multi-token, vsToken)
   - Con: v4 may be deprecated soon
   - Con: Doesn't solve DNS issue (same domain)

### Rationale

**lite-api.jup.ag works because:**
1. Different DNS record with better resolution
2. Node.js DNS resolver can resolve lite-api.jup.ag
3. User confirmed it works: `fetch('https://lite-api.jup.ag/price/v3?ids=So1...')` succeeded

**Undici chosen because:**
1. More robust HTTP client than Node's native fetch
2. Better DNS handling and error recovery
3. Widely used in Node.js ecosystem
4. Small dependency (~200KB)

**Simpler than on-chain oracles:**
- Jupiter Lite API is still fast and reliable
- No complex SDK integration needed
- Maintains existing architecture
- On-chain oracles add complexity without benefit for this case

### Consequences

**Positive:**
- Fixes DNS resolution issue on macOS/Node v24
- Better DNS reliability overall
- Maintains fast off-chain price fetching
- Simple migration (endpoint + response parsing change)
- Keeps multi-token support and vsToken parameter

**Negative:**
- Dependency on lite-api.jup.ag endpoint availability
- API v3 format differs from v6 (minor parsing changes)
- Need to document the DNS issue for future reference
- Added undici dependency (~200KB)

**Mitigation:**
- Keep Pyth oracle fallback in code (for future implementation)
- Document DNS issue in priceOracle.ts file-level docstring
- Monitor lite-api.jup.ag uptime
- Can switch back to price.jup.ag if DNS issues resolved

**Implementation Notes:**
- Old URL: `https://price.jup.ag/v6/price?ids={mints}&vsToken={vsToken}`
- New URL: `https://lite-api.jup.ag/price/v3?ids={mints}&vsToken={vsToken}`
- Response format change: Direct object `{mintAddress: {...}}` instead of `{data: {mintAddress: {...}}}`
- Price field: `tokenData.usdPrice || tokenData.price` (v3 uses `usdPrice`)
- DNS issue documented in priceOracle.ts lines 30-31

**Future Considerations:**
- Monitor if price.jup.ag DNS resolution improves in future Node.js versions
- Consider implementing Pyth on-chain oracle as true fallback
- Track lite-api.jup.ag stability and uptime

---

---

## ADR-012: Auto-Tune Two-Step Rebalancing Strategy

**Date:** 2025-01-09
**Status:** Accepted
**Deciders:** Team
**Related:** Epic L (Meteora DLMM), AutoTuneOrchestrator

### Context

Meteora DLMM positions become imbalanced as SOL price moves - they can become 80-100% concentrated in one token (SOL or USDC) when price moves outside the position range. This reduces capital efficiency and stops earning fees.

Traditional approaches require:
1. Manual monitoring of position composition
2. Multiple separate transactions: withdraw → claim → close → create
3. Complex price range calculations by user
4. Risk of partial execution (some txs succeed, others fail)

We needed an automated solution that:
- Detects position imbalance automatically
- Rebalances efficiently (low cost)
- Auto-compounds claimed fees
- Maintains concentrated liquidity
- Requires minimal user configuration

### Decision

Implement **Auto-Tune with Two-Step Rebalancing**:

**Detection:**
- Monitor position composition at configurable intervals (default: 30s)
- Simple threshold-based trigger (e.g., 80% in one token)
- User sets ONE parameter: `AUTO_TUNE_IMBALANCE_THRESHOLD=0.8`

**Execution:**
- TWO sequential transactions for reliability:
  **Transaction 1:** Withdraw + Claim + Close (using SDK's `shouldClaimAndClose=true`)
  **Transaction 2:** Create new position with original + claimed fees
- Uses SDK's transaction objects directly (no manual instruction extraction)
- SDK handles compute budget instructions automatically
- Normal Jito priority to avoid overpaying
- Each transaction confirmed before proceeding to next

**Auto-Calculation:**
- Bot calculates new position range automatically
- Centered at current price
- Fixed bin count (default: 20 bins)
- No manual BPS calculation needed by user

**Auto-Compounding:**
- Claimed fees automatically added to new position
- Increases position size over time
- Maximizes capital efficiency

### Alternatives Considered

1. **Sequential Transactions (4 separate txs)**
   - Pro: Simpler SDK usage
   - Con: Risk of partial execution
   - Con: 4x transaction fees
   - Con: Slower execution
   - Con: Not atomic (could fail mid-way)
   - **Note:** We ended up using 2 sequential transactions (withdraw+claim+close, then create) instead of 1 atomic transaction due to Solana's transaction size limits

2. **Manual Rebalancing**
   - Pro: User has full control
   - Con: Requires constant monitoring
   - Con: High maintenance burden
   - Con: Users may miss optimal rebalance timing
   - Con: Error-prone manual operations

3. **User Specifies Price Range in BPS**
   - Pro: User has control over range
   - Con: Complex for non-technical users
   - Con: Need to calculate BPS offsets manually
   - Con: Users don't want to do math

4. **Continuous Rebalancing (every block)**
   - Pro: Always optimal range
   - Con: Excessive transaction costs
   - Con: Network spam
   - Con: Diminishing returns

### Rationale

**Two sequential transactions chosen because:**
1. **Transaction Size Limits:** Initial attempt with single atomic transaction failed with "Transaction too large: 1294 > 1232" error
2. **SDK Integration:** Using SDK's built-in transactions (`shouldClaimAndClose=true` and `initializePositionAndAddLiquidityByStrategy`) instead of manual instruction extraction
3. **Reliability:** Each transaction confirmed before proceeding
4. **Cost:** 2 transactions instead of 4 (50% fee savings vs naive 4-tx approach)
5. **Simplicity:** SDK handles compute budget automatically, no manual instruction combining needed

**Simple threshold chosen because:**
1. **User requested:** "just use percentage from balanced position"
2. **Easy to understand:** "Rebalance when >80% SOL or USDC"
3. **No calculations needed:** Set threshold once, bot handles rest

**Auto-calculation chosen because:**
1. **User explicitly requested:** "do not want to calculate BPS"
2. **Reduces errors:** No manual calculation mistakes
3. **Optimal placement:** Always centered at current price
4. **Consistent behavior:** 20 bins gives predictable range width

**20 bins default chosen because:**
1. **Concentrated liquidity:** Tight range = high capital efficiency
2. **Reasonable rebalance frequency:** Not too often, not too rare
3. **Fits Meteora limits:** Well under 70-bin max for most pools

### Consequences

**Positive:**
- **Zero-config pricing:** User sets threshold, bot calculates ranges
- **Cost efficient:** 50% fewer transaction fees (2 txs vs 4 txs)
- **Auto-compounding:** Fees reinvested automatically
- **Reliable:** Each transaction confirmed before proceeding
- **Simple UX:** Just set `AUTO_TUNE_IMBALANCE_THRESHOLD=0.8`
- **SDK Integration:** Uses SDK's built-in transactions directly
- **Maintainable:** SDK handles compute budget automatically

**Negative:**
- **Not fully atomic:** Two separate transactions (TX1 could succeed while TX2 fails)
- **Sequential execution:** Slightly slower than true atomic (2 confirmations vs 1)
- **Jito dependency:** Relies on Jito for MEV protection

**Mitigation:**
- Comprehensive logging of each transaction step
- TX1 confirmed before starting TX2
- Clear error messages indicating which transaction failed
- State saved after successful rebalance
- If TX1 succeeds but TX2 fails, position is closed and funds are in wallet (safe state)

**Implementation Notes:**
- **Transaction 1:** Uses SDK's `removeLiquidity()` with `shouldClaimAndClose=true`
  - SDK automatically handles withdraw → claim → close in correct order
  - Returns array of transactions, we use the first one
- **Transaction 2:** Uses SDK's `initializePositionAndAddLiquidityByStrategy()`
  - Creates new position with Spot strategy
  - Uses claimed fees + original funds
  - Requires both wallet and newPositionKeypair signatures via `partialSign()`
- SDK handles compute budget instructions automatically
- Only add Jito tip instruction after SDK's instructions
- See [src/modules/meteoraAdapter.ts:1043-1324](src/modules/meteoraAdapter.ts#L1043-L1324)

**Configuration:**
```bash
AUTO_TUNE_ENABLED=true                    # Enable auto-tune
AUTO_TUNE_BIN_COUNT=20                    # 20 bins (concentrated)
AUTO_TUNE_CHECK_INTERVAL_MS=30000         # Check every 30s
AUTO_TUNE_IMBALANCE_THRESHOLD=0.8         # Trigger at 80% one-sided
```

**Usage:**
```bash
pnpm auto-tune  # Start automated rebalancing
```

**State Persistence:**
- `data/auto-tune-state.json` tracks:
  - Iteration count
  - Rebalance history
  - Last check/rebalance timestamps
  - Error tracking (stops after 5 consecutive failures)

---

## ADR-013: Audit-Hardening Pass (May 2026)

**Status:** Accepted
**Date:** 2026-05-09
**Context:** Production log surfaced a fund-loss-class bug — the bot asked Jupiter to swap 566.81 USDC with only 9.43 USDC in the wallet, returning `Insufficient funds` from Jupiter that propagated as the unhelpful `"No transaction in order response"`. Subsequent audit found nine related findings: missing pre-flight, drifted code paths, no Phase 1 retry, no Phase 2 balance re-check, unauthenticated mutating API endpoints, wildcard CORS, sub-2-second hard timeouts in `withdrawClaimAndClose`, sampled logs hiding decision context, and a hard-coded `priceImpactPct = undefined` masking real Jupiter-reported impact data. This ADR captures the architectural decisions taken to close all ten.

### Decision

**(1) Extract `planSwapForDeposit()` as a pure helper.** The two formerly-duplicated swap-decision paths (initial-position and rebalance) called identical logic with subtly different guards — one had a missing-USDC check, the other didn't. Extract the decision into `src/modules/swapPlanner.ts`:
- Pure function, no I/O, no logging, no clock.
- Inputs: wallet balances, target deposits, reserves, current price, slippage buffer, context label.
- Outputs: `{ needed, swap?, shortfall, availableSolForSwap }` or throws an `Error` for unfixable cases.
- Three call sites (initial-position pre-flight, rebalance pre-flight, Phase 2 retry pre-flight) all call this single helper.
- Unit-tested: 20 vitest cases in `src/modules/swapPlanner.test.ts` including a regression test for the production bug.

**(2) Total-USD-value pre-flight before any swap planning.** Inside `planSwapForDeposit`, compute `walletValueUsd = (walletSol − totalReserve) × price + walletUsdc` and `requiredValueUsd = targetSol × price + targetUsdc`. If wallet is short on total value, no swap can fix it — throw immediately with a descriptive error mentioning `AUTO_TUNE_DEPOSIT_AMOUNT`. Saves the orchestrator from wasted RPC calls and produces an actionable message instead of an opaque downstream error.

**(3) Phase 1 retry with on-chain race recovery.** `withdrawClaimAndClose` was a single try/catch that re-threw on first failure. Now wrapped in a retry loop (uses `AUTO_TUNE_MAX_RETRIES`); each retry first calls `discoverPositionsFromBlockchain()` and short-circuits with a synthetic success (`{ signature: 'unknown-prior-success', claimedFees: { sol: 0, usdc: 0 } }`) if the position is no longer on-chain — handling the case where the previous attempt's transaction settled despite a local error. Also at the `withdrawClaimAndClose` level: bumped the SDK build timeout 30s → 90s (was too aggressive for slow RPCs) and added a defensive on-chain re-check in the catch block via a new private `isPositionStillOnChain()` helper (read-only, no state mutation, distinct from `discoverPositionsFromBlockchain` which writes state).

**(4) Phase 2 retry with balance re-check.** Each retry attempt in the position-creation loop re-fetches actual SOL/USDC, re-runs `planSwapForDeposit()` with stable targets but fresh balances, and executes another swap if a new shortfall appeared. Fixes the case where a failed first attempt paid network fees and shifted the wallet enough to need topping up.

**(5) Hono API: fail-closed by default.** Replaced wildcard CORS with origin allowlist (`API_ALLOWED_ORIGINS`). Added API-key auth (`API_KEY`) on all POST routes with constant-time compare. **When `API_KEY` is unset, POST endpoints return 503** — POSTs are non-functional on a default-configured server. Added per-IP rate limit (`API_RATE_LIMIT_PER_MIN`, default 10, fixed-window). Added body validation with type, range, and sanity-ceiling checks (e.g. `solAmount ≤ 1000`, `priceLower < priceUpper`). The principle: a misconfigured server should be useless, not dangerous.

**(6) Real `priceImpactPct` propagation + high-impact warning.** Removed the stale `priceImpactPct: undefined` placeholder from `JupiterSwapper.executeSwap`. Added module-level `parsePriceImpactPctFromOrder()` that reads the field from Jupiter's order response, normalizes string-or-number to a positive percentage. New private `logSwapOutcome()` helper in the orchestrator compares against `SWAP_HIGH_IMPACT_WARNING_PCT` (default 1.0) and emits an `errorBanner` when exceeded, with bufferExceeded flag and recommended action.

**(7) Bumped `SWAP_SLIPPAGE_BUFFER_PCT` default 0.5 → 3.0.** Under volatile conditions or thin liquidity, 0.5% wasn't enough headroom; output fell short of target and burned Phase 2 retries. 3% is conservative for SOL/USDC; surplus output is absorbed by the next position rather than lost.

**(8) Promoted silent-scaling log to `errorBanner`.** When desired position exceeds wallet value and the orchestrator proportionally scales down, the operator now gets a loud red-banner log with the scale percentage, recommended `AUTO_TUNE_DEPOSIT_AMOUNT`, and an explicit `consequence` field noting the deviation will recur every cycle until config or wallet is fixed.

**(9) Promoted `'Position balance checked'` log out of sampling.** The composition + price + range data is the precondition for every rebalance trigger decision. With `LOG_SAMPLE_RATE=10` in GCP, the precondition state on iteration 46 was lost 90% of the time — exactly when iteration 47 needed it for failure analysis. Now always logged.

### Alternatives Considered

- **Add the missing-USDC guard inline at both call sites (no extraction).** Rejected: the two paths drifted in the first place because they were duplicated. Inline-guarding fixes the symptom without addressing the structural cause; the next subtle modification would re-introduce drift.
- **Use zod for body validation in the API.** Rejected for this surface: two endpoints with simple shapes don't justify a new dependency. Hand-rolled validators with a `ValidationError` class are easy to read and stay close to the route handlers.
- **Make `API_KEY` fail-open with a loud warning when unset.** Rejected: fail-closed is the safer default for a fund-affecting surface. Operators who want auth disabled (e.g. for internal-only deployments) can short-circuit the middleware in code, but it shouldn't be the default behaviour.
- **Adaptive slippage buffer based on observed impact.** Considered for ADR-013 but deferred: adds state and complexity for marginal benefit. The high-impact warning gives operators the signal to manually tune.
- **Remove the `withdrawClaimAndClose` build timeout entirely.** Rejected: a 90s ceiling is still useful as a defense against SDK bugs that infinite-loop. The on-chain re-check in the catch block handles the on-chain-success-with-local-failure race in any case.

### Consequences

**Positive:**
- The original production bug class is structurally locked out — there's no longer two paths that *could* drift; there's one helper. Regression tests pin the behaviour.
- The bot is now defensible against a misconfigured deployment moving funds via the API.
- Phase 1 and Phase 2 both have on-chain race recovery, so "transaction settled but local code thought it failed" no longer cascades into double-attempt failures or orphaned positions.
- Operators get loud, actionable feedback (errorBanner + consequence + recommendedAction) when their config doesn't fit their wallet, instead of silent degradation.
- Real Jupiter price-impact data is now visible in logs; operators can notice pool liquidity thinning before it manifests as Phase 2 retries.

**Negative / cost:**
- More log volume in production GCP (~+9 lines per check cycle from de-sampling the position-balance log; ~3.7 MB/day at typical line size, well under free-tier ingestion).
- Slightly higher swap-input amounts (3% buffer vs 0.5%) leave more surplus of one token in the wallet on average. Not lost — absorbed by the next position. Operators on liquid pools can tune down.
- `withdrawClaimAndClose` is allowed up to 90s instead of 30s before timing out. Operators on slow RPCs see fewer false failures; operators on healthy RPCs are unaffected (the timeout almost never fires).
- New env vars to remember: `API_KEY`, `API_ALLOWED_ORIGINS`, `API_RATE_LIMIT_PER_MIN`, `SWAP_HIGH_IMPACT_WARNING_PCT`. All optional with sensible defaults except `API_KEY` (which is intentionally required for POSTs to work).

### References

- `src/modules/swapPlanner.ts` — pure helper, ~230 lines
- `src/modules/swapPlanner.test.ts` — 20 vitest unit tests
- `src/modules/autoTuneOrchestrator.ts` — three call sites, Phase 1/Phase 2 retry pre-flights, `logSwapOutcome` helper
- `src/modules/meteoraAdapter.ts` — `withdrawClaimAndClose` retry semantics, `isPositionStillOnChain` helper
- `src/modules/jupiterSwapper.ts` — `parsePriceImpactPctFromOrder`
- `src/api/hono-server.ts` — auth, CORS, rate-limit, validation
- `src/config/env.ts` — new config fields
- `progress.md` Session 9 — work log
- `SMOKE_TESTS.md` — procedural runbook

---

## ADR-014: Drift Hedge Engine via @drift-labs/sdk (not Solana Agent Kit)

**Date:** 2026-06-26
**Status:** Proposed
**Deciders:** Operator
**Related:** Epic M, ADR-001 (superseded), ADR-002 (band rebalancing)

### Context

The bot is described as "delta-neutral" but currently runs **LP-only with full
directional SOL exposure** — the Drift hedge engine was never implemented. To
actually neutralise ΔSOL we need a perpetuals execution layer on Drift that:

- opens/maintains a **SOL-PERP short** sized to the LP's SOL exposure,
- reads position size, funding rate, margin/health, and liquidation price,
- deposits/withdraws collateral, and
- supports an emergency unwind.

Two candidate execution layers were evaluated:

1. **SendAI Solana Agent Kit v2** (`@solana-agent-kit/plugin-defi`) — exposes
   Drift methods (`openPerpTradeLong`/`closePerpTradeLong`,
   `tradeUsingDriftPerpAccount`, collateral deposit/withdraw). It is an
   AI-agent / LLM-tool-calling abstraction built **on top of** `@drift-labs/sdk`.
2. **Official `@drift-labs/sdk` (protocol-v2)** directly — `DriftClient` + `User`
   give the full surface: long/short perp orders, settle funding, collateral
   deposit/withdraw, `getPerpPosition`, `getPerpMarketAccount`, funding records,
   margin/health/liquidation via the subscribed `User` account, sub-accounts.

### Decision

Build a dedicated **`DriftEngine`** module on the official **`@drift-labs/sdk`**,
pinned to the **`stable`** dist-tag (`2.156.0` at time of writing) — **not** the
Agent Kit, and **not** the `latest`/beta line.

### Rationale

- **The hard part is the controller and the read side, not order placement.**
  A delta-neutral hedge continuously reads position size, funding, margin, and
  liquidation price. The Drift SDK's subscribed `User`/`DriftClient` expose all
  of it (no RPC per read); the Agent Kit is built around *firing* trades and is
  thinnest exactly where we need depth.
- **Re-adopting the kit reverses a deliberate decision.** ADR-001 adopted
  `solana-agent-kit` (chiefly for Jito bundling), then it was removed in favour
  of "direct SDK, no wrapper libraries." `@drift-labs/sdk` matches that
  philosophy (cf. direct `@meteora-ag/dlmm` and `@solana/web3.js` usage).
- **Dependency surface.** The kit pulls a large transitive tree (LangChain
  adapters + many unrelated protocol plugins) for one protocol we need. The SDK
  is one focused dependency.
- **The kit lags upstream** — new Drift perp features arrive only once the kit
  re-exposes them.

### Dependency-compatibility check (performed 2026-06-26)

- Tree already runs three anchor versions side-by-side via nested isolation:
  `0.32.1` (top), `0.31.0` (Meteora), `0.29.0` (Pyth). Drift `stable` wants
  **anchor `0.29.0`**, which is already present nested — **no new conflict.**
- Drift is on **web3.js 1.x**; project is on `1.98.4` (same major) — compatible.
- `bn.js` 5.x on both sides — compatible.
- **Avoid `latest` (`2.163.0-beta.x`)**: it aliases anchor to
  `@anchor-lang/core` — unacceptable churn for a fund-handling bot. Pin `stable`.
- **Lockfile hazard:** repo carries `package-lock.json`, `pnpm-lock.yaml`, and
  `bun.lock`; the Dockerfile installs with `bun install`, so the dep must land
  in `bun.lock`. The three-lockfile split should be resolved separately.

### Alternatives Considered

1. **Solana Agent Kit `plugin-defi`** — rejected: wrapper tax, dependency bloat,
   thinner read surface, reverses ADR-001's removal, lags upstream.
2. **Hand-rolled instruction builder from the Drift IDL** — rejected: large
   surface, high correctness risk on a fund path, no upside over the official SDK.
3. **Keep LP-only / no hedge** — rejected: contradicts the product's stated
   delta-neutral goal; leaves full directional SOL exposure.

### Consequences

**Positive:** complete, maintained perp surface; fits the direct-SDK philosophy;
single focused dependency; full read side for the controller and risk guards.

**Negative / risks:**
- Drift's default account model uses **websocket subscriptions** — heavier on a
  free-tier RPC. **Mitigation:** configure the client for **polling** mode.
- Drift SDK pins **anchor 0.29.0** (older than top-level `0.32.1`); relies on
  nested isolation holding under `bun install`. **Mitigation:** verify the
  built image actually resolves Drift's nested anchor before mainnet.
- New risk config must be wired into `env.ts`/`BotConfig`
  (`DELTA_THRESHOLD_SOL`, `MIN_COLLATERAL_RATIO`, `MAX_SHORT_NOTIONAL_USD`,
  `FUNDING_RATE_CAP_BPS`, `DRIFT_MARKET_SOL_PERP`, collateral sizing).

### Implementation plan (subsequent commits)

1. `src/modules/driftEngine.ts` — interface skeleton (this ADR's companion).
2. Wire Drift/risk config into `BotConfig` + `.env.example`.
3. `pnpm add @drift-labs/sdk@stable`; verify nested anchor in the bun image.
4. Implement read side (`getHedgeState`) first; smoke-test on mainnet read-only.
5. Implement `rebalanceHedge` with band logic (ADR-002) + risk guards.
6. Implement `emergencyUnwind`; integration-test before any funded run.

---

## ADR-015: Pivot Hedge Venue from Drift to Jupiter Perpetuals

**Date:** 2026-06-28
**Status:** Accepted
**Deciders:** Operator
**Related:** ADR-014 (superseded as the active venue), Epic M

### Context

While implementing the Drift hedge (ADR-014, pinned `@drift-labs/sdk@stable` =
2.156.0), dry-run smoke tests of account creation failed: the live mainnet
Drift program (`dRiftyHA39MWEi3m9aunc5MzRF1JYuBsbn6VPcn33UH`) rejected the SDK's
`initialize_user` / `initialize_user_stats` instructions with
`InstructionFallbackNotFound (Custom 101)`. Systematic diagnosis ruled out SDK
version (stable and latest IDLs ship identical canonical discriminators),
dual-web3 identity, simulation mechanics (v0/legacy, signed/unsigned), RPC
provider (Helius **and** public mainnet reject identically), program migration
(`vELoC…` address in the latest beta IDL does not exist on mainnet), and
fork/non-mainnet (genesis confirmed mainnet).

**Root cause (external):** Drift suffered a **~$285M exploit on 2026-04-01** and
is in a full reboot. The frontend is down ("Drift will be back soon"), the
deployed program is frozen/transitional, and the relaunch **changes the
settlement asset from USDC to USDT** (Tether's $148M facility). Our pinned SDK
targets the now-dead program. **dry-run + smoke-testing prevented sending funds
to an exploited, frozen protocol.**

### Decision

Pivot the hedge to **Jupiter Perpetuals** (`PERPHjGBqRHArX4DySjwM6UJHiR3sWAatqfdBS2qQJu`):
- live, ~80% of Solana perps volume, oracle-priced (no orderbook slippage),
- **SOL short collateralised in USDC** (matches the LP/swap USDC flow),
- integrated by **parsing the program's Anchor IDL** (no official TS SDK).

Keep the engine **venue-agnostic** behind a new `HedgeEngine` interface
(`src/modules/hedgeEngine.ts`) so a Drift backend can return if/when it
relaunches. The Drift code is retained but inert.

### Alternatives Considered

- **Wait for Drift relaunch** — rejected: timing is uncertain (tentative
  May/June 2026), it's post-exploit, and the USDC→USDT change would require
  rework anyway. Operator chose to pivot to a live venue.
- **Zeta/Bullet** — CLOB with funding (potentially cheaper carry) but mid
  rebrand to ZK/Bullet and thinner liquidity.
- **Adrena** — pool-based like Jupiter but smaller/less battle-tested.
- **Upgrade Drift SDK to `latest` beta** — rejected: same discriminators, would
  not fix it, and the beta IDL targets a non-existent mainnet program.

### Consequences

**Positive:** live, deep, reliable venue; USDC collateral; oracle pricing;
single focused IDL dependency; venue-agnostic interface validated end-to-end
(read side + dashboard) with no funds touched.

**Negative / risks:**
- **Carry is a cost, not income.** Jupiter charges a utilization-based **borrow
  fee** (no funding income). Jump curve: 10% APR @ 0% util → 35% @ 80% → 150% @
  100%. Currently ≈ 11.8% APR. Sign convention in code: `carryRateBps` negative
  = the short pays. Break-even ≈ `LP_fee_APR > carry_APR / 2` (hedge covers only
  the SOL half of the LP). Utilization spikes are the key economic risk.
- **No official TS SDK** — we parse the IDL directly. The IDL is the old
  (anchor 0.29) format, so an isolated `jup-anchor` alias (= `@coral-xyz/anchor@0.29`)
  is used only in `src/utils/jupiterPerps.ts`.
- **2-transaction request/keeper execution model** for opens/closes (more async
  handling than a direct send).

### Implementation status (2026-06-28)

- Done & validated (read-only, live mainnet): `HedgeEngine` interface,
  `JupiterPerpsEngine.getHedgeState`/`computeDelta`, `jupiterPerps.ts` (loader +
  borrow-rate math), vendored IDL, dashboard on Jupiter, `pnpm jupiter:read`.
- Not started: write side (open/adjust/close short via `positionRequest`,
  dry-run gated), `rebalanceHedge` controller, liquidation-price computation.
- See `HANDOVER.md` for the full resume guide.

### References

- `src/utils/jupiterPerps.ts`, `src/modules/jupiterPerpsEngine.ts`,
  `src/modules/hedgeEngine.ts`, `src/idl/jupiter-perps-idl.json`
- Reference repo: `julianfssen/jupiter-perps-anchor-idl-parsing`
- `bugs.md` BUG-003 (Drift down), BUG-004 (Meteora pool 404)
- `progress.md` 2026-06-28 session

---

## Decision Index

- ADR-001: Use solana-agent-kit for Transaction Execution *(superseded — direct @solana/web3.js)*
- ADR-002: Band Rebalancing Over Continuous Hedging
- ADR-003: JSON-based State Persistence
- ADR-004: Emergency Flow Execution Strategy
- ADR-005: Automatic Meteora Position Creation
- ADR-006: DLMM SDK ESM/CommonJS Interop Strategy
- ADR-007: Jupiter API v6 Upgrade
- ADR-008: Meteora Pool Analytics Caching Strategy (2.5s TTL)
- ADR-009: Documentation Standards
- ADR-010: Dynamic Jito Tipping with 5-Second Cache *(superseded — Jito bundling removed)*
- ADR-011: Jupiter Lite API v3 Migration
- ADR-012: Auto-Tune Two-Step Rebalancing Strategy
- ADR-013: Audit-Hardening Pass (May 2026)
- ADR-014: Drift Hedge Engine via @drift-labs/sdk *(superseded as active venue by ADR-015 — Drift down post-exploit)*
- ADR-015: Pivot Hedge Venue from Drift to Jupiter Perpetuals — new (Accepted)

---

## Decision Status

- **Accepted:** 12 (incl. ADR-015 — Jupiter Perps pivot)
- **Superseded:** 3 (ADR-001 by direct web3.js, ADR-010 by removal of Jito, ADR-014 as active venue by ADR-015)
- **Proposed:** 0
- **Deprecated:** 0
