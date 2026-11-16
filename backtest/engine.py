"""Long-only monthly momentum backtest on the Nifty 500 universe with Indian costs and taxes."""
from dataclasses import dataclass, replace
from functools import lru_cache

import numpy as np
import pandas as pd

from data import load_indices, load_prices

TRADING_DAYS = 252


@dataclass(frozen=True)
class Config:
    name: str = 'base'
    universe: str = 'yahoo'             # 'yahoo' (today's list, Yahoo data) | 'pit' | 'pit_today' | 'liq500'
    top_n: int = 20
    exit_rank: int = 40
    skip: int = 21                      # skip most recent month (12-1, 6-1)
    lookbacks: tuple = (252, 126)
    smooth_w: float = 0.0               # weight of % positive days (frog-in-the-pan)
    high52_w: float = 0.0               # weight of closeness to 52W high (George-Hwang)
    min_traded_value: float = 5e7       # ₹5 cr median daily traded value (60d)
    max_gap: float = 0.25               # no entry if any |daily move| above this in 12m
    stop: str = ''                      # '', 'trail', 'fixed', 'chandelier', 'ma'
    stop_pct: float = 0.20
    atr_mult: float = 3.0
    stop_ma: int = 100
    ma_exit: int = 0                    # monthly: sell holdings below this MA, require it for entry
    regime: str = ''                    # '', 'no_new_buys', 'cash'
    regime_ma: int = 200
    regime_index: str = 'NIFTY500'      # any column of prepared()['bench'], or 'BREADTH'
    rebalance: str = 'M'                # 'D', 'W', '2W', 'M', '2M', 'Q', '6M'
    rebal_phase: int = 0                # multi-month: keep months where month % step == phase
    rebal_offset: int = 0               # trade this many trading days before the period end
    exit_freq: str = ''                 # extra sell-only checks: 'W', '2W'
    buy_rank: int = 0                   # buy candidates come from this many top ranks (0 = top_n)
    max_ext: float = 0.0                # skip entry if close > 200DMA * (1 + max_ext)
    entry_pullback: float = 0.0         # entry only if close <= 20DMA * (1 + x)
    entry_breakout: float = 0.0         # entry only if close >= N-day high * (1 - x)
    breakout_days: int = 20
    rank_exit_ma: int = 0               # rank exit only once close < this MA (let winners run)
    check_trail: float = 0.0            # at checks, sell if close <= peak since entry * (1 - x)
    tax_hold_days: int = 0              # delay a profitable rank exit if LTCG (365d) is this close
    tax_hold_rank: int = 80             # ...but only while rank stays within this
    sector_cap: int = 0                 # max holdings per sector (0 = no cap)
    size_cap: tuple = ()                # ((bucket, max), ...); buckets from size_bucket()
    cost: float = 0.0025                # per side: STT 0.1% + stamp/exchange/GST + slippage
    cash_rate: float = 0.06
    tax: bool = True
    capital: float = 1e6
    start: str = '2007-01-01'
    end: str = '2026-12-31'

    def but(self, **kw):
        return replace(self, **kw)


# ---------- data prep ----------

def _despike(a):
    for _ in range(3):
        prev = a.ffill().shift(1)
        nxt = a.bfill().shift(-1)
        bad = ((a / prev - 1).abs() > 0.25) & ((nxt / prev - 1).abs() < 0.10)
        a = a.mask(bad)
    return a


def _neutralize_jumps(a, threshold=0.45):
    """Treat |1-day move| >= threshold as an unadjusted corporate action and rescale history."""
    r = a / a.ffill().shift(1)
    ratio = r.where((r - 1).abs() >= threshold, 1.0).fillna(1.0)
    future = ratio.iloc[::-1].cumprod().iloc[::-1].shift(-1).fillna(1.0)
    return a * future


def _source(universe):
    return 'yahoo' if universe == 'yahoo' else 'pit'


