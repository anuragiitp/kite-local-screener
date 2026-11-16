import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BENCHMARK_LABEL,
  PERIODS,
  canonicalFunds,
  coinFundUrl,
  fundCategory,
  getCachedMetrics,
  loadMetrics,
  loadMfInstruments,
  loadSavedReference,
  mfReference,
  refreshReference,
} from '../screener/mfData';
import { loadMfWatchlist, saveMfWatchlist } from '../screener/mfWatchlist';
import { fetchMfHoldings } from '../screener/kiteApi';
import MfChart from './MfChart';

const TABS = [
  ['holdings', 'Holdings'],
  ['mine', 'My Funds'],
  ['top', 'Top Returns'],
];
const RETURN_COLUMNS = ['1M', '3M', '6M', '1Y', '2Y', '3Y', '4Y', '5Y'];
const RANK_OPTIONS = [
  ['ret', 'Return'],
  ['vs', `vs ${BENCHMARK_LABEL}`],
  ['sharpe', 'Sharpe 3Y'],
  ['beat', 'Beat %'],
  ['aum', 'AUM'],
];
const GROUP_ORDER = ['Equity', 'Index', 'Hybrid', 'FoF', 'Debt', 'Other'];
const AUTO_LOAD_LIMIT = 120;
const DEFAULT_TOP_FILTER = 'c:Equity|Flexi Cap';

function pct(value, digits = 1) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '–';
  return `${value > 0 ? '+' : ''}${(value * 100).toFixed(digits)}%`;
}

function pp(value) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '–';
  return `${value > 0 ? '+' : ''}${(value * 100).toFixed(1)}`;
}

function tone(value) {
  if (!Number.isFinite(value) || value === 0) return '';
  return value > 0 ? 'pos-up' : 'pos-down';
}

function crores(value) {
  if (!Number.isFinite(value)) return '–';
  return value.toLocaleString('en-IN', { maximumFractionDigits: value < 10 ? 1 : 0 });
}

