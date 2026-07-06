import { bookmarkKey } from '../screener/bookmarks';
import { INDEX_SHORTCUTS } from '../screener/indexShortcuts';

function formatPrice(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatChange(change) {
  const c = Number(change);
  if (!Number.isFinite(c)) return '';
  const sign = c > 0 ? '+' : '';
  return `${sign}${c.toFixed(2)}`;
}

function formatPercent(changePercent, change) {
  const p = Number(changePercent);
  if (!Number.isFinite(p)) return '';
  const c = Number(change);
  const sign = (Number.isFinite(c) ? c : p) > 0 ? '+' : '';
  return `(${sign}${p.toFixed(2)}%)`;
}

function tone(change) {
  const n = Number(change);
  if (!Number.isFinite(n) || n === 0) return '';
  return n > 0 ? ' up' : ' down';
}

export default function IndexTicker({ quotes = {}, liveTicks = {}, tokensById = {} }) {
  return (
    <div className="index-ticker" aria-label="Live index tracker">
      {INDEX_SHORTCUTS.map((item) => {
        const key = bookmarkKey(item);
        const quote = quotes[key];
        const token = tokensById[item.id];
        const tick = token ? liveTicks[token] : null;

        const lastPrice = tick?.last_price ?? quote?.lastPrice;
        const change = tick?.change ?? quote?.netChange;
        const changePercent = tick?.change_percent ?? quote?.changePercent;
        const changeTone = tone(change ?? changePercent);
        const pctText = formatPercent(changePercent, change);

        return (
          <div key={item.id} className="index-ticker-item">
            <span className="index-ticker-name">
              <span className="index-ticker-label">{item.displayName}</span>
              {pctText && (
                <strong className={`index-ticker-pct${changeTone}`}>{pctText}</strong>
              )}
            </span>
            <div className="index-ticker-values">
              <span className={`index-ticker-price${changeTone}`}>{formatPrice(lastPrice)}</span>
              {formatChange(change) && (
                <span className="index-ticker-change">{formatChange(change)}</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
