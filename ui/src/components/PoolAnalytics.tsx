import React from 'react';

interface PoolAnalyticsProps {
  analytics: any;
}

export function PoolAnalytics({ analytics }: PoolAnalyticsProps) {
  if (!analytics) return <div>Loading pool analytics...</div>;

  const formatNumber = (num: number) => {
    if (num >= 1_000_000) return `$${(num / 1_000_000).toFixed(2)}M`;
    if (num >= 1_000) return `$${(num / 1_000).toFixed(2)}K`;
    return `$${num.toFixed(2)}`;
  };

  return (
    <div className="pool-analytics">
      <div className="analytics-grid">
        <div className="analytics-card">
          <div className="label">Pool Name</div>
          <div className="value">{analytics.name}</div>
        </div>

        <div className="analytics-card">
          <div className="label">Current Price</div>
          <div className="value">${parseFloat(analytics.currentPrice).toFixed(4)}</div>
        </div>

        <div className="analytics-card">
          <div className="label">APR</div>
          <div className="value highlight">{(analytics.apr * 100).toFixed(2)}%</div>
        </div>

        <div className="analytics-card">
          <div className="label">APY</div>
          <div className="value highlight">{(analytics.apy * 100).toFixed(2)}%</div>
        </div>

        <div className="analytics-card">
          <div className="label">24h Volume</div>
          <div className="value">{formatNumber(analytics.tradeVolume24h)}</div>
        </div>

        <div className="analytics-card">
          <div className="label">24h Fees</div>
          <div className="value">{formatNumber(analytics.fees24h)}</div>
        </div>

        <div className="analytics-card">
          <div className="label">Bin Step</div>
          <div className="value">{analytics.binStep} ({(analytics.binStep / 100).toFixed(2)}%)</div>
        </div>

        <div className="analytics-card">
          <div className="label">Base Fee</div>
          <div className="value">{(parseFloat(analytics.baseFeePercentage) * 100).toFixed(3)}%</div>
        </div>

        <div className="analytics-card">
          <div className="label">Total Liquidity</div>
          <div className="value">{formatNumber(parseFloat(analytics.liquidity))}</div>
        </div>
      </div>
    </div>
  );
}
