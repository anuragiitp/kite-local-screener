// postMessage bridge to the extension (see kite-cors-helper/local-screener.js).

const REPLY_TYPES = {
  getNifty500List: 'nifty500List',
  strategyStore: 'strategyStoreResult',
};

export function bridgeRequest(type, payload = {}, timeoutMs = 30000) {
  return new Promise((resolve) => {
    if (typeof window === 'undefined') {
      resolve({ ok: false, error: 'no window' });
      return;
    }
    const id = `${type}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const replyType = REPLY_TYPES[type];

    const timer = setTimeout(() => {
      window.removeEventListener('message', onMessage);
      resolve({ ok: false, error: 'timeout', timeout: true });
    }, timeoutMs);

    function onMessage(event) {
      if (event.source !== window) return;
      const data = event.data;
      if (!data || data.source !== 'kite-screener-bridge' || data.type !== replyType || data.id !== id) return;
      clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      resolve(data);
    }

    window.addEventListener('message', onMessage);
    window.postMessage({ ...payload, source: 'kite-screener', type, id }, '*');
  });
}
