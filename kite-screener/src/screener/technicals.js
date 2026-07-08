// Rule-based technical analysis on a daily close/NAV series.
//
// Implements the classic indicators (SMA, EMA, RSI, MACD, Bollinger Bands,
// momentum, moving-average crossover, drawdown) and combines them into a simple
// weighted composite signal. This is deterministic and rule-based — a starting
// point for research, NOT investment advice.

export function sma(values, period) {
  if (values.length < period) return null;
  let sum = 0;
  for (let i = values.length - period; i < values.length; i += 1) sum += values[i];
  return sum / period;
}

function smaSeries(values, period) {
  const out = [];
  if (values.length < period) return out;
  let sum = 0;
  for (let i = 0; i < period; i += 1) sum += values[i];
  out[period - 1] = sum / period;
  for (let i = period; i < values.length; i += 1) {
    sum += values[i] - values[i - period];
    out[i] = sum / period;
  }
  return out;
}

function emaSeries(values, period) {
  if (values.length < period) return [];
  const k = 2 / (period + 1);
  const out = [];
  let prev = 0;
  for (let i = 0; i < period; i += 1) prev += values[i];
  prev /= period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i += 1) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

export function ema(values, period) {
  const series = emaSeries(values, period);
  return series.length ? series[series.length - 1] : null;
}

