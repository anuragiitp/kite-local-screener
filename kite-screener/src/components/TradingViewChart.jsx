import { useEffect, useMemo, useRef, useState } from 'react';
import { CrosshairMode, LineStyle, createChart } from 'lightweight-charts';
import { buildChartData, formatChange, formatLiveQuote, formatPrice, visibleRangeForDays } from '../screener/chartData';
import { formatSessionLabel, MAX_HISTORICAL_DAYS } from '../screener/kiteApi';

export const CHART_RANGES = [
  { id: '1D', label: '1d', days: 1, intraday: true },
  { id: '5D', label: '5d', days: 5, intraday: true },
  { id: '1M', label: '1m', days: 30 },
  { id: '3M', label: '3m', days: 90 },
  { id: '6M', label: '6m', days: 180 },
  { id: '1Y', label: '1yr', days: 365 },
  { id: '5Y', label: '5yr', days: 1825 },
  { id: 'ALL', label: 'All', days: MAX_HISTORICAL_DAYS },
];

const DEFAULT_RANGE = '6M';

export default function TradingViewChart({
  candles,
  rangeId = DEFAULT_RANGE,
  onRangeChange,
  isIntraday = false,
  sessionDate = null,
  sessionIsToday = true,
  symbol = '',
  nativeChartUrl = '',
  athInfo = null,
  liveLastPrice = null,
  liveChangePercent = null,
}) {
  const wrapRef = useRef(null);
  const chartRef = useRef(null);
  const seriesRef = useRef(null);
  const [chartType, setChartType] = useState('candle');
  const [basePriceMeta, setBasePriceMeta] = useState(formatChange(null));
  const [hoverPriceMeta, setHoverPriceMeta] = useState(null);

  const activeRange = CHART_RANGES.find((range) => range.id === rangeId) || CHART_RANGES[2];
  const periodDays = activeRange.days;

  const chartData = useMemo(
    () => buildChartData(candles, { intraday: isIntraday }),
    [candles, isIntraday],
  );

  const livePriceMeta = useMemo(
    () => formatLiveQuote(liveLastPrice, liveChangePercent),
    [liveLastPrice, liveChangePercent],
  );

  const priceMeta = hoverPriceMeta ?? livePriceMeta ?? basePriceMeta;

  const applyVisibleRange = (chart) => {
    if (!chart || !chartData.candles.length) return;
    const range = visibleRangeForDays(chartData.candles, periodDays, { intraday: isIntraday });
    if (range) chart.timeScale().setVisibleRange(range);
    else chart.timeScale().fitContent();
  };

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap || !chartData.candles.length) return undefined;

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
        vertLines: { color: 'rgba(208,215,222,0.45)' },
        horzLines: { color: 'rgba(208,215,222,0.45)' },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: '#9aacba', labelBackgroundColor: '#4a5568' },
        horzLine: { color: '#9aacba', labelBackgroundColor: '#4a5568' },
      },
      rightPriceScale: {
        borderColor: '#d0d7de',
        scaleMargins: { top: 0.06, bottom: 0.22 },
      },
      timeScale: {
        borderColor: '#d0d7de',
        timeVisible: isIntraday,
        secondsVisible: false,
        rightOffset: isIntraday ? 4 : 10,
        fixLeftEdge: false,
        fixRightEdge: false,
      },
    });

    const volSeries = chart.addHistogramSeries({
      priceFormat: { type: 'volume' },
      priceScaleId: 'vol',
    });
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    volSeries.setData(chartData.volume);

    const candleSeries = chart.addCandlestickSeries({
      upColor: '#26a69a',
      downColor: '#ef5350',
      borderVisible: false,
      wickUpColor: '#26a69a',
      wickDownColor: '#ef5350',
    });
    candleSeries.setData(chartData.candles);

    const areaSeries = chart.addAreaSeries({
      lineColor: '#1565C0',
      topColor: 'rgba(21,101,192,0.18)',
      bottomColor: 'rgba(21,101,192,0.01)',
      lineWidth: 2,
      visible: false,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    areaSeries.setData(chartData.candles.map((candle) => ({ time: candle.time, value: candle.close })));

    let sma50Series = null;
    let sma200Series = null;

    if (!isIntraday && chartData.sma50.length) {
      sma50Series = chart.addLineSeries({
        color: '#E65100',
        lineWidth: 1.5,
        priceLineVisible: false,
        lastValueVisible: true,
        title: '50D',
      });
      sma50Series.setData(chartData.sma50);
    }

    if (!isIntraday && chartData.sma200.length) {
      sma200Series = chart.addLineSeries({
        color: '#B71C1C',
        lineWidth: 1.5,
        lineStyle: LineStyle.Dashed,
        priceLineVisible: false,
        lastValueVisible: true,
        title: '200D',
      });
      sma200Series.setData(chartData.sma200);
    }

    const lastCandle = chartData.candles[chartData.candles.length - 1];
    setBasePriceMeta(formatChange(lastCandle));
    setHoverPriceMeta(null);

    chart.subscribeCrosshairMove((param) => {
      if (param.time && param.seriesData.has(candleSeries)) {
        setHoverPriceMeta(formatChange(param.seriesData.get(candleSeries)));
      } else {
        setHoverPriceMeta(null);
      }
    });

    const range = visibleRangeForDays(chartData.candles, periodDays, { intraday: isIntraday });
    if (range) chart.timeScale().setVisibleRange(range);
    else chart.timeScale().fitContent();

    chartRef.current = chart;
    seriesRef.current = { candleSeries, areaSeries };

    // Container width may not be final on first paint (dashboard grid, tab switch).
    // Nudge the size on the next frames so autoSize picks up the real width.
    const raf1 = requestAnimationFrame(() => {
      if (wrap.clientWidth > 0) {
        chart.resize(wrap.clientWidth, wrap.clientHeight || 460);
        applyVisibleRange(chart);
      }
    });

    return () => {
      cancelAnimationFrame(raf1);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [chartData, isIntraday]);

  useEffect(() => {
    applyVisibleRange(chartRef.current);
  }, [rangeId, periodDays, isIntraday, chartData.candles.length]);

  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;

    series.candleSeries.applyOptions({ visible: chartType === 'candle' });
    series.areaSeries.applyOptions({ visible: chartType === 'line' });
  }, [chartType, chartData]);

  if (!chartData.candles.length) {
    return (
      <div className="chart-placeholder">
        {isIntraday ? 'No recent intraday session found.' : 'Not enough data to plot.'}
      </div>
    );
  }

  const sessionLabel = isIntraday && sessionDate && !sessionIsToday
    ? formatSessionLabel(sessionDate)
    : '';

  const athDateLabel = athInfo?.athDate
    ? new Date(athInfo.athDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
    : '';
  const athTooltip = athInfo
    ? `ATH ${formatPrice(athInfo.ath)}${athDateLabel ? ` on ${athDateLabel}` : ''}`
    : '';
  const athAtHigh = athInfo && athInfo.drawdownPct > -0.05;
  const athNear = athInfo && athInfo.drawdownPct >= -3;

  return (
    <div className="tv-chart">
      <div className="tv-chart-toolbar">
        {symbol && <span className="tv-chart-symbol">{symbol}</span>}
        <div className="chart-pill-group">
          {CHART_RANGES.map((range) => (
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
        {sessionLabel && (
          <span className="chart-session-label" title="Last trading session">
            {sessionLabel}
          </span>
        )}
        <div className="chart-type-toggle">
          <button
            type="button"
            className={`ct-btn${chartType === 'candle' ? ' active' : ''}`}
            title="Candlestick"
            onClick={() => setChartType('candle')}
          >
            Candle
          </button>
          <button
            type="button"
            className={`ct-btn${chartType === 'line' ? ' active' : ''}`}
            title="Line"
            onClick={() => setChartType('line')}
          >
            Line
          </button>
        </div>
        <div className="tv-chart-meta" style={{ color: priceMeta.color }}>
          {priceMeta.text}
        </div>
        {athInfo && (
          <span
            className={`tv-chart-ath-pill${athNear ? ' near-ath' : ' below-ath'}`}
            title={athTooltip}
          >
            <span className="tv-chart-ath-price">ATH {formatPrice(athInfo.ath)}</span>
            <span className="tv-chart-ath-sep">·</span>
            <span className="tv-chart-ath-dd">
              {athAtHigh ? 'At ATH' : `↓${Math.abs(athInfo.drawdownPct).toFixed(1)}%`}
            </span>
          </span>
        )}
        {nativeChartUrl && (
          <a
            className="ghost-link tv-chart-kite"
            href={nativeChartUrl}
            target="_blank"
            rel="noreferrer"
          >
            Open in Kite
          </a>
        )}
      </div>
      <div className="chart-lw-wrap" ref={wrapRef} />
    </div>
  );
}
