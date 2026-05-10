# Simplified Dockerfile for Delta-Neutral LP Bot Auto-Tune
# Uses Bun to run TypeScript directly (no build step needed)

FROM oven/bun:1.3.1-alpine

WORKDIR /app

# Install runtime + build deps:
#  • dumb-init       — proper signal handling
#  • python3 / make / g++ — required for the rare case where better-sqlite3
#    has no prebuild matching this image (musl libc + node-abi). Without
#    these the `prebuild-install || node-gyp rebuild` fallback in
#    better-sqlite3's install script aborts the whole image build.
#  • git             — needed at runtime by getStrategyVersion() so each
#    container can self-detect its commit hash if STRATEGY_VERSION is
#    not injected via env (defence in depth — Pulumi normally injects it).
RUN apk add --no-cache dumb-init python3 make g++ git

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Copy package files
COPY --chown=nodejs:nodejs package.json bun.lock ./

# Install all dependencies. better-sqlite3 will run its `prebuild-install
# || node-gyp rebuild` postinstall here — the build deps above ensure the
# rebuild path can succeed if no prebuild matches.
RUN bun install

# Copy source code
COPY --chown=nodejs:nodejs src ./src
COPY --chown=nodejs:nodejs tsconfig.json ./

# Create data directory for state persistence (state.json, auto-tune-state.json,
# and pnl.db all land here; the host-mounted volume preserves them across
# container restarts).
RUN mkdir -p /app/data && chown nodejs:nodejs /app/data

# Switch to non-root user
USER nodejs

# Expose port for health checks (optional)
EXPOSE 3001

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Default command: run TypeScript directly with Bun
CMD ["bun", "run", "src/cli/auto-tune.ts"]
