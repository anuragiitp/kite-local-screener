"""Momentum / trend rules on NIFTY 50 futures, daily bars, 1x notional (fully funded).
Signal on the close, trade at the next open. Futures modelled as: index move - carry (long pays, short earns)
+ interest on the full capital (collateral in liquid funds). Costs per side + monthly roll. No tax.
Output: data/nifty_futures.txt"""
from pathlib import Path

import numpy as np
import pandas as pd

from data import fetch_yahoo

DATA = Path(__file__).parent / 'data'
OUT = DATA / 'nifty_futures.txt'
CASH = 0.06          # liquid-fund yield on capital
CARRY = 0.05         # futures premium over spot, per year (r - dividend yield)
COST = 0.0003        # per side: STT 0.02% sell, exchange, stamp, GST, ~1 pt slippage
ROLL = 0.0003        # per monthly roll while in a position
TD = 252


def load():
    cache = DATA / 'nifty50_ohlc.pkl'
    if cache.exists() and (pd.Timestamp.now() - pd.Timestamp(cache.stat().st_mtime, unit='s')).days < 1:
        return pd.read_pickle(cache)
    df = fetch_yahoo('^NSEI', start='2007-01-01')[['open', 'high', 'low', 'close']]
    df = df[(df['high'] >= df['low']) & (df['open'] > 0)]
    now = pd.Timestamp.now(tz='Asia/Kolkata')
    if now.hour < 16:
        df = df[df.index < now.normalize().tz_localize(None)]  # today's bar is still forming
    df.to_pickle(cache)
    return df


# ---------- indicators ----------

def atr(df, n):
    pc = df['close'].shift()
    tr = pd.concat([df['high'] - df['low'], (df['high'] - pc).abs(), (df['low'] - pc).abs()], axis=1).max(axis=1)
    return tr.ewm(alpha=1 / n, adjust=False).mean()


def supertrend(df, n=10, m=3.0):
    a = atr(df, n).to_numpy()
    hl2 = ((df['high'] + df['low']) / 2).to_numpy()
    c = df['close'].to_numpy()
    up, dn = hl2 - m * a, hl2 + m * a
    trend = np.ones(len(c))
    fu, fd = up.copy(), dn.copy()
    for i in range(1, len(c)):
        fu[i] = max(up[i], fu[i - 1]) if c[i - 1] > fu[i - 1] else up[i]
        fd[i] = min(dn[i], fd[i - 1]) if c[i - 1] < fd[i - 1] else dn[i]
        if trend[i - 1] < 0 and c[i] > fd[i - 1]:
            trend[i] = 1
        elif trend[i - 1] > 0 and c[i] < fu[i - 1]:
            trend[i] = -1
        else:
            trend[i] = trend[i - 1]
    return pd.Series(trend, index=df.index)


def hysteresis(enter, exit_, short_enter=None, short_exit=None):
    """Stateful position from boolean entry/exit series (long, optional short)."""
    e, x = enter.to_numpy(), exit_.to_numpy()
    se = short_enter.to_numpy() if short_enter is not None else np.zeros(len(e), bool)
    sx = short_exit.to_numpy() if short_exit is not None else np.zeros(len(e), bool)
    pos = np.zeros(len(e))
    for i in range(1, len(e)):
        p = pos[i - 1]
        if p > 0 and x[i]:
            p = 0
        elif p < 0 and sx[i]:
            p = 0
        if p == 0:
            if e[i]:
                p = 1
            elif se[i]:
                p = -1
        pos[i] = p
    return pd.Series(pos, index=enter.index)


def month_end_hold(sig):
    """Evaluate only on the last trading day of each month, hold until the next one."""
    me = sig.index.to_series().groupby(sig.index.to_period('M')).transform('max') == sig.index.to_series()
    return sig.where(me).ffill().fillna(0)


# ---------- rules: target position decided on day t close ----------

