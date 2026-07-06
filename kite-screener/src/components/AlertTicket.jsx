import { useEffect, useMemo, useState } from 'react';
import { buildAlert, createAlert } from '../screener/alerts';
import { ALERT_OPERATORS } from '../screener/alertSafety';
import { hasSession } from '../screener/kiteApi';

const ALERT_ATTRIBUTE = 'LastTradedPrice';

export default function AlertTicket({ symbol, exchange, row, onClose }) {
  const [operator, setOperator] = useState('>=');
  const [price, setPrice] = useState('');
  const [creating, setCreating] = useState(false);
  const [result, setResult] = useState(null);

  const ltp = Number(row?.last_price) || 0;

  useEffect(() => {
    setPrice('');
    setResult(null);
  }, [symbol, exchange]);

  useEffect(() => {
    if (ltp > 0 && !price) {
      setPrice(String(ltp));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ltp, symbol]);

  const draft = useMemo(
    () => buildAlert({
      exchange,
      tradingsymbol: symbol,
      lhs_attribute: ALERT_ATTRIBUTE,
      operator,
      rhs_constant: price,
    }),
    [exchange, symbol, operator, price],
  );

  const disabled = !hasSession() || creating || !symbol;

  const submit = async () => {
    if (disabled) return;
    setCreating(true);
    setResult(null);
    const response = await createAlert(draft);
    setCreating(false);
    setResult(response);
  };

  return (
    <section className="alert-ticket">
      <header className="alert-ticket-head">
        <div className="alert-ticket-title">
          <span className="alert-ticket-symbol">{symbol}</span>
          <span className="alert-ticket-exchange">{exchange}</span>
        </div>
        <span className="alert-ticket-ltp">LTP {ltp > 0 ? ltp.toLocaleString('en-IN') : '—'}</span>
        {onClose && (
          <button
            type="button"
            className="order-ticket-close"
            onClick={onClose}
            title="Hide alert panel"
            aria-label="Hide alert panel"
          >
            ×
          </button>
        )}
      </header>

      <div className="alert-ticket-rule">
        <span className="alert-ticket-if">If</span>
        <span className="alert-ticket-field">Last price</span>
        <span className="alert-ticket-of">of {symbol}</span>
        <span className="alert-ticket-is">is</span>
        <select
          className="alert-ticket-select alert-ticket-select-op"
          value={operator}
          onChange={(event) => setOperator(event.target.value)}
          aria-label="Alert operator"
        >
          {ALERT_OPERATORS.map((value) => (
            <option key={value} value={value}>{value}</option>
          ))}
        </select>
        <span className="alert-ticket-than">than</span>
        <input
          type="number"
          className="alert-ticket-price"
          min="0"
          step="0.05"
          value={price}
          onChange={(event) => setPrice(event.target.value)}
          onClick={(event) => event.target.select()}
          aria-label="Alert price"
        />
      </div>

      <div className="alert-ticket-actions">
        <button
          type="button"
          className="alert-create-btn"
          onClick={submit}
          disabled={disabled}
        >
          {creating ? 'Creating…' : 'Create alert'}
        </button>
      </div>

      {result && (
        <div className={`order-ticket-result ${result.ok ? 'ok' : 'fail'}`}>
          {result.ok
            ? `✓ ${result.message}${result.alertId ? ` (${result.alertId})` : ''}`
            : `✕ ${result.message}`}
        </div>
      )}
    </section>
  );
}
