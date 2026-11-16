"""Short-horizon Nifty edges on futures (cheap to trade): turn-of-month, RSI2 dip-buying, and combos with the trend rule.
Next-open fills via nifty_futures.simulate. Output: data/nifty_edges.txt"""
from pathlib import Path

import numpy as np
import pandas as pd

import nifty_futures as nf

OUT = Path(__file__).parent / 'data' / 'nifty_edges.txt'


def rsi(c, n=2):
    d = c.diff()
    up = d.clip(lower=0).ewm(alpha=1 / n, adjust=False).mean()
    dn = (-d.clip(upper=0)).ewm(alpha=1 / n, adjust=False).mean()
    return 100 - 100 / (1 + up / dn)


def turn_of_month(idx, before=4, after=3):
    """1 on the close that precedes each of the last `before` and first `after` sessions of a month."""
    m = pd.Series(idx.to_period('M'), index=idx)
    k_from_start = m.groupby(m).cumcount()
    k_from_end = m.groupby(m).cumcount(ascending=False)
    hold_day = (k_from_start < after) | (k_from_end < before)
    return hold_day.shift(-1, fill_value=False).astype(float)


def dip(c, entry, exit_ma=5, trend=200):
    """Long from RSI2 < entry (close above trend SMA) until close > SMA(exit_ma)."""
    r, ma_x = rsi(c), c.rolling(exit_ma).mean()
    ok = c > c.rolling(trend).mean() if trend else pd.Series(True, index=c.index)
    pos, out = 0.0, []
    for i in range(len(c)):
        if pos == 0 and r.iloc[i] < entry and ok.iloc[i]:
            pos = 1.0
        elif pos == 1 and c.iloc[i] > ma_x.iloc[i]:
            pos = 0.0
        out.append(pos)
    return pd.Series(out, index=c.index)


def main():
    df = nf.load()
    c = df['close']
    ef, es = c.ewm(span=20, adjust=False).mean(), c.ewm(span=50, adjust=False).mean()
    trend = (ef > es).astype(float)
    tom = turn_of_month(df.index)
    rules = {
        'Buy & hold futures': pd.Series(1.0, index=c.index),
        'Trend EMA20>50 (long only)': trend,
        'Turn-of-month (last 4 + first 3 days)': tom,
        'Turn-of-month (last 2 + first 2 days)': turn_of_month(df.index, 2, 2),
        'RSI2<10 dip, above 200SMA, exit >5SMA': dip(c, 10),
        'RSI2<20 dip, above 200SMA, exit >5SMA': dip(c, 20),
        'RSI2<10 dip, no trend filter': dip(c, 10, trend=None),
        'Trend OR RSI2<10 dip': np.maximum(trend, dip(c, 10)),
        'Trend OR turn-of-month': np.maximum(trend, tom),
    }
    bh = c.resample('ME').last().pct_change()
    rows = {}
    for name, tgt in rules.items():
        nav, pos = nf.simulate(df, tgt)
        s = nf.stats(nav, pos)
        s['Corr Nifty'] = nav.resample('ME').last().pct_change().corr(bh)
        s['24-07..now'] = nav.iloc[-1] / nav.loc[:'2024-06-30'].iloc[-1] - 1
        rows[name] = {k: s[k] for k in ('CAGR', 'MaxDD', 'Sharpe', 'InMkt', 'Trades/yr', 'Win%', 'Corr Nifty', '24-07..now')}
    t = pd.DataFrame(rows).T
    fmt = {k: (lambda x: f'{x:.2f}') if k in ('Sharpe', 'Trades/yr', 'Corr Nifty') else (lambda x: f'{x * 100:.1f}%')
           for k in t.columns}
    text = (f'Nifty futures {df.index[0].date()} -> {df.index[-1].date()}, next-open fills, cost {nf.COST * 100:.2f}%/side, '
            f'cash {nf.CASH:.0%} when flat, carry {nf.CARRY:.0%}.\n' + t.to_string(formatters=fmt))
    OUT.write_text(text, encoding='utf-8')
    print(text)


if __name__ == '__main__':
    main()