def rules(df):
    c = df['close']
    sma = lambda n: c.rolling(n).mean()
    ema = lambda n: c.ewm(span=n, adjust=False).mean()
    ret = lambda n: c / c.shift(n) - 1
    R = {}
    R['Buy & hold (long futures)'] = pd.Series(1.0, index=c.index)

    for n in (50, 100, 150, 200, 250):
        R[f'Close > SMA{n}'] = (c > sma(n)).astype(float)
    R['Close > SMA200, 2% band'] = hysteresis(c > sma(200) * 1.02, c < sma(200) * 0.98)
    R['Close > SMA200, long/short'] = np.sign(c - sma(200))
    R['SMA50 > SMA200 (golden cross)'] = (sma(50) > sma(200)).astype(float)
    R['EMA20 > EMA50'] = (ema(20) > ema(50)).astype(float)
    R['EMA20 > EMA50, long/short'] = np.sign(ema(20) - ema(50))
    R['EMA50 > EMA200'] = (ema(50) > ema(200)).astype(float)

    for m in (3, 6, 12):
        R[f'TSMOM {m}m (month-end)'] = month_end_hold((ret(21 * m) > 0).astype(float))
    votes = sum(np.sign(ret(21 * m)) for m in (1, 3, 6, 12)) / 4
    R['TSMOM blend 1/3/6/12m, scaled'] = month_end_hold(votes.clip(lower=0))
    R['10-month SMA (Faber, month-end)'] = month_end_hold((c > c.rolling(210).mean()).astype(float))

    hi = lambda n: df['high'].rolling(n).max().shift()
    lo = lambda n: df['low'].rolling(n).min().shift()
    R['Donchian 55/20 long'] = hysteresis(c > hi(55), c < lo(20))
    R['Donchian 20/10 long'] = hysteresis(c > hi(20), c < lo(10))
    R['Donchian 55/20 long/short'] = hysteresis(c > hi(55), c < lo(20), c < lo(55), c > hi(20))

    for n, m in ((10, 2), (10, 3), (14, 3), (20, 4)):
        st = supertrend(df, n, m)
        R[f'Supertrend {n},{m} long'] = (st > 0).astype(float)
        if (n, m) == (10, 3):
            R['Supertrend 10,3 long/short'] = st
            R['Supertrend 10,3 long + SMA200 filter'] = ((st > 0) & (c > sma(200))).astype(float)

    # trend filter + faster timing: in when above SMA200 and 20-day momentum positive
    R['SMA200 + 1m momentum > 0'] = ((c > sma(200)) & (ret(21) > 0)).astype(float)

    # same SMA200 rule, exposure scaled to 15% annual vol (capped at 1.5x)
    vol = np.log(c).diff().rolling(20).std() * np.sqrt(TD)
    R['Close > SMA200, vol-target 15%'] = (c > sma(200)).astype(float) * (0.15 / vol).clip(upper=1.5).round(1)
    return R


# ---------- simulation ----------

def simulate(df, target):
    """target[t] decided at close t, held from open t+1."""
    pos = target.shift().fillna(0).to_numpy()             # held during day t's session (after open)
    prev = np.concatenate([[0.0], pos[:-1]])                # held overnight into day t
    o, c = df['open'].to_numpy(), df['close'].to_numpy()
    pc = np.concatenate([[c[0]], c[:-1]])
    r_on, r_id = o / pc - 1, c / o - 1
    days = np.diff(df.index.values).astype('timedelta64[D]').astype(float)
    days = np.concatenate([[1.0], days])
    cash = (1 + CASH) ** (days / 365) - 1
    carry = (1 + CARRY) ** (days / 365) - 1
    turnover = np.abs(pos - prev)
    month = df.index.to_period('M')
    rolled = np.concatenate([[False], month[1:] != month[:-1]])
    r = prev * r_on + pos * r_id + cash - pos * carry - turnover * COST - rolled * np.abs(pos) * ROLL
    nav = pd.Series(np.cumprod(1 + r), index=df.index)
    return nav, pd.Series(pos, index=df.index)


def trades(nav, pos):
    """Round trips: contiguous non-zero runs of the same sign."""
    out = []
    p = pos.to_numpy()
    start = None
    for i in range(len(p)):
        s = np.sign(p[i])
        if start is None and s != 0:
            start, side = i, s
        elif start is not None and s != side:
            out.append((nav.index[start], nav.index[i - 1], side, nav.iloc[i - 1] / nav.iloc[start - 1] - 1, i - start))
            start = None
            if s != 0:
                start, side = i, s
    if start is not None:
        out.append((nav.index[start], nav.index[-1], side, nav.iloc[-1] / nav.iloc[start - 1] - 1, len(p) - start))
    return out


