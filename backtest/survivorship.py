"""Survivorship-bias check: same strategies on today's list vs point-in-time Nifty 500 membership."""
import pandas as pd

from engine import Config, benchmark, equal_weight_universe, metrics, run
from run import SUBPERIODS, fmt

UNIVERSES = {
    'yahoo': 'A  today list, Yahoo data (old run)',
    'pit_today': 'B  today list, NSE data',
    'pit': 'C  point-in-time members',
    'liq500': 'D  top-500 by traded value',
}
RULES = {
    'base rank>40': {},
    'E10 month-end <MA200': {'ma_exit': 200},
    'E9 month-end <MA100': {'ma_exit': 100},
    'R1 no new buys idx<200DMA': {'regime': 'no_new_buys'},
    'E10 + R1': {'ma_exit': 200, 'regime': 'no_new_buys'},
    'E4 trail stop 20%': {'stop': 'trail', 'stop_pct': 0.20},
    'E6 fixed stop 10%': {'stop': 'fixed', 'stop_pct': 0.10},
    'E8 daily close<MA100': {'stop': 'ma', 'stop_ma': 100},
    'top15 exit30 + E10': {'top_n': 15, 'exit_rank': 30, 'ma_exit': 200},
}
WINDOWS = {'GFC 2008': ('2008-01', '2009-03'), 'Covid': ('2020-01', '2020-03'),
           'Rebound 2020': ('2020-04', '2020-12'), '2024-25 corr': ('2024-09', '2025-03')}


def main():
    base = Config()
    nifty = benchmark('NIFTY500', base.start, base.end)
    rows, sub, crash = {}, {}, {}
    for u, ulabel in UNIVERSES.items():
        ucfg = base.but(universe=u)
        ew = equal_weight_universe(ucfg)
        for rname, kw in RULES.items():
            if u == 'liq500' and rname not in ('base rank>40', 'E10 month-end <MA200', 'E10 + R1'):
                continue
            res = run(ucfg.but(name=rname, **kw))
            nav = res['nav']
            m = metrics(nav, bench=ew)
            tr = res['trades']
            yrs = (nav.index[-1] - nav.index[0]).days / 365.25
            m['Turn/yr'] = res['traded'] / nav.mean() / yrs
            m['Delisted/yr'] = (tr['why'] == 'delisted').sum() / yrs
            m['Worst trade'] = tr['ret'].min()
            key = (ulabel, rname)
            rows[key] = m
            sub[key] = {f'{a[:4]}-{b[2:4]}': metrics(nav.loc[a:b])['CAGR'] for a, b in SUBPERIODS}
            crash[key] = {k: nav.loc[a:b].iloc[-1] / nav.loc[a:b].iloc[0] - 1 for k, (a, b) in WINDOWS.items()}
            print('.', end='', flush=True)
        key = (ulabel, 'EW universe')
        rows[key] = metrics(ew)
        sub[key] = {f'{a[:4]}-{b[2:4]}': metrics(ew.loc[a:b])['CAGR'] for a, b in SUBPERIODS}
        crash[key] = {k: ew.loc[a:b].iloc[-1] / ew.loc[a:b].iloc[0] - 1 for k, (a, b) in WINDOWS.items()}
    key = ('-', 'Nifty500 index (price)')
    rows[key] = metrics(nifty)
    sub[key] = {f'{a[:4]}-{b[2:4]}': metrics(nifty.loc[a:b])['CAGR'] for a, b in SUBPERIODS}
    crash[key] = {k: nifty.loc[a:b].iloc[-1] / nifty.loc[a:b].iloc[0] - 1 for k, (a, b) in WINDOWS.items()}
    print()

    cols = ['CAGR', 'Vol', 'Sharpe', 'MaxDD', 'Calmar', 'Beat12m%', 't(excess)', 'Turn/yr', 'Delisted/yr',
            'Worst trade']
    t = pd.DataFrame(rows).T.reindex(columns=cols)
    t['Worst trade'] = t['Worst trade'].map(lambda x: f'{x * 100:6.1f}%' if pd.notna(x) else '')
    print('\n=== After tax & costs, 2007-2026. Beat/t vs EW of the SAME universe ===')
    print(fmt(t))
    print('\n=== Sub-period CAGR (after tax) ===')
    print(pd.DataFrame(sub).T.map(lambda x: f'{x * 100:6.1f}%').to_string())
    print('\n=== Crash windows ===')
    print(pd.DataFrame(crash).T.map(lambda x: f'{x * 100:6.1f}%').to_string())


if __name__ == '__main__':
    main()
