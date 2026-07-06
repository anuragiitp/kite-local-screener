import { fetchScreener } from './kiteApi';
import { loadInstrumentIndex, lookupInstrumentTokenFromIndex } from './instruments';
import { lookupInstrumentToken } from './instrumentTokens';

const STORAGE_KEY = 'kite-screener-bookmarks';
const INDICES_SEGMENT_ID = 9;
const SEGMENT_IDS = {
  NSE: 1,
  BSE: 3,
  INDICES: INDICES_SEGMENT_ID,
};

/** instruments.json row[0] is an internal id (often single-digit for ETFs), not instrument_token. */
export function isLikelyBogusToken(token, entry) {
  const n = Number(token);
  if (!Number.isFinite(n) || n <= 0) return false;
  const segment = (entry?.segment || entry?.exchange || '').toUpperCase();
  if (SEGMENT_IDS[segment] && (n & 0xff) === SEGMENT_IDS[segment]) return false;
  if (segment === 'INDICES') return false;
  return n < 100000;
}

export function hasValidInstrumentToken(entry) {
  const token = Number(entry?.instrument_token || entry?.token);
  if (!Number.isFinite(token) || token <= 0) return false;
  return !isLikelyBogusToken(token, entry);
}

export function bookmarkKey(entry) {
  if (entry?.type === 'separator') return `separator:${entry.label || ''}`;
  const exchange = entry?.exchange || entry?.segment || 'NSE';
  const symbol = (entry?.tradingsymbol || entry?.symbol || '').trim();
  return `${exchange}:${symbol}`;
}

export function toInstrument(entry) {
  return bookmarkKey(entry);
}

export function normalizeBookmark(row) {
  if (row?.type === 'separator') {
    return {
      type: 'separator',
      label: row.label || row.name || '',
    };
  }

  let instrumentToken = row?.instrument_token || row?.token || null;
  if (isLikelyBogusToken(instrumentToken, row)) instrumentToken = null;

  return {
    tradingsymbol: (row?.tradingsymbol || row?.symbol || '').trim(),
    name: row?.name || '',
    exchange: row?.exchange || row?.segment || 'NSE',
    segment: row?.segment || row?.exchange || 'NSE',
    instrument_token: instrumentToken,
    internalId: row?.internalId ?? null,
  };
}

export function encodeIndexToken(internalId) {
  if (!Number.isFinite(internalId) || internalId <= 0) return null;
  return ((internalId << 8) | INDICES_SEGMENT_ID) >>> 0;
}

export async function resolveInstrumentToken(entry, signal) {
  if (entry?.instrument_token && !isLikelyBogusToken(entry.instrument_token, entry)) {
    return Number(entry.instrument_token);
  }

  if (entry?.segment === 'INDICES') {
    const encoded = encodeIndexToken(Number(entry.internalId));
    if (encoded) return encoded;
  }

  try {
    await loadInstrumentIndex(signal);
    const indexToken = lookupInstrumentTokenFromIndex(entry);
    if (indexToken) return indexToken;
  } catch {
    // ignore lookup failures
  }

  try {
    const token = await lookupInstrumentToken(entry, signal);
    if (token) return token;
  } catch {
    // ignore lookup failures
  }

  const symbol = (entry?.tradingsymbol || '').trim();
  const segments = [...new Set([
    entry?.segment,
    entry?.exchange,
    'NSE',
    'BSE',
  ].filter((segment) => segment && segment !== 'INDICES'))];

  for (const segment of segments) {
    if (!symbol) break;
    try {
      const page = await fetchScreener({
        query: `tradingsymbol = "${symbol}"&segment = "${segment}"`,
        limit: 1,
        offset: 0,
      }, signal);
      const row = page.rows?.[0];
      if (row?.instrument_token && row.tradingsymbol?.toUpperCase() === symbol.toUpperCase()) {
        return Number(row.instrument_token);
      }
    } catch {
      // try next segment
    }
  }

  return null;
}

