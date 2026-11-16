# Summit Momentum (SUMMIT-20): Rulebook

> Buy the strongest Nifty 500 stocks **while they are near their summit** (52-week high), and ride them for as long as their trend holds.

Version 1.0, 12 Nov 2026. Research name: **Rule C** (see [backtest/STRATEGY.md](../backtest/STRATEGY.md), section 7.4). These are backtest results, not financial advice.

This rulebook defines the strategy exactly as it was backtested. Anything not written here was not tested. If you do it differently, the performance figures below no longer apply.

---

## 1. Identity card

| Item | Value |
|---|---|
| Name / code | Summit Momentum / **SUMMIT-20** |
| Style | Cross-sectional momentum (picking the strongest stocks relative to the rest), long only, equal weight |
| Universe | Nifty 500 members on the date |
| Positions | 20 |
| Rebalance | Monthly: signal at the month-end close, trade at the next open. Weekly is an optional variant |
| Market check | Nifty 500 index vs its 200-day average (only stops new buys) |
| Entry | Ranks 1–30, above the 200-day average, within 10% of the 52-week high, no single-day move above 25% |
| Exit | Below the 200-day average, or left the universe, or (rank worse than 40 **and** below the 50-day average) |
| Stops during the month | None |
| Minimum capital | About ₹10 lakh (≥ ₹50,000 per position) |
| Suggested allocation | At most 50% of equity money |
| Time needed | About 1 hour a month |

---

## 2. Backtest performance

Jan 2007 – 11 Nov 2026. Uses the actual Nifty 500 members at each date (no survivorship bias), with 0.25% costs per side and Indian capital gains tax, and cash earning 6%.

| Measure | SUMMIT-20 (monthly) | Average over schedules, monthly | Average over schedules, weekly | Nifty 500 index | Nifty 50 index |
|---|---|---|---|---|---|
| CAGR after tax | **21.9%** | 22.0% | 23.6% | 10.4% | 9.4% (from Sep 2007) |
| Sharpe ratio | 0.76 | 0.76 | 0.81 | – | – |
| Worst fall | **−42%** | −39% | −41% | −64% | −60% |
| ₹10 lakh grows to | ₹508 lakh | – | – | – | – |
| Trades per year | 29 | 29 | 39 | – | – |
| Median holding period | 153 days | – | – | – | – |
| Average winning trade | +50% | – | – | – | – |

The "average over schedules" columns are averages across several trade days (for example, different days of the month), which removes the luck of the particular day chosen.

**Recent periods (CAGR):**

| Period | SUMMIT-20 | Nifty 500 | Nifty 50 |
|---|---|---|---|
| 2016 – Nov 2026 | 21.7% | 12.3% | 11.2% |
| 2021 – Nov 2026 | 21.6% | 13.2% | 10.6% |

**Worst falls:**

| Period | Fall |
|---|---|
| 2018–2020 | −42% |
| 2024–2026 | −37% (not yet recovered) |
| 2008 | −35% |

**Compared with the simpler research versions:**

| Version | CAGR | Sharpe | Worst fall | Trades/yr |
|---|---|---|---|---|
| Rule A | 21.0% | 0.66 | −58% | 53 |
| Rule B | 20.6% | 0.69 | −49% | 44 |
| **SUMMIT-20** | 21.9% | 0.76 | −42% | 29 |

- Rule A has no market check.
- Rule B adds the market check.
- SUMMIT-20 is Rule B plus the 52-week-high entry check and the "ride winners" exit. It beat Rule B in 11 of 20 years.

---

## 3. Rules

### 3.1 Settings

| Setting | Value |
|---|---|
| Universe | Current **Nifty 500** members (NSE file `ind_nifty500list.csv`, re-downloaded at every rebalance) |
| Number of positions | **20**, equal weight at entry |
| Buy candidates | Ranks **1–30** |
| Rank sell level | Worse than rank **40** (only together with the 50-day rule) |
| Long average | **200-day** simple moving average of daily closes |
| Short average | **50-day** simple moving average of daily closes |
| 52-week high | Highest **daily close** of the last 252 trading days (closing prices, not intraday highs) |
| 52-week-high check | Close ≥ **90%** of the 52-week high |
| Big-move check | No close-to-close move larger than **±25%** in the last 252 trading days |
| Liquidity | Median daily traded value over the last 60 sessions ≥ **₹5 crore** |
| History | At least **250** trading days of prices |
| Market check | **Nifty 500 index** close vs its 200-day average |
| Signal day | **Last trading day of the month**, after the close |
| Trade day | **Next trading day**, at or near the open |

