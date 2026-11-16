import { useEffect, useMemo, useRef, useState } from 'react';
import { createChart, PriceScaleMode } from 'lightweight-charts';
import {
  BENCHMARK_ISIN,
  BENCHMARK_LABEL,
  calendarYearReturns,
  coinFundUrl,
  getNavSeries,
  indexAtOrBefore,
  rolling3y,
  shiftMonths,
} from '../screener/mfData';

const BASE_OPTIONS = {
  autoSize: true,
  layout: {
    background: { type: 'solid', color: '#ffffff' },
    textColor: '#636c76',
    fontFamily: "Inter, 'Segoe UI', system-ui, sans-serif",
    fontSize: 11,
  },
  grid: {
    vertLines: { color: 'rgba(208,215,222,0.35)' },
    horzLines: { color: 'rgba(208,215,222,0.35)' },
  },
  rightPriceScale: { borderColor: '#d0d7de' },
  timeScale: { borderColor: '#d0d7de', rightOffset: 2 },
};

const RANGES = [
  ['6M', 6],
  ['1Y', 12],
  ['3Y', 36],
  ['5Y', 60],
  ['Max', 0],
];

function pct(value, digits = 1) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '–';
  return `${value > 0 ? '+' : ''}${(value * 100).toFixed(digits)}%`;
}

function tone(value) {
  if (!Number.isFinite(value) || value === 0) return '';
  return value > 0 ? 'pos-up' : 'pos-down';
}

function buildChartData(series, bench, months) {
  const { dates, navs } = series;
  const end = dates[dates.length - 1];
  const i0 = months ? Math.max(0, indexAtOrBefore(dates, shiftMonths(end, months))) : 0;
  const base = navs[i0];
  const fund = [];
  for (let i = i0; i < dates.length; i += 1) {
    fund.push({ time: dates[i], value: (navs[i] / base) * 100 });
  }
  const benchLine = [];
  if (bench?.dates.length) {
    const b0 = indexAtOrBefore(bench.dates, dates[i0]);
    if (b0 >= 0) {
      const bBase = bench.navs[b0];
      for (let i = b0; i < bench.dates.length; i += 1) {
        if (bench.dates[i] < dates[i0]) continue;
        benchLine.push({ time: bench.dates[i], value: (bench.navs[i] / bBase) * 100 });
      }
    }
  }
  return { fund, benchLine };
}

/** Fund NAV vs the Nifty 50 index fund (rebased to 100) and yearly stats. */
export default function MfChart({ isin, name }) {
  const perfRef = useRef(null);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [range, setRange] = useState('3Y');
  const [logScale, setLogScale] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError('');
    Promise.all([getNavSeries(isin), getNavSeries(BENCHMARK_ISIN).catch(() => null)])
      .then(([series, bench]) => {
        if (!cancelled) setData({ series, bench });
      })
      .catch((err) => {
        if (!cancelled) setError(err?.message || 'Could not load NAV history');
      });
    return () => {
      cancelled = true;
    };
  }, [isin]);

  const months = RANGES.find(([label]) => label === range)?.[1] ?? 36;
  const chartData = useMemo(
    () => (data?.series.dates.length > 1 ? buildChartData(data.series, data.bench, months) : null),
    [data, months],
  );
  const years = useMemo(() => (data ? calendarYearReturns(data.series, data.bench) : []), [data]);
  const roll = useMemo(() => (data ? { fund: rolling3y(data.series), bench: data.bench ? rolling3y(data.bench) : null } : null), [data]);

  useEffect(() => {
    const perfWrap = perfRef.current;
    if (!perfWrap || !chartData) return undefined;

    const perf = createChart(perfWrap, {
      ...BASE_OPTIONS,
      rightPriceScale: {
        ...BASE_OPTIONS.rightPriceScale,
        mode: logScale ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal,
        scaleMargins: { top: 0.08, bottom: 0.08 },
      },
    });
    perf.addLineSeries({ color: '#ff5722', lineWidth: 2, title: 'Fund', priceLineVisible: false }).setData(chartData.fund);
    if (isin !== BENCHMARK_ISIN && chartData.benchLine.length) {
      perf.addLineSeries({ color: '#8a92a3', lineWidth: 1, title: BENCHMARK_LABEL, priceLineVisible: false }).setData(chartData.benchLine);
    }
    perf.timeScale().fitContent();
    // autoSize sets the real width after creation, so refit once the pane is measured.
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => perf.timeScale().fitContent());
    });
    observer.observe(perfWrap);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      perf.remove();
    };
  }, [chartData, logScale, isin]);

  return (
    <section className="positions-section mf-chart-section">
      <div className="positions-section-head mf-chart-head">
        <h3>
          {name}{' '}
          <a className="mf-coin-link" href={coinFundUrl(isin)} target="_blank" rel="noopener noreferrer" title="Open in Coin">
            Coin ↗
          </a>
        </h3>
        <div className="strategy-tabs mf-chips">
          {RANGES.map(([label]) => (
            <button key={label} type="button" className={range === label ? 'active' : ''} onClick={() => setRange(label)}>
              {label}
            </button>
          ))}
          <button type="button" className={logScale ? 'active' : ''} onClick={() => setLogScale((v) => !v)} title="Logarithmic price scale">
            Log
          </button>
        </div>
      </div>
      {error ? <div className="strategy-alert strategy-alert-error">{error}</div> : null}
      {!error && !data ? <div className="strategy-muted mf-chart-loading">Loading NAV history…</div> : null}
      {data && !chartData ? <div className="strategy-muted mf-chart-loading">No NAV history available for this fund.</div> : null}
      {chartData ? (
        <div className="mf-chart-body">
          <div className="strategy-chart mf-chart">
            <div className="strategy-chart-perf" ref={perfRef} />
          </div>
          <div className="mf-chart-side">
            <table className="positions-table mf-year-table">
              <thead>
                <tr>
                  <th className="align-left">Year</th>
                  <th>Fund</th>
                  <th>{BENCHMARK_LABEL}</th>
                </tr>
              </thead>
              <tbody>
                {years.map((row) => (
                  <tr key={row.year}>
                    <td className="align-left">{row.year}</td>
                    <td className={tone(row.fund)}>{pct(row.fund)}</td>
                    <td className={tone(row.bench)}>{pct(row.bench)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <table className="positions-table mf-year-table">
              <thead>
                <tr>
                  <th className="align-left">Rolling 3Y CAGR</th>
                  <th>Fund</th>
                  <th>{BENCHMARK_LABEL}</th>
                </tr>
              </thead>
              <tbody>
                {['min', 'median', 'max'].map((key) => (
                  <tr key={key}>
                    <td className="align-left">{key[0].toUpperCase() + key.slice(1)}</td>
                    <td className={tone(roll?.fund?.[key])}>{pct(roll?.fund?.[key])}</td>
                    <td className={tone(roll?.bench?.[key])}>{pct(roll?.bench?.[key])}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="strategy-muted mf-chart-note">
              Since {data.series.dates[0]} · {BENCHMARK_LABEL} = HDFC Nifty 50 Index Fund (Direct)
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
