import React, { useState } from 'react';
import { API_BASE_URL } from '../config';

interface PositionManagerProps {
  positions: any;
  currentPrice: number | null;
  poolAddress: string;
  onUpdate: () => void;
}

export function PositionManager({ positions, currentPrice, poolAddress, onUpdate }: PositionManagerProps) {
  const [activeTab, setActiveTab] = useState<'view' | 'create' | 'deposit' | 'withdraw'>('view');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

  // Create position form
  const [createForm, setCreateForm] = useState({
    solAmount: '',
    usdcAmount: '0',
    rangePercent: '1', // ±1% range
  });

  // Deposit form
  const [depositForm, setDepositForm] = useState({
    sol: '',
    usdc: '',
    singleSided: '',
  });

  // Withdraw form
  const [withdrawForm, setWithdrawForm] = useState({
    percent: '100',
  });

  const handleCreatePosition = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentPrice) return;

    setLoading(true);
    setMessage(null);

    try {
      const rangePercent = parseFloat(createForm.rangePercent);
      const priceLower = currentPrice * (1 - rangePercent / 100);
      const priceUpper = currentPrice * (1 + rangePercent / 100);

      const response = await fetch(`${API_BASE_URL}/api/positions/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          solAmount: createForm.solAmount,
          usdcAmount: createForm.usdcAmount,
          priceLower,
          priceUpper,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'Failed to create position');
      }

      setMessage({ type: 'success', text: `Position created! TX: ${data.signature}` });
      setCreateForm({ solAmount: '', usdcAmount: '0', rangePercent: '1' });
      setTimeout(() => onUpdate(), 2000);
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Unknown error' });
    } finally {
      setLoading(false);
    }
  };

  const handleDeposit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage(null);

    try {
      const response = await fetch(`${API_BASE_URL}/api/positions/deposit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sol: depositForm.sol || undefined,
          usdc: depositForm.usdc || undefined,
          singleSided: depositForm.singleSided || undefined,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'Failed to deposit');
      }

      setMessage({ type: 'success', text: `Deposit successful! TX: ${data.signature}` });
      setDepositForm({ sol: '', usdc: '', singleSided: '' });
      setTimeout(() => onUpdate(), 2000);
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Unknown error' });
    } finally {
      setLoading(false);
    }
  };

  const handleWithdraw = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage(null);

    try {
      const response = await fetch(`${API_BASE_URL}/api/positions/withdraw`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          percent: parseFloat(withdrawForm.percent),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'Failed to withdraw');
      }

      setMessage({ type: 'success', text: `Withdrawal successful! TX: ${data.signature}` });
      setTimeout(() => onUpdate(), 2000);
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Unknown error' });
    } finally {
      setLoading(false);
    }
  };

  const handleClaimFees = async () => {
    setLoading(true);
    setMessage(null);

    try {
      const response = await fetch(`${API_BASE_URL}/api/positions/claim-fees`, {
        method: 'POST',
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'Failed to claim fees');
      }

      setMessage({
        type: 'success',
        text: `Claimed ${data.sol.toFixed(4)} SOL + ${data.usdc.toFixed(2)} USDC`,
      });
      setTimeout(() => onUpdate(), 2000);
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Unknown error' });
    } finally {
      setLoading(false);
    }
  };

  const handleClosePosition = async (positionMint: string) => {
    const confirmed = window.confirm(
      'Close this position and reclaim position NFT rent (~0.057 SOL)?\n\n' +
      'NOTE: Bin array rent (~0.14 SOL) is NON-REFUNDABLE - it stays as shared pool infrastructure.\n\n' +
      'WARNING: Position must be fully withdrawn (0 liquidity) first!'
    );

    if (!confirmed) return;

    setLoading(true);
    setMessage(null);

    try {
      const response = await fetch(`${API_BASE_URL}/api/positions/close`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ positionMint }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'Failed to close position');
      }

      setMessage({
        type: 'success',
        text: `Position closed! NFT rent reclaimed (~0.057 SOL). TX: ${data.signature}`,
      });
      setTimeout(() => onUpdate(), 2000);
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Unknown error' });
    } finally {
      setLoading(false);
    }
  };

  const exposure = positions?.exposure;

  return (
    <div className="position-manager">
      <div className="tabs">
        <button
          className={activeTab === 'view' ? 'active' : ''}
          onClick={() => setActiveTab('view')}
        >
          View Positions
        </button>
        <button
          className={activeTab === 'create' ? 'active' : ''}
          onClick={() => setActiveTab('create')}
        >
          Create Position
        </button>
        <button
          className={activeTab === 'deposit' ? 'active' : ''}
          onClick={() => setActiveTab('deposit')}
        >
          Deposit
        </button>
        <button
          className={activeTab === 'withdraw' ? 'active' : ''}
          onClick={() => setActiveTab('withdraw')}
        >
          Withdraw
        </button>
      </div>

      {message && (
        <div className={`message ${message.type}`}>
          {message.text}
        </div>
      )}

      <div className="tab-content">
        {activeTab === 'view' && (
          <div className="view-positions">
            {exposure && (
              <>
                <div className="exposure-summary">
                  <div className="exposure-card">
                    <div className="label">Total SOL</div>
                    <div className="value">{exposure.solAmount.toFixed(4)}</div>
                  </div>
                  <div className="exposure-card">
                    <div className="label">Total USDC</div>
                    <div className="value">${exposure.usdcAmount.toFixed(2)}</div>
                  </div>
                  <div className="exposure-card">
                    <div className="label">Total USD Value</div>
                    <div className="value">${exposure.totalUsd.toFixed(2)}</div>
                  </div>
                  <div className="exposure-card">
                    <div className="label">Claimable SOL</div>
                    <div className="value highlight">{exposure.claimableSol.toFixed(6)}</div>
                  </div>
                  <div className="exposure-card">
                    <div className="label">Claimable USDC</div>
                    <div className="value highlight">${exposure.claimableUsdc.toFixed(4)}</div>
                  </div>
                </div>

                {(exposure.claimableSol > 0 || exposure.claimableUsdc > 0) && (
                  <button
                    onClick={handleClaimFees}
                    disabled={loading}
                    className="claim-btn"
                  >
                    {loading ? 'Claiming...' : '💰 Claim Fees'}
                  </button>
                )}

                {exposure.positions && exposure.positions.length > 0 && (
                  <div className="positions-list">
                    <h4>Active Positions</h4>
                    {exposure.positions.map((pos: any, idx: number) => {
                      const isEmpty = pos.solAmount === 0 && pos.usdcAmount === 0;
                      return (
                        <div key={pos.mint} className="position-card">
                          <div className="position-header">Position {idx + 1}</div>
                          <div className="position-details">
                            <div>SOL: {pos.solAmount.toFixed(4)}</div>
                            <div>USDC: ${pos.usdcAmount.toFixed(2)}</div>
                            <div>Value: ${pos.valueUsd.toFixed(2)}</div>
                            <div className="position-range">
                              Bins: {pos.lowerBinId} → {pos.upperBinId}
                            </div>
                            <div style={{ fontSize: '0.85em', color: '#888', marginTop: '8px' }}>
                              {pos.mint.slice(0, 8)}...{pos.mint.slice(-8)}
                            </div>
                          </div>
                          {isEmpty && (
                            <button
                              onClick={() => handleClosePosition(pos.mint)}
                              disabled={loading}
                              className="close-position-btn"
                              style={{
                                marginTop: '10px',
                                padding: '8px 16px',
                                background: '#ff6b6b',
                                color: 'white',
                                border: 'none',
                                borderRadius: '6px',
                                cursor: loading ? 'not-allowed' : 'pointer',
                                fontSize: '0.9em',
                              }}
                            >
                              {loading ? 'Closing...' : '🔒 Close Position (Reclaim ~0.057 SOL)'}
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}

            {(!exposure || !exposure.positions || exposure.positions.length === 0) && (
              <div className="empty-state">
                <p>No active positions found.</p>
                <p>Create a position to get started!</p>
              </div>
            )}
          </div>
        )}

        {activeTab === 'create' && (
          <form onSubmit={handleCreatePosition} className="form">
            <div className="form-group">
              <label>SOL Amount</label>
              <input
                type="number"
                step="0.01"
                value={createForm.solAmount}
                onChange={(e) => setCreateForm({ ...createForm, solAmount: e.target.value })}
                placeholder="e.g., 1.0"
                required
              />
            </div>

            <div className="form-group">
              <label>USDC Amount (optional)</label>
              <input
                type="number"
                step="0.01"
                value={createForm.usdcAmount}
                onChange={(e) => setCreateForm({ ...createForm, usdcAmount: e.target.value })}
                placeholder="e.g., 100"
              />
            </div>

            <div className="form-group">
              <label>Price Range (±%)</label>
              <input
                type="number"
                step="0.1"
                value={createForm.rangePercent}
                onChange={(e) => setCreateForm({ ...createForm, rangePercent: e.target.value })}
                placeholder="e.g., 1"
                required
              />
              <small>
                {currentPrice && (
                  <>
                    Range: ${(currentPrice * (1 - parseFloat(createForm.rangePercent || '0') / 100)).toFixed(2)} -
                    ${(currentPrice * (1 + parseFloat(createForm.rangePercent || '0') / 100)).toFixed(2)}
                  </>
                )}
              </small>
            </div>

            <button type="submit" disabled={loading || !currentPrice} className="submit-btn">
              {loading ? 'Creating...' : 'Create Position'}
            </button>
          </form>
        )}

        {activeTab === 'deposit' && (
          <form onSubmit={handleDeposit} className="form">
            <div className="form-group">
              <label>SOL Amount</label>
              <input
                type="number"
                step="0.01"
                value={depositForm.sol}
                onChange={(e) => setDepositForm({ ...depositForm, sol: e.target.value })}
                placeholder="e.g., 0.5"
              />
            </div>

            <div className="form-group">
              <label>USDC Amount</label>
              <input
                type="number"
                step="0.01"
                value={depositForm.usdc}
                onChange={(e) => setDepositForm({ ...depositForm, usdc: e.target.value })}
                placeholder="e.g., 50"
              />
            </div>

            <div className="form-group">
              <label>Single-Sided (optional)</label>
              <select
                value={depositForm.singleSided}
                onChange={(e) => setDepositForm({ ...depositForm, singleSided: e.target.value })}
              >
                <option value="">Balanced</option>
                <option value="sol">SOL Only</option>
                <option value="usdc">USDC Only</option>
              </select>
            </div>

            <button type="submit" disabled={loading} className="submit-btn">
              {loading ? 'Depositing...' : 'Deposit'}
            </button>
          </form>
        )}

        {activeTab === 'withdraw' && (
          <form onSubmit={handleWithdraw} className="form">
            <div className="form-group">
              <label>Withdrawal Percentage</label>
              <input
                type="number"
                min="1"
                max="100"
                step="1"
                value={withdrawForm.percent}
                onChange={(e) => setWithdrawForm({ ...withdrawForm, percent: e.target.value })}
                placeholder="e.g., 100"
                required
              />
              <small>Enter 100 for full withdrawal</small>
            </div>

            <button type="submit" disabled={loading} className="submit-btn">
              {loading ? 'Withdrawing...' : 'Withdraw'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
