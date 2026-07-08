import { useEffect, useMemo, useRef, useState } from 'react';
import { createChart } from 'lightweight-charts';
import { loadMfHistory, computeMfReturns } from '../screener/mfApi';
import { MF_CHART_RANGES } from './MfNavChart';

const DAY_MS = 86400000;
const SERIES_COLORS = ['#1565C0', '#E65100', '#2E7D32', '#6A1B9A', '#C62828', '#00838F'];

function toDateStr(t) {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatPct(value) {
  if (value == null || !Number.isFinite(value)) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

function toneClass(value) {
  if (value == null || !Number.isFinite(value) || value === 0) return '';
  return value > 0 ? 'cell-up' : 'cell-down';
}

export default function MfCompareModal({ schemes = [], onClose, onRemove }) {
  const wrapRef = useRef(null);
  const [rangeId, setRangeId] = useState('1Y');
  const [histories, setHistories] = useState({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setLoading(true);

    Promise.all(
      schemes.map(async (scheme) => {
        try {
          const { series } = await loadMfHistory(scheme.schemeCode, { signal: controller.signal });
          return [scheme.schemeCode, series];
        } catch {
          return [scheme.schemeCode, []];
        }
      }),
    ).then((entries) => {
      if (cancelled) return;
      setHistories(Object.fromEntries(entries));
      setLoading(false);
    });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [schemes]);

  const rebased = useMemo(() => {
    const range = MF_CHART_RANGES.find((item) => item.id === rangeId) || MF_CHART_RANGES[3];
    return schemes.map((scheme, index) => {
      const series = histories[scheme.schemeCode] || [];
      if (!series.length) return { scheme, color: SERIES_COLORS[index % SERIES_COLORS.length], data: [], change: null };

      const cutoff = Number.isFinite(range.days)
        ? series[series.length - 1].t - range.days * DAY_MS
        : -Infinity;
      const windowed = series.filter((point) => point.t >= cutoff);
      if (windowed.length < 2) return { scheme, color: SERIES_COLORS[index % SERIES_COLORS.length], data: [], change: null };

      const base = windowed[0].nav;
      const seen = new Set();
      const data = [];
      windowed.forEach((point) => {
        const time = toDateStr(point.t);
        if (seen.has(time)) return;
        seen.add(time);
        data.push({ time, value: (point.nav / base) * 100 });
      });
      const change = ((windowed[windowed.length - 1].nav - base) / base) * 100;
      return { scheme, color: SERIES_COLORS[index % SERIES_COLORS.length], data, change };
    });
  }, [schemes, histories, rangeId]);

  const returnsRows = useMemo(
    () => schemes.map((scheme) => ({
      scheme,
      returns: computeMfReturns(histories[scheme.schemeCode] || []),
    })),
    [schemes, histories],
  );

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return undefined;
    const withData = rebased.filter((item) => item.data.length);
    if (!withData.length) {
      wrap.innerHTML = '';
      return undefined;
    }

    wrap.innerHTML = '';
    const chart = createChart(wrap, {
      autoSize: true,
      width: wrap.clientWidth || undefined,
      height: wrap.clientHeight || undefined,
      layout: {
        background: { type: 'solid', color: '#ffffff' },
        textColor: '#636c76',
        fontFamily: "Inter, 'Segoe UI', system-ui, sans-serif",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: 'rgba(208,215,222,0.4)' },
        horzLines: { color: 'rgba(208,215,222,0.4)' },
      },
      rightPriceScale: { borderColor: '#d0d7de' },
      timeScale: { borderColor: '#d0d7de', rightOffset: 6 },
    });

    withData.forEach((item) => {
      const line = chart.addLineSeries({
        color: item.color,
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: true,
      });
      line.setData(item.data);
    });
    chart.timeScale().fitContent();

    const raf = requestAnimationFrame(() => {
      if (wrap.clientWidth > 0) {
        chart.resize(wrap.clientWidth, wrap.clientHeight || 360);
        chart.timeScale().fitContent();
      }
    });

    return () => {
      cancelAnimationFrame(raf);
      chart.remove();
    };
  }, [rebased]);

  return (
    <div className="mf-compare-overlay" onClick={onClose}>
      <div className="mf-compare-modal" onClick={(event) => event.stopPropagation()}>
        <div className="mf-compare-head">
          <div>
            <h3>Compare funds</h3>
            <p>Growth of ₹100 invested at the start of the selected period.</p>
          </div>
          <button type="button" className="mf-compare-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="mf-compare-controls">
          <div className="chart-pill-group">
            {MF_CHART_RANGES.map((range) => (
              <button
                key={range.id}
                type="button"
                className={`chart-pill${rangeId === range.id ? ' active' : ''}`}
                onClick={() => setRangeId(range.id)}
              >
                {range.label}
              </button>
            ))}
          </div>
        </div>

        <div className="mf-compare-legend">
          {rebased.map((item) => (
            <span key={item.scheme.schemeCode} className="mf-compare-legend-item">
              <span className="mf-compare-swatch" style={{ background: item.color }} />
              <span className="mf-compare-legend-name" title={item.scheme.name}>{item.scheme.name}</span>
              <span className={`mf-compare-legend-chg ${toneClass(item.change)}`}>{formatPct(item.change)}</span>
              <button
                type="button"
                className="mf-compare-remove"
                onClick={() => onRemove?.(item.scheme)}
                title="Remove from comparison"
              >
                ×
              </button>
            </span>
          ))}
        </div>

        <div className="mf-compare-chart">
          {loading && <div className="chart-placeholder">Loading NAV history…</div>}
          {!loading && <div className="mf-compare-chart-wrap" ref={wrapRef} />}
        </div>

        <div className="mf-compare-table-wrap">
          <table className="screener-table mf-compare-table">
            <thead>
              <tr>
                <th className="align-left">Scheme</th>
                <th className="num-cell">NAV</th>
                <th className="num-cell">1Y</th>
                <th className="num-cell">3Y</th>
                <th className="num-cell">5Y</th>
              </tr>
            </thead>
            <tbody>
              {returnsRows.map(({ scheme, returns }) => (
                <tr key={scheme.schemeCode}>
                  <td className="align-left">
                    <span className="mf-compare-cell-name">{scheme.name}</span>
                  </td>
                  <td className="num-cell">{returns?.latestNav != null ? returns.latestNav.toFixed(2) : '—'}</td>
                  <td className={`num-cell ${toneClass(returns?.r1y)}`}>{formatPct(returns?.r1y)}</td>
                  <td className={`num-cell ${toneClass(returns?.r3y)}`}>{formatPct(returns?.r3y)}</td>
                  <td className={`num-cell ${toneClass(returns?.r5y)}`}>{formatPct(returns?.r5y)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
