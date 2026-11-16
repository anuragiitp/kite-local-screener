"""Point-in-time Nifty 500 universe without survivorship bias.

Prices: NSE daily bhavcopy (every listed stock, incl. later delisted), spliced with Yahoo adjusted
closes where Yahoo still has the stock. Membership: Wayback Machine snapshots of NSE's constituent
CSV, applied as-of (latest snapshot on or before each date, so no look-ahead).
"""
import gzip
import io
import json
import time
import urllib.request
import zipfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
import pandas as pd

from data import fetch_yahoo, load_prices

DATA_DIR = Path(__file__).parent / 'data'
BHAV_DIR = DATA_DIR / 'bhav'
MEM_DIR = DATA_DIR / 'membership'
NSE = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124', 'Referer': 'https://www.nseindia.com/'}
SERIES = {'EQ', 'BE', 'BZ'}
NEW_FORMAT_FROM = pd.Timestamp('2024-07-08')
SNAPSHOT_URLS = [
    'archives.nseindia.com/content/indices/ind_nifty500list.csv',
    'www.nseindia.com/content/indices/ind_nifty500list.csv',
    'www.niftyindices.com/IndexConstituent/ind_nifty500list.csv',
    'www.nseindia.com/content/indices/ind_cnx500list.csv',
]


def _get(url, headers=NSE, timeout=60, tries=3):
    for k in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=timeout) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            time.sleep(3 * (k + 1))
        except Exception:
            time.sleep(3 * (k + 1))
    return None


# ---------- bhavcopy ----------

def _bhav_url(d):
    if d >= NEW_FORMAT_FROM:
        return f"https://nsearchives.nseindia.com/content/cm/BhavCopy_NSE_CM_0_0_0_{d:%Y%m%d}_F_0000.csv.zip"
    mon = d.strftime('%b').upper()
    return f"https://nsearchives.nseindia.com/content/historical/EQUITIES/{d.year}/{mon}/cm{d:%d}{mon}{d.year}bhav.csv.zip"


def _parse_bhav(raw, d):
    z = zipfile.ZipFile(io.BytesIO(raw))
    df = pd.read_csv(z.open(z.namelist()[0]))
    df.columns = [c.strip() for c in df.columns]
    if d >= NEW_FORMAT_FROM:
        df = df.rename(columns={'TckrSymb': 'SYMBOL', 'SctySrs': 'SERIES', 'OpnPric': 'OPEN', 'HghPric': 'HIGH',
                                'LwPric': 'LOW', 'ClsPric': 'CLOSE', 'TtlTradgVol': 'TOTTRDQTY',
                                'TtlTrfVal': 'TOTTRDVAL'})
    df['SERIES'] = df['SERIES'].astype(str).str.strip()
    df = df[df['SERIES'].isin(SERIES)]
    out = df[['SYMBOL', 'OPEN', 'HIGH', 'LOW', 'CLOSE', 'TOTTRDQTY', 'TOTTRDVAL']].copy()
    out['SYMBOL'] = out['SYMBOL'].astype(str).str.strip()
    # a symbol can trade in EQ and BE on the same day only in rare transitions; keep the most traded
    out = out.sort_values('TOTTRDVAL').drop_duplicates('SYMBOL', keep='last')
    out.insert(0, 'date', d)
    return out


def _fetch_day(d):
    raw = _get(_bhav_url(d))
    return None if raw is None else _parse_bhav(raw, d)


def download_bhav(start='2005-01-01', end=None):
    """Download bhavcopies into one pickle per year (re-run resumes missing years / current year)."""
    BHAV_DIR.mkdir(parents=True, exist_ok=True)
    end = pd.Timestamp(end or pd.Timestamp.today().normalize())
    for year in range(pd.Timestamp(start).year, end.year + 1):
        path = BHAV_DIR / f'{year}.pkl'
        if path.exists() and year < end.year:
            continue
        days = pd.bdate_range(max(pd.Timestamp(start), pd.Timestamp(f'{year}-01-01')),
                              min(end, pd.Timestamp(f'{year}-12-31')))
        with ThreadPoolExecutor(max_workers=8) as pool:
            frames = [f for f in pool.map(_fetch_day, days) if f is not None]
        df = pd.concat(frames, ignore_index=True)
        df.to_pickle(path)
        print(year, 'days', df['date'].nunique(), 'rows', len(df))


