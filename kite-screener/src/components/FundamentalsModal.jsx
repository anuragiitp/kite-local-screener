import { useEffect } from 'react';

export function buildTijoriFundamentalsUrl(exchange, symbol) {
  const ex = encodeURIComponent(exchange || 'NSE');
  const sym = encodeURIComponent(symbol || '');
  return `https://zstocks.tijorifinance.com/markets/stocks/${ex}/${sym}/?source=kite&theme=default&v=1`;
}

export function buildStreakTechnicalsUrl(exchange, symbol) {
  const stock = encodeURIComponent(`${exchange || 'NSE'}:${symbol || ''}`);
  return `https://technicalwidget.streak.tech/?utm_source=context-menu&utm_medium=kite&stock=${stock}&theme=default`;
}

export default function FundamentalsModal({
  symbol,
  exchange,
  provider = 'Tijori Finance',
  url,
  open,
  onClose,
}) {
  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose?.();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open || !symbol || !url) return null;

  return (
    <div className="fundamentals-modal-overlay" role="dialog" aria-modal="true" aria-label={`${symbol} ${provider}`}>
      <div className="fundamentals-modal-backdrop" onClick={onClose} />
      <div className="fundamentals-modal-panel">
        <header className="fundamentals-modal-head">
          <div>
            <h3 className="fundamentals-modal-title">{symbol}</h3>
            <span className="fundamentals-modal-subtitle">{exchange} · {provider}</span>
          </div>
          <button
            type="button"
            className="fundamentals-modal-close"
            onClick={onClose}
            title="Close"
            aria-label={`Close ${provider}`}
          >
            ×
          </button>
        </header>
        <iframe
          title={`${symbol} on ${provider}`}
          className="fundamentals-modal-frame"
          src={url}
          loading="lazy"
        />
      </div>
    </div>
  );
}