def stats(nav, pos):
    r = nav.pct_change().dropna()
    yrs = (nav.index[-1] - nav.index[0]).days / 365.25
    cagr = nav.iloc[-1] ** (1 / yrs) - 1
    dd = (nav / nav.cummax() - 1).min()
    ex = r - ((1 + CASH) ** (1 / TD) - 1)
    t = trades(nav, pos)
    wins = [x[3] for x in t if x[3] > 0]
    losses = [x[3] for x in t if x[3] <= 0]
    yearly = nav.resample('YE').last().pct_change()
    yearly.iloc[0] = nav.resample('YE').last().iloc[0] / nav.iloc[0] - 1
    return {
        'CAGR': cagr,
        'MaxDD': dd,
        'MAR': cagr / -dd if dd < 0 else np.nan,
        'Sharpe': ex.mean() / ex.std() * np.sqrt(TD),
        'InMkt': (pos != 0).mean(),
        'Trades/yr': len(t) / yrs,
        'Win%': len(wins) / len(t) if t else np.nan,
        'AvgWin': np.mean(wins) if wins else np.nan,
        'AvgLoss': np.mean(losses) if losses else np.nan,
        'HoldDays': np.median([x[4] for x in t]) if t else np.nan,
        'WorstYr': yearly.min(),
    }


def short_side(nav, pos):
    """Stats of the short trades only."""
    t = [x for x in trades(nav, pos) if x[2] < 0]
    if not t:
        return 0, np.nan, np.nan
    total = np.prod([1 + x[3] for x in t]) - 1
    return len(t), sum(x[3] > 0 for x in t) / len(t), total


def ls_rules(df, fast=20, slow=50):
    c = df['close']
    ema_f, ema_s = c.ewm(span=fast, adjust=False).mean(), c.ewm(span=slow, adjust=False).mean()
    sma100, sma200 = c.rolling(100).mean(), c.rolling(200).mean()
    bear = (c < sma200) & (sma200 < sma200.shift(20))           # below a falling 200-day average
    up, dn = ema_f > ema_s, ema_f < ema_s
    st = supertrend(df, 10, 3)
    lo55, hi20 = df['low'].rolling(55).min().shift(), df['high'].rolling(20).max().shift()
    R = {
        'L/S symmetric EMA': np.sign(ema_f - ema_s),
        'L EMA, S EMA + below SMA200': up.astype(float) - (dn & (c < sma200)).astype(float),
        'L EMA, S EMA + bear regime': up.astype(float) - (dn & bear).astype(float),
        'L EMA, S EMA + bear, half size': up.astype(float) - 0.5 * (dn & bear).astype(float),
        'L EMA, S bear, cover > EMA20': None,
        'L SMA100, S below SMA100 + bear': (c > sma100).astype(float) - ((c < sma100) & bear).astype(float),
        'L Supertrend, S ST down + bear': (st > 0).astype(float) - ((st < 0) & bear).astype(float),
        'L EMA, S 55d low + bear, cover 20d high': None,
    }
    # quick cover: short while bear & EMA down, cover as soon as close is back above the fast EMA
    short = hysteresis(dn & bear & (c < ema_f), (c > ema_f) | ~bear)
    R['L EMA, S bear, cover > EMA20'] = up.astype(float) - short.clip(lower=0) * (~up).astype(float)
    short = hysteresis(bear & (c < lo55), c > hi20)
    R['L EMA, S 55d low + bear, cover 20d high'] = up.astype(float) - short.clip(lower=0) * (~up).astype(float)
    R['L/S symmetric EMA, half-size shorts'] = up.astype(float) - 0.5 * dn.astype(float)
    # short on the EMA cross, cover early if Nifty rallies 2 ATR off its low since the short began
    R['L/S EMA, short with 2-ATR stop'] = up.astype(float) - short_with_stop(c, dn, atr(df, 14))
    ema10 = c.ewm(span=10, adjust=False).mean()
    R['L EMA20/50, S EMA10<EMA20 & EMA20<EMA50'] = up.astype(float) - (dn & (ema10 < ema_f)).astype(float)
    return R


def short_with_stop(c, dn, a, k=2.0):
    """1 while short: EMA trend down and close not more than k*ATR above the lowest close since the short began.
    Once stopped, stay flat until the trend turns up and down again."""
    cc, d_, a = c.to_numpy(), dn.to_numpy(), a.to_numpy()
    s = np.zeros(len(cc))
    low, stopped = np.inf, False
    for i in range(1, len(cc)):
        if not d_[i]:
            low, stopped = np.inf, False
            continue
        if stopped:
            continue
        low = min(low, cc[i])
        if cc[i] > low + k * a[i]:
            stopped = True
            continue
        s[i] = 1
    return pd.Series(s, index=c.index)