export function rsi(values, period = 14) {
  if (values.length < period + 1) return null;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i += 1) {
    const change = values[i] - values[i - 1];
    if (change >= 0) gain += change;
    else loss -= change;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  for (let i = period + 1; i < values.length; i += 1) {
    const change = values[i] - values[i - 1];
    const g = change > 0 ? change : 0;
    const l = change < 0 ? -change : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export function macd(values, fast = 12, slow = 26, signalPeriod = 9) {
  if (values.length < slow + signalPeriod) return null;
  const emaFast = emaSeries(values, fast);
  const emaSlow = emaSeries(values, slow);

  const macdVals = [];
  for (let i = 0; i < values.length; i += 1) {
    if (emaFast[i] != null && emaSlow[i] != null) macdVals.push(emaFast[i] - emaSlow[i]);
  }
  if (macdVals.length < signalPeriod) return null;

  const signalSeries = emaSeries(macdVals, signalPeriod);
  const macdNow = macdVals[macdVals.length - 1];
  const signalNow = signalSeries[signalSeries.length - 1] ?? null;
  return { macd: macdNow, signal: signalNow, hist: signalNow != null ? macdNow - signalNow : null };
}

export function bollinger(values, period = 20, mult = 2) {
  if (values.length < period) return null;
  const slice = values.slice(-period);
  const mid = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((a, b) => a + (b - mid) ** 2, 0) / period;
  const sd = Math.sqrt(variance);
  const upper = mid + mult * sd;
  const lower = mid - mult * sd;
  const last = values[values.length - 1];
  const percentB = upper === lower ? 0.5 : (last - lower) / (upper - lower);
  return { upper, mid, lower, percentB };
}

function momentum(values, lookback) {
  if (values.length <= lookback) return null;
  const past = values[values.length - 1 - lookback];
  const last = values[values.length - 1];
  if (!past) return null;
  return (last / past - 1) * 100;
}

function drawdownStats(values) {
  const ath = Math.max(...values);
  const last = values[values.length - 1];
  return { ath, currentDrawdown: (last / ath - 1) * 100 };
}

function detectCross(series50, series200, within) {
  let lastSign = null;
  let crossIndex = -1;
  let crossType = null;

  for (let i = 0; i < series50.length; i += 1) {
    if (series50[i] == null || series200[i] == null) continue;
    const sign = Math.sign(series50[i] - series200[i]);
    if (lastSign != null && sign !== 0 && sign !== lastSign) {
      crossIndex = i;
      crossType = sign > 0 ? 'golden' : 'death';
    }
    if (sign !== 0) lastSign = sign;
  }

  const recent = crossIndex >= 0 && series50.length - 1 - crossIndex <= within;
  const regime = lastSign > 0 ? 'golden' : lastSign < 0 ? 'death' : null;
  return { type: crossType, recent, regime };
}

/**
 * Wilder's ADX(14) with directional indicators. Needs high/low/close arrays.
 * ADX measures TREND STRENGTH (not direction); +DI/-DI give direction.
 */
export function adx(highs, lows, closes, period = 14) {
  const n = closes.length;
  if (!highs || !lows || highs.length !== n || lows.length !== n || n < period * 2 + 1) return null;

  const tr = [];
  const plusDM = [];
  const minusDM = [];
  for (let i = 1; i < n; i += 1) {
    const upMove = highs[i] - highs[i - 1];
    const downMove = lows[i - 1] - lows[i];
    plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
    const highLow = highs[i] - lows[i];
    const highClose = Math.abs(highs[i] - closes[i - 1]);
    const lowClose = Math.abs(lows[i] - closes[i - 1]);
    tr.push(Math.max(highLow, highClose, lowClose));
  }

  if (tr.length < period) return null;

  // Wilder running sum (seed = simple sum of first `period`).
  const wilder = (arr) => {
    const out = [];
    let sum = 0;
    for (let i = 0; i < period; i += 1) sum += arr[i];
    out[period - 1] = sum;
    for (let i = period; i < arr.length; i += 1) {
      out[i] = out[i - 1] - out[i - 1] / period + arr[i];
    }
    return out;
  };

  const trS = wilder(tr);
  const plusS = wilder(plusDM);
  const minusS = wilder(minusDM);

  const dx = [];
  for (let i = period - 1; i < tr.length; i += 1) {
    const trv = trS[i];
    if (!trv) { dx.push(0); continue; }
    const plusDI = (100 * plusS[i]) / trv;
    const minusDI = (100 * minusS[i]) / trv;
    const diSum = plusDI + minusDI;
    dx.push(diSum === 0 ? 0 : (100 * Math.abs(plusDI - minusDI)) / diSum);
  }

  if (dx.length < period) return null;

  let adxVal = 0;
  for (let i = 0; i < period; i += 1) adxVal += dx[i];
  adxVal /= period;
  for (let i = period; i < dx.length; i += 1) {
    adxVal = (adxVal * (period - 1) + dx[i]) / period;
  }

  const lastTr = trS[trS.length - 1];
  const plusDI = lastTr ? (100 * plusS[plusS.length - 1]) / lastTr : 0;
  const minusDI = lastTr ? (100 * minusS[minusS.length - 1]) / lastTr : 0;
  return { adx: adxVal, plusDI, minusDI };
}

/**
 * Annualised Sortino ratio: excess return per unit of DOWNSIDE volatility.
 * Rewards steady compounding and ignores upside volatility (unlike Sharpe).
 */
export function sortino(closes, { periodsPerYear = 252, targetReturn = 0 } = {}) {
  const values = (closes || []).map(Number).filter((v) => Number.isFinite(v) && v > 0);
  if (values.length < 30) return null;

  const returns = [];
  for (let i = 1; i < values.length; i += 1) {
    returns.push(values[i] / values[i - 1] - 1);
  }
  if (returns.length < 20) return null;

  const dailyTarget = targetReturn / periodsPerYear;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;

  let downsideSq = 0;
  for (const r of returns) {
    const diff = r - dailyTarget;
    if (diff < 0) downsideSq += diff * diff;
  }
  const downsideDev = Math.sqrt(downsideSq / returns.length);
  if (downsideDev === 0) return null;

  const annReturn = mean * periodsPerYear;
  const annDownside = downsideDev * Math.sqrt(periodsPerYear);
  return (annReturn - targetReturn) / annDownside;
}

/**
 * Analyse a series of closing prices / NAVs and produce a composite signal.
 * @param {number[]} closes ascending price/NAV series
 * @param {{highs?: number[], lows?: number[], benchmarkCloses?: number[]}} [options]
 * @returns analysis object, or null when there is not enough data
 */
export function analyzeCloses(closes, options = {}) {
  const rawCloses = (closes || []).map(Number);
  const values = rawCloses.filter((v) => Number.isFinite(v) && v > 0);
  if (values.length < 30) return null;

  const { highs, lows, benchmarkCloses } = options;
  const last = values[values.length - 1];
  const s50 = sma(values, 50);
  const s200 = sma(values, 200);
  const rsiValue = rsi(values, 14);
  const macdValue = macd(values);
  const boll = bollinger(values);
  const mom3m = momentum(values, 63);
  const mom6m = momentum(values, 126);
  const mom12m = momentum(values, 252);
  const dd = drawdownStats(values);
  const cross = detectCross(smaSeries(values, 50), smaSeries(values, 200), 12);

  const adxData = highs && lows && highs.length === rawCloses.length
    ? adx(highs.map(Number), lows.map(Number), rawCloses, 14)
    : null;
  const sortinoValue = sortino(values);
  const benchmarkValues = (benchmarkCloses || []).map(Number).filter((v) => Number.isFinite(v) && v > 0);
  const relativeStrength = benchmarkValues.length > 30 && mom6m != null
    ? mom6m - (momentum(benchmarkValues, 126) ?? 0)
    : null;

  let score = 0;
  const signals = [];

  if (s200 != null) {
    if (last > s200) { score += 2; signals.push({ label: 'Long-term trend', value: 'Above 200-DMA', tone: 'up' }); }
    else { score -= 2; signals.push({ label: 'Long-term trend', value: 'Below 200-DMA', tone: 'down' }); }
  }

  if (s50 != null) {
    if (last > s50) { score += 1; signals.push({ label: 'Short-term trend', value: 'Above 50-DMA', tone: 'up' }); }
    else { score -= 1; signals.push({ label: 'Short-term trend', value: 'Below 50-DMA', tone: 'down' }); }
  }

  if (cross.regime === 'golden') score += 1.5;
  else if (cross.regime === 'death') score -= 1.5;

  if (cross.recent && cross.type === 'golden') {
    score += 1.5;
    signals.push({ label: '50 / 200 DMA', value: 'Recent golden cross', tone: 'up' });
  } else if (cross.recent && cross.type === 'death') {
    score -= 1.5;
    signals.push({ label: '50 / 200 DMA', value: 'Recent death cross', tone: 'down' });
  } else if (cross.regime) {
    signals.push({
      label: '50 / 200 DMA',
      value: cross.regime === 'golden' ? 'Golden regime' : 'Death regime',
      tone: cross.regime === 'golden' ? 'up' : 'down',
    });
  }

  if (rsiValue != null) {
    let tone = '';
    let note = 'neutral';
    if (rsiValue > 70) { score -= 0.5; tone = 'down'; note = 'overbought'; }
    else if (rsiValue < 30) { score += 0.5; tone = 'up'; note = 'oversold'; }
    else if (rsiValue >= 55) { score += 1; tone = 'up'; note = 'bullish'; }
    else if (rsiValue < 45) { score -= 1; tone = 'down'; note = 'weak'; }
    signals.push({ label: 'RSI (14)', value: `${rsiValue.toFixed(0)} · ${note}`, tone });
  }

  if (macdValue && macdValue.hist != null) {
    if (macdValue.hist > 0) { score += 1; signals.push({ label: 'MACD', value: 'Bullish (above signal)', tone: 'up' }); }
    else { score -= 1; signals.push({ label: 'MACD', value: 'Bearish (below signal)', tone: 'down' }); }
  }

  if (mom6m != null) {
    score += mom6m > 0 ? 1 : -1;
    signals.push({ label: '6M momentum', value: `${mom6m > 0 ? '+' : ''}${mom6m.toFixed(1)}%`, tone: mom6m > 0 ? 'up' : 'down' });
  }

  if (mom12m != null) score += mom12m > 0 ? 0.5 : -0.5;

  if (boll) {
    if (boll.percentB > 1) score -= 0.5;
    else if (boll.percentB < 0) score += 0.5;
  }

  signals.push({
    label: 'From all-time high',
    value: `${dd.currentDrawdown.toFixed(1)}%`,
    tone: dd.currentDrawdown < -20 ? 'down' : '',
  });

  // Relative strength vs benchmark (e.g. Nifty) — leaders outperform.
  if (relativeStrength != null) {
    score += relativeStrength > 0 ? 1 : -1;
    signals.push({
      label: 'RS vs Nifty (6M)',
      value: `${relativeStrength > 0 ? '+' : ''}${relativeStrength.toFixed(1)}%`,
      tone: relativeStrength > 0 ? 'up' : 'down',
    });
  }

  // Sortino — risk-adjusted (downside) quality of returns.
  if (sortinoValue != null) {
    if (sortinoValue >= 2) score += 1.5;
    else if (sortinoValue >= 1) score += 1;
    else if (sortinoValue < 0) score -= 1;
    signals.push({
      label: 'Sortino ratio',
      value: sortinoValue.toFixed(2),
      tone: sortinoValue >= 1 ? 'up' : sortinoValue < 0 ? 'down' : '',
    });
  }

  // ADX — trend strength. Adds a directional vote in a strong trend, then acts
  // as a conviction multiplier: amplify the whole score in a strong trend, damp
  // it when the market is choppy (where oscillator/trend signals are unreliable).
  if (adxData) {
    const strong = adxData.adx >= 25;
    const weak = adxData.adx < 20;
    const dirUp = adxData.plusDI >= adxData.minusDI;
    if (strong) score += dirUp ? 1 : -1;
    signals.push({
      label: 'ADX (14)',
      value: `${adxData.adx.toFixed(0)} · ${strong ? 'strong' : weak ? 'weak/choppy' : 'building'} ${dirUp ? 'up' : 'down'}`,
      tone: strong ? (dirUp ? 'up' : 'down') : '',
    });
    score *= strong ? 1.15 : weak ? 0.7 : 1;
  }

  let rating;
  let ratingTone;
  if (score >= 6) { rating = 'Strong Buy'; ratingTone = 'up'; }
  else if (score >= 2.5) { rating = 'Buy'; ratingTone = 'up'; }
  else if (score > -2.5) { rating = 'Hold'; ratingTone = 'neutral'; }
  else if (score > -6) { rating = 'Reduce'; ratingTone = 'down'; }
  else { rating = 'Sell / Avoid'; ratingTone = 'down'; }

  return {
    last,
    sma50: s50,
    sma200: s200,
    rsi: rsiValue,
    macd: macdValue,
    bollinger: boll,
    mom3m,
    mom6m,
    mom12m,
    drawdown: dd,
    cross,
    adx: adxData,
    sortino: sortinoValue,
    relativeStrength,
    score,
    rating,
    ratingTone,
    signals,
    barsUsed: values.length,
  };
}
