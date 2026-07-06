// Kite's instrument master used by the global search (instruments.json).
// Cached per session/day; ~2.5 MB uncompressed.

import { isAutoHiddenSeries } from './hiddenSymbols';

const SEARCH_SEGMENTS = ['NSE', 'BSE', 'INDICES'];
const MAX_RESULTS = 25;
const CACHE_PREFIX = 'kite-instruments-cache-v2-';
const SEGMENT_IDS = {
  NSE: 1,
  BSE: 3,
  INDICES: 9,
};

let memoryIndex = null;
let memoryLookup = null;
let loadPromise = null;

function lookupKey(segment, symbol) {
  return `${segment}:${String(symbol || '').trim().toUpperCase()}`;
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function cacheKey() {
  return `${CACHE_PREFIX}${todayKey()}`;
}

function parseRow(segment, row) {
  if (!Array.isArray(row) || row.length < 2) return null;
  const internalId = Number(row[0]);
  const instrumentToken = encodeInstrumentToken(segment, internalId);

  if (segment === 'INDICES') {
    return {
      tradingsymbol: row[1],
      name: row[2] || row[1],
      exchange: 'INDICES',
      segment: 'INDICES',
      internalId,
      instrument_token: instrumentToken,
      segmentLabel: 'INDICES',
    };
  }

  return {
    tradingsymbol: row[1],
    name: row[2] || row[1],
    exchange: segment,
    segment,
    internalId,
    instrument_token: instrumentToken,
    segmentLabel: segment,
  };
}

function encodeInstrumentToken(segment, internalId) {
  const segmentId = SEGMENT_IDS[segment];
  if (!segmentId || !Number.isFinite(internalId) || internalId <= 0) return null;
  return ((internalId << 8) | segmentId) >>> 0;
}

function buildLookup(list) {
  const lookup = new Map();
  list.forEach((item) => {
    if (!item?.tradingsymbol) return;
    lookup.set(lookupKey(item.segment || item.exchange, item.tradingsymbol), item);
  });
  return lookup;
}

function buildIndex(rowsBySegment) {
  const list = [];
  SEARCH_SEGMENTS.forEach((segment) => {
    const rows = rowsBySegment?.[segment] || [];
    rows.forEach((row) => {
      const parsed = parseRow(segment, row);
      if (parsed?.tradingsymbol) list.push(parsed);
    });
  });
  memoryLookup = buildLookup(list);
  return list;
}

/** Sync lookup from the in-memory instruments index (call loadInstrumentIndex first). */
export function lookupInstrumentEntry(entry) {
  if (!memoryLookup) return null;

  const symbol = (entry?.tradingsymbol || entry?.symbol || '').trim().toUpperCase();
  if (!symbol) return null;

  const segments = [...new Set([
    entry?.segment,
    entry?.exchange,
    'NSE',
    'BSE',
    'INDICES',
  ].filter(Boolean))];

  for (const segment of segments) {
    const hit = memoryLookup.get(lookupKey(segment, symbol));
    if (hit) return hit;
  }

  return null;
}

export function lookupInstrumentTokenFromIndex(entry) {
  return lookupInstrumentEntry(entry)?.instrument_token ?? null;
}

async function fetchInstrumentsPayload(signal) {
  const date = todayKey();
  const response = await fetch(`/static/json/instruments.json?date=${date}`, {
    credentials: 'include',
    signal,
    headers: { accept: 'application/json, text/plain, */*' },
  });

  if (!response.ok) {
    throw new Error(`Instrument master failed with HTTP ${response.status}`);
  }

  return response.json();
}

export async function loadInstrumentIndex(signal) {
  if (memoryIndex) return memoryIndex;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    try {
      const cached = sessionStorage.getItem(cacheKey());
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed)) {
          memoryIndex = parsed;
          memoryLookup = buildLookup(parsed);
          return memoryIndex;
        }
      }
    } catch {
      // ignore corrupt cache
    }

    const payload = await fetchInstrumentsPayload(signal);
    memoryIndex = buildIndex(payload?.instruments || {});

    try {
      sessionStorage.setItem(cacheKey(), JSON.stringify(memoryIndex));
    } catch {
      // quota exceeded — keep in-memory only
    }

    return memoryIndex;
  })().finally(() => {
    loadPromise = null;
  });

  return loadPromise;
}

function scoreMatch(item, query) {
  const symbol = item.tradingsymbol.toUpperCase();
  const name = (item.name || '').toUpperCase();
  const q = query.toUpperCase();

  if (symbol === q) return 0;
  if (symbol.startsWith(q)) return 1;
  if (name.startsWith(q)) return 2;
  if (symbol.includes(q)) return 3;
  if (name.includes(q)) return 4;
  return 99;
}

export function searchInstruments(index, query, limit = MAX_RESULTS) {
  const q = query.trim();
  if (!q || !index?.length) return [];

  const terms = q.split(/\s+/).filter(Boolean);
  const hits = [];

  for (const item of index) {
    if (isAutoHiddenSeries(item)) continue;

    const symbol = item.tradingsymbol.toUpperCase();
    const name = (item.name || '').toUpperCase();
    const haystack = `${symbol} ${name}`;
    const matches = terms.every((term) => haystack.includes(term.toUpperCase()));
    if (!matches) continue;

    hits.push({ item, score: scoreMatch(item, q) });
    if (hits.length >= limit * 4) break;
  }

  return hits
    .sort((a, b) => a.score - b.score || a.item.tradingsymbol.localeCompare(b.item.tradingsymbol))
    .slice(0, limit)
    .map((entry) => entry.item);
}
