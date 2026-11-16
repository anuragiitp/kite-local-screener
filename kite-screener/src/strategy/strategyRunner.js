// Orchestrates a daily refresh: Nifty 500 list -> candles -> panel -> ledger catch-up -> preview.

import { createRun, advance, previewDecision } from './paperLedger';
import {
  NIFTY50_TOKEN,
  NIFTY500_TOKEN,
  buildPanel,
  fetchTodayCandles,
  isCurrent,
  isMarketHours,
  istToday,
  loadNifty500,
  resolveTokens,
  updateCandles,
} from './strategyData';

const MIN_COVERAGE = 0.95;

function requiredSymbols(state) {
  if (!state) return [];
  const out = new Set(Object.keys(state.positions));
  if (state.pending) [...state.pending.sells, ...state.pending.buys].forEach((o) => out.add(o.sym));
  return [...out];
}

function applyAdjustments(state, panel, today) {
  for (const [sym, p] of Object.entries(state.positions)) {
    const series = panel.series[sym];
    const refDate = p.refDate || p.lastDate;
    const refClose = p.refDate ? p.refClose : p.last;
    const k = panel.dates.indexOf(refDate);
    if (!series || k < 0) continue;
    const px = Number(series.close[k]);
    if (!(px > 0) || !(refClose > 0)) continue;
    const f = px / refClose;
    if (Math.abs(f - 1) <= 0.005) continue;
    p.qty = Math.round((p.qty / f) * 1e6) / 1e6;
    p.entryPrice *= f;
    p.peak *= f;
    p.last *= f;
    if (p.refDate) p.refClose = px;
    state.journal.push({
      date: today,
      kind: 'adjustment',
      sym,
      factor: f,
      text: `${sym}: Kite re-based its price history by ${f.toFixed(4)} (split/bonus). Quantity and prices rescaled; value unchanged.`,
    });
  }
}

/**
 * Load everything for a run (state may be null when starting a new run).
 * onProgress({ stage, done, total }).
 */
