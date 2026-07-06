import { bookmarkKey, normalizeBookmark } from './bookmarks';
import { ETF_WATCHLIST_ITEMS } from './etfWatchlistData';

const STORAGE_KEY = 'kite-screener-watchlists';
const WL1_MIGRATION_FLAG = 'kite-screener-wl1-to-bookmarks';
const INDICES_WATCHLIST_FLAG = 'kite-screener-indices-watchlist-seeded';
const INDICES_WATCHLIST_V2 = 'kite-screener-indices-watchlist-v2';
const INDICES_WATCHLIST_V3 = 'kite-screener-indices-watchlist-v3';
const INDICES_WATCHLIST_V4 = 'kite-screener-indices-watchlist-v4';
const ETF_WATCHLIST_FLAG = 'kite-screener-etf-watchlist-seeded';
const ETF_WATCHLIST_V1 = 'kite-screener-etf-watchlist-v1';
const ETF_WATCHLIST_V2 = 'kite-screener-etf-watchlist-v2';
const ETF_WATCHLIST_V3 = 'kite-screener-etf-watchlist-v3';
const ETF_WATCHLIST_V4 = 'kite-screener-etf-watchlist-v4';
export const WATCHLIST_PREFIX = 'wl:';
export const MAX_WATCHLISTS = 7;
const DEFAULT_COUNT = 3;

const CORE_INDICES = [
  indexEntry('NIFTY 50', 'Nifty 50', 256265),
  indexEntry('NIFTY BANK', 'Bank Nifty', 260105),
  indexEntry('NIFTY FIN SERVICE', 'Fin Nifty', 257801),
  indexEntry('NIFTY MID SELECT', 'Nifty Midcap Select', 288009),
  indexEntry('NIFTY MIDCAP 100', 'Nifty Midcap 100', 256777),
  indexEntry('NIFTY SMLCAP 100', 'Nifty Smallcap 100', 267017),
  indexEntry('NIFTY NEXT 50', 'Nifty Next 50', 270857),
  indexEntry('SENSEX', 'Sensex', 265, 'BSE'),
];

const CORE_INDEX_KEYS = new Set(CORE_INDICES.map((item) => bookmarkKey(item)));

const INDICES_ITEMS = [
  separator('Core Indices'),
  ...CORE_INDICES,
  separator('Sector Indices'),
  indexEntry('NIFTY AUTO', 'Nifty Auto', 263433),
  indexEntry('NIFTY IT', 'Nifty IT', 259849),
  indexEntry('NIFTY FMCG', 'Nifty FMCG', 261897),
  indexEntry('NIFTY PHARMA', 'Nifty Pharma', 262409),
  indexEntry('NIFTY METAL', 'Nifty Metal', 263689),
  indexEntry('NIFTY REALTY', 'Nifty Realty', 261129),
  indexEntry('NIFTY ENERGY', 'Nifty Energy', 261641),
  indexEntry('NIFTY INFRA', 'Nifty Infra', 261385),
  indexEntry('NIFTY MEDIA', 'Nifty Media', 263945),
  indexEntry('NIFTY PSU BANK', 'Nifty PSU Bank', 262921),
  indexEntry('NIFTY PVT BANK', 'Nifty Pvt Bank', 271113),
  indexEntry('NIFTY HEALTHCARE', 'Nifty Healthcare', 288521),
  indexEntry('NIFTY CONSR DURBL', 'Nifty Consumer Durables', 288777),
  indexEntry('NIFTY OIL AND GAS', 'Nifty Oil & Gas', 289033),
  indexEntry('NIFTY CONSUMPTION', 'Nifty Consumption', 257545),
  indexEntry('NIFTY COMMODITIES', 'Nifty Commodities', 257289),
  separator('Broad Market'),
  indexEntry('NIFTY MIDCAP 100', 'Nifty Midcap 100', 256777),
  indexEntry('NIFTY 500', 'Nifty 500', 268041),
  indexEntry('NIFTY 100', 'Nifty 100', 260617),
  indexEntry('BANKEX', 'Bankex', 274441, 'BSE'),
  separator('Volatility'),
  indexEntry('INDIA VIX', 'India VIX', 264969),
];

