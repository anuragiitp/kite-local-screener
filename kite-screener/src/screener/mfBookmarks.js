// Saved mutual funds. Kept separate from equity bookmarks/watchlists because MF
// schemes have no Kite instrument token or live websocket ticks — they are keyed
// by AMFI scheme code and priced by daily NAV.

const STORAGE_KEY = 'kite-screener-mf-saved';

export function mfSavedKey(scheme) {
  return String(scheme?.schemeCode || '');
}

export function normalizeSavedScheme(scheme) {
  return {
    schemeCode: String(scheme?.schemeCode || ''),
    name: scheme?.name || '',
    amc: scheme?.amc || '',
    schemeType: scheme?.schemeType || '',
    subCategory: scheme?.subCategory || '',
    plan: scheme?.plan || '',
    option: scheme?.option || '',
  };
}

export function loadSavedFunds() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((item) => item?.schemeCode).map(normalizeSavedScheme)
      : [];
  } catch {
    return [];
  }
}

export function saveSavedFunds(list) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    // ignore storage failures
  }
}

export function isFundSaved(list, scheme) {
  const key = mfSavedKey(scheme);
  return list.some((item) => mfSavedKey(item) === key);
}

export function toggleSavedFund(list, scheme) {
  const entry = normalizeSavedScheme(scheme);
  if (!entry.schemeCode) return list;
  const key = mfSavedKey(entry);
  const exists = list.some((item) => mfSavedKey(item) === key);
  const next = exists
    ? list.filter((item) => mfSavedKey(item) !== key)
    : [...list, entry];
  saveSavedFunds(next);
  return next;
}
