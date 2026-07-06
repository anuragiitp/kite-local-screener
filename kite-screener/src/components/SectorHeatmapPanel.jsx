function formatPercent(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '-';
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(2)}%`;
}

function toneClass(change) {
  const n = Number(change);
  if (!Number.isFinite(n) || n === 0) return '';
  return n > 0 ? 'cell-up' : 'cell-down';
}

function formatBreadth(up, down) {
  const pos = Number(up) || 0;
  const neg = Number(down) || 0;
  if (!pos && !neg) return '';
  return `+${pos} / −${neg}`;
}

function SectorChip({ item, onJump }) {
  const tone = toneClass(item.avg);
  const cls = tone === 'cell-up' ? ' up' : tone === 'cell-down' ? ' down' : '';
  return (
    <button
      type="button"
      className={`sector-chip${cls}`}
      title={`${item.label} · cap-wtd ${formatPercent(item.avg)} · ${formatBreadth(item.up, item.down)} · ${item.count} stocks`}
      onClick={() => onJump?.(item.label)}
    >
      <span className="sector-chip-name">{item.label}</span>
      <span className="sector-chip-pct">{formatPercent(item.avg)}</span>
      {(item.up > 0 || item.down > 0) && (
        <span className="sector-chip-breadth">{formatBreadth(item.up, item.down)}</span>
      )}
    </button>
  );
}

export default function SectorHeatmapPanel({
  title = 'Sector Heatmap',
  subtitle,
  heatmap,
  loading = false,
  onJump,
}) {
  const prioritySections = heatmap?.prioritySections || [];
  const others = heatmap?.others || [];
  const hasData = prioritySections.some((s) => s.items.length) || others.length > 0;

  return (
    <section className="dash-table sector-heatmap-panel">
      <header className="dash-table-head">
        <div className="dash-table-title">
          <span>{title}</span>
          {subtitle && <span className="dash-table-count">{subtitle}</span>}
        </div>
      </header>

      <div className="sector-heatmap-scroll">
        {loading && !hasData && <div className="empty-cell">Loading…</div>}
        {!loading && !hasData && <div className="empty-cell">No data.</div>}

        {hasData && (
          <>
            <div className="sector-heatmap-key">
              {prioritySections.map((section) => (
                <div key={section.label} className="sector-heatmap-group">
                  <div className="sector-heatmap-group-label">{section.label}</div>
                  <div className="sector-heatmap-group-chips">
                    {section.items.map((item) => (
                      <SectorChip key={item.label} item={item} onJump={onJump} />
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {others.length > 0 && (
              <div className="sector-heatmap-other">
                <div className="sector-heatmap-other-label">Others</div>
                <div className="sector-heatmap-other-chips">
                  {others.map((item) => (
                    <SectorChip key={item.label} item={item} onJump={onJump} />
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
