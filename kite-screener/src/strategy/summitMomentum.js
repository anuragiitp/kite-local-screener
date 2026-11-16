// SUMMIT-20 (Summit Momentum) rules engine — a pure port of backtest/engine.py for Rule C.
// See strategies/summit-momentum.md. No I/O here; works in the browser and in node (parity test).

export const SUMMIT_20 = {
  code: 'SUMMIT-20',
  name: 'Summit Momentum',
  version: '1.0',
  schedule: 'monthly',
  rulebook: 'strategies/summit-momentum.md',
};

/** Nav/view id for the strategy page (kept apart from screener preset ids). */
export const STRATEGY_VIEW_ID = `strategy:${SUMMIT_20.code}`;

export const DEFAULT_CONFIG = Object.freeze({
  capital: 1000000,
  topN: 20,
  buyRank: 30,
  exitRank: 40,
  maExit: 200,
  rideMa: 50,
  breakoutDays: 252,
  nearHigh: 0.10,
  lookbacks: [252, 126],
  skip: 21,
  volDays: 252,
  volMin: 200,
  maxMove: 0.25,
  minTradedValue: 5e7,
  tvDays: 60,
  tvMin: 40,
  minHistory: 250,
  histWindow: 273,
  ffillLimit: 10,
  staleDays: 10,
  benchMa: 200,
  benchMaMin: 150,
  minBuyFraction: 0.2,
  cost: 0.0025,
  cashRate: 0.06,
});

export const SELL_REASONS = {
  S1: 'Not eligible (left Nifty 500, low liquidity, suspended or no price)',
  S2: 'Close below 200-day average',
  S3: 'Rank worse than 40 and close below 50-day average',
};

export const BUY_CHECKS = {
  B1: 'Already held or being sold',
  B2: 'Close not above 200-day average',
  B3: 'Close below 90% of 52-week high',
  B4: 'Moved more than 25% in a day within the last year',
};

const derived = new WeakMap();

function num(v) {
  return v === null || v === undefined ? NaN : Number(v);
}

/** Forward-filled close (limit N) and daily returns, cached per series object. */
export function seriesData(series, cfg = DEFAULT_CONFIG) {
  let cached = derived.get(series);
  if (cached) return cached;
  const close = series.close;
  const n = close.length;
  const af = new Float64Array(n);
  let last = NaN;
  let gap = 0;
  for (let k = 0; k < n; k += 1) {
    const c = num(close[k]);
    if (Number.isFinite(c)) {
      af[k] = c;
      last = c;
      gap = 0;
    } else {
      gap += 1;
      af[k] = gap <= cfg.ffillLimit ? last : NaN;
    }
  }
  const ret = new Float64Array(n);
  ret[0] = NaN;
  for (let k = 1; k < n; k += 1) ret[k] = af[k] / af[k - 1] - 1;
  cached = { af, ret };
  derived.set(series, cached);
  return cached;
}

function rollingMean(arr, i, window, minCount) {
  let sum = 0;
  let count = 0;
  for (let k = Math.max(0, i - window + 1); k <= i; k += 1) {
    const v = arr[k];
    if (Number.isFinite(v)) {
      sum += v;
      count += 1;
    }
  }
  return count >= minCount ? sum / count : NaN;
}

function rollingMax(arr, i, window) {
  let best = NaN;
  for (let k = Math.max(0, i - window + 1); k <= i; k += 1) {
    const v = arr[k];
    if (Number.isFinite(v) && !(v <= best)) best = v;
  }
  return best;
}

function rollingStd(arr, i, window, minCount) {
  let sum = 0;
  let count = 0;
  for (let k = Math.max(0, i - window + 1); k <= i; k += 1) {
    const v = arr[k];
    if (Number.isFinite(v)) {
      sum += v;
      count += 1;
    }
  }
  if (count < minCount || count < 2) return NaN;
  const mean = sum / count;
  let ss = 0;
  for (let k = Math.max(0, i - window + 1); k <= i; k += 1) {
    const v = arr[k];
    if (Number.isFinite(v)) ss += (v - mean) ** 2;
  }
  return Math.sqrt(ss / (count - 1));
}

