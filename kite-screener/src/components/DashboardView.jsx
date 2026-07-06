import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import DashboardTable from './DashboardTable';
import SectorHeatmapPanel from './SectorHeatmapPanel';
import ChartPanel from './ChartPanel';
import { fetchUpToRows, hasSession } from '../screener/kiteApi';
import { bookmarksToRows, hasValidInstrumentToken } from '../screener/bookmarks';
import { mergeLiveTickRow } from '../screener/liveTick';
import { filterHiddenRows } from '../screener/hiddenSymbols';
import { buildRequestBody } from '../screener/queryBuilder';
import {
  DASHBOARD_GAINERS,
  DASHBOARD_LOSERS,
  DASHBOARD_SECTOR,
  SECTOR_SCREENER_MIN_ROWS,
  buildSectorHeatmapSections,
  compareSectorOrder,
} from '../screener/presets';

const GAINERS_LIMIT = 500;
const LOSERS_LIMIT = 500;

function applyTicks(rows, liveTicks) {
  if (!rows.length || !liveTicks || !Object.keys(liveTicks).length) return rows;
  return rows.map((row) => {
    if (row?.type === 'separator') return row;
    return mergeLiveTickRow(row, liveTicks[Number(row?.instrument_token)]);
  });
}

/** Cap-weighted sector change + breadth (how many stocks up vs down). */
function computeSectorStats(items) {
  let weightedSum = 0;
  let weightTotal = 0;
  let up = 0;
  let down = 0;

  items.forEach((item) => {
    const chg = Number(item.change_percent);
    if (!Number.isFinite(chg)) return;

    const cap = Number(item.market_cap);
    const weight = Number.isFinite(cap) && cap > 0 ? cap : 1;
    weightedSum += chg * weight;
    weightTotal += weight;

    if (chg > 0) up += 1;
    else if (chg < 0) down += 1;
  });

  const count = items.length;
  const avg = weightTotal ? weightedSum / weightTotal : 0;
  return { avg, count, up, down };
}

function buildSectorRows(rows) {
  const groups = new Map();
  rows.forEach((row) => {
    const sector = (row?.sector || 'Other').trim() || 'Other';
    if (!groups.has(sector)) groups.set(sector, []);
    groups.get(sector).push(row);
  });

  const stats = [...groups.entries()].map(([sector, items]) => {
    const { avg, count, up, down } = computeSectorStats(items);
    return { sector, items, avg, count, up, down };
  });

  stats.sort(compareSectorOrder);

  const out = [];
  stats.forEach(({ sector, items, avg, count, up, down }) => {
    out.push({ type: 'separator', label: sector, meta: { avg, count, up, down } });
    const sorted = [...items].sort(
      (a, b) => (Number(b.market_cap) || 0) - (Number(a.market_cap) || 0),
    );
    out.push(...sorted);
  });
  return out;
}

function collectTokens(...rowSets) {
  const set = new Set();
  rowSets.forEach((rows) => {
    rows.forEach((row) => {
      if (row?.type === 'separator') return;
      const token = Number(row?.instrument_token);
      if (hasValidInstrumentToken(row)) set.add(token);
    });
  });
  return Array.from(set);
}

