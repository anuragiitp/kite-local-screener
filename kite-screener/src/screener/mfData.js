// Mutual fund data: Kite MF instrument list (direct growth plans), Coin historical NAVs, and
// per-fund return/risk metrics vs the HDFC Nifty 50 Index Fund. Cached in IndexedDB 'kite-mf'.

import { MF_AUM, MF_AUM_DATE, MF_CATEGORIES, MF_CATEGORY_BY_ISIN, MF_NOT_GROWTH } from './mfCategoryData';
import { AMFI_URL, buildReference, fetchCoinAum, parseCsvLine } from './mfReference';

const INSTRUMENTS_URL = 'https://api.kite.trade/mf/instruments';
const NAV_URL = 'https://staticassets.zerodha.com/coin/historical-nav/';
export const BENCHMARK_ISIN = 'INF179K01WM1'; // HDFC Nifty 50 Index Fund - Direct Growth
export const BENCHMARK_LABEL = 'N50';
export const PERIODS = ['1M', '3M', '6M', 'YTD', '1Y', '2Y', '3Y', '4Y', '5Y', '10Y'];
const PERIOD_MONTHS = { '1M': 1, '3M': 3, '6M': 6, '1Y': 12, '2Y': 24, '3Y': 36, '4Y': 48, '5Y': 60, '10Y': 120 };
const RISK_FREE = 0.065;
const CONCURRENCY = 6;
const METRICS_VERSION = 3;

const DB_NAME = 'kite-mf';
const DB_VERSION = 1;
let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('metrics')) db.createObjectStore('metrics', { keyPath: 'key' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      dbPromise = null;
      reject(request.error);
    };
  });
  return dbPromise;
}

async function idbGet(store, key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(store, 'readonly').objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(store, value) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbGetMany(store, keys) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const os = tx.objectStore(store);
    const out = new Map();
    keys.forEach((key) => {
      const req = os.get(key);
      req.onsuccess = () => {
        if (req.result) out.set(key, req.result);
      };
    });
    tx.oncomplete = () => resolve(out);
    tx.onerror = () => reject(tx.error);
  });
}

export function istToday() {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Kolkata' }).slice(0, 10);
}

// ---------- categories / AUM ----------

// Bundled snapshot, replaced by the last in-app update (IndexedDB meta 'reference') when newer.
let reference = {
  categories: MF_CATEGORIES,
  byIsin: MF_CATEGORY_BY_ISIN,
  notGrowth: new Set(MF_NOT_GROWTH),
  aum: MF_AUM,
  aumDate: MF_AUM_DATE,
  updatedOn: '',
};

export function mfReference() {
  return reference;
}

function applyReference(saved) {
  reference = { ...saved, notGrowth: new Set(saved.notGrowth) };
}

export async function loadSavedReference() {
  const saved = await idbGet('meta', 'reference').catch(() => null);
  if (saved?.categories?.length && (saved.aumDate || '') >= (MF_AUM_DATE || '')) applyReference(saved);
  return reference;
}

async function fetchText(url) {
  const { host } = new URL(url);
  const res = await fetch(url, { credentials: 'omit', cache: 'no-store' }).catch((error) => {
    throw new Error(`${host}: ${error?.message || 'network error'}`);
  });
  if (!res.ok) throw new Error(`${host}: HTTP ${res.status}`);
  return res.text();
}

/** Re-derives categories (AMFI) and AUM (Coin) for the given Kite funds; AUM failures keep the old AUM. */
export async function refreshReference(funds) {
  const previous = await idbGet('meta', 'reference').catch(() => null);
  const [amfiText, coin] = await Promise.all([
    fetchText(AMFI_URL),
    fetchCoinAum(fetchText, previous?.coinChunk || '').catch((error) => ({ error })),
  ]);
  const { stats, ...built } = buildReference(
    funds,
    amfiText,
    coin.error ? { aum: reference.aum, date: reference.aumDate } : coin,
  );
  const saved = { key: 'reference', ...built, coinChunk: coin.chunk || previous?.coinChunk || '', updatedOn: istToday() };
  await idbPut('meta', saved);
  applyReference(saved);
  return { stats, warning: coin.error ? `AUM not updated (${coin.error.message}).` : '' };
}

export function fundCategory(isin) {
  const index = reference.byIsin[isin];
  return index === undefined ? null : reference.categories[index];
}