@lru_cache(maxsize=2)
def prepared(source='yahoo'):
    yp = load_prices()
    if source == 'yahoo':
        p = yp
        raw = p['adjclose']
        clean = _neutralize_jumps(_despike(raw))
        traded_value = p['close'] * p['volume']
    else:
        import pit
        p = pit.build_panel()
        raw = p['adjclose']
        # >=45% one-day moves are mostly demergers/splits; restore the verified real ones
        real = [('YESBANK', '2020-03-06'), ('YESBANK', '2020-03-16'), ('YESBANK', '2020-03-17'),
                ('JETAIRWAYS', '2019-06-20'), ('RCOM', '2018-05-17'), ('PNB', '2017-10-25')]
        clean = _neutralize_jumps(_despike(raw))
        for sym, day in real:
            if sym in raw:
                r = raw[sym] / raw[sym].ffill().shift(1)
                k = raw.index.get_loc(pd.Timestamp(day))
                clean.loc[clean.index[:k], sym] /= r.iloc[k]
        traded_value = p['tval']
    factor = (clean / raw)
    af = clean.ffill(limit=10)
    rets = af.pct_change(fill_method=None)
    logr = np.log1p(rets)
    high = (p['high'] * factor).reindex_like(af)
    low = (p['low'] * factor).reindex_like(af)
    prev = af.shift(1)
    tr = pd.concat([(high - low), (high - prev).abs(), (low - prev).abs()]).groupby(level=0).max()
    bench = yp['bench'].join(load_indices(), how='outer').reindex(af.index).ffill()
    d = {
        'af': af,
        'open': (p['open'] * factor).reindex_like(af),
        'rets': rets,
        'vol': logr.rolling(TRADING_DAYS, min_periods=200).std() * np.sqrt(TRADING_DAYS),
        'tv': traded_value.rolling(60, min_periods=40).median(),
        'gap': (rets.abs() > 0.25).astype(float).rolling(TRADING_DAYS, min_periods=1).max(),
        'hist': clean.notna().rolling(273, min_periods=1).sum(),
        'posfrac': (rets > 0).astype(float).where(rets.notna()).rolling(126, min_periods=100).mean(),
        'high52': af.rolling(TRADING_DAYS, min_periods=200).max(),
        'atr': tr.rolling(22, min_periods=15).mean(),
        'ma': {n: af.rolling(n, min_periods=int(n * 0.8)).mean() for n in (20, 50, 100, 150, 200)},
        'bench': bench,
        'bench_ma': bench['NIFTY500'].rolling(200, min_periods=150).mean(),
        'sectors': yp['sectors'],
    }
    if source == 'pit':
        import pit
        masks = pit.universe_masks(af.index)
        d['member'] = {k: m.reindex(columns=af.columns, fill_value=False) for k, m in masks.items()}
        d['stock'] = pit.non_etf(af.columns)
    return d


def eligible(d, i, cfg):
    """Point-in-time eligibility on row i: history, liquidity, and universe membership."""
    ok = (d['hist'].iloc[i] >= 250) & (d['tv'].iloc[i] >= cfg.min_traded_value) & d['af'].iloc[i].notna()
    if cfg.universe in ('pit', 'pit_today'):
        ok &= d['member']['snap' if cfg.universe == 'pit' else 'today'].iloc[i]
    elif cfg.universe == 'liq500':
        tv = d['tv'].iloc[i].where((d['hist'].iloc[i] >= 250) & d['stock'])
        ok &= tv.rank(ascending=False) <= 500
    return ok


def _z(s):
    s = s.replace([np.inf, -np.inf], np.nan)
    sd = s.std()
    if not sd or np.isnan(sd):
        return s * 0
    return ((s - s.mean()) / sd).clip(-3, 3)


