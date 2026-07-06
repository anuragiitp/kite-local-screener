import { useEffect, useMemo, useRef, useState } from 'react';
import { buildKiteChartUrl, fetchHistorical, fetchInstrumentRow } from '../screener/kiteApi';
import { computeAthDrawdown } from '../screener/chartData';
import { isLikelyBogusToken, normalizeBookmark, resolveInstrumentToken } from '../screener/bookmarks';
import { getSymbol } from './ScreenerTable';
import TradingViewChart from './TradingViewChart';
import OrderTicket from './OrderTicket';
import AlertTicket from './AlertTicket';
import FundamentalsModal, { buildStreakTechnicalsUrl, buildTijoriFundamentalsUrl } from './FundamentalsModal';
import TrendPanel from './TrendPanel';

const INTRADAY_RANGES = new Set(['1D', '5D']);

const CHART_FETCH = {
  '1D': { intraday: true, interval: '5minute', sessions: 1 },
  '5D': { intraday: true, interval: '5minute', sessions: 5 },
};

const LIVE_FIELDS = [
  'last_price',
  'change_percent',
  'change',
  'volume',
  'open',
  'high',
  'low',
  'close',
  'prev_close',
  'buy_quantity',
  'sell_quantity',
  'average_price',
  'last_quantity',
  'last_trade_time',
  'timestamp',
  'depth',
];

function mergeInstrumentDetails(screenerRow, tableRow) {
  if (!screenerRow && !tableRow) return null;
  if (!screenerRow) return tableRow;
  if (!tableRow) return screenerRow;

  const merged = { ...screenerRow, ...tableRow };
  LIVE_FIELDS.forEach((key) => {
    const live = tableRow[key];
    if (live !== undefined && live !== null && live !== '') {
      merged[key] = live;
    }
  });

  Object.entries(screenerRow).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    if (LIVE_FIELDS.includes(key)) return;
    if (merged[key] === undefined || merged[key] === null || merged[key] === '') {
      merged[key] = value;
    }
  });

  return merged;
}

function rowHasScreenerDetails(row) {
  const segment = (row?.segment || row?.exchange || '').toUpperCase();
  if (segment === 'INDICES') return true;
  return row?.market_cap != null || row?.pe != null || Boolean(row?.sector);
}

function isOrderableExchange(exchange) {
  return String(exchange || '').toUpperCase() !== 'INDICES';
}

const TRADE_OPEN_KEY = 'kite-screener:trade-open';
const ALERT_OPEN_KEY = 'kite-screener:alert-open';

function readTradeOpen() {
  try {
    return localStorage.getItem(TRADE_OPEN_KEY) === '1';
  } catch {
    return false;
  }
}

function writeTradeOpen(open) {
  try {
    localStorage.setItem(TRADE_OPEN_KEY, open ? '1' : '0');
  } catch {
    /* ignore storage errors */
  }
}

function readAlertOpen() {
  try {
    return localStorage.getItem(ALERT_OPEN_KEY) === '1';
  } catch {
    return false;
  }
}

function writeAlertOpen(open) {
  try {
    localStorage.setItem(ALERT_OPEN_KEY, open ? '1' : '0');
  } catch {
    /* ignore storage errors */
  }
}

