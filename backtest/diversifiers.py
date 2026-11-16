"""Diversifiers for the SUMMIT-20 momentum strategy: sleeves that can run in parallel, their correlation with
momentum, holdings overlap, and blended portfolios. Point-in-time NSE universe (Nifty 500 snapshots), pre-tax.
Output: data/diversifiers.txt"""
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np
import pandas as pd

import nifty_futures as nf
from data import fetch_yahoo
from engine import Config, TRADING_DAYS, _schedule, eligible, prepared, run

OUT = Path(__file__).parent / 'data' / 'diversifiers.txt'
CASH = 0.06
COST = 0.002         # per side for large/mid caps: STT 0.1%, stamp, exchange, GST, slippage
START = '2008-01-01'
RULE_C = Config(universe='pit', ma_exit=200, regime='no_new_buys', entry_breakout=0.10, breakout_days=252,
                buy_rank=30, rank_exit_ma=50, tax=False, start=START)
BASE = Config(universe='pit')
DAILY_CASH = (1 + CASH) ** (1 / TRADING_DAYS) - 1


def _momentum(off):
    r = run(RULE_C.but(rebal_offset=off))
    return r['nav'], r['holdings']


# ---------- helpers ----------

def liquid_mask(d, top):
    """Point-in-time: top-N stocks by 60-day median traded value among eligible index members, set each month-end."""
    af = d['af']
    dates = af.index
    me = np.flatnonzero(_schedule(dates, 'M'))
    mask = pd.DataFrame(False, index=dates, columns=af.columns)
    stock = d['stock']
    for k, i in enumerate(me):
        ok = eligible(d, i, BASE) & stock
        tv = d['tv'].iloc[i].where(ok)
        pick = tv.dropna().nlargest(top).index
        end = me[k + 1] if k + 1 < len(me) else len(dates) - 1
        mask.iloc[i + 1:end + 1, mask.columns.get_indexer(pick)] = True
    return mask


def run_weights(d, picks_at, freq, start=START, cost=COST):
    """Equal weight in picks_at(i) chosen at each period-end close i, traded at the next close; cash earns 6%."""
    dates = d['af'].index
    R = d['rets'].fillna(0).to_numpy()
    sig = _schedule(dates, freq)
    i0 = dates.searchsorted(pd.Timestamp(start))
    vals, cash = np.zeros(R.shape[1]), 1.0
    nav, picks, pending = np.ones(len(dates)), {}, None
    for i in range(i0, len(dates)):
        vals *= 1 + R[i]
        cash *= 1 + DAILY_CASH
        if pending is not None:
            total = vals.sum() + cash
            new = np.zeros_like(vals)
            if len(pending):
                new[pending] = total / len(pending)
            turn = np.abs(new - vals).sum()
            total -= turn * cost
            new *= total / max(new.sum(), 1e-12) if len(pending) else 0
            vals, cash = new, total - new.sum()
            pending = None
        nav[i] = vals.sum() + cash
        if sig[i]:
            p = picks_at(i)
            picks[dates[i]] = list(p)
            pending = d['af'].columns.get_indexer(p)
    return pd.Series(nav[i0:], index=dates[i0:]), picks


