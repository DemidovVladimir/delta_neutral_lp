import { describe, it, expect, vi, beforeEach } from 'vitest';

// The empty-discovery throttle (ADR-026 entry-wait keeps the position list
// empty for hours; re-scanning getProgramAccounts every 15s cycle is pure
// RPC burn — BUG-014 class). Semantics under test:
//   - clean "no positions on chain" arms the throttle; ensurePositionsLoaded
//     skips re-scans for EMPTY_DISCOVERY_THROTTLE_MS
//   - an RPC ERROR does NOT arm it (retry next cycle, self-heal unchanged)
//   - a successful discovery resets it
//   - direct discoverPositionsFromBlockchain() calls always bypass it

const mockGetPositions = vi.fn();

vi.mock('../utils/dlmm.js', () => ({
  DLMM: {
    create: vi.fn(async () => ({ getPositionsByUserAndLbPair: mockGetPositions })),
  },
  StrategyType: { SpotBalanced: 0 },
}));

vi.mock('../utils/solana.js', () => ({
  getConnection: () => ({}),
  getWalletKeypair: () => ({ publicKey: { toBase58: () => 'wallet' } }),
}));

vi.mock('../config/env.js', () => ({
  getConfig: () => ({
    autoCreatePositions: true,
    autoTuneEnabled: true,
    meteoraPoolAddress: '11111111111111111111111111111111',
  }),
}));

vi.mock('./persistence.js', () => ({
  loadCreatedPositionMints: () => [],
  saveCreatedPositionMints: vi.fn(),
}));

import { MeteoraAdapter } from './meteoraAdapter.js';

function adapter(): MeteoraAdapter {
  return new MeteoraAdapter({ readOnly: true });
}

const THROTTLE_MS = 5 * 60 * 1000;

describe('MeteoraAdapter empty-discovery throttle', () => {
  beforeEach(() => {
    mockGetPositions.mockReset();
    vi.restoreAllMocks();
  });

  it('runs discovery on the first empty-list call and arms the throttle on clean empty', async () => {
    const a = adapter();
    mockGetPositions.mockResolvedValue({ userPositions: [] });

    await a.ensurePositionsLoaded();
    expect(mockGetPositions).toHaveBeenCalledTimes(1);

    // Second cycle 15s later: clean-empty answer is still authoritative
    await a.ensurePositionsLoaded();
    expect(mockGetPositions).toHaveBeenCalledTimes(1);
  });

  it('re-scans after the throttle window expires', async () => {
    const a = adapter();
    mockGetPositions.mockResolvedValue({ userPositions: [] });

    const t0 = Date.now();
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(t0);
    await a.ensurePositionsLoaded();
    expect(mockGetPositions).toHaveBeenCalledTimes(1);

    nowSpy.mockReturnValue(t0 + THROTTLE_MS - 1000);
    await a.ensurePositionsLoaded();
    expect(mockGetPositions).toHaveBeenCalledTimes(1);

    nowSpy.mockReturnValue(t0 + THROTTLE_MS + 1000);
    await a.ensurePositionsLoaded();
    expect(mockGetPositions).toHaveBeenCalledTimes(2);
  });

  it('an RPC error does NOT arm the throttle — next cycle retries', async () => {
    const a = adapter();
    mockGetPositions.mockRejectedValue(new Error('429 max usage reached'));

    await a.ensurePositionsLoaded();
    expect(mockGetPositions).toHaveBeenCalledTimes(1);

    await a.ensurePositionsLoaded();
    expect(mockGetPositions).toHaveBeenCalledTimes(2);
  });

  it('a successful discovery resets the throttle and loads the mint', async () => {
    const a = adapter();
    mockGetPositions.mockResolvedValueOnce({ userPositions: [] });
    await a.ensurePositionsLoaded(); // arms

    // Position appears on-chain (e.g. re-entry created elsewhere); a DIRECT
    // discovery call bypasses the throttle and must clear it
    mockGetPositions.mockResolvedValueOnce({
      userPositions: [{ publicKey: { toBase58: () => 'MintAAA' } }],
    });
    const found = await a.discoverPositionsFromBlockchain();
    expect(found).toEqual(['MintAAA']);
    expect(a.getPositionMints()).toEqual(['MintAAA']);

    // List is non-empty now — ensurePositionsLoaded never scans again
    await a.ensurePositionsLoaded();
    expect(mockGetPositions).toHaveBeenCalledTimes(2);
  });

  it('never scans when positions are already loaded', async () => {
    const a = adapter();
    a.setPositionMints(['MintBBB']);
    await a.ensurePositionsLoaded();
    expect(mockGetPositions).not.toHaveBeenCalled();
  });

  it('discoverPositionsCycle: throttled while chain is known-empty, live while a position is tracked', async () => {
    const a = adapter();
    mockGetPositions.mockResolvedValue({ userPositions: [] });

    expect(await a.discoverPositionsCycle()).toEqual([]); // arms
    expect(await a.discoverPositionsCycle()).toEqual([]); // throttled
    expect(mockGetPositions).toHaveBeenCalledTimes(1);

    // With a tracked position the per-cycle self-heal must stay untouched:
    // every call hits the chain (here it comes back empty → prune + re-arm)
    a.setPositionMints(['MintCCC']);
    await a.discoverPositionsCycle();
    expect(mockGetPositions).toHaveBeenCalledTimes(2);
    expect(a.getPositionMints()).toEqual([]);
  });

  it('a createPosition attempt clears the throttle so the next cycle re-discovers', async () => {
    const a = adapter();
    mockGetPositions.mockResolvedValue({ userPositions: [] });

    await a.ensurePositionsLoaded(); // arms
    expect(mockGetPositions).toHaveBeenCalledTimes(1);

    // Mocked DLMM pool has none of the creation methods — the attempt throws
    // after the throttle reset, which is exactly the dangerous path (tx fate
    // unknown → must not trust the cached empty answer)
    await expect(
      a.createPosition({ poolAddress: '11111111111111111111111111111111' } as any),
    ).rejects.toThrow();

    await a.ensurePositionsLoaded();
    expect(mockGetPositions).toHaveBeenCalledTimes(2);
  });
});