export default function ChartPanel({ row }) {
  const symbol = getSymbol(row);
  const exchange = row?.exchange || row?.segment || 'NSE';
  const directToken = row?.instrument_token || row?.token || null;
  // Keep a live reference so fetch effects can read row data without re-running
  // on every websocket tick (which replaces `row` with a new object).
  const rowRef = useRef(row);
  rowRef.current = row;
  const [chartToken, setChartToken] = useState(null);
  const [screenerRow, setScreenerRow] = useState(null);
  const [tradeOpen, setTradeOpen] = useState(readTradeOpen);
  const [alertOpen, setAlertOpen] = useState(readAlertOpen);
  const [widgetModal, setWidgetModal] = useState(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [dailyCandles, setDailyCandles] = useState([]);
  const [intradayCandles, setIntradayCandles] = useState([]);
  const [sessionDate, setSessionDate] = useState(null);
  const [sessionIsToday, setSessionIsToday] = useState(true);
  const [chartRange, setChartRange] = useState('6M');
  const [dailyLoading, setDailyLoading] = useState(false);
  const [intradayLoading, setIntradayLoading] = useState(false);
  const [error, setError] = useState('');

  const isIntraday = INTRADAY_RANGES.has(chartRange);
  const candles = isIntraday ? intradayCandles : dailyCandles;
  const loading = isIntraday ? intradayLoading : dailyLoading;

  const detailRow = useMemo(
    () => mergeInstrumentDetails(screenerRow, row),
    [screenerRow, row],
  );

  const athInfo = useMemo(
    () => computeAthDrawdown(dailyCandles, detailRow?.last_price ?? row?.last_price),
    [dailyCandles, detailRow?.last_price, row?.last_price],
  );

  useEffect(() => {
    if (!symbol) {
      setScreenerRow(null);
      return undefined;
    }

    if (rowHasScreenerDetails(rowRef.current)) {
      setScreenerRow(null);
      setDetailsLoading(false);
      return undefined;
    }

    const controller = new AbortController();
    setDetailsLoading(true);

    fetchInstrumentRow(normalizeBookmark(rowRef.current), controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setScreenerRow(data);
      })
      .catch(() => {
        if (!controller.signal.aborted) setScreenerRow(null);
      })
      .finally(() => {
        if (!controller.signal.aborted) setDetailsLoading(false);
      });

    return () => controller.abort();
  }, [symbol, exchange]);

  useEffect(() => {
    if (directToken && !isLikelyBogusToken(directToken, rowRef.current)) {
      setChartToken(Number(directToken));
      return undefined;
    }

    if (!symbol) {
      setChartToken(null);
      return undefined;
    }

    const controller = new AbortController();
    setChartToken(null);

    resolveInstrumentToken(normalizeBookmark(rowRef.current), controller.signal)
      .then((token) => {
        if (!controller.signal.aborted) setChartToken(token || null);
      })
      .catch(() => {
        if (!controller.signal.aborted) setChartToken(null);
      });

    return () => controller.abort();
  }, [symbol, exchange, directToken]);

  useEffect(() => {
    if (!chartToken) {
      setDailyCandles([]);
      setError('');
      return undefined;
    }

    const controller = new AbortController();
    setDailyLoading(true);
    setError('');

    fetchHistorical(chartToken, { interval: 'day', fullHistory: true }, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) {
          setDailyCandles(Array.isArray(data) ? data : []);
        }
      })
      .catch((fetchError) => {
        if (fetchError.name === 'AbortError') return;
        if (!controller.signal.aborted) {
          setDailyCandles([]);
          setError(fetchError.message || 'Unable to load chart.');
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setDailyLoading(false);
      });

    return () => controller.abort();
  }, [chartToken]);

  useEffect(() => {
    if (!chartToken || !isIntraday) {
      setIntradayCandles([]);
      setSessionDate(null);
      setSessionIsToday(true);
      return undefined;
    }

    const controller = new AbortController();
    const fetchConfig = CHART_FETCH[chartRange] || CHART_FETCH['1D'];
    setIntradayLoading(true);
    setError('');

    fetchHistorical(chartToken, { interval: '5minute', ...fetchConfig }, controller.signal)
      .then((data) => {
        if (controller.signal.aborted) return;
        if (data && !Array.isArray(data)) {
          setIntradayCandles(data.candles || []);
          setSessionDate(data.sessionDate || null);
          setSessionIsToday(Boolean(data.isToday));
          return;
        }
        setIntradayCandles(Array.isArray(data) ? data : []);
        setSessionDate(null);
        setSessionIsToday(true);
      })
      .catch((fetchError) => {
        if (fetchError.name === 'AbortError') return;
        setIntradayCandles([]);
        setError(fetchError.message || 'Unable to load chart.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setIntradayLoading(false);
      });

    return () => controller.abort();
  }, [chartToken, chartRange, isIntraday]);

  const nativeChartUrl = buildKiteChartUrl({ exchange, symbol, token: chartToken });
  const showChart = Boolean(chartToken) && !loading && !error && candles.length > 0;

  return (
    <aside className="chart-panel">
      {!showChart && (
        <div className="chart-toolbar-lite">
          <h2 className="chart-lite-symbol">{symbol || 'Select a row'}</h2>
          {nativeChartUrl && (
            <a className="ghost-link" href={nativeChartUrl} target="_blank" rel="noreferrer">
              Open in Kite
            </a>
          )}
        </div>
      )}

      <div className="chart-area">
        {!symbol && <div className="chart-placeholder">Click a table row to load its price chart.</div>}
        {symbol && !chartToken && <div className="chart-placeholder">Resolving instrument…</div>}
        {chartToken && loading && <div className="chart-placeholder">Loading chart…</div>}
        {chartToken && !loading && error && (
          <div className="chart-placeholder">
            {error}
            {nativeChartUrl && (
              <>
                <br />
                <a href={nativeChartUrl} target="_blank" rel="noreferrer">
                  Open the chart in Kite instead
                </a>
              </>
            )}
          </div>
        )}
        {showChart && (
          <TradingViewChart
            candles={candles}
            rangeId={chartRange}
            onRangeChange={setChartRange}
            isIntraday={isIntraday}
            sessionDate={sessionDate}
            sessionIsToday={sessionIsToday}
            symbol={symbol}
            nativeChartUrl={nativeChartUrl}
            athInfo={athInfo}
            liveLastPrice={detailRow?.last_price ?? row?.last_price}
            liveChangePercent={detailRow?.change_percent ?? row?.change_percent}
          />
        )}
        {chartToken && !loading && !error && candles.length === 0 && (
          <div className="chart-placeholder">
            {chartRange === '1D'
              ? 'No recent intraday session found.'
              : 'Not enough data to plot.'}
          </div>
        )}
      </div>

      {detailRow && (
        <div className="symbol-detail-row">
          <DetailSection
            row={detailRow}
            exchange={exchange}
            loading={detailsLoading}
            onOpenFundamentals={
              symbol && chartToken && isOrderableExchange(exchange)
                ? () => setWidgetModal({
                  provider: 'Tijori Finance',
                  url: buildTijoriFundamentalsUrl(exchange, symbol),
                })
                : null
            }
            onOpenTechnicals={
              symbol && chartToken && isOrderableExchange(exchange)
                ? () => setWidgetModal({
                  provider: 'Streak',
                  url: buildStreakTechnicalsUrl(exchange, symbol),
                })
                : null
            }
          />
          <TrendPanel
            row={detailRow}
            candles={dailyCandles}
            loading={dailyLoading}
            athInfo={athInfo}
          />
          {symbol && chartToken && isOrderableExchange(exchange) && (
            alertOpen ? (
              <AlertTicket
                symbol={symbol}
                exchange={exchange}
                row={detailRow || row}
                onClose={() => setAlertOpen((open) => {
                  writeAlertOpen(!open);
                  return !open;
                })}
              />
            ) : (
              <button
                type="button"
                className="alert-toggle-card"
                onClick={() => setAlertOpen((open) => {
                  writeAlertOpen(!open);
                  return !open;
                })}
                title="Show alert panel"
              >
                <span className="alert-toggle-icon">🔔</span>
                <span className="alert-toggle-label">Alert</span>
              </button>
            )
          )}
          {symbol && chartToken && isOrderableExchange(exchange) && (
            tradeOpen ? (
              <OrderTicket
                symbol={symbol}
                exchange={exchange}
                token={chartToken}
                row={detailRow || row}
                onClose={() => setTradeOpen((open) => {
                  writeTradeOpen(!open);
                  return !open;
                })}
              />
            ) : (
              <button
                type="button"
                className="trade-toggle-card"
                onClick={() => setTradeOpen((open) => {
                  writeTradeOpen(!open);
                  return !open;
                })}
                title="Show trade panel"
              >
                <span className="trade-toggle-icon">₹</span>
                <span className="trade-toggle-label">Trade</span>
              </button>
            )
          )}
        </div>
      )}

      <FundamentalsModal
        symbol={symbol}
        exchange={exchange}
        provider={widgetModal?.provider}
        url={widgetModal?.url}
        open={Boolean(widgetModal)}
        onClose={() => setWidgetModal(null)}
      />
    </aside>
  );
}