# ---------- symbols & membership ----------

def _symbol_changes():
    path = MEM_DIR / 'symbolchange.csv'
    if not path.exists():
        MEM_DIR.mkdir(parents=True, exist_ok=True)
        path.write_bytes(_get('https://nsearchives.nseindia.com/content/equities/symbolchange.csv'))
    sc = pd.read_csv(path, encoding='latin1')
    sc.columns = [c.strip() for c in sc.columns]
    sc['old'] = sc['OLD SYMBOL'].astype(str).str.strip()
    sc['new'] = sc['NEW SYMBOL'].astype(str).str.strip()
    sc['eff'] = pd.to_datetime(sc['EFFECTIVE DATE'].astype(str).str.strip(), format='%d-%b-%Y', errors='coerce')
    sc = sc.dropna(subset=['eff']).sort_values('eff')
    changes = {}
    for o, n, e in zip(sc['old'], sc['new'], sc['eff']):
        changes.setdefault(o, []).append((e, n))
    return changes


def canonical(sym, date, changes):
    """Follow renames that happened after `date` to today's symbol (date-aware: handles reused symbols)."""
    for _ in range(10):
        nxt = next(((e, n) for e, n in changes.get(sym, []) if e > date), None)
        if nxt is None:
            return sym
        date, sym = nxt
    return sym


def _read_snapshot(path):
    raw = path.read_bytes()
    if raw[:2] == b'\x1f\x8b':
        raw = gzip.decompress(raw)
    lines = raw.decode('latin1').splitlines()
    h = next(i for i, l in enumerate(lines) if 'symbol' in l.lower())
    df = pd.read_csv(io.StringIO('\n'.join(lines[h:])))
    df.columns = [c.strip() for c in df.columns]
    return df


def download_snapshots():
    MEM_DIR.mkdir(parents=True, exist_ok=True)
    snaps = {}
    for u in SNAPSHOT_URLS:
        q = f'http://web.archive.org/cdx/search/cdx?url={u}&output=json&filter=statuscode:200&collapse=digest&fl=timestamp'
        for (ts,) in json.loads(_get(q, headers={'User-Agent': 'Mozilla/5.0'}, timeout=120))[1:]:
            snaps.setdefault(ts[:8], (ts, u))
    for day, (ts, u) in sorted(snaps.items()):
        path = MEM_DIR / f'{day}.csv'
        if not path.exists():
            raw = _get(f'http://web.archive.org/web/{ts}id_/{u}', headers={'User-Agent': 'Mozilla/5.0'}, timeout=120)
            if raw:
                path.write_bytes(raw)


def load_snapshots():
    """{snapshot date: set of canonical symbols}"""
    changes = _symbol_changes()
    out = {}
    for path in sorted(MEM_DIR.glob('2*.csv')):
        d = pd.Timestamp(path.stem)
        syms = _read_snapshot(path)['Symbol'].dropna().astype(str).str.strip()
        out[d] = {canonical(s, d, changes) for s in syms}
    return out


_SECTORS = None
# old labels with too few overlapping stocks to learn from, or learned wrongly
_SECTOR_FIXES = {
    'CONSUMER DURABLES': 'Consumer Durables', 'CYCLES': 'Automobile and Auto Components',
    'DETERGENTS': 'Fast Moving Consumer Goods', 'PAPER': 'Forest Materials',
    'PAPER AND PAPER PRODUCTS': 'Forest Materials', 'PRINTING AND PUBLISHING': 'Media Entertainment & Publication',
    'PETROCHEMICALS': 'Chemicals', 'TEXTILE PRODUCTS': 'Textiles',
}