All prices must be **adjusted for splits and bonus issues**. A split that isn't adjusted looks like a −50% or −90% day: it breaks the averages, the 52-week high and the big-move check.

### 3.2 Momentum score

For each stock on signal day *t*, where *P* is the adjusted close and *t−n* means *n* trading days earlier:

| Item | Formula |
|---|---|
| 12-1 month return | R12 = P(t−21) / P(t−252) − 1 |
| 6-1 month return | R6 = P(t−21) / P(t−126) − 1 |
| Volatility | σ = standard deviation of daily log returns over the last 252 days × √252 |
| Risk-adjusted returns | a = R12 / σ, b = R6 / σ |
| z-score (across all eligible stocks) | z(x) = (x − mean) / std, then clipped to [−3, +3] |
| **Score** | **(z(a) + z(b)) / 2** |
| **Rank** | 1 = highest score; ranked among eligible stocks only |

The most recent month (21 trading days) is left out on purpose. Very recent winners tend to reverse briefly.

### 3.3 Eligibility

A stock gets a rank only if **all** of these hold:
- it is in the current Nifty 500 list,
- it has at least 250 trading days of history,
- its 60-day median traded value is ≥ ₹5 crore,
- it is trading, meaning it is not suspended (it has a close within the last 10 trading days),
- it is not an ETF.

A stock that is not eligible has **no rank**, and that counts as worse than 40.

### 3.4 Market check

| Nifty 500 close vs its 200-day average | Effect |
|---|---|
| Above | New buys allowed |
| At or below | **No new buys.** Sell rules still apply; empty slots stay in cash |

### 3.5 Sell rules

Check each holding in this order. The first rule that applies decides.

| # | Condition | Action |
|---|---|---|
| S1 | Not eligible (left the Nifty 500, liquidity below ₹5 crore, suspended or delisted) | **SELL** |
| S2 | Close < 200-day average | **SELL** |
| S3 | Rank worse than 40 **and** close < 50-day average | **SELL** |
| S4 | Anything else | **HOLD**, even if the rank is worse than 40, as long as the close is above the 50-day average ("ride winners") |

### 3.6 Buy rules

Only if the market check allows buys:

- Free slots = 20 − holdings left after the sell rules.
- Go through ranks **1 to 30** in order. A stock qualifies only if **all** of these hold:

  | # | Check |
  |---|---|
  | B1 | Not already held, and not being sold today |
  | B2 | Close > 200-day average |
  | B3 | Close ≥ 90% of the 52-week closing high |
  | B4 | No close-to-close move above 25% in either direction in the last 252 days |

- Take the qualifying stocks until the free slots are full.
- If fewer stocks qualify than there are free slots, **leave those slots in cash**. Never go below rank 30 and never relax a check.

### 3.7 Position sizing

