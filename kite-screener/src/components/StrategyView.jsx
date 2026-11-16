import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import StrategyNavChart from './StrategyNavChart';
import { hasSession } from '../screener/kiteApi';
import { SUMMIT_20, BUY_CHECKS, expectedSignalDay } from '../strategy/summitMomentum';
import { projectToday, refreshStrategyRun, startStrategyRun } from '../strategy/strategyRunner';
import { summarize } from '../strategy/strategyStats';
import { isFinalSession, isMarketHours, istToday, isWeekday } from '../strategy/strategyData';
import {
  commitImport,
  exportRunFile,
  lastBackup,
  loadRun,
  loadUndo,
  parseRunExport,
  resetRun,
  restoreUndo,
  saveRun,
} from '../strategy/strategyStore';

const CODE = SUMMIT_20.code;
const TABS = ['Overview', 'Today', 'Portfolio', 'In / Out', 'Trades', 'Rankings', 'Journal'];
const BACKTEST = {
  cagr: 0.219,
  worst: -0.42,
  monthlyCagr: 0.22,
  monthlyWorst: -0.39,
  tradesPerYear: 29,
  medianHold: 153,
};
const BACKUP_REMINDER_DAYS = 7;

const inr = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const inr2 = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function fmtInr(v) {
  return Number.isFinite(v) ? `₹${inr.format(v)}` : '—';
}

function fmtPx(v) {
  return Number.isFinite(v) ? inr2.format(v) : '—';
}

function fmtPct(v, digits = 2, signed = true) {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  const s = (v * 100).toFixed(digits);
  return `${signed && v > 0 ? '+' : ''}${s}%`;
}

function tone(v) {
  if (!Number.isFinite(v) || v === 0) return '';
  return v > 0 ? 'pos-up' : 'pos-down';
}

function fmtDate(d) {
  if (!d) return '—';
  const [y, m, day] = d.split('-').map(Number);
  return new Date(y, m - 1, day).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' });
}

function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
}

/** Provisional same-day fills; never throws (the saved ledger does not depend on it). */
async function safeProject(state, ctx, signal) {
  try {
    return { live: await projectToday(state, ctx, { signal }), warning: '' };
  } catch (e) {
    if (e?.name === 'AbortError') throw e;
    return { live: null, warning: `Could not load today's prices for provisional fills: ${e?.message || e}` };
  }
}

function nextSignalDay(lastDate) {
  const day = lastDate || istToday();
  const exp = expectedSignalDay(day);
  if (exp > day) return exp;
  const [y, m] = day.split('-').map(Number);
  const next = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
  return expectedSignalDay(next);
}

function Card({ label, value, sub, className = '' }) {
  return (
    <div className="positions-summary-item">
      <span className="positions-summary-label">{label}</span>
      <span className={`positions-summary-value ${className}`}>{value}</span>
      {sub && <span className="strategy-card-sub">{sub}</span>}
    </div>
  );
}

function Section({ title, right, children }) {
  return (
    <div className="positions-section">
      <div className="positions-section-head">
        <h3>{title}</h3>
        {right && <span className="strategy-section-right">{right}</span>}
      </div>
      {children}
    </div>
  );
}

