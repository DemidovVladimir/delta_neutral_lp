# Documentation Guide

Complete guide to the delta-neutral liquidity provision bot documentation.

---

## 📚 Documentation Structure

### Core Documentation Files

| File | Purpose | Audience |
|------|---------|----------|
| [README.md](README.md) | Project overview, quick start, usage guide | New users, developers |
| [CLAUDE.md](CLAUDE.md) | AI assistant instructions, architecture reference | Claude Code, AI agents |
| [agent-kit-mvp-prd.md](agent-kit-mvp-prd.md) | Product requirements, technical specs | Developers, architects |
| [INTEGRATION_SUMMARY.md](INTEGRATION_SUMMARY.md) | Recent improvements from meteora-lp-army-bot | Developers tracking changes |
| [SECURITY_CHECKLIST.md](SECURITY_CHECKLIST.md) | Security best practices, pre-deployment checks | DevOps, security auditors |
| [DOCUMENTATION_GUIDE.md](DOCUMENTATION_GUIDE.md) | This file - documentation navigation | All users |

### Development Documentation

| File | Purpose | Content |
|------|---------|---------|
| [progress.md](progress.md) | Development progress tracking | Epic status, milestones |
| [bugs.md](bugs.md) | Known issues and bug reports | Open bugs, resolutions |
| [decisions.md](decisions.md) | Architectural decision records | ADRs, design rationale |
| [epics.md](epics.md) | Epic breakdown (K-P) | Task lists, acceptance criteria |

---

## 🗂️ Code Documentation

### Module Documentation (Inline JSDoc)

All TypeScript modules include comprehensive file-level and function-level docstrings:

#### Core Modules

**[src/modules/meteoraAdapter.ts](src/modules/meteoraAdapter.ts)**
- Meteora DLMM integration
- Auto-position creation
- LP exposure tracking
- Pool analytics with caching
- Position composition calculations

**[src/core/priceOracle.ts](src/core/priceOracle.ts)**
- Jupiter API v6 integration
- Multi-token price fetching
- Pyth oracle fallback
- Price caching with TTL
- Direct SOL/USDC exchange rates

**[src/modules/persistence.ts](src/modules/persistence.ts)**
- State snapshot management
- Action journal (JSONL format)
- Position NFT tracking
- Data persistence in `data/` directory

#### Utility Modules

**[src/utils/meteoraUtils.ts](src/utils/meteoraUtils.ts)**
- Bin price calculations using Decimal.js
- Active bin fetching
- Token percentage composition
- Meteora API client

**[src/utils/jitoUtils.ts](src/utils/jitoUtils.ts)**
- Jito tip instruction creation
- Dynamic tip escalation (4k→6k→8k lamports)
- Bundle submission helpers
- MEV protection utilities

**[src/core/agentKit.ts](src/core/agentKit.ts)**
- Solana Agent Kit initialization
- Wallet keypair management
- Connection management

#### Configuration

**[src/config/constants.ts](src/config/constants.ts)**
- Transaction retry configuration
- RPC settings (`skipPreflight` documentation)
- Price oracle config
- Slippage tolerances
- Meteora DLMM limits
- Program IDs

**[src/config/env.ts](src/config/env.ts)**
- Environment variable loading
- Configuration validation
- Type-safe config object

#### Type Definitions

**[src/types/index.ts](src/types/index.ts)**
- Core types (Price, TokenPrice, TokenAmount)
- Meteora LP types (LpExposure, PositionDetail, MeteoraPairInfo)
- Transaction types (CreatePositionParams, DepositParams, etc.)
- Comprehensive type documentation with examples

---

## 📖 Documentation Standards

### File-Level Docstrings

Every module should have a comprehensive file-level docstring:

```typescript
/**
 * Module Name
 *
 * Brief description of what this module does.
 *
 * Key Features:
 * - **Feature 1**: Description
 * - **Feature 2**: Description
 *
 * Implementation Details:
 * - Detail 1
 * - Detail 2
 *
 * @example
 * ```typescript
 * // Usage example
 * const result = await someFunction();
 * ```
 */
```

### Function-Level Docstrings

All public functions should have JSDoc comments:

```typescript
/**
 * Function description
 *
 * Detailed explanation of what the function does, edge cases, etc.
 *
 * @param paramName - Parameter description
 * @param optionalParam - Optional parameter description (optional)
 * @returns Return value description
 * @throws Error description if applicable
 *
 * @example
 * ```typescript
 * const result = myFunction('value', 123);
 * ```
 */
export function myFunction(paramName: string, optionalParam?: number): ReturnType {
  // Implementation
}
```

### Configuration Constants

All configuration constants should have inline comments explaining:
- What the value controls
- Why this specific value was chosen
- Trade-offs of different values
- Examples or formulas if applicable

Example:
```typescript
export const RPC_CONFIG = {
  /**
   * Skip transaction simulation before submission
   *
   * WARNING: Setting to `true` means transactions are submitted without
   * validation, which can result in failed transactions and wasted SOL.
   */
  skipPreflight: false,
} as const;
```

---

## 🎯 Implementation Status

### ✅ Fully Implemented & Documented

1. **MeteoraAdapter** - Complete DLMM integration
   - Auto-create positions with price range validation
   - Read LP exposure from position NFTs
   - Pool analytics with 2.5s caching
   - Position composition calculations
   - Deposit/withdrawal operations
   - Fee claiming