function DetailSection({
  row,
  exchange,
  loading = false,
  onOpenFundamentals = null,
  onOpenTechnicals = null,
}) {
  const changeTone = getChangeTone(row?.change_percent ?? row?.net_change ?? row?.change);
  const groupActions = [
    onOpenFundamentals && { label: 'Tijori', onClick: onOpenFundamentals, variant: 'tijori' },
    onOpenTechnicals && { label: 'Technicals', onClick: onOpenTechnicals, variant: 'technicals' },
  ].filter(Boolean);

  return (
    <section className="symbol-detail-table detail-card">
      {loading && <div className="symbol-detail-table-loading">Loading instrument details…</div>}
      <table className="symbol-detail-mini-table detail-table">
          <tbody>
            <DetailGroup title="Fundamentals" actions={groupActions} />
            <Detail label="P/E Ratio" value={formatNumber(row?.pe)} />
            <Detail label="Return on Equity" value={formatPercent(row?.roe)} />
            <Detail label="Debt to Equity" value={formatNumber(row?.debt_to_equity)} />
            <Detail label="Dividend Yield" value={formatPercent(row?.dividend_yield)} tone={getPositiveTone(row?.dividend_yield)} />
            <Detail label="Free Cash Flow" value={formatNumber(row?.free_cash_flow)} tone={getSignTone(row?.free_cash_flow)} />

            <DetailGroup title="Price & volume" />
            <Detail label="Last Price" value={formatNumber(row?.last_price)} />
            <Detail label="Volume" value={formatNumber(row?.volume)} />
            <Detail label="Buy Quantity" value={formatNumber(row?.buy_quantity)} />
            <Detail label="Sell Quantity" value={formatNumber(row?.sell_quantity)} />

            <DetailGroup title="Growth" />
            <Detail label="Change" value={formatNumber(row?.net_change ?? row?.change)} tone={changeTone} />
            <Detail label="Change %" value={formatPercent(row?.change_percent)} tone={changeTone} />
            <Detail label="Revenue Growth YoY (%)" value={formatPercent(row?.revenue_growth_yoy)} tone={getSignTone(row?.revenue_growth_yoy)} />
            <Detail label="Profit Growth YoY (%)" value={formatPercent(row?.pat_growth_yoy)} tone={getSignTone(row?.pat_growth_yoy)} />

            <DetailGroup title="Instrument" />
            <Detail label="ISIN" value={row?.isin} />
            <Detail label="Sector" value={row?.sector} />
            <Detail label="Segment" value={row?.segment || exchange} />
            <Detail label="Market Cap (Cr)" value={formatNumber(row?.market_cap)} />
        </tbody>
      </table>
    </section>
  );
}