def sector_map():
    """{canonical symbol: sector} in NSE's current taxonomy, from each symbol's latest snapshot.

    Older snapshots use older NSE industry names; each old label is mapped to the current sector most
    stocks with that old label carry in the latest snapshot that lists them under the current taxonomy.
    """
    global _SECTORS
    if _SECTORS is not None:
        return _SECTORS
    changes = _symbol_changes()
    rows = []
    for path in sorted(MEM_DIR.glob('2*.csv')):
        d = pd.Timestamp(path.stem)
        df = _read_snapshot(path)
        if 'Industry' not in df:
            continue
        for s, ind in zip(df['Symbol'].astype(str).str.strip(), df['Industry'].astype(str).str.strip()):
            rows.append((canonical(s, d, changes), d, ind))
    snap = pd.DataFrame(rows, columns=['sym', 'date', 'label'])
    newest = set(snap.loc[snap['date'] == snap['date'].max(), 'label'])
    by_date = snap.groupby('date')['label'].agg(set)
    modern = set().union(*[labs for labs in by_date if len(labs & newest) >= 0.8 * len(labs)])
    latest = snap.sort_values('date').groupby('sym').tail(1).set_index('sym')['label']
    new_of = snap[snap['label'].isin(modern)].sort_values('date').groupby('sym').tail(1).set_index('sym')['label']
    pairs = snap[~snap['label'].isin(modern)].join(new_of.rename('new'), on='sym').dropna(subset=['new'])
    learned = pairs.groupby('label')['new'].agg(lambda s: s.value_counts().index[0]).to_dict()
    learned.update(_SECTOR_FIXES)
    _SECTORS = {s: (lab if lab in modern else learned.get(lab, 'Other')) for s, lab in latest.items()}
    return _SECTORS


# ---------- price panel ----------


NICE = sorted({a / b for a in range(1, 11) for b in range(1, 11) if a != b} | {1 / 20, 1 / 50, 1 / 100, 20, 50, 100})
ETF_PATTERN = r'BEES|ETF|GOLD|SILVER|NIFTY|SENSEX|LIQUID|NV20|^MON100|^MAFANG|^MAN50|^N100|^ICICI|^SBI(?!N)|^UTI|^HDFC(?!BANK|LIFE|AMC)'


def _adjust_bhav(close, volume):
    """Detect unadjusted splits/bonuses in raw bhavcopy closes; return adjustment factor per day.

    NSE daily price bands make genuine single-day moves beyond ~-40%/+70% rare, so a move that sits on a
    simple ratio (1/2, 1/5, 2/3, ...) with share volume scaling inversely is treated as a corporate action.
    """
    r = close / close.shift(1)
    factor = pd.Series(1.0, index=close.index)
    for d in r.index[(r < 0.62) | (r > 1.6)]:
        x = r[d]
        f = min(NICE, key=lambda n: abs(np.log(x / n)))
        if abs(np.log(x / f)) > 0.08:
            continue
        i = close.index.get_loc(d)
        before = volume.iloc[max(0, i - 60):i].median()
        after = volume.iloc[i:i + 20].median()
        if before > 0 and after > 0 and after / before >= 0.5 / f:
            factor[d] = f
    # factor f on day d: prices before d must be multiplied by f
    return factor.iloc[::-1].cumprod().iloc[::-1].shift(-1).fillna(1.0)


