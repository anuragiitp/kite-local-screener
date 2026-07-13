import { useEffect, useState } from 'react';
import { loadMfInsights, buildExternalMfLinks } from '../screener/mfInsights';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'returns', label: 'Returns' },
  { id: 'risk', label: 'Risk' },
  { id: 'portfolio', label: 'Portfolio' },
  { id: 'peers', label: 'Peers' },
];

function toNum(value) {
  if (value == null || value === '') return null;
  const n = Number(String(value).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

function pct(value, digits = 2) {
  const n = toNum(value);
  return n == null ? '—' : `${n.toFixed(digits)}%`;
}

function plain(value, digits = 2) {
  const n = toNum(value);
  return n == null ? '—' : n.toFixed(digits);
}

/** Signed percentage with up/down colouring. */
function Delta({ value, digits = 2 }) {
  const n = toNum(value);
  if (n == null) return <span>—</span>;
  const tone = n > 0 ? 'cell-up' : n < 0 ? 'cell-down' : '';
  return <span className={tone}>{`${n.toFixed(digits)}%`}</span>;
}

function Stars({ rating }) {
  const r = Number(rating);
  if (!Number.isFinite(r) || r <= 0) return null;
  return (
    <span className="mfi-stars" title={`${r}★ Morningstar`}>
      {'★'.repeat(r)}
      <span className="mfi-stars-empty">{'★'.repeat(Math.max(0, 5 - r))}</span>
    </span>
  );
}

function Stat({ label, value }) {
  return (
    <div className="mfi-stat">
      <span className="mfi-stat-label">{label}</span>
      <span className="mfi-stat-value">{value}</span>
    </div>
  );
}

function fmtDate(value) {
  if (!value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function OverviewTab({ data }) {
  const p = data.portfolio || {};
  const alloc = p.assetAllocation || {};
  const cap = p.marketCapWeightage || {};
  const con = p.concentration || {};
  return (
    <div className="mfi-body">
      <div className="mfi-stat-grid">
        <Stat label="Category" value={data.schemeCategoryLabel || data.schemeCategory || '—'} />
        <Stat label="Benchmark" value={data.benchmarkIndex || '—'} />
        <Stat label="AUM" value={data.aum ? `₹${data.aum} Cr` : '—'} />
        <Stat label="Expense ratio" value={pct(data.expenseRatio)} />
        <Stat label="Risk" value={data.schemeRisk || '—'} />
        <Stat label="Turnover" value={pct(data.portfolioTurnover)} />
        <Stat label="Latest NAV" value={data.latestNav != null ? `₹${plain(data.latestNav)}` : '—'} />
        <Stat
          label="52W range"
          value={
            data['52WeekLowNav'] != null && data['52WeekHighNav'] != null
              ? `₹${plain(data['52WeekLowNav'])} – ₹${plain(data['52WeekHighNav'])}`
              : '—'
          }
        />
      </div>

      {data.schemeFundManagers && (
        <div className="mfi-line">
          <span className="mfi-line-label">Fund managers</span>
          <span>{data.schemeFundManagers}</span>
        </div>
      )}
      {data.inceptionDate && (
        <div className="mfi-line">
          <span className="mfi-line-label">Since</span>
          <span>{fmtDate(data.inceptionDate)} · {data.fundHouse || data.companyName || ''}</span>
        </div>
      )}

      <div className="mfi-split">
        <div>
          <h4 className="mfi-subhead">Asset allocation</h4>
          <div className="mfi-bars">
            {[
              ['Equity', alloc.equityAllocation],
              ['Debt', alloc.debtAllocation],
              ['Cash', alloc.cashAllocation],
              ['Other', alloc.otherAllocation],
            ].map(([label, v]) => (
              <div className="mfi-bar-row" key={label}>
                <span className="mfi-bar-label">{label}</span>
                <span className="mfi-bar-track">
                  <span className="mfi-bar-fill" style={{ width: `${Math.min(100, toNum(v) || 0)}%` }} />
                </span>
                <span className="mfi-bar-val">{pct(v)}</span>
              </div>
            ))}
          </div>
        </div>
        <div>
          <h4 className="mfi-subhead">Market cap</h4>
          <div className="mfi-bars">
            {[
              ['Large', cap.largeCap],
              ['Mid', cap.midCap],
              ['Small', cap.smallCap],
              ['Others', cap.others],
            ].map(([label, v]) => (
              <div className="mfi-bar-row" key={label}>
                <span className="mfi-bar-label">{label}</span>
                <span className="mfi-bar-track">
                  <span className="mfi-bar-fill" style={{ width: `${Math.min(100, toNum(v) || 0)}%` }} />
                </span>
                <span className="mfi-bar-val">{pct(v)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {con.numberOfHoldings != null && (
        <div className="mfi-stat-grid">
          <Stat label="Holdings" value={con.numberOfHoldings} />
          <Stat label="Avg market cap" value={con.averageMarketCap || '—'} />
          <Stat label="Top 5 stocks" value={pct(con.top5StocksWeight)} />
          <Stat label="Top 10 stocks" value={pct(con.top10StocksWeight)} />
        </div>
      )}
    </div>
  );
}

function ReturnsTab({ data }) {
  const cagr = data.cagr || {};
  const ranks = Array.isArray(data.ranks) ? data.ranks : [];
  const rolling = Array.isArray(data.rollingReturns) ? data.rollingReturns : [];
  return (
    <div className="mfi-body">
      <h4 className="mfi-subhead">Trailing returns (CAGR)</h4>
      <div className="mfi-stat-grid">
        {['1y', '3y', '5y', '7y', '10y'].map((k) => (
          <Stat key={k} label={k.toUpperCase()} value={<Delta value={cagr[k]} />} />
        ))}
      </div>

      {ranks.length > 0 && (
        <>
          <h4 className="mfi-subhead">Category rank</h4>
          <table className="mfi-table">
            <thead>
              <tr>
                <th>Period</th>
                <th className="mfi-num">Fund</th>
                <th className="mfi-num">Category avg</th>
                <th className="mfi-num">Rank</th>
              </tr>
            </thead>
            <tbody>
              {ranks.map((r) => (
                <tr key={r.timeframe}>
                  <td>{r.timeframe}</td>
                  <td className="mfi-num"><Delta value={r.annualizedReturn} /></td>
                  <td className="mfi-num"><Delta value={r.categoryAverage} /></td>
                  <td className="mfi-num">{r.rankInCategory ? `#${r.rankInCategory}` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {rolling.length > 0 && (
        <>
          <h4 className="mfi-subhead">Rolling returns (consistency)</h4>
          <table className="mfi-table">
            <thead>
              <tr>
                <th>Window</th>
                <th className="mfi-num">Avg</th>
                <th className="mfi-num">Min</th>
                <th className="mfi-num">Max</th>
                <th className="mfi-num">% positive</th>
              </tr>
            </thead>
            <tbody>
              {rolling
                .slice()
                .sort((a, b) => (toNum(a.timeframe) || 0) - (toNum(b.timeframe) || 0))
                .map((r) => (
                  <tr key={r.timeframe}>
                    <td>{r.timeframe}</td>
                    <td className="mfi-num"><Delta value={r.averageReturn} /></td>
                    <td className="mfi-num"><Delta value={r.minReturn} /></td>
                    <td className="mfi-num"><Delta value={r.maxReturn} /></td>
                    <td className="mfi-num">{pct(r.positiveRatio, 1)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
          <p className="mfi-note">
            Rolling returns show the spread of outcomes across every start date — a high
            average with a high “% positive” signals a consistent fund.
          </p>
        </>
      )}
    </div>
  );
}

function RiskMetricTable({ title, metric, info }) {
  const rows = metric?.timeframes || [];
  if (!rows.length) return null;
  return (
    <>
      <h4 className="mfi-subhead" title={info}>{title}</h4>
      <table className="mfi-table">
        <thead>
          <tr>
            <th>Period</th>
            <th className="mfi-num">Fund</th>
            <th className="mfi-num">Category avg</th>
            <th>Verdict</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.timeframe}>
              <td>{r.timeframe.toUpperCase()}</td>
              <td className="mfi-num">{plain(r.value)}</td>
              <td className="mfi-num">{plain(r.categoryAverage)}</td>
              <td className="mfi-verdict">{r.conclusion || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function RiskTab({ data }) {
  const rm = data.riskMetrics || {};
  const hasAny = ['riskStandardDeviation', 'sharpRatio', 'sortinoRatio', 'beta'].some(
    (k) => rm[k]?.timeframes?.length,
  );
  if (!hasAny) return <div className="mfi-body"><p className="mfi-note">No risk metrics available.</p></div>;
  return (
    <div className="mfi-body">
      <RiskMetricTable title="Standard deviation (volatility)" metric={rm.riskStandardDeviation} info={rm.riskStandardDeviation?.info} />
      <RiskMetricTable title="Sharpe ratio" metric={rm.sharpRatio} info={rm.sharpRatio?.info} />
      <RiskMetricTable title="Sortino ratio" metric={rm.sortinoRatio} info={rm.sortinoRatio?.info} />
      <RiskMetricTable title="Beta" metric={rm.beta} info={rm.beta?.info} />
    </div>
  );
}

function PortfolioTab({ data }) {
  const holdings = (Array.isArray(data.holdings) ? data.holdings : [])
    .filter((h) => (toNum(h.weightage) || 0) > 0)
    .slice(0, 15);
  const sectors = (Array.isArray(data.sectors) ? data.sectors : [])
    .filter((s) => (toNum(s.weightage) || 0) > 0)
    .slice(0, 12);
  return (
    <div className="mfi-body mfi-split">
      <div>
        <h4 className="mfi-subhead">Top holdings</h4>
        <table className="mfi-table">
          <thead>
            <tr>
              <th>Stock</th>
              <th className="mfi-num">Weight</th>
              <th className="mfi-num">1M</th>
            </tr>
          </thead>
          <tbody>
            {holdings.map((h) => (
              <tr key={h.name}>
                <td className="mfi-ellipsis" title={`${h.name}${h.sector ? ` · ${h.sector}` : ''}`}>{h.name}</td>
                <td className="mfi-num">{pct(h.weightage)}</td>
                <td className="mfi-num"><Delta value={h.change1M} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div>
        <h4 className="mfi-subhead">Sector allocation</h4>
        <table className="mfi-table">
          <thead>
            <tr>
              <th>Sector</th>
              <th className="mfi-num">Weight</th>
            </tr>
          </thead>
          <tbody>
            {sectors.map((s) => (
              <tr key={s.sector}>
                <td className="mfi-ellipsis" title={s.sector}>{s.sector}</td>
                <td className="mfi-num">{pct(s.weightage)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PeersTab({ data }) {
  const peers = Array.isArray(data.peers) ? data.peers : [];
  if (!peers.length) return <div className="mfi-body"><p className="mfi-note">No peer data available.</p></div>;
  return (
    <div className="mfi-body">
      <table className="mfi-table">
        <thead>
          <tr>
            <th>Fund</th>
            <th className="mfi-num">AUM (Cr)</th>
            <th className="mfi-num">Exp.</th>
            <th className="mfi-num">1Y</th>
            <th className="mfi-num">3Y</th>
            <th className="mfi-num">5Y</th>
          </tr>
        </thead>
        <tbody>
          {peers.map((peer) => (
            <tr key={peer.schemeCode || peer.isin || peer.schemeName}>
              <td className="mfi-ellipsis" title={peer.schemeName}>{peer.schemeNameShort || peer.schemeName}</td>
              <td className="mfi-num">{peer.aum || '—'}</td>
              <td className="mfi-num">{pct(peer.expenseRatio)}</td>
              <td className="mfi-num"><Delta value={peer.returns?.['1y']} /></td>
              <td className="mfi-num"><Delta value={peer.returns?.['3y']} /></td>
              <td className="mfi-num"><Delta value={peer.returns?.['5y']} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function MfInsightsModal({ scheme, onClose }) {
  const [tab, setTab] = useState('overview');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const isin = scheme?.isin || '';
  const name = scheme?.name || scheme?.schemeName || '';

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose?.();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    setData(null);
    loadMfInsights(isin, { signal: controller.signal })
      .then((result) => setData(result))
      .catch((err) => setError(err?.message || 'Could not load fund insights.'))
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [isin]);

  const links = buildExternalMfLinks({ isin });

  return (
    <div className="fundamentals-modal-overlay" role="dialog" aria-modal="true" aria-label={`${name} insights`}>
      <div className="fundamentals-modal-backdrop" onClick={onClose} />
      <div className="fundamentals-modal-panel mfi-panel">
        <header className="fundamentals-modal-head">
          <div className="mfi-head-main">
            <h3 className="fundamentals-modal-title">{data?.schemeName || name}</h3>
            <span className="fundamentals-modal-subtitle">
              {(data?.fundHouse || scheme?.amc || '')}
              {data?.morningStarRating ? ' · ' : ''}
              <Stars rating={data?.morningStarRating} />
            </span>
          </div>
          <button
            type="button"
            className="fundamentals-modal-close"
            onClick={onClose}
            title="Close"
            aria-label="Close insights"
          >
            ×
          </button>
        </header>

        <nav className="mfi-tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`mfi-tab${tab === t.id ? ' active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
          <span className="mfi-tabs-spacer" />
          <span className="mfi-links">
            {links.map((link) => (
              <a key={link.label} href={link.url} target="_blank" rel="noopener noreferrer" className="mfi-link">
                {link.label} ↗
              </a>
            ))}
          </span>
        </nav>

        <div className="mfi-content">
          {loading && <div className="mfi-state">Loading insights…</div>}
          {!loading && error && <div className="mfi-state mfi-error">{error}</div>}
          {!loading && !error && data && (
            <>
              {tab === 'overview' && <OverviewTab data={data} />}
              {tab === 'returns' && <ReturnsTab data={data} />}
              {tab === 'risk' && <RiskTab data={data} />}
              {tab === 'portfolio' && <PortfolioTab data={data} />}
              {tab === 'peers' && <PeersTab data={data} />}
            </>
          )}
        </div>

        <footer className="mfi-foot">
          Data via finapi.upvaly.com · community source, for information only.
        </footer>
      </div>
    </div>
  );
}
