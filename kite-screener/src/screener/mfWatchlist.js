// The user's editable mutual fund list (ISINs only), stored in localStorage and included in backups.

export const MF_VIEW_ID = 'mf:funds';
export const MF_WATCHLIST_KEY = 'kite-screener-mf-watchlist';

export const DEFAULT_MF_WATCHLIST = [
  'INF109K013N3', 'INF769K01BI1', 'INF179K01UT0', 'INF846K01X06', 'INF179KC1BQ9', 'INF179KC1GO3',
  'INF846K01Y39', 'INF204K01XF9', 'INF204K01K15', 'INF843K01AU1', 'INF846K01EH3', 'INF205K01KY4',
  'INF179K01WM1', 'INF109K01Z48', 'INF846K01J46', 'INF205K013T3', 'INF200K01VE4', 'INF109KC1RH9',
  'INF109K01Z14', 'INF769K01AX2', 'INF247L01890', 'INF179K01XQ0', 'INF879O01027', 'INF200K01RV6',
  'INF204K01XO1', 'INF769K01BL5', 'INF179K01YM7', 'INF846K01K35', 'INF205K01MV6', 'INF179KC1BG0',
  'INF174K01LT0',
  'INF174K01LW4', 'INF843K01IZ3', 'INF247L01718', 'INF846K01DP8', 'INF754K01LB7', 'INF769K01HH0',
  'INF204KA15G5', 'INF109K01Z71', 'INF205K01LB0', 'INF966L01689', 'INF769K01HU3', 'INF769K01IS5',
  'INF843K01EC1', 'INF204K01XI3', 'INF966L01887', 'INF174K01LS2', 'INF200K01UG1', 'INF179K01YV8',
  'INF179KA1RQ7', 'INF174K01LF9', 'INF204K01I50', 'INF179K01VK7', 'INF109KC16J4', 'INF109KC1U50',
  'INF754K01SK3', 'INF109K013J1', 'INF179K01VX0',
];

const ISIN_RE = /^INF[A-Z0-9]{9}$/;

export function loadMfWatchlist() {
  try {
    const raw = localStorage.getItem(MF_WATCHLIST_KEY);
    if (raw === null) return [...DEFAULT_MF_WATCHLIST];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [...DEFAULT_MF_WATCHLIST];
    return [...new Set(parsed.filter((isin) => typeof isin === 'string' && ISIN_RE.test(isin)))];
  } catch {
    return [...DEFAULT_MF_WATCHLIST];
  }
}

export function saveMfWatchlist(list) {
  try {
    localStorage.setItem(MF_WATCHLIST_KEY, JSON.stringify(list));
  } catch {
    // Storage full or blocked: the list still works for this session.
  }
}
