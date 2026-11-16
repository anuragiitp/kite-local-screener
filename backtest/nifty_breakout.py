"""Range-breakout rules on NIFTY 50 futures, 1x notional (fully funded), same cost/carry model as nifty_futures.py.
Daily rules: entry/exit levels are known before the open and traded with stop orders the moment the price
touches them (fill at the level, or at the open on a gap, + stop slippage).
Intraday: opening-range breakout on Yahoo 60-minute bars (~2 years) and 15-minute bars (~60 days).
Output: data/nifty_breakout.txt"""
import json
import urllib.request
from datetime import time

import numpy as np
import pandas as pd

import nifty_futures as nf
from nifty_futures import atr, load, CASH, CARRY, COST, ROLL, STOP_SLIP, TD

OUT = nf.DATA / 'nifty_breakout.txt'
INTRA_SLIP = 0.0001   # extra slippage on an intraday stop entry/exit (~2.5 pts)


def _first(vals, fn):
    vals = [v for v in vals if v == v]
    return fn(vals) if vals else np.nan


# ---------- daily stop-order simulator ----------

def sim(df, start, buy=None, sell=None, lx=None, sx=None, stop_k=None, opp_stop=False, trail_k=None,
        hold=None, eod=False, reverse=False, pessimistic=True):
    """buy/sell: entry trigger levels per day (NaN = not armed). lx/sx: exit stop levels for long/short.
    stop_k: initial stop k*ATR from entry. opp_stop: initial stop at the opposite trigger (e.g. the range low).
    trail_k: chandelier stop k*ATR from the best high/low since entry. hold: exit at the close after n days.
    eod: day trade (exit at the close). reverse: an opposite trigger closes and reverses.
    pessimistic: a stop touched on the entry day counts as hit after the entry, and on a day that touches both
    triggers the losing side is assumed to have triggered first (optimistic = the opposite)."""
    o, h, l, c = (df[x].to_numpy() for x in ('open', 'high', 'low', 'close'))
    n = len(c)
    arr = lambda x: np.full(n, np.nan) if x is None else np.asarray(x, float)
    buy, sell, lx, sx = arr(buy), arr(sell), arr(lx), arr(sx)
    a = atr(df, 14).to_numpy()
    days = np.concatenate([[1.0], np.diff(df.index.values).astype('timedelta64[D]').astype(float)])
    month = df.index.to_period('M')
    i0 = max(df.index.searchsorted(start), 1)
    rets, inmkt, trades = np.zeros(n), np.zeros(n, bool), []
    pos, epx, ei, stop, ext = 0, 0.0, 0, np.nan, 0.0
    seg = ret = turn = slip = 0.0
    i = i0

    def fill(px, new, trig):
        nonlocal pos, epx, ei, stop, ext, seg, ret, turn, slip
        ret += pos * (px / seg - 1)
        seg = px
        if pos != 0:
            trades.append((df.index[ei], df.index[i], pos, epx, px, i - ei + 1))
        d = abs(new - pos)
        turn += d
        slip += d * STOP_SLIP if trig else 0.0
        if new != 0:
            epx, ei, ext = px, i, px
            if opp_stop:
                stop = sell[i] if new > 0 else buy[i]
            elif stop_k:
                stop = px - new * stop_k * a[i - 1]
            else:
                stop = np.nan
        pos = new

    def exit_level():
        if pos > 0:
            return _first([lx[i], stop, sell[i] if reverse else np.nan], max)
        return _first([sx[i], stop, buy[i] if reverse else np.nan], min)

    for i in range(i0, n):
        start_pos, seg, ret, turn, slip, exited = pos, c[i - 1], 0.0, 0.0, 0.0, 0
        if pos != 0:
            S = exit_level()
            if pos > 0 and l[i] <= S:
                exited = 1
                fill(min(o[i], S), 0, True)
            elif pos < 0 and h[i] >= S:
                exited = -1
                fill(max(o[i], S), 0, True)
        if pos == 0:
            lt = buy[i] == buy[i] and h[i] >= buy[i] and exited != 1
            st = sell[i] == sell[i] and l[i] <= sell[i] and exited != -1
            if lt and st:
                # daily bars can't tell which side came first: take the worse (or better) outcome at the close
                rl, rs = c[i] / max(o[i], buy[i]) - 1, 1 - c[i] / min(o[i], sell[i])
                lt = rl <= rs if pessimistic else rl > rs
                st = not lt
            if lt or st:
                fill(max(o[i], buy[i]) if lt else min(o[i], sell[i]), 1 if lt else -1, True)
                S = exit_level()
                if pos > 0 and l[i] <= S and (pessimistic or c[i] <= S):
                    fill(S if pessimistic else c[i], 0, pessimistic)
                elif pos < 0 and h[i] >= S and (pessimistic or c[i] >= S):
                    fill(S if pessimistic else c[i], 0, pessimistic)
        if pos != 0:
            if eod or (hold and i - ei + 1 >= hold):
                fill(c[i], 0, False)
            elif trail_k:
                if pos > 0:
                    ext = max(ext, h[i])
                    stop = _first([stop, ext - trail_k * a[i]], max)
                else:
                    ext = min(ext, l[i])
                    stop = _first([stop, ext + trail_k * a[i]], min)
        ret += pos * (c[i] / seg - 1)
        cash = (1 + CASH) ** (days[i] / 365) - 1
        carry = (1 + CARRY) ** (days[i] / 365) - 1
        roll = ROLL * abs(start_pos) if month[i] != month[i - 1] else 0.0
        rets[i] = ret + cash - start_pos * carry - turn * COST - slip - roll
        inmkt[i] = start_pos != 0 or pos != 0 or turn > 0
    if pos != 0:
        trades.append((df.index[ei], None, pos, epx, c[-1], n - ei))
    idx = df.index[i0:]
    return pd.Series(np.cumprod(1 + rets[i0:]), index=idx), trades, pd.Series(inmkt[i0:], index=idx)


