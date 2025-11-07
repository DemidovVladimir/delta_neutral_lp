import React, { useState, useEffect } from 'react';
import { PriceOracles } from './components/PriceOracles';
import { PoolAnalytics } from './components/PoolAnalytics';
import { BinVisualization } from './components/BinVisualization';
import { PositionManager } from './components/PositionManager';
import { API_BASE_URL } from './config';

export default function App() {
  const [prices, setPrices] = useState<any>(null);
  const [poolAnalytics, setPoolAnalytics] = useState<any>(null);
  const [bins, setBins] = useState<any>(null);
  const [positions, setPositions] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch all data
  const fetchData = async () => {
    try {
      setLoading(true);
      setError(null);

      const [pricesRes, analyticsRes, binsRes, positionsRes] = await Promise.all([
        fetch(`${API_BASE_URL}/api/prices`),
        fetch(`${API_BASE_URL}/api/pool/analytics`),
        fetch(`${API_BASE_URL}/api/pool/bins`),
        fetch(`${API_BASE_URL}/api/positions`),
      ]);

      if (!pricesRes.ok || !analyticsRes.ok || !binsRes.ok || !positionsRes.ok) {
        throw new Error('Failed to fetch data from API');
      }

      const [pricesData, analyticsData, binsData, positionsData] = await Promise.all([
        pricesRes.json(),
        analyticsRes.json(),
        binsRes.json(),
        positionsRes.json(),
      ]);

      setPrices(pricesData);
      setPoolAnalytics(analyticsData);
      setBins(binsData);
      setPositions(positionsData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      console.error('Failed to fetch data:', err);
    } finally {
      setLoading(false);
    }
  };

  // Initial fetch
  useEffect(() => {
    fetchData();
  }, []);

  // Auto-refresh every 10 seconds
  useEffect(() => {
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, []);

  if (loading && !prices) {
    return (
      <div className="app loading">
        <h1>Meteora DLMM LP Manager</h1>
        <p>Loading data...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="app error">
        <h1>Meteora DLMM LP Manager</h1>
        <div className="error-message">
          <p>Error: {error}</p>
          <button onClick={fetchData}>Retry</button>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <header>
        <h1>🌊 Meteora DLMM LP Manager</h1>
        <button onClick={fetchData} className="refresh-btn">
          🔄 Refresh
        </button>
      </header>

      <div className="dashboard">
        {/* Price Oracles Section */}
        <section className="section">
          <h2>📊 Oracle Prices</h2>
          <PriceOracles prices={prices} />
        </section>

        {/* Pool Analytics Section */}
        <section className="section">
          <h2>💎 Pool Analytics</h2>
          <PoolAnalytics analytics={poolAnalytics} />
        </section>

        {/* Bin Visualization Section */}
        <section className="section full-width">
          <h2>📈 Bin Distribution & Price Range</h2>
          <BinVisualization
            bins={bins}
            currentPrice={prices?.sol?.usd}
            positions={positions?.exposure}
          />
        </section>

        {/* Position Manager Section */}
        <section className="section full-width">
          <h2>⚡ LP Position Management</h2>
          <PositionManager
            positions={positions}
            currentPrice={prices?.sol?.usd}
            poolAddress={poolAnalytics?.address}
            onUpdate={fetchData}
          />
        </section>
      </div>
    </div>
  );
}
