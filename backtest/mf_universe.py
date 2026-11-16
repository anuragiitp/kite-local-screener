"""Mutual-fund universe for the MF screener: Kite (Coin) buyable Direct-Growth funds joined with AMFI SEBI categories,
NAV history from mfapi.in -> returns / risk metrics. Outputs data/mf_universe.csv and data/mf_shortlist.txt"""
import io
import json
import re
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
import pandas as pd
import requests

DATA = Path(__file__).parent / 'data'
NAV_DIR = DATA / 'mf_nav'
UA = {'User-Agent': 'Mozilla/5.0'}
SKIP_GROUPS = ('Debt Scheme', 'Solution Oriented', 'Children', 'Retirement', 'Interval', 'Close Ended', 'Income')
TOP_PER_CATEGORY = 5


def kite_instruments():
    r = requests.get('https://api.kite.trade/mf/instruments', headers=UA, timeout=60)
    r.raise_for_status()
    df = pd.read_csv(io.StringIO(r.text))
    return df[(df.purchase_allowed == 1) & (df.plan == 'direct') & (df.dividend_type == 'growth')]


def amfi_schemes():
    text = requests.get('https://www.amfiindia.com/spages/NAVAll.txt', headers=UA, timeout=60).text
    rows, cat, amc = [], None, None
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith('Scheme Code'):
            continue
        parts = line.split(';')
        if len(parts) >= 6:
            rows.append({'code': int(parts[0]), 'isin': parts[1], 'isin2': parts[2], 'amfi_name': parts[3],
                         'category_full': cat, 'fund_house': amc})
        elif '(' in line and line.endswith(')'):
            cat = line
        else:
            amc = line
    df = pd.DataFrame(rows)
    m = df.category_full.str.extract(r'^(?P<type>[^()]+)\((?P<cat>.*)\)$')
    df['scheme_type'] = m['type'].str.strip()
    df['category'] = m['cat'].str.strip()
    df['group'] = df.category.str.split(' - ').str[0].str.replace(r'[\s*]+$', '', regex=True).str.replace(r'Schemes$', 'Scheme', regex=True)
    df['sub_category'] = df.category.str.split(' - ', n=1).str[1].str.replace(r'\s+', ' ', regex=True).str.strip()
    df['sub_category'] = df.sub_category.fillna(df.group)
    return df


def nav_history(code):
    f = NAV_DIR / f'{code}.json'
    if f.exists() and (pd.Timestamp.now() - pd.Timestamp(f.stat().st_mtime, unit='s')).days < 3:
        js = json.loads(f.read_text())
    else:
        for attempt in range(5):
            r = requests.get(f'https://api.mfapi.in/mf/{code}', headers=UA, timeout=60)
            if r.status_code == 200:
                break
            time.sleep(2 ** attempt)
        r.raise_for_status()
        js = r.json()
        f.write_text(json.dumps(js))
    s = pd.Series({pd.to_datetime(x['date'], format='%d-%m-%Y'): float(x['nav']) for x in js.get('data', [])})
    return s.sort_index()


def metrics(s):
    out = {}
    if len(s) < 30:
        return out
    end = s.index[-1]
    out['nav'] = s.iloc[-1]
    out['nav_date'] = end.date()
    out['inception'] = s.index[0].date()
    for label, yrs in (('1y', 1), ('3y', 3), ('5y', 5), ('10y', 10)):
        start = end - pd.DateOffset(years=yrs)
        if s.index[0] <= start + pd.Timedelta(days=7):
            base = s.loc[:start].iloc[-1]
            out[f'ret_{label}'] = (s.iloc[-1] / base) ** (1 / yrs) - 1
    w = s.loc[end - pd.DateOffset(years=3):]
    r = w.resample('W').last().pct_change().dropna()
    if len(r) > 50:
        out['vol_3y'] = r.std() * np.sqrt(52)
        out['sharpe_3y'] = (out.get('ret_3y', np.nan) - 0.065) / out['vol_3y']
    w5 = s.loc[end - pd.DateOffset(years=5):]
    out['maxdd_5y'] = (w5 / w5.cummax() - 1).min()
    out['since_jul24'] = s.iloc[-1] / s.loc[:'2024-06-30'].iloc[-1] - 1 if s.index[0] <= pd.Timestamp('2024-06-30') else np.nan
    return out


