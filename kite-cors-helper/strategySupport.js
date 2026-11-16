// Paper-trading support for the local screener app (no orders are ever placed from here).
// 1. getNifty500List: official NSE Nifty 500 constituents CSV (page cannot fetch it: CORS).
// 2. strategyStore: small key/value store in chrome.storage.local for paper-trading ledgers,
//    restricted to keys with the STORE_PREFIX so the page cannot touch other extension data.

const NIFTY500_URLS = [
  'https://nsearchives.nseindia.com/content/indices/ind_nifty500list.csv',
  'https://archives.nseindia.com/content/indices/ind_nifty500list.csv',
  'https://www.niftyindices.com/IndexConstituent/ind_nifty500list.csv',
];
const NIFTY500_CACHE_KEY = 'kite-strategy-cache-nifty500';
const NIFTY500_MIN_ROWS = 450;
const STORE_PREFIX = 'kite-strategy:';
const MAX_KEY_LENGTH = 200;
const MAX_VALUE_CHARS = 25 * 1024 * 1024;

function istDay() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
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
  return cols.map((c) => c.trim());
}

function parseNifty500Csv(text) {
  const lines = String(text || '').replace(/\r/g, '').trim().split('\n');
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]).map((h) => h.toLowerCase());
  const idx = (name) => headers.indexOf(name);
  const symbolIdx = idx('symbol');
  if (symbolIdx < 0) return [];
  const nameIdx = idx('company name');
  const industryIdx = idx('industry');
  const seriesIdx = idx('series');
  const isinIdx = idx('isin code');
  const rows = [];
  const seen = new Set();
  for (let i = 1; i < lines.length; i += 1) {
    const cols = parseCsvLine(lines[i]);
    const symbol = String(cols[symbolIdx] || '').toUpperCase();
    if (!/^[A-Z0-9&_.-]{1,30}$/.test(symbol) || seen.has(symbol)) continue;
    seen.add(symbol);
    rows.push({
      symbol,
      name: nameIdx >= 0 ? cols[nameIdx] || '' : '',
      industry: industryIdx >= 0 ? cols[industryIdx] || '' : '',
      series: seriesIdx >= 0 ? cols[seriesIdx] || '' : '',
      isin: isinIdx >= 0 ? cols[isinIdx] || '' : '',
    });
  }
  return rows;
}

export async function getNifty500List({ force = false } = {}) {
  const stored = await chrome.storage.local.get(NIFTY500_CACHE_KEY);
  const cached = stored[NIFTY500_CACHE_KEY];
  if (!force && cached?.day === istDay() && cached.rows?.length >= NIFTY500_MIN_ROWS) {
    return { ...cached, cached: true };
  }

  const errors = [];
  for (const url of NIFTY500_URLS) {
    try {
      const response = await fetch(url, { cache: 'no-store', credentials: 'omit' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const rows = parseNifty500Csv(await response.text());
      if (rows.length < NIFTY500_MIN_ROWS) throw new Error(`only ${rows.length} rows`);
      const result = { day: istDay(), fetchedAt: new Date().toISOString(), source: url, rows };
      await chrome.storage.local.set({ [NIFTY500_CACHE_KEY]: result });
      return { ...result, cached: false };
    } catch (error) {
      errors.push(`${new URL(url).hostname}: ${error?.message || error}`);
    }
  }

  if (cached?.rows?.length >= NIFTY500_MIN_ROWS) {
    return { ...cached, cached: true, stale: true, error: errors.join('; ') };
  }
  throw new Error(`Nifty 500 list unavailable (${errors.join('; ')})`);
}

function validKey(key) {
  return typeof key === 'string' && key.startsWith(STORE_PREFIX) && key.length <= MAX_KEY_LENGTH;
}

export async function handleStrategyStore(message) {
  const { op, key, value } = message || {};
  if (op === 'list') {
    const all = await chrome.storage.local.get(null);
    return { keys: Object.keys(all).filter(validKey) };
  }
  if (!validKey(key)) throw new Error('Invalid strategy store key');
  if (op === 'get') {
    const stored = await chrome.storage.local.get(key);
    return { value: stored[key] ?? null };
  }
  if (op === 'set') {
    if (typeof value !== 'string') throw new Error('Strategy store value must be a string');
    if (value.length > MAX_VALUE_CHARS) throw new Error('Strategy store value too large');
    await chrome.storage.local.set({ [key]: value });
    return {};
  }
  if (op === 'remove') {
    await chrome.storage.local.remove(key);
    return {};
  }
  throw new Error('Unknown strategy store op');
}