export async function loadStrategyContext(state, { onProgress, signal, forceList = false } = {}) {
  const warnings = [];
  onProgress?.({ stage: 'Loading Nifty 500 list' });
  const universe = await loadNifty500({ force: forceList });
  if (universe.warning) warnings.push(universe.warning);

  onProgress?.({ stage: 'Loading index prices' });
  const indexItems = [
    { key: `idx:${NIFTY500_TOKEN}`, sym: 'NIFTY 500', token: NIFTY500_TOKEN },
    { key: `idx:${NIFTY50_TOKEN}`, sym: 'NIFTY 50', token: NIFTY50_TOKEN },
  ];
  const indexResult = await updateCandles(indexItems, { always: true, signal });
  if (indexResult.errors.length) {
    const n500err = indexResult.errors.find((e) => e.sym === 'NIFTY 500');
    if (n500err) throw new Error(`Could not load NIFTY 500 prices: ${n500err.error}. Is the Kite session active?`);
    warnings.push('NIFTY 50 prices could not be refreshed.');
  }
  const indexRec = indexResult.records.get(indexItems[0].key);
  const n50Rec = indexResult.records.get(indexItems[1].key);
  if (!indexRec?.candles?.d?.length) throw new Error('No NIFTY 500 price history available');
  const targetDay = indexRec.lastDate;

  const symbols = [...new Set([...universe.symbols, ...requiredSymbols(state)])];
  onProgress?.({ stage: 'Resolving instruments' });
  const { tokens, missing } = await resolveTokens(symbols);
  if (missing.length) warnings.push(`No Kite instrument for: ${missing.join(', ')}`);

  const items = symbols.filter((s) => tokens[s]).map((sym) => ({ key: `eq:${sym}`, sym, token: tokens[sym] }));
  const result = await updateCandles(items, {
    targetDay,
    signal,
    onProgress: (p) => onProgress?.({ stage: 'Downloading daily prices', ...p }),
  });
  if (result.errors.length) {
    warnings.push(`Price download failed for ${result.errors.length} stock(s): ${result.errors.slice(0, 8).map((e) => e.sym).join(', ')}${result.errors.length > 8 ? '…' : ''}`);
  }
  const records = [...result.records.values()].filter((r) => r.candles?.d?.length);
  const panel = buildPanel(indexRec, n50Rec, records);
  if (state) applyAdjustments(state, panel, targetDay);
  const recordBySym = new Map(records.map((r) => [r.sym, r]));
  const coverageOn = (day) => {
    const ok = universe.symbols.filter((s) => {
      const rec = recordBySym.get(s);
      return rec && (rec.lastDate >= day || rec.checkedFor >= day);
    }).length;
    return ok / universe.symbols.length;
  };

  // Never replay past the last day for which every holding has fresh data.
  // Exception: a symbol Kite no longer lists (delisted/renamed) is replayed as "no price",
  // so the stale-price exit can sell it instead of freezing the run forever.
  const missingSet = new Set(missing);
  const instrumentsHealthy = missing.length <= Math.max(5, symbols.length * 0.05);
  let until = panel.dates.length - 1;
  const stuck = [];
  const gone = [];
  for (const sym of requiredSymbols(state)) {
    const rec = recordBySym.get(sym);
    if (isCurrent(rec, targetDay)) continue;
    if (!rec && missingSet.has(sym) && instrumentsHealthy) {
      gone.push(sym);
      continue;
    }
    stuck.push(sym);
    const last = rec ? (rec.checkedFor > rec.lastDate ? rec.checkedFor : rec.lastDate) : '';
    let k = panel.dates.length - 1;
    while (k >= 0 && panel.dates[k] > last) k -= 1;
    until = Math.min(until, k);
  }
  if (stuck.length) warnings.push(`Waiting for prices of ${stuck.join(', ')} — the run is held at ${panel.dates[until] || 'start'}.`);
  if (gone.length) warnings.push(`${gone.join(', ')} no longer listed on Kite (renamed or delisted?) — valued at the last price and sold at it after ${state.run.cfg.staleDays} sessions without a price.`);

  // Do not take a monthly decision with an incomplete universe.
  if (state) {
    for (let i = panel.dates.findIndex((d) => d > state.lastProcessed); i > 0 && i <= until; i += 1) {
      const prev = panel.dates[i - 1];
      if (prev.slice(0, 7) !== panel.dates[i].slice(0, 7) && prev > state.lastSignalCheck && prev >= state.run.startDate) {
        const cov = coverageOn(prev);
        if (cov < MIN_COVERAGE) {
          until = i - 1;
          warnings.push(`Only ${(cov * 100).toFixed(0)}% of Nifty 500 prices are available for the ${prev} signal — refresh again to complete it.`);
          break;
        }
      }
    }
  }

  return {
    universe,
    panel,
    tokens,
    until,
    coverage: coverageOn(targetDay),
    warnings,
    fetched: result.fetched,
  };
}

/** Start a new run: decide the first portfolio on the latest completed session. */
export async function startStrategyRun({ capital, onProgress, signal }) {
  const ctx = await loadStrategyContext(null, { onProgress, signal });
  if (ctx.coverage < MIN_COVERAGE) {
    throw new Error(`Only ${(ctx.coverage * 100).toFixed(0)}% of Nifty 500 prices loaded — try again.`);
  }
  const state = createRun({
    panel: ctx.panel,
    startIndex: ctx.panel.dates.length - 1,
    universe: ctx.universe.symbols,
    capital,
  });
  return { ...ctx, state, preview: previewDecision(state, ctx.panel, ctx.universe.symbols) };
}

function monthlyDecisionDue(state, lastDate, today) {
  return lastDate.slice(0, 7) !== today.slice(0, 7) && lastDate > state.lastSignalCheck && lastDate >= state.run.startDate;
}

function extendPanel(panel, day, bench, n50, today) {
  const n = panel.dates.length;
  const grow = (arr, v) => {
    const out = new Float64Array(n + 1);
    out.set(arr);
    out[n] = v;
    return out;
  };
  const series = {};
  for (const [sym, s] of Object.entries(panel.series)) {
    const c = today.get(sym);
    series[sym] = {
      close: grow(s.close, c ? c.c : NaN),
      open: grow(s.open, c ? c.o : NaN),
      high: grow(s.high, c ? c.h : NaN),
      low: grow(s.low, c ? c.l : NaN),
      tval: grow(s.tval, c ? c.c * c.v : NaN),
    };
  }
  return {
    dates: [...panel.dates, day],
    bench: grow(panel.bench, bench),
    nifty50: grow(panel.nifty50, n50),
    series,
  };
}