export default function DashboardView({
  embedded,
  marketCapId,
  indexItems = [],
  liveTicks = {},
  selectedRow,
  selectedRowLive,
  onSelectRow,
  isBookmarked,
  onToggleBookmark,
  onHideSymbol,
  onVisibleTokens,
  hiddenSymbols = [],
  limit = 500,
  refreshKey = 0,
  onRefresh,
}) {
  const [gainers, setGainers] = useState([]);
  const [losers, setLosers] = useState([]);
  const [sectorRows, setSectorRows] = useState([]);
  const [loading, setLoading] = useState({ gainers: false, losers: false, sector: false });
  const [errors, setErrors] = useState({ gainers: '', losers: '', sector: '' });
  const tokensCallbackRef = useRef(onVisibleTokens);
  tokensCallbackRef.current = onVisibleTokens;
  const sectorJumpRef = useRef(null);

  const registerSectorJump = useCallback((fn) => {
    sectorJumpRef.current = fn;
  }, []);

  const handleSectorJump = useCallback((label) => {
    sectorJumpRef.current?.(label);
  }, []);

  const ready = embedded && hasSession();
  const dashboardBusy = loading.gainers || loading.losers || loading.sector;

  useEffect(() => {
    if (!ready) return undefined;
    const controller = new AbortController();

    const runList = (screener, targetRows, setter, key) => {
      setLoading((s) => ({ ...s, [key]: true }));
      setErrors((e) => ({ ...e, [key]: '' }));
      const body = buildRequestBody({ screener, marketCapId, sector: '', limit: targetRows });
      return fetchUpToRows(body, { targetRows, signal: controller.signal })
        .then((result) => {
          if (!controller.signal.aborted) setter(result.rows || []);
        })
        .catch((error) => {
          if (error.name === 'AbortError') return;
          if (!controller.signal.aborted) {
            setter([]);
            setErrors((e) => ({ ...e, [key]: error.message || 'Failed to load.' }));
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading((s) => ({ ...s, [key]: false }));
        });
    };

    runList(DASHBOARD_GAINERS, GAINERS_LIMIT, setGainers, 'gainers');
    runList(DASHBOARD_LOSERS, LOSERS_LIMIT, setLosers, 'losers');
    runList(
      DASHBOARD_SECTOR,
      Math.max(limit, SECTOR_SCREENER_MIN_ROWS),
      setSectorRows,
      'sector',
    );

    return () => controller.abort();
  }, [ready, marketCapId, limit, refreshKey]);

  const indexRows = useMemo(
    () => filterHiddenRows(applyTicks(bookmarksToRows(indexItems), liveTicks), hiddenSymbols),
    [indexItems, liveTicks, hiddenSymbols],
  );
  const gainerRows = useMemo(
    () => filterHiddenRows(applyTicks(gainers, liveTicks), hiddenSymbols),
    [gainers, liveTicks, hiddenSymbols],
  );
  const loserRows = useMemo(
    () => filterHiddenRows(applyTicks(losers, liveTicks), hiddenSymbols),
    [losers, liveTicks, hiddenSymbols],
  );
  const sectorRowsLive = useMemo(
    () => filterHiddenRows(applyTicks(sectorRows, liveTicks), hiddenSymbols),
    [sectorRows, liveTicks, hiddenSymbols],
  );
  const sectorGrouped = useMemo(() => buildSectorRows(sectorRowsLive), [sectorRowsLive]);
  const sectorHeatmap = useMemo(() => {
    const items = sectorGrouped
      .filter((row) => row?.type === 'separator')
      .map((row) => ({
        label: row.label,
        avg: row.meta?.avg ?? 0,
        count: row.meta?.count ?? 0,
        up: row.meta?.up ?? 0,
        down: row.meta?.down ?? 0,
      }));
    return buildSectorHeatmapSections(items);
  }, [sectorGrouped]);

  useEffect(() => {
    const tokens = collectTokens(indexRows, gainerRows, loserRows, sectorRowsLive);
    tokensCallbackRef.current?.(tokens);
  }, [indexRows, gainerRows, loserRows, sectorRowsLive]);

  useEffect(() => {
    if (!selectedRow) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onSelectRow?.(null);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [selectedRow, onSelectRow]);

  return (
    <div className="dashboard-view">
      {onRefresh && (
        <div className="dashboard-toolbar">
          <button
            type="button"
            className={`table-refresh-btn${dashboardBusy ? ' spinning' : ''}`}
            onClick={onRefresh}
            disabled={dashboardBusy}
            title="Refresh dashboard"
            aria-label="Refresh dashboard"
          >
            ↻
          </button>
        </div>
      )}
      <div className="dashboard-grid">
        <DashboardTable
          title="Indices"
          rows={indexRows}
          loading={false}
          error=""
          selectedRow={selectedRow}
          onSelectRow={onSelectRow}
          isBookmarked={isBookmarked}
          onToggleBookmark={onToggleBookmark}
          grouped
        />
        <DashboardTable
          title="Top Gainers"
          rows={gainerRows}
          loading={loading.gainers}
          error={errors.gainers}
          selectedRow={selectedRow}
          onSelectRow={onSelectRow}
          isBookmarked={isBookmarked}
          onToggleBookmark={onToggleBookmark}
          onHideSymbol={onHideSymbol}
        />
        <DashboardTable
          title="Top Losers"
          rows={loserRows}
          loading={loading.losers}
          error={errors.losers}
          selectedRow={selectedRow}
          onSelectRow={onSelectRow}
          isBookmarked={isBookmarked}
          onToggleBookmark={onToggleBookmark}
          onHideSymbol={onHideSymbol}
        />
        <SectorHeatmapPanel
          title="Sector Heatmap"
          subtitle={loading.sector ? 'Loading…' : undefined}
          heatmap={sectorHeatmap}
          loading={loading.sector}
          onJump={handleSectorJump}
        />
        <DashboardTable
          title="Sector Screener"
          subtitle={loading.sector ? 'Loading…' : `${sectorRowsLive.length} stocks`}
          rows={sectorGrouped}
          loading={loading.sector}
          error={errors.sector}
          selectedRow={selectedRow}
          onSelectRow={onSelectRow}
          isBookmarked={isBookmarked}
          onToggleBookmark={onToggleBookmark}
          onHideSymbol={onHideSymbol}
          grouped
          registerJump={registerSectorJump}
        />
      </div>

      {selectedRow && (
        <div className="dashboard-chart-overlay" role="dialog" aria-modal="true">
          <div
            className="dashboard-chart-backdrop"
            onClick={() => onSelectRow?.(null)}
          />
          <div className="dashboard-chart-panel">
            <button
              type="button"
              className="dashboard-chart-close"
              title="Close chart"
              onClick={() => onSelectRow?.(null)}
            >
              ✕
            </button>
            <ChartPanel row={selectedRowLive || selectedRow} />
          </div>
        </div>
      )}
    </div>
  );
}
