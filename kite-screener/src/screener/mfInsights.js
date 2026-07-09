// Rich per-fund insights sourced from finapi.upvaly.com (free, no auth), keyed
// by ISIN — which every AMFI scheme object already carries. A single request
// returns ratings, expense ratio, AUM, trailing + rolling returns, category
// ranks, risk metrics (std dev / Sharpe / Sortino / Beta vs peers), holdings,
// sector allocation and peers, so the app doesn't compute any of it locally.
//
// Requests are relayed through the extension bridge (mfProxy) because the app
// runs in the CORS-restricted kite.zerodha.com MAIN world.

import { mfFetchJson } from './mfProxy';

const FINAPI_ISIN_BASE = 'https://finapi.upvaly.com/api/mf/isin';
const TTL_MS = 6 * 60 * 60 * 1000; // 6h in-memory cache per ISIN

const cache = new Map(); // isin -> { at: number, data: {...} }
const inflight = new Map(); // isin -> Promise

/** Fetch the full insights payload for a scheme ISIN (cached per session). */
export async function loadMfInsights(isin, { signal, force = false } = {}) {
  const key = String(isin || '').trim();
  if (!key) throw new Error('This scheme has no ISIN, so extended insights are unavailable.');

  const cached = cache.get(key);
  if (!force && cached && Date.now() - cached.at < TTL_MS) return cached.data;
  if (inflight.has(key)) return inflight.get(key);

  const promise = (async () => {
    const payload = await mfFetchJson(`${FINAPI_ISIN_BASE}/${encodeURIComponent(key)}`, { signal });
    const data = payload?.data;
    if (!payload || payload.status !== 'success' || !data) {
      throw new Error(payload?.message || 'Fund insights are not available for this scheme.');
    }
    cache.set(key, { at: Date.now(), data });
    return data;
  })().finally(() => {
    inflight.delete(key);
  });

  inflight.set(key, promise);
  return promise;
}

/** Third-party fund pages to open in a new tab (URLs are name-slug/search based). */
export function buildExternalMfLinks(name) {
  const q = encodeURIComponent(String(name || '').trim());
  return [
    { label: 'Tickertape', url: `https://www.tickertape.in/mutualfunds?search=${q}` },
    { label: 'Value Research', url: `https://www.valueresearchonline.com/funds/search/?q=${q}` },
    { label: 'Groww', url: `https://groww.in/search?q=${q}&entity=mutual_fund` },
    { label: 'Morningstar', url: `https://www.morningstar.in/tools/mutual-fund-search.aspx?q=${q}` },
  ];
}