def main():
    NAV_DIR.mkdir(parents=True, exist_ok=True)
    kite = kite_instruments()
    amfi = amfi_schemes()
    by_isin = pd.concat([amfi.set_index('isin'), amfi[amfi.isin2.str.startswith('INF')].set_index('isin2')])
    by_isin = by_isin[~by_isin.index.duplicated()]
    u = kite.drop(columns='scheme_type').join(by_isin[['code', 'amfi_name', 'fund_house', 'scheme_type', 'category', 'group', 'sub_category']],
                  on='tradingsymbol', how='inner')
    print(f'Kite direct-growth buyable: {len(kite)}; matched to AMFI: {len(u)}')
    print(u.groupby('group').size().sort_values(ascending=False).to_string())
    keep = u[(u.scheme_type == 'Open Ended Schemes') & ~u.category.str.contains('|'.join(SKIP_GROUPS), na=True)]
    keep = keep.drop_duplicates('code')
    print(f'Fetching NAV history for {len(keep)} schemes')

    def work(code):
        try:
            return code, metrics(nav_history(code))
        except Exception as e:      # one bad scheme must not stop the run
            return code, {'error': str(e)[:80]}

    with ThreadPoolExecutor(max_workers=4) as pool:
        res = dict(pool.map(work, keep.code))
    errs = [c for c, v in res.items() if 'error' in v]
    print(f'NAV errors: {len(errs)}', errs[:5], res[errs[0]] if errs else '')
    m = pd.DataFrame.from_dict(res, orient='index')
    df = keep.join(m, on='code')
    df = df[df.nav_date.notna() & (pd.to_datetime(df.nav_date) >= pd.Timestamp.now() - pd.Timedelta(days=10))]
    cols = ['tradingsymbol', 'code', 'amfi_name', 'fund_house', 'group', 'sub_category', 'minimum_purchase_amount',
            'nav', 'nav_date', 'inception', 'ret_1y', 'ret_3y', 'ret_5y', 'ret_10y', 'vol_3y', 'sharpe_3y', 'maxdd_5y', 'since_jul24']
    df = df[cols].rename(columns={'tradingsymbol': 'isin', 'code': 'amfi_code', 'amfi_name': 'name', 'minimum_purchase_amount': 'min_sip_lumpsum'})
    df.sort_values(['group', 'sub_category', 'ret_5y'], ascending=[True, True, False]).to_csv(DATA / 'mf_universe.csv', index=False)

    lines = [f'MF shortlist: Kite-buyable Direct Growth, AMFI category, NAV {df.nav_date.max()}. '
             f'Ranked by 3y Sharpe among funds with 5y history (rf 6.5%). Past returns only - no AUM/TER/portfolio data.', '']
    p = lambda x: '' if pd.isna(x) else f'{x * 100:5.1f}%'
    for (g, sc), grp in df.groupby(['group', 'sub_category']):
        old = grp[grp.ret_5y.notna()].sort_values('sharpe_3y', ascending=False)
        if old.empty:
            continue
        lines.append(f'== {g} - {sc} ({len(grp)} funds, {len(old)} with 5y) ==')
        for _, r in old.head(TOP_PER_CATEGORY).iterrows():
            name = re.sub(r'\s*-\s*Direct.*$', '', r['name'], flags=re.I)
            lines.append(f"  {name[:60]:60} {r['isin']}  1y {p(r.ret_1y)} 3y {p(r.ret_3y)} 5y {p(r.ret_5y)} "
                         f"vol {p(r.vol_3y)} DD5y {p(r.maxdd_5y)} Sh {r.sharpe_3y:4.2f}")
        lines.append('')
    (DATA / 'mf_shortlist.txt').write_text('\n'.join(lines), encoding='utf-8')
    print('\n'.join(lines))


if __name__ == '__main__':
    main()