const GSEC_ETF_SECTION = 'G-Sec / Bond / Gilt';

function moveEtfsGsecSectionToBottom(items) {
  const gsecStart = items.findIndex(
    (item) => item?.type === 'separator' && item.label?.trim() === GSEC_ETF_SECTION,
  );
  if (gsecStart < 0) return items;

  const nextSection = items.findIndex(
    (item, index) => index > gsecStart && item?.type === 'separator',
  );
  const gsecEnd = nextSection >= 0 ? nextSection : items.length;
  const gsecBlock = items.slice(gsecStart, gsecEnd);
  const withoutGsec = [...items.slice(0, gsecStart), ...items.slice(gsecEnd)];

  return [...withoutGsec, ...gsecBlock];
}

const ETF_ITEMS = moveEtfsGsecSectionToBottom(ETF_WATCHLIST_ITEMS.map(normalizeBookmark));

function separator(label) {
  return { type: 'separator', label };
}

function indexEntry(tradingsymbol, name, instrumentToken, exchange = 'INDICES') {
  return {
    tradingsymbol,
    name,
    exchange,
    segment: 'INDICES',
    instrument_token: instrumentToken,
  };
}

function equityEntry(tradingsymbol, name, instrumentToken, exchange = 'NSE') {
  return {
    tradingsymbol,
    name,
    exchange,
    segment: exchange,
    instrument_token: instrumentToken,
  };
}

export function watchlistScreenerId(id) {
  return `${WATCHLIST_PREFIX}${id}`;
}

export function isWatchlistScreenerId(screenerId) {
  return typeof screenerId === 'string' && screenerId.startsWith(WATCHLIST_PREFIX);
}

export function watchlistIdFromScreenerId(screenerId) {
  return isWatchlistScreenerId(screenerId) ? screenerId.slice(WATCHLIST_PREFIX.length) : null;
}