- Target per new position = (holdings + cash, counting today's sales as cash) ÷ 20.
- Each new buy = the target, or the remaining cash if that is less.
- **Never** top up or trim existing positions. Winners are allowed to grow above 5% of the portfolio.

---

## 4. Operating checklist

### 4.1 Monthly (default)

**Signal day: last trading day of the month, after 3:30 pm**

1. Download the current Nifty 500 list and adjusted daily closes for all members and for the Nifty 500 index.
2. Work out eligibility (3.3), then score and rank every eligible stock (3.2).
3. Run the market check (3.4).
4. Apply the sell rules (3.5) to every holding. Do this even if the market check failed.
5. If buys are allowed, build the buy list (3.6).
6. Size the new positions (3.7).
7. Write a journal entry: the date, the market-check result, and every SELL, HOLD and BUY with the rule that triggered it.

**Trade day: next trading day**

8. Place **all sells first**, then the buys.
   - Trade at or near the open (the first 15–30 minutes).
   - Use limit orders close to the last price; avoid market orders in thin stocks.
   - If a stock is stuck at its upper or lower price limit (circuit) and can't trade, try again the next day.
9. Park idle cash in a liquid fund or overnight fund.

**Between rebalances:** do nothing. No stop-losses, no trades, no checking.

### 4.2 Weekly (optional variant)

Use the same checklist with these days:
- **Signal day:** the last trading day of the week.
- **Trade day:** the next trading day.

Compared with monthly, it backtested at 23.6% / −41% against 22.0% / −39%, but with 39 trades a year instead of 29. Choose one schedule and never switch between them.

### 4.3 Example: 12 Nov 2026 snapshot (data to 11 Nov)

- **Market check:** Nifty 500 at 23,779, against a 200-day average of 22,765 (+4.5%). Buys are allowed.
- **Skipped from the top 30:**
  - more than 10% below the 52-week high: WELCORP, STLTECH, HFCL, AEGISLOG, SYRMA, REDINGTON, APARINDS, INOXINDIA, AZAD
  - below the 200-day average: RRKABEL, MTARTECH, KIRLOSENG
- **Buys (18):** LAURUSLABS, CUPID, SANSERA, CPPLUS, RUBICON, AETHER, GLAND, DIVISLAB, WELSPUNLIV, ATHERENERG, SONACOMS, HONASA, PTCIL, SAILIFE, ACMESOLAR, IPCALAB, NYKAA, RADICO.
- **With ₹10 lakh:** ₹50,000 per position, so ₹9 lakh is invested and ₹1 lakh stays in cash.

This snapshot was taken mid-month. The actual signal day is the last trading day of November.

---

## 5. Special situations

| Situation | What to do |
|---|---|
| Stock suspended or delisted | Sell as soon as possible (the backtest assumed a sale at the last traded price). Accept an exit offer if one is made |
| Demerger | Keep both parts until the next signal day, then apply the sell rules to each. A spun-off company that isn't in the Nifty 500 is sold (S1) |
| Merger or swap into another listed stock | Treat the new shares as the holding, and evaluate them at the next signal day |
| Stock removed from the Nifty 500 during the month | Keep it until the signal day; S1 sells it then |
| Market check fails for several months | Keep applying the sell rules. Holdings drain into cash, which is the intended behaviour. In 2008 the market-check version (Rule B) was entirely in cash for about 10 months |
| Fewer than 20 holdings for a long time | Normal after crashes and during weak markets. Don't fill slots with stocks that fail the checks |
| Adding new money | *Not tested.* Suggested: add it on a signal day. It first fills empty slots; any left over can be split equally across holdings |
| Withdrawing money | *Not tested.* Suggested: sell all holdings in proportion on a signal day |

---

## 6. Costs and tax

- **Costs assumed:** 0.25% per side, covering STT, stamp duty, exchange charges, GST and slippage. Brokerage is assumed to be zero (delivery trades).
- **Tax:**
  - Short-term gains (held up to 12 months): 20%.
  - Long-term gains: 12.5% above ₹1.25 lakh a year (rates from FY2024-25; earlier years used the rates of the time).
  - Losses are offset against gains and carried forward.
- Tax is paid out of the portfolio each year. Keep a cash buffer around the advance-tax dates and July.
- About 12% of exits qualify as long-term. The median holding period is about 5 months.

---

## 7. Risks and expectations

- **Long-run return:** about 20% a year after tax. Expect 1 losing year in 4.
- **Drawdowns:** 35–45% falls every few years, and possibly −50% in a severe crash. Up to 3 years below a previous high.
- **It can lag the index:** in 2025 it returned −20% while the Nifty 500 rose 7%.
- **Losses within a month:** the market check and the sell rules only act on signal days, so a sharp fall within a month is taken in full.
- **Uncertainty in the backtest:**
  - The result depends by about ±1.5% a year on which day you trade.
  - Around 30 variants were tested, so the edge over Rule B (about +1% a year) is modest.
  - The archived member lists have gaps.
  - Demergers were smoothed rather than modelled.
- **Concentration:** 20 stocks, often clustered in one or two sectors and in small and mid caps.

---

## 8. Discipline

1. **Follow every signal.** Don't skip a buy because a stock "looks too high": in testing, filtering out extended stocks cut returns from 21% to 15%. Don't keep a sell because you "believe in the company".
2. **No stop-losses and no checking during the month.** Every stop-loss variant tested worse.
3. **Expect the pain** described in section 7, before it arrives.
4. **Review the rules once a year, not after a bad month.** Change rules only on new evidence from a full backtest, and record the change in the changelog.
5. **Limit the allocation** to at most 50% of equity money, so that the falls are survivable. Put the rest in a Nifty 50 or Nifty 500 index fund.

---

## 9. Reproduce

From the `backtest/` folder (Python 3.13, pandas, numpy):

```python
from engine import Config, run, metrics
SUMMIT20 = Config(universe='pit', ma_exit=200, regime='no_new_buys',
                  entry_breakout=0.10, breakout_days=252, buy_rank=30, rank_exit_ma=50)
SUMMIT20_W = SUMMIT20.but(rebalance='W')   # weekly variant
r = run(SUMMIT20); print(metrics(r['nav']))
```

The research notes, variant grids and data build are described in [backtest/STRATEGY.md](../backtest/STRATEGY.md).

---

## 10. Changelog

| Version | Date | Change |
|---|---|---|
| 1.0 | 12 Nov 2026 | First version. Rule B plus the 52-week-high entry check (within 10%, ranks 1–30) and the "ride winners" exit (rank exit only below the 50-day average) |