function DetailGroup({ title, actions = [] }) {
  return (
    <tr className="detail-group-row">
      <td colSpan={2}>
        <div className="detail-group-head">
          <span className="detail-group-title">{title}</span>
          {actions.length > 0 && (
            <span className="detail-group-actions">
              {actions.map(({ label, onClick, variant = '' }) => (
                <button
                  key={label}
                  type="button"
                  className={`detail-group-action${variant ? ` detail-group-action-${variant}` : ''}`}
                  onClick={onClick}
                  title={`Open ${label}`}
                >
                  {label}
                </button>
              ))}
            </span>
          )}
        </div>
      </td>
    </tr>
  );
}

function Detail({ label, value, tone = '' }) {
  const display = value === undefined || value === null || value === '' ? '-' : value;
  return (
    <tr>
      <td>{label}</td>
      <td className={tone}>{display}</td>
    </tr>
  );
}

function getChangeTone(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number === 0) return '';
  return number > 0 ? 'cell-up' : 'cell-down';
}

function getSignTone(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number === 0) return '';
  return number > 0 ? 'cell-up' : 'cell-down';
}

function getPositiveTone(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return '';
  return 'cell-up';
}

function formatNumber(value) {
  if (value === undefined || value === null || value === '') return '-';
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : String(value);
}

function formatPercent(value) {
  if (value === undefined || value === null || value === '') return '-';
  const number = Number(value);
  return Number.isFinite(number) ? `${number.toFixed(2)}%` : String(value);
}
