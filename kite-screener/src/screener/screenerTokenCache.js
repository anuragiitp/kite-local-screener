// In-memory instrument_token cache from paginated screener (market_cap>0).
// Bulk map persisted per calendar day in localStorage; ~25-30 API calls only when
// today's cache is missing. Screener miss → public instrument dump fallback.

import { bookmarkKey, encodeIndexToken } from './bookmarks';
import { hasValidInstrumentToken } from './instrumentToken';
import {
  lookupInstrumentTokenFromDump,
  lookupTokenFromInstrumentDump,
  warmInstrumentDumpCache,
} from './instrumentDumpCache';
import { fetchScreener, fetchUpToRows } from './kiteApi';
import { buildRequestBody } from './queryBuilder';
import { DASHBOARD_SECTOR } from './presets';

const CACHE_TARGET_ROWS = 3000;
const FALLBACK_DELAY_MS = 80;
const STORAGE_BASE_PREFIX = 'kite-screener-token-map-v2-';
const MIN_PERSISTED_ENTRIES = 100;

let tokenMap = null;
// Symbols the screener could not resolve today. Cached per day so we stop
// re-issuing blank per-symbol screener lookups on every watchlist load.
// (Instrument-dump fallback is still attempted for these keys.)
let missSet = null;
let loadPromise = null;

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function storageKey() {
  return `${STORAGE_BASE_PREFIX}${todayKey()}`;
}

function pruneStaleTokenCaches() {
  try {
    const keep = storageKey();
    const stale = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key && key.startsWith(STORAGE_BASE_PREFIX) && key !== keep) stale.push(key);
    }
    stale.forEach((key) => localStorage.removeItem(key));
  } catch {
    // ignore storage access issues
  }
}

function hydrateFromStorage() {
  try {
    pruneStaleTokenCaches();
    const raw = localStorage.getItem(storageKey());
    if (!raw) return false;

    const parsed = JSON.parse(raw);
    const entries = parsed?.entries;
    if (!entries || typeof entries !== 'object') return false;

    const next = new Map();
    Object.entries(entries).forEach(([key, value]) => {
      const token = Number(value);
      if (key && Number.isFinite(token) && token > 0) next.set(key, token);
    });

    if (next.size < MIN_PERSISTED_ENTRIES) return false;

    tokenMap = next;
    missSet = new Set(Array.isArray(parsed?.misses) ? parsed.misses.filter(Boolean) : []);
    return true;
  } catch {
    try {
      localStorage.removeItem(storageKey());
    } catch {
      // ignore
    }
    return false;
  }
}

function persistTokenMap() {
  if (!tokenMap?.size || tokenMap.size < MIN_PERSISTED_ENTRIES) return;

  try {
    pruneStaleTokenCaches();
    localStorage.setItem(storageKey(), JSON.stringify({
      date: todayKey(),
      entries: Object.fromEntries(tokenMap),
      misses: missSet ? [...missSet] : [],
    }));
  } catch {
    // quota exceeded — keep in-memory only
  }
}

function rowKey(segment, symbol) {
  return `${String(segment || 'NSE').trim().toUpperCase()}:${String(symbol || '').trim().toUpperCase()}`;
}

function segmentForEntry(entry) {
  return (entry?.segment || entry?.exchange || 'NSE').trim().toUpperCase();
}

function symbolsMatch(left, right) {
  return String(left || '').trim().toUpperCase() === String(right || '').trim().toUpperCase();
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    }, { once: true });
  });
}

function indexTokenForEntry(entry) {
  const stored = Number(entry?.instrument_token);
  if (Number.isFinite(stored) && stored > 0) return stored;
  return encodeIndexToken(Number(entry?.internalId));
}

function resolvedEntry(key, token) {
  const [exchange] = key.split(':');
  return {
    instrument_token: token,
    segment: exchange || 'NSE',
  };
}

function ingestRow(row) {
  if (!row?.tradingsymbol) return;
  const token = Number(row.instrument_token);
  if (!Number.isFinite(token) || token <= 0) return;
  if (!tokenMap) tokenMap = new Map();
  const segment = row.segment || row.exchange || 'NSE';
  tokenMap.set(rowKey(segment, row.tradingsymbol), token);
}

/** Sync lookup — returns null if cache not loaded or symbol missing. */
export function lookupTokenFromScreenerCache(entry) {
  if (!tokenMap) return null;

  const segment = segmentForEntry(entry);
  if (segment === 'INDICES') return indexTokenForEntry(entry);

  const symbol = (entry?.tradingsymbol || entry?.symbol || '').trim();
  if (!symbol) return null;

  const segments = [...new Set([entry?.segment, entry?.exchange, 'NSE', 'BSE'].filter(Boolean))];
  for (const seg of segments) {
    const token = tokenMap.get(rowKey(seg, symbol));
    if (token) return token;
  }
  return null;
}

function ingestRows(rows) {
  (rows || []).forEach(ingestRow);
  return tokenMap;
}

