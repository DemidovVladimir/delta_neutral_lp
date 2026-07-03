import { describe, expect, it } from 'vitest';
import { anchor, generateSolPositionPda } from './jupiterPerps.js';

/**
 * Position PDA derivation is pure (findProgramAddressSync) — pin it against
 * the live-verified short PDA from HANDOVER.md so a seed regression can never
 * silently point the engine at a different account.
 */
describe('generateSolPositionPda', () => {
  const wallet = new anchor.web3.PublicKey('F3YvPiLdniRPGpeKrbeGWR2zg2wPpzVuvqBA5BBJBQ5S');

  it('derives the live-verified SHORT PDA (side [2], USDC collateral custody)', () => {
    expect(generateSolPositionPda(wallet, 'short').toBase58()).toBe(
      '6HFhuYzQGcqdj4NGwC6vfVETRvMA3pXaVeZnHgWSKsJK'
    );
  });

  it('derives a distinct, deterministic LONG PDA (side [1], SOL collateral custody)', () => {
    const longPda = generateSolPositionPda(wallet, 'long');
    expect(longPda.toBase58()).not.toBe(generateSolPositionPda(wallet, 'short').toBase58());
    expect(longPda.toBase58()).toBe(generateSolPositionPda(wallet, 'long').toBase58());
  });
});
