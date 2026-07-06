import { useMemo } from 'react';
import { computePeriodReturns } from '../screener/chartData';

function formatTrend(value) {
  if (value == null || !Number.isFinite(value)) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

function formatAthPrice(value) {
  if (value == null || !Number.isFinite(value)) return '—';
  return `₹${Number(value).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

function formatAthDate(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function trendTone(value) {
  if (value == null || !Number.isFinite(value) || value === 0) return '';
  return value > 0 ? 'cell-up' : 'cell-down';
}

export default function TrendPanel({ candles, row, loading = false, athInfo = null }) {
  const trends = useMemo(
    () => computePeriodReturns(
      candles,
      row?.last_price,
      row?.change_percent ?? row?.change,
    ),
    [candles, row?.last_price, row?.change_percent, row?.change],
  );

  if (!row) return null;

  return (
    <section className="symbol-detail-table trend-panel">
      <header className="symbol-detail-table-head">
        <h3>Price trend</h3>
      </header>

      {athInfo && (
        <div
          className="trend-ath-summary"
          title={athInfo.athDate ? `ATH ${formatAthPrice(athInfo.ath)} on ${formatAthDate(athInfo.athDate)}` : undefined}
        >
          <span className="trend-ath-label">ATH {formatAthPrice(athInfo.ath)}</span>
          <span className={`trend-ath-dd ${athInfo.drawdownPct > -0.05 ? 'cell-up' : trendTone(athInfo.drawdownPct)}`}>
            {athInfo.drawdownPct > -0.05
              ? 'At ATH'
              : `↓${Math.abs(athInfo.drawdownPct).toFixed(1)}%`}
          </span>
        </div>
      )}

      {loading && trends.length === 0 ? (
        <div className="symbol-detail-table-loading">Loading…</div>
      ) : (
        <table className="symbol-detail-mini-table trend-table">
          <thead>
            <tr>
              <th>Period</th>
              <th>Chg%</th>
            </tr>
          </thead>
          <tbody>
            {trends.map(({ id, label, percent, available }) => (
              <tr key={id}>
                <td>{label}</td>
                <td className={available ? trendTone(percent) : ''}>
                  {available ? formatTrend(percent) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
