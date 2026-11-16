"""Download and cache Nifty 500 constituents + daily prices (Yahoo chart API)."""
import json
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pandas as pd

DATA_DIR = Path(__file__).parent / 'data'
UA = {'User-Agent': 'Mozilla/5.0'}
NIFTY500_URL = 'https://archives.nseindia.com/content/indices/ind_nifty500list.csv'
BENCHMARKS = {'NIFTY500': '^CRSLDX', 'NIFTY50': '^NSEI'}
EXTRA_INDICES = {'NEXT50': '^NSMIDCP', 'MIDCAP50': '^NSEMDCP50', 'SMALLCAP250': 'NIFTYSMLCAP250.NS'}
START = '2005-01-01'


def _get(url, timeout=30):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def load_universe():
    path = DATA_DIR / 'nifty500.csv'
    if not path.exists():
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        path.write_bytes(_get(NIFTY500_URL))
    return pd.read_csv(path)


def fetch_yahoo(ticker, start=START):
    p1 = int(pd.Timestamp(start).timestamp())
    p2 = int(time.time())
    url = (f'https://query1.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(ticker)}'
           f'?period1={p1}&period2={p2}&interval=1d&events=div%2Csplit&includeAdjustedClose=true')
    payload = None
    for attempt in range(4):
        try:
            payload = json.loads(_get(url))
            break
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            time.sleep(2 * (attempt + 1))
        except Exception:
            time.sleep(2 * (attempt + 1))
    result = (payload or {}).get('chart', {}).get('result')
    if not result or not result[0].get('timestamp'):
        return None
    r = result[0]
    quote = r['indicators']['quote'][0]
    adj = (r['indicators'].get('adjclose') or [{}])[0].get('adjclose') or quote['close']
    idx = (pd.to_datetime(r['timestamp'], unit='s', utc=True)
           .tz_convert('Asia/Kolkata').normalize().tz_localize(None))
    df = pd.DataFrame({
        'open': quote['open'], 'high': quote['high'], 'low': quote['low'],
        'close': quote['close'], 'volume': quote['volume'], 'adjclose': adj,
    }, index=idx, dtype='float64')
    df = df[~df.index.duplicated(keep='last')].dropna(subset=['close', 'adjclose'])
    return df[df['close'] > 0]


def load_indices(refresh=False):
    cache = DATA_DIR / 'indices.pkl'
    if cache.exists() and not refresh:
        return pd.read_pickle(cache)
    frames = {name: fetch_yahoo(tk) for name, tk in EXTRA_INDICES.items()}
    out = pd.DataFrame({n: df['close'] for n, df in frames.items() if df is not None}).sort_index()
    pd.to_pickle(out, cache)
    return out


def load_prices(refresh=False):
    """Return dict of wide DataFrames: adjclose, open, high, low (adjusted), close, volume; plus benchmarks."""
    cache = DATA_DIR / 'prices.pkl'
    if cache.exists() and not refresh:
        return pd.read_pickle(cache)

    universe = load_universe()
    symbols = universe['Symbol'].dropna().astype(str).str.strip().tolist()
    tickers = {sym: f'{sym}.NS' for sym in symbols}

    frames = {}
    with ThreadPoolExecutor(max_workers=6) as pool:
        for sym, df in zip(tickers, pool.map(fetch_yahoo, tickers.values())):
            if df is not None and len(df) > 0:
                frames[sym] = df
    bench = {name: fetch_yahoo(tk) for name, tk in BENCHMARKS.items()}

    def wide(field):
        return pd.DataFrame({sym: df[field] for sym, df in frames.items()}).sort_index()

    close = wide('close')
    adj = wide('adjclose')
    factor = adj / close
    panels = {
        'adjclose': adj,
        'close': close,
        'volume': wide('volume'),
        'open': wide('open') * factor,
        'high': wide('high') * factor,
        'low': wide('low') * factor,
        'bench': pd.DataFrame({n: b['close'] for n, b in bench.items() if b is not None}).sort_index(),
        'sectors': universe.set_index('Symbol')['Industry'].to_dict(),
        'missing': sorted(set(symbols) - set(frames)),
    }
    pd.to_pickle(panels, cache)
    return panels


if __name__ == '__main__':
    p = load_prices(refresh=True)
    adj = p['adjclose']
    print(f"stocks: {adj.shape[1]}, days: {adj.shape[0]}, {adj.index[0].date()} .. {adj.index[-1].date()}")
    print('missing:', p['missing'])
    print('benchmarks:', {c: str(p['bench'][c].first_valid_index().date()) for c in p['bench']})
    first = adj.apply(lambda s: s.first_valid_index())
    print('listed by year:', first.dt.year.value_counts().sort_index().to_dict())
