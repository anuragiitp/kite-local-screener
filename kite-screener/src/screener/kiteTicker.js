// Live market data via Kite's internal web ticker (wss://ws.zerodha.com).
// Binary tick format is ported from the official Kite Connect SDK.

const WS_ROOT = 'wss://ws.zerodha.com/';
const MAX_RECONNECT_DELAY_MS = 30000;
const MAX_RECONNECT_ATTEMPTS = 20;

export const MODE_LTP = 'ltp';
export const MODE_QUOTE = 'quote';
export const MODE_FULL = 'full';

const NSE_CD = 3;

export function requestEnctoken(timeoutMs = 4000) {
  return new Promise((resolve) => {
    const id = `enc-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const timer = setTimeout(() => {
      window.removeEventListener('message', onMessage);
      resolve({ ok: false, enctoken: '', userId: '', error: 'timeout' });
    }, timeoutMs);

    function onMessage(event) {
      if (event.source !== window) return;
      const data = event.data;
      if (!data || data.source !== 'kite-screener-bridge' || data.type !== 'enctoken') return;
      if (data.id !== id) return;
      clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      resolve({
        ok: Boolean(data.ok && data.enctoken),
        enctoken: data.enctoken || '',
        userId: data.userId || '',
        error: data.error || '',
      });
    }

    window.addEventListener('message', onMessage);
    window.postMessage({ source: 'kite-screener', type: 'getEnctoken', id }, '*');
  });
}

function buildUrl(enctoken, userId) {
  const params = new URLSearchParams({
    api_key: 'kitefront',
    user_id: userId || '',
    enctoken,
    'user-agent': 'kite3-web',
    version: '3.0.0',
    uid: String(Date.now()),
  });
  return `${WS_ROOT}?${params.toString()}`;
}

export class KiteTicker {
  constructor({ enctoken, userId, onTick, onStatus } = {}) {
    this.enctoken = enctoken;
    this.userId = userId;
    this.onTick = onTick || (() => {});
    this.onStatus = onStatus || (() => {});

    this.ws = null;
    this.subscribed = new Set();
    this.modeMap = new Map();
    this.defaultMode = MODE_QUOTE;
    this.reconnectAttempts = 0;
    this.reconnectTimer = null;
    this.stopped = true;
    this.paused = false;
  }

  connect() {
    if (!this.enctoken) {
      this.onStatus('error', 'Missing enctoken');
      return;
    }
    this.stopped = false;
    this.paused = false;
    this.reconnectAttempts = 0;
    this._open();
  }

  /** Close the socket but keep subscriptions for resume(). */
  pause() {
    this.paused = true;
    this._clearReconnectTimer();
    this._closeSocket();
  }

  resume() {
    if (!this.enctoken || this.stopped || !this.paused) return;
    this.paused = false;
    this.reconnectAttempts = 0;
    this._open();
  }

  _open() {
    if (this.stopped || this.paused) return;

    this._closeSocket();

    try {
      this.ws = new WebSocket(buildUrl(this.enctoken, this.userId));
    } catch {
      this._scheduleReconnect();
      return;
    }

    this.ws.binaryType = 'arraybuffer';

    this.ws.onopen = () => {
      if (this.stopped || this.paused) {
        this._closeSocket();
        return;
      }
      this.reconnectAttempts = 0;
      this.onStatus('connected');
      this._resubscribeAll();
    };

    this.ws.onmessage = (event) => {
      if (this.stopped || typeof event.data === 'string') return;
      const buffer = event.data;
      if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 2) return;
      const ticks = parseBinary(new DataView(buffer));
      if (ticks.length) this.onTick(ticks);
    };

    this.ws.onerror = () => {
      if (!this.stopped) this.onStatus('error');
    };

    this.ws.onclose = () => {
      this.ws = null;
      if (!this.stopped && !this.paused) {
        this.onStatus('disconnected');
        this._scheduleReconnect();
      }
    };
  }

  _resubscribeAll() {
    if (!this.subscribed.size) return;
    const tokens = Array.from(this.subscribed);
    this._send({ a: 'subscribe', v: tokens });
    const byMode = new Map();
    tokens.forEach((token) => {
      const mode = this.modeMap.get(token) || this.defaultMode;
      if (!byMode.has(mode)) byMode.set(mode, []);
      byMode.get(mode).push(token);
    });
    byMode.forEach((list, mode) => this._send({ a: 'mode', v: [mode, list] }));
  }

  _closeSocket() {
    if (!this.ws) return;
    const socket = this.ws;
    this.ws = null;
    socket.onopen = null;
    socket.onmessage = null;
    socket.onerror = null;
    socket.onclose = null;
    try {
      socket.close();
    } catch {
      // ignore
    }
  }

  _clearReconnectTimer() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  _scheduleReconnect() {
    if (this.stopped || this.paused || this.reconnectTimer) return;
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      this.onStatus('error', 'Max reconnect attempts reached');
      return;
    }

    const delay = Math.min(2000 * 2 ** this.reconnectAttempts, MAX_RECONNECT_DELAY_MS);
    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this._open();
    }, delay);
  }

  _send(payload) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  subscribe(tokens, mode = MODE_QUOTE) {
    const fresh = tokens.filter((token) => !this.subscribed.has(token));
    tokens.forEach((token) => {
      this.subscribed.add(token);
      this.modeMap.set(token, mode);
    });
    if (!fresh.length) return;
    this._send({ a: 'subscribe', v: fresh });
    this._send({ a: 'mode', v: [mode, fresh] });
  }

  unsubscribe(tokens) {
    const drop = tokens.filter((token) => this.subscribed.has(token));
    drop.forEach((token) => {
      this.subscribed.delete(token);
      this.modeMap.delete(token);
    });
    if (drop.length) this._send({ a: 'unsubscribe', v: drop });
  }

  /** Reconcile subscriptions; selected symbols can use full mode for market depth. */
  syncSubscriptions({ quoteTokens = [], fullTokens = [] } = {}) {
    const quoteSet = new Set(quoteTokens);
    const fullSet = new Set(fullTokens);
    const next = new Set([...quoteSet, ...fullSet]);

    const toRemove = Array.from(this.subscribed).filter((token) => !next.has(token));
    const toAdd = [...next].filter((token) => !this.subscribed.has(token));

    toAdd.forEach((token) => {
      this.subscribed.add(token);
      this.modeMap.set(token, fullSet.has(token) ? MODE_FULL : MODE_QUOTE);
    });
    if (toAdd.length) this._send({ a: 'subscribe', v: toAdd });

    if (toRemove.length) this.unsubscribe(toRemove);

    const quoteOnly = [...next].filter((token) => !fullSet.has(token));
    const fullOnly = [...next].filter((token) => fullSet.has(token));

    if (quoteOnly.length) {
      quoteOnly.forEach((token) => this.modeMap.set(token, MODE_QUOTE));
      this._send({ a: 'mode', v: [MODE_QUOTE, quoteOnly] });
    }
    if (fullOnly.length) {
      fullOnly.forEach((token) => this.modeMap.set(token, MODE_FULL));
      this._send({ a: 'mode', v: [MODE_FULL, fullOnly] });
    }
  }

  /** @deprecated use syncSubscriptions */
  setTokens(tokens, mode = MODE_QUOTE) {
    this.defaultMode = mode;
    if (mode === MODE_FULL) {
      this.syncSubscriptions({ fullTokens: tokens });
      return;
    }
    this.syncSubscriptions({ quoteTokens: tokens });
  }

  disconnect() {
    this.stopped = true;
    this.paused = false;
    this._clearReconnectTimer();
    this.subscribed.clear();
    this.modeMap.clear();
    this._closeSocket();
  }
}

function parseBinary(view) {
  const ticks = [];
  const numPackets = view.getInt16(0);
  let offset = 2;

  for (let i = 0; i < numPackets; i += 1) {
    if (offset + 2 > view.byteLength) break;
    const size = view.getInt16(offset);
    offset += 2;
    if (offset + size > view.byteLength) break;
    const tick = parsePacket(view, offset, size);
    if (tick) ticks.push(tick);
    offset += size;
  }

  return ticks;
}

function parseDepth(view, start, divisor) {
  const buy = [];
  const sell = [];

  for (let i = 0; i < 10; i += 1) {
    const offset = start + i * 12;
    const item = {
      quantity: view.getInt32(offset),
      price: view.getInt32(offset + 4) / divisor,
      orders: view.getInt16(offset + 8),
    };
    if (i < 5) buy.push(item);
    else sell.push(item);
  }

  return { buy, sell };
}

function parseQuotePacket(view, start, token, size, divisor) {
  const last = view.getInt32(start + 4) / divisor;
  const close = view.getInt32(start + 40) / divisor;
  const tick = {
    instrument_token: token,
    mode: size === 184 ? MODE_FULL : MODE_QUOTE,
    last_price: last,
    last_quantity: view.getInt32(start + 8),
    average_price: view.getInt32(start + 12) / divisor,
    volume: view.getInt32(start + 16),
    buy_quantity: view.getInt32(start + 20),
    sell_quantity: view.getInt32(start + 24),
    open: view.getInt32(start + 28) / divisor,
    high: view.getInt32(start + 32) / divisor,
    low: view.getInt32(start + 36) / divisor,
    close,
    change_percent: close ? ((last - close) * 100) / close : 0,
    change: last - close,
  };

  if (size === 184) {
    const lastTradeTs = view.getInt32(start + 44);
    const exchangeTs = view.getInt32(start + 60);
    tick.last_trade_time = lastTradeTs > 0 ? lastTradeTs : null;
    tick.timestamp = exchangeTs > 0 ? exchangeTs : lastTradeTs;
    tick.oi = view.getInt32(start + 48);
    tick.depth = parseDepth(view, start + 64, divisor);
  }

  return tick;
}

function parsePacket(view, start, size) {
  const token = view.getInt32(start);
  const segment = token & 0xff;
  const divisor = segment === NSE_CD ? 10000000 : 100;

  if (size === 8) {
    return {
      instrument_token: token,
      mode: MODE_LTP,
      last_price: view.getInt32(start + 4) / divisor,
    };
  }

  if (size === 28 || size === 32) {
    const last = view.getInt32(start + 4) / divisor;
    const close = view.getInt32(start + 20) / divisor;
    return {
      instrument_token: token,
      mode: MODE_FULL,
      tradable: false,
      last_price: last,
      high: view.getInt32(start + 8) / divisor,
      low: view.getInt32(start + 12) / divisor,
      open: view.getInt32(start + 16) / divisor,
      close,
      change_percent: close ? ((last - close) * 100) / close : 0,
      change: last - close,
    };
  }

  if (size === 44 || size === 184) {
    return parseQuotePacket(view, start, token, size, divisor);
  }

  return null;
}
