# Simplified Dockerfile for Delta-Neutral LP Bot Auto-Tune
# Uses Bun to run TypeScript directly (no build step needed)

FROM oven/bun:1.3.1-alpine

WORKDIR /app

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Copy package files
COPY --chown=nodejs:nodejs package.json bun.lock ./

# Install production dependencies only
RUN bun install --frozen-lockfile --production

# Copy source code
COPY --chown=nodejs:nodejs src ./src
COPY --chown=nodejs:nodejs tsconfig.json ./

# Create data directory for state persistence
RUN mkdir -p /app/data && chown nodejs:nodejs /app/data

# Switch to non-root user
USER nodejs

# Expose port for health checks (optional)
EXPOSE 3001

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Default command: run TypeScript directly with Bun
CMD ["bun", "run", "src/scripts/auto-tune.ts"]