def trade_ret(t):
    return t[2] * (t[4] / t[3] - 1) - 2 * COST - STOP_SLIP


def cagr(nav):
    return (nav.iloc[-1] / nav.iloc[0]) ** (365.25 / max((nav.index[-1] - nav.index[0]).days, 1)) - 1


def stats(nav, tr, inm):
    r = nav.pct_change().dropna()
    yrs = (nav.index[-1] - nav.index[0]).days / 365.25
    dd = (nav / nav.cummax() - 1).min()
    ex = r - ((1 + CASH) ** (1 / TD) - 1)
    tr = [t for t in tr if t[1] is not None]
    rr = np.array([trade_ret(t) for t in tr]) if tr else np.array([])
    wins, losses = rr[rr > 0], rr[rr <= 0]
    g = cagr(nav)
    return {
        'CAGR': g, 'MaxDD': dd, 'MAR': g / -dd if dd < 0 else np.nan,
        'Sharpe': ex.mean() / ex.std() * np.sqrt(TD),
        'InMkt': inm.mean(), 'Trades/yr': len(rr) / yrs,
        'Win%': len(wins) / len(rr) if len(rr) else np.nan,
        'AvgWin': wins.mean() if len(wins) else np.nan,
        'AvgLoss': losses.mean() if len(losses) else np.nan,
        'PF': wins.sum() / -losses.sum() if losses.sum() < 0 else np.nan,
        'Hold': np.median([t[5] for t in tr]) if tr else np.nan,
    }


# ---------- rules ----------

def prev_period_range(df, freq):
    key = df.index.to_period(freq)
    g = df.groupby(key).agg(high=('high', 'max'), low=('low', 'min')).shift(1)
    return pd.Series(g['high'].reindex(key).to_numpy(), df.index), pd.Series(g['low'].reindex(key).to_numpy(), df.index)


