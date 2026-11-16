"""Run pre-registered momentum variants on the Nifty 500 universe and print comparison tables."""
import sys

import numpy as np
import pandas as pd

from engine import Config, benchmark, equal_weight_universe, metrics, prepared, run

BASE = Config()

VARIANTS = [
    # exits
    BASE.but(name='E0 rank>40 (base)'),
    BASE.but(name='E1 rank>20 (no buffer)', exit_rank=20),
    BASE.but(name='E2 rank>30', exit_rank=30),
    BASE.but(name='E3 rank>60', exit_rank=60),
    BASE.but(name='E4 trail stop 20%', stop='trail', stop_pct=0.20),
    BASE.but(name='E5 trail stop 30%', stop='trail', stop_pct=0.30),
    BASE.but(name='E6 fixed stop 10%', stop='fixed', stop_pct=0.10),
    BASE.but(name='E7 chandelier 3xATR', stop='chandelier', atr_mult=3.0),
    BASE.but(name='E8 daily close<MA100', stop='ma', stop_ma=100),
    BASE.but(name='E9 month-end <MA100', ma_exit=100),
    BASE.but(name='E10 month-end <MA200', ma_exit=200),
    # market regime
    BASE.but(name='R1 no new buys idx<200DMA', regime='no_new_buys'),
    BASE.but(name='R2 all cash idx<200DMA', regime='cash'),
    # entry / score
    BASE.but(name='S1 no skip-month (12-0/6-0)', skip=0),
    BASE.but(name='S2 + smoothness 0.5', smooth_w=0.5),
    BASE.but(name='S3 + 52W-high 0.5', high52_w=0.5),
    BASE.but(name='S4 top 30, exit>60', top_n=30, exit_rank=60),
]

SUBPERIODS = [('2007-01', '2010-12'), ('2011-01', '2014-12'), ('2015-01', '2018-12'),
              ('2019-01', '2022-12'), ('2023-01', '2026-12')]


def fmt(df):
    pct = ['CAGR', 'Vol', 'MaxDD', 'Beat12m%', 'Worst12mRel', 'Turn/yr', 'CAGR pre-tax']
    out = df.copy()
    for c in out.columns:
        if c in pct:
            out[c] = out[c].map(lambda x: f'{x * 100:6.1f}%' if pd.notna(x) else '')
        elif out[c].dtype.kind == 'f':
            out[c] = out[c].map(lambda x: f'{x:6.2f}' if pd.notna(x) else '')
    return out.to_string()


def summarize(res, ew):
    nav = res['nav']
    m = metrics(nav, bench=ew)
    yrs = (nav.index[-1] - nav.index[0]).days / 365.25
    tr = res['trades']
    m['Turn/yr'] = res['traded'] / nav.mean() / yrs
    m['HoldDays'] = tr['days'].median() if len(tr) else np.nan
    m['Stops/yr'] = (tr['why'] == 'stop').sum() / yrs if len(tr) else 0
    return m


def vol_scaled(nav_pretax, cfg):
    """Barroso & Santa-Clara style: exposure = min(1, expanding-median vol / trailing 6m vol), set monthly."""
    r = nav_pretax.pct_change().fillna(0)
    sigma = r.rolling(126, min_periods=100).std() * np.sqrt(252)
    target = sigma.expanding(min_periods=252).median()
    w_daily = (target / sigma).clip(upper=1.0)
    month_end = r.index.to_period('M') != r.index.to_period('M').to_series().shift(-1).values
    w = w_daily.where(month_end).ffill().shift(1).fillna(1.0)
    cash_r = (1 + cfg.cash_rate) ** (1 / 252) - 1
    cost = w.diff().abs().fillna(0) * cfg.cost
    out = (1 + w * r + (1 - w) * cash_r - cost).cumprod()
    return out * nav_pretax.iloc[0], w


