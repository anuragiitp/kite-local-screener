// Fetch public mutual-fund data (AMFI, mfapi.in) from the injected app.
//
// The screener app runs in the MAIN world on kite.zerodha.com, so a direct
// cross-origin fetch to these hosts is blocked by CORS. We relay the request
// through the extension background service worker (which has host permissions)
// via the same postMessage bridge used for the Kite session token.

import { isKiteEmbedded } from './kiteApi';

function requestViaBridge(url, { accept = '*/*', timeoutMs = 60000 } = {}) {
  return new Promise((resolve, reject) => {
    const id = `mf-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const timer = setTimeout(() => {
      window.removeEventListener('message', onMessage);
      reject(new Error('Mutual fund data request timed out'));
    }, timeoutMs);

    function onMessage(event) {
      if (event.source !== window) return;
      const data = event.data;
      if (!data || data.source !== 'kite-screener-bridge' || data.type !== 'mfFetch') return;
      if (data.id !== id) return;

      clearTimeout(timer);
      window.removeEventListener('message', onMessage);

      if (data.ok) {
        resolve(data.text || '');
      } else {
        reject(new Error(data.error || `Mutual fund data request failed (HTTP ${data.status})`));
      }
    }

    window.addEventListener('message', onMessage);
    window.postMessage({ source: 'kite-screener', type: 'mfFetch', id, url, accept }, '*');
  });
}

async function requestDirect(url, { accept = '*/*', signal } = {}) {
  const response = await fetch(url, { credentials: 'omit', signal, headers: { accept } });
  if (!response.ok) {
    throw new Error(`Mutual fund data request failed (HTTP ${response.status})`);
  }
  return response.text();
}

/** Fetch a whitelisted MF data URL as text, via the extension bridge when embedded. */
export async function mfFetchText(url, options = {}) {
  if (isKiteEmbedded()) {
    return requestViaBridge(url, options);
  }
  return requestDirect(url, options);
}

/** Fetch and JSON-parse a whitelisted MF data URL. */
export async function mfFetchJson(url, options = {}) {
  const text = await mfFetchText(url, { accept: 'application/json', ...options });
  return text ? JSON.parse(text) : null;
}