function rollingMedian(arr, i, window, minCount) {
  const values = [];
  for (let k = Math.max(0, i - window + 1); k <= i; k += 1) {
    const v = num(arr[k]);
    if (Number.isFinite(v)) values.push(v);
  }
  if (values.length < minCount) return NaN;
  values.sort((a, b) => a - b);
  const mid = values.length >> 1;
  return values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
}

/** All per-stock numbers the rules need, as of row i (data up to and including row i). */
export function indicatorsAt(series, i, cfg = DEFAULT_CONFIG) {
  const { af, ret } = seriesData(series, cfg);
  let hist = 0;
  for (let k = Math.max(0, i - cfg.histWindow + 1); k <= i; k += 1) {
    if (Number.isFinite(num(series.close[k]))) hist += 1;
  }
  const logr = [];
  for (let k = Math.max(0, i - cfg.volDays + 1); k <= i; k += 1) logr.push(Math.log1p(ret[k]));
  const vol = rollingStd(logr, logr.length - 1, cfg.volDays, cfg.volMin) * Math.sqrt(252);
  let bigMove = false;
  for (let k = Math.max(0, i - cfg.volDays + 1); k <= i; k += 1) {
    if (Math.abs(ret[k]) > cfg.maxMove) {
      bigMove = true;
      break;
    }
  }
  const momentum = cfg.lookbacks.map((lb) => (i - lb >= 0 ? af[i - cfg.skip] / af[i - lb] - 1 : NaN));
  return {
    close: af[i],
    hist,
    tv: rollingMedian(series.tval || [], i, cfg.tvDays, cfg.tvMin),
    vol,
    bigMove,
    maExit: rollingMean(af, i, cfg.maExit, Math.floor(cfg.maExit * 0.8)),
    rideMa: rollingMean(af, i, cfg.rideMa, Math.floor(cfg.rideMa * 0.8)),
    high: rollingMax(af, i, cfg.breakoutDays),
    momentum,
  };
}

function zScores(values) {
  const clean = values.map((v) => (Number.isFinite(v) ? v : NaN));
  const finite = clean.filter(Number.isFinite);
  if (finite.length < 2) return clean.map((v) => v * 0);
  const mean = finite.reduce((a, b) => a + b, 0) / finite.length;
  const sd = Math.sqrt(finite.reduce((a, b) => a + (b - mean) ** 2, 0) / (finite.length - 1));
  if (!sd) return clean.map((v) => v * 0);
  return clean.map((v) => Math.max(-3, Math.min(3, (v - mean) / sd)));
}

export function marketCheck(panel, i, cfg = DEFAULT_CONFIG) {
  const bench = panel.bench;
  const level = num(bench[i]);
  const ma = rollingMean(Array.from(bench, num), i, cfg.benchMa, cfg.benchMaMin);
  const riskOff = Number.isFinite(ma) && level < ma;
  return { level, ma, riskOff };
}

/**
 * Score and rank the universe on row i.
 * Returns { ranked: [{sym, rank, score, ind}], info: Map(sym -> {eligible, why, ind, rank}) }.
 */
export function rankUniverse(panel, i, universe, cfg = DEFAULT_CONFIG) {
  const info = new Map();
  const minRow = Math.max(...cfg.lookbacks) + cfg.skip;
  const rows = [];
  for (const sym of universe) {
    const series = panel.series[sym];
    if (!series) {
      info.set(sym, { eligible: false, why: 'no data' });
      continue;
    }
    const ind = indicatorsAt(series, i, cfg);
    let why = '';
    if (!Number.isFinite(ind.close)) why = 'no recent price';
    else if (!(ind.hist >= cfg.minHistory)) why = 'under 1 year of history';
    else if (!(ind.tv >= cfg.minTradedValue)) why = 'traded value below Rs 5 cr';
    info.set(sym, { eligible: !why, why, ind });
    if (!why) rows.push({ sym, ind });
  }
  if (i < minRow) return { ranked: [], info };

  const parts = cfg.lookbacks.map((_, p) => zScores(rows.map((r) => r.ind.momentum[p] / r.ind.vol)));
  const scored = [];
  rows.forEach((row, k) => {
    const score = parts.reduce((sum, z) => sum + z[k], 0) / parts.length;
    if (Number.isFinite(score)) scored.push({ sym: row.sym, score, ind: row.ind });
    else info.get(row.sym).why = 'not enough data to score';
  });
  scored.sort((a, b) => b.score - a.score);
  scored.forEach((row, k) => {
    row.rank = k + 1;
    info.get(row.sym).rank = row.rank;
  });
  return { ranked: scored, info };
}

