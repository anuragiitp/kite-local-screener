import { MAX_HISTORICAL_DAYS } from './kiteApi';

function candleTimeDaily(raw) {
  if (typeof raw === 'string') return raw.slice(0, 10);
  if (typeof raw === 'number') return new Date(raw * 1000).toISOString().slice(0, 10);
  return String(raw).slice(0, 10);
}

function candleTimeIntraday(raw) {
  if (typeof raw === 'number') return raw;
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) return Math.floor(parsed.getTime() / 1000);
  return candleTimeDaily(raw);
}

function calcSMA(values, period) {
  return values.map((_, index) => {
    if (index < period - 1) return null;
    const slice = values.slice(index - period + 1, index + 1);
    const sum = slice.reduce((total, value) => total + value, 0);
    return +(sum / period).toFixed(2);
  });
}

export function buildChartData(rawCandles, { intraday = false } = {}) {
  if (!Array.isArray(rawCandles) || rawCandles.length === 0) {
    return { candles: [], volume: [], sma50: [], sma200: [] };
  }

  const toTime = intraday ? candleTimeIntraday : candleTimeDaily;

  const normalized = rawCandles
    .map((candle) => {
      const time = toTime(candle[0]);
      const open = Number(candle[1]);
      const high = Number(candle[2]);
      const low = Number(candle[3]);
      const close = Number(candle[4]);
      const volume = Number(candle[5]) || 0;

      if (time == null || time === '' || !Number.isFinite(close)) return null;

      return {
        time,
        open: Number.isFinite(open) ? +open.toFixed(2) : close,
        high: Number.isFinite(high) ? +high.toFixed(2) : close,
        low: Number.isFinite(low) ? +low.toFixed(2) : close,
        close: +close.toFixed(2),
        volume,
      };
    })
    .filter(Boolean);

  const closes = normalized.map((candle) => candle.close);
  const sma50 = intraday ? [] : calcSMA(closes, 50);
  const sma200 = intraday ? [] : calcSMA(closes, 200);

  return {
    candles: normalized.map(({ time, open, high, low, close }) => ({ time, open, high, low, close })),
    volume: normalized.map((candle) => ({
      time: candle.time,
      value: candle.volume,
      color: candle.close >= candle.open ? 'rgba(38,166,154,0.5)' : 'rgba(239,83,80,0.5)',
    })),
    sma50: normalized
      .map((candle, index) => (sma50[index] != null ? { time: candle.time, value: sma50[index] } : null))
      .filter(Boolean),
    sma200: normalized
      .map((candle, index) => (sma200[index] != null ? { time: candle.time, value: sma200[index] } : null))
      .filter(Boolean),
  };
}

export function visibleRangeForDays(candles, days, { intraday = false } = {}) {
  if (!candles.length || intraday) return null;
  if (+days >= MAX_HISTORICAL_DAYS) return null;

  const lastDate = candles[candles.length - 1].time;
  const fromDate = new Date(new Date(lastDate).getTime() - Number(days) * 86400000).toISOString().slice(0, 10);
  return { from: fromDate, to: lastDate };
}

