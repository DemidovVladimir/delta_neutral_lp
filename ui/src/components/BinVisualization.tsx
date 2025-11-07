import React from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine, Cell } from 'recharts';

interface BinVisualizationProps {
  bins: any;
  currentPrice: number | null;
  positions: any;
}

export function BinVisualization({ bins, currentPrice, positions }: BinVisualizationProps) {
  if (!bins) return <div>Loading bin data...</div>;

  const { activeBin, binStep, bins: binData, totalLiquidity } = bins;

  // Prepare chart data with liquidity
  const chartData = binData.map((bin: any) => ({
    binId: bin.binId,
    price: bin.price,
    liquidity: bin.liquidity || 0,
    xAmount: bin.xAmount || 0,
    yAmount: bin.yAmount || 0,
    isActive: bin.isActive,
  }));

  // Find position ranges if available
  const positionRanges = positions?.positions?.map((pos: any) => ({
    lowerBinId: pos.lowerBinId,
    upperBinId: pos.upperBinId,
    mint: pos.mint,
  })) || [];

  // Helper to check if bin is in any position range
  const isInPositionRange = (binId: number) => {
    return positionRanges.some((range: any) =>
      binId >= range.lowerBinId && binId <= range.upperBinId
    );
  };

  // Format large numbers
  const formatLiquidity = (value: number) => {
    if (value >= 1000000) return `$${(value / 1000000).toFixed(2)}M`;
    if (value >= 1000) return `$${(value / 1000).toFixed(2)}K`;
    return `$${value.toFixed(2)}`;
  };

  return (
    <div className="bin-visualization">
      <div className="bin-info">
        <div className="info-card">
          <div className="label">Active Bin ID</div>
          <div className="value">{activeBin.binId}</div>
        </div>
        <div className="info-card">
          <div className="label">Active Bin Price</div>
          <div className="value">${activeBin.price.toFixed(4)}</div>
        </div>
        <div className="info-card">
          <div className="label">Bin Step</div>
          <div className="value">{binStep} ({(binStep / 100).toFixed(2)}%)</div>
        </div>
        <div className="info-card">
          <div className="label">Total Liquidity</div>
          <div className="value">{formatLiquidity(totalLiquidity || 0)}</div>
        </div>
        {currentPrice && (
          <div className="info-card">
            <div className="label">Oracle Price</div>
            <div className="value">${currentPrice.toFixed(2)}</div>
          </div>
        )}
      </div>

      <div className="chart-container">
        <ResponsiveContainer width="100%" height={400}>
          <BarChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 60 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#333" />
            <XAxis
              dataKey="price"
              stroke="#888"
              tick={{ fontSize: 10 }}
              angle={-45}
              textAnchor="end"
              height={80}
              tickFormatter={(value) => `$${value.toFixed(2)}`}
              label={{ value: 'Price (USDC)', position: 'insideBottom', offset: -50 }}
            />
            <YAxis
              stroke="#888"
              tick={{ fontSize: 12 }}
              tickFormatter={(value) => formatLiquidity(value)}
              label={{ value: 'Liquidity (USD)', angle: -90, position: 'insideLeft' }}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: '#1a1a1a',
                border: '1px solid #333',
                borderRadius: '8px',
                padding: '12px',
              }}
              formatter={(value: any, name: string) => {
                if (name === 'liquidity') return [formatLiquidity(value), 'Liquidity'];
                return [value, name];
              }}
              labelFormatter={(label) => `Price: $${parseFloat(label).toFixed(4)}`}
              content={({ active, payload }) => {
                if (active && payload && payload.length) {
                  const data = payload[0].payload;
                  return (
                    <div style={{
                      backgroundColor: '#1a1a1a',
                      border: '1px solid #333',
                      borderRadius: '8px',
                      padding: '12px',
                    }}>
                      <p style={{ margin: 0, marginBottom: '8px', fontWeight: 'bold' }}>
                        Bin #{data.binId} {data.isActive && '(Active)'}
                      </p>
                      <p style={{ margin: 0, color: '#4a9eff' }}>
                        Price: ${data.price.toFixed(4)}
                      </p>
                      <p style={{ margin: 0, color: '#00ff88' }}>
                        Liquidity: {formatLiquidity(data.liquidity)}
                      </p>
                      {data.xAmount > 0 && (
                        <p style={{ margin: 0, fontSize: '0.9em', color: '#888' }}>
                          SOL: {data.xAmount.toFixed(4)}
                        </p>
                      )}
                      {data.yAmount > 0 && (
                        <p style={{ margin: 0, fontSize: '0.9em', color: '#888' }}>
                          USDC: ${data.yAmount.toFixed(2)}
                        </p>
                      )}
                    </div>
                  );
                }
                return null;
              }}
            />
            <Legend />

            {/* Active bin indicator */}
            <ReferenceLine
              x={activeBin.price}
              stroke="#ff6b6b"
              strokeWidth={3}
              label={{
                value: 'Active',
                position: 'top',
                fill: '#ff6b6b',
                fontWeight: 'bold',
              }}
            />

            {/* Liquidity bars */}
            <Bar dataKey="liquidity" name="Pool Liquidity" radius={[4, 4, 0, 0]}>
              {chartData.map((entry: any, index: number) => {
                // Color bars based on state
                let fillColor = '#4a9eff'; // Default blue

                if (entry.isActive) {
                  fillColor = '#ff6b6b'; // Red for active bin
                } else if (isInPositionRange(entry.binId)) {
                  fillColor = '#00ff88'; // Green for your position range
                }

                return <Cell key={`cell-${index}`} fill={fillColor} />;
              })}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="chart-legend-custom">
        <div className="legend-item">
          <div className="legend-color" style={{ backgroundColor: '#4a9eff' }}></div>
          <span>Pool Liquidity</span>
        </div>
        <div className="legend-item">
          <div className="legend-color" style={{ backgroundColor: '#00ff88' }}></div>
          <span>Your Position Range</span>
        </div>
        <div className="legend-item">
          <div className="legend-color" style={{ backgroundColor: '#ff6b6b' }}></div>
          <span>Active Bin (Current Price)</span>
        </div>
      </div>

      {positionRanges.length > 0 && (
        <div className="position-ranges">
          <h4>Active Position Ranges</h4>
          {positionRanges.map((range: any, idx: number) => {
            const lowerBin = binData.find((b: any) => b.binId === range.lowerBinId);
            const upperBin = binData.find((b: any) => b.binId === range.upperBinId);
            return (
              <div key={range.mint} className="range-info">
                <div>Position {idx + 1}</div>
                <div>
                  Bins: {range.lowerBinId} → {range.upperBinId}
                </div>
                {lowerBin && upperBin ? (
                  <div>
                    Price Range: ${lowerBin.price.toFixed(4)} → ${upperBin.price.toFixed(4)}
                  </div>
                ) : (
                  <div style={{ color: '#ff6b6b', fontSize: '0.9em' }}>
                    Price data loading... (restart API server)
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