def mean_reversion(d, uni, rsi, start=START, slots=10, rsi_max=10.0, max_days=10, cost=COST, trend=200):
    """Buy the most oversold liquid stocks in an uptrend (RSI2 < rsi_max, close > 200DMA) at the next open,
    sell at the next open once the close is back above the 5-day average or after max_days."""
    af = d['af'].to_numpy()
    op = d['open'].to_numpy()
    ma5 = d['af'].rolling(5, min_periods=5).mean().to_numpy()
    mat = d['ma'][trend].to_numpy() if trend else np.zeros_like(af)
    U = uni.to_numpy()
    RS = rsi.to_numpy()
    dates = d['af'].index
    i0 = dates.searchsorted(pd.Timestamp(start))
    cash, pos, buys, sells = 1.0, {}, [], []
    nav = np.ones(len(dates))
    ntr, wins, hold_days, exposure = 0, 0, [], np.zeros(len(dates))

    def px(a, i, j, fallback):
        v = a[i, j]
        return v if np.isfinite(v) and v > 0 else fallback

    for i in range(i0, len(dates)):
        for j in sells:
            p = pos.pop(j)
            x = px(op, i, j, px(af, i, j, p['last']))
            cash += p['sh'] * x * (1 - cost)
            ntr += 1
            wins += x * (1 - cost) > p['entry'] * (1 + cost)
            hold_days.append(i - p['i'])
        if buys:
            nav_open = cash + sum(p['sh'] * p['last'] for p in pos.values())
            for j in buys:
                if len(pos) >= slots:
                    break
                x = px(op, i, j, np.nan)
                amt = min(nav_open / slots, cash)
                if not np.isfinite(x) or amt < nav_open / slots * 0.5:
                    continue
                pos[j] = {'sh': amt * (1 - cost) / x, 'entry': x, 'i': i, 'last': x, 'stale': 0}
                cash -= amt
        buys, sells = [], []
        cash *= 1 + DAILY_CASH
        for j, p in pos.items():
            v = af[i, j]
            if np.isfinite(v):
                p['last'], p['stale'] = v, 0
            else:
                p['stale'] += 1
        nav[i] = cash + sum(p['sh'] * p['last'] for p in pos.values())
        exposure[i] = len(pos) / slots
        for j, p in pos.items():
            if p['stale'] > 10 or (np.isfinite(ma5[i, j]) and af[i, j] > ma5[i, j]) or i - p['i'] >= max_days:
                sells.append(j)
        free = slots - len(pos) + len(sells)
        if free > 0:
            ok = U[i] & (RS[i] < rsi_max) & (af[i] > mat[i])
            cand = np.flatnonzero(ok)
            cand = [j for j in cand[np.argsort(RS[i, cand])] if j not in pos][:free]
            buys = cand
    idx = dates[i0:]
    return pd.Series(nav[i0:], index=idx), {'trades/yr': ntr / ((idx[-1] - idx[0]).days / 365.25),
                                             'win%': wins / max(ntr, 1), 'hold': np.median(hold_days),
                                             'invested': exposure[i0:].mean()}


def rsi2(af):
    delta = af.diff()
    up = delta.clip(lower=0).ewm(alpha=0.5, adjust=False).mean()
    dn = (-delta.clip(upper=0)).ewm(alpha=0.5, adjust=False).mean()
    return 100 - 100 / (1 + up / dn.replace(0, np.nan))


def etf_panel():
    cache = Path(__file__).parent / 'data' / 'etfs.pkl'
    if cache.exists() and (pd.Timestamp.now() - pd.Timestamp(cache.stat().st_mtime, unit='s')).days < 1:
        return pd.read_pickle(cache)
    names = {'NIFTY': 'NIFTYBEES.NS', 'NEXT50': 'JUNIORBEES.NS', 'GOLD': 'GOLDBEES.NS', 'US': 'MON100.NS'}
    df = pd.DataFrame({k: fetch_yahoo(t, '2008-01-01')['adjclose'] for k, t in names.items()}).sort_index()
    df = df.where(df.pct_change(fill_method=None).abs() < 0.25)   # drop bad prints
    df.to_pickle(cache)
    return df


