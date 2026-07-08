import { useEffect, useMemo, useRef } from 'react';
import { createChart } from 'lightweight-charts';

export const MF_CHART_RANGES = [
  { id: '1M', label: '1m', days: 30 },
  { id: '3M', label: '3m', days: 90 },
  { id: '6M', label: '6m', days: 180 },
  { id: '1Y', label: '1yr', days: 365 },
  { id: '3Y', label: '3yr', days: 1095 },
  { id: '5Y', label: '5yr', days: 1825 },
  { id: 'ALL', label: 'All', days: Infinity },
];

const DAY_MS = 86400000;

function toDateStr(t) {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function MfNavChart({ series = [], rangeId = '1Y', onRangeChange }) {
  const wrapRef = useRef(null);

  const data = useMemo(() => {
    if (!series.length) return [];
    const range = MF_CHART_RANGES.find((item) => item.id === rangeId) || MF_CHART_RANGES[3];
    const cutoff = Number.isFinite(range.days) ? series[series.length - 1].t - range.days * DAY_MS : -Infinity;
    const seen = new Set();
    const points = [];
    for (const point of series) {
      if (point.t < cutoff) continue;
      const time = toDateStr(point.t);
      if (seen.has(time)) continue; // lightweight-charts requires unique, ascending times
      seen.add(time);
      points.push({ time, value: point.nav });
    }
    return points;
  }, [series, rangeId]);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap || data.length === 0) return undefined;

    wrap.innerHTML = '';

    const first = data[0].value;
    const last = data[data.length - 1].value;
    const up = last >= first;
    const line = up ? '#1a7f37' : '#cf222e';
    const top = up ? 'rgba(26,127,55,0.18)' : 'rgba(207,34,46,0.18)';

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
        vertLines: { color: 'rgba(208,215,222,0.45)' },
        horzLines: { color: 'rgba(208,215,222,0.45)' },
      },
      rightPriceScale: { borderColor: '#d0d7de', scaleMargins: { top: 0.1, bottom: 0.1 } },
      timeScale: { borderColor: '#d0d7de', timeVisible: false, rightOffset: 6 },
    });

    const areaSeries = chart.addAreaSeries({
      lineColor: line,
      topColor: top,
      bottomColor: 'rgba(255,255,255,0.02)',
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: true,
    });
    areaSeries.setData(data);
    chart.timeScale().fitContent();

    const raf = requestAnimationFrame(() => {
      if (wrap.clientWidth > 0) {
        chart.resize(wrap.clientWidth, wrap.clientHeight || 320);
        chart.timeScale().fitContent();
      }
    });

    return () => {
      cancelAnimationFrame(raf);
      chart.remove();
    };
  }, [data]);

  return (
    <div className="mf-nav-chart">
      <div className="chart-pill-group mf-chart-pills">
        {MF_CHART_RANGES.map((range) => (
          <button
            key={range.id}
            type="button"
            className={`chart-pill${rangeId === range.id ? ' active' : ''}`}
            onClick={() => onRangeChange?.(range.id)}
          >
            {range.label}
          </button>
        ))}
      </div>
      {data.length === 0 ? (
        <div className="chart-placeholder">Not enough NAV history to plot.</div>
      ) : (
        <div className="chart-lw-wrap mf-chart-wrap" ref={wrapRef} />
      )}
    </div>
  );
}