def strategies(df):
    o, h, l, c = df['open'], df['high'], df['low'], df['close']
    hi = lambda n: h.rolling(n).max().shift()
    lo = lambda n: l.rolling(n).min().shift()
    ema = lambda n: c.ewm(span=n, adjust=False).mean()
    up = (ema(20) > ema(50)).shift(1, fill_value=False)
    S = {}
    for N, M in ((10, 5), (20, 10), (55, 20), (100, 50)):
        S[f'Donchian {N}/{M} long'] = dict(buy=hi(N), lx=lo(M))
        S[f'Donchian {N}/{M} long/short'] = dict(buy=hi(N), sell=lo(N), lx=lo(M), sx=hi(M))
    S['Donchian 20 stop-and-reverse'] = dict(buy=hi(20), sell=lo(20), reverse=True)
    S['Donchian 20/10 long, trend filter'] = dict(buy=hi(20).where(up), lx=lo(10))
    S['Donchian 20/10 L/S, trend filter'] = dict(buy=hi(20).where(up), sell=lo(20).where(~up), lx=lo(10), sx=hi(10))
    S['Donchian 55 L/S, 3-ATR trailing'] = dict(buy=hi(55), sell=lo(55), stop_k=2, trail_k=3)

    for freq, name in (('W-FRI', 'week'), ('M', 'month')):
        ph, pl = prev_period_range(df, freq)
        S[f'Prev-{name} range stop-and-reverse'] = dict(buy=ph, sell=pl, reverse=True)
        S[f'Prev-{name} range long'] = dict(buy=ph, lx=pl)
        S[f'Prev-{name} range long, trend filter'] = dict(buy=ph.where(up), lx=pl)

    rng = (h - l).shift()
    for k in (0.3, 0.5, 0.7):
        S[f'Vol breakout k={k} day trade'] = dict(buy=o + k * rng, sell=o - k * rng, eod=True)
    S['Vol breakout k=0.5 day trade, stop opposite'] = dict(buy=o + 0.5 * rng, sell=o - 0.5 * rng, eod=True, opp_stop=True)
    S['Vol breakout k=0.5 day trade, trend side'] = dict(buy=(o + 0.5 * rng).where(up), sell=(o - 0.5 * rng).where(~up), eod=True)
    S['Prev-day high/low day trade, stop opposite'] = dict(buy=h.shift(), sell=l.shift(), eod=True, opp_stop=True)

    r = h - l
    nr7 = r == r.rolling(7).min()
    inside = (h < h.shift()) & (l > l.shift())
    for nm, cond in (('NR7', nr7), ('Inside day', inside)):
        lv = dict(buy=h.where(cond).shift(), sell=l.where(cond).shift(), opp_stop=True)
        S[f'{nm} breakout, exit close'] = dict(lv, eod=True)
        S[f'{nm} breakout, hold 5d'] = dict(lv, hold=5)
        S[f'{nm} breakout, 2-ATR trail'] = dict(lv, trail_k=2)
        S[f'{nm} breakout, trend side, 2-ATR trail'] = dict(
            buy=h.where(cond).shift().where(up), sell=l.where(cond).shift().where(~up), opp_stop=True, trail_k=2)

    width = (hi(20) - lo(20)) / c.shift()
    sq = width <= width.rolling(250).quantile(0.2)
    S['Squeeze (20d range in bottom 20%) L/S, 3-ATR trail'] = dict(buy=hi(20).where(sq), sell=lo(20).where(sq), opp_stop=True, trail_k=3)
    S['Squeeze long, 3-ATR trail'] = dict(buy=hi(20).where(sq), opp_stop=False, stop_k=2, trail_k=3)
    return S


def benchmarks(df, start):
    d = df.loc[start:]
    c = df['close']
    ef, es = c.ewm(span=20, adjust=False).mean(), c.ewm(span=50, adjust=False).mean()
    B = {
        'Buy & hold (long futures)': pd.Series(1.0, index=c.index),
        'EMA20>50 long (next open)': (ef > es).astype(float),
        'EMA20/50 L/S, short 2-ATR stop': (ef > es).astype(float) - nf.short_with_stop(c, ef < es, atr(df, 14), 2.0),
    }
    out = {}
    for k, t in B.items():
        nav, pos = nf.simulate(d, t.loc[start:])
        s = nf.stats(nav, pos)
        out[k] = (nav, {'CAGR': s['CAGR'], 'MaxDD': s['MaxDD'], 'MAR': s['MAR'], 'Sharpe': s['Sharpe'],
                        'InMkt': s['InMkt'], 'Trades/yr': s['Trades/yr'], 'Win%': s['Win%']})
    return out


