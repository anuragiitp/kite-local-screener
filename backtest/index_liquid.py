"""Index and liquid-stock strategies: Nifty calendar/overnight effects, size-index rotation, large-cap momentum,
sector rotation, distance pairs trading and stock-futures mean reversion. Pre-tax. Output: data/index_liquid.txt"""
from concurrent.futures import ProcessPoolExecutor
from itertools import combinations
from pathlib import Path

import numpy as np
import pandas as pd

import diversifiers as dv
import nifty_futures as nf
import pit
from engine import TRADING_DAYS, prepared
from nifty_edges import turn_of_month

OUT = Path(__file__).parent / 'data' / 'index_liquid.txt'
MOM_CACHE = Path(__file__).parent / 'data' / 'mom_nav.pkl'
START = dv.START
FUT_COST = 0.0005     # stock futures per side per leg: STT 0.02% sell, exchange, GST, slippage
DAILY_CASH = dv.DAILY_CASH


def momentum_nav():
    if MOM_CACHE.exists() and (pd.Timestamp.now() - pd.Timestamp(MOM_CACHE.stat().st_mtime, unit='s')).days < 1:
        return pd.read_pickle(MOM_CACHE)
    with ProcessPoolExecutor(max_workers=4) as pool:
        navs = [n for n, _ in pool.map(dv._momentum, (0, 5, 10, 15))]
    nav = pd.concat(navs, axis=1).pct_change().mean(axis=1).fillna(0).add(1).cumprod()
    nav.to_pickle(MOM_CACHE)
    return nav


# ---------- A. Nifty index effects ----------

