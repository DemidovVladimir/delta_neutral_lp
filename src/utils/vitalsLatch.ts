/**
 * Latched vitals — «двойной порог» (operator-approved 2026-07-07).
 *
 * A vitals rule with a single line flaps when its metric breathes on the
 * boundary: the Jul-7 night had churn frozen at $441.83 while the
 * auto-derived 3×cap breathed around $441.8 — two phone pushes, zero new
 * information. The fix is a latch with a real gap between the FIRE level
 * and the RELEASE level (~10%):
 *
 *   not latched + `breached`  → fire ONCE (🚨 line), latch;
 *   latched     + `cleared`   → release (✅ line), un-latch;
 *   anything else             → silence.
 *
 * `cleared` must NOT be `!breached` — the caller supplies a release
 * condition strictly easier than the fire condition (churn < 2.7×cap for
 * a 3×cap fire, etc.), so boundary breathing lands inside the gap and
 * stays quiet. A per-kind throttle remains as a backstop against
 * pathological full-gap flip-flopping.
 *
 * Pure state machine with an injectable clock — the logging side effects
 * stay with the caller.
 */

export type VitalsEvent = 'fire' | 'recover' | null;

export class VitalsLatch {
  private latched: Record<string, boolean> = {};
  private lastFireAt: Record<string, number> = {};

  constructor(
    private readonly throttleMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * Feed one observation for `kind`. Returns 'fire' when the caller must
   * log the 🚨 line, 'recover' for the ✅ line, null for silence.
   */
  update(kind: string, breached: boolean, cleared: boolean): VitalsEvent {
    const isLatched = this.latched[kind] ?? false;
    if (!isLatched && breached) {
      const lastFire = this.lastFireAt[kind];
      if (lastFire !== undefined && this.now() - lastFire < this.throttleMs) return null;
      this.lastFireAt[kind] = this.now();
      this.latched[kind] = true;
      return 'fire';
    }
    if (isLatched && cleared) {
      this.latched[kind] = false;
      return 'recover';
    }
    return null;
  }

  isLatched(kind: string): boolean {
    return this.latched[kind] ?? false;
  }
}
