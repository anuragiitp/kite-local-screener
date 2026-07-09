/**
 * Single source of truth for instrument_token shape checks.
 *
 * Do NOT use magnitude heuristics (e.g. token < 100000) — real Kite tokens range
 * from ~3000 (ABB) to ~195M. Wrong/collision tokens are caught by comparing
 * saved values against the screener + instrument-dump cache (see
 * entryNeedsTokenRefresh in screenerTokenCache.js).
 */

export function parseInstrumentToken(token) {
  const n = Number(token);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function hasValidInstrumentToken(entry) {
  return parseInstrumentToken(entry?.instrument_token ?? entry?.token) != null;
}
