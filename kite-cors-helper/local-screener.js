if (!location.pathname.startsWith('/local-screener')) {
  // Extension is inactive outside the local screener path.
} else {
  chrome.runtime.sendMessage({ type: 'activateLocalScreener' });

  // Bridge: the app runs in the MAIN world and cannot call chrome.* directly.
  // It posts a request here (isolated world), we ask the background service
  // worker to read the HttpOnly enctoken cookie, then post the result back.
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== 'kite-screener') return;

    if (data.type === 'getEnctoken') {
      chrome.runtime.sendMessage({ type: 'getEnctoken' }, (response) => {
        window.postMessage(
          {
            source: 'kite-screener-bridge',
            type: 'enctoken',
            id: data.id,
            ok: Boolean(response?.ok),
            enctoken: response?.enctoken || '',
            userId: response?.userId || '',
            error: response?.error || (chrome.runtime.lastError?.message ?? ''),
          },
          '*',
        );
      });
      return;
    }

    if (data.type === 'mfFetch') {
      chrome.runtime.sendMessage({
        type: 'mfFetch',
        url: data.url,
        accept: data.accept,
      }, (response) => {
        window.postMessage(
          {
            source: 'kite-screener-bridge',
            type: 'mfFetch',
            id: data.id,
            ok: Boolean(response?.ok),
            status: response?.status ?? 0,
            text: response?.text || '',
            error: response?.error || (chrome.runtime.lastError?.message ?? ''),
          },
          '*',
        );
      });
      return;
    }

    if (data.type === 'getInstrumentToken') {
      chrome.runtime.sendMessage({
        type: 'getInstrumentToken',
        tradingsymbol: data.tradingsymbol,
        exchange: data.exchange,
        segment: data.segment,
      }, (response) => {
        window.postMessage(
          {
            source: 'kite-screener-bridge',
            type: 'instrumentToken',
            id: data.id,
            ok: Boolean(response?.ok),
            token: response?.token || null,
            error: response?.error || (chrome.runtime.lastError?.message ?? ''),
          },
          '*',
        );
      });
    }
  });
}
