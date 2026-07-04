import { describe, it, expect } from 'vitest';
import { selectClosableAccounts } from './walletJanitor.js';

const SPL = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const WSOL = 'So11111111111111111111111111111111111111112';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

function acct(over: Partial<Parameters<typeof selectClosableAccounts>[0][number]>) {
  return {
    pubkey: 'ATA1111111111111111111111111111111111111111',
    programId: SPL,
    mint: 'Mint111111111111111111111111111111111111111',
    amount: '0',
    state: 'initialized',
    rentLamports: 2039280,
    ...over,
  };
}

describe('selectClosableAccounts', () => {
  it('selects empty non-protected accounts', () => {
    expect(selectClosableAccounts([acct({})])).toHaveLength(1);
  });

  it('never touches wSOL, even when empty', () => {
    expect(selectClosableAccounts([acct({ mint: WSOL })])).toHaveLength(0);
  });

  it('never touches USDC, even when empty', () => {
    expect(selectClosableAccounts([acct({ mint: USDC })])).toHaveLength(0);
  });

  it('skips non-zero balances (raw amount string)', () => {
    expect(selectClosableAccounts([acct({ amount: '1' })])).toHaveLength(0);
  });

  it('skips frozen accounts', () => {
    expect(selectClosableAccounts([acct({ state: 'frozen' })])).toHaveLength(0);
  });

  it('carries programId through for token-2022 closes', () => {
    const t22 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
    const res = selectClosableAccounts([acct({ programId: t22 })]);
    expect(res[0].programId).toBe(t22);
  });
});
