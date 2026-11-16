// Data for strategy paper trading: Nifty 500 list (via extension), daily candles from Kite
// (cached in IndexedDB, rate limited), and the aligned price panel used by the rules engine.

import { fetchHistorical } from '../screener/kiteApi';
import { lookupTokenFromInstrumentDump, warmInstrumentDumpCache } from '../screener/instrumentDumpCache';
import { lookupTokenFromScreenerCache, warmScreenerTokenCache } from '../screener/screenerTokenCache';
import { bridgeRequest } from './strategyBridge';

export const NIFTY500_TOKEN = 268041;
export const NIFTY50_TOKEN = 256265;
const INITIAL_DAYS = 600; // ~410 sessions: enough for 252-day lookbacks + 273-day history check
const MAX_SESSIONS = 900;
const OVERLAP_DAYS = 10;
const ADJUST_TOLERANCE = 0.005;
const CONCURRENCY = 3;
const MIN_GAP_MS = 350; // Kite historical API allows 3 requests/second

const DB_NAME = 'kite-strategy';
const DB_VERSION = 1;
let dbPromise = null;

export function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('candles')) db.createObjectStore('candles', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('ledgers')) db.createObjectStore('ledgers', { keyPath: 'key' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      dbPromise = null;
      reject(request.error);
    };
  });
  if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
  return dbPromise;
}

export async function idbGet(store, key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(store, 'readonly').objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function idbPut(store, value) {
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

// ---------- time helpers (IST) ----------

function istParts(date = new Date()) {
  const s = date.toLocaleString('sv-SE', { timeZone: 'Asia/Kolkata' });
  return { day: s.slice(0, 10), minutes: Number(s.slice(11, 13)) * 60 + Number(s.slice(14, 16)) };
}

export function istToday() {
  return istParts().day;
}

export function isWeekday(day) {
  const weekday = new Date(`${day}T12:00:00+05:30`).getUTCDay();
  return weekday > 0 && weekday < 6;
}

/** A daily candle is final once the session is over (16:00 IST gives the closing auction time to settle). */
export function isFinalSession(day, now = new Date()) {
  const ist = istParts(now);
  // weekend (Muhurat) sessions run in the evening
  const closeAt = isWeekday(day) ? 16 * 60 : 20 * 60;
  return day < ist.day || (day === ist.day && ist.minutes >= closeAt);
}

/** Weekday between 9:15 and 16:00 IST (holidays are detected by the missing index candle). */
export function isMarketHours(now = new Date()) {
  const { day, minutes } = istParts(now);
  return isWeekday(day) && minutes >= 9 * 60 + 15 && minutes < 16 * 60;
}

function calendarDaysSince(day) {
  return Math.ceil((Date.now() - Date.parse(`${day}T00:00:00+05:30`)) / 86400000);
}

// ---------- Nifty 500 list ----------

// NSE lists placeholder rows (e.g. DUMMYHEG) for pending demergers; they never trade.
const realStocks = (rows) => rows.filter((r) => !/^DUMMY/.test(r.symbol));

export async function loadNifty500({ force = false } = {}) {
  const reply = await bridgeRequest('getNifty500List', { force }, 60000);
  if (reply.ok && Array.isArray(reply.rows) && reply.rows.length >= 450) {
    const record = {
      key: 'nifty500',
      rows: realStocks(reply.rows),
      source: reply.source,
      fetchedAt: reply.fetchedAt,
      day: reply.day,
    };
    await idbPut('meta', record);
    return { ...record, symbols: record.rows.map((r) => r.symbol), stale: Boolean(reply.stale), warning: reply.stale ? reply.error : '' };
  }
  const cached = await idbGet('meta', 'nifty500');
  if (cached?.rows?.length) {
    return {
      ...cached,
      rows: realStocks(cached.rows),
      symbols: realStocks(cached.rows).map((r) => r.symbol),
      stale: true,
      warning: `Using the Nifty 500 list saved on ${cached.day}. ${reply.timeout ? 'Extension did not answer — reload it in chrome://extensions.' : reply.error || ''}`,
    };
  }
  throw new Error(reply.timeout || /unknown message/i.test(reply.error || '')
    ? 'The extension needs a reload: open chrome://extensions and click reload on Kite Local Screener (new NSE permission).'
    : `Could not load the Nifty 500 list: ${reply.error || 'unknown error'}`);
}

// ---------- tokens ----------

export async function resolveTokens(symbols, known = {}) {
  await warmInstrumentDumpCache();
  const tokens = {};
  const missing = [];
  symbols.forEach((sym) => {
    const token = lookupTokenFromInstrumentDump({ tradingsymbol: sym, exchange: 'NSE' }) || known[sym];
    if (token) tokens[sym] = Number(token);
    else missing.push(sym);
  });
  if (missing.length) {
    try {
      await warmScreenerTokenCache();
    } catch {
      // per-symbol tokens stay missing
    }
    for (let k = missing.length - 1; k >= 0; k -= 1) {
      const token = lookupTokenFromScreenerCache({ tradingsymbol: missing[k], exchange: 'NSE', segment: 'NSE' });
      if (token) {
        tokens[missing[k]] = Number(token);
        missing.splice(k, 1);
      }
    }
  }
  return { tokens, missing };
}

// ---------- rate-limited historical fetch ----------

let lastStart = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isAuthError = (error) => /token|session|log ?in|api_key|\b40[13]\b/i.test(error?.message || '');

async function limitedHistorical(token, days, signal) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const wait = lastStart + MIN_GAP_MS - Date.now();
    lastStart = Math.max(Date.now(), lastStart + MIN_GAP_MS);
    if (wait > 0) await sleep(wait);
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    try {
      return await fetchHistorical(token, { interval: 'day', days }, signal);
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      if (attempt === 3 || isAuthError(error)) throw error;
      const rate = /too many|429|rate/i.test(error?.message || '');
      await sleep(rate ? 2000 * (attempt + 1) : 800);
    }
  }
  return [];
}

