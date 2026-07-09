import { lookupInstrumentToken } from './screenerTokenCache';
import { parseInstrumentToken } from './instrumentToken';

const STORAGE_KEY = 'kite-screener-bookmarks';
const INDICES_SEGMENT_ID = 9;

export { hasValidInstrumentToken } from './instrumentToken';

export function bookmarkKey(entry) {
  if (entry?.type === 'separator') return `separator:${entry.label || ''}`;
  const exchange = (entry?.exchange || entry?.segment || 'NSE').trim().toUpperCase();
  const symbol = (entry?.tradingsymbol || entry?.symbol || '').trim().toUpperCase();
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

  let instrumentToken = parseInstrumentToken(row?.instrument_token ?? row?.token);

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

/**
 * One-time cleanup: earlier builds fabricated instrument_token from the search
 * index's internal id, which collided with real Kite tokens (e.g. NBCC -> the
 * token that actually belongs to APOLLOHOSP).
 *
 * For symbols we have a trusted token for (ETFs, indices — which are NOT in the
 * screener and can't re-resolve quickly by symbol), overwrite with the correct
 * token. For everything else, drop the token so it re-resolves via the screener
 * token cache on next load.
 */
export function stripFabricatedTokens(entries, trustedTokens) {
  if (!Array.isArray(entries) || !entries.length) return { entries, changed: false };

  let changed = false;
  const next = entries.map((entry) => {
    if (!entry || entry.type === 'separator') return entry;
    const segment = (entry.segment || entry.exchange || '').toUpperCase();
    if (segment === 'INDICES') return entry;

    const trusted = trustedTokens?.get?.(bookmarkKey(entry));
    if (trusted) {
      if (Number(entry.instrument_token) === Number(trusted)) return entry;
      changed = true;
      return { ...entry, instrument_token: Number(trusted) };
    }

    if (entry.instrument_token == null) return entry;
    changed = true;
    return { ...entry, instrument_token: null };
  });

  return { entries: changed ? next : entries, changed };
}

export async function resolveInstrumentToken(entry, signal) {
  if (entry?.segment === 'INDICES') {
    const stored = parseInstrumentToken(entry?.instrument_token);
    if (stored) return stored;
    const encoded = encodeIndexToken(Number(entry.internalId));
    if (encoded) return encoded;
  }

  try {
    return await lookupInstrumentToken(entry, signal);
  } catch {
    return null;
  }
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

export function bookmarksToRows(bookmarks) {
  return bookmarks.map((entry) => {
    if (entry?.type === 'separator') {
      return {
        type: 'separator',
        label: entry.label || '',
      };
    }

    return {
      tradingsymbol: entry.tradingsymbol,
      name: entry.name || '',
      exchange: entry.exchange || entry.segment || 'NSE',
      segment: entry.segment || entry.exchange || 'NSE',
      instrument_token: entry.instrument_token,
    };
  });
}