def index_effects(w):
    df = nf.load()
    o, c = df['open'], df['close']
    pc = c.shift()
    r_on, r_id = (o / pc - 1).iloc[1:], (c / o - 1).iloc[1:]
    yrs = (df.index[-1] - df.index[0]).days / 365.25
    cg = lambda r: (1 + r).prod() ** (1 / yrs) - 1
    w('== A1. Nifty overnight (close->open) vs intraday (open->close), gross, index ==')
    w(f'  Close-to-close {cg((c.pct_change()).iloc[1:]) * 100:.1f}%/yr | overnight {cg(r_on) * 100:.1f}%/yr | '
      f'intraday {cg(r_id) * 100:.1f}%/yr | open==prev close on {(o == pc).mean() * 100:.0f}% of days (Yahoo data gaps)')
    for a, b in (('2008', '2016'), ('2017', '2022'), ('2023', '2026')):
        yy = (pd.Timestamp(b) - pd.Timestamp(a)).days / 365.25 + 1
        w(f'  {a}-{b}: overnight {((1 + r_on.loc[a:b]).prod() ** (1 / yy) - 1) * 100:5.1f}%/yr, '
          f'intraday {((1 + r_id.loc[a:b]).prod() ** (1 / yy) - 1) * 100:5.1f}%/yr')
    net = (1 + r_on - 2 * nf.COST).prod() ** (1 / yrs) - 1
    w(f'  Overnight-only futures trade (buy close, sell open, {2 * nf.COST * 100:.2f}% round trip daily): '
      f'{net * 100:.1f}%/yr before cash -> cost ~{2 * nf.COST * 250 * 100:.0f}%/yr kills most of it')
    w('')

    w('== A2. Turn-of-month on Nifty futures: excess return over cash (pure futures P&L), by days before/after ==')
    cash0, carry0 = nf.CASH, nf.CARRY
    nf.CASH, nf.CARRY = 0.0, 0.0
    try:
        grid_c, grid_s = {}, {}
        for b in range(1, 6):
            for a in range(1, 6):
                nav, pos = nf.simulate(df, turn_of_month(df.index, b, a))
                r = nav.pct_change().dropna()
                grid_c[(b, a)] = nav.iloc[-1] ** (1 / yrs) - 1
                grid_s[(b, a)] = r.mean() / r.std() * np.sqrt(TRADING_DAYS)
        gc = pd.Series(grid_c).unstack()
        gs = pd.Series(grid_s).unstack()
        gc.index.name, gc.columns.name = 'before', 'after'
        w('  Excess CAGR (rows: last N days of month, cols: first N days of next month)')
        w((gc * 100).round(1).to_string())
        w('  Sharpe of excess')
        w(gs.round(2).to_string())
        nav22, _ = nf.simulate(df, turn_of_month(df.index, 2, 2))
        nav43, _ = nf.simulate(df, turn_of_month(df.index, 4, 3))
        bh, _ = nf.simulate(df, pd.Series(1.0, index=df.index))
        yr = pd.DataFrame({'TOM 2+2': nav22, 'TOM 4+3': nav43, 'Buy&hold': bh}).resample('YE').last().pct_change()
        yr.iloc[0] = pd.DataFrame({'TOM 2+2': nav22, 'TOM 4+3': nav43, 'Buy&hold': bh}).resample('YE').last().iloc[0] - 1
        yr.index = yr.index.year
        w('  Yearly futures P&L (no cash interest):')
        w(yr.T.to_string(float_format=lambda x: f'{x * 100:.0f}%'))
        m = nav22.resample('ME').last().pct_change().dropna()
        w(f'  TOM 2+2: positive months {(m > 0).mean() * 100:.0f}%, last 12 months {(nav22.iloc[-1] / nav22.loc[:nav22.index[-1] - pd.DateOffset(years=1)].iloc[-1] - 1) * 100:.1f}%')
    finally:
        nf.CASH, nf.CARRY = cash0, carry0
    w('')

    w('== A3. Day-of-week, Nifty close-to-close (2008-2026) ==')
    r = c.pct_change().dropna()
    g = r.groupby(r.index.dayofweek)
    dow = pd.DataFrame({'mean bp': g.mean() * 1e4, 't': g.mean() / g.std() * np.sqrt(g.count()), 'up%': g.apply(lambda x: (x > 0).mean() * 100)})
    dow.index = [['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][i] for i in dow.index]
    w(dow.round(1).to_string())
    w('')
    nav_tom, _ = nf.simulate(df.loc[START:], turn_of_month(df.loc[START:].index, 2, 2))
    return nav_tom


# ---------- B. Size-index rotation (implementable with index ETFs) ----------

def size_rotation(d, top=1, filt=True):
    b = d['bench'][['NIFTY50', 'NEXT50', 'MIDCAP50', 'SMALLCAP250']].loc['2007-09-24':].ffill()
    ma = b.rolling(200).mean()
    m, mm = b.resample('ME').last(), ma.resample('ME').last()
    r = m.pct_change()
    score = sum(m.pct_change(n) for n in (3, 6, 12)) / 3
    cash_m = (1 + dv.CASH) ** (1 / 12) - 1
    rows, prev = [], set()
    for t in range(13, len(m)):
        s = score.iloc[t - 1].dropna()
        pick = [k for k in s.sort_values(ascending=False).index[:top]
                if not filt or (s[k] > 0 and m.iloc[t - 1][k] > mm.iloc[t - 1][k])]
        ret = sum(r.iloc[t][k] for k in pick) / top + (top - len(pick)) / top * cash_m
        rows.append(ret - len(set(pick) ^ prev) / top / 2 * 0.002)
        prev = set(pick)
    return (1 + pd.Series(rows, index=m.index[13:])).cumprod()


# ---------- C. Liquid stocks ----------

def pairs(d, mask, sector, n_pairs=20, form=252, trade=126, z_open=2.0, cost=FUT_COST):
    """Gatev-style distance pairs within the same sector among liquid stocks, traded with stock futures.
    Each pair gets 1/n_pairs of capital as notional per leg; unfunded futures, so all capital earns cash."""
    af = d['af'].to_numpy()
    R = d['rets'].fillna(0).to_numpy()
    dates = d['af'].index
    cols = d['af'].columns
    sec = np.array([sector.get(s) for s in cols], dtype=object)
    i0 = dates.searchsorted(pd.Timestamp(START))
    ret = np.zeros(len(dates))
    n_trades, wins = 0, 0
    for s in range(i0, len(dates), trade):
        win = af[s - form:s]
        ok = mask.iloc[s - 1].to_numpy() & np.isfinite(win).all(axis=0) & (sec != None)  # noqa: E711
        cand = np.flatnonzero(ok)
        P = win[:, cand] / win[0, cand]
        found = []
        for sname in set(sec[cand]):
            k = np.flatnonzero(sec[cand] == sname)
            for a, b in combinations(k, 2):
                dlt = P[:, a] - P[:, b]
                found.append((np.sum(dlt ** 2), cand[a], cand[b], dlt.std()))
        found.sort()
        chosen = found[:n_pairs]
        end = min(s + trade, len(dates))
        for _, a, b, sd in chosen:
            base_a, base_b = af[s - 1, a], af[s - 1, b]
            pos, pend, entry_pnl, stale = 0, 0, 0.0, 0
            for t in range(s, end):
                if pos:
                    pr = pos * (R[t, a] - R[t, b])
                    ret[t] += pr / n_pairs
                    entry_pnl += pr
                # signals from close t-1 execute at close t (one-day wait, avoids bid-ask bounce)
                if pend == 2 and pos:
                    ret[t] -= 2 * cost / n_pairs
                    n_trades, wins, pos = n_trades + 1, wins + (entry_pnl > 4 * cost), 0
                elif pend in (1, -1) and pos == 0 and t < end - 1:
                    pos, entry_pnl = pend, 0.0
                    ret[t] -= 2 * cost / n_pairs
                pend = 0
                pa, pb = af[t, a], af[t, b]
                if not (np.isfinite(pa) and np.isfinite(pb)):
                    stale += 1
                    if stale > 5 and pos:
                        ret[t] -= 2 * cost / n_pairs
                        n_trades, wins, pos = n_trades + 1, wins + (entry_pnl > 4 * cost), 0
                    continue
                stale = 0
                spread = pa / base_a - pb / base_b
                if pos and t == end - 1:
                    ret[t] -= 2 * cost / n_pairs
                    n_trades, wins, pos = n_trades + 1, wins + (entry_pnl > 4 * cost), 0
                elif pos == 0 and t < end - 2 and abs(spread) > z_open * sd:
                    pend = -1 if spread > 0 else 1
                elif pos and np.sign(spread) == pos:
                    pend = 2
    ret = ret[i0:] + DAILY_CASH
    idx = dates[i0:]
    return pd.Series(np.cumprod(1 + ret), index=idx), {
        'trades/yr': n_trades / ((idx[-1] - idx[0]).days / 365.25), 'win%': wins / max(n_trades, 1)}


def main():
    lines = []
    w = lines.append
    w('Index and liquid-stock strategies, pre-tax. Stock delivery 0.2%/side, stock futures 0.05%/side/leg, '
      f'Nifty futures {nf.COST * 100:.2f}%/side, ETFs 0.1%/side, cash 6%.')
    w('')
    nav_tom = index_effects(w)
    mom = momentum_nav()
    d = prepared('pit')
    af, vol = d['af'], d['vol']
    top100, top200 = dv.liquid_mask(d, 100), dv.liquid_mask(d, 200)
    sector = pit.sector_map()
    b500, b500ma = d['bench']['NIFTY500'], d['bench']['NIFTY500'].rolling(200).mean()

    def largecap_mom(mask, n=20, regime=True):
        r6, r12 = af / af.shift(126) - 1, af / af.shift(252) - 1

        def f(i):
            if regime and b500.iloc[i] < b500ma.iloc[i]:
                return []
            ok = mask.iloc[i] & vol.iloc[i].notna() & r12.iloc[i].notna()
            v = vol.iloc[i][ok]
            z = lambda s: (s - s.mean()) / s.std()
            return (z(r6.iloc[i][ok] / v) + z(r12.iloc[i][ok] / v)).nlargest(n).index
        return f

    def sector_rot(mask, k=3, per=5):
        r6 = af / af.shift(126) - 1
        sec = pd.Series(sector).reindex(af.columns)

        def f(i):
            ok = mask.iloc[i] & r6.iloc[i].notna() & sec.notna()
            g = r6.iloc[i][ok].groupby(sec[ok])
            med = g.median()[g.size() >= 4]
            best = [s for s in med.nlargest(k).index if med[s] > 0]
            tv = d['tv'].iloc[i]
            return [x for s in best for x in tv[ok & (sec == s)].nlargest(per).index]
        return f

    sleeves, extra = {'Momentum SUMMIT-20 (reference)': mom, 'Turn-of-month 2+2, Nifty futures': nav_tom}, {}
    for name, fn, freq in [
        ('Large-cap momentum: top 20 of top-100 (6m+12m / vol), monthly, cash if N500<200DMA', largecap_mom(top100), 'M'),
        ('Large-cap momentum: top 20 of top-200, monthly, regime', largecap_mom(top200), 'M'),
        ('Large-cap momentum: top 20 of top-100, no regime', largecap_mom(top100, regime=False), 'M'),
        ('Sector rotation: top 3 sectors (6m median) x 5 most liquid, top-200, monthly', sector_rot(top200), 'M'),
    ]:
        sleeves[name], _ = dv.run_weights(d, fn, freq)
    sleeves['Pairs (distance, same sector, top-100, 20 pairs, stock futures)'], extra['Pairs (distance, same sector, top-100, 20 pairs, stock futures)'] = pairs(d, top100, sector)
    sleeves['Pairs (top-200, 30 pairs, z>2.5)'], extra['Pairs (top-200, 30 pairs, z>2.5)'] = pairs(d, top200, sector, n_pairs=30, z_open=2.5)
    rs = dv.rsi2(af)
    k = 'RSI2<10 mean reversion, top-100, via stock futures (0.05%/side)'
    sleeves[k], extra[k] = dv.mean_reversion(d, top100, rs, cost=FUT_COST)
    for top, filt, lab in ((1, True, 'top 1 + 200DMA/abs filter'), (2, True, 'top 2 + filter'), (1, False, 'top 1, no filter')):
        sleeves[f'Size rotation N50/Next50/Mid50/Small250: {lab}'] = size_rotation(d, top, filt)
    sleeves['[bench] Nifty 50'] = d['bench']['NIFTY50'].loc[START:].dropna()

    w(f'== B/C. Sleeves {START[:4]} -> {af.index[-1].date()} (size rotation from 2008-10) ==')
    rows = {}
    mom_m = mom.resample('ME').last().pct_change()
    for name, nav in sleeves.items():
        s = dv.mstats(nav)
        s['Corr mom'] = nav.resample('ME').last().pct_change().corr(mom_m)
        s['24-07..now'] = nav.iloc[-1] / nav.loc[:'2024-06-30'].iloc[-1] - 1
        s.update(extra.get(name, {}))
        rows[name] = s
    w(dv.table(rows))
    w('')

    w('== Calendar years ==')
    short = {'Mom': 'Momentum SUMMIT-20 (reference)', 'TOM': 'Turn-of-month 2+2, Nifty futures',
             'LCmom': 'Large-cap momentum: top 20 of top-100 (6m+12m / vol), monthly, cash if N500<200DMA',
             'SecRot': 'Sector rotation: top 3 sectors (6m median) x 5 most liquid, top-200, monthly',
             'Pairs': 'Pairs (distance, same sector, top-100, 20 pairs, stock futures)',
             'MRfut': 'RSI2<10 mean reversion, top-100, via stock futures (0.05%/side)',
             'SizeRot': 'Size rotation N50/Next50/Mid50/Small250: top 1 + 200DMA/abs filter', 'Nifty50': '[bench] Nifty 50'}
    yr = pd.DataFrame({k: sleeves[v].resample('YE').last() for k, v in short.items()}).pct_change().loc['2009':]
    yr.index = yr.index.year
    w(yr.to_string(float_format=lambda x: f'{x * 100:6.1f}%'))
    w('')
    w('== Correlation of monthly returns ==')
    mr = pd.DataFrame({k: sleeves[v].resample('ME').last().pct_change() for k, v in short.items()}).loc['2009-01':]
    w(mr.corr().round(2).to_string())
    w('')

    gold = dv.asset_sleeves(dv.etf_panel())['Gold (GOLDBEES)']
    nt = nf.load()
    c = nt['close']
    ef, es = c.ewm(span=20, adjust=False).mean(), c.ewm(span=50, adjust=False).mean()
    trend = nf.simulate(nt.loc[START:], ((ef > es).astype(float) - nf.short_with_stop(c, ef < es, nf.atr(nt, 14), 2.0)).loc[START:])[0]
    navs = {k: sleeves[v].loc['2009-01-01':] for k, v in short.items()}
    navs.update({'Gold': gold.loc['2009-01-01':], 'Trend': trend.loc['2009-01-01':]})
    w('== Blends with momentum (monthly rebalanced), 2009-2026 ==')
    B = {
        '100% Momentum': {'Mom': 1},
        '40 Mom / 20 Trend / 20 Gold / 20 TOM': {'Mom': 2, 'Trend': 1, 'Gold': 1, 'TOM': 1},
        '40 Mom / 20 Trend / 20 Gold / 20 Pairs': {'Mom': 2, 'Trend': 1, 'Gold': 1, 'Pairs': 1},
        '40 Mom / 20 SizeRot / 20 Gold / 20 TOM': {'Mom': 2, 'SizeRot': 1, 'Gold': 1, 'TOM': 1},
        '40 Mom / 20 LCmom / 20 Gold / 20 TOM': {'Mom': 2, 'LCmom': 1, 'Gold': 1, 'TOM': 1},
        '30 Mom / 15 Trend / 15 TOM / 15 Pairs / 10 MRfut / 15 Gold': {'Mom': 6, 'Trend': 3, 'TOM': 3, 'Pairs': 3, 'MRfut': 2, 'Gold': 3},
        '[bench] Nifty 50': {'Nifty50': 1},
    }
    rows = {}
    for name, wts in B.items():
        nav = dv.blend(navs, wts)
        s = dv.mstats(nav)
        s['24-07..now'] = nav.loc['2024-07':].iloc[-1] / nav.loc[:'2024-06-30'].iloc[-1] - 1
        rows[name] = s
    w(dv.table(rows))

    OUT.write_text('\n'.join(lines), encoding='utf-8')
    print('\n'.join(lines))


if __name__ == '__main__':
    main()