/** Merge screener-resolved tokens/segments back into saved entries. */
export function applyResolvedEntries(entries, resolvedByKey) {
  if (!resolvedByKey || !Object.keys(resolvedByKey).length) return entries;

  let changed = false;
  const next = entries.map((entry) => {
    const key = bookmarkKey(entry);
    const resolved = resolvedByKey[key];
    if (!resolved) return entry;

    const updates = {};
    if (resolved.instrument_token && Number(entry.instrument_token) !== resolved.instrument_token) {
      updates.instrument_token = resolved.instrument_token;
    }
    if (resolved.segment && entry.segment !== resolved.segment) {
      updates.segment = resolved.segment;
      updates.exchange = resolved.segment;
    }
    if (!Object.keys(updates).length) return entry;
    changed = true;
    return { ...entry, ...updates };
  });

  return changed ? next : entries;
}

/** @deprecated use applyResolvedEntries */
export function applyResolvedTokens(entries, tokensByKey) {
  const resolvedByKey = {};
  Object.entries(tokensByKey || {}).forEach(([key, token]) => {
    resolvedByKey[key] = { instrument_token: token };
  });
  return applyResolvedEntries(entries, resolvedByKey);
}

function lookupQuote(entry, quotes) {
  if (!quotes) return null;

  const direct = quotes[bookmarkKey(entry)];
  if (direct) return direct;

  const symbol = (entry.tradingsymbol || '').trim().toUpperCase();
  if (!symbol) return null;

  for (const segment of [entry.segment, entry.exchange, 'NSE', 'BSE']) {
    if (!segment || segment === 'INDICES') continue;
    const key = `${segment}:${entry.tradingsymbol}`;
    if (quotes[key]) return quotes[key];
    const upperKey = `${segment}:${symbol}`;
    if (quotes[upperKey]) return quotes[upperKey];
  }

  return null;
}

export function loadBookmarks() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.map(normalizeBookmark) : [];
  } catch {
    return [];
  }
}

export function saveBookmarks(list) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    // ignore storage failures
  }
}

export function isInBookmarks(bookmarks, entry) {
  const key = bookmarkKey(entry);
  return bookmarks.some((item) => bookmarkKey(item) === key);
}

export function toggleBookmarkEntry(bookmarks, entry) {
  const normalized = normalizeBookmark(entry);
  if (!normalized.tradingsymbol) return bookmarks;
  const key = bookmarkKey(normalized);
  const exists = bookmarks.some((item) => bookmarkKey(item) === key);
  const next = exists
    ? bookmarks.filter((item) => bookmarkKey(item) !== key)
    : [...bookmarks, normalized];
  saveBookmarks(next);
  return next;
}

export function addBookmarkEntry(bookmarks, entry) {
  const normalized = normalizeBookmark(entry);
  if (!normalized.tradingsymbol) return bookmarks;
  const key = bookmarkKey(normalized);
  if (bookmarks.some((item) => bookmarkKey(item) === key)) return bookmarks;
  const next = [...bookmarks, normalized];
  saveBookmarks(next);
  return next;
}

export function reorderBookmarks(bookmarks, fromIndex, toIndex) {
  if (fromIndex === toIndex) return bookmarks;
  if (fromIndex < 0 || toIndex < 0) return bookmarks;
  if (fromIndex >= bookmarks.length || toIndex >= bookmarks.length) return bookmarks;

  const next = [...bookmarks];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  saveBookmarks(next);
  return next;
}

export function bookmarksToRows(bookmarks, quotes) {
  return bookmarks.map((entry) => {
    if (entry?.type === 'separator') {
      return {
        type: 'separator',
        label: entry.label || '',
      };
    }

    const quote = lookupQuote(entry, quotes);
    return {
      tradingsymbol: entry.tradingsymbol,
      name: entry.name || '',
      exchange: entry.exchange || entry.segment || 'NSE',
      segment: entry.segment || entry.exchange || 'NSE',
      instrument_token: entry.instrument_token,
      last_price: quote?.lastPrice,
      change_percent: quote?.changePercent,
      change: quote?.netChange,
      volume: quote?.volume,
      average_price: quote?.averagePrice,
      buy_quantity: quote?.buyQuantity,
      sell_quantity: quote?.sellQuantity,
      open: quote?.ohlc?.open,
      high: quote?.ohlc?.high,
      low: quote?.ohlc?.low,
      close: quote?.ohlc?.close,
    };
  });
}