def build_panel(refresh=False):
    cache = DATA_DIR / 'pit_panel.pkl'
    if cache.exists() and not refresh:
        return pd.read_pickle(cache)
    changes = _symbol_changes()
    bhav = pd.concat([pd.read_pickle(p) for p in sorted(BHAV_DIR.glob('*.pkl'))], ignore_index=True)
    keys = bhav[['SYMBOL', 'date']].drop_duplicates()
    keys['canon'] = [canonical(s, d, changes) for s, d in zip(keys['SYMBOL'], keys['date'])]
    bhav = bhav.merge(keys, on=['SYMBOL', 'date'])
    bhav = bhav.sort_values('TOTTRDVAL').drop_duplicates(['canon', 'date'], keep='last')
    # keep every past member plus anything that was ever a top-700 stock by yearly traded value
    yr = bhav.groupby([bhav['date'].dt.year, 'canon'])['TOTTRDVAL'].median()
    liquid = set(yr[yr.groupby(level=0).rank(ascending=False) <= 700].index.get_level_values(1))
    keep = liquid | set().union(*load_snapshots().values())
    bhav = bhav[bhav['canon'].isin(keep)]
    print('panel symbols', bhav['canon'].nunique(), flush=True)

    def wide(col):
        return bhav.pivot(index='date', columns='canon', values=col).sort_index().astype('float64')

    close, opn, high, low = wide('CLOSE'), wide('OPEN'), wide('HIGH'), wide('LOW')
    vol, tval = wide('TOTTRDQTY'), wide('TOTTRDVAL')
    close = close.where(close > 0)

    bhav_adj = pd.DataFrame({s: close[s] * _adjust_bhav(close[s].dropna(), vol[s].reindex(close[s].dropna().index))
                             .reindex(close.index) for s in close.columns})
    # return vs last traded close, so moves across suspensions/holidays are not lost
    bhav_ret = bhav_adj / bhav_adj.ffill().shift(1) - 1

    # Yahoo adjusted closes (dividends + splits) for every symbol Yahoo still carries
    print('bhav adjusted; fetching Yahoo', flush=True)
    yahoo = load_prices()['adjclose']
    need = [s for s in close.columns if s not in yahoo.columns]
    extra = _yahoo_many(need)
    yahoo = pd.concat([yahoo, extra], axis=1).reindex(close.index)
    yahoo = yahoo.reindex(columns=close.columns).where(close.notna())
    y_ret = yahoo / yahoo.ffill().shift(1) - 1

    agree = (y_ret - bhav_ret).abs() <= 0.02
    pick_y = y_ret.notna() & (bhav_ret.isna() | agree | (y_ret.abs() < bhav_ret.abs()))
    ret = bhav_ret.where(~pick_y, y_ret)
    # rebuild a price index anchored on the first bhav close
    traded = close.notna()
    af = (1 + ret.fillna(0)).cumprod()
    first = close.apply(lambda s: s.first_valid_index())
    for s in af.columns:
        if first[s] is not None:
            af[s] = af[s] / af.at[first[s], s] * close.at[first[s], s]
    af = af.where(traded)
    panel = {
        'adjclose': af,
        'open': af * opn / close,
        'high': af * high / close,
        'low': af * low / close,
        'close': close,
        'volume': vol,
        'tval': tval,
        'yahoo_cov': yahoo.notna().mean(),
    }
    pd.to_pickle(panel, cache)
    return panel


def _yahoo_many(symbols):
    cache = DATA_DIR / 'yahoo_extra.pkl'
    have = pd.read_pickle(cache) if cache.exists() else pd.DataFrame()
    todo = [s for s in symbols if s not in have.columns]
    if todo:
        got = {}
        with ThreadPoolExecutor(max_workers=6) as pool:
            for s, df in zip(todo, pool.map(lambda s: fetch_yahoo(f'{s}.NS'), todo)):
                if df is not None and len(df):
                    got[s] = df['adjclose']
        have = pd.concat([have, pd.DataFrame(got)], axis=1).sort_index()
        have.attrs['tried'] = sorted(set(have.attrs.get('tried', [])) | set(todo))
        pd.to_pickle(have, cache)
    return have


def universe_masks(index):
    """Boolean date x symbol masks: 'snap' = as-of Wayback membership, 'today' = current list."""
    snaps = load_snapshots()
    dates = sorted(snaps)
    syms = sorted(set().union(*snaps.values()))
    snap = pd.DataFrame(False, index=index, columns=syms)
    for k, d in enumerate(dates):
        end = dates[k + 1] if k + 1 < len(dates) else index[-1] + pd.Timedelta(days=1)
        rows = (index >= d) & (index < end)
        snap.loc[rows, list(snaps[d])] = True
    # before the first snapshot, use the first snapshot (only affects warm-up history, not trading)
    snap.loc[index < dates[0], list(snaps[dates[0]])] = True
    today = pd.DataFrame(False, index=index, columns=syms)
    today.loc[:, list(snaps[dates[-1]])] = True
    return {'snap': snap, 'today': today}


def non_etf(symbols):
    """Symbols that are not ETFs/index funds (members of any snapshot are always kept)."""
    members = set().union(*load_snapshots().values())
    s = pd.Index(symbols)
    return pd.Series(s.isin(members) | ~s.str.contains(ETF_PATTERN, regex=True), index=s)


if __name__ == '__main__':
    download_snapshots()
    download_bhav()
    p = build_panel(refresh=True)
    print('symbols', p['adjclose'].shape[1], 'days', p['adjclose'].shape[0])