/**
 * Apply sell rules S1-S3 and buy checks B1-B4 on row i.
 * holdings: array of symbols currently held.
 */
export function decide(panel, i, universe, holdings, cfg = DEFAULT_CONFIG) {
  const { ranked, info } = rankUniverse(panel, i, universe, cfg);
  const market = marketCheck(panel, i, cfg);
  const rankOf = new Map(ranked.map((r) => [r.sym, r.rank]));

  const sells = [];
  const holds = [];
  for (const sym of holdings) {
    const series = panel.series[sym];
    const ind = series ? indicatorsAt(series, i, cfg) : null;
    const rank = rankOf.get(sym) ?? Infinity;
    const close = ind ? ind.close : NaN;
    const riding = Number.isFinite(rank) && Number.isFinite(ind?.rideMa) && close >= ind.rideMa;
    const base = { sym, rank: Number.isFinite(rank) ? rank : null, close, maExit: ind?.maExit, rideMa: ind?.rideMa };
    if (!Number.isFinite(rank)) {
      const why = info.get(sym)?.why || 'not in Nifty 500 list';
      sells.push({ ...base, code: 'S1', reason: `${SELL_REASONS.S1}: ${why}` });
    } else if (Number.isFinite(ind.maExit) && close < ind.maExit) {
      sells.push({ ...base, code: 'S2', reason: SELL_REASONS.S2 });
    } else if (rank > cfg.exitRank && !riding) {
      sells.push({ ...base, code: 'S3', reason: SELL_REASONS.S3 });
    } else {
      holds.push({ ...base, code: 'S4', reason: rank > cfg.exitRank ? 'Riding winner (above 50-day average)' : 'Rank within 40' });
    }
  }

  const sellSet = new Set(sells.map((s) => s.sym));
  const held = new Set(holdings);
  const buys = [];
  const skipped = [];
  let slots = cfg.topN - (holdings.length - sells.length);
  const freeSlots = slots;
  if (!market.riskOff) {
    for (const row of ranked.slice(0, cfg.buyRank)) {
      if (slots <= 0) break;
      const { ind } = row;
      let code = '';
      if (held.has(row.sym) || sellSet.has(row.sym)) code = 'B1';
      else if (!(ind.close >= ind.maExit)) code = 'B2';
      else if (!(ind.close >= ind.high * (1 - cfg.nearHigh))) code = 'B3';
      else if (ind.bigMove) code = 'B4';
      const item = { sym: row.sym, rank: row.rank, score: row.score, close: ind.close, high: ind.high, maExit: ind.maExit };
      if (code) skipped.push({ ...item, code, reason: BUY_CHECKS[code] });
      else {
        buys.push(item);
        slots -= 1;
      }
    }
  }

  return {
    date: panel.dates[i],
    market,
    ranked,
    info,
    sells,
    holds,
    buys,
    skipped,
    freeSlots,
    eligibleCount: ranked.length,
    universeCount: universe.length,
  };
}

/** True when dates[i] is the last session of its month (needs dates[i + 1]). */
export function isMonthEnd(dates, i) {
  return i + 1 < dates.length && dates[i].slice(0, 7) !== dates[i + 1].slice(0, 7);
}

/** Last weekday of the month containing dateStr (a guess at the next signal day; holidays not known). */
export function expectedSignalDay(dateStr) {
  const [y, m] = dateStr.split('-').map(Number);
  const d = new Date(Date.UTC(y, m, 0));
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