def long_short(df, d, start, w):
    global COST, ROLL
    w('== Long AND short: which short rules add value? ==')
    w('Long side is EMA20 > EMA50 unless named. "bear" = close below a falling SMA200 (SMA200 lower than 20 days ago).')
    rows = {}
    long_only = (df['close'].ewm(span=20, adjust=False).mean() > df['close'].ewm(span=50, adjust=False).mean()).astype(float)
    all_rules = {'Long only EMA20/50 (reference)': long_only, **ls_rules(df)}
    for name, tgt in all_rules.items():
        nav, pos = simulate(d, tgt.loc[start:])
        s = stats(nav, pos)
        n, win, total = short_side(nav, pos)
        sub = []
        for a, b in (('2008-01-01', '2013-12-31'), ('2014-01-01', '2019-12-31'), ('2020-01-01', '2026-12-31')):
            x = nav.loc[a:b]
            yrs = (x.index[-1] - x.index[0]).days / 365.25
            sub.append((x.iloc[-1] / x.iloc[0]) ** (1 / yrs) - 1)
        rows[name] = {'CAGR': pct(s['CAGR']), 'MaxDD': pct(s['MaxDD']), 'MAR': f"{s['MAR']:.2f}", 'Sharpe': f"{s['Sharpe']:.2f}",
                      'Long%': pct((pos > 0).mean(), 0), 'Short%': pct((pos < 0).mean(), 0),
                      'Shorts': n, 'ShortWin%': pct(win, 0), 'Shorts total': pct(total),
                      '08-13': pct(sub[0]), '14-19': pct(sub[1]), '20-26': pct(sub[2])}
    w(pd.DataFrame(rows).T.to_string())
    w('')

    w('Short trades of "L EMA, S EMA + bear regime" (each short campaign)')
    nav, pos = simulate(d, all_rules['L EMA, S EMA + bear regime'].loc[start:])
    for a, b, side, r, n in trades(nav, pos):
        if side < 0:
            w(f'  {a.date()} -> {b.date()}  {n:3d} days  {pct(r):>7s}  Nifty {pct(d["close"].loc[b] / d["close"].loc[:a].iloc[-2] - 1):>7s}')
    w('')

    w('Robustness of "L EMA f/s, S EMA + bear": CAGR / MaxDD, rows fast, cols slow')
    grid = {}
    for slow in (40, 50, 75, 100):
        col = {}
        for fast in (10, 15, 20, 30):
            if fast >= slow:
                col[fast] = ''
                continue
            s = stats(*simulate(d, ls_rules(df, fast, slow)['L EMA, S EMA + bear regime'].loc[start:]))
            col[fast] = f"{s['CAGR'] * 100:5.1f}/{s['MaxDD'] * 100:4.0f}"
        grid[slow] = col
    w(pd.DataFrame(grid).to_string())
    w('')
    w('Stress (CAGR / MaxDD): base | costs x3 | 1 day late | 1.5x leverage')
    for name in ('Long only EMA20/50 (reference)', 'L/S symmetric EMA', 'L EMA, S EMA + bear regime', 'L EMA, S EMA + bear, half size'):
        tgt = all_rules[name]
        cell = lambda t: (lambda s: f"{s['CAGR'] * 100:5.1f}/{s['MaxDD'] * 100:4.0f}")(stats(*simulate(d, t.loc[start:])))
        base, late, lev = cell(tgt), cell(tgt.shift().fillna(0)), cell(tgt * 1.5)
        COST, ROLL = COST * 3, ROLL * 3
        hi = cell(tgt)
        COST, ROLL = COST / 3, ROLL / 3
        w(f'  {name:34s} {base} | {hi} | {late} | {lev}')
    w('')

    w('== Robustness of "long EMA f/s, short EMA f/s with k-ATR stop" (CAGR / MaxDD) ==')
    c = df['close']
    pairs = ((10, 40), (15, 50), (20, 50), (20, 75), (30, 100))
    grid = {}
    for k in (1.0, 1.5, 2.0, 2.5, 3.0, 4.0):
        col = {}
        for f, s_ in pairs:
            ef, es = c.ewm(span=f, adjust=False).mean(), c.ewm(span=s_, adjust=False).mean()
            tgt = (ef > es).astype(float) - short_with_stop(c, ef < es, atr(df, 14), k)
            st = stats(*simulate(d, tgt.loc[start:]))
            col[f'{f}/{s_}'] = f"{st['CAGR'] * 100:5.1f}/{st['MaxDD'] * 100:4.0f}"
        grid[f'k={k}'] = col
    ref = {}
    for f, s_ in pairs:
        ef, es = c.ewm(span=f, adjust=False).mean(), c.ewm(span=s_, adjust=False).mean()
        st = stats(*simulate(d, (ef > es).astype(float).loc[start:]))
        ref[f'{f}/{s_}'] = f"{st['CAGR'] * 100:5.1f}/{st['MaxDD'] * 100:4.0f}"
    grid['long only'] = ref
    w(pd.DataFrame(grid).to_string())
    w('ATR period for k=2, EMA20/50: ' + '  '.join(
        f"ATR{n}: " + (lambda st: f"{st['CAGR'] * 100:.1f}/{st['MaxDD'] * 100:.0f}")(stats(*simulate(d, (
            all_rules['Long only EMA20/50 (reference)'] - short_with_stop(c, c.ewm(span=20, adjust=False).mean() < c.ewm(span=50, adjust=False).mean(), atr(df, n), 2.0)
        ).loc[start:]))) for n in (7, 10, 14, 20, 30)))
    tgt = all_rules['L/S EMA, short with 2-ATR stop']
    cell = lambda t: (lambda st: f"{st['CAGR'] * 100:5.1f}/{st['MaxDD'] * 100:4.0f}")(stats(*simulate(d, t.loc[start:])))
    base, late, lev = cell(tgt), cell(tgt.shift().fillna(0)), cell(tgt * 1.5)
    COST, ROLL = COST * 3, ROLL * 3
    hi = cell(tgt)
    COST, ROLL = COST / 3, ROLL / 3
    w(f'Stress 2-ATR stop: base {base} | costs x3 {hi} | 1 day late {late} | 1.5x {lev}')
    w('')

    w('Short trades of "L/S EMA, short with 2-ATR stop"')
    nav, pos = simulate(d, tgt.loc[start:])
    for a, b, side, r, n in trades(nav, pos):
        if side < 0:
            w(f'  {a.date()} -> {b.date()}  {n:3d} days  {pct(r):>7s}')
    yrs = nav.resample('YE').last().pct_change()
    yrs.iloc[0] = nav.resample('YE').last().iloc[0] / nav.iloc[0] - 1
    lo_nav, _ = simulate(d, all_rules['Long only EMA20/50 (reference)'].loc[start:])
    ly = lo_nav.resample('YE').last().pct_change()
    ly.iloc[0] = lo_nav.resample('YE').last().iloc[0] / lo_nav.iloc[0] - 1
    w('Year      L/S stop  long only')
    for y in yrs.index:
        w(f'  {y.year}  {pct(yrs[y]):>8s}  {pct(ly[y]):>8s}')
    w('')