# ---------- intraday opening-range breakout ----------

def fetch_intraday(interval, rng):
    url = f'https://query1.finance.yahoo.com/v8/finance/chart/%5ENSEI?interval={interval}&range={rng}'
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    r = json.loads(urllib.request.urlopen(req, timeout=30).read())['chart']['result'][0]
    q = r['indicators']['quote'][0]
    t = pd.to_datetime(r['timestamp'], unit='s', utc=True).tz_convert('Asia/Kolkata').tz_localize(None)
    df = pd.DataFrame({k: q[k] for k in ('open', 'high', 'low', 'close')}, index=t, dtype=float).dropna()
    tod = df.index.time
    df = df[(tod >= time(9, 15)) & (tod < time(15, 30)) & (df.index.second == 0)]
    now = pd.Timestamp.now(tz='Asia/Kolkata').tz_localize(None)
    if now.hour < 16:
        df = df[df.index.normalize() < now.normalize()]
    return df


def orb(bars, or_bars, trend=None, stop='opposite', narrow=False, trend_side=False):
    """One trade a day: enter on the first break of the opening range, stop at the other side (or the middle),
    exit at the close. Pessimistic when a bar touches both the entry and the stop."""
    out, widths = [], []
    for day, g in bars.groupby(bars.index.normalize()):
        if len(g) < or_bars + 2:
            continue
        orh, orl = g['high'].iloc[:or_bars].max(), g['low'].iloc[:or_bars].min()
        w = (orh - orl) / orl
        ok = not narrow or (len(widths) >= 20 and w < np.median(widths[-60:]))
        widths.append(w)
        if not ok:
            continue
        up = trend.get(day) if trend is not None else None
        allow_l = not trend_side or up is True
        allow_s = not trend_side or up is False
        pos, entry, sl, ex, stopped = 0, 0.0, 0.0, None, False
        for b in g.iloc[or_bars:].itertuples():
            if pos == 0 and ex is None:
                lt, st = allow_l and b.high >= orh, allow_s and b.low <= orl
                if lt and st:
                    lt = max(orh - b.open, 0) <= max(b.open - orl, 0)
                    st = not lt
                if lt or st:
                    pos = 1 if lt else -1
                    entry = max(b.open, orh) if lt else min(b.open, orl)
                    sl = (orl if lt else orh) if stop == 'opposite' else (orh + orl) / 2
                    if (pos > 0 and b.low <= sl) or (pos < 0 and b.high >= sl):
                        ex, stopped = sl, True
                        break
                    continue
            if pos > 0 and b.low <= sl:
                ex, stopped = min(b.open, sl), True
                break
            if pos < 0 and b.high >= sl:
                ex, stopped = max(b.open, sl), True
                break
        if pos == 0:
            continue
        if ex is None:
            ex = g['close'].iloc[-1]
        pts = pos * (ex - entry)
        cost = entry * (2 * COST + INTRA_SLIP * (1 + stopped))
        out.append({'date': day, 'side': pos, 'entry': entry, 'exit': ex, 'pts': pts, 'net': pts - cost,
                    'ret': (pts - cost) / entry, 'stopped': stopped})
    return pd.DataFrame(out)


def orb_summary(t, days):
    if t.empty:
        return {'Trades': 0}
    eq = t['ret'].cumsum()
    return {
        'Trades': len(t), 'Days': days, 'Win%': (t['net'] > 0).mean(),
        'Gross pts': t['pts'].mean(), 'Net pts': t['net'].mean(),
        'PF': t.loc[t.net > 0, 'net'].sum() / -t.loc[t.net <= 0, 'net'].sum(),
        'Total net %': t['ret'].sum(), 'MaxDD %': (eq - eq.cummax()).min(),
        'Stopped%': t['stopped'].mean(),
    }