/** True when saved token is missing, bogus, or disagrees with screener/dump cache. */
export function entryNeedsTokenRefresh(entry) {
  if (!entry?.tradingsymbol || entry?.type === 'separator') return false;
  if (!hasValidInstrumentToken(entry)) return true;

  const expected = lookupTokenFromScreenerCache(entry) || lookupTokenFromInstrumentDump(entry);
  if (!expected) return false;
  return Number(entry.instrument_token) !== Number(expected);
}

function lookupCachedToken(entry) {
  return lookupTokenFromScreenerCache(entry) || lookupTokenFromInstrumentDump(entry);
}

async function resolveTokenFallback(entry, signal, { skipScreener = false } = {}) {
  const symbol = String(entry?.tradingsymbol || entry?.symbol || '').trim();
  if (!symbol) return null;

  if (!skipScreener) {
    const segments = [...new Set([
      entry?.segment,
      entry?.exchange,
      'NSE',
      'BSE',
    ].filter((seg) => seg && seg !== 'INDICES'))];

    for (const segment of segments) {
      try {
        const page = await fetchScreener({
          query: `tradingsymbol = "${symbol}"&segment = "${segment}"`,
          limit: 1,
          offset: 0,
        }, signal);
        const row = page.rows?.[0];
        if (row && symbolsMatch(row.tradingsymbol, symbol)) {
          const token = Number(row.instrument_token);
          if (Number.isFinite(token) && token > 0) {
            ingestRow(row);
            return token;
          }
        }
      } catch {
        // try next segment
      }
    }
  }

  const dumpToken = await lookupInstrumentTokenFromDump(entry);
  if (dumpToken) {
    ingestRow({
      tradingsymbol: symbol,
      segment: entry?.segment || entry?.exchange || 'NSE',
      exchange: entry?.exchange || entry?.segment || 'NSE',
      instrument_token: dumpToken,
    });
    return dumpToken;
  }

  return null;
}

export async function lookupInstrumentToken(entry, signal) {
  await warmScreenerTokenCache(signal);
  await warmInstrumentDumpCache();

  const cached = lookupCachedToken(entry);
  if (cached) return cached;

  if (entry?.segment === 'INDICES') {
    const indexToken = indexTokenForEntry(entry);
    if (indexToken) return indexToken;
  }

  return resolveTokenFallback(entry, signal);
}

/** Prefetch screener universe (market_cap>0) into an in-memory token map. */
export async function warmScreenerTokenCache(signal) {
  if (tokenMap) return tokenMap;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    if (hydrateFromStorage()) {
      return tokenMap;
    }

    try {
      const body = buildRequestBody({
        screener: DASHBOARD_SECTOR,
        marketCapId: 'all',
        sector: '',
        limit: CACHE_TARGET_ROWS,
      });
      const result = await fetchUpToRows(body, { targetRows: CACHE_TARGET_ROWS, signal });
      ingestRows(result.rows);
      if (!missSet) missSet = new Set();

      if (tokenMap?.size >= MIN_PERSISTED_ENTRIES) {
        persistTokenMap();
      }
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      // Bulk warm failed — leave tokenMap null/empty; per-symbol fallback still works.
    }

    return tokenMap;
  })().finally(() => {
    loadPromise = null;
  });

  return loadPromise;
}

/**
 * Resolve tokens for many entries: bulk cache lookup, then individual screener
 * calls only for symbols missing from the cache (ETFs, BSE-only, etc.).
 */
export async function resolveInstrumentTokensBulk(entries, signal) {
  const list = (entries || []).filter((entry) => entry?.tradingsymbol && entry?.type !== 'separator');
  if (!list.length) return {};

  await warmScreenerTokenCache(signal);
  await warmInstrumentDumpCache();
  if (!missSet) missSet = new Set();

  const resolved = {};
  const toLookup = [];

  list.forEach((entry) => {
    const key = bookmarkKey(entry);
    const cached = lookupCachedToken(entry);
    if (cached) {
      ingestRow({
        tradingsymbol: entry.tradingsymbol,
        segment: entry.segment || entry.exchange || 'NSE',
        exchange: entry.exchange || entry.segment || 'NSE',
        instrument_token: cached,
      });
      resolved[key] = resolvedEntry(key, cached);
      if (missSet.delete(key)) {
        // cleared stale screener miss
      }
      return;
    }
    toLookup.push({ entry, key, skipScreener: missSet.has(key) });
  });

  let missesChanged = false;
  let tokensChanged = toLookup.length < list.length;

  for (let index = 0; index < toLookup.length; index += 1) {
    const { entry, key, skipScreener } = toLookup[index];
    const token = await resolveTokenFallback(entry, signal, { skipScreener });
    if (token) {
      resolved[key] = resolvedEntry(key, token);
      tokensChanged = true;
      if (missSet.delete(key)) missesChanged = true;
    } else if (!skipScreener) {
      missSet.add(key);
      missesChanged = true;
    }
    if (index < toLookup.length - 1) {
      await sleep(FALLBACK_DELAY_MS, signal);
    }
  }

  if (missesChanged || tokensChanged) persistTokenMap();

  return resolved;
}