def simulate_close(df, target):
    """target[t] decided near the close of day t and filled at that close."""
    c = df['close'].to_numpy()
    pos = target.fillna(0).to_numpy()
    held = np.concatenate([[0.0], pos[:-1]])
    pc = np.concatenate([[c[0]], c[:-1]])
    days = np.concatenate([[1.0], np.diff(df.index.values).astype('timedelta64[D]').astype(float)])
    cash = (1 + CASH) ** (days / 365) - 1
    carry = (1 + CARRY) ** (days / 365) - 1
    month = df.index.to_period('M')
    rolled = np.concatenate([[False], month[1:] != month[:-1]])
    r = held * (c / pc - 1) + cash - held * carry - np.abs(pos - held) * COST - rolled * np.abs(held) * ROLL
    return pd.Series(np.cumprod(1 + r), index=df.index), pd.Series(held, index=df.index)


STOP_SLIP = 0.0005   # extra slippage on intraday stop/trigger fills (~12 pts at 25,000)


def simulate_touch(df, start, fast=20, slow=50, shorts='stop', k=2.0, atr_n=14):
    """Trade the moment the live price crosses the EMA-cross level (known before the open), or the short's
    k-ATR stop. Fill at the level, or at the open if Nifty gaps through it. If the price crosses back by the close,
    reverse at the close (a whipsaw). shorts: 'none' (long/flat), 'all' (long/short), 'stop' (short with k-ATR stop)."""
    o, h, l, c = (df[x].to_numpy() for x in ('open', 'high', 'low', 'close'))
    af, as_ = 2 / (fast + 1), 2 / (slow + 1)
    ef = df['close'].ewm(span=fast, adjust=False).mean().to_numpy()
    es = df['close'].ewm(span=slow, adjust=False).mean().to_numpy()
    a = atr(df, atr_n).to_numpy()
    days = np.concatenate([[1.0], np.diff(df.index.values).astype('timedelta64[D]').astype(float)])
    month = df.index.to_period('M')
    n = len(c)
    rets, held, whip_days = np.zeros(n), np.zeros(n), np.zeros(n, bool)
    down_target = 0 if shorts == 'none' else -1
    pos = 1.0 if ef[0] > es[0] else float(down_target)
    low, stopped = c[0], False
    for i in range(1, n):
        start_pos, seg, ret, turn, slip, events = pos, c[i - 1], 0.0, 0.0, 0.0, 0

        def move(px, new, trigger=False):
            nonlocal pos, seg, ret, turn, slip, events
            ret += pos * (px / seg - 1)
            seg = px
            turn += abs(new - pos)
            slip += abs(new - pos) * STOP_SLIP if trigger else 0.0
            events += 1
            pos = new

        L = ((1 - as_) * es[i - 1] - (1 - af) * ef[i - 1]) / (af - as_)
        if pos > 0 and l[i] <= L:
            move(min(o[i], L), down_target, True)
            low, stopped = min(o[i], L), False
        elif pos < 0:
            S = low + k * a[i - 1] if shorts == 'stop' else np.inf
            trig = min(L, S)
            if h[i] >= trig:
                if L <= S:
                    move(max(o[i], L), 1.0, True)
                else:
                    move(max(o[i], S), 0.0, True)
                    stopped = True
        elif pos == 0 and h[i] >= L:
            move(max(o[i], L), 1.0, True)

        up = ef[i] > es[i]
        if up and pos != 1:
            move(c[i], 1.0)
        elif not up:
            if pos > 0:
                move(c[i], float(down_target))
                low, stopped = c[i], False
            elif pos < 0:
                low = min(low, c[i])
                if shorts == 'stop' and c[i] > low + k * a[i]:
                    move(c[i], 0.0)
                    stopped = True
        whip_days[i] = events >= 2
        ret += pos * (c[i] / seg - 1)
        cash = (1 + CASH) ** (days[i] / 365) - 1
        carry = (1 + CARRY) ** (days[i] / 365) - 1
        roll = ROLL * abs(start_pos) if month[i] != month[i - 1] else 0.0
        rets[i] = ret + cash - start_pos * carry - turn * COST - slip - roll
        held[i] = pos if pos != 0 else start_pos if events else 0.0
    i0 = df.index.searchsorted(start)
    rets[i0] = 0.0
    idx = df.index[i0:]
    whips = int(np.sum(whip_days[i0:]))
    return pd.Series(np.cumprod(1 + rets[i0:]), index=idx), pd.Series(held[i0:], index=idx), whips