function rupees(value, signed = false) {
  if (!Number.isFinite(value)) return '–';
  const sign = signed && value > 0 ? '+' : value < 0 ? '−' : '';
  return `${sign}₹${Math.abs(value).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

const ISIN_RE = /^IN[A-Z0-9]{10}$/;

/** Kite MF holdings are per folio; merge them per ISIN. */
function groupHoldings(list) {
  const byIsin = new Map();
  list.forEach((h) => {
    // Kite web keys MF holdings by `isin`; `tradingsymbol` is not always the ISIN.
    const isin = [h?.isin, h?.tradingsymbol].map((v) => String(v || '').trim().toUpperCase()).find((v) => ISIN_RE.test(v));
    const units = Number(h?.quantity) || 0;
    if (!isin || units <= 0) return;
    const row = byIsin.get(isin) || { isin, fund: h.fund || h.tradingsymbol || isin, units: 0, invested: 0, lastPrice: null, lastPriceDate: '', dayChange: null, dayChangePct: null, folios: [] };
    row.units += units;
    row.invested += units * (Number(h.average_price) || 0);
    if (Number(h.last_price) > 0) {
      row.lastPrice = Number(h.last_price);
      row.lastPriceDate = String(h.last_price_date || '').slice(0, 10);
    }
    // day_change is per unit (NAV change); day_change_percentage is in percent.
    if (h.day_change !== null && h.day_change !== undefined && Number.isFinite(Number(h.day_change))) row.dayChange = Number(h.day_change);
    if (h.day_change_percentage !== null && h.day_change_percentage !== undefined && Number.isFinite(Number(h.day_change_percentage))) {
      row.dayChangePct = Number(h.day_change_percentage) / 100;
    }
    if (h.folio) row.folios.push(h.folio);
    byIsin.set(isin, row);
  });
  return byIsin;
}

/** Value at the newer of Kite's last price and the Coin NAV. */
function holdingPosition(h, m) {
  if (!h) return null;
  const useNav = m?.nav && (!h.lastPrice || (m.navDate || '') >= h.lastPriceDate);
  const price = useNav ? m.nav : h.lastPrice;
  const value = Number.isFinite(price) ? h.units * price : null;
  const pnl = value === null ? null : value - h.invested;
  return {
    ...h,
    value,
    pnl,
    pnlPct: pnl !== null && h.invested > 0 ? pnl / h.invested : null,
    dayPnl: h.dayChange === null ? null : h.units * h.dayChange,
  };
}

// Filter values are 'all', 'g:<group>' or 'c:<group>|<label>' so they survive a category refresh.
function matchesFilter(isin, filter, ref) {
  if (filter === 'all') return true;
  const cat = ref.categories[ref.byIsin[isin]];
  if (!cat) return false;
  if (filter.startsWith('g:')) return cat.group === filter.slice(2);
  return `${cat.group}|${cat.label}` === filter.slice(2);
}

function sortValue(row, key, period) {
  const m = row.m;
  switch (key) {
    case 'name': return row.name.toLowerCase();
    case 'aum': return row.aum ?? null;
    case 'nav': return m?.nav ?? null;
    case 'day': return m?.dayChange ?? null;
    case 'ret': return m?.returns?.[period] ?? null;
    case 'vs': return m?.vsBench?.[period] ?? null;
    case 'dd': return m?.maxDd ?? null;
    case 'sharpe': return m?.sharpe ?? null;
    case 'beat': return m?.beat ?? null;
    case 'invested': return row.pos?.invested ?? null;
    case 'value': return row.pos?.value ?? null;
    case 'pnl': return row.pos?.pnl ?? null;
    case 'pnlPct': return row.pos?.pnlPct ?? null;
    case 'dayPnl': return row.pos?.dayPnl ?? null;
    case 'dayPct': return row.pos?.dayChangePct ?? null;
    default: return null;
  }
}

/** Category select options; counts restricted to the given ISINs. */
function categoryOptions(isins, ref) {
  const counts = new Map();
  const groupCounts = new Map();
  isins.forEach((isin) => {
    const index = ref.byIsin[isin];
    if (index === undefined) return;
    counts.set(index, (counts.get(index) || 0) + 1);
    const { group } = ref.categories[index];
    groupCounts.set(group, (groupCounts.get(group) || 0) + 1);
  });
  return GROUP_ORDER.filter((group) => groupCounts.has(group)).map((group) => ({
    group,
    total: groupCounts.get(group),
    items: ref.categories.map((c, index) => ({ ...c, index }))
      .filter((c) => c.group === group && counts.has(c.index))
      .sort((a, b) => a.label.localeCompare(b.label))
      .map((c) => ({ value: `c:${c.group}|${c.label}`, label: c.label, count: counts.get(c.index) })),
  }));
}

function SortTh({ label, sortKey, sort, onSort, className = '', title }) {
  const active = sort.key === sortKey;
  return (
    <th className={`sortable ${className}${active ? ' sorted' : ''}`} onClick={() => onSort(sortKey)} title={title}>
      {label}
      {active ? (sort.dir === 'desc' ? ' ▾' : ' ▴') : ''}
    </th>
  );
}

/** Mutual fund screener: the user's editable fund list and category-wise top returns. */
export default function MfView({ embedded }) {
  const [tab, setTab] = useState('holdings');
  const [instruments, setInstruments] = useState([]);
  const [instError, setInstError] = useState('');
  const [watchlist, setWatchlist] = useState(loadMfWatchlist);
  const [period, setPeriod] = useState('1Y');
  const [sort, setSort] = useState({ key: 'ret', dir: 'desc' });
  const [filters, setFilters] = useState({ mine: 'all', holdings: 'all', top: DEFAULT_TOP_FILTER });
  const [holdings, setHoldings] = useState(() => new Map());
  const [holdingsStatus, setHoldingsStatus] = useState({ loading: false, error: '' });
  const [buyableOnly, setBuyableOnly] = useState(true);
  const [approvedKey, setApprovedKey] = useState('');
  const [progress, setProgress] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [version, setVersion] = useState(0);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [selected, setSelected] = useState('');
  const [query, setQuery] = useState('');
  const [topQuery, setTopQuery] = useState('');
  const [ref, setRef] = useState(mfReference);
  const [refStatus, setRefStatus] = useState({ busy: false, message: '', error: false });
  const forceRef = useRef(false);

  useEffect(() => {
    if (!embedded) return;
    loadSavedReference().then(setRef).catch(() => {});
  }, [embedded]);

  useEffect(() => {
    if (!embedded) return undefined;
    let cancelled = false;
    loadMfInstruments({ force: refreshNonce > 0 }).then(({ list, error }) => {
      if (cancelled) return;
      setInstruments(list);
      setInstError(error);
    });
    return () => {
      cancelled = true;
    };
  }, [embedded, refreshNonce]);

  useEffect(() => {
    if (!embedded) return undefined;
    const controller = new AbortController();
    setHoldingsStatus({ loading: true, error: '' });
    fetchMfHoldings(controller.signal)
      .then((list) => {
        const grouped = groupHoldings(list);
        setHoldings(grouped);
        setHoldingsStatus({
          loading: false,
          error: list.length && !grouped.size ? `MF holdings have no ISIN field (fields: ${Object.keys(list[0] || {}).join(', ')}).` : '',
        });
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setHoldingsStatus({ loading: false, error: `Could not load MF holdings (${error?.message || 'network error'}).` });
      });
    return () => controller.abort();
  }, [embedded, refreshNonce]);

  const holdingIsins = useMemo(() => [...holdings.keys()], [holdings]);
  const byIsin = useMemo(() => new Map(instruments.map((f) => [f.isin, f])), [instruments]);
  // One ISIN per fund: Kite repeats some funds (legacy / IDCW ISINs labelled growth).
  // ref: canonicalFunds reads the IDCW list from the current reference data.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const { funds, aliasOf } = useMemo(() => canonicalFunds(instruments), [instruments, ref]);
  const canonical = useCallback((isin) => aliasOf.get(isin) || isin, [aliasOf]);
  const myFunds = useMemo(() => [...new Set(watchlist.map(canonical))], [watchlist, canonical]);
  const watchSet = useMemo(() => new Set(myFunds), [myFunds]);

  const updateWatchlist = useCallback((updater) => {
    setWatchlist((prev) => {
      const next = updater(prev);
      saveMfWatchlist(next);
      return next;
    });
  }, []);

  const toggleWatch = useCallback((isin) => {
    updateWatchlist((prev) => (prev.some((i) => canonical(i) === isin)
      ? prev.filter((i) => canonical(i) !== isin)
      : [...prev, isin]));
  }, [updateWatchlist, canonical]);

  const scope = useMemo(() => {
    if (tab === 'mine') return myFunds;
    if (tab === 'holdings') return holdingIsins;
    const tokens = topQuery.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return funds
      .filter((f) => !buyableOnly || f.buyable)
      .filter((f) => {
        const hay = `${f.name} ${f.amc}`.toLowerCase();
        return tokens.every((t) => hay.includes(t));
      })
      .map((f) => f.isin);
  }, [tab, myFunds, holdingIsins, funds, buyableOnly, topQuery]);

  const options = useMemo(() => categoryOptions(scope, ref), [scope, ref]);
  const filter = useMemo(() => {
    const wanted = filters[tab];
    if (wanted === 'all' || !options.length) return wanted;
    const valid = options.some((g) => `g:${g.group}` === wanted || g.items.some((item) => item.value === wanted));
    return valid ? wanted : 'all';
  }, [filters, tab, options]);
  const candidates = useMemo(() => scope.filter((isin) => matchesFilter(isin, filter, ref)), [scope, filter, ref]);
  const candidatesKey = `${tab}|${candidates.join(',')}`;

  useEffect(() => {
    if (!embedded || !candidates.length) {
      setProgress(null);
      return undefined;
    }
    const controller = new AbortController();
    const force = forceRef.current;
    forceRef.current = false;
    let timer = null;
    let latest = null;
    const flush = () => {
      timer = null;
      setProgress(latest);
      setVersion((v) => v + 1);
    };
    const onUpdate = (p) => {
      if (controller.signal.aborted) return;
      latest = p;
      if (!timer) timer = setTimeout(flush, 300);
    };

    (async () => {
      setLoadError('');
      if (!force) {
        await loadMetrics(candidates, { cacheOnly: true });
        if (controller.signal.aborted) return;
        setVersion((v) => v + 1);
      }
      const uncached = force ? candidates.length : candidates.filter((isin) => !getCachedMetrics(isin)).length;
      const allowed = force || tab !== 'top' || uncached <= AUTO_LOAD_LIMIT || approvedKey === candidatesKey;
      if (!uncached || !allowed) {
        setProgress(null);
        return;
      }
      setProgress({ done: candidates.length - uncached, total: candidates.length });
      const { failed } = await loadMetrics(candidates, { force, signal: controller.signal, onUpdate });
      if (controller.signal.aborted) return;
      clearTimeout(timer);
      timer = null;
      setProgress(null);
      setVersion((v) => v + 1);
      if (failed) setLoadError(`NAV history could not be loaded for ${failed} fund(s). Use Refresh to retry.`);
    })();

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
    // candidatesKey captures tab + candidates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [embedded, candidatesKey, approvedKey, refreshNonce]);

  const rows = useMemo(() => {
    const list = candidates.map((isin) => {
      const info = byIsin.get(isin);
      const h = holdings.get(isin);
      const m = getCachedMetrics(isin);
      return {
        isin,
        name: info?.name || h?.fund || isin,
        amc: info?.amc || '',
        buyable: info ? info.buyable : null,
        category: fundCategory(isin),
        aum: ref.aum[isin] ?? null,
        m,
        pos: holdingPosition(h, m),
      };
    });
    const dir = sort.dir === 'desc' ? -1 : 1;
    return list.sort((a, b) => {
      const va = sortValue(a, sort.key, period);
      const vb = sortValue(b, sort.key, period);
      if (va === null && vb === null) return a.name.localeCompare(b.name);
      if (va === null) return 1;
      if (vb === null) return -1;
      if (va < vb) return -dir;
      if (va > vb) return dir;
      return a.name.localeCompare(b.name);
    });
    // version re-reads the metrics cache after loads; ref changes categories (fundCategory).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidates, byIsin, holdings, sort, period, version, ref]);

  const uncachedCount = useMemo(
    () => candidates.filter((isin) => !getCachedMetrics(isin)).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [candidates, version],
  );
  const needsApproval = tab === 'top' && !progress && uncachedCount > AUTO_LOAD_LIMIT && approvedKey !== candidatesKey;
  const latestNavDate = rows.reduce((max, r) => (r.m?.navDate && r.m.navDate > max ? r.m.navDate : max), '');
  const selectedRow = rows.find((r) => r.isin === selected) || rows[0] || null;
  const columns = PERIODS.filter((p) => RETURN_COLUMNS.includes(p) || p === period);
  const showHoldings = tab === 'holdings';
  const totals = useMemo(() => {
    const held = rows.filter((r) => r.pos);
    const invested = held.reduce((sum, r) => sum + r.pos.invested, 0);
    const value = held.every((r) => r.pos.value !== null) ? held.reduce((sum, r) => sum + r.pos.value, 0) : null;
    const pnl = value === null ? null : value - invested;
    const dayPnl = held.some((r) => r.pos.dayPnl !== null) ? held.reduce((sum, r) => sum + (r.pos.dayPnl ?? 0), 0) : null;
    return {
      invested,
      value,
      pnl,
      pnlPct: pnl !== null && invested > 0 ? pnl / invested : null,
      dayPnl,
      dayPct: dayPnl !== null && value !== null && value - dayPnl > 0 ? dayPnl / (value - dayPnl) : null,
    };
  }, [rows]);

  const onSort = (key) => {
    setSort((prev) => (prev.key === key ? { key, dir: prev.dir === 'desc' ? 'asc' : 'desc' } : { key, dir: key === 'name' ? 'asc' : 'desc' }));
  };
  const onPeriodColumn = (p) => {
    if (period === p && sort.key === 'ret') onSort('ret');
    else {
      setPeriod(p);
      setSort({ key: 'ret', dir: 'desc' });
    }
  };

  const searchResults = useMemo(() => {
    const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!tokens.length) return [];
    return funds
      .filter((f) => !watchSet.has(f.isin))
      .filter((f) => {
        const hay = `${f.name} ${f.amc} ${f.isin}`.toLowerCase();
        return tokens.every((t) => hay.includes(t));
      })
      .sort((a, b) => Number(b.buyable) - Number(a.buyable) || a.name.localeCompare(b.name))
      .slice(0, 12);
  }, [query, funds, watchSet]);

  const addFromSearch = (isin) => {
    updateWatchlist((prev) => (prev.some((i) => canonical(i) === isin) ? prev : [...prev, isin]));
    setSelected(isin);
    setQuery('');
  };

  const onRefresh = () => {
    forceRef.current = true;
    setRefreshNonce((n) => n + 1);
  };

  const onUpdateReference = async () => {
    setRefStatus({ busy: true, message: 'Updating AUM & categories…', error: false });
    try {
      const { stats, warning } = await refreshReference(instruments);
      setRef(mfReference());
      setRefStatus({
        busy: false,
        message: `Updated ${stats.funds} funds · AUM for ${stats.aum}${warning ? ` · ${warning}` : ''}`,
        error: Boolean(warning),
      });
    } catch (error) {
      setRefStatus({
        busy: false,
        message: `Update failed (${error?.message || 'network error'}). Reload the extension in chrome://extensions and try again.`,
        error: true,
      });
    }
  };

  const progressPct = progress?.total ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div className="table-panel positions-view strategy-view mf-view">
      <div className="strategy-header">
        <div className="strategy-title">
          <span className="eyebrow">Mutual funds · direct growth</span>
          <h2>Mutual Funds</h2>
          <span className="strategy-muted">
            NAV from Coin{latestNavDate ? ` · as of ${latestNavDate}` : ''} · AUM as of {ref.aumDate || '–'} · 1Y+ columns are CAGR (as on Coin), shorter periods absolute · {BENCHMARK_LABEL} = HDFC Nifty 50 Index Fund
          </span>
        </div>
        <div className="strategy-actions">
          <button
            type="button"
            className="positions-refresh-btn"
            disabled={refStatus.busy || !embedded || !instruments.length}
            onClick={onUpdateReference}
            title="Re-download AUM (Coin) and SEBI categories (AMFI) for all funds, including newly launched ones"
          >
            <span className={`positions-refresh-icon${refStatus.busy ? ' spinning' : ''}`}>↻</span> AUM &amp; categories
          </button>
          <button type="button" className="positions-refresh-btn" disabled={Boolean(progress) || !embedded} onClick={onRefresh} title="Re-download the fund list, holdings and NAV history">
            <span className={`positions-refresh-icon${progress ? ' spinning' : ''}`}>↻</span> Refresh
          </button>
        </div>
      </div>

      {!embedded && <div className="strategy-alert strategy-alert-error">Open https://kite.zerodha.com/local-screener with the extension enabled.</div>}
      {instError && <div className="strategy-alert strategy-alert-error">{instError}</div>}
      {refStatus.message && (
        <div className={`strategy-alert${refStatus.error ? ' strategy-alert-error' : ''}`}>{refStatus.message}</div>
      )}
      {loadError && <div className="strategy-alert">{loadError}</div>}
      {showHoldings && holdingsStatus.error && <div className="strategy-alert strategy-alert-error">{holdingsStatus.error}</div>}

      <div className="strategy-tabs">
        {TABS.map(([id, label]) => (
          <button key={id} type="button" className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>
            {label}
            {id === 'mine' ? ` (${myFunds.length})` : ''}
            {id === 'holdings' ? ` (${holdingIsins.length})` : ''}
          </button>
        ))}
      </div>

      <div className="mf-toolbar">
        <select
          className="mf-select"
          value={filter}
          onChange={(e) => setFilters((prev) => ({ ...prev, [tab]: e.target.value }))}
          title="Category"
        >
          <option value="all">All categories ({scope.length})</option>
          {options.map((g) => (
            <optgroup key={g.group} label={g.group}>
              <option value={`g:${g.group}`}>All {g.group} ({g.total})</option>
              {g.items.map((item) => (
                <option key={item.value} value={item.value}>{item.label} ({item.count})</option>
              ))}
            </optgroup>
          ))}
        </select>

        <div className="strategy-tabs mf-chips" title="Return period">
          {PERIODS.map((p) => (
            <button key={p} type="button" className={period === p ? 'active' : ''} onClick={() => setPeriod(p)}>{p}</button>
          ))}
        </div>

        <label className="mf-inline">
          Rank by
          <select
            className="mf-select"
            value={RANK_OPTIONS.some(([key]) => key === sort.key) ? sort.key : ''}
            onChange={(e) => setSort({ key: e.target.value, dir: 'desc' })}
          >
            {!RANK_OPTIONS.some(([key]) => key === sort.key) && <option value="">Column</option>}
            {RANK_OPTIONS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </label>

        {tab === 'top' && (
          <label className="mf-inline">
            <input type="checkbox" checked={buyableOnly} onChange={(e) => setBuyableOnly(e.target.checked)} />
            Buyable only
          </label>
        )}

        {tab === 'top' && (
          <div className="mf-search">
            <input
              type="search"
              value={topQuery}
              placeholder="Filter by fund or AMC, e.g. invesco"
              onChange={(e) => {
                // Starting a search shows every category of the match; narrow with the dropdown afterwards.
                if (!topQuery.trim() && e.target.value.trim()) setFilters((prev) => ({ ...prev, top: 'all' }));
                setTopQuery(e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setTopQuery('');
              }}
            />
          </div>
        )}

        {tab === 'mine' && (
          <div className="mf-search">
            <input
              type="search"
              value={query}
              placeholder="Add a fund: search name or AMC"
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setQuery('');
                if (e.key === 'Enter' && searchResults[0]) addFromSearch(searchResults[0].isin);
              }}
            />
            {query.trim() && (
              <div className="mf-search-results">
                {searchResults.length ? searchResults.map((f) => (
                  <button key={f.isin} type="button" onClick={() => addFromSearch(f.isin)}>
                    <span className="mf-search-name">{f.name}</span>
                    <span className="mf-search-meta">
                      {fundCategory(f.isin)?.label || f.schemeType}
                      {!f.buyable && ' · buy closed'}
                    </span>
                  </button>
                )) : <div className="mf-search-empty">No matching direct-growth fund</div>}
              </div>
            )}
          </div>
        )}
      </div>

      {showHoldings && holdingIsins.length > 0 && (
        <div className="positions-summary mf-holdings-summary">
          <div className="positions-summary-item">
            <span className="positions-summary-label">Invested</span>
            <span className="positions-summary-value">{rupees(totals.invested)}</span>
          </div>
          <div className="positions-summary-item">
            <span className="positions-summary-label">Current value</span>
            <span className="positions-summary-value">{rupees(totals.value)}</span>
          </div>
          <div className="positions-summary-item">
            <span className="positions-summary-label">P&amp;L</span>
            <span className={`positions-summary-value ${tone(totals.pnl)}`}>
              {rupees(totals.pnl, true)} ({pct(totals.pnlPct)})
            </span>
          </div>
          <div className="positions-summary-item">
            <span className="positions-summary-label">Day P&amp;L</span>
            <span className={`positions-summary-value ${tone(totals.dayPnl)}`}>
              {rupees(totals.dayPnl, true)} ({pct(totals.dayPct, 2)})
            </span>
          </div>
        </div>
      )}

      {progress && (
        <div className="strategy-progress">
          <span>Loading NAV history · {progress.done}/{progress.total}</span>
          <div className="strategy-progress-bar"><div style={{ width: `${progressPct}%` }} /></div>
        </div>
      )}
      {needsApproval && (
        <div className="strategy-alert">
          {uncachedCount} funds in this selection need NAV history.{' '}
          <button type="button" className="positions-refresh-btn primary" onClick={() => setApprovedKey(candidatesKey)}>
            Load {uncachedCount} funds
          </button>
        </div>
      )}

      <div className="positions-table-wrap mf-table-wrap">
        <table className="positions-table mf-table">
          <thead>
            <tr>
              <th>#</th>
              <SortTh label="Fund" sortKey="name" sort={sort} onSort={onSort} className="align-left" />
              {showHoldings && (
                <>
                  <SortTh label="Invested" sortKey="invested" sort={sort} onSort={onSort} title="Units × average NAV (all folios)" />
                  <SortTh label="Value" sortKey="value" sort={sort} onSort={onSort} title="Units × latest NAV" />
                  <SortTh label="P&L" sortKey="pnl" sort={sort} onSort={onSort} />
                  <SortTh label="P&L %" sortKey="pnlPct" sort={sort} onSort={onSort} title="Absolute return on cost" />
                  <SortTh label="Day P&L" sortKey="dayPnl" sort={sort} onSort={onSort} title="Units × latest NAV change (from Kite)" />
                  <SortTh label="Day %" sortKey="dayPct" sort={sort} onSort={onSort} title="Latest NAV change % (from Kite)" />
                </>
              )}
              <SortTh label="AUM ₹Cr" sortKey="aum" sort={sort} onSort={onSort} title={`Scheme AUM in ₹ crore (all plans), from Coin as of ${ref.aumDate || 'unknown'}`} />
              <SortTh label="NAV" sortKey="nav" sort={sort} onSort={onSort} />
              <SortTh label="Day" sortKey="day" sort={sort} onSort={onSort} />
              {columns.map((p) => (
                <th
                  key={p}
                  className={`sortable${period === p ? ' mf-period-col' : ''}${period === p && sort.key === 'ret' ? ' sorted' : ''}`}
                  onClick={() => onPeriodColumn(p)}
                  title={periodTitle(p)}
                >
                  {p}
                  {period === p && sort.key === 'ret' ? (sort.dir === 'desc' ? ' ▾' : ' ▴') : ''}
                </th>
              ))}
              <SortTh label={`vs ${BENCHMARK_LABEL} ${period}`} sortKey="vs" sort={sort} onSort={onSort} title={`${period} return minus the Nifty 50 index fund, in percentage points`} />
              <SortTh label="Max DD 3Y" sortKey="dd" sort={sort} onSort={onSort} title="Worst peak-to-trough fall in the last 3 years" />
              <SortTh label="Sharpe 3Y" sortKey="sharpe" sort={sort} onSort={onSort} title="(3Y CAGR − 6.5%) ÷ annualised daily volatility" />
              <SortTh label="Beat %" sortKey="beat" sort={sort} onSort={onSort} title={`Share of rolling 1-year windows (weekly, last 3 years) where the fund beat ${BENCHMARK_LABEL}`} />
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={columns.length + (showHoldings ? 16 : 10)} className="strategy-empty-row">
                  {tab === 'mine' && !myFunds.length
                    ? 'Your list is empty. Search above to add funds.'
                    : showHoldings && !holdingIsins.length
                      ? (holdingsStatus.loading ? 'Loading holdings…' : 'No mutual fund holdings.')
                      : 'No funds in this selection.'}
                </td>
              </tr>
            )}
            {rows.map((row, i) => {
              const m = row.m;
              const inList = watchSet.has(row.isin);
              return (
                <tr
                  key={row.isin}
                  className={`positions-row${selectedRow?.isin === row.isin ? ' selected-row' : ''}`}
                  onClick={() => setSelected(row.isin)}
                >
                  <td className="strategy-muted">{i + 1}</td>
                  <td className="align-left mf-fund-cell">
                    <div className="mf-fund-name" title={row.isin}>{row.name}</div>
                    <div className="mf-fund-meta">
                      {row.category && <span className="positions-badge">{row.category.label}</span>}
                      {row.buyable === false && <span className="positions-badge mf-badge-closed">Buy closed</span>}
                      <span>{row.amc}</span>
                      <a
                        className="mf-coin-link"
                        href={coinFundUrl(row.isin)}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Open in Coin"
                        onClick={(e) => e.stopPropagation()}
                      >
                        Coin ↗
                      </a>
                    </div>
                  </td>
                  {showHoldings && (
                    <>
                      <td title={row.pos ? `${row.pos.units.toLocaleString('en-IN', { maximumFractionDigits: 3 })} units · avg ${(row.pos.invested / row.pos.units).toFixed(2)} · folio ${row.pos.folios.join(', ') || '–'}` : ''}>
                        {rupees(row.pos?.invested)}
                      </td>
                      <td>{rupees(row.pos?.value)}</td>
                      <td className={tone(row.pos?.pnl)}>{rupees(row.pos?.pnl, true)}</td>
                      <td className={tone(row.pos?.pnlPct)}>{pct(row.pos?.pnlPct)}</td>
                      <td className={tone(row.pos?.dayPnl)}>{rupees(row.pos?.dayPnl, true)}</td>
                      <td className={tone(row.pos?.dayChangePct)}>{pct(row.pos?.dayChangePct, 2)}</td>
                    </>
                  )}
                  <td>{crores(row.aum)}</td>
                  <td title={m?.navDate ? `NAV date ${m.navDate}` : ''}>{m?.nav ? m.nav.toFixed(2) : '–'}</td>
                  <td className={tone(m?.dayChange)}>{pct(m?.dayChange, 2)}</td>
                  {columns.map((p) => (
                    <td key={p} className={`${tone(m?.returns?.[p])}${period === p ? ' mf-period-col' : ''}`}>{pct(m?.returns?.[p])}</td>
                  ))}
                  <td className={tone(m?.vsBench?.[period])}>{pp(m?.vsBench?.[period])}</td>
                  <td className={tone(m?.maxDd)}>{pct(m?.maxDd)}</td>
                  <td>{Number.isFinite(m?.sharpe) ? m.sharpe.toFixed(2) : '–'}</td>
                  <td>{Number.isFinite(m?.beat) ? `${Math.round(m.beat * 100)}%` : '–'}</td>
                  <td>
                    {tab === 'mine' ? (
                      <button
                        type="button"
                        className="mf-icon-btn"
                        title="Remove from My Funds"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleWatch(row.isin);
                        }}
                      >
                        ×
                      </button>
                    ) : (
                      <button
                        type="button"
                        className={`mf-icon-btn${inList ? ' mf-star-on' : ''}`}
                        title={inList ? 'In My Funds (click to remove)' : 'Add to My Funds'}
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleWatch(row.isin);
                        }}
                      >
                        {inList ? '★' : '☆'}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {embedded && selectedRow && <MfChart key={`${selectedRow.isin}-${refreshNonce}`} isin={selectedRow.isin} name={selectedRow.name} />}
    </div>
  );
}

function periodTitle(p) {
  if (p === 'YTD') return 'Absolute return since the last NAV of the previous year';
  return ['1M', '3M', '6M'].includes(p) ? `${p} absolute return` : `${p} CAGR (as on Coin)`;
}
