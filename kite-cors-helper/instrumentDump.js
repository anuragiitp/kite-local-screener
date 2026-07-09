const DUMP_URL = 'https://api.kite.trade/instruments';
const STORAGE_DATE_KEY = 'kite-instrument-dump-date';
const STORAGE_ENTRIES_KEY = 'kite-instrument-dump-entries';
const MIN_ENTRIES = 1000;

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function rowKey(exchange, symbol) {
  return `${String(exchange || 'NSE').trim().toUpperCase()}:${String(symbol || '').trim().toUpperCase()}`;
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

async function readCachedEntries() {
  const stored = await chrome.storage.local.get([STORAGE_DATE_KEY, STORAGE_ENTRIES_KEY]);
  if (stored[STORAGE_DATE_KEY] !== todayKey()) return null;
  const entries = stored[STORAGE_ENTRIES_KEY];
  if (!entries || typeof entries !== 'object') return null;
  if (Object.keys(entries).length < MIN_ENTRIES) return null;
  return entries;
}

async function writeCachedEntries(entries) {
  await chrome.storage.local.set({
    [STORAGE_DATE_KEY]: todayKey(),
    [STORAGE_ENTRIES_KEY]: entries,
  });
}

export async function getInstrumentDumpEntries() {
  const cached = await readCachedEntries();
  if (cached) return cached;

  const response = await fetch(DUMP_URL);
  if (!response.ok) {
    throw new Error(`Instrument dump failed with HTTP ${response.status}`);
  }

  const text = await response.text();
  const entries = buildEntriesFromCsv(text);
  if (Object.keys(entries).length < MIN_ENTRIES) {
    throw new Error('Instrument dump parse returned too few entries');
  }

  try {
    await writeCachedEntries(entries);
  } catch {
    // keep in-memory for this session only
  }

  return entries;
}
