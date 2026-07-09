// Fallback token source: Kite's public instrument dump (api.kite.trade/instruments).
// Fetched via extension background (no CORS). Cached per calendar day in localStorage.

import { requestInstrumentDumpEntries } from './instrumentDumpBridge';

const DUMP_URL = 'https://api.kite.trade/instruments';
const STORAGE_BASE_PREFIX = 'kite-screener-instrument-dump-v1-';
const MIN_PERSISTED_ENTRIES = 1000;

let tokenMap = null;
let loadPromise = null;

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function storageKey() {
  return `${STORAGE_BASE_PREFIX}${todayKey()}`;
}

function rowKey(exchange, symbol) {
  return `${String(exchange || 'NSE').trim().toUpperCase()}:${String(symbol || '').trim().toUpperCase()}`;
}

function pruneStaleDumpCaches() {
  try {
    const keep = storageKey();
    const stale = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key && key.startsWith(STORAGE_BASE_PREFIX) && key !== keep) stale.push(key);
    }
    stale.forEach((key) => localStorage.removeItem(key));
  } catch {
    // ignore
  }
}

function entriesToMap(entries) {
  const map = new Map();
  if (!entries || typeof entries !== 'object') return map;
  Object.entries(entries).forEach(([key, value]) => {
    const token = Number(value);
    if (key && Number.isFinite(token) && token > 0) map.set(key, token);
  });
  return map;
}

function hydrateFromStorage() {
  try {
    pruneStaleDumpCaches();
    const raw = localStorage.getItem(storageKey());
    if (!raw) return false;

    const parsed = JSON.parse(raw);
    const next = entriesToMap(parsed?.entries);
    if (next.size < MIN_PERSISTED_ENTRIES) return false;

    tokenMap = next;
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
    pruneStaleDumpCaches();
    localStorage.setItem(storageKey(), JSON.stringify({
      date: todayKey(),
      entries: Object.fromEntries(tokenMap),
    }));
  } catch {
    // quota exceeded — keep in-memory only
  }
}

function parseCsvLine(line) {
  const cols = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === ',' && !inQuotes) {
      cols.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  cols.push(cur);
  return cols;
}

function buildEntriesFromCsv(text) {
  const lines = String(text || '').trim().split('\n');
  if (lines.length < 2) return {};

  const headers = parseCsvLine(lines[0]).map((h) => h.replace(/^"|"$/g, ''));
  const tokenIdx = headers.indexOf('instrument_token');
  const symbolIdx = headers.indexOf('tradingsymbol');
  const typeIdx = headers.indexOf('instrument_type');
  const exchangeIdx = headers.indexOf('exchange');

  if (tokenIdx < 0 || symbolIdx < 0 || exchangeIdx < 0) return {};

  const entries = {};
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line) continue;

    const cols = parseCsvLine(line);
    const exchange = String(cols[exchangeIdx] || '').trim().toUpperCase();
    if (exchange !== 'NSE' && exchange !== 'BSE') continue;

    const instrumentType = typeIdx >= 0 ? String(cols[typeIdx] || '').trim().toUpperCase() : 'EQ';
    if (instrumentType !== 'EQ') continue;

    const symbol = String(cols[symbolIdx] || '').trim().toUpperCase();
    const token = Number(cols[tokenIdx]);
    if (!symbol || !Number.isFinite(token) || token <= 0) continue;

    entries[rowKey(exchange, symbol)] = token;
  }

  return entries;
}

async function fetchEntriesViaPage() {
  const response = await fetch(DUMP_URL);
  if (!response.ok) {
    throw new Error(`Instrument dump failed with HTTP ${response.status}`);
  }
  const text = await response.text();
  return buildEntriesFromCsv(text);
}

async function loadDumpEntries() {
  const bridge = await requestInstrumentDumpEntries();
  if (bridge.ok && bridge.entries && Object.keys(bridge.entries).length >= MIN_PERSISTED_ENTRIES) {
    return bridge.entries;
  }

  try {
    const entries = await fetchEntriesViaPage();
    if (Object.keys(entries).length >= MIN_PERSISTED_ENTRIES) return entries;
  } catch {
    // direct fetch blocked by CORS without extension rule
  }

  if (bridge.entries && Object.keys(bridge.entries).length > 0) return bridge.entries;
  throw new Error(bridge.error || 'Instrument dump unavailable');
}

/** Load the public instrument dump (once per day). Not aborted by watchlist effect cleanup. */
export async function warmInstrumentDumpCache() {
  if (tokenMap?.size >= MIN_PERSISTED_ENTRIES) return tokenMap;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    if (hydrateFromStorage()) {
      return tokenMap;
    }

    try {
      const entries = await loadDumpEntries();
      tokenMap = entriesToMap(entries);
      if (tokenMap.size >= MIN_PERSISTED_ENTRIES) {
        persistTokenMap();
      }
    } catch {
      tokenMap = tokenMap || new Map();
    }

    return tokenMap;
  })().finally(() => {
    loadPromise = null;
  });

  return loadPromise;
}

/** Sync lookup — returns null until warmInstrumentDumpCache has run. */
export function lookupTokenFromInstrumentDump(entry) {
  if (!tokenMap?.size) return null;

  const symbol = (entry?.tradingsymbol || entry?.symbol || '').trim();
  if (!symbol) return null;

  const segments = [...new Set([
    entry?.exchange,
    entry?.segment,
    'NSE',
    'BSE',
  ].filter((seg) => seg && seg !== 'INDICES'))];

  for (const segment of segments) {
    const token = tokenMap.get(rowKey(segment, symbol));
    if (token) return token;
  }

  return null;
}

export async function lookupInstrumentTokenFromDump(entry) {
  await warmInstrumentDumpCache();
  return lookupTokenFromInstrumentDump(entry);
}