function makeId() {
  return `w${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function makeWatchlist(name, items = []) {
  return { id: makeId(), name, items };
}

function seedDefault() {
  const lists = [
    makeWatchlist('Indices', INDICES_ITEMS),
    makeWatchlist('ETFs', ETF_ITEMS),
  ];
  for (let i = 0; i < DEFAULT_COUNT; i += 1) {
    lists.push(makeWatchlist(`Watchlist ${i + 1}`, []));
  }
  return lists;
}

function watchlistNameKey(name) {
  return String(name || '').trim().toLowerCase();
}

export function isEtfsWatchlistName(name) {
  return watchlistNameKey(name) === 'etfs';
}

/** Intraday traded value proxy: volume × average traded price (falls back to LTP). */
export function tradedValue(row) {
  const volume = Number(row?.volume);
  const avg = Number(row?.average_price);
  const ltp = Number(row?.last_price);
  if (Number.isFinite(volume) && volume > 0 && Number.isFinite(avg) && avg > 0) {
    return volume * avg;
  }
  if (Number.isFinite(volume) && volume > 0 && Number.isFinite(ltp) && ltp > 0) {
    return volume * ltp;
  }
  return 0;
}

/** Sort each separator section by traded value desc; keep section headers fixed. */
export function sortWatchlistByTradedValue(rows) {
  const out = [];
  let bucket = [];

  const flush = () => {
    if (!bucket.length) return;
    out.push(
      ...[...bucket].sort((left, right) => {
        const delta = tradedValue(right) - tradedValue(left);
        if (delta !== 0) return delta;
        return String(left?.tradingsymbol || '').localeCompare(String(right?.tradingsymbol || ''));
      }),
    );
    bucket = [];
  };

  rows.forEach((row) => {
    if (row?.type === 'separator') {
      flush();
      out.push(row);
      return;
    }
    bucket.push(row);
  });
  flush();
  return out;
}

function appendMissingIndexEntries(items) {
  const keys = new Set(items.map((item) => bookmarkKey(item)));
  const additions = [
    indexEntry('NIFTY MIDCAP 100', 'Nifty Midcap 100', 256777),
    indexEntry('NIFTY SMLCAP 100', 'Nifty Smallcap 100', 267017),
  ].filter((item) => !keys.has(bookmarkKey(item)));
  if (!additions.length) return items;
  return [...items, ...additions];
}

function findSeparatorIndex(items, label) {
  return items.findIndex(
    (item) => item?.type === 'separator' && item.label?.trim() === label,
  );
}

/** Ensure Core Indices block has all entries in the canonical order (incl. SMLCAP 100). */
function ensureCoreIndicesSection(items) {
  const coreStart = findSeparatorIndex(items, 'Core Indices');
  if (coreStart < 0) return items;

  const sectorStart = findSeparatorIndex(items, 'Sector Indices');
  const end = sectorStart >= 0 ? sectorStart : items.length;
  const before = items.slice(0, coreStart + 1);
  const after = items.slice(end);

  const byKey = new Map();
  items.forEach((item) => {
    if (item?.type === 'separator') return;
    const key = bookmarkKey(item);
    if (CORE_INDEX_KEYS.has(key) && !byKey.has(key)) byKey.set(key, item);
  });

  const mergedCore = CORE_INDICES.map(
    (template) => byKey.get(bookmarkKey(template)) || template,
  );

  const filteredAfter = after.filter((item) => {
    if (item?.type === 'separator') return true;
    return !CORE_INDEX_KEYS.has(bookmarkKey(item));
  });

  return [...before, ...mergedCore, ...filteredAfter];
}

function migrateIndicesWatchlist(items) {
  return ensureCoreIndicesSection(items);
}

const LEGACY_ETF_SYMBOLS = new Set(['GOLDBEES', 'NIFTYBEES', 'BANKBEES'].map((s) => s.toUpperCase()));

function migrateIndicesVolatilitySection(items) {
  const volStart = findSeparatorIndex(items, 'Volatility');
  const legacyStart = findSeparatorIndex(items, 'ETFs & Volatility');
  const start = volStart >= 0 ? volStart : legacyStart;
  if (start < 0) {
    return [...items, separator('Volatility'), indexEntry('INDIA VIX', 'India VIX', 264969)];
  }

  const before = items.slice(0, start);
  let after = items.slice(start + 1);
  const nextSep = after.findIndex((item) => item?.type === 'separator');
  if (nextSep >= 0) after = after.slice(nextSep);

  const filteredAfter = after.filter((item) => {
    if (item?.type === 'separator') return true;
    const sym = String(item?.tradingsymbol || '').toUpperCase();
    return !LEGACY_ETF_SYMBOLS.has(sym);
  });

  const header = { type: 'separator', label: 'Volatility' };
  const vix = indexEntry('INDIA VIX', 'India VIX', 264969);
  return [...before, header, vix, ...filteredAfter];
}

function ensureEtfsWatchlist(lists) {
  if (localStorage.getItem(ETF_WATCHLIST_FLAG)) {
    let changed = false;
    let updated = lists;

    if (!localStorage.getItem(ETF_WATCHLIST_V1)) {
      localStorage.setItem(ETF_WATCHLIST_V1, '1');
      updated = updated.map((list) => {
        if (!isEtfsWatchlistName(list.name)) return list;
        if (list.items?.length) return list;
        changed = true;
        return { ...list, items: ETF_ITEMS };
      });
    }

    if (!localStorage.getItem(ETF_WATCHLIST_V2)) {
      localStorage.setItem(ETF_WATCHLIST_V2, '1');
      updated = updated.map((list) => {
        if (!isEtfsWatchlistName(list.name)) return list;
        const same = list.items?.length === ETF_ITEMS.length
          && list.items.every((item, i) => bookmarkKey(item) === bookmarkKey(ETF_ITEMS[i]));
        if (same) return list;
        changed = true;
        return { ...list, items: ETF_ITEMS };
      });
    }

    if (!localStorage.getItem(ETF_WATCHLIST_V3)) {
      localStorage.setItem(ETF_WATCHLIST_V3, '1');
      updated = updated.map((list) => {
        if (!isEtfsWatchlistName(list.name)) return list;
        const same = list.items?.length === ETF_ITEMS.length
          && list.items.every((item, i) => bookmarkKey(item) === bookmarkKey(ETF_ITEMS[i]));
        if (same) return list;
        changed = true;
        return { ...list, items: ETF_ITEMS };
      });
    }

    if (!localStorage.getItem(ETF_WATCHLIST_V4)) {
      localStorage.setItem(ETF_WATCHLIST_V4, '1');
      updated = updated.map((list) => {
        if (!isEtfsWatchlistName(list.name)) return list;
        const reordered = moveEtfsGsecSectionToBottom(list.items);
        const same = reordered.length === list.items.length
          && reordered.every((item, i) => bookmarkKey(item) === bookmarkKey(list.items[i]));
        if (same) return list;
        changed = true;
        return { ...list, items: reordered };
      });
    }

    if (changed) saveWatchlists(updated);
    return changed ? updated : lists;
  }

  const hasEtfs = lists.some((list) => isEtfsWatchlistName(list.name));
  localStorage.setItem(ETF_WATCHLIST_FLAG, '1');
  localStorage.setItem(ETF_WATCHLIST_V1, '1');
  localStorage.setItem(ETF_WATCHLIST_V2, '1');
  localStorage.setItem(ETF_WATCHLIST_V3, '1');
  localStorage.setItem(ETF_WATCHLIST_V4, '1');
  if (hasEtfs) return lists;

  const etfs = makeWatchlist('ETFs', ETF_ITEMS);
  if (lists.length < MAX_WATCHLISTS) return [etfs, ...lists];

  const emptyIndex = lists.findIndex((list) => !list.items?.length);
  if (emptyIndex >= 0) {
    return lists.map((list, index) => (index === emptyIndex ? etfs : list));
  }

  return lists;
}

function ensureIndicesWatchlist(lists) {
  if (localStorage.getItem(INDICES_WATCHLIST_FLAG)) {
    let changed = false;
    let updated = lists;

    if (!localStorage.getItem(INDICES_WATCHLIST_V2)) {
      localStorage.setItem(INDICES_WATCHLIST_V2, '1');
      updated = updated.map((list) => {
        if (list.name?.trim().toLowerCase() !== 'indices') return list;
        const nextItems = appendMissingIndexEntries(list.items);
        if (nextItems.length === list.items.length) return list;
        changed = true;
        return { ...list, items: nextItems };
      });
    }

    if (!localStorage.getItem(INDICES_WATCHLIST_V3)) {
      localStorage.setItem(INDICES_WATCHLIST_V3, '1');
      updated = updated.map((list) => {
        if (watchlistNameKey(list.name) !== 'indices') return list;
        const nextItems = migrateIndicesWatchlist(list.items);
        const same = nextItems.length === list.items.length
          && nextItems.every((item, i) => bookmarkKey(item) === bookmarkKey(list.items[i]));
        if (same) return list;
        changed = true;
        return { ...list, items: nextItems };
      });
    }

    if (!localStorage.getItem(INDICES_WATCHLIST_V4)) {
      localStorage.setItem(INDICES_WATCHLIST_V4, '1');
      updated = updated.map((list) => {
        if (watchlistNameKey(list.name) !== 'indices') return list;
        const nextItems = migrateIndicesVolatilitySection(list.items);
        const same = nextItems.length === list.items.length
          && nextItems.every((item, i) => bookmarkKey(item) === bookmarkKey(list.items[i]));
        if (same) return list;
        changed = true;
        return { ...list, items: nextItems };
      });
    }

    if (changed) saveWatchlists(updated);
    return changed ? updated : lists;
  }

  const hasIndices = lists.some((list) => watchlistNameKey(list.name) === 'indices');
  localStorage.setItem(INDICES_WATCHLIST_FLAG, '1');
  localStorage.setItem(INDICES_WATCHLIST_V2, '1');
  localStorage.setItem(INDICES_WATCHLIST_V3, '1');
  localStorage.setItem(INDICES_WATCHLIST_V4, '1');
  if (hasIndices) return lists;

  const indices = makeWatchlist('Indices', INDICES_ITEMS);
  if (lists.length < MAX_WATCHLISTS) return [indices, ...lists];

  const emptyIndex = lists.findIndex((list) => !list.items?.length);
  if (emptyIndex >= 0) {
    return lists.map((list, index) => (index === emptyIndex ? indices : list));
  }

  return lists;
}

/** One-time: move symbols that were seeded into Watchlist 1 into Bookmarks. */
export function migrateWatchlist1ToBookmarks(watchlists, bookmarks) {
  if (bookmarks.length || !watchlists.length || localStorage.getItem(WL1_MIGRATION_FLAG)) {
    return { watchlists, bookmarks };
  }

  const first = watchlists[0];
  if (first?.name?.trim().toLowerCase() === 'indices') {
    localStorage.setItem(WL1_MIGRATION_FLAG, '1');
    return { watchlists, bookmarks };
  }

  if (!first?.items?.length) {
    localStorage.setItem(WL1_MIGRATION_FLAG, '1');
    return { watchlists, bookmarks };
  }

  const merged = [...bookmarks, ...first.items.map(normalizeBookmark)];
  const cleared = watchlists.map((list, index) => (
    index === 0 ? { ...list, items: [] } : list
  ));
  localStorage.setItem(WL1_MIGRATION_FLAG, '1');
  return { watchlists: cleared, bookmarks: merged };
}

export function loadWatchlists() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length) {
        const lists = parsed.map((list) => ({
          id: list.id || makeId(),
          name: list.name || 'Watchlist',
          items: Array.isArray(list.items) ? list.items.map(normalizeBookmark) : [],
        }));
        const withIndices = ensureIndicesWatchlist(lists);
        const withEtfs = ensureEtfsWatchlist(withIndices);
        if (withEtfs !== lists) saveWatchlists(withEtfs);
        return withEtfs;
      }
    }
  } catch {
    // fall through to seeding
  }

  const seeded = seedDefault();
  saveWatchlists(seeded);
  return seeded;
}

export function saveWatchlists(lists) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(lists));
  } catch {
    // ignore storage failures
  }
}

export function createWatchlist(lists, name) {
  if (lists.length >= MAX_WATCHLISTS) return lists;
  const label = (name || '').trim() || `Watchlist ${lists.length + 1}`;
  return [...lists, makeWatchlist(label)];
}

export function renameWatchlist(lists, id, name) {
  const label = (name || '').trim();
  if (!label) return lists;
  return lists.map((list) => (list.id === id ? { ...list, name: label } : list));
}

export function deleteWatchlist(lists, id) {
  const next = lists.filter((list) => list.id !== id);
  return next.length ? next : seedDefault();
}

export function addToWatchlist(lists, id, entry) {
  const normalized = normalizeBookmark(entry);
  if (!normalized.tradingsymbol) return lists;
  const key = bookmarkKey(normalized);

  return lists.map((list) => {
    if (list.id !== id) return list;
    if (list.items.some((item) => bookmarkKey(item) === key)) return list;
    return { ...list, items: [...list.items, normalized] };
  });
}

export function removeFromWatchlist(lists, id, key) {
  return lists.map((list) => {
    if (list.id !== id) return list;
    return { ...list, items: list.items.filter((item) => bookmarkKey(item) !== key) };
  });
}

export function reorderWatchlistItems(lists, id, fromIndex, toIndex) {
  if (fromIndex === toIndex) return lists;
  if (fromIndex < 0 || toIndex < 0) return lists;

  return lists.map((list) => {
    if (list.id !== id) return list;
    const items = list.items;
    if (fromIndex >= items.length || toIndex >= items.length) return list;

    const next = [...items];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    return { ...list, items: next };
  });
}

export function toggleInWatchlist(lists, id, entry) {
  const normalized = normalizeBookmark(entry);
  if (!normalized.tradingsymbol) return lists;
  const key = bookmarkKey(normalized);
  const target = lists.find((list) => list.id === id);
  if (!target) return lists;

  const exists = target.items.some((item) => bookmarkKey(item) === key);
  return exists ? removeFromWatchlist(lists, id, key) : addToWatchlist(lists, id, normalized);
}

export function isInWatchlist(lists, id, entry) {
  const key = bookmarkKey(entry);
  const list = lists.find((item) => item.id === id);
  return Boolean(list?.items.some((item) => bookmarkKey(item) === key));
}