def scores_at(d, i, cfg):
    """Momentum score for all scoreable stocks on row i (uses data up to and including i)."""
    af = d['af']
    if i < max(cfg.lookbacks) + cfg.skip:
        return pd.Series(dtype=float), pd.Series(dtype=bool)
    row = af.iloc[i]
    ok = eligible(d, i, cfg)
    vol = d['vol'].iloc[i]
    end = af.iloc[i - cfg.skip]
    parts = []
    for lb in cfg.lookbacks:
        r = end / af.iloc[i - lb] - 1
        parts.append(_z((r / vol)[ok]))
    score = sum(parts) / len(parts)
    if cfg.smooth_w:
        score = score + cfg.smooth_w * _z(d['posfrac'].iloc[i][ok])
    if cfg.high52_w:
        score = score + cfg.high52_w * _z((row / d['high52'].iloc[i])[ok])
    score = score.dropna()
    entry_ok = (d['gap'].iloc[i].reindex(score.index) < 1)
    return score.sort_values(ascending=False), entry_ok


# ---------- tax ----------

SIZE_EDGES = (100, 250)  # traded-value rank among Nifty 500 members: large <=100, mid <=250, small


def size_bucket(d, i, cfg, extra=()):
    """Size proxy on row i: rank by 60-day median traded value (no point-in-time market caps)."""
    tv = d['tv'].iloc[i]
    if 'member' in d:
        ok = d['member']['snap' if cfg.universe != 'pit_today' else 'today'].iloc[i].copy()
    else:
        ok = eligible(d, i, cfg)
    ok[list(extra)] = True
    rank = tv[ok & tv.notna()].rank(ascending=False)
    return pd.Series(np.where(rank <= SIZE_EDGES[0], 'large', np.where(rank <= SIZE_EDGES[1], 'mid', 'small')),
                     index=rank.index)

def _fy(ts):
    return ts.year if ts.month >= 4 else ts.year - 1


def _rates(fy):
    """(STCG rate, LTCG rate, LTCG exemption) by financial year starting `fy`."""
    if fy >= 2024:
        return 0.20, 0.125, 125000.0
    if fy >= 2018:
        return 0.15, 0.10, 100000.0
    return 0.15, 0.0, 0.0


class TaxBook:
    def __init__(self):
        self.st = 0.0
        self.lt = 0.0
        self.carry_st = 0.0
        self.carry_lt = 0.0
        self.paid = 0.0

    def record(self, gain, long_term):
        if long_term:
            self.lt += gain
        else:
            self.st += gain

    def settle(self, fy):
        st, lt = self.st, self.lt
        if st < 0 < lt:
            use = min(-st, lt); st += use; lt -= use
        if lt < 0:
            self.carry_lt += -lt; lt = 0.0
        if st < 0:
            self.carry_st += -st; st = 0.0
        use = min(self.carry_st, st); st -= use; self.carry_st -= use
        use = min(self.carry_st, lt); lt -= use; self.carry_st -= use
        use = min(self.carry_lt, lt); lt -= use; self.carry_lt -= use
        st_rate, lt_rate, exempt = _rates(fy)
        tax = st * st_rate + max(0.0, lt - exempt) * lt_rate
        self.st = self.lt = 0.0
        self.paid += tax
        return tax


# ---------- engine ----------

def _schedule(dates, freq, phase=0, offset=0):
    sig = np.zeros(len(dates), bool)
    if not freq:
        return sig
    per = dates.to_period({'D': 'D', 'W': 'W', '2W': 'W'}.get(freq, 'M'))
    idx = np.flatnonzero(per[:-1] != per[1:])
    step = {'2W': 2, '2M': 2, 'Q': 3, '6M': 6}.get(freq, 1)
    if step > 1:
        key = per[idx].asi8 if freq == '2W' else per[idx].month
        idx = idx[np.asarray(key) % step == phase]
    sig[np.clip(idx - offset, 0, None)] = True
    return sig


