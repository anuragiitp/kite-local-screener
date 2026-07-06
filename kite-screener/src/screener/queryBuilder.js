import { MARKET_CAP_BUCKETS } from './presets';

export function buildQuery({ screener, marketCapId, sector }) {
  const marketCap = MARKET_CAP_BUCKETS.find((bucket) => bucket.id === marketCapId);
  const parts = [marketCap?.query, sector ? `sector="${sector}"` : '', screener.query];

  return parts.filter(Boolean).join('&');
}

export function buildRequestBody({ screener, marketCapId, sector, limit }) {
  return {
    limit,
    offset: 0,
    query: buildQuery({ screener, marketCapId, sector }),
    order_by: screener.order_by,
    order: screener.order,
  };
}