function toRecordCandles(raw) {
  const d = [];
  const o = [];
  const h = [];
  const l = [];
  const c = [];
  const v = [];
  raw.forEach((candle) => {
    const day = String(candle[0]).slice(0, 10);
    if (!isFinalSession(day)) return;
    d.push(day);
    o.push(Number(candle[1]));
    h.push(Number(candle[2]));
    l.push(Number(candle[3]));
    c.push(Number(candle[4]));
    v.push(Number(candle[5]) || 0);
  });
  return { d, o, h, l, c, v };
}

function trim(candles) {
  const extra = candles.d.length - MAX_SESSIONS;
  if (extra <= 0) return candles;
  return Object.fromEntries(Object.entries(candles).map(([k, arr]) => [k, arr.slice(extra)]));
}

/** Merge fresh candles into a record; detect price adjustments (splits/bonus) on the overlap. */
function mergeCandles(old, fresh) {
  const oldIdx = new Map(old.d.map((day, k) => [day, k]));
  const ratios = [];
  fresh.d.forEach((day, k) => {
    const j = oldIdx.get(day);
    if (j !== undefined && old.c[j] > 0 && fresh.c[k] > 0) ratios.push(fresh.c[k] / old.c[j]);
  });
  if (ratios.length) {
    ratios.sort((a, b) => a - b);
    const factor = ratios[ratios.length >> 1];
    if (Math.abs(factor - 1) > ADJUST_TOLERANCE) return { adjusted: true, factor };
  }
  const firstNew = fresh.d[0];
  const keep = firstNew ? old.d.findIndex((day) => day >= firstNew) : -1;
  const cut = keep < 0 ? old.d.length : keep;
  const merged = Object.fromEntries(Object.keys(old).map((k) => [k, [...old[k].slice(0, cut), ...fresh[k]]]));
  return { adjusted: false, candles: trim(merged) };
}

/**
 * Bring cached candles up to `targetDay` for the given instruments.
 * items: [{ key, sym, token }]. Returns { records: Map(key -> record), errors, adjustments }.
 */