/**
 * Provisional same-day view: during market hours, replay today on a copy of the run using
 * today's in-progress candle, so open orders show as filled at today's official open.
 * Nothing is saved; the ledger records the day only after the 4 pm close.
 * Returns null when there is nothing to fill today.
 */
export async function projectToday(state, ctx, { signal } = {}) {
  if (!state || !ctx?.panel || !isMarketHours()) return null;
  const day = istToday();
  const lastDate = ctx.panel.dates.at(-1);
  if (!lastDate || lastDate >= day || state.lastProcessed !== lastDate) return null;
  const decisionDue = monthlyDecisionDue(state, lastDate, day);
  if (!state.pending && !decisionDue) return null;
  if (decisionDue && !(ctx.coverage >= MIN_COVERAGE)) return null;

  // Index first: no candle means a holiday or the market has not opened yet.
  const index = await fetchTodayCandles([
    { sym: 'NIFTY 500', token: NIFTY500_TOKEN },
    { sym: 'NIFTY 50', token: NIFTY50_TOKEN },
  ], { signal });
  const bench = index.candles.get('NIFTY 500');
  if (index.day !== day || !bench) return null;

  const syms = new Set(requiredSymbols(state));
  if (decisionDue && ctx.preview) [...ctx.preview.sells, ...ctx.preview.buys].forEach((o) => syms.add(o.sym));
  const tokens = ctx.tokens || {};
  const items = [...syms].filter((s) => tokens[s]).map((sym) => ({ sym, token: tokens[sym] }));
  const live = await fetchTodayCandles(items, { signal });
  if (live.day !== day) return null;

  // A split/bonus ex-date: Kite has re-based history, the cached panel has not yet.
  // Bring today's candle onto the panel's price basis so quantities and values stay consistent.
  const lastIdx = ctx.panel.dates.length - 1;
  const rebased = [];
  for (const [sym, c] of live.candles) {
    const prev = ctx.panel.series[sym]?.close[lastIdx];
    if (c.prevDate !== lastDate || !(prev > 0) || !(c.prevClose > 0)) continue;
    const f = prev / c.prevClose;
    if (Math.abs(f - 1) <= 0.005) continue;
    live.candles.set(sym, { ...c, o: c.o * f, h: c.h * f, l: c.l * f, c: c.c * f, v: c.v / f });
    rebased.push(sym);
  }

  const panel = extendPanel(ctx.panel, day, bench.c, index.candles.get('NIFTY 50')?.c ?? NaN, live.candles);
  const copy = structuredClone(state);
  advance(copy, panel, () => ctx.universe.symbols);

  const missing = [...syms].filter((s) => !live.candles.has(s));
  const missingSet = new Set(missing);
  const orders = [];
  copy.fills.slice(state.fills.length).forEach((f) => orders.push({ ...f, status: 'filled' }));
  const report = copy.journal.slice(state.journal.length).find((j) => j.kind === 'orders' && j.date === day);
  (report?.notFilled || []).forEach((o) => orders.push({ sym: o.sym, side: o.side, status: `not filled: ${o.status}` }));
  (report?.blocked || []).forEach((o) => orders.push({
    sym: o.sym,
    side: o.side,
    status: missingSet.has(o.sym) ? 'no price loaded yet — checked again at the next refresh' : `blocked so far: ${o.why} — retries next open`,
  }));

  return {
    day,
    asOf: new Date().toISOString(),
    state: copy,
    orders,
    nav: copy.nav.at(-1),
    prevNav: state.nav.at(-1),
    missing,
    rebased,
  };
}

/** Catch the run up to the latest completed session. Mutates and returns state. */
export async function refreshStrategyRun(state, { onProgress, signal, forceList } = {}) {
  const ctx = await loadStrategyContext(state, { onProgress, signal, forceList });
  onProgress?.({ stage: 'Updating paper ledger' });
  advance(state, ctx.panel, () => ctx.universe.symbols, { until: ctx.until });
  return { ...ctx, state, preview: previewDecision(state, ctx.panel, ctx.universe.symbols) };
}
