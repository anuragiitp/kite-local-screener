function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Live PNL using the formula Zerodha recommends for real-time monitoring:
 *   pnl = (sell_value - buy_value) + (net_quantity * last_price * multiplier)
 * The positions API `pnl` field is a snapshot and can lag; recomputing from the
 * websocket LTP keeps it moving in step with the market.
 */
export function computePositionPnl(position, lastPrice) {
  const ltp = Number.isFinite(Number(lastPrice)) && Number(lastPrice) > 0
    ? Number(lastPrice)
    : num(position.last_price);
  const multiplier = num(position.multiplier) || 1;
  return (num(position.sell_value) - num(position.buy_value))
    + (num(position.quantity) * ltp * multiplier);
}

/** Normalize a raw Kite position into a table/chart-friendly row. */
export function normalizePosition(raw) {
  const quantity = num(raw.quantity);
  const avgPrice = num(raw.average_price);
  const lastPrice = num(raw.last_price);
  const closePrice = num(raw.close_price);
  const multiplier = num(raw.multiplier) || 1;
  const pnl = computePositionPnl(raw, lastPrice);
  const investment = Math.abs(avgPrice * quantity * multiplier);
  const changePercent = avgPrice > 0
    ? ((lastPrice - avgPrice) / avgPrice) * 100 * (quantity < 0 ? -1 : 1)
    : null;
  const dayChangePercent = closePrice > 0
    ? ((lastPrice - closePrice) / closePrice) * 100
    : null;

  return {
    ...raw,
    portfolio_kind: 'position',
    tradingsymbol: raw.tradingsymbol,
    symbol: raw.tradingsymbol,
    exchange: raw.exchange,
    segment: raw.exchange,
    instrument_token: raw.instrument_token,
    product: raw.product,
    quantity,
    average_price: avgPrice,
    last_price: lastPrice,
    close_price: closePrice,
    multiplier,
    pnl,
    day_pnl: num(raw.m2m),
    investment,
    change_percent: changePercent,
    day_change_percent: dayChangePercent,
    is_open: quantity !== 0,
  };
}

/** Merge a websocket tick into a normalized position and recompute PNL. */
export function applyTickToPosition(position, tick) {
  if (!position || !tick) return position;
  const lastPrice = Number(tick.last_price);
  if (!Number.isFinite(lastPrice) || lastPrice <= 0) return position;

  const closePrice = Number.isFinite(Number(tick.close)) && Number(tick.close) > 0
    ? Number(tick.close)
    : position.close_price;
  const avgPrice = position.average_price;
  const pnl = computePositionPnl(position, lastPrice);
  const changePercent = avgPrice > 0
    ? ((lastPrice - avgPrice) / avgPrice) * 100 * (position.quantity < 0 ? -1 : 1)
    : position.change_percent;
  const dayChangePercent = closePrice > 0
    ? ((lastPrice - closePrice) / closePrice) * 100
    : position.day_change_percent;

  return {
    ...position,
    last_price: lastPrice,
    close_price: closePrice,
    pnl,
    change_percent: changePercent,
    day_change_percent: dayChangePercent,
  };
}

/** Split normalized net positions into open (qty != 0) and closed (qty == 0). */
export function splitPositions(rows) {
  const open = [];
  const closed = [];
  rows.forEach((row) => {
    if (row.is_open) open.push(row);
    else closed.push(row);
  });
  return { open, closed };
}

export function sumPnl(rows) {
  return rows.reduce((total, row) => total + num(row.pnl), 0);
}

export function sumDayPnl(rows) {
  return rows.reduce((total, row) => total + num(row.day_pnl), 0);
}

/** Effective holding size — opening qty includes pledged collateral. */
export function holdingQuantity(raw) {
  const opening = num(raw.opening_quantity);
  const qty = num(raw.quantity);
  return opening > 0 ? opening : qty;
}

/**
 * Live holding PNL: (ltp − avg) × qty.
 * Uses opening_quantity so pledged-only rows (qty 0) still show correct P&L.
 */
