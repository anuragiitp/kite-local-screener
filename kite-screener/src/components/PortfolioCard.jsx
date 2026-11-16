import { useMemo } from 'react';
import { applyTickToHolding, applyTickToPosition } from '../screener/positions';

const EQUITY_EXCHANGES = new Set(['NSE', 'BSE']);

function upper(value) {
  return String(value || '').trim().toUpperCase();
}

// Holdings can be listed on BSE while the row is NSE, so equities also match by symbol.
function matchesRow(item, symbol, exchange, token) {
  const itemToken = Number(item.instrument_token);
  if (token > 0 && itemToken === token) return true;
  return EQUITY_EXCHANGES.has(upper(item.exchange))
    && EQUITY_EXCHANGES.has(exchange)
    && upper(item.tradingsymbol) === symbol;
}

function formatAmount(value) {
  const abs = Math.abs(value);
  return abs.toLocaleString('en-IN', {
    minimumFractionDigits: abs >= 1000 ? 0 : 2,
    maximumFractionDigits: abs >= 1000 ? 0 : 2,
  });
}

function formatPrice(value) {
  return Number(value).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function signed(value) {
  if (!Number.isFinite(value) || value === 0) return formatAmount(0);
  return `${value > 0 ? '▲' : '▼'} ${formatAmount(value)}`;
}

function tone(value) {
  if (!Number.isFinite(value) || value === 0) return '';
  return value > 0 ? 'cell-up' : 'cell-down';
}

function Pct({ value }) {
  if (value == null || !Number.isFinite(value)) return null;
  return <span className="portfolio-pct">{`${Math.abs(value).toFixed(1)}%`}</span>;
}

export default function PortfolioCard({ symbol, row, portfolio }) {
  const exchange = upper(row?.exchange || row?.segment);
  const token = Number(row?.instrument_token) || 0;
  const key = upper(symbol);

  const { holdings, positions } = useMemo(() => {
    if (!key || exchange === 'INDICES') return { holdings: [], positions: [] };
    return {
      holdings: (portfolio?.holdings || []).filter((item) => matchesRow(item, key, exchange, token)),
      positions: (portfolio?.positions || []).filter((item) => matchesRow(item, key, exchange, token)),
    };
  }, [portfolio, key, exchange, token]);

  if (!holdings.length && !positions.length) return null;

  const ltp = Number(row?.last_price);
  const tick = Number.isFinite(ltp) && ltp > 0 ? { last_price: ltp } : null;

  return (
    <section className="symbol-detail-table portfolio-card">
      {holdings.map((raw) => {
        const holding = tick ? applyTickToHolding(raw, tick) : raw;
        const extras = [
          holding.t1_quantity > 0 ? `T1 ${holding.t1_quantity}` : '',
          holding.collateral_quantity > 0 ? `Pledged ${holding.collateral_quantity}` : '',
        ].filter(Boolean).join(' · ');
        return (
          <div className="portfolio-block" key={`h-${raw.exchange}-${raw.tradingsymbol}`}>
            <div className="portfolio-block-head" title={extras || undefined}>
              <span>Holding</span>
              <strong>{holding.holding_quantity} qty</strong>
            </div>
            <table className="symbol-detail-mini-table portfolio-table">
              <tbody>
                <tr>
                  <td>Avg</td>
                  <td>{formatPrice(holding.average_price)}</td>
                </tr>
                <tr title={`Invested ${formatAmount(holding.invested)}`}>
                  <td>Value</td>
                  <td>{formatAmount(holding.current_value)}</td>
                </tr>
                <tr>
                  <td>P&amp;L</td>
                  <td className={tone(holding.pnl)}>
                    {signed(holding.pnl)} <Pct value={holding.change_percent} />
                  </td>
                </tr>
                {holding.close_price > 0 && (
                  <tr>
                    <td>Day</td>
                    <td className={tone(holding.day_pnl)}>
                      {signed(holding.day_pnl)} <Pct value={holding.day_change_percent} />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        );
      })}

      {positions.map((raw) => {
        const position = tick && raw.is_open ? applyTickToPosition(raw, tick) : raw;
        const qty = position.quantity;
        return (
          <div className="portfolio-block" key={`p-${raw.exchange}-${raw.tradingsymbol}-${raw.product}`}>
            <div className="portfolio-block-head">
              <span>{`Position · ${position.product || '—'}`}</span>
              {position.is_open ? (
                <strong className={qty > 0 ? 'cell-up' : 'cell-down'} title={qty > 0 ? 'Long' : 'Short'}>
                  {`${qty > 0 ? '+' : ''}${qty}`}
                </strong>
              ) : (
                <strong className="portfolio-closed">Closed</strong>
              )}
            </div>
            <table className="symbol-detail-mini-table portfolio-table">
              <tbody>
                {position.is_open && (
                  <tr>
                    <td>Avg</td>
                    <td>{formatPrice(position.average_price)}</td>
                  </tr>
                )}
                <tr>
                  <td>{position.is_open ? 'P&L' : 'Realised'}</td>
                  <td className={tone(position.pnl)}>{signed(position.pnl)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        );
      })}
    </section>
  );
}