def run(cfg):
    d = prepared(_source(cfg.universe))
    af = d['af']
    dates = af.index
    syms = list(af.columns)
    col = {s: j for j, s in enumerate(syms)}
    AF = af.to_numpy()
    OP = d['open'].to_numpy()
    ATR = d['atr'].to_numpy()
    STOP_MA = d['ma'][cfg.stop_ma].to_numpy() if cfg.stop == 'ma' else None
    if cfg.regime_index == 'BREADTH':
        # share of eligible-universe stocks above their 200DMA, risk-off below 50%
        above = (af > d['ma'][200]) & d['ma'][200].notna()
        if 'member' in d and cfg.universe in ('pit', 'pit_today'):
            m = d['member']['snap' if cfg.universe == 'pit' else 'today'] & d['stock']
            above, base = above & m, d['ma'][200].notna() & m
        else:
            base = d['ma'][200].notna()
        bench = (above.sum(axis=1) / base.sum(axis=1).replace(0, np.nan)).to_numpy()
        bench_ma = np.full(len(bench), 0.5)
    else:
        b = d['bench'][cfg.regime_index]
        bench = b.to_numpy()
        bench_ma = b.rolling(cfg.regime_ma, min_periods=150).mean().to_numpy()

    start_i = dates.searchsorted(pd.Timestamp(cfg.start))
    end_i = dates.searchsorted(pd.Timestamp(cfg.end), side='right')
    signal = _schedule(dates, cfg.rebalance, cfg.rebal_phase, cfg.rebal_offset)
    exit_sig = _schedule(dates, cfg.exit_freq)
    MA200 = d['ma'][200].to_numpy() if cfg.max_ext else None
    MA20 = d['ma'][20].to_numpy() if cfg.entry_pullback else None
    HI = af.rolling(cfg.breakout_days, min_periods=1).max().to_numpy() if cfg.entry_breakout else None
    RMA = d['ma'][cfg.rank_exit_ma].to_numpy() if cfg.rank_exit_ma else None
    fy_end = np.zeros(len(dates), bool)
    fy_end[:-1] = (dates[:-1].month == 3) & (dates[1:].month == 4)

    cash = cfg.capital
    pos = {}
    tax = TaxBook()
    orders = None
    nav_hist = []
    traded = 0.0
    trades = []
    exposure_log = []
    holdings_log = []
    SECTOR = None
    if cfg.sector_cap:
        import pit
        SECTOR = pit.sector_map()
    SIZE_CAP = dict(cfg.size_cap)
    daily_cash = (1 + cfg.cash_rate) ** (1 / TRADING_DAYS)

    def price(j, i):
        px = AF[i, j]
        return px if np.isfinite(px) and px > 0 else np.nan

    def sell(sym, px, i, why):
        nonlocal cash, traded
        p = pos.pop(sym)
        value = p['shares'] * px
        proceeds = value * (1 - cfg.cost)
        cash += proceeds
        traded += value
        gain = proceeds - p['basis']
        held = (dates[i] - p['date']).days
        tax.record(gain, held > 365)
        trades.append((p['date'], dates[i], sym, gain / p['basis'], held, why))

    def buy(sym, px, amount, i):
        nonlocal cash, traded
        shares = amount * (1 - cfg.cost) / px
        cash -= amount
        traded += amount
        pos[sym] = {'shares': shares, 'basis': amount, 'date': dates[i], 'entry': px, 'peak': px,
                    'last': px, 'stale': 0}

    for i in range(start_i, end_i):
        cash *= daily_cash  # negative cash (tax overdraw) is charged the same rate

        if orders:
            for sym, why in orders['sell'].items():
                if sym in pos:
                    j = col[sym]
                    px = OP[i, j] if np.isfinite(OP[i, j]) and OP[i, j] > 0 else price(j, i)
                    sell(sym, px if np.isfinite(px) else pos[sym]['last'], i, why)
            buys = orders['buy']
            if buys:
                nav_open = cash + sum(p['shares'] * p['last'] for p in pos.values())
                target = nav_open / cfg.top_n
                for k, sym in enumerate(buys):
                    j = col[sym]
                    px = OP[i, j] if np.isfinite(OP[i, j]) and OP[i, j] > 0 else price(j, i)
                    if not np.isfinite(px):
                        continue
                    amount = min(target, cash / (len(buys) - k)) if cash > 0 else 0
                    if amount > target * 0.2:
                        buy(sym, px, amount, i)
            orders = None

        stop_sells = {}
        for sym, p in list(pos.items()):
            j = col[sym]
            px = price(j, i)
            if np.isfinite(px):
                p['last'] = px
                p['stale'] = 0
                p['peak'] = max(p['peak'], px)
            else:
                p['stale'] += 1
                if p['stale'] > 10:
                    sell(sym, p['last'], i, 'delisted')
                continue
            if cfg.stop == 'trail' and px <= p['peak'] * (1 - cfg.stop_pct):
                stop_sells[sym] = 'stop'
            elif cfg.stop == 'fixed' and px <= p['entry'] * (1 - cfg.stop_pct):
                stop_sells[sym] = 'stop'
            elif cfg.stop == 'chandelier' and np.isfinite(ATR[i, j]) and px < p['peak'] - cfg.atr_mult * ATR[i, j]:
                stop_sells[sym] = 'stop'
            elif cfg.stop == 'ma' and np.isfinite(STOP_MA[i, j]) and px < STOP_MA[i, j]:
                stop_sells[sym] = 'stop'

        nav = cash + sum(p['shares'] * p['last'] for p in pos.values())

        if signal[i] or exit_sig[i]:
            score, entry_ok = scores_at(d, i, cfg)
            rank = pd.Series(np.arange(1, len(score) + 1), index=score.index)
            risk_off = bool(cfg.regime) and np.isfinite(bench_ma[i]) and bench[i] < bench_ma[i]
            sells = dict(stop_sells)
            ma = d['ma'][cfg.ma_exit].iloc[i] if cfg.ma_exit else None
            for sym in pos:
                r = rank.get(sym, np.inf)
                p = pos[sym]
                j = col[sym]
                near_lt = (cfg.tax_hold_days and r <= cfg.tax_hold_rank
                           and 0 < 366 - (dates[i] - p['date']).days <= cfg.tax_hold_days
                           and p['shares'] * p['last'] > p['basis'])
                riding = (RMA is not None and np.isfinite(r) and np.isfinite(RMA[i, j])
                          and AF[i, j] >= RMA[i, j])
                if r > cfg.exit_rank and not near_lt and not riding:
                    sells.setdefault(sym, 'rank')
                elif ma is not None and AF[i, j] < ma[sym]:
                    sells.setdefault(sym, 'ma')
                elif cfg.check_trail and p['last'] <= p['peak'] * (1 - cfg.check_trail):
                    sells.setdefault(sym, 'trail')
                elif risk_off and cfg.regime == 'cash':
                    sells.setdefault(sym, 'regime')
            buys = []
            if signal[i] and not (risk_off and cfg.regime in ('cash', 'no_new_buys')):
                slots = cfg.top_n - (len(pos) - len(sells))
                kept = [s for s in pos if s not in sells]
                sec_n, size_n, size = {}, {}, None
                if SECTOR is not None:
                    for s in kept:
                        sec_n[SECTOR.get(s, 'Other')] = sec_n.get(SECTOR.get(s, 'Other'), 0) + 1
                if SIZE_CAP:
                    size = size_bucket(d, i, cfg, kept)
                    for s in kept:
                        size_n[size.get(s, 'small')] = size_n.get(size.get(s, 'small'), 0) + 1
                for sym in score.index[:cfg.buy_rank or cfg.top_n]:
                    if slots <= 0:
                        break
                    if (sym in pos and sym not in sells) or sym in sells or not entry_ok.get(sym, False):
                        continue
                    j = col[sym]
                    if ma is not None and not AF[i, j] >= ma[sym]:
                        continue
                    if STOP_MA is not None and not AF[i, j] >= STOP_MA[i, j]:
                        continue
                    if MA200 is not None and not AF[i, j] <= MA200[i, j] * (1 + cfg.max_ext):
                        continue
                    if MA20 is not None and not AF[i, j] <= MA20[i, j] * (1 + cfg.entry_pullback):
                        continue
                    if HI is not None and not AF[i, j] >= HI[i, j] * (1 - cfg.entry_breakout):
                        continue
                    if SECTOR is not None:
                        sec = SECTOR.get(sym, 'Other')
                        if sec_n.get(sec, 0) >= cfg.sector_cap:
                            continue
                        sec_n[sec] = sec_n.get(sec, 0) + 1
                    if size is not None:
                        b = size.get(sym, 'small')
                        if b in SIZE_CAP and size_n.get(b, 0) >= SIZE_CAP[b]:
                            if SECTOR is not None:
                                sec_n[sec] -= 1
                            continue
                        size_n[b] = size_n.get(b, 0) + 1
                    buys.append(sym)
                    slots -= 1
            orders = {'sell': sells, 'buy': buys}
            if signal[i]:
                exposure_log.append((dates[i], len(pos) - len(sells) + len(buys)))
                holdings_log.append((dates[i], [s for s in pos if s not in sells] + buys))
        elif stop_sells:
            orders = {'sell': stop_sells, 'buy': []}

        if cfg.tax and fy_end[i]:
            cash -= tax.settle(_fy(dates[i]))
        nav_hist.append(nav)

    if cfg.tax:
        cash -= tax.settle(_fy(dates[end_i - 1]))
        nav_hist[-1] = cash + sum(p['shares'] * p['last'] for p in pos.values())

    nav = pd.Series(nav_hist, index=dates[start_i:end_i], name=cfg.name)
    tr = pd.DataFrame(trades, columns=['entry', 'exit', 'sym', 'ret', 'days', 'why'])
    return {'nav': nav, 'trades': tr, 'traded': traded, 'tax': tax.paid, 'cfg': cfg,
            'names': exposure_log, 'holdings': holdings_log}


