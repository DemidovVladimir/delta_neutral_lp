/**
 * Strategy Version Detector
 *
 * Every Jupiter/Meteora-touching action — position open, withdraw+claim+close,
 * swap, rebalance — gets stamped with a strategy_version. The version is the
 * git short hash detected at process startup, plus a "dirty" flag if the
 * working tree had uncommitted changes when the bot booted.
 *
 * Why git hash:
 *   • The user wants to roll back to a previous strategy by checking out a
 *     commit; the DB rows then group cleanly by which version produced them.
 *   • No manual bump step the operator can forget.
 *   • Works the same locally and in the GCP Docker image (the deploy includes
 *     the .git directory by default; if it doesn't, we fall back to a
 *     STRATEGY_VERSION env var that the deploy can inject).
 *
 * The detected value is cached on first call — we don't want to fork `git`
 * once per database row.
 */
import { execSync } from 'child_process';

export interface StrategyVersion {
  /** Git short hash (e.g. "a3f9c12") or fallback "unknown" / env-provided value. */
  gitHash: string;
  /** True when the working tree had uncommitted changes at boot — the row's lineage is not exactly any commit. */
  isDirty: boolean;
  /** Optional human-readable label from STRATEGY_LABEL env var. Useful for tagging experiments ("swap-buffer-3pct"). */
  label?: string;
  /** ISO timestamp this version was first detected in the current process. */
  detectedAt: string;
}

let cached: StrategyVersion | null = null;

/**
 * Detect and cache the strategy version. Subsequent calls are free.
 *
 * Resolution order:
 *   1. STRATEGY_VERSION env var (if set, used verbatim — escape hatch for
 *      Docker images that strip .git)
 *   2. `git rev-parse --short HEAD` + `git status --porcelain` (normal path)
 *   3. "unknown" (last-resort fallback so the DB always has *something* to
 *      stamp — better than crashing the bot)
 */
export function getStrategyVersion(): StrategyVersion {
  if (cached) return cached;

  const label = process.env.STRATEGY_LABEL?.trim() || undefined;
  const envOverride = process.env.STRATEGY_VERSION?.trim();
  const detectedAt = new Date().toISOString();

  if (envOverride) {
    cached = { gitHash: envOverride, isDirty: false, label, detectedAt };
    return cached;
  }

  try {
    const gitHash = execSync('git rev-parse --short HEAD', {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();

    let isDirty = false;
    try {
      const status = execSync('git status --porcelain', {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      isDirty = status.length > 0;
    } catch {
      // Treat status-failure as clean rather than crashing — git rev-parse
      // already worked, so the repo is real; status can fail on weird FS
      // states (e.g. Docker-mounted .git with permission quirks).
      isDirty = false;
    }

    cached = { gitHash, isDirty, label, detectedAt };
    return cached;
  } catch {
    // No git available (e.g. trimmed Docker image) and no env override —
    // fall back so we don't crash startup. Operators see "unknown" in the
    // DB, which is a clear signal to set STRATEGY_VERSION via env.
    cached = { gitHash: 'unknown', isDirty: false, label, detectedAt };
    return cached;
  }
}

/** Test-only: reset the cache so unit tests can simulate fresh starts. */
export function _resetStrategyVersionCacheForTests(): void {
  cached = null;
}
