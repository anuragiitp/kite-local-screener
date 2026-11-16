"""Entry/exit signal variants, each averaged over several rebalance schedules to remove timing luck."""
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np
import pandas as pd

from engine import Config, metrics, run

BASE = Config(universe='pit', ma_exit=200, regime='no_new_buys')
SCHEDULES = {'M': [dict(rebalance='M', rebal_offset=o) for o in (0, 5, 10, 15)],
             'W': [dict(rebalance='W', rebal_offset=o) for o in (0, 2, 4)]}
VARIANTS = {
    'base (top20, sell rank>40 or <200DMA)': {},
    'wider candidate list (top 30)': dict(buy_rank=30),
    'entry: skip if >50% above 200DMA': dict(max_ext=0.5),
    'entry: skip if >100% above 200DMA': dict(max_ext=1.0),
    'entry: pullback <=3% above 20DMA (top30)': dict(entry_pullback=0.03, buy_rank=30),
    'entry: pullback <=8% above 20DMA (top30)': dict(entry_pullback=0.08, buy_rank=30),
    'entry: breakout within 3% of 20d high (top30)': dict(entry_breakout=0.03, buy_rank=30),
    'entry: within 10% of 52w high (top30)': dict(entry_breakout=0.10, breakout_days=252, buy_rank=30),
    'exit: <150DMA instead of 200': dict(ma_exit=150),
    'exit: <100DMA instead of 200': dict(ma_exit=100),
    'exit: trail 25% from peak (at checks)': dict(check_trail=0.25),
    'exit: trail 35% from peak (at checks)': dict(check_trail=0.35),
    'exit: rank>40 only if <50DMA (ride winners)': dict(rank_exit_ma=50),
    'exit: rank>40 only if <100DMA (ride winners)': dict(rank_exit_ma=100),
    'exit: rank>60': dict(exit_rank=60),
}
H52 = dict(entry_breakout=0.10, breakout_days=252, buy_rank=30)
RIDE = dict(rank_exit_ma=50)
COMBOS = {
    'base': {},
    '52w high within 5% (top30)': {**H52, 'entry_breakout': 0.05},
    '52w high within 10% (top30)': H52,
    '52w high within 15% (top30)': {**H52, 'entry_breakout': 0.15},
    '52w high within 20% (top30)': {**H52, 'entry_breakout': 0.20},
    '52w high within 10% (top20)': {**H52, 'buy_rank': 20},
    '52w high within 10% (top40)': {**H52, 'buy_rank': 40},
    'ride winners <50DMA': RIDE,
    'ride winners <20DMA': dict(rank_exit_ma=20),
    'COMBO 52w10% + ride <50DMA': {**H52, **RIDE},
    'COMBO 52w15% + ride <50DMA': {**H52, 'entry_breakout': 0.15, **RIDE},
    'COMBO 52w10% + ride <100DMA': {**H52, 'rank_exit_ma': 100},
}


def _one(task):
    name, sched, kw = task
    r = run(BASE.but(**kw))
    n, t = r['nav'], r['trades']
    m = metrics(n)
    yrs = (n.index[-1] - n.index[0]).days / 365.25
    return name, sched, {'CAGR': m['CAGR'], 'Sharpe': m['Sharpe'], 'MaxDD': m['MaxDD'],
                         'CAGR16+': metrics(n.loc['2016':])['CAGR'], 'Trades/yr': len(t) / yrs,
                         'MedHold': t.days.median(), 'Win%': (t.ret > 0).mean(),
                         'AvgStocks': np.mean([k for _, k in r['names']])}


def main(variants, out_name):
    tasks = [(name, s, {**kw, **sk}) for name, kw in variants.items()
             for s, sks in SCHEDULES.items() for sk in sks]
    with ProcessPoolExecutor(max_workers=3) as ex:
        res = list(ex.map(_one, tasks))
    df = pd.DataFrame([{'variant': n, 'sched': s, **m} for n, s, m in res])
    g = df.groupby(['sched', 'variant'], sort=False)
    out = g.mean()
    out['CAGR range'] = g['CAGR'].agg(lambda c: f'{c.min()*100:.1f}-{c.max()*100:.1f}')
    for c in ['CAGR', 'MaxDD', 'CAGR16+', 'Win%']:
        out[c] = (out[c] * 100).round(1)
    out = out.round(2)
    text = out.to_string()
    (Path(__file__).parent / 'data' / out_name).write_text(text)
    print(text)


if __name__ == '__main__':
    import sys
    if 'combo' in sys.argv:
        main(COMBOS, 'entry_exit_combo.txt')
    else:
        main(VARIANTS, 'entry_exit.txt')