export function shortFundName(name) {
  return String(name || '').replace(/\s*-\s*Direct Plan\s*$/i, '').trim();
}

// ---------- instruments ----------

function parseInstruments(csv) {
  const lines = csv.trim().split(/\r?\n/);
  const head = parseCsvLine(lines[0]);
  const col = Object.fromEntries(head.map((name, i) => [name, i]));
  if (col.tradingsymbol === undefined || col.plan === undefined) throw new Error('Unexpected MF instrument format');
  const list = [];
  for (let i = 1; i < lines.length; i += 1) {
    const c = parseCsvLine(lines[i]);
    if (c[col.plan] !== 'direct' || c[col.dividend_type] !== 'growth') continue;
    list.push({
      isin: c[col.tradingsymbol],
      name: shortFundName(c[col.name]),
      amc: c[col.amc],
      buyable: c[col.purchase_allowed] === '1',
      schemeType: c[col.scheme_type],
      lastPrice: Number(c[col.last_price]) || null,
      lastPriceDate: c[col.last_price_date] || '',
    });
  }
  return list;
}

/**
 * Kite lists some funds several times as "direct growth" (legacy or mislabelled IDCW ISINs).
 * Keeps one per name: AMFI growth plan first, then buyable, then the highest NAV (IDCW NAVs are lower),
 * then the latest NAV date.
 */
export function canonicalFunds(list) {
  const best = new Map();
  const { notGrowth } = reference;
  const better = (a, b) => (
    notGrowth.has(a.isin) !== notGrowth.has(b.isin) ? notGrowth.has(b.isin)
      : a.buyable !== b.buyable ? a.buyable
      : (a.lastPrice || 0) !== (b.lastPrice || 0) ? (a.lastPrice || 0) > (b.lastPrice || 0)
        : a.lastPriceDate > b.lastPriceDate
  );
  list.forEach((fund) => {
    if (/unclaimed/i.test(fund.name)) return;
    const key = fund.name.toLowerCase().replace(/\s+/g, ' ');
    const current = best.get(key);
    if (!current || better(fund, current)) best.set(key, fund);
  });
  const funds = [...best.values()];
  const aliasOf = new Map();
  list.forEach((fund) => {
    const kept = best.get(fund.name.toLowerCase().replace(/\s+/g, ' '));
    if (kept && kept.isin !== fund.isin) aliasOf.set(fund.isin, kept.isin);
  });
  return { funds, aliasOf };
}

export function coinFundUrl(isin) {
  return `https://coin.zerodha.com/mf/fund/${encodeURIComponent(isin)}`;
}