def vol_breakout_60(bars, df, k):
    """Volatility breakout replayed on 60-minute bars (first touch wins; same-bar double touch = worse side)."""
    rng = (df['high'] - df['low']).shift()
    out = []
    for day, g in bars.groupby(bars.index.normalize()):
        if day not in rng.index or rng.get(day) != rng.get(day):
            continue
        op, cl = g['open'].iloc[0], g['close'].iloc[-1]
        b, s = op + k * rng[day], op - k * rng[day]
        pos = 0
        for x in g.itertuples():
            hb, hs = x.high >= b, x.low <= s
            if hb and hs:
                pos, ent = (1, b) if cl / b - 1 <= 1 - cl / s else (-1, s)
            elif hb or hs:
                pos, ent = (1, max(x.open, b)) if hb else (-1, min(x.open, s))
            if pos:
                break
        if pos:
            pts = pos * (cl - ent)
            cost = ent * (2 * COST + INTRA_SLIP)
            out.append({'date': day, 'side': pos, 'entry': ent, 'exit': cl, 'pts': pts, 'net': pts - cost,
                        'ret': (pts - cost) / ent, 'stopped': False})
    return pd.DataFrame(out)


# ---------- report ----------

def fmt_table(rows, pct_cols, num_cols):
    df = pd.DataFrame(rows).T
    for k in pct_cols:
        if k in df:
            df[k] = df[k].map(lambda x: '' if pd.isna(x) else f'{x * 100:.1f}%')
    for k in num_cols:
        if k in df:
            df[k] = df[k].map(lambda x: '' if pd.isna(x) else f'{x:.2f}')
    return df.to_string()