# ---------- benchmarks & metrics ----------

def benchmark(name, start, end):
    s = prepared()['bench'][name].loc[start:end].dropna()
    return s / s.iloc[0]


def equal_weight_universe(cfg):
    """Monthly-rebalanced equal weight of all eligible stocks in cfg's universe."""
    d = prepared(_source(cfg.universe))
    af = d['af'].loc[:cfg.end]
    me = af.groupby(af.index.to_period('M')).tail(1)
    me = me[me.index >= pd.Timestamp(cfg.start) - pd.offsets.MonthEnd(1)]
    rets = me.pct_change(fill_method=None).shift(-1)
    out = []
    for dt in me.index[:-1]:
        i = d['af'].index.get_loc(dt)
        out.append(rets.loc[dt][eligible(d, i, cfg)].mean())
    idx = me.index[1:]
    return pd.Series(np.cumprod(1 + np.nan_to_num(out)), index=idx)


def metrics(nav, rf=0.06, bench=None):
    nav = nav.dropna()
    years = (nav.index[-1] - nav.index[0]).days / 365.25
    cagr = (nav.iloc[-1] / nav.iloc[0]) ** (1 / years) - 1
    m = nav.resample('ME').last()
    mr = m.pct_change().dropna()
    vol = mr.std() * np.sqrt(12)
    dd = (nav / nav.cummax() - 1).min()
    out = {'CAGR': cagr, 'Vol': vol, 'Sharpe': (mr.mean() * 12 - rf) / vol if vol else np.nan,
           'MaxDD': dd, 'Calmar': cagr / -dd if dd else np.nan}
    if bench is not None:
        b = bench.resample('ME').last().reindex(m.index).ffill()
        br = b.pct_change().dropna()
        ex = (mr - br).dropna()
        roll = (m.pct_change(12) - b.pct_change(12)).dropna()
        out['Beat12m%'] = (roll > 0).mean()
        out['Worst12mRel'] = roll.min()
        out['t(excess)'] = ex.mean() / ex.std() * np.sqrt(len(ex)) if ex.std() else np.nan
    return out