export function formatPrice(value) {
  if (value == null) return '—';
  if (value >= 1e5) return `₹${(value / 1e5).toFixed(2)}L`;
  return `₹${Number(value).toLocaleString('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;
}

export function formatChange(candle) {
  if (!candle) return { text: '—', color: '#636c76' };
  const change = candle.close - candle.open;
  const percent = candle.open ? (change / candle.open) * 100 : 0;
  const color = candle.close >= candle.open ? '#1a7f37' : '#cf222e';
  const sign = change >= 0 ? '+' : '';
  return {
    color,
    text: `${formatPrice(candle.close)} ${sign}${percent.toFixed(2)}%`,
  };
}

/** Toolbar / header quote from websocket LTP + day change %. */
export function formatLiveQuote(lastPrice, changePercent) {
  const price = Number(lastPrice);
  if (!Number.isFinite(price) || price <= 0) return null;

  const pct = Number(changePercent);
  let color = '#636c76';
  if (Number.isFinite(pct) && pct !== 0) {
    color = pct > 0 ? '#1a7f37' : '#cf222e';
  }
  const sign = Number.isFinite(pct) && pct > 0 ? '+' : '';
  const pctText = Number.isFinite(pct) ? ` ${sign}${pct.toFixed(2)}%` : '';

  return {
    color,
    text: `${formatPrice(price)}${pctText}`,
  };
}

const TREND_PERIODS = [
  { id: 'day', label: 'Day', tradingDays: 0 },
  { id: '2d', label: '2D', tradingDays: 2 },
  { id: '3d', label: '3D', tradingDays: 3 },
  { id: '4d', label: '4D', tradingDays: 4 },
  { id: '5d', label: '5D', tradingDays: 5 },
  { id: 'month', label: 'Month', tradingDays: 21 },
  { id: '6m', label: '6M', tradingDays: 126 },
  { id: 'year', label: 'Year', tradingDays: 252 },
  { id: '2y', label: '2Y', tradingDays: 504 },
  { id: '3y', label: '3Y', tradingDays: 756 },
  { id: '4y', label: '4Y', tradingDays: 1008 },
  { id: '5y', label: '5Y', tradingDays: 1260 },
];

function pctReturn(current, past) {
  if (!Number.isFinite(current) || !Number.isFinite(past) || past === 0) return null;
  return ((current - past) / past) * 100;
}

function closeAtTradingDaysAgo(rawCandles, tradingDays) {
  if (!Array.isArray(rawCandles) || tradingDays < 0) return null;
  const closes = rawCandles
    .map((candle) => Number(candle?.[4]))
    .filter((close) => Number.isFinite(close));
  if (!closes.length) return null;
  const index = closes.length - 1 - tradingDays;
  if (index < 0) return null;
  return closes[index];
}

/**
 * All-time high (within available history) + drawdown from it.
 * rawCandles are [time, open, high, low, close, volume] arrays.
 */
export function computeAthDrawdown(rawCandles, currentPrice) {
  if (!Array.isArray(rawCandles) || rawCandles.length === 0) return null;

  let ath = -Infinity;
  let athRaw = null;
  for (const candle of rawCandles) {
    const high = Number(candle?.[2]);
    if (Number.isFinite(high) && high > ath) {
      ath = high;
      athRaw = candle?.[0];
    }
  }
  if (!Number.isFinite(ath) || ath <= 0) return null;

  const lastClose = Number(rawCandles[rawCandles.length - 1]?.[4]);
  const live = Number(currentPrice);
  const price = Number.isFinite(live) && live > 0 ? live : lastClose;
  if (!Number.isFinite(price) || price <= 0) return null;

  const drawdownPct = ((price - ath) / ath) * 100;

  return {
    ath,
    athDate: athRaw != null ? candleTimeDaily(athRaw) : null,
    drawdownPct,
    price,
  };
}

/** Compute day/week/month/year % returns from daily candles + live last price. */
export function computePeriodReturns(rawCandles, currentPrice, dayChangePercent = null) {
  if (!Array.isArray(rawCandles) || rawCandles.length === 0) return [];

  const closes = rawCandles
    .map((candle) => Number(candle?.[4]))
    .filter((close) => Number.isFinite(close));
  if (!closes.length) return [];

  const livePrice = Number(currentPrice);
  const price = Number.isFinite(livePrice) && livePrice > 0 ? livePrice : closes[closes.length - 1];

  return TREND_PERIODS.map(({ id, label, tradingDays }) => {
    if (id === 'day') {
      const dayPct = Number(dayChangePercent);
      if (Number.isFinite(dayPct)) {
        return { id, label, percent: dayPct, available: true };
      }
      const prevClose = closeAtTradingDaysAgo(rawCandles, 1);
      return {
        id,
        label,
        percent: pctReturn(price, prevClose),
        available: prevClose != null,
      };
    }

    const baseClose = closeAtTradingDaysAgo(rawCandles, tradingDays);
    return {
      id,
      label,
      percent: pctReturn(price, baseClose),
      available: baseClose != null,
    };
  });
}