def execution_modes(df, d, start, w):
    global COST, ROLL
    c = df['close']
    w('== Execution: next open vs same-day close vs intraday (the moment the signal triggers) ==')
    w('Intraday = stop/trigger order at the EMA-cross price (and the short stop), +0.05% extra slippage on those fills;')
    w('if Nifty crosses back the same day it reverses at the close (whipsaw). CAGR / MaxDD / trades per year.')
    ef, es = c.ewm(span=20, adjust=False).mean(), c.ewm(span=50, adjust=False).mean()
    up, dn = (ef > es).astype(float), ef < es
    targets = {
        'none': up,
        'all': np.sign(ef - es),
        'stop': up - short_with_stop(c, dn, atr(df, 14), 2.0),
    }
    labels = {'none': 'Long only EMA20/50', 'all': 'Long/short EMA20/50', 'stop': 'Long/short, short 2-ATR stop'}

    def fmt(nav, pos):
        s = stats(nav, pos)
        return f"{s['CAGR'] * 100:5.1f}/{s['MaxDD'] * 100:4.0f}/{s['Trades/yr']:4.1f}"

    rows = {}
    for key, tgt in targets.items():
        t = tgt.loc[start:]
        nav_t, pos_t, wh = simulate_touch(df, start, shorts=key)
        COST, ROLL = COST * 3, ROLL * 3
        hi = fmt(*simulate_touch(df, start, shorts=key)[:2])
        COST, ROLL = COST / 3, ROLL / 3
        rows[labels[key]] = {
            'next open': fmt(*simulate(d, t)),
            'same close': fmt(*simulate_close(d, t)),
            'intraday': fmt(nav_t, pos_t),
            'intraday, costs x3': hi,
            'whipsaw days/yr': f'{wh / ((d.index[-1] - d.index[0]).days / 365.25):.1f}',
        }
    w(pd.DataFrame(rows).T.to_string())
    w('')

    w('Intraday, long/short with stop: neighbouring settings (CAGR / MaxDD)')
    grid = {}
    for k in (1.5, 2.0, 2.5, 3.0):
        grid[f'k={k}'] = {f'{f}/{s_}': (lambda st: f"{st['CAGR'] * 100:5.1f}/{st['MaxDD'] * 100:4.0f}")(
            stats(*simulate_touch(df, start, f, s_, 'stop', k)[:2])) for f, s_ in ((10, 40), (15, 50), (20, 50), (20, 75), (30, 100))}
    grid['long only'] = {f'{f}/{s_}': (lambda st: f"{st['CAGR'] * 100:5.1f}/{st['MaxDD'] * 100:4.0f}")(
        stats(*simulate_touch(df, start, f, s_, 'none')[:2])) for f, s_ in ((10, 40), (15, 50), (20, 50), (20, 75), (30, 100))}
    w(pd.DataFrame(grid).to_string())
    w('')

    nav_s, _, _ = simulate_touch(df, start, shorts='stop')
    nav_l, _, _ = simulate_touch(df, start, shorts='none')
    bh, _ = simulate(d, pd.Series(1.0, index=d.index))
    yr = pd.DataFrame({'L/S stop': nav_s, 'Long only': nav_l, 'Buy & hold': bh}).resample('YE').last()
    yr = yr.pct_change().fillna(yr.iloc[0] / pd.Series({'L/S stop': nav_s.iloc[0], 'Long only': nav_l.iloc[0], 'Buy & hold': bh.iloc[0]}) - 1)
    yr.index = yr.index.year
    w('Calendar years, intraday execution')
    w(yr.to_string(float_format=lambda x: pct(x)))
    w('')


