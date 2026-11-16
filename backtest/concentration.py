"""Sector and size concentration in Rule C (SUMMIT-20): how concentrated it gets, whether that hurt in any
period, and whether a sector cap or a small-cap cap would have helped. Point-in-time universe, after tax,
averaged over 4 monthly rebalance offsets. Output: data/concentration.txt"""
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np
import pandas as pd

import pit
from engine import Config, metrics, prepared, run, size_bucket

RULE_C = Config(universe='pit', ma_exit=200, regime='no_new_buys', entry_breakout=0.10, breakout_days=252,
                buy_rank=30, rank_exit_ma=50)
OFFSETS = (0, 5, 10, 15)
VARIANTS = {
    'Rule C (no cap)': {},
    'sector cap 3': dict(sector_cap=3),
    'sector cap 4': dict(sector_cap=4),
    'sector cap 5': dict(sector_cap=5),
    'sector cap 6': dict(sector_cap=6),
    'small-cap max 3': dict(size_cap=(('small', 3),)),
    'small-cap max 5': dict(size_cap=(('small', 5),)),
    'small-cap max 8': dict(size_cap=(('small', 8),)),
    'sector 5 + small 5': dict(sector_cap=5, size_cap=(('small', 5),)),
}
OUT = Path(__file__).parent / 'data' / 'concentration.txt'


def _one(task):
    name, off, kw = task
    r = run(RULE_C.but(name=name, rebal_offset=off, **kw))
    return name, off, r['nav'], r['trades'], r['holdings']


def pct(x, d=1):
    return '—' if x is None or not np.isfinite(x) else f'{x * 100:.{d}f}%'


def drawdowns(nav, n=6, min_depth=0.10):
    """Largest peak-to-trough falls that do not overlap."""
    out = []
    dd = nav / nav.cummax() - 1
    taken = pd.Series(False, index=nav.index)
    for _ in range(n):
        d = dd.where(~taken)
        if d.min() > -min_depth:
            break
        trough = d.idxmin()
        peak = nav.loc[:trough].idxmax()
        after = nav.loc[trough:]
        rec = after[after >= nav[peak]]
        end = rec.index[0] if len(rec) else nav.index[-1]
        out.append((peak, trough, rec.index[0] if len(rec) else None, nav[trough] / nav[peak] - 1))
        taken.loc[peak:end] = True
    return sorted(out)


def window_ret(s, a, b):
    s = s.dropna()
    a = s.index[s.index.searchsorted(a)]
    b = s.index[min(s.index.searchsorted(b), len(s) - 1)]
    return s[b] / s[a] - 1


