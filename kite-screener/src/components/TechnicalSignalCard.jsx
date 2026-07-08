import { useMemo } from 'react';
import { analyzeCloses } from '../screener/technicals';

function toneToClass(tone) {
  if (tone === 'up') return 'cell-up';
  if (tone === 'down') return 'cell-down';
  return '';
}

export default function TechnicalSignalCard({
  closes,
  highs,
  lows,
  benchmarkCloses,
  loading = false,
  subject = 'price',
}) {
  const analysis = useMemo(
    () => analyzeCloses(closes, { highs, lows, benchmarkCloses }),
    [closes, highs, lows, benchmarkCloses],
  );

  return (
    <section className="ta-card detail-card">
      <div className="ta-card-head">
        <span className="detail-group-title">Technical signal</span>
        {analysis && (
          <span className={`ta-rating ta-rating-${analysis.ratingTone}`}>
            {analysis.rating}
          </span>
        )}
      </div>

      {loading && <div className="ta-card-note">Loading price history…</div>}

      {!loading && !analysis && (
        <div className="ta-card-note">Not enough history to compute technical indicators.</div>
      )}

      {!loading && analysis && (
        <>
          <table className="symbol-detail-mini-table detail-table ta-table">
            <tbody>
              {analysis.signals.map((signal) => (
                <tr key={signal.label}>
                  <td>{signal.label}</td>
                  <td className={toneToClass(signal.tone)}>{signal.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="ta-card-note">
            Rule-based composite of trend (50/200-DMA), ADX, RSI, MACD, momentum, relative strength,
            Sortino & drawdown (as available) on {subject} history ({analysis.barsUsed} points).
            For research only — not investment advice.
          </div>
        </>
      )}
    </section>
  );
}