/** Direct-growth funds from Kite. Cached for the IST day; falls back to the last cached copy. */
export async function loadMfInstruments({ force = false } = {}) {
  const today = istToday();
  const cached = await idbGet('meta', 'instruments').catch(() => null);
  if (!force && cached?.day === today && cached.list?.length) return { list: cached.list, error: '' };
  try {
    const res = await fetch(INSTRUMENTS_URL, { credentials: 'omit' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const list = parseInstruments(await res.text());
    if (!list.length) throw new Error('empty list');
    await idbPut('meta', { key: 'instruments', day: today, list }).catch(() => {});
    return { list, error: '' };
  } catch (error) {
    const reason = `Could not load the Kite fund list (${error?.message || 'network error'}). Reload the Kite Local Screener extension in chrome://extensions, then reload this page.`;
    if (cached?.list?.length) return { list: cached.list, error: `${reason} Showing the list cached on ${cached.day}.` };
    return { list: [], error: reason };
  }
}

// ---------- NAV series ----------

const navCache = new Map(); // isin -> Promise<{ dates, navs }>

async function fetchNavSeries(isin, signal) {
  const res = await fetch(`${NAV_URL}${encodeURIComponent(isin)}.json`, { signal, credentials: 'omit' });
  if (res.status === 404) return { dates: [], navs: [] };
  if (!res.ok) throw new Error(`NAV ${isin}: HTTP ${res.status}`);
  const json = await res.json();
  const rows = Array.isArray(json?.data) ? json.data : [];
  const dates = [];
  const navs = [];
  rows.forEach(([ts, nav]) => {
    const value = Number(nav);
    if (!Number.isFinite(value) || value <= 0) return;
    const date = new Date(Number(ts) * 1000).toISOString().slice(0, 10);
    if (dates.length && date <= dates[dates.length - 1]) {
      if (date === dates[dates.length - 1]) navs[navs.length - 1] = value;
      return;
    }
    dates.push(date);
    navs.push(value);
  });
  return { dates, navs };
}

export function getNavSeries(isin, { signal, force = false } = {}) {
  if (!force && navCache.has(isin)) return navCache.get(isin);
  const promise = fetchNavSeries(isin, signal).catch((error) => {
    navCache.delete(isin);
    throw error;
  });
  navCache.set(isin, promise);
  return promise;
}

// ---------- metrics ----------

/** Index of the last date <= target, or -1. */
export function indexAtOrBefore(dates, target) {
  let lo = 0;
  let hi = dates.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (dates[mid] <= target) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

export function shiftMonths(day, months) {
  const d = new Date(`${day}T00:00:00Z`);
  const targetMonth = d.getUTCMonth() - months;
  const shifted = new Date(Date.UTC(d.getUTCFullYear(), targetMonth, 1));
  const lastDay = new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, 0)).getUTCDate();
  shifted.setUTCDate(Math.min(d.getUTCDate(), lastDay));
  return shifted.toISOString().slice(0, 10);
}

function shiftDays(day, days) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function periodStart(endDate, period) {
  if (period === 'YTD') return `${Number(endDate.slice(0, 4)) - 1}-12-31`;
  return shiftMonths(endDate, PERIOD_MONTHS[period]);
}

/** Return between startDate and endDate; CAGR over whole years (as Coin shows) when years >= 1. null when history is too short. */
function periodReturn(series, startDate, endDate, years) {
  const { dates, navs } = series;
  if (!dates.length || dates[0] > shiftDays(startDate, 7)) return null;
  const i0 = Math.max(0, indexAtOrBefore(dates, startDate));
  const i1 = indexAtOrBefore(dates, endDate);
  if (i1 <= i0) return null;
  const ratio = navs[i1] / navs[i0];
  return years >= 1 ? ratio ** (1 / years) - 1 : ratio - 1;
}

function periodYears(period) {
  return period === 'YTD' ? 0 : PERIOD_MONTHS[period] / 12;
}

export function computeMetrics(series, bench) {
  const { dates, navs } = series;
  const n = dates.length;
  if (n < 2) return { navDate: dates[0] || '', nav: navs[0] ?? null, empty: true };
  const end = dates[n - 1];
  const returns = {};
  const vsBench = {};
  PERIODS.forEach((p) => {
    const start = periodStart(end, p);
    const years = periodYears(p);
    const r = periodReturn(series, start, end, years);
    returns[p] = r;
    const b = bench?.dates.length ? periodReturn(bench, start, end, years) : null;
    vsBench[p] = r !== null && b !== null ? r - b : null;
  });

  // 3Y risk: max drawdown, annualised volatility, Sharpe.
  const start3 = shiftMonths(end, 36);
  const has3y = dates[0] <= shiftDays(start3, 7);
  let maxDd = null;
  let sharpe = null;
  if (has3y) {
    const i0 = Math.max(0, indexAtOrBefore(dates, start3));
    let peak = navs[i0];
    let dd = 0;
    let sum = 0;
    let sumSq = 0;
    let count = 0;
    for (let i = i0 + 1; i < n; i += 1) {
      peak = Math.max(peak, navs[i]);
      dd = Math.min(dd, navs[i] / peak - 1);
      const r = navs[i] / navs[i - 1] - 1;
      sum += r;
      sumSq += r * r;
      count += 1;
    }
    maxDd = dd;
    if (count > 100) {
      const mean = sum / count;
      const vol = Math.sqrt(Math.max(0, sumSq / count - mean * mean)) * Math.sqrt(252);
      if (vol > 0 && returns['3Y'] !== null) sharpe = (returns['3Y'] - RISK_FREE) / vol;
    }
  }

  // Beat%: rolling 1-year windows ending weekly over the last 3 years, fund vs benchmark.
  let beat = null;
  if (bench?.dates.length) {
    let wins = 0;
    let samples = 0;
    for (let k = 0; k <= 156; k += 1) {
      const wEnd = shiftDays(end, -7 * k);
      const wStart = shiftMonths(wEnd, 12);
      const f = periodReturn(series, wStart, wEnd, 0);
      const b = periodReturn(bench, wStart, wEnd, 0);
      if (f === null || b === null) break;
      samples += 1;
      if (f > b) wins += 1;
    }
    if (samples >= 26) beat = wins / samples;
  }

  return {
    navDate: end,
    nav: navs[n - 1],
    dayChange: navs[n - 1] / navs[n - 2] - 1,
    since: dates[0],
    returns,
    vsBench,
    maxDd,
    sharpe,
    beat,
  };
}

const metricsCache = new Map(); // isin -> metrics (current IST day)

export function getCachedMetrics(isin) {
  return metricsCache.get(isin) || null;
}

/**
 * Loads metrics for the given ISINs: memory, then IndexedDB (same IST day), then Coin NAVs.
 * onUpdate is called after each fund (throttling is up to the caller).
 */
export async function loadMetrics(isins, { force = false, cacheOnly = false, signal, onUpdate } = {}) {
  const today = istToday();
  const unique = [...new Set(isins)];
  let pending = force ? unique : unique.filter((isin) => !metricsCache.has(isin));
  if (!pending.length) return { failed: 0 };

  if (!force) {
    const stored = await idbGetMany('metrics', pending).catch(() => new Map());
    stored.forEach((record, isin) => {
      if (record.day === today && record.v === METRICS_VERSION) metricsCache.set(isin, record.m);
    });
    pending = pending.filter((isin) => !metricsCache.has(isin));
    if (stored.size) onUpdate?.({ done: unique.length - pending.length, total: unique.length });
  }
  if (cacheOnly || !pending.length || signal?.aborted) return { failed: 0 };

  const bench = await getNavSeries(BENCHMARK_ISIN, { force }).catch(() => null);
  let done = unique.length - pending.length;
  let failed = 0;
  let cursor = 0;

  async function worker() {
    while (cursor < pending.length && !signal?.aborted) {
      const isin = pending[cursor];
      cursor += 1;
      try {
        const series = isin === BENCHMARK_ISIN && bench ? bench : await getNavSeries(isin, { force });
        const metrics = computeMetrics(series, isin === BENCHMARK_ISIN ? null : bench);
        metricsCache.set(isin, metrics);
        // Without the benchmark, vs N50 / Beat% are missing: keep in memory only so a reload retries.
        if (bench) idbPut('metrics', { key: isin, day: today, v: METRICS_VERSION, m: metrics }).catch(() => {});
      } catch {
        if (!signal?.aborted) failed += 1;
      }
      if (signal?.aborted) return;
      done += 1;
      onUpdate?.({ done, total: unique.length });
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, pending.length) }, worker));
  return { failed };
}