def main():
    df = load()
    start = df.index[260]
    lines = []
    w = lines.append
    w(f'NIFTY futures range-breakout rules, {start.date()} -> {df.index[-1].date()}, 1x notional, pre-tax')
    w(f'Costs {COST * 100:.2f}%/side + {STOP_SLIP * 100:.2f}% slippage on every stop fill, carry {CARRY:.0%} (long pays), '
      f'cash {CASH:.0%} on capital. Entries/exits fill intraday at the level (or the open on a gap).')
    w('CAGR = pessimistic intraday order (stop after entry; on a day touching both triggers the losing side came first).')
    w('CAGR opt = optimistic order. Truth lies between. Excess = CAGR - 6% cash yield (what the trading itself adds).')
    w('')

    S = strategies(df)
    rows, navs, trs = {}, {}, {}
    periods = (('2008-10', '2014-12'), ('2015-01', '2019-12'), ('2020-01', None))
    for name, kw in S.items():
        nav, tr, inm = sim(df, start, **kw)
        nav_o, _, _ = sim(df, start, pessimistic=False, **kw)
        s = stats(nav, tr, inm)
        s['CAGR opt'] = cagr(nav_o)
        s['Excess'] = s['CAGR'] - CASH
        for a, b in periods:
            s[f'{a[2:4]}-{(b or "26")[2:4]}'] = cagr(nav.loc[a:b])
        rows[name], navs[name], trs[name] = s, nav, tr
    B = benchmarks(df, start)
    for k, (nav, s) in B.items():
        for a, b in periods:
            s[f'{a[2:4]}-{(b or "26")[2:4]}'] = cagr(nav.loc[a:b])
        s['Excess'] = s['CAGR'] - CASH
        rows['[bench] ' + k] = s
        navs['[bench] ' + k] = nav
    cols = ['CAGR', 'CAGR opt', 'Excess', 'MaxDD', 'MAR', 'Sharpe', 'InMkt', 'Trades/yr', 'Win%', 'AvgWin', 'AvgLoss', 'PF', 'Hold',
            '08-14', '15-19', '20-26']
    table = {k: {c_: v.get(c_, np.nan) for c_ in cols} for k, v in rows.items()}
    w('== Daily-bar breakout rules ==')
    w(fmt_table(table, ['CAGR', 'CAGR opt', 'Excess', 'MaxDD', 'InMkt', 'Win%', 'AvgWin', 'AvgLoss', '08-14', '15-19', '20-26'],
                ['MAR', 'Sharpe', 'Trades/yr', 'PF', 'Hold']))
    w('')

    w('== Donchian grid: entry N-day high/low, exit M-day opposite (CAGR / MaxDD) ==')
    o, h, l, c = df['open'], df['high'], df['low'], df['close']
    hi = lambda n: h.rolling(n).max().shift()
    lo = lambda n: l.rolling(n).min().shift()
    for side in ('long', 'long/short'):
        grid = {}
        for N in (10, 20, 30, 40, 55, 80, 100, 150):
            row = {}
            for frac in (0.25, 0.5, 1.0):
                M = max(int(N * frac), 2)
                kw = dict(buy=hi(N), lx=lo(M)) if side == 'long' else dict(buy=hi(N), sell=lo(N), lx=lo(M), sx=hi(M))
                nav, tr, inm = sim(df, start, **kw)
                st = stats(nav, tr, inm)
                row[f'M={frac:g}N'] = f"{st['CAGR'] * 100:5.1f}/{st['MaxDD'] * 100:4.0f}"
            grid[f'N={N}'] = row
        w(f'{side}:')
        w(pd.DataFrame(grid).T.to_string())
    w('')

    w('== Volatility breakout day trade: buy open + k x yesterday range, sell open - k x range, exit close ==')
    w('CAGR pessimistic .. optimistic (which trigger came first on days touching both)')
    rng = (h - l).shift()
    ef, es = c.ewm(span=20, adjust=False).mean(), c.ewm(span=50, adjust=False).mean()
    up = (ef > es).shift(1, fill_value=False)
    grid = {}
    for k in (0.2, 0.3, 0.4, 0.5, 0.6, 0.8, 1.0):
        row = {}
        for nm, kw in (('both', dict(buy=o + k * rng, sell=o - k * rng)),
                       ('trend side', dict(buy=(o + k * rng).where(up), sell=(o - k * rng).where(~up))),
                       ('long only', dict(buy=o + k * rng))):
            nav, tr, inm = sim(df, start, eod=True, **kw)
            st = stats(nav, tr, inm)
            opt = cagr(sim(df, start, eod=True, pessimistic=False, **kw)[0])
            row[nm] = f"{st['CAGR'] * 100:5.1f} .. {opt * 100:5.1f} ({st['Trades/yr']:.0f}/yr)"
        grid[f'k={k}'] = row
    w(pd.DataFrame(grid).T.to_string())
    w('')

    breakout = {k: v for k, v in rows.items() if not k.startswith('[bench]') and v['Hold'] > 1}
    best = sorted(breakout, key=lambda k: -(breakout[k]['MAR'] if breakout[k]['MAR'] == breakout[k]['MAR'] else -9))[:4]
    keep = best + ['[bench] Buy & hold (long futures)', '[bench] EMA20/50 L/S, short 2-ATR stop']
    yr = pd.DataFrame({k: navs[k] for k in keep}).resample('YE').last()
    first = pd.DataFrame({k: navs[k] for k in keep}).iloc[0]
    yr = yr.pct_change().fillna(yr.iloc[0] / first - 1)
    yr.index = yr.index.year
    w('== Calendar years: 4 best multi-day breakout rules by MAR vs benchmarks ==')
    for i, k in enumerate(keep):
        w(f'  [{i + 1}] {k}')
    yr.columns = [f'[{i + 1}]' for i in range(len(keep))]
    w(yr.to_string(float_format=lambda x: f'{x * 100:6.1f}%'))
    w('')

    w(f'== Trades 2025-2026: {best[0]} ==')
    for t in trs[best[0]]:
        if t[0].year < 2025 and (t[1] is None or t[1].year < 2025):
            continue
        ex = 'open' if t[1] is None else str(t[1].date())
        w(f"  {'LONG ' if t[2] > 0 else 'SHORT'} {t[0].date()} @{t[3]:7.0f} -> {ex:10} @{t[4]:7.0f} {t[5]:3d}d "
          f"{t[2] * (t[4] - t[3]):+6.0f} pts {trade_ret(t) * 100:+5.1f}%")
    w('')

    w('== Intraday opening-range breakout (ORB), one trade a day, exit at the close ==')
    w(f'Costs {2 * COST * 100:.2f}% round trip + {INTRA_SLIP * 100:.2f}% per stop fill. Pts are Nifty points per trade; '
      'Total net % = sum of per-trade returns at 1x notional.')
    trend = {d: bool(v) for d, v in ((ef > es).shift(1).dropna().items())}
    for interval, rng_, or_list in (('60m', '730d', ((1, 'first hour'),)), ('15m', '60d', ((1, 'first 15 min'), (2, 'first 30 min'), (4, 'first hour')))):
        try:
            bars = fetch_intraday(interval, rng_)
        except Exception as e:
            w(f'  {interval}: download failed ({e})')
            continue
        ndays = bars.index.normalize().nunique()
        w(f'-- {interval} bars, {bars.index[0].date()} -> {bars.index[-1].date()} ({ndays} days)')
        res = {}
        for nb, label in or_list:
            res[f'{label}, stop opposite'] = orb_summary(orb(bars, nb), ndays)
            res[f'{label}, stop middle'] = orb_summary(orb(bars, nb, stop='middle'), ndays)
            res[f'{label}, trend side only'] = orb_summary(orb(bars, nb, trend, trend_side=True), ndays)
            res[f'{label}, narrow range only'] = orb_summary(orb(bars, nb, narrow=True), ndays)
        w(fmt_table(res, ['Win%', 'Total net %', 'MaxDD %', 'Stopped%'], ['Gross pts', 'Net pts', 'PF']))
        if interval == '60m':
            vb = {}
            for kk in (0.3, 0.5, 0.8):
                vb[f'vol breakout k={kk} (true order)'] = orb_summary(vol_breakout_60(bars, df, kk), ndays)
            w(fmt_table(vb, ['Win%', 'Total net %', 'MaxDD %', 'Stopped%'], ['Gross pts', 'Net pts', 'PF']))
            t = orb(bars, 1)
            t['year'] = pd.to_datetime(t['date']).dt.year
            by = t.groupby('year').agg(trades=('net', 'size'), win=('net', lambda x: (x > 0).mean()),
                                       net_pts=('net', 'sum'), net_pct=('ret', 'sum'))
            w('first-hour ORB, stop opposite, by year:')
            w(by.to_string(formatters={'win': '{:.0%}'.format, 'net_pts': '{:+.0f}'.format, 'net_pct': lambda x: f'{x * 100:+.1f}%'}))
        w('')

    w('== Levels for the next session ==')
    last = df.index[-1]
    ph, pl = prev_period_range(df, 'W-FRI')
    nxt_week = last.to_period('W-FRI') != (last + pd.offsets.BDay()).to_period('W-FRI')
    w(f'  last close {last.date()}: {c.iloc[-1]:.0f}, ATR14 {atr(df, 14).iloc[-1]:.0f}, EMA20>EMA50: {bool(ef.iloc[-1] > es.iloc[-1])}')
    for n in (10, 20, 55):
        w(f'  {n}-day high {h.iloc[-n:].max():.0f} / low {l.iloc[-n:].min():.0f}')
    wk = df.loc[df.index.to_period('W-FRI') == last.to_period('W-FRI')]
    w(f'  prev-week range for next session: {(wk.high.max() if nxt_week else ph.iloc[-1]):.0f} / {(wk.low.min() if nxt_week else pl.iloc[-1]):.0f}')
    r = h - l
    w(f'  today NR7: {bool(r.iloc[-1] == r.iloc[-7:].min())}, inside day: {bool(h.iloc[-1] < h.iloc[-2] and l.iloc[-1] > l.iloc[-2])}, '
      f'yesterday range {r.iloc[-1]:.0f} -> vol breakout k=0.5: open +/- {0.5 * r.iloc[-1]:.0f}')

    OUT.write_text('\n'.join(lines), encoding='utf-8')
    print('\n'.join(lines))


if __name__ == '__main__':
    main()
