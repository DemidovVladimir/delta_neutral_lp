import React from 'react';

interface PriceOraclesProps {
  prices: any;
}

export function PriceOracles({ prices }: PriceOraclesProps) {
  if (!prices) return <div>Loading prices...</div>;

  const { sol, multiToken } = prices;

  // Calculate price divergence between Pyth and Jupiter
  const pythPrice = sol?.source === 'pyth' ? sol.usd : null;
  const jupiterPrice = multiToken?.sol?.price;

  let divergencePct = null;
  if (pythPrice && jupiterPrice) {
    const diff = Math.abs(pythPrice - jupiterPrice);
    divergencePct = ((diff / pythPrice) * 100).toFixed(3);
  }

  return (
    <div className="price-oracles">
      <div className="price-card">
        <h3>SOL/USD Price</h3>
        <div className="price-value">${sol?.usd?.toFixed(2)}</div>
        <div className="price-meta">
          Source: <span className={`source ${sol?.source}`}>{sol?.source}</span>
        </div>
      </div>

      <div className="price-card">
        <h3>SOL/USDC Rate</h3>
        <div className="price-value">{multiToken?.solUsdcRate?.toFixed(4)}</div>
        <div className="price-meta">Source: Jupiter v6</div>
      </div>

      {divergencePct && parseFloat(divergencePct) > 0.5 && (
        <div className="price-card warning">
          <h3>⚠️ Price Divergence</h3>
          <div className="price-value">{divergencePct}%</div>
          <div className="price-meta">
            Pyth: ${pythPrice?.toFixed(2)} | Jupiter: ${jupiterPrice?.toFixed(2)}
          </div>
        </div>
      )}

      <div className="price-timestamp">
        Last updated: {new Date(prices.timestamp).toLocaleTimeString()}
      </div>
    </div>
  );
}
