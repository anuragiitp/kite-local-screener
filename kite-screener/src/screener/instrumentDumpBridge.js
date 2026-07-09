// Bridge to extension background for api.kite.trade/instruments (no CORS from page).

export function requestInstrumentDumpEntries(timeoutMs = 120000) {
  return new Promise((resolve) => {
    const id = `dump-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const timer = setTimeout(() => {
      window.removeEventListener('message', onMessage);
      resolve({ ok: false, entries: null, error: 'timeout' });
    }, timeoutMs);

    function onMessage(event) {
      if (event.source !== window) return;
      const data = event.data;
      if (!data || data.source !== 'kite-screener-bridge' || data.type !== 'instrumentDump') return;
      if (data.id !== id) return;
      clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      resolve({
        ok: Boolean(data.ok && data.entries),
        entries: data.entries || null,
        error: data.error || '',
      });
    }

    window.addEventListener('message', onMessage);
    window.postMessage({ source: 'kite-screener', type: 'getInstrumentDump', id }, '*');
  });
}