def pct(x, d=1):
    return '—' if x is None or not np.isfinite(x) else f'{x * 100:.{d}f}%'


def robustness(df, d, start, w):
    """Neighbouring parameters, 3x costs, one extra day of delay, 1.5x leverage."""
    global COST, ROLL
    c = df['close']

    def cell(tgt, lag=0, lev=1.0):
        t = (tgt.shift(lag).fillna(0) * lev).loc[start:]
        s = stats(*simulate(d, t))
        return f"{s['CAGR'] * 100:5.1f}/{s['MaxDD'] * 100:4.0f}"

    w('== Robustness: CAGR / MaxDD for neighbouring parameters (a real edge is a plateau, not a spike) ==')
    w('EMA fast > EMA slow (long only), rows fast, cols slow')
    fasts, slows = (10, 15, 20, 30, 40), (40, 50, 75, 100, 150)
    grid = {s: {f: (cell((c.ewm(span=f, adjust=False).mean() > c.ewm(span=s, adjust=False).mean()).astype(float)) if f < s else '')
                for f in fasts} for s in slows}
    w(pd.DataFrame(grid).to_string())
    w('')
    w('Close > SMA n (long only)')
    w('  ' + '  '.join(f'{n}: {cell((c > c.rolling(n).mean()).astype(float))}' for n in (30, 50, 75, 100, 125, 150, 200, 250)))
    w('')
    w('Supertrend n,m (long only), rows ATR n, cols multiplier m')
    grid = {m: {n: cell((supertrend(df, n, m) > 0).astype(float)) for n in (7, 10, 14, 20)} for m in (2.0, 2.5, 3.0, 3.5, 4.0)}
    w(pd.DataFrame(grid).to_string())
    w('')

    picks = {
        'Buy & hold': pd.Series(1.0, index=c.index),
        'EMA20 > EMA50': (c.ewm(span=20, adjust=False).mean() > c.ewm(span=50, adjust=False).mean()).astype(float),
        'Close > SMA100': (c > c.rolling(100).mean()).astype(float),
        'Close > SMA200': (c > c.rolling(200).mean()).astype(float),
        'Supertrend 10,3 long': (supertrend(df, 10, 3) > 0).astype(float),
        'Supertrend 10,3 + SMA200': ((supertrend(df, 10, 3) > 0) & (c > c.rolling(200).mean())).astype(float),
    }
    w('Stress: base | costs x3 | 1 day late | 1.5x leverage')
    for name, tgt in picks.items():
        base, late, lev = cell(tgt), cell(tgt, lag=1), cell(tgt, lev=1.5)
        COST, ROLL = COST * 3, ROLL * 3
        hi = cell(tgt)
        COST, ROLL = COST / 3, ROLL / 3
        w(f'  {name:28s} {base} | {hi} | {late} | {lev}')
    w('')

    w('Start-date sensitivity (CAGR / MaxDD from each start to today)')
    for a in ('2010-01-01', '2013-01-01', '2016-01-01', '2019-01-01', '2022-01-01'):
        row = []
        for name in ('Buy & hold', 'EMA20 > EMA50', 'Close > SMA100', 'Supertrend 10,3 long'):
            s = stats(*simulate(d.loc[a:], picks[name].loc[a:]))
            row.append(f"{name} {s['CAGR'] * 100:.1f}/{s['MaxDD'] * 100:.0f}")
        w(f'  {a[:4]}: ' + ' | '.join(row))
    w('')