def main():
    tasks = [(n, o, kw) for n, kw in VARIANTS.items() for o in OFFSETS]
    with ProcessPoolExecutor(max_workers=3) as ex:
        res = list(ex.map(_one, tasks))
    d = prepared('pit')
    sector = pit.sector_map()
    n500 = d['bench']['NIFTY500']
    lines = []
    w = lines.append

    # ---------- blended NAV per variant (equal parts in the 4 offsets) ----------
    blend, runs = {}, {}
    for name in VARIANTS:
        rs = [r for r in res if r[0] == name]
        runs[name] = rs
        blend[name] = sum(r[2] / r[2].iloc[0] for r in rs) / len(rs)
    base = blend['Rule C (no cap)']
    bench = (n500.reindex(base.index).ffill() / n500.reindex(base.index).ffill().iloc[0])

    # ---------- 1. how concentrated does Rule C get ----------
    w('=' * 100)
    w('1. CONCENTRATION OF RULE C (no cap) at each monthly signal, all 4 offsets pooled')
    w('   Sector = NSE industry (current taxonomy). Size = rank by 60-day median traded value among that')
    w('   month\'s Nifty 500 members: large = top 100, mid = 101-250, small = 251-500 (proxy: no historical market caps).')
    w('=' * 100)
    rows = []
    for _, off, _, _, hold in runs['Rule C (no cap)']:
        for date, syms in hold:
            if not syms:
                continue
            i = d['af'].index.get_loc(date)
            sec = pd.Series([sector.get(s, 'Other') for s in syms]).value_counts()
            size = size_bucket(d, i, RULE_C, syms).reindex(syms).fillna('small').value_counts()
            rows.append({'date': date, 'off': off, 'n': len(syms), 'top_sector': sec.index[0], 'top_n': sec.iloc[0],
                         'sectors': len(sec), 'small': size.get('small', 0), 'mid': size.get('mid', 0),
                         'large': size.get('large', 0)})
    c = pd.DataFrame(rows)
    full = c[c.n >= 10]
    w(f'months with >=10 holdings: {len(full)}')
    w(f'stocks in the biggest sector: median {full.top_n.median():.0f}, 90th pct {full.top_n.quantile(.9):.0f}, max {full.top_n.max()}')
    for k in (5, 6, 8, 10):
        w(f'  months with {k}+ stocks in one sector: {pct((full.top_n >= k).mean(), 0)}')
    w(f'different sectors held: median {full.sectors.median():.0f}, min {full.sectors.min()}')
    sh = full[['small', 'mid', 'large']].div(full.n, axis=0)
    w(f'size mix (avg share of holdings): large {pct(sh.large.mean(), 0)}, mid {pct(sh.mid.mean(), 0)}, small {pct(sh.small.mean(), 0)}')
    w(f'small-cap share: 90th pct {pct(sh.small.quantile(.9), 0)}, max {pct(sh.small.max(), 0)}')
    w('')
    w('Which sector dominated, by year (offset 0, month with the most stocks in one sector):')
    c0 = c[c.off == 0].copy()
    c0['year'] = c0.date.dt.year
    for y, g in c0.groupby('year'):
        top = g.loc[g.top_n.idxmax()]
        w(f'  {y}: {top.top_sector} {top.top_n}/{top.n} ({top.date:%b})  ·  small caps avg {pct((g.small / g.n).mean(), 0)}')

    # ---------- 2. did concentration hurt in any period ----------
    w('')
    w('=' * 100)
    w('2. WORST FALLS OF RULE C (blended NAV) and what it held going in')
    w('=' * 100)
    sig = c[c.off == 0].set_index('date')
    hold0 = dict(runs['Rule C (no cap)'][0][4])
    af = d['af'].ffill(limit=10)
    for peak, trough, rec, depth in drawdowns(base):
        w(f'\n{peak:%Y-%m-%d} -> {trough:%Y-%m-%d}  fall {pct(depth)}  recovered {rec:%Y-%m-%d}' if rec is not None
          else f'\n{peak:%Y-%m-%d} -> {trough:%Y-%m-%d}  fall {pct(depth)}  not recovered')
        w(f'  Nifty 500 same window {pct(window_ret(bench, peak, trough))}')
        for name in VARIANTS:
            if name != 'Rule C (no cap)':
                b = blend[name]
                w(f'  {name:<22} same window {pct(window_ret(b, peak, trough))}')
        before = sig.loc[:peak]
        if len(before):
            r = before.iloc[-1]
            w(f'  holdings at {before.index[-1]:%Y-%m-%d}: {r.n} stocks, top sector {r.top_sector} {r.top_n}, '
              f'{r.sectors} sectors, large/mid/small {r.large}/{r.mid}/{r.small}')
        # approximate loss by sector: equal weight, monthly holdings, offset 0
        contrib = {}
        dates = [dt for dt in hold0 if peak - pd.Timedelta(days=31) <= dt <= trough]
        for a, b in zip(dates, dates[1:] + [trough]):
            syms = hold0[a]
            if not syms or b <= a:
                continue
            r = (af.loc[b, syms] / af.loc[a, syms] - 1).fillna(0)
            for s, v in r.items():
                contrib[sector.get(s, 'Other')] = contrib.get(sector.get(s, 'Other'), 0) + v / len(syms)
        if contrib:
            worst = sorted(contrib.items(), key=lambda kv: kv[1])[:3]
            w('  biggest sector drags (approx. % of portfolio): ' + ', '.join(f'{k} {pct(v)}' for k, v in worst))

    # ---------- 3. variants ----------
    w('')
    w('=' * 100)
    w('3. CAPS vs NO CAP (after tax, mean of 4 offsets; worst 12m = worst rolling-12-month return)')
    w('=' * 100)
    tab = []
    for name in VARIANTS:
        ms = []
        for _, _, nav, tr, _ in runs[name]:
            m = metrics(nav)
            mm = nav.resample('ME').last()
            ms.append({'CAGR': m['CAGR'], 'MaxDD': m['MaxDD'], 'Sharpe': m['Sharpe'], 'Calmar': m['Calmar'],
                       'CAGR16+': metrics(nav.loc['2016':])['CAGR'], 'Worst12m': mm.pct_change(12).min(),
                       'Trades/yr': len(tr) / ((nav.index[-1] - nav.index[0]).days / 365.25)})
        m = pd.DataFrame(ms)
        row = m.mean()
        row['CAGR range'] = f"{m.CAGR.min() * 100:.1f}-{m.CAGR.max() * 100:.1f}"
        tab.append(row.rename(name))
    t = pd.DataFrame(tab)
    for col in ['CAGR', 'MaxDD', 'CAGR16+', 'Worst12m']:
        t[col] = (t[col].astype(float) * 100).round(1)
    for col in ['Sharpe', 'Calmar', 'Trades/yr']:
        t[col] = t[col].astype(float).round(2)
    w(t.to_string())

    # ---------- 4. calendar years ----------
    w('')
    w('=' * 100)
    w('4. CALENDAR-YEAR RETURNS (blended NAV) - difference vs no cap, positive = cap helped')
    w('=' * 100)
    yr = pd.DataFrame({n: b.resample('YE').last().pct_change() for n, b in blend.items()})
    first = {n: b.resample('YE').last().iloc[0] / b.iloc[0] - 1 for n, b in blend.items()}
    yr.iloc[0] = pd.Series(first)
    yb = bench.resample('YE').last()
    yr.insert(0, 'Nifty 500', yb.pct_change().fillna(yb.iloc[0] - 1))
    show = yr[['Nifty 500', 'Rule C (no cap)']].copy()
    for n in VARIANTS:
        if n != 'Rule C (no cap)':
            show[n.replace('sector cap ', 'sec').replace('small-cap max ', 'sm').replace('sector 5 + small 5', 's5+sm5')] = yr[n] - yr['Rule C (no cap)']
    show.index = show.index.year
    w((show * 100).round(1).to_string())

    text = '\n'.join(lines)
    OUT.write_text(text, encoding='utf-8')
    print(text)


if __name__ == '__main__':
    main()