export async function updateCandles(items, { targetDay = '', always = false, onProgress, signal } = {}) {
  const existing = await idbGetMany('candles', items.map((i) => i.key));
  const records = new Map(existing);
  const todo = items.filter((item) => {
    const rec = records.get(item.key);
    return always || !rec || rec.token !== item.token || !isCurrent(rec, targetDay);
  });
  const errors = [];
  const adjustments = [];
  let done = 0;
  let fatal = null;
  onProgress?.({ done, total: todo.length });

  async function work(item) {
    const rec = records.get(item.key);
    try {
      let candles;
      const incremental = rec && rec.token === item.token && rec.candles?.d?.length;
      if (incremental) {
        const fresh = toRecordCandles(await limitedHistorical(item.token, calendarDaysSince(rec.lastDate) + OVERLAP_DAYS, signal));
        const merged = mergeCandles(rec.candles, fresh);
        if (merged.adjusted) {
          adjustments.push({ sym: item.sym, key: item.key, factor: merged.factor });
          candles = toRecordCandles(await limitedHistorical(item.token, INITIAL_DAYS, signal));
        } else candles = merged.candles;
      } else {
        candles = toRecordCandles(await limitedHistorical(item.token, INITIAL_DAYS, signal));
      }
      const next = {
        key: item.key,
        sym: item.sym,
        token: item.token,
        candles,
        lastDate: candles.d.at(-1) || '',
        // a stock with no session on targetDay (suspended) is still up to date once checked
        checkedFor: always ? candles.d.at(-1) || '' : targetDay,
        fetchedAt: new Date().toISOString(),
      };
      await idbPut('candles', next);
      records.set(item.key, next);
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      if (isAuthError(error)) fatal = error;
      errors.push({ sym: item.sym, error: error?.message || String(error) });
    } finally {
      done += 1;
      onProgress?.({ done, total: todo.length, sym: item.sym });
    }
  }

  const queue = [...todo];
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    while (queue.length && !fatal) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      await work(queue.shift());
    }
  }));
  if (fatal) throw new Error(`Kite session problem (${fatal.message}). Log in to Kite again, then refresh.`);
  return { records, errors, adjustments, fetched: todo.length };
}

/**
 * Today's in-progress daily candle (open = official open, close = last price) for each item, plus the
 * previous session's close on Kite's current price basis. Never cached.
 * items: [{ sym, token }]. Returns { day, candles: Map(sym -> {o,h,l,c,v,prevDate,prevClose}), errors }.
 */
export async function fetchTodayCandles(items, { signal } = {}) {
  const day = istToday();
  const candles = new Map();
  const errors = [];
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    while (queue.length) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const item = queue.shift();
      try {
        const raw = await limitedHistorical(item.token, 7, signal);
        const k = raw.findIndex((candle) => String(candle[0]).slice(0, 10) === day);
        const c = raw[k];
        if (c && Number(c[1]) > 0) {
          candles.set(item.sym, {
            o: Number(c[1]),
            h: Number(c[2]),
            l: Number(c[3]),
            c: Number(c[4]),
            v: Number(c[5]) || 0,
            prevDate: k > 0 ? String(raw[k - 1][0]).slice(0, 10) : '',
            prevClose: k > 0 ? Number(raw[k - 1][4]) : NaN,
          });
        }
      } catch (error) {
        if (error?.name === 'AbortError') throw error;
        if (isAuthError(error)) throw error;
        errors.push(item.sym);
      }
    }
  }));
  return { day, candles, errors };
}

/** Records whose data was checked for the target day count as current even without a candle that day. */
export function isCurrent(record, targetDay) {
  return Boolean(record && (record.lastDate >= targetDay || record.checkedFor >= targetDay));
}

// ---------- panel ----------

/**
 * Align instruments to the index calendar.
 * Returns { dates, bench, nifty50, series: { sym: {close, open, high, low, tval} } }.
 */
export function buildPanel(indexRecord, nifty50Record, records) {
  const dates = indexRecord.candles.d;
  const pos = new Map(dates.map((d, k) => [d, k]));
  const n = dates.length;
  const align = (rec, field) => {
    const out = new Float64Array(n).fill(NaN);
    if (!rec) return out;
    rec.candles.d.forEach((d, k) => {
      const i = pos.get(d);
      if (i !== undefined) out[i] = rec.candles[field][k];
    });
    return out;
  };
  const series = {};
  for (const rec of records) {
    const close = align(rec, 'c');
    const volume = align(rec, 'v');
    const tval = new Float64Array(n);
    for (let i = 0; i < n; i += 1) tval[i] = Number.isFinite(close[i]) ? close[i] * volume[i] : NaN;
    series[rec.sym] = { close, open: align(rec, 'o'), high: align(rec, 'h'), low: align(rec, 'l'), tval };
  }
  return {
    dates,
    bench: Float64Array.from(indexRecord.candles.c),
    nifty50: align(nifty50Record, 'c'),
    series,
  };
}