2. **PriceOracle** - Multi-source price fetching
   - Jupiter API v6 with multi-token support
   - Direct SOL/USDC exchange rates
   - Pyth oracle fallback
   - Price caching with TTL

3. **Utilities** - Helper functions
   - Meteora bin calculations (meteoraUtils)
   - Jito tip escalation (jitoUtils)
   - Agent kit initialization

4. **Configuration** - Centralized settings
   - Constants with comprehensive docs
   - Environment variable handling
   - Type-safe config

### 🔜 Planned (Not Yet Implemented)

1. **DriftEngine** - Perpetual short positions
2. **Bundler** - Jito bundle submission
3. **RiskController** - Delta thresholds, margin limits
4. **Orchestrator** - Main hedge loop
5. **CLI Commands** - User-facing commands

See [CLAUDE.md](CLAUDE.md) for detailed implementation status.

---

## 🔍 Finding Documentation

### By Topic

**Getting Started**
- [README.md](README.md) - Quick start guide
- [.env.example](.env.example) - Configuration template

**Architecture & Design**
- [CLAUDE.md](CLAUDE.md) - System architecture
- [agent-kit-mvp-prd.md](agent-kit-mvp-prd.md) - Detailed specs
- [decisions.md](decisions.md) - Design decisions

**API Reference**
- [src/types/index.ts](src/types/index.ts) - Type definitions
- Individual module files - JSDoc comments

**Development**
- [progress.md](progress.md) - Current status
- [bugs.md](bugs.md) - Known issues
- [epics.md](epics.md) - Task breakdown

**Security**
- [SECURITY_CHECKLIST.md](SECURITY_CHECKLIST.md) - Security guidelines
- [.gitignore](.gitignore) - Excluded files

**Testing**
- [src/test/integration-test.ts](src/test/integration-test.ts) - Integration tests
- [src/test/mainnet-meteora-test.ts](src/test/mainnet-meteora-test.ts) - Mainnet tests
- [src/test/local-meteora-test.ts](src/test/local-meteora-test.ts) - Localnet tests

### By File Type

**Markdown Documentation**
```
├── README.md                    # Project overview
├── CLAUDE.md                    # AI assistant guide
├── DOCUMENTATION_GUIDE.md       # This file
├── INTEGRATION_SUMMARY.md       # Recent improvements
├── SECURITY_CHECKLIST.md        # Security practices
├── agent-kit-mvp-prd.md        # Product requirements
├── progress.md                  # Development progress
├── bugs.md                      # Issue tracking
├── decisions.md                 # Architecture decisions
└── epics.md                     # Epic breakdown
```

**Code Documentation (JSDoc)**
```
src/
├── modules/
│   ├── meteoraAdapter.ts        # Meteora DLMM integration
│   └── persistence.ts           # State management
├── core/
│   ├── priceOracle.ts          # Price fetching
│   └── agentKit.ts             # Agent kit setup
├── utils/
│   ├── meteoraUtils.ts         # Meteora utilities
│   ├── jitoUtils.ts            # Jito utilities
│   └── logger.ts               # Logging
├── config/
│   ├── constants.ts            # Configuration constants
│   └── env.ts                  # Environment config
└── types/
    └── index.ts                # Type definitions
```

---

## 📝 Documentation Maintenance

### When Adding New Code

1. **Add file-level docstring** with overview and examples
2. **Document all public functions** with JSDoc
3. **Update type definitions** if adding new interfaces
4. **Update CLAUDE.md** if changing architecture
5. **Update progress.md** to reflect completion
6. **Add integration tests** and document test coverage

### When Fixing Bugs

1. **Document the fix** in bugs.md
2. **Add code comments** explaining non-obvious fixes
3. **Update tests** to prevent regression
4. **Update relevant docs** if behavior changed

### When Making Architectural Decisions

1. **Add entry to decisions.md** with ADR format:
   - Context
   - Decision
   - Consequences
   - Alternatives considered

---

## 🚀 Best Practices

### Code Comments

**DO:**
- Explain "why", not "what" (code shows what)
- Document edge cases and assumptions
- Explain complex algorithms or formulas
- Warn about potential pitfalls

**DON'T:**
- State the obvious (`i++; // increment i`)
- Leave commented-out code
- Use comments instead of better variable names
- Write essays - be concise

### Documentation Updates

**Keep docs in sync with code:**
- Update docs in the same commit as code changes
- Run tests after doc updates to catch broken examples
- Review docs in PRs alongside code
- Use TypeScript types as documentation when possible

### Examples

**Always include examples for:**
- New public APIs
- Complex configurations
- Non-obvious usage patterns
- Common use cases

---

## 📞 Getting Help

**Documentation Issues:**
- Check this guide first
- Search existing docs for keywords
- File issue on GitHub if docs are unclear

**Code Questions:**
- Check inline JSDoc comments
- Review test files for usage examples
- Consult [agent-kit-mvp-prd.md](agent-kit-mvp-prd.md) for specs

**Implementation Status:**
- Check [CLAUDE.md](CLAUDE.md) for current status
- Review [progress.md](progress.md) for completion tracking
- See [epics.md](epics.md) for planned features

---

**Last Updated**: 2025-10-27
**Version**: 1.0.0
**Maintained By**: Development team
