import { getSymbol } from './ScreenerTable';

const EMPTY_DEPTH = Array.from({ length: 5 }, () => ({ price: 0, orders: 0, quantity: 0 }));

function formatNumber(value) {
  if (value === undefined || value === null || value === '') return '—';
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: 2 }) : String(value);
}

function formatQty(value) {
  if (value === undefined || value === null || value === '') return '—';
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString('en-IN', { maximumFractionDigits: 0 }) : String(value);
}

function formatTime(ts) {
  if (!ts) return '—';
  const date = new Date(Number(ts) * 1000);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('en-IN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

function dayRangePct(low, high, price) {
  const lo = Number(low);
  const hi = Number(high);
  const ltp = Number(price);
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo || !Number.isFinite(ltp)) return 50;
  return Math.min(100, Math.max(0, ((ltp - lo) / (hi - lo)) * 100));
}

export default function OrderBookPanel({ row }) {
  if (!row) return null;

  const symbol = getSymbol(row);
  const depth = row.depth || {};
  const bids = depth.buy?.length ? depth.buy : EMPTY_DEPTH;
  const offers = depth.sell?.length ? depth.sell : EMPTY_DEPTH;
  const bidTotal = bids.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
  const offerTotal = offers.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
  const prevClose = row.prev_close ?? row.close;
  const rangePct = dayRangePct(row.low, row.high, row.last_price);

  return (
    <section className="symbol-detail-table order-book">
      <header className="order-book-head">
        <h3 className="order-book-symbol">{symbol}</h3>
        <span className="order-book-live">Live</span>
      </header>

      <div className="order-book-depth">
        <table className="depth-table">
          <thead>
            <tr>
              <th colSpan={3} className="depth-bid-head">Bid</th>
              <th colSpan={3} className="depth-offer-head">Offer</th>
            </tr>
            <tr>
              <th>Bid</th>
              <th>Orders</th>
              <th>Qty.</th>
              <th>Offer</th>
              <th>Orders</th>
              <th>Qty.</th>
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 5 }).map((_, index) => {
              const bid = bids[index] || EMPTY_DEPTH[0];
              const offer = offers[index] || EMPTY_DEPTH[0];
              return (
                <tr key={index}>
                  <td className="depth-bid">{formatNumber(bid.price)}</td>
                  <td>{formatQty(bid.orders)}</td>
                  <td>{formatQty(bid.quantity)}</td>
                  <td className="depth-offer">{formatNumber(offer.price)}</td>
                  <td>{formatQty(offer.orders)}</td>
                  <td>{formatQty(offer.quantity)}</td>
                </tr>
              );
            })}
            <tr className="depth-total-row">
              <td colSpan={2}>Total</td>
              <td>{formatQty(bidTotal)}</td>
              <td colSpan={2}>Total</td>
              <td>{formatQty(offerTotal)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="order-book-ohlc">
        <div className="order-book-stat">
          <span>Open</span>
          <strong>{formatNumber(row.open)}</strong>
        </div>
        <div className="order-book-stat">
          <span>Prev. Close</span>
          <strong>{formatNumber(prevClose)}</strong>
        </div>
        <div className="order-book-stat">
          <span>Low</span>
          <strong>{formatNumber(row.low)}</strong>
        </div>
        <div className="order-book-stat">
          <span>High</span>
          <strong>{formatNumber(row.high)}</strong>
        </div>
      </div>

      <div className="order-book-range">
        <div className="order-book-range-track">
          <span className="order-book-range-fill" style={{ width: `${rangePct}%` }} />
          <span className="order-book-range-marker" style={{ left: `${rangePct}%` }} />
        </div>
      </div>

      <div className="order-book-meta">
        <div className="order-book-meta-item">
          <span>Volume</span>
          <strong>{formatQty(row.volume)}</strong>
        </div>
        <div className="order-book-meta-item">
          <span>Avg. price</span>
          <strong>{formatNumber(row.average_price)}</strong>
        </div>
        <div className="order-book-meta-item">
          <span>Lower circuit</span>
          <strong>{formatNumber(row.lower_circuit_limit ?? row.lower_circuit)}</strong>
        </div>
        <div className="order-book-meta-item">
          <span>Upper circuit</span>
          <strong>{formatNumber(row.upper_circuit_limit ?? row.upper_circuit)}</strong>
        </div>
        <div className="order-book-meta-item">
          <span>LTQ</span>
          <strong>{formatQty(row.last_quantity)}</strong>
        </div>
        <div className="order-book-meta-item">
          <span>LTT</span>
          <strong>{formatTime(row.last_trade_time ?? row.timestamp)}</strong>
        </div>
      </div>
    </section>
  );
}