function Table({ columns, rows, empty = 'Nothing yet.', footer = [] }) {
  if (!rows.length) return <div className="strategy-empty-row">{empty}</div>;
  return (
    <div className="positions-table-wrap">
      <table className="positions-table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={c.left ? 'align-left' : ''}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, k) => (
            <tr key={row.key ?? k}>
              {columns.map((c) => (
                <td key={c.key} className={`${c.left ? 'align-left' : ''} ${c.tone ? tone(c.tone(row)) : ''}`}>
                  {c.render ? c.render(row) : row[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {footer.length > 0 && (
          <tfoot>
            {footer.map((f) => (
              <tr key={f.key}>
                {columns.map((c) => (
                  <td key={c.key} className={`${c.left ? 'align-left' : ''} ${f.tones?.[c.key] !== undefined ? tone(f.tones[c.key]) : ''}`}>
                    {f.cells[c.key] ?? ''}
                  </td>
                ))}
              </tr>
            ))}
          </tfoot>
        )}
      </table>
    </div>
  );
}

function OverviewTab({ summary, state }) {
  const s = summary;
  const t = s.trades;
  return (
    <>
      <Section title="Value vs Nifty (rebased to 100)" right={`${s.sessions} session(s) since ${fmtDate(state.run.startDate)}`}>
        <StrategyNavChart nav={state.nav} drawdown={s.drawdown.series} />
      </Section>

      <div className="strategy-grid-2">
        <Section title="Profit & loss">
          <Table
            columns={[
              { key: 'label', label: 'Item', left: true },
              { key: 'value', label: 'Amount', render: (r) => fmtInr(r.value), tone: (r) => r.value },
            ]}
            rows={[
              { label: 'Booked (closed trades, after charges)', value: s.realized },
              { label: 'Open (holdings, before sell charges)', value: s.unrealized },
              { label: 'Interest on idle cash (6%/yr assumed)', value: s.interest },
              { label: 'Total', value: s.nav - s.capital },
              { label: 'Charges paid (0.25% per side, inside the above)', value: -s.charges },
            ]}
          />
        </Section>

        <Section title="Trade statistics">
          <Table
            columns={[
              { key: 'label', label: 'Measure', left: true },
              { key: 'value', label: 'Value' },
            ]}
            rows={[
              { label: 'Closed trades / open positions', value: `${t.closed} / ${t.open}` },
              { label: 'Win rate', value: fmtPct(t.winRate, 0, false) },
              { label: 'Average win / average loss', value: `${fmtPct(t.avgWin, 1)} / ${fmtPct(t.avgLoss, 1)}` },
              { label: 'Best trade', value: t.best ? `${t.best.sym} ${fmtPct(t.best.ret, 1)}` : '—' },
              { label: 'Worst trade', value: t.worst ? `${t.worst.sym} ${fmtPct(t.worst.ret, 1)}` : '—' },
              { label: 'Median holding (days)', value: t.medianHold ?? '—' },
              { label: 'Exits by rule', value: Object.entries(t.byReason).map(([k, v]) => `${k}: ${v}`).join(', ') || '—' },
              { label: 'Turnover (per year, one side)', value: s.turnover === null ? '—' : `${s.turnover.toFixed(1)}×` },
            ]}
          />
        </Section>
      </div>

      <div className="strategy-grid-2">
        <Section title="Paper run vs backtest">
          <Table
            columns={[
              { key: 'label', label: 'Measure', left: true },
              { key: 'paper', label: 'Paper run' },
              { key: 'bt', label: 'Backtest (2005–2026)' },
            ]}
            rows={[
              { label: 'Yearly return (CAGR)', paper: s.cagr === null ? `${fmtPct(s.totalReturn)} so far` : fmtPct(s.cagr), bt: `${fmtPct(BACKTEST.cagr, 1)} (monthly: ${fmtPct(BACKTEST.monthlyCagr, 1)})` },
              { label: 'Worst fall', paper: fmtPct(s.drawdown.worst), bt: `${fmtPct(BACKTEST.worst, 0)} (monthly: ${fmtPct(BACKTEST.monthlyWorst, 0)})` },
              { label: 'Trades per year', paper: s.days > 60 ? ((t.closed + t.open) / (s.days / 365.25)).toFixed(0) : '—', bt: BACKTEST.tradesPerYear },
              { label: 'Median holding (days)', paper: t.medianHold ?? '—', bt: BACKTEST.medianHold },
              { label: 'Nifty 500 worst fall (same period)', paper: fmtPct(s.n500Drawdown.worst), bt: '' },
            ]}
          />
        </Section>

        <Section title="Estimated tax (not deducted)" right="20% STCG · 12.5% LTCG above ₹1.25L · no cess">
          <Table
            columns={[
              { key: 'fy', label: 'Year', left: true },
              { key: 'stNet', label: 'Short-term net', render: (r) => fmtInr(r.stNet), tone: (r) => r.stNet },
              { key: 'ltNet', label: 'Long-term net', render: (r) => fmtInr(r.ltNet), tone: (r) => r.ltNet },
              { key: 'tax', label: 'Tax', render: (r) => fmtInr(r.tax) },
              { key: 'carryForward', label: 'Loss carried', render: (r) => fmtInr(r.carryForward) },
            ]}
            rows={s.tax}
            empty="No closed trades yet."
          />
        </Section>
      </div>

      <Section title="Monthly returns">
        <Table
          columns={[
            { key: 'month', label: 'Month', left: true },
            { key: 'strategy', label: 'SUMMIT-20', render: (r) => fmtPct(r.strategy), tone: (r) => r.strategy },
            { key: 'n500', label: 'Nifty 500', render: (r) => fmtPct(r.n500), tone: (r) => r.n500 },
            { key: 'n50', label: 'Nifty 50', render: (r) => fmtPct(r.n50), tone: (r) => r.n50 },
            { key: 'diff', label: 'vs Nifty 500', render: (r) => fmtPct(r.n500 === null ? null : r.strategy - r.n500), tone: (r) => r.strategy - (r.n500 ?? r.strategy) },
          ]}
          rows={[...s.monthly].reverse()}
        />
      </Section>
    </>
  );
}

function OrdersTable({ orders, side }) {
  return (
    <Table
      columns={[
        { key: 'sym', label: 'Stock', left: true },
        side === 'SELL'
          ? { key: 'code', label: 'Rule', left: true, render: (o) => <span title={o.reason}>{o.code}</span> }
          : { key: 'rank', label: 'Rank' },
        { key: 'signalClose', label: 'Signal close', render: (o) => fmtPx(o.signalClose) },
        { key: 'status', label: 'Status', left: true, render: (o) => (o.attempts?.length ? `${o.status} · blocked ${o.attempts.length}× (${o.attempts.at(-1).why})` : o.status) },
      ]}
      rows={orders.map((o) => ({ ...o, key: o.sym }))}
      empty={side === 'SELL' ? 'No sells.' : 'No buys.'}
    />
  );
}

function LiveFills({ live }) {
  return (
    <Section
      title={`Today's paper fills · ${fmtDate(live.day)} (provisional)`}
      right={`as of ${fmtTime(live.asOf)} IST · saved to the ledger after the 4 pm close`}
    >
      <div className="strategy-note">
        Prices are today&apos;s official open. A &quot;blocked so far&quot; order is re-checked on the full-day candle after the close; if it fills then, the cash and buy quantities can still change slightly.
        {live.missing.length > 0 && ` No price yet for ${live.missing.join(', ')}.`}
        {live.rebased?.length > 0 && ` Split/bonus today for ${live.rebased.join(', ')} — shown on the old price basis until the close.`}
      </div>
      <Table
        columns={[
          { key: 'side', label: 'Side', left: true, render: (o) => <span className={o.side === 'BUY' ? 'pos-up' : 'pos-down'}>{o.side}</span> },
          { key: 'sym', label: 'Stock', left: true },
          { key: 'qty', label: 'Qty', render: (o) => o.qty ?? '—' },
          { key: 'price', label: 'Price (open)', render: (o) => fmtPx(o.price) },
          { key: 'value', label: 'Value', render: (o) => fmtInr(o.value) },
          { key: 'pnl', label: 'P&L', render: (o) => (o.side === 'SELL' ? fmtInr(o.pnl) : ''), tone: (o) => (o.side === 'SELL' ? o.pnl : 0) },
          { key: 'status', label: 'Status', left: true, render: (o) => (o.status === 'filled' ? 'filled (provisional)' : o.status) },
        ]}
        rows={live.orders.map((o) => ({ ...o, key: `${o.side}-${o.sym}` }))}
        empty="No order could be filled today."
      />
    </Section>
  );
}

function TodayTab({ state, ctx, live }) {
  const preview = ctx?.preview;
  const latest = ctx?.panel?.dates.at(-1);
  const isSignalDay = latest && expectedSignalDay(latest) === latest;
  const pending = state.pending;
  return (
    <>
      {live ? <LiveFills live={live} /> : (
      <Section
        title={pending ? `Orders from ${fmtDate(pending.signalDate)} signal — fill at the next session's official open` : 'Open orders'}
        right={pending ? (pending.kind === 'initial' ? 'First portfolio' : 'Monthly rebalance') : ''}
      >
        {pending ? (
          <div className="strategy-grid-2 strategy-grid-flat">
            <OrdersTable orders={pending.sells} side="SELL" />
            <OrdersTable orders={pending.buys} side="BUY" />
          </div>
        ) : (
          <div className="strategy-empty-row">No open orders. The next orders are made on the signal day ({fmtDate(nextSignalDay(state.lastProcessed))}, last trading day of the month).</div>
        )}
      </Section>
      )}

      {preview && (
        <Section
          title={`${isSignalDay ? 'Signal day check' : 'Preview'}: what the rules say on ${fmtDate(preview.date)} close`}
          right={isSignalDay ? 'Likely the last trading day — becomes orders when the next session starts' : 'Provisional — only the month-end close counts'}
        >
          <div className="strategy-note">
            Market check: Nifty 500 {fmtPx(preview.market.level)} vs 200-day average {fmtPx(preview.market.ma)} →{' '}
            <b className={preview.market.riskOff ? 'pos-down' : 'pos-up'}>{preview.market.riskOff ? 'below: no new buys' : 'above: buys allowed'}</b>
            {' · '}Eligible {preview.eligibleCount} of {preview.universeCount} · free slots {preview.freeSlots}
          </div>
          <div className="strategy-grid-2 strategy-grid-flat">
            <Table
              columns={[
                { key: 'sym', label: 'Would sell', left: true },
                { key: 'code', label: 'Rule', left: true },
                { key: 'reason', label: 'Why', left: true },
              ]}
              rows={preview.sells.map((s) => ({ ...s, key: s.sym }))}
              empty="No holding breaks a sell rule."
            />
            <Table
              columns={[
                { key: 'sym', label: 'Would buy', left: true },
                { key: 'rank', label: 'Rank' },
                { key: 'close', label: 'Close', render: (b) => fmtPx(b.close) },
              ]}
              rows={preview.buys.map((b) => ({ ...b, key: b.sym }))}
              empty={preview.market.riskOff ? 'Market check is negative: no buys.' : 'No free slot or no qualifying stock.'}
            />
          </div>
        </Section>
      )}

      {ctx && (
        <Section title="Data status">
          <div className="strategy-note">
            Latest completed session {fmtDate(latest)} · ledger processed to {fmtDate(state.lastProcessed)} · Nifty 500 list {ctx.universe.symbols.length} stocks
            ({ctx.universe.day}{ctx.universe.stale ? ', saved copy' : ''}) · prices current for {fmtPct(ctx.coverage, 0, false)} · downloaded {ctx.fetched} instrument(s) this refresh.
          </div>
        </Section>
      )}
    </>
  );
}

function openTotal(s) {
  const value = s.positions.reduce((t, p) => t + p.value, 0);
  const basis = s.positions.reduce((t, p) => t + p.basis, 0);
  return {
    key: 'holdings',
    cells: {
      sym: `Holdings (${s.positions.length})`,
      value: fmtInr(value),
      weight: fmtPct(s.investedPct, 1, false),
      pnl: fmtInr(s.unrealized),
      ret: fmtPct(basis ? s.unrealized / basis : null, 1),
      status: 'open P&L, before sell charges',
    },
    tones: { pnl: s.unrealized, ret: s.unrealized },
  };
}

function portfolioFooter(s) {
  const total = s.nav - s.capital;
  return [
    openTotal(s),
    { key: 'cash', cells: { sym: 'Cash', value: fmtInr(s.cash), weight: fmtPct(s.nav ? s.cash / s.nav : null, 1, false) } },
    {
      key: 'total',
      cells: {
        sym: 'Portfolio',
        value: fmtInr(s.nav),
        weight: fmtPct(1, 0, false),
        pnl: fmtInr(total),
        ret: fmtPct(s.nav / s.capital - 1, 1),
        status: `since start: booked ${fmtInr(s.realized)} + open ${fmtInr(s.unrealized)} + interest ${fmtInr(s.interest)}`,
      },
      tones: { pnl: total, ret: total },
    },
  ];
}

function PortfolioTab({ summary, ctx, liveDay }) {
  const info = ctx?.preview?.info;
  const sells = new Map((ctx?.preview?.sells || []).map((s) => [s.sym, s]));
  return (
    <Section
      title={`Holdings (${summary.positions.length} of 20)${liveDay ? ' · includes today\'s provisional fills' : ''}`}
      right={`Cash ${fmtInr(summary.cash)} · invested ${fmtPct(summary.investedPct, 1, false)}`}
    >
      <Table
        columns={[
          { key: 'sym', label: 'Stock', left: true },
          { key: 'qty', label: 'Qty', render: (p) => (Number.isInteger(p.qty) ? p.qty : p.qty.toFixed(3)) },
          { key: 'entryDate', label: 'Bought', render: (p) => (p.entryDate === liveDay ? `${fmtDate(p.entryDate)} (provisional)` : fmtDate(p.entryDate)) },
          { key: 'entryPrice', label: 'Buy price', render: (p) => fmtPx(p.entryPrice) },
          { key: 'last', label: liveDay ? 'Last price' : 'Last close', render: (p) => fmtPx(p.last) },
          { key: 'value', label: 'Value', render: (p) => fmtInr(p.value) },
          { key: 'weight', label: 'Weight', render: (p) => fmtPct(p.weight, 1, false) },
          { key: 'pnl', label: 'P&L', render: (p) => fmtInr(p.pnl), tone: (p) => p.pnl },
          { key: 'ret', label: 'P&L %', render: (p) => fmtPct(p.ret, 1), tone: (p) => p.ret },
          { key: 'days', label: 'Days' },
          { key: 'rank', label: 'Rank now', render: (p) => info?.get(p.sym)?.rank ?? '—' },
          {
            key: 'status',
            label: 'Rule status',
            left: true,
            render: (p) => {
              if (p.entryDate === liveDay) return 'bought today (provisional)';
              const s = sells.get(p.sym);
              if (s) return <span className="pos-down" title={s.reason}>would sell ({s.code})</span>;
              const hold = ctx?.preview?.holds.find((h) => h.sym === p.sym);
              return hold ? hold.reason : '—';
            },
          },
        ]}
        rows={summary.positions.map((p) => ({ ...p, key: p.sym }))}
        footer={portfolioFooter(summary)}
        empty="No holdings yet. The first portfolio is bought at the open after the start day."
      />
    </Section>
  );
}

function InOutTab({ state, liveDay }) {
  const groups = useMemo(() => {
    const map = new Map();
    state.fills.forEach((f) => {
      if (!map.has(f.date)) map.set(f.date, []);
      map.get(f.date).push(f);
    });
    return [...map.entries()].reverse();
  }, [state.fills]);
  if (!groups.length) return <div className="positions-empty">No trades yet. Orders fill at the official open of the session after a signal.</div>;
  return groups.map(([date, fills]) => {
    const sells = fills.filter((f) => f.side === 'SELL');
    const buys = fills.filter((f) => f.side === 'BUY');
    return (
      <Section key={date} title={`${fmtDate(date)} — ${sells.length} out, ${buys.length} in${date === liveDay ? ' (provisional, saved after the 4 pm close)' : ''}`} right={fills[0].signalDate ? `signal ${fmtDate(fills[0].signalDate)}` : 'forced exit'}>
        <div className="strategy-grid-2 strategy-grid-flat">
          <Table
            columns={[
              { key: 'sym', label: 'Out', left: true },
              { key: 'qty', label: 'Qty', render: (f) => (Number.isInteger(f.qty) ? f.qty : f.qty.toFixed(3)) },
              { key: 'price', label: 'Open price', render: (f) => fmtPx(f.price) },
              { key: 'pnl', label: 'P&L', render: (f) => fmtInr(f.pnl), tone: (f) => f.pnl },
              { key: 'code', label: 'Rule', left: true, render: (f) => <span title={f.reason}>{f.code}{f.note ? ` · ${f.note}` : ''}</span> },
            ]}
            rows={sells.map((f) => ({ ...f, key: f.sym }))}
            empty="Nothing sold."
          />
          <Table
            columns={[
              { key: 'sym', label: 'In', left: true },
              { key: 'qty', label: 'Qty', render: (f) => (Number.isInteger(f.qty) ? f.qty : f.qty.toFixed(3)) },
              { key: 'price', label: 'Open price', render: (f) => fmtPx(f.price) },
              { key: 'value', label: 'Value', render: (f) => fmtInr(f.value) },
              { key: 'rank', label: 'Rank', render: (f) => `${f.rank ?? '—'}${f.note ? ` · ${f.note}` : ''}` },
            ]}
            rows={buys.map((f) => ({ ...f, key: f.sym }))}
            empty="Nothing bought."
          />
        </div>
      </Section>
    );
  });
}

function TradesTab({ state, summary, liveDay }) {
  const rows = [...state.trades].reverse().map((t, k) => ({ ...t, key: `${t.sym}-${t.exitDate}-${k}` }));
  const open = [...summary.positions].sort((a, b) => (a.entryDate < b.entryDate ? 1 : -1)).map((p) => ({ ...p, key: p.sym }));
  return (
    <>
    <Section
      title={`Open trades (${open.length})${liveDay ? ' · live, provisional' : ''}`}
      right={<>Running P&amp;L <span className={tone(summary.unrealized)}>{fmtInr(summary.unrealized)}</span> (before sell charges)</>}
    >
      <Table
        columns={[
          { key: 'sym', label: 'Stock', left: true },
          { key: 'entryDate', label: 'Bought', render: (p) => (p.entryDate === liveDay ? `${fmtDate(p.entryDate)} (provisional)` : fmtDate(p.entryDate)) },
          { key: 'entryPrice', label: 'Buy', render: (p) => fmtPx(p.entryPrice) },
          { key: 'last', label: liveDay ? 'Last price' : 'Last close', render: (p) => fmtPx(p.last) },
          { key: 'days', label: 'Days' },
          { key: 'pnl', label: 'P&L', render: (p) => fmtInr(p.pnl), tone: (p) => p.pnl },
          { key: 'ret', label: 'Return', render: (p) => fmtPct(p.ret, 1), tone: (p) => p.ret },
        ]}
        rows={open}
        footer={open.length ? [openTotal(summary)] : []}
        empty="No open trades."
      />
    </Section>
    <Section
      title={`Closed trades (${rows.length})`}
      right={<>Booked P&amp;L <span className={tone(summary.realized)}>{fmtInr(summary.realized)}</span> (after charges)</>}
    >
      <Table
        columns={[
          { key: 'sym', label: 'Stock', left: true },
          { key: 'entryDate', label: 'Bought', render: (t) => fmtDate(t.entryDate) },
          { key: 'entryPrice', label: 'Buy', render: (t) => fmtPx(t.entryPrice) },
          { key: 'exitDate', label: 'Sold', render: (t) => (t.exitDate === liveDay ? `${fmtDate(t.exitDate)} (provisional)` : fmtDate(t.exitDate)) },
          { key: 'exitPrice', label: 'Sell', render: (t) => fmtPx(t.exitPrice) },
          { key: 'days', label: 'Days' },
          { key: 'pnl', label: 'P&L', render: (t) => fmtInr(t.pnl), tone: (t) => t.pnl },
          { key: 'ret', label: 'Return', render: (t) => fmtPct(t.ret, 1), tone: (t) => t.ret },
          { key: 'code', label: 'Exit rule', left: true, render: (t) => <span title={t.reason}>{t.code}</span> },
        ]}
        rows={rows}
        footer={rows.length ? [{
          key: 'total',
          cells: { sym: `Total (${rows.length})`, pnl: fmtInr(summary.realized), days: `avg ${Math.round(rows.reduce((s, t) => s + t.days, 0) / rows.length)}` },
          tones: { pnl: summary.realized },
        }] : []}
        empty="No closed trades yet."
      />
    </Section>
    </>
  );
}

function RankingsTab({ state, ctx }) {
  const preview = ctx?.preview;
  if (!preview) return <div className="positions-empty">Refresh to compute rankings.</div>;
  const held = new Set(Object.keys(state.positions));
  const rows = preview.ranked.slice(0, 60).map((r) => {
    const ind = r.ind;
    const fails = [];
    if (!(ind.close >= ind.maExit)) fails.push('B2');
    if (!(ind.close >= ind.high * 0.9)) fails.push('B3');
    if (ind.bigMove) fails.push('B4');
    return { ...r, key: r.sym, fails, held: held.has(r.sym), fromHigh: ind.close / ind.high - 1 };
  });
  return (
    <Section title={`Top 60 of ${preview.ranked.length} ranked stocks on ${fmtDate(preview.date)}`} right="Buys come from ranks 1–30; holdings are sold above rank 40 only when below the 50-day average">
      <Table
        columns={[
          { key: 'rank', label: 'Rank' },
          { key: 'sym', label: 'Stock', left: true, render: (r) => (r.held ? <b>{r.sym} ●</b> : r.sym) },
          { key: 'score', label: 'Score', render: (r) => r.score.toFixed(3) },
          { key: 'close', label: 'Close', render: (r) => fmtPx(r.ind.close) },
          { key: 'ma', label: 'vs 200-day', render: (r) => fmtPct(r.ind.close / r.ind.maExit - 1, 1), tone: (r) => r.ind.close / r.ind.maExit - 1 },
          { key: 'fromHigh', label: 'From 52w high', render: (r) => fmtPct(r.fromHigh, 1) },
          { key: 'vol', label: 'Volatility', render: (r) => fmtPct(r.ind.vol, 0, false) },
          { key: 'checks', label: 'Buy checks', left: true, render: (r) => (r.fails.length ? <span className="pos-down" title={r.fails.map((f) => BUY_CHECKS[f]).join('; ')}>fails {r.fails.join(', ')}</span> : <span className="pos-up">pass</span>) },
        ]}
        rows={rows}
      />
    </Section>
  );
}

function journalText(j) {
  if (j.kind === 'initial' || j.kind === 'monthly') {
    const sells = j.sells.map((s) => `${s.sym} (${s.code})`).join(', ') || 'none';
    const buys = j.buys.map((b) => `${b.sym} (#${b.rank})`).join(', ') || 'none';
    return (
      <>
        <div>
          Market {j.market.riskOff ? <b className="pos-down">below 200-day average — no new buys</b> : <b className="pos-up">above 200-day average</b>}
          {' · '}{j.eligibleCount} eligible of {j.universeCount} · {j.freeSlots} free slot(s)
        </div>
        <div><b>Sell:</b> {sells}</div>
        <div><b>Buy:</b> {buys}</div>
        {j.skipped.length > 0 && <div className="strategy-muted">Skipped: {j.skipped.map((s) => `${s.sym} #${s.rank} ${s.code}`).join(', ')}</div>}
      </>
    );
  }
  if (j.kind === 'orders') {
    return (
      <>
        {j.blocked.map((b) => <div key={`b-${b.sym}`}>{b.side} {b.sym}: {b.why} — retry next open</div>)}
        {j.notFilled.map((b) => <div key={`n-${b.sym}`}>{b.side} {b.sym}: not filled ({b.status})</div>)}
      </>
    );
  }
  return j.text;
}

const KIND_LABEL = {
  initial: 'Start — first portfolio decided',
  monthly: 'Monthly signal',
  orders: 'Order notes',
  expired: 'Orders expired',
  adjustment: 'Corporate action',
};

function JournalTab({ state }) {
  const entries = [...state.journal].reverse();
  return (
    <Section title="Journal">
      <div className="strategy-journal">
        {entries.map((j, k) => (
          <div key={`${j.date}-${j.kind}-${k}`} className="strategy-journal-item">
            <div className="strategy-journal-head">
              <span>{fmtDate(j.date)}</span>
              <span className="strategy-journal-kind">{KIND_LABEL[j.kind] || j.kind}</span>
            </div>
            <div className="strategy-journal-body">{journalText(j)}</div>
          </div>
        ))}
      </div>
    </Section>
  );
}

function StartPanel({ onStart, busy }) {
  const [capital, setCapital] = useState('1000000');
  return (
    <div className="positions-section strategy-start">
      <div className="positions-section-head"><h3>Start a paper run of {CODE} · {SUMMIT_20.name}</h3></div>
      <div className="strategy-start-body">
        <p>
          Paper trading only — no orders are sent to Kite. The rules from <code>{SUMMIT_20.rulebook}</code> run on the official
          Nifty 500 list and Kite daily prices. The first portfolio is decided on the latest completed session and bought at the
          next session&apos;s official open. After that, it rebalances once a month (last trading day of the month, filled at the
          next open). Orders stuck at a circuit limit are retried at the following open.
        </p>
        <p className="strategy-muted">The first load downloads about 500 price histories (a few minutes). Later refreshes fetch only new days.</p>
        <label className="strategy-capital">
          Starting capital (₹)
          <input
            type="number"
            min="100000"
            step="100000"
            value={capital}
            onChange={(e) => setCapital(e.target.value)}
          />
        </label>
        <button type="button" className="positions-refresh-btn primary" disabled={busy || !(Number(capital) >= 100000)} onClick={() => onStart(Number(capital))}>
          Start paper run
        </button>
      </div>
    </div>
  );
}

export default function StrategyView({ embedded }) {
  const [state, setState] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [ctx, setCtx] = useState(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState('');
  const [warnings, setWarnings] = useState([]);
  const [tab, setTab] = useState(TABS[0]);
  const [undoLabel, setUndoLabel] = useState('');
  const [backupAt, setBackupAt] = useState(null);
  const [savedTo, setSavedTo] = useState(null);
  const [live, setLive] = useState(null);
  const importRef = useRef(null);
  const busyRef = useRef(false);
  const stateRef = useRef(null);
  const abortRef = useRef(null);
  const genRef = useRef(0);
  const lockRef = useRef(false);
  const closeTriesRef = useRef({ day: '', n: 0 });
  const queuedRef = useRef(null);
  const runRefreshRef = useRef(null);
  stateRef.current = state;

  const refreshMeta = useCallback(async () => {
    const [undo, backup] = await Promise.all([loadUndo(CODE).catch(() => null), lastBackup(CODE)]);
    setUndoLabel(undo ? `${undo.undoLabel || 'previous'} (${(undo.undoSavedAt || '').slice(0, 10)})` : '');
    setBackupAt(backup);
  }, []);

  const persist = useCallback(async (next) => {
    const result = await saveRun(next);
    setSavedTo(result);
    return result;
  }, []);

  const runRefresh = useCallback(async (base = stateRef.current, { forceList = false } = {}) => {
    if (!base || busyRef.current || lockRef.current || !embedded || !hasSession()) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    const gen = genRef.current;
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const working = structuredClone(base);
      const result = await refreshStrategyRun(working, { onProgress: setProgress, signal: controller.signal, forceList });
      if (gen !== genRef.current) return;
      await persist(result.state);
      if (gen !== genRef.current) return;
      setState(result.state);
      setCtx(result);
      setWarnings(result.warnings);
      setProgress({ stage: "Checking today's open" });
      const today = await safeProject(result.state, result, controller.signal);
      if (gen !== genRef.current) return;
      setLive(today.live);
      if (today.warning) setWarnings([...result.warnings, today.warning]);
    } catch (e) {
      if (e?.name !== 'AbortError' && gen === genRef.current) setError(e?.message || String(e));
    } finally {
      busyRef.current = false;
      setBusy(false);
      setProgress(null);
      abortRef.current = null;
      const queued = queuedRef.current;
      queuedRef.current = null;
      if (queued) runRefreshRef.current?.(queued);
    }
  }, [embedded, persist]);
  runRefreshRef.current = runRefresh;

  // Import / undo / reset: stop any refresh of the old run and keep new ones out while storage changes.
  const withRunLocked = useCallback(async (fn) => {
    genRef.current += 1;
    abortRef.current?.abort();
    lockRef.current = true;
    try {
      return await fn();
    } finally {
      lockRef.current = false;
    }
  }, []);

  // Import / undo / reset replace the run: drop any refresh still working on the old one.
  const replaceRun = useCallback((next) => {
    genRef.current += 1;
    abortRef.current?.abort();
    setState(next);
    setCtx(null);
    setLive(null);
    setWarnings([]);
    if (!next) {
      queuedRef.current = null;
    } else if (busyRef.current) {
      queuedRef.current = next;
    } else {
      runRefresh(next);
    }
  }, [runRefresh]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const loadedRun = await loadRun(CODE);
        if (cancelled) return;
        setState(loadedRun.state);
        setWarnings(loadedRun.warnings);
        setLoaded(true);
        refreshMeta();
        if (loadedRun.state) runRefresh(loadedRun.state);
      } catch (e) {
        if (!cancelled) {
          setError(e?.message || String(e));
          setLoaded(true);
        }
      }
    })();
    return () => {
      cancelled = true;
      abortRef.current?.abort();
    };
  }, [refreshMeta, runRefresh]);

  // While the view is open, pick up the new session automatically after 4 pm IST,
  // and keep today's provisional fills current during market hours.
  useEffect(() => {
    const timer = setInterval(() => {
      const today = istToday();
      if (live && !isMarketHours()) setLive(null);
      const latest = ctx?.panel?.dates.at(-1);
      const st = stateRef.current;
      if (!st || !latest || latest >= today || !isWeekday(today)) return;
      if (isFinalSession(today)) {
        // a few tries after the close; a weekday holiday never gets a candle
        if (closeTriesRef.current.day !== today) closeTriesRef.current = { day: today, n: 0 };
        if (closeTriesRef.current.n >= 3) return;
        closeTriesRef.current.n += 1;
        runRefresh();
        return;
      }
      const ordersToday = st.pending || live || latest.slice(0, 7) !== today.slice(0, 7);
      if (isMarketHours() && ordersToday) runRefresh();
    }, 10 * 60 * 1000);
    return () => clearInterval(timer);
  }, [ctx, live, runRefresh]);

  const handleStart = useCallback(async (capital) => {
    if (busyRef.current || lockRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const result = await startStrategyRun({ capital, onProgress: setProgress, signal: controller.signal });
      await persist(result.state);
      setState(result.state);
      setCtx(result);
      setWarnings(result.warnings);
      setTab('Today');
      const today = await safeProject(result.state, result, controller.signal);
      setLive(today.live);
      if (today.warning) setWarnings([...result.warnings, today.warning]);
    } catch (e) {
      if (e?.name !== 'AbortError') setError(e?.message || String(e));
    } finally {
      busyRef.current = false;
      setBusy(false);
      setProgress(null);
      abortRef.current = null;
    }
  }, [persist]);

  const handleImport = useCallback(async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const { state: incoming, exportedAt } = await parseRunExport(await file.text(), CODE);
      const lastNav = incoming.nav.at(-1);
      const ok = window.confirm([
        `Restore this ${CODE} paper run?`,
        `Exported: ${exportedAt || 'unknown'}`,
        `Started: ${incoming.run.startDate} with ${fmtInr(incoming.run.capital)}`,
        `Processed to: ${incoming.lastProcessed}`,
        `Value: ${fmtInr(lastNav?.nav)} · holdings ${Object.keys(incoming.positions).length} · closed trades ${incoming.trades.length}`,
        '',
        'The current run is kept and can be restored with "Undo".',
        'After import the run catches up to today automatically.',
      ].join('\n'));
      if (!ok) return;
      await withRunLocked(async () => {
        await commitImport(incoming);
        await refreshMeta();
      });
      replaceRun(incoming);
    } catch (e) {
      window.alert(e?.message || String(e));
    }
  }, [refreshMeta, replaceRun, withRunLocked]);

  const handleUndo = useCallback(async () => {
    if (!window.confirm(`Restore the saved copy: ${undoLabel}? The current run is kept as the new undo copy.`)) return;
    try {
      const restored = await withRunLocked(async () => {
        const r = await restoreUndo(CODE);
        await refreshMeta();
        return r;
      });
      replaceRun(restored);
    } catch (e) {
      window.alert(e?.message || String(e));
    }
  }, [undoLabel, refreshMeta, replaceRun, withRunLocked]);

  const handleReset = useCallback(async () => {
    if (!window.confirm(`Delete the ${CODE} paper run? A copy is kept and can be restored with "Undo". Export it first if you want a file.`)) return;
    try {
      await withRunLocked(() => resetRun(CODE));
      replaceRun(null);
    } catch (e) {
      window.alert(e?.message || String(e));
    }
    await refreshMeta();
  }, [refreshMeta, replaceRun, withRunLocked]);

  const handleExport = useCallback(async () => {
    try {
      await exportRunFile(stateRef.current);
    } catch (e) {
      window.alert(e?.message || String(e));
    }
    refreshMeta();
  }, [refreshMeta]);

  // During market hours, show today's provisional fills everywhere; the saved run stays end-of-day.
  const shown = live?.state || state;
  const liveDay = live?.state ? live.day : null;
  const summary = useMemo(() => (shown ? summarize(shown) : null), [shown]);

  const backupDue = state && (() => {
    const ref = backupAt || state.run.createdAt;
    return (Date.now() - Date.parse(ref)) / 86400000 > BACKUP_REMINDER_DAYS;
  })();

  const progressPct = progress?.total ? Math.round((progress.done / progress.total) * 100) : null;

  return (
    <div className="table-panel positions-view strategy-view">
      <div className="strategy-header">
        <div className="strategy-title">
          <span className="eyebrow">Strategy · paper trading</span>
          <h2>{CODE} · {SUMMIT_20.name}</h2>
          <span className="strategy-muted">
            Monthly · Nifty 500 · 20 stocks · fills at official open
            {state && ` · started ${fmtDate(state.run.startDate)} · processed to ${fmtDate(state.lastProcessed)}`}
            {savedTo && !savedTo.master && ' · saved in browser only'}
          </span>
        </div>
        <div className="strategy-actions">
          {state && (
            <>
              <button type="button" className="positions-refresh-btn" disabled={busy} onClick={() => runRefresh()} title="Download new sessions and update the paper ledger">
                <span className={`positions-refresh-icon${busy ? ' spinning' : ''}`}>↻</span> Refresh
              </button>
              <button type="button" className="positions-refresh-btn" disabled={busy} onClick={handleExport} title="Download the complete run (holdings, orders, trades, daily values, journal) as one file">Export</button>
            </>
          )}
          <button type="button" className="positions-refresh-btn" disabled={busy} onClick={() => importRef.current?.click()} title="Restore a run exactly from an exported file">Import</button>
          {undoLabel && <button type="button" className="positions-refresh-btn" disabled={busy} onClick={handleUndo} title={`Restore ${undoLabel}`}>Undo</button>}
          {state && <button type="button" className="positions-refresh-btn strategy-danger" disabled={busy} onClick={handleReset}>Reset</button>}
          <input ref={importRef} type="file" accept="application/json,.json" hidden onChange={handleImport} />
        </div>
      </div>

      {busy && (
        <div className="strategy-progress">
          <span>{progress?.stage || 'Working'}{progress?.total ? ` · ${progress.done}/${progress.total}` : ''}{progress?.sym ? ` · ${progress.sym}` : ''}</span>
          <div className="strategy-progress-bar"><div style={{ width: `${progressPct ?? 15}%` }} /></div>
        </div>
      )}
      {error && <div className="strategy-alert strategy-alert-error">{error}</div>}
      {warnings.map((w) => <div key={w} className="strategy-alert">{w}</div>)}
      {live && state && (
        <div className="strategy-alert strategy-alert-live">
          Today {fmtDate(live.day)} (provisional, {fmtTime(live.asOf)} IST): {live.orders.filter((o) => o.status === 'filled').length} order(s) filled at the official open
          {live.orders.some((o) => o.status !== 'filled') && `, ${live.orders.filter((o) => o.status !== 'filled').length} not filled yet`}
          {live.nav && ` · live value ${fmtInr(live.nav.nav)}`}
          {live.nav && live.prevNav && ` (${fmtPct(live.nav.nav / live.prevNav.nav - 1)} today)`}
          {' · saved to the ledger after the 4 pm close. '}
          {tab !== 'Today' && <button type="button" className="strategy-link" onClick={() => setTab('Today')}>Details</button>}
        </div>
      )}
      {backupDue && !busy && (
        <div className="strategy-alert">
          No export of this run in the last {BACKUP_REMINDER_DAYS} days. <button type="button" className="strategy-link" onClick={handleExport}>Export now</button>
        </div>
      )}
      {!embedded && <div className="strategy-alert strategy-alert-error">Open https://kite.zerodha.com/local-screener with the extension enabled.</div>}

      {loaded && !state && <StartPanel onStart={handleStart} busy={busy || !embedded} />}

      {state && summary && (
        <>
          <div className="positions-summary strategy-cards">
            <Card label="Value" value={fmtInr(summary.nav)} sub={liveDay ? `live, provisional · from ${fmtInr(summary.capital)}` : `from ${fmtInr(summary.capital)}`} />
            <Card label="Total return" value={fmtPct(summary.totalReturn)} className={tone(summary.totalReturn)} sub={summary.cagr === null ? 'CAGR after 1 year' : `CAGR ${fmtPct(summary.cagr)}`} />
            <Card label="vs Nifty 500" value={fmtPct(summary.n500Return === null ? null : summary.totalReturn - summary.n500Return)} className={tone(summary.totalReturn - (summary.n500Return ?? summary.totalReturn))} sub={`Nifty 500 ${fmtPct(summary.n500Return)}`} />
            <Card label="vs Nifty 50" value={fmtPct(summary.n50Return === null ? null : summary.totalReturn - summary.n50Return)} className={tone(summary.totalReturn - (summary.n50Return ?? summary.totalReturn))} sub={`Nifty 50 ${fmtPct(summary.n50Return)}`} />
            <Card label="Drawdown" value={fmtPct(summary.drawdown.current)} className={tone(summary.drawdown.current)} sub={`worst ${fmtPct(summary.drawdown.worst)}${summary.drawdown.worstTrough ? ` (${fmtDate(summary.drawdown.worstTrough)})` : ''}`} />
            <Card label="Invested" value={fmtPct(summary.investedPct, 0, false)} sub={`${summary.positions.length} stocks · cash ${fmtInr(summary.cash)}`} />
            <Card label="Trades" value={`${summary.trades.closed} closed`} sub={`${shown.fills.length} fills · win rate ${fmtPct(summary.trades.winRate, 0, false)}`} />
            <Card
              label="Market check"
              value={ctx?.preview ? (ctx.preview.market.riskOff ? 'No new buys' : 'Buys allowed') : '—'}
              className={ctx?.preview ? (ctx.preview.market.riskOff ? 'pos-down' : 'pos-up') : ''}
              sub={`next signal ~${fmtDate(nextSignalDay(state.lastProcessed))}`}
            />
          </div>

          <div className="strategy-tabs">
            {TABS.map((t) => (
              <button key={t} type="button" className={t === tab ? 'active' : ''} onClick={() => setTab(t)}>
                {t}
                {t === 'Today' && shown.pending && <span className="strategy-dot" title="Open orders" />}
              </button>
            ))}
          </div>

          {tab === 'Overview' && <OverviewTab summary={summary} state={shown} />}
          {tab === 'Today' && <TodayTab state={state} ctx={ctx} live={live} />}
          {tab === 'Portfolio' && <PortfolioTab summary={summary} ctx={ctx} liveDay={liveDay} />}
          {tab === 'In / Out' && <InOutTab state={shown} liveDay={liveDay} />}
          {tab === 'Trades' && <TradesTab state={shown} summary={summary} liveDay={liveDay} />}
          {tab === 'Rankings' && <RankingsTab state={shown} ctx={ctx} />}
          {tab === 'Journal' && <JournalTab state={state} />}
        </>
      )}
    </div>
  );
}
