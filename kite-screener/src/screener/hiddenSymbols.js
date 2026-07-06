import { bookmarkKey, normalizeBookmark } from './bookmarks';

const STORAGE_KEY = 'kite-screener-hidden-symbols';

/** NSE/BSE tradingsymbol suffixes auto-filtered everywhere (T2T / SME / InvIT / BSE series). */
const AUTO_HIDDEN_SERIES = new Set(['BE', 'SM', 'ST', 'IV', 'ID', 'SZ', 'BZ']);

export function hiddenKey(entry) {
  return bookmarkKey(entry).toUpperCase();
}

/** Parse NSE series from tradingsymbol suffix, e.g. AUTOIND-BE → BE. */
export function nseSeriesSuffix(tradingsymbol) {
  const sym = String(tradingsymbol || '').toUpperCase();
  const match = sym.match(/-([A-Z]{2})$/);
  return match ? match[1] : null;
}

/** BE / SM / ST / SZ / BZ rows are auto-filtered like manually hidden symbols. */
export function isAutoHiddenSeries(entry) {
  if (!entry || entry.type === 'separator') return false;
  const symbol = entry.tradingsymbol || entry.symbol;
  const suffix = nseSeriesSuffix(symbol);
  return suffix !== null && AUTO_HIDDEN_SERIES.has(suffix);
}

export function shouldHideRow(row, hidden) {
  return isHiddenSymbol(hidden, row) || isAutoHiddenSeries(row);
}

export function loadHiddenSymbols() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.map(normalizeBookmark).filter((item) => item.tradingsymbol) : [];
  } catch {
    return [];
  }
}

export function saveHiddenSymbols(list) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    // ignore storage failures
  }
}

export function isHiddenSymbol(hidden, entry) {
  if (!entry || entry.type === 'separator') return false;
  const key = hiddenKey(entry);
  return hidden.some((item) => hiddenKey(item) === key);
}

export function addHiddenSymbol(hidden, entry) {
  const normalized = normalizeBookmark(entry);
  if (!normalized.tradingsymbol) return hidden;
  if (isHiddenSymbol(hidden, normalized)) return hidden;
  const next = [...hidden, normalized];
  saveHiddenSymbols(next);
  return next;
}

export function removeHiddenSymbol(hidden, entry) {
  const key = hiddenKey(entry);
  const next = hidden.filter((item) => hiddenKey(item) !== key);
  if (next.length === hidden.length) return hidden;
  saveHiddenSymbols(next);
  return next;
}

/** Remove hidden symbols and drop separators whose groups become empty. */
export function filterHiddenRows(rows, hidden = []) {
  const out = [];
  let pendingSeparator = null;
  let groupHasRows = false;

  const flushSeparatorIfNeeded = () => {
    if (pendingSeparator && !groupHasRows) {
      out.push(pendingSeparator);
    }
    pendingSeparator = null;
    groupHasRows = false;
  };

  rows.forEach((row) => {
    if (row?.type === 'separator') {
      if (pendingSeparator && groupHasRows) out.push(pendingSeparator);
      pendingSeparator = row;
      groupHasRows = false;
      return;
    }

    if (shouldHideRow(row, hidden)) return;

    if (pendingSeparator) {
      out.push(pendingSeparator);
      pendingSeparator = null;
    }
    groupHasRows = true;
    out.push(row);
  });

  return out;
}