def main():
    df = load()
    R = rules(df)
    start = df.index[260]                                    # all indicators warmed up
    d = df.loc[start:]
    lines = []
    w = lines.append
    w(f'NIFTY 50 futures, daily, {d.index[0].date()} -> {d.index[-1].date()} ({len(d)} sessions)')
    w(f'1x notional, signal at close -> trade next open. Cash {CASH:.0%}, carry {CARRY:.0%}/yr, cost {COST:.2%}/side, roll {ROLL:.2%}/month. Pre-tax.')
    w('')
    rows, navs = {}, {}
    for name, tgt in R.items():
        nav, pos = simulate(d, tgt.loc[start:])
        rows[name] = stats(nav, pos)
        navs[name] = nav
    tab = pd.DataFrame(rows).T
    fmt = {
        'CAGR': pct, 'MaxDD': pct, 'MAR': lambda x: f'{x:.2f}', 'Sharpe': lambda x: f'{x:.2f}', 'InMkt': lambda x: pct(x, 0),
        'Trades/yr': lambda x: f'{x:.1f}', 'Win%': lambda x: pct(x, 0), 'AvgWin': pct, 'AvgLoss': pct,
        'HoldDays': lambda x: f'{x:.0f}', 'WorstYr': pct,
    }
    w('== Full period (sorted by MAR = CAGR / max drawdown) ==')
    w(tab.sort_values('MAR', ascending=False).to_string(formatters=fmt))
    w('')

    periods = [('2008-01-01', '2013-12-31'), ('2014-01-01', '2019-12-31'), ('2020-01-01', '2026-12-31')]
    w('== CAGR / MaxDD by sub-period (does it hold up everywhere?) ==')
    sub = {}
    for name, nav in navs.items():
        row = {}
        for a, b in periods:
            s = nav.loc[a:b]
            if len(s) < 50:
                continue
            yrs = (s.index[-1] - s.index[0]).days / 365.25
            row[f'{a[:4]}-{b[2:4]} CAGR'] = (s.iloc[-1] / s.iloc[0]) ** (1 / yrs) - 1
            row[f'{a[:4]}-{b[2:4]} DD'] = (s / s.cummax() - 1).min()
        sub[name] = row
    w(pd.DataFrame(sub).T.loc[tab.sort_values('MAR', ascending=False).index].to_string(float_format=lambda x: pct(x)))
    w('')

    w('== Calendar years ==')
    pick = ['Buy & hold (long futures)', 'Close > SMA200', 'Close > SMA200, 2% band', 'TSMOM 12m (month-end)',
            'Donchian 55/20 long', 'Supertrend 10,3 long', 'Supertrend 10,3 long/short', 'EMA20 > EMA50']
    yr = pd.DataFrame({k: navs[k].resample('YE').last() for k in pick})
    yr = yr.pct_change().fillna(yr.iloc[0] / pd.Series({k: navs[k].iloc[0] for k in pick}) - 1)
    yr.index = yr.index.year
    w(yr.to_string(float_format=lambda x: pct(x)))
    w('')

    w('== Big Nifty falls: what each rule lost ==')
    events = [(str(d.index[1].date()), '2009-03-09', 'GFC tail'), ('2010-11-05', '2011-12-20', '2011'), ('2015-03-03', '2016-02-29', '2015-16'),
              ('2020-01-17', '2020-03-23', 'Covid'), ('2021-10-18', '2022-06-17', '2022'), ('2024-09-26', '2025-03-04', '2024-25')]
    ev = {}
    for k in pick:
        ev[k] = {lab: navs[k].loc[a:b].iloc[-1] / navs[k].loc[:a].iloc[-1] - 1 for a, b, lab in events}
    w(pd.DataFrame(ev).to_string(float_format=lambda x: pct(x)))
    w('')

    robustness(df, d, start, w)
    long_short(df, d, start, w)
    execution_modes(df, d, start, w)

    w('== Current signals (as of last close) ==')
    for k in pick + ['Close > SMA50', 'TSMOM blend 1/3/6/12m, scaled']:
        w(f'  {k:40s} {R[k].iloc[-1]:+.2f}')
    c = df['close']
    w(f'  Nifty close {c.iloc[-1]:.0f}  SMA200 {c.rolling(200).mean().iloc[-1]:.0f}  SMA50 {c.rolling(50).mean().iloc[-1]:.0f}  '
      f'12m {pct(c.iloc[-1] / c.iloc[-253] - 1)}  ST10,3 {"up" if supertrend(df, 10, 3).iloc[-1] > 0 else "down"}')

    OUT.write_text('\n'.join(lines), encoding='utf-8')
    print('\n'.join(lines))


if __name__ == '__main__':
    main()