def main():
    prepared()
    ew = equal_weight_universe(BASE)
    nifty = benchmark('NIFTY500', BASE.start, BASE.end)
    rows, navs = {}, {}
    for cfg in VARIANTS:
        res = run(cfg)
        pre = run(cfg.but(tax=False))
        m = summarize(res, ew)
        m['CAGR pre-tax'] = metrics(pre['nav'])['CAGR']
        rows[cfg.name] = m
        navs[cfg.name] = (res, pre)
        print('.', end='', flush=True)
    print()

    base_pre = navs['E0 rank>40 (base)'][1]['nav']
    vs, w = vol_scaled(base_pre, BASE)
    rows['V1 vol-scaled (pre-tax only)'] = {**metrics(vs, bench=ew), 'CAGR pre-tax': metrics(vs)['CAGR']}
    rows['B  Nifty500 index (price)'] = metrics(nifty, bench=ew)
    rows['B  EW same universe'] = metrics(ew, bench=ew)

    cols = ['CAGR', 'CAGR pre-tax', 'Vol', 'Sharpe', 'MaxDD', 'Calmar', 'Beat12m%', 'Worst12mRel',
            't(excess)', 'Turn/yr', 'HoldDays', 'Stops/yr']
    table = pd.DataFrame(rows).T.reindex(columns=cols)
    print('\n=== Full period (after costs; CAGR after tax unless noted). Excess/Beat vs EW same universe ===')
    print(fmt(table))

    print('\n=== Sub-period CAGR (after tax) ===')
    sub = {}
    series = {name: r[0]['nav'] for name, r in navs.items()}
    series['V1 vol-scaled (pre-tax only)'] = vs
    series['B  Nifty500 index (price)'] = nifty
    series['B  EW same universe'] = ew
    for name, s in series.items():
        sub[name] = {f'{a[:4]}-{b[2:4]}': metrics(s.loc[a:b])['CAGR'] for a, b in SUBPERIODS}
        sub[name]['MaxDD'] = metrics(s)['MaxDD']
    print(fmt(pd.DataFrame(sub).T.map(lambda x: x).rename(columns=lambda c: c)).replace('nan', ''))

    print('\n=== Years in drawdown & crash windows (after tax) ===')
    windows = {'GFC 2008': ('2008-01', '2009-03'), '2011': ('2010-11', '2011-12'),
               '2018 midcap': ('2018-01', '2019-08'), 'Covid': ('2020-01', '2020-03'),
               'Rebound 2020': ('2020-04', '2020-12'), '2024-25 corr': ('2024-09', '2025-03')}
    crash = {}
    for name, s in series.items():
        crash[name] = {k: s.loc[a:b].iloc[-1] / s.loc[a:b].iloc[0] - 1 for k, (a, b) in windows.items()}
    print(pd.DataFrame(crash).T.map(lambda x: f'{x * 100:6.1f}%').to_string())

    if '--grid' in sys.argv:
        grid(ew)


def grid(ew):
    print('\n=== Robustness grid: after-tax CAGR / Sharpe / MaxDD ===')
    out = {}
    for er in (20, 25, 30, 40, 50, 60, 80):
        m = metrics(run(BASE.but(exit_rank=er))['nav'])
        out[f'exit rank>{er}'] = m
    for pct in (0.10, 0.15, 0.20, 0.25, 0.30, 0.40):
        m = metrics(run(BASE.but(stop='trail', stop_pct=pct))['nav'])
        out[f'trail {int(pct * 100)}%'] = m
    for n in (10, 15, 20, 25, 30, 40):
        m = metrics(run(BASE.but(top_n=n, exit_rank=2 * n))['nav'])
        out[f'top {n} / exit {2 * n}'] = m
    for c in (0.0015, 0.0025, 0.004, 0.006):
        m = metrics(run(BASE.but(cost=c))['nav'])
        out[f'cost {c * 100:.2f}%/side'] = m
    for start in ('2007-01-01', '2010-01-01', '2013-01-01', '2016-01-01', '2019-01-01'):
        a = metrics(run(BASE.but(start=start))['nav'])
        b = metrics(run(BASE.but(start=start, regime='no_new_buys'))['nav'])
        out[f'start {start[:4]} base'] = a
        out[f'start {start[:4]} R1'] = b
    df = pd.DataFrame(out).T[['CAGR', 'Sharpe', 'MaxDD', 'Calmar']]
    print(fmt(df))


if __name__ == '__main__':
    main()