def asset_sleeves(etf):
    """Monthly ETF sleeves (pre-tax, 0.1% per side)."""
    m = etf.resample('ME').last()
    r = m.pct_change(fill_method=None)
    cash_m = (1 + CASH) ** (1 / 12) - 1
    out = {}
    w_static = {'NIFTY': 0.4, 'NEXT50': 0.2, 'GOLD': 0.2, 'US': 0.2}
    rows = []
    for t in range(1, len(m)):
        avail = [k for k in w_static if np.isfinite(r.iloc[t][k])]
        ws = {k: w_static[k] for k in avail}
        tot = sum(ws.values())
        rows.append(sum(ws[k] / tot * r.iloc[t][k] for k in avail))
    out['All-weather ETFs 40/20/20/20 (Nifty/Next50/Gold/US)'] = pd.Series(rows, index=m.index[1:])
    out['Gold (GOLDBEES)'] = r['GOLD'].iloc[1:]
    # dual momentum: average of 3/6/12m returns, hold top 2 that beat cash, else cash
    score = sum(m.pct_change(n, fill_method=None) for n in (3, 6, 12)) / 3
    rows, prev = [], set()
    for t in range(1, len(m)):
        s = score.iloc[t - 1].dropna()
        hurdle = (1 + CASH) ** 0.5 - 1
        pick = [k for k in s.sort_values(ascending=False).index[:2] if s[k] > hurdle]
        ret = sum(r.iloc[t][k] for k in pick) / 2 + (2 - len(pick)) / 2 * cash_m
        turn = len(set(pick) ^ prev) / 2
        rows.append(ret - turn * 0.002)
        prev = set(pick)
    out['ETF rotation: top 2 of Nifty/Next50/Gold/US by 3-6-12m mom'] = pd.Series(rows, index=m.index[1:])
    return {k: (1 + v.fillna(0)).cumprod() for k, v in out.items()}


# ---------- stats ----------

def mstats(nav):
    m = nav.resample('ME').last().dropna()
    r = m.pct_change().dropna()
    yrs = len(r) / 12
    cagr = (m.iloc[-1] / m.iloc[0]) ** (1 / yrs) - 1
    vol = r.std() * np.sqrt(12)
    dd = (m / m.cummax() - 1).min()
    yr = m.resample('YE').last().pct_change().dropna()
    return {'CAGR': cagr, 'Vol': vol, 'Sharpe': (r.mean() * 12 - CASH) / vol, 'MaxDD': dd,
            'Calmar': cagr / -dd if dd < 0 else np.nan, 'WorstYr': yr.min(), 'Worst12m': m.pct_change(12).min()}


def pct(x):
    return '' if x is None or not np.isfinite(x) else f'{x * 100:.1f}%'


def table(rows):
    df = pd.DataFrame(rows).T
    for c in df.columns:
        if c in ('Sharpe', 'Calmar', 'trades/yr', 'hold', 'overlap'):
            df[c] = df[c].map(lambda x: '' if pd.isna(x) else f'{x:.2f}')
        else:
            df[c] = df[c].map(lambda x: '' if pd.isna(x) else pct(x))
    return df.to_string()


def blend(navs, weights):
    m = pd.DataFrame({k: navs[k].resample('ME').last() for k in weights}).dropna()
    r = m.pct_change().dropna()
    w = pd.Series(weights) / sum(weights.values())
    return (1 + (r * w).sum(axis=1)).cumprod()


