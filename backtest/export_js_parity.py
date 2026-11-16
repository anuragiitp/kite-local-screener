"""Export inputs + reference results so the app's JS engine can be checked against engine.py (Rule C)."""
import json
import math

import numpy as np
import pandas as pd

from engine import Config, _despike, _schedule, prepared, run, scores_at

START = '2025-01-01'
LOOKBACK_ROWS = 300
C = Config(universe='pit', ma_exit=200, regime='no_new_buys', entry_breakout=0.10, breakout_days=252,
           buy_rank=30, rank_exit_ma=50, start=START, tax=False)


def _arr(s):
    return [None if not math.isfinite(v) else round(float(v), 6) for v in s.to_numpy(dtype=float)]


def main():
    d = prepared('pit')
    af = d['af']
    dates = af.index
    start_i = dates.searchsorted(pd.Timestamp(START))
    lo = start_i - LOOKBACK_ROWS
    member = d['member']['snap']
    signal = _schedule(dates, 'M')
    sig_idx = [i for i in range(start_i, len(dates)) if signal[i]]

    syms = sorted(set().union(*[set(member.columns[member.iloc[i].to_numpy()]) for i in sig_idx]))
    # af is the de-spiked close forward-filled (limit 10); export it only where the clean close exists
    import pit
    p = pit.build_panel()
    clean_mask = _despike(p['adjclose'].reindex(columns=syms)).notna().iloc[lo:]
    rows = slice(lo, len(dates))
    out = {
        'dates': [str(x.date()) for x in dates[rows]],
        'startIndex': int(start_i - lo),
        'bench': _arr(d['bench']['NIFTY500'].iloc[rows]),
        'symbols': {},
        'members': {str(dates[i].date()): list(member.columns[member.iloc[i].to_numpy()]) for i in sig_idx},
    }
    afw = af.reindex(columns=syms).iloc[rows]
    for s in syms:
        close = afw[s].where(clean_mask[s].to_numpy())
        out['symbols'][s] = {
            'close': _arr(close),
            'open': _arr(d['open'][s].iloc[rows]),
            'tval': _arr(p['tval'][s].reindex(dates).iloc[rows]) if s in p['tval'] else [None] * len(out['dates']),
        }

    ref = {'signals': {}}
    for i in sig_idx:
        score, entry_ok = scores_at(d, i, C)
        ref['signals'][str(dates[i].date())] = {
            'top': [[s, round(float(v), 6)] for s, v in score.head(60).items()],
            'count': int(len(score)),
            'entryOk': {s: bool(entry_ok.get(s, False)) for s in score.head(60).index},
        }
    r = run(C)
    ref['nav'] = [[str(k.date()), round(float(v), 2)] for k, v in r['nav'].items()]
    ref['trades'] = [[str(t.entry.date()), str(t.exit.date()), t.sym, round(float(t.ret), 6), t.why]
                     for t in r['trades'].itertuples()]
    out['reference'] = ref
    with open('data/js_parity.json', 'w') as f:
        json.dump(out, f)
    print('rows', len(out['dates']), 'symbols', len(syms), 'signals', len(sig_idx), 'trades', len(ref['trades']),
          'final nav', ref['nav'][-1])


if __name__ == '__main__':
    main()