/** Calendar-year returns (fund and benchmark) for the chart side box, newest first. */
export function calendarYearReturns(series, bench, maxYears = 8) {
  const { dates, navs } = series;
  if (dates.length < 2) return [];
  const lastYear = Number(dates[dates.length - 1].slice(0, 4));
  const firstYear = Number(dates[0].slice(0, 4));
  const out = [];
  const yearReturn = (s, year) => {
    const i0 = indexAtOrBefore(s.dates, `${year - 1}-12-31`);
    const i1 = indexAtOrBefore(s.dates, `${year}-12-31`);
    if (i0 < 0 || i1 <= i0) return null;
    return s.navs[i1] / s.navs[i0] - 1;
  };
  for (let year = lastYear; year > firstYear && out.length < maxYears; year -= 1) {
    out.push({
      year: year === lastYear ? `${year} YTD` : String(year),
      fund: yearReturn(series, year),
      bench: bench?.dates.length ? yearReturn(bench, year) : null,
    });
  }
  return out;
}

/** Rolling 3-year CAGR (sampled weekly) min / median / max. */
export function rolling3y(series) {
  const { dates } = series;
  if (dates.length < 2) return null;
  const end = dates[dates.length - 1];
  const values = [];
  for (let k = 0; k < 2000; k += 1) {
    const wEnd = shiftDays(end, -7 * k);
    const r = periodReturn(series, shiftMonths(wEnd, 36), wEnd, 3);
    if (r === null) break;
    values.push(r);
  }
  if (values.length < 4) return null;
  values.sort((a, b) => a - b);
  return { min: values[0], median: values[Math.floor(values.length / 2)], max: values[values.length - 1], samples: values.length };
}
