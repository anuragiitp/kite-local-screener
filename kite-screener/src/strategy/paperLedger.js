// Paper ledger for a strategy run: deterministic day-by-day replay with next-open fills.
// Pure functions over a panel (see strategyData.js) — no I/O, no real orders.

import { DEFAULT_CONFIG, SUMMIT_20, decide, seriesData } from './summitMomentum.js';

export const LEDGER_SCHEMA = 1;
const TRADING_DAYS = 252;

function num(v) {
  return v === null || v === undefined ? NaN : Number(v);
}

function round(v, digits = 2) {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

function holdingSymbols(state) {
  return Object.keys(state.positions);
}

function daysBetween(a, b) {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
}

/**
 * Create a new run. With initialBuild (default) the first portfolio is decided on startIndex
 * (the latest completed session) and bought at the next session's open.
 */
export function createRun({
  panel,
  startIndex,
  universe,
  capital = DEFAULT_CONFIG.capital,
  cfg: cfgOverride = {},
  options = {},
  now = new Date().toISOString(),
  id = `run-${Date.now().toString(36)}`,
}) {
  const cfg = { ...DEFAULT_CONFIG, ...cfgOverride, capital };
  const opts = { wholeShares: true, circuitRule: true, initialBuild: true, ...options };
  const startDate = panel.dates[startIndex];
  const state = {
    schema: LEDGER_SCHEMA,
    run: {
      id,
      strategy: SUMMIT_20.code,
      name: SUMMIT_20.name,
      version: SUMMIT_20.version,
      capital,
      cfg,
      options: opts,
      startDate,
      createdAt: now,
    },
    cash: capital,
    positions: {},
    pending: null,
    trades: [],
    fills: [],
    journal: [],
    nav: [],
    lastSignalCheck: '',
    lastProcessed: opts.initialBuild ? startDate : panel.dates[startIndex - 1] || '',
    updatedAt: now,
  };
  if (opts.initialBuild) {
    state.nav.push(navRow(state, panel, startIndex));
    makeDecision(state, panel, startIndex, universe, 'initial');
  }
  return state;
}

function navRow(state, panel, i) {
  let invested = 0;
  for (const p of Object.values(state.positions)) invested += p.qty * p.last;
  return {
    date: panel.dates[i],
    nav: round(state.cash + invested),
    cash: round(state.cash),
    invested: round(invested),
    holdings: Object.keys(state.positions).length,
    n500: round(num(panel.bench[i])),
    n50: panel.nifty50 ? round(num(panel.nifty50[i])) : null,
  };
}

function makeDecision(state, panel, i, universe, kind) {
  const cfg = state.run.cfg;
  const decision = decide(panel, i, universe, holdingSymbols(state), cfg);
  const date = panel.dates[i];
  if (state.pending) {
    const leftover = [...state.pending.sells, ...state.pending.buys].filter((o) => o.status === 'pending');
    if (leftover.length) {
      state.journal.push({
        date,
        kind: 'expired',
        text: `${leftover.length} unfilled order(s) from ${state.pending.signalDate} replaced by the new signal`,
        orders: leftover.map((o) => o.sym),
      });
    }
  }
  state.pending = {
    signalDate: date,
    kind,
    sells: decision.sells.map((s) => ({ sym: s.sym, code: s.code, reason: s.reason, rank: s.rank, signalClose: s.close, status: 'pending', attempts: [] })),
    buys: decision.buys.map((b) => ({ sym: b.sym, rank: b.rank, score: round(b.score, 4), signalClose: b.close, status: 'pending', attempts: [] })),
  };
  state.lastSignalCheck = date;
  state.journal.push({
    date,
    kind,
    market: {
      level: round(decision.market.level),
      ma: round(decision.market.ma),
      riskOff: decision.market.riskOff,
    },
    universeCount: decision.universeCount,
    eligibleCount: decision.eligibleCount,
    freeSlots: decision.freeSlots,
    sells: decision.sells.map((s) => ({ sym: s.sym, code: s.code, rank: s.rank, reason: s.reason })),
    holds: decision.holds.map((h) => ({ sym: h.sym, rank: h.rank, reason: h.reason })),
    buys: decision.buys.map((b) => ({ sym: b.sym, rank: b.rank, score: round(b.score, 4) })),
    skipped: decision.skipped.map((s) => ({ sym: s.sym, rank: s.rank, code: s.code })),
    top: decision.ranked.slice(0, 40).map((r) => [r.sym, r.rank, round(r.score, 4)]),
    universe: [...universe],
  });
  if (!state.pending.sells.length && !state.pending.buys.length) state.pending = null;
  return decision;
}

function candleAt(panel, sym, i) {
  const s = panel.series[sym];
  if (!s) return null;
  const { af } = seriesData(s, DEFAULT_CONFIG);
  return {
    open: num(s.open?.[i]),
    high: num(s.high?.[i]),
    low: num(s.low?.[i]),
    close: num(s.close[i]),
    af: af[i],
    prevClose: i > 0 ? af[i - 1] : NaN,
  };
}

function lockedLower(c) {
  return Number.isFinite(c.high) && c.high === c.low && c.close < c.prevClose;
}

function lockedUpper(c) {
  return Number.isFinite(c.high) && c.high === c.low && c.open > c.prevClose;
}

function sellPosition(state, sym, px, date, info) {
  const cfg = state.run.cfg;
  const p = state.positions[sym];
  delete state.positions[sym];
  const value = p.qty * px;
  const proceeds = value * (1 - cfg.cost);
  state.cash += proceeds;
  const pnl = proceeds - p.basis;
  const trade = {
    sym,
    qty: p.qty,
    entryDate: p.entryDate,
    entryPrice: p.entryPrice,
    entryRank: p.entryRank,
    basis: round(p.basis),
    exitDate: date,
    exitPrice: round(px, 4),
    proceeds: round(proceeds),
    pnl: round(pnl),
    ret: round(pnl / p.basis, 6),
    days: daysBetween(p.entryDate, date),
    code: info.code,
    reason: info.reason,
    signalDate: info.signalDate || null,
  };
  state.trades.push(trade);
  state.fills.push({
    date,
    side: 'SELL',
    sym,
    qty: p.qty,
    price: round(px, 4),
    value: round(value),
    charges: round(value * cfg.cost),
    code: info.code,
    reason: info.reason,
    signalDate: info.signalDate || null,
    note: info.note || '',
    pnl: round(pnl),
  });
}

function buyPosition(state, sym, px, amount, date, order) {
  const cfg = state.run.cfg;
  let qty = (amount * (1 - cfg.cost)) / px;
  let spend = amount;
  if (state.run.options.wholeShares) {
    qty = Math.floor(qty);
    if (qty < 1) return false;
    spend = (qty * px) / (1 - cfg.cost);
  }
  state.cash -= spend;
  state.positions[sym] = {
    qty,
    basis: spend,
    entryDate: date,
    entryPrice: round(px, 4),
    entryRank: order.rank ?? null,
    signalDate: order.signalDate || null,
    peak: px,
    last: px,
    lastDate: date,
    stale: 0,
  };
  state.fills.push({
    date,
    side: 'BUY',
    sym,
    qty,
    price: round(px, 4),
    value: round(qty * px),
    charges: round(spend - qty * px),
    rank: order.rank ?? null,
    signalDate: order.signalDate || null,
    note: order.attempts?.length ? `filled after ${order.attempts.length} blocked day(s)` : '',
  });
  return true;
}

function executePending(state, panel, i) {
  const pending = state.pending;
  const date = panel.dates[i];
  const { circuitRule } = state.run.options;
  const blocked = (order, why) => {
    order.attempts.push({ date, why });
  };

  for (const order of pending.sells) {
    if (order.status !== 'pending') continue;
    const pos = state.positions[order.sym];
    if (!pos) {
      order.status = 'cancelled';
      continue;
    }
    const c = candleAt(panel, order.sym, i);
    if (circuitRule && c && !Number.isFinite(c.close)) {
      blocked(order, 'no trade (suspended?)');
      continue;
    }
    if (circuitRule && c && lockedLower(c)) {
      blocked(order, 'locked at lower circuit');
      continue;
    }
    let px = c && c.open > 0 ? c.open : c?.af;
    if (!Number.isFinite(px) || !(px > 0)) px = pos.last;
    sellPosition(state, order.sym, px, date, {
      code: order.code,
      reason: order.reason,
      signalDate: pending.signalDate,
      note: order.attempts.length ? `filled after ${order.attempts.length} blocked day(s)` : '',
    });
    order.status = 'filled';
  }

  const buys = pending.buys.filter((o) => o.status === 'pending');
  if (buys.length) {
    const cfg = state.run.cfg;
    let navOpen = state.cash;
    for (const p of Object.values(state.positions)) navOpen += p.qty * p.last;
    const target = navOpen / cfg.topN;
    buys.forEach((order, k) => {
      if (state.positions[order.sym]) {
        order.status = 'cancelled';
        return;
      }
      const c = candleAt(panel, order.sym, i);
      if (circuitRule && (!c || !Number.isFinite(c.close))) {
        blocked(order, 'no trade (suspended?)');
        return;
      }
      if (circuitRule && lockedUpper(c)) {
        blocked(order, 'locked at upper circuit');
        return;
      }
      const px = c && c.open > 0 ? c.open : c?.af;
      if (!Number.isFinite(px) || !(px > 0)) {
        order.status = 'no price';
        return;
      }
      const amount = state.cash > 0 ? Math.min(target, state.cash / (buys.length - k)) : 0;
      if (!(amount > target * cfg.minBuyFraction)) order.status = 'no cash';
      else if (buyPosition(state, order.sym, px, amount, date, { ...order, signalDate: pending.signalDate })) order.status = 'filled';
      else order.status = 'price above slot size';
      order.fillDate = date;
    });
  }

  const all = [...pending.sells, ...pending.buys];
  const notFilled = all.filter((o) => !['pending', 'filled', 'logged'].includes(o.status));
  const blockedToday = all.filter((o) => o.status === 'pending' && o.attempts.at(-1)?.date === date);
  if (notFilled.length || blockedToday.length) {
    state.journal.push({
      date,
      kind: 'orders',
      notFilled: notFilled.map((o) => ({ sym: o.sym, side: o.code ? 'SELL' : 'BUY', status: o.status })),
      blocked: blockedToday.map((o) => ({ sym: o.sym, side: o.code ? 'SELL' : 'BUY', why: o.attempts.at(-1).why })),
    });
    notFilled.forEach((o) => {
      o.result = o.status;
      o.status = 'logged';
    });
  }
  const open = all.some((o) => o.status === 'pending');
  if (!open) state.pending = null;
}

function markToMarket(state, panel, i) {
  const date = panel.dates[i];
  const cfg = state.run.cfg;
  for (const [sym, p] of Object.entries(state.positions)) {
    const c = candleAt(panel, sym, i);
    const px = c ? c.af : NaN;
    if (Number.isFinite(px) && px > 0) {
      p.last = px;
      p.lastDate = date;
      p.stale = 0;
      p.peak = Math.max(p.peak, px);
      // Reference for split/bonus detection: only a real (not forward-filled) close.
      if (Number.isFinite(c.close) && c.close > 0) {
        p.refDate = date;
        p.refClose = c.close;
      }
    } else {
      p.stale += 1;
      if (p.stale > cfg.staleDays) {
        sellPosition(state, sym, p.last, date, {
          code: 'S1',
          reason: 'No price for more than 10 sessions (suspended or delisted)',
          note: 'sold at last known price',
        });
      }
    }
  }
}

/**
 * Advance the run through every completed session in the panel after state.lastProcessed.
 * universeFor(date) returns the symbol list used for decisions on that date.
 * Mutates and returns state.
 */
export function advance(state, panel, universeFor, { until = panel.dates.length - 1 } = {}) {
  const cfg = state.run.cfg;
  const dailyCash = (1 + cfg.cashRate) ** (1 / TRADING_DAYS);
  const dates = panel.dates;
  let i = state.lastProcessed ? dates.findIndex((d) => d > state.lastProcessed) : 0;
  if (i < 0) return state;
  if (i === 0 && state.lastProcessed && dates[0] > state.lastProcessed) {
    throw new Error(`Price data starts after ${state.lastProcessed}; cannot replay the gap`);
  }
  for (; i <= until; i += 1) {
    const date = dates[i];
    if (i > 0) {
      const prev = dates[i - 1];
      if (prev.slice(0, 7) !== date.slice(0, 7) && prev > state.lastSignalCheck && prev >= state.run.startDate) {
        makeDecision(state, panel, i - 1, universeFor(prev), 'monthly');
      }
    }
    state.cash *= dailyCash;
    if (state.pending && state.pending.signalDate < date) executePending(state, panel, i);
    markToMarket(state, panel, i);
    state.nav.push(navRow(state, panel, i));
    state.lastProcessed = date;
  }
  return state;
}

/** What the rules would do if the latest session were a signal day (nothing is recorded). */
export function previewDecision(state, panel, universe) {
  const i = panel.dates.length - 1;
  return decide(panel, i, universe, holdingSymbols(state), state.run.cfg);
}