def main():
    lines = []
    w = lines.append
    with ProcessPoolExecutor(max_workers=4) as pool:
        mom = list(pool.map(_momentum, (0, 5, 10, 15)))
    mom_nav = pd.concat([n for n, _ in mom], axis=1).pct_change().mean(axis=1).fillna(0).add(1).cumprod()
    mom_hold = dict(mom[0][1])

    d = prepared('pit')
    af = d['af']
    vol = d['vol']
    top100, top200 = liquid_mask(d, 100), liquid_mask(d, 200)
    r12 = af / af.shift(TRADING_DAYS) - 1

    def lowvol(mask, n=30):
        return lambda i: vol.iloc[i].where(mask.iloc[i]).dropna().nsmallest(n).index

    def alpha_lowvol(mask, n=30):
        def f(i):
            ok = mask.iloc[i] & vol.iloc[i].notna() & r12.iloc[i].notna()
            v, a = vol.iloc[i][ok], (r12.iloc[i] / vol.iloc[i])[ok]
            z = lambda s: (s - s.mean()) / s.std()
            return (z(a) - z(v)).nlargest(n).index
        return f

    def ew(mask):
        return lambda i: mask.columns[mask.iloc[i].to_numpy()]

    def weekly_losers(mask, n=10):
        r5 = af / af.shift(5) - 1
        ma200 = d['ma'][200]
        return lambda i: r5.iloc[i].where(mask.iloc[i] & (af.iloc[i] > ma200.iloc[i])).dropna().nsmallest(n).index

    sleeves, extra, picks = {}, {}, {}
    sleeves['Momentum SUMMIT-20 (Rule C, pre-tax)'] = mom_nav
    for name, (fn, freq) in {
        'Low-vol 30 of top-100 (quarterly)': (lowvol(top100), 'Q'),
        'Low-vol 30 of top-200 (quarterly)': (lowvol(top200), 'Q'),
        'Alpha + low-vol 30 of top-200 (quarterly)': (alpha_lowvol(top200), 'Q'),
        'Equal weight top-100 (quarterly)': (ew(top100), 'Q'),
        'Weekly losers: 10 worst 5d of top-100 above 200DMA': (weekly_losers(top100), 'W'),
    }.items():
        sleeves[name], picks[name] = run_weights(d, fn, freq)
    rs = rsi2(af)
    for name, kw in {
        'Mean reversion RSI2<10, top-100, 10 slots': dict(uni=top100),
        'Mean reversion RSI2<5, top-200, 10 slots': dict(uni=top200, rsi_max=5),
        'Mean reversion RSI2<10, top-100, no trend filter': dict(uni=top100, trend=None),
    }.items():
        sleeves[name], extra[name] = mean_reversion(d, rsi=rs, **kw)

    nifty = nf.load()
    c = nifty['close']
    ef, es = c.ewm(span=20, adjust=False).mean(), c.ewm(span=50, adjust=False).mean()
    tgt = (ef > es).astype(float) - nf.short_with_stop(c, ef < es, nf.atr(nifty, 14), 2.0)
    sleeves['Nifty futures EMA20/50 L/S with stop'] = nf.simulate(nifty.loc[START:], tgt.loc[START:])[0]
    sleeves.update(asset_sleeves(etf_panel()))
    sleeves['[bench] Nifty 50'] = d['bench']['NIFTY50'].loc[START:].dropna()
    sleeves['[bench] Nifty 500'] = d['bench']['NIFTY500'].loc[START:].dropna()

    w('Diversifiers for SUMMIT-20 momentum. Point-in-time NSE universe (Nifty 500 snapshots), pre-tax, '
      f'{COST * 100:.1f}%/side for stock sleeves, cash 6%. Monthly stats.')
    w('Top-100/200 = largest by 60-day median traded value among index members at each month-end.')
    w('')
    w(f'== Sleeves, {START[:4]} -> {af.index[-1].date()} (ETF sleeves from 2009) ==')
    rows = {}
    mom_m = mom_nav.resample('ME').last().pct_change()
    for k, nav in sleeves.items():
        s = mstats(nav)
        rr = nav.resample('ME').last().pct_change()
        s['Corr mom'] = rr.corr(mom_m)
        s['24-07..now'] = nav.loc['2024-06-30':].iloc[-1] / nav.loc[:'2024-06-30'].iloc[-1] - 1
        s.update({kk: vv for kk, vv in extra.get(k, {}).items()})
        rows[k] = s
    w(table(rows))
    w('Corr mom = correlation of monthly returns with the momentum sleeve. 24-07..now = momentum drawdown window.')
    w('')

    w('== Holdings overlap with momentum (share of the 20 momentum names also held by the sleeve) ==')
    ov = {}
    for k, p in picks.items():
        common = []
        for dt, h in mom_hold.items():
            prev = [x for x in p if x <= dt]
            if prev:
                common.append(len(set(h) & set(p[prev[-1]])) / max(len(h), 1))
        ov[k] = {'overlap': np.mean(common)}
    w(table(ov))
    w('')

    w('== Correlation of monthly returns (2009-2026) ==')
    short = {
        'Mom': 'Momentum SUMMIT-20 (Rule C, pre-tax)', 'LowVol': 'Low-vol 30 of top-100 (quarterly)',
        'AlphaLV': 'Alpha + low-vol 30 of top-200 (quarterly)', 'MR': 'Mean reversion RSI2<10, top-100, 10 slots',
        'NiftyTrend': 'Nifty futures EMA20/50 L/S with stop', 'Gold': 'Gold (GOLDBEES)',
        'ETFrot': 'ETF rotation: top 2 of Nifty/Next50/Gold/US by 3-6-12m mom', 'Nifty50': '[bench] Nifty 50',
    }
    mr = pd.DataFrame({k: sleeves[v].resample('ME').last().pct_change() for k, v in short.items()}).loc['2009-02':]
    w(mr.corr().round(2).to_string())
    w('')

    w('== Blends (monthly rebalanced between sleeves), 2009-2026 ==')
    B = {
        '100% Momentum': {'Mom': 1},
        '50 Mom / 50 LowVol': {'Mom': 1, 'LowVol': 1},
        '50 Mom / 50 MR': {'Mom': 1, 'MR': 1},
        '50 Mom / 25 LowVol / 25 Gold': {'Mom': 2, 'LowVol': 1, 'Gold': 1},
        '40 Mom / 20 LowVol / 20 MR / 20 NiftyTrend': {'Mom': 2, 'LowVol': 1, 'MR': 1, 'NiftyTrend': 1},
        '40 Mom / 20 AlphaLV / 20 MR / 20 Gold': {'Mom': 2, 'AlphaLV': 1, 'MR': 1, 'Gold': 1},
        '40 Mom / 20 LowVol / 20 NiftyTrend / 20 Gold': {'Mom': 2, 'LowVol': 1, 'NiftyTrend': 1, 'Gold': 1},
        '30 Mom / 20 LowVol / 20 MR / 15 NiftyTrend / 15 Gold': {'Mom': 6, 'LowVol': 4, 'MR': 4, 'NiftyTrend': 3, 'Gold': 3},
        'Equal 1/5: Mom, LowVol, MR, NiftyTrend, Gold': {'Mom': 1, 'LowVol': 1, 'MR': 1, 'NiftyTrend': 1, 'Gold': 1},
        '[bench] Nifty 50': {'Nifty50': 1},
    }
    navs = {k: sleeves[v].loc['2009-01-01':] for k, v in short.items()}
    rows, bn = {}, {}
    for name, wts in B.items():
        nav = blend(navs, wts)
        bn[name] = nav
        s = mstats(nav)
        s['24-07..now'] = nav.loc['2024-07':].iloc[-1] / nav.loc[:'2024-06-30'].iloc[-1] - 1
        rows[name] = s
    w(table(rows))
    w('')

    w('== Calendar years: sleeves ==')
    yr = pd.DataFrame({k: v.resample('YE').last() for k, v in navs.items()}).pct_change().loc['2010':]
    yr.index = yr.index.year
    w(yr.to_string(float_format=lambda x: f'{x * 100:6.1f}%'))
    w('')
    w('== Calendar years: blends ==')
    keep = ['100% Momentum', '50 Mom / 50 LowVol', '40 Mom / 20 LowVol / 20 MR / 20 NiftyTrend',
            '30 Mom / 20 LowVol / 20 MR / 15 NiftyTrend / 15 Gold', '[bench] Nifty 50']
    yr = pd.DataFrame({k: bn[k] for k in keep}).resample('YE').last().pct_change().loc['2010':]
    yr.index = yr.index.year
    yr.columns = [f'[{i + 1}]' for i in range(len(keep))]
    for i, k in enumerate(keep):
        w(f'  [{i + 1}] {k}')
    w(yr.to_string(float_format=lambda x: f'{x * 100:6.1f}%'))

    OUT.write_text('\n'.join(lines), encoding='utf-8')
    print('\n'.join(lines))


if __name__ == '__main__':
    main()
