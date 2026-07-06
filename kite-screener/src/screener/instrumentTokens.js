// Resolve instrument_token for symbols missing from the screener API (ETFs, etc.)
// via the extension background worker + Kite Connect public instrument master.

import { isKiteEmbedded } from './kiteApi';

const CSV_URL = 'https://api.kite.trade/instruments';

let tokenMap = null;
let loadPromise = null;

function mapKey(exchange, symbol) {
  return `${exchange}:${String(symbol || '').trim().toUpperCase()}`;
}

function parseInstrumentLine(line) {
  if (!line || line.startsWith('instrument_token')) return null;

  const parts = line.split(',');
  if (parts.length < 12) return null;

  const instrumentToken = Number(parts[0]);
  const tradingsymbol = parts[2]?.trim();
  const exchange = parts[parts.length - 1]?.trim();
  const segment = parts[parts.length - 2]?.trim();

  if (!Number.isFinite(instrumentToken) || !tradingsymbol || !exchange) return null;

  return { instrument_token: instrumentToken, tradingsymbol, exchange, segment };
}

function lookupInMap(map, entry) {
  const symbol = (entry?.tradingsymbol || entry?.symbol || '').trim();
  if (!symbol) return null;

  const segments = [...new Set([
    entry?.exchange,
    entry?.segment,
    'NSE',
    'BSE',
  ].filter(Boolean))];

  for (const segment of segments) {
    const token = map.get(mapKey(segment, symbol));
    if (token) return token;
  }

  return null;
}

function requestInstrumentTokenViaBridge(entry, timeoutMs = 10000) {
  return new Promise((resolve) => {
    const id = `tok-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const timer = setTimeout(() => {
      window.removeEventListener('message', onMessage);
      resolve(null);
    }, timeoutMs);

    function onMessage(event) {
      if (event.source !== window) return;
      const data = event.data;
      if (!data || data.source !== 'kite-screener-bridge' || data.type !== 'instrumentToken') return;
      if (data.id !== id) return;

      clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      resolve(data.ok && data.token ? Number(data.token) : null);
    }

    window.addEventListener('message', onMessage);
    window.postMessage({
      source: 'kite-screener',
      type: 'getInstrumentToken',
      id,
      tradingsymbol: entry?.tradingsymbol || entry?.symbol || '',
      exchange: entry?.exchange || '',
      segment: entry?.segment || '',
    }, '*');
  });
}

async function loadInstrumentTokenMap(signal) {
  if (tokenMap) return tokenMap;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    const response = await fetch(CSV_URL, {
      signal,
      credentials: 'omit',
      headers: { accept: 'text/csv,*/*' },
    });

    if (!response.ok) {
      throw new Error(`Instrument token list failed with HTTP ${response.status}`);
    }

    const text = await response.text();
    const map = new Map();

    text.split('\n').forEach((line) => {
      const parsed = parseInstrumentLine(line);
      if (!parsed) return;
      map.set(mapKey(parsed.exchange, parsed.tradingsymbol), parsed.instrument_token);
      if (parsed.segment && parsed.segment !== parsed.exchange) {
        map.set(mapKey(parsed.segment, parsed.tradingsymbol), parsed.instrument_token);
      }
    });

    tokenMap = map;
    return map;
  })().finally(() => {
    loadPromise = null;
  });

  return loadPromise;
}

export async function lookupInstrumentToken(entry, signal) {
  if (isKiteEmbedded()) {
    return requestInstrumentTokenViaBridge(entry);
  }

  try {
    const map = await loadInstrumentTokenMap(signal);
    return lookupInMap(map, entry);
  } catch {
    return null;
  }
}