export function computeHoldingPnl(holding, lastPrice) {
  const ltp = Number.isFinite(Number(lastPrice)) && Number(lastPrice) > 0
    ? Number(lastPrice)
    : num(holding.last_price);
  const qty = holding.holding_quantity ?? holdingQuantity(holding);
  const avg = num(holding.average_price);
  return (ltp - avg) * qty;
}

export function computeHoldingDayPnl(holding, lastPrice) {
  const ltp = Number.isFinite(Number(lastPrice)) && Number(lastPrice) > 0
    ? Number(lastPrice)
    : num(holding.last_price);
  const close = num(holding.close_price);
  const qty = holding.holding_quantity ?? holdingQuantity(holding);
  return (ltp - close) * qty;
}

function holdingMetrics(holding, lastPrice = holding?.last_price) {
  const qty = holding.holding_quantity ?? holdingQuantity(holding);
  const avg = num(holding.average_price);
  const ltp = Number.isFinite(Number(lastPrice)) && Number(lastPrice) > 0
    ? Number(lastPrice)
    : num(holding.last_price);
  const close = num(holding.close_price);
  const invested = avg * qty;
  const currentValue = ltp * qty;
  const pnl = computeHoldingPnl({ ...holding, holding_quantity: qty }, ltp);
  const dayPnl = computeHoldingDayPnl({ ...holding, holding_quantity: qty, close_price: close }, ltp);
  const changePercent = avg > 0 ? ((ltp - avg) / avg) * 100 : null;
  const dayChangePercent = close > 0
    ? ((ltp - close) / close) * 100
    : num(holding.day_change_percentage) || null;

  return {
    invested,
    current_value: currentValue,
    pnl,
    day_pnl: dayPnl,
    change_percent: changePercent,
    day_change_percent: dayChangePercent,
    last_price: ltp,
  };
}

/** Normalize a raw Kite holding into a table/chart-friendly row. */
export function normalizeHolding(raw) {
  const holdingQty = holdingQuantity(raw);
  const avgPrice = num(raw.average_price);
  const lastPrice = num(raw.last_price);
  const closePrice = num(raw.close_price);
  const metrics = holdingMetrics(
    { ...raw, holding_quantity: holdingQty, average_price: avgPrice, close_price: closePrice },
    lastPrice,
  );

  return {
    ...raw,
    portfolio_kind: 'holding',
    tradingsymbol: raw.tradingsymbol,
    symbol: raw.tradingsymbol,
    exchange: raw.exchange,
    segment: raw.exchange,
    instrument_token: raw.instrument_token,
    product: raw.product || 'CNC',
    quantity: num(raw.quantity),
    holding_quantity: holdingQty,
    t1_quantity: num(raw.t1_quantity),
    collateral_quantity: num(raw.collateral_quantity),
    collateral_type: raw.collateral_type || '',
    average_price: avgPrice,
    close_price: closePrice,
    ...metrics,
    is_open: holdingQty > 0,
  };
}

/** Merge a websocket tick into a normalized holding and recompute PNL. */
export function applyTickToHolding(holding, tick) {
  if (!holding || !tick) return holding;
  const lastPrice = Number(tick.last_price);
  if (!Number.isFinite(lastPrice) || lastPrice <= 0) return holding;

  const closePrice = Number.isFinite(Number(tick.close)) && Number(tick.close) > 0
    ? Number(tick.close)
    : holding.close_price;
  const metrics = holdingMetrics(
    { ...holding, close_price: closePrice },
    lastPrice,
  );

  return {
    ...holding,
    close_price: closePrice,
    ...metrics,
  };
}

/** Keep holdings with any demat / opening / pledged qty. */
export function filterHoldings(rows) {
  return rows.filter((row) => (
    num(row.holding_quantity) > 0
    || num(row.opening_quantity) > 0
    || num(row.quantity) > 0
    || num(row.collateral_quantity) > 0
  ));
}
