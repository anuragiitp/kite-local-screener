import { getMarketCapBucket } from '../screener/presets';

export default function MarketCapTag({ marketCap }) {
  const bucket = getMarketCapBucket(marketCap);
  if (!bucket) return null;

  return (
    <span className={`cap-tag cap-tag-${bucket.id}`} title={`${bucket.label} cap`}>
      {bucket.label}
    </span>
  );
}
