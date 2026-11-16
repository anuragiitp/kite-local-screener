// Summary statistics for a paper run (pure).

function round(v, digits = 2) {
  if (!Number.isFinite(v)) return null;
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

function drawdown(values, dates) {
  let peak = -Infinity;
  let peakDate = null;
  let worst = 0;
  let worstPeak = null;
  let worstTrough = null;
  const series = values.map((v, k) => {
    if (v > peak) {
      peak = v;
      peakDate = dates[k];
    }
    const dd = peak > 0 ? v / peak - 1 : 0;
    if (dd < worst) {
      worst = dd;
      worstPeak = peakDate;
      worstTrough = dates[k];
    }
    return dd;
  });
  return { series, worst, worstPeak, worstTrough, current: series.at(-1) ?? 0, peakDate };
}

function fyOf(date) {
  const [y, m] = date.split('-').map(Number);
  return m >= 4 ? y + 1 : y;
}

/** Approximate capital-gains tax by financial year (no cess/surcharge; losses set off and carried forward). */
export function estimateTax(trades) {
  const years = new Map();
  for (const t of trades) {
    const fy = fyOf(t.exitDate);
    if (!years.has(fy)) years.set(fy, { fy, stGain: 0, stLoss: 0, ltGain: 0, ltLoss: 0 });
    const y = years.get(fy);
    const lt = t.days > 365;
    if (t.pnl >= 0) y[lt ? 'ltGain' : 'stGain'] += t.pnl;
    else y[lt ? 'ltLoss' : 'stLoss'] -= t.pnl;
  }
  let cfSt = 0;
  let cfLt = 0;
  return [...years.values()].sort((a, b) => a.fy - b.fy).map((y) => {
    let st = y.stGain - y.stLoss;
    let lt = y.ltGain - y.ltLoss;
    let newCfSt = 0;
    let newCfLt = 0;
    if (lt < 0) {
      newCfLt = -lt;
      lt = 0;
    }
    if (st < 0) {
      const use = Math.min(-st, lt);
      lt -= use;
      newCfSt = -st - use;
      st = 0;
    }
    let use = Math.min(cfSt, st);
    st -= use;
    cfSt -= use;
    use = Math.min(cfSt, lt);
    lt -= use;
    cfSt -= use;
    use = Math.min(cfLt, lt);
    lt -= use;
    cfLt -= use;
    cfSt += newCfSt;
    cfLt += newCfLt;
    const tax = 0.2 * st + 0.125 * Math.max(0, lt - 125000);
    return {
      fy: `FY${String(y.fy - 1).slice(-2)}-${String(y.fy).slice(-2)}`,
      stNet: round(y.stGain - y.stLoss),
      ltNet: round(y.ltGain - y.ltLoss),
      tax: round(tax),
      carryForward: round(cfSt + cfLt),
    };
  });
}

function periodReturn(rows, field) {
  const first = rows.find((r) => Number.isFinite(r[field]) && r[field] > 0);
  const last = [...rows].reverse().find((r) => Number.isFinite(r[field]) && r[field] > 0);
  return first && last ? last[field] / first[field] - 1 : null;
}

function monthlyReturns(nav) {
  const months = [];
  let prev = nav[0];
  for (let k = 0; k < nav.length; k += 1) {
    const row = nav[k];
    const next = nav[k + 1];
    if (!next || next.date.slice(0, 7) !== row.date.slice(0, 7)) {
      months.push({
        month: row.date.slice(0, 7),
        strategy: round(row.nav / prev.nav - 1, 6),
        n500: prev.n500 && row.n500 ? round(row.n500 / prev.n500 - 1, 6) : null,
        n50: prev.n50 && row.n50 ? round(row.n50 / prev.n50 - 1, 6) : null,
      });
      prev = row;
    }
  }
  return months;
}

export function summarize(state) {
  const nav = state.nav;
  const capital = state.run.capital;
  const last = nav.at(-1) || { nav: capital, cash: capital, invested: 0, date: state.run.startDate };
  const dates = nav.map((r) => r.date);
  const dd = drawdown(nav.map((r) => r.nav), dates);
  const ddN500 = drawdown(nav.map((r) => r.n500), dates);
  const ddN50 = drawdown(nav.map((r) => r.n50 ?? NaN), dates);
  const days = nav.length ? (Date.parse(last.date) - Date.parse(nav[0].date)) / 86400000 : 0;
  const totalReturn = last.nav / capital - 1;
  const years = days / 365.25;

  const positions = Object.entries(state.positions).map(([sym, p]) => ({
    sym,
    ...p,
    value: p.qty * p.last,
    pnl: p.qty * p.last - p.basis,
    ret: (p.qty * p.last) / p.basis - 1,
    weight: last.nav ? (p.qty * p.last) / last.nav : 0,
    days: Math.round((Date.parse(last.date) - Date.parse(p.entryDate)) / 86400000),
  })).sort((a, b) => b.value - a.value);

  const trades = state.trades;
  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl <= 0);
  const avg = (arr, f) => (arr.length ? arr.reduce((s, x) => s + f(x), 0) / arr.length : null);
  const holdDays = trades.map((t) => t.days).sort((a, b) => a - b);
  const realized = trades.reduce((s, t) => s + t.pnl, 0);
  const unrealized = positions.reduce((s, p) => s + p.pnl, 0);
  const charges = state.fills.reduce((s, f) => s + (f.charges || 0), 0);
  const traded = state.fills.reduce((s, f) => s + (f.value || 0), 0);
  const avgNav = avg(nav, (r) => r.nav) || capital;
  const byReason = {};
  trades.forEach((t) => {
    byReason[t.code] = (byReason[t.code] || 0) + 1;
  });

  return {
    asOf: last.date,
    sessions: Math.max(0, nav.length - 1),
    days,
    capital,
    nav: last.nav,
    cash: last.cash,
    invested: last.invested,
    investedPct: last.nav ? last.invested / last.nav : 0,
    totalReturn,
    cagr: years >= 1 ? (last.nav / capital) ** (1 / years) - 1 : null,
    n500Return: periodReturn(nav, 'n500'),
    n50Return: periodReturn(nav, 'n50'),
    drawdown: dd,
    n500Drawdown: ddN500,
    n50Drawdown: ddN50,
    realized,
    unrealized,
    interest: last.nav - capital - realized - unrealized,
    charges,
    turnover: years > 0 ? traded / 2 / avgNav / Math.max(years, 1 / 12) : null,
    positions,
    trades: {
      closed: trades.length,
      open: positions.length,
      wins: wins.length,
      winRate: trades.length ? wins.length / trades.length : null,
      avgWin: avg(wins, (t) => t.ret),
      avgLoss: avg(losses, (t) => t.ret),
      best: trades.length ? trades.reduce((a, b) => (b.ret > a.ret ? b : a)) : null,
      worst: trades.length ? trades.reduce((a, b) => (b.ret < a.ret ? b : a)) : null,
      medianHold: holdDays.length ? holdDays[holdDays.length >> 1] : null,
      byReason,
    },
    monthly: monthlyReturns(nav),
    tax: estimateTax(trades),
  };
}

