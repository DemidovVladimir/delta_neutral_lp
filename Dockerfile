# Dockerfile for the Delta-Neutral LP Bot (LP auto-tune + Jupiter Perps hedge)
#
# node:22-slim + pnpm + tsx — the exact runtime the bot uses in local dev.
# Why not Bun (the previous base): Bun advertises Node 24's ABI to native
# addons, and better-sqlite3 ships no prebuilt binary for it — every image
# build recompiled the whole SQLite amalgamation via node-gyp (15+ silent
# minutes; worse on a small Hetzner vCPU). Under Node 22 the prebuild
# downloads in seconds and the compiler toolchain stays out of the image.

FROM node:22-slim

WORKDIR /app

# Runtime deps:
#  • dumb-init — proper signal handling (PID 1)
#  • git       — needed at runtime by getStrategyVersion() so each container
#    can self-detect its commit hash if STRATEGY_VERSION is not injected via
#    env (defence in depth — deploy/hetzner/deploy.sh normally injects it).
RUN apt-get update && apt-get install -y --no-install-recommends dumb-init git \
  && rm -rf /var/lib/apt/lists/* \
  && npm install -g pnpm@10

# Copy package files (pnpm-lock.yaml is the source of truth for the image).
COPY package.json pnpm-lock.yaml ./

# Full install (tsx lives in devDependencies and IS the runtime here).
# better-sqlite3's postinstall downloads its prebuilt glibc binary (no compile).
RUN pnpm install --frozen-lockfile

# Copy source code
COPY src ./src
COPY tsconfig.json ./

# Create data directory for state persistence (state.json, auto-tune-state.json,
# and pnl.db all land here; the host-mounted volume preserves them across
# container restarts) and hand the tree to the unprivileged user.
RUN mkdir -p /app/data && chown -R node:node /app

# Switch to non-root user (node:22-slim ships a `node` user)
USER node

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Default command: run TypeScript directly with tsx
CMD ["./node_modules/.bin/tsx", "src/cli/auto-tune.ts"]
