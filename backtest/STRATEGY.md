# Nifty 500 Momentum Strategy: Research Notes

Status as of 12 Nov 2026. These are backtest results, not financial advice.

## 1. Summary

- A monthly-rebalanced, 20-stock momentum portfolio on the Nifty 500 returned **about 21% a year after tax (2007–2026)**. Over the same period the Nifty 500 index returned 10.4% (price only) and an equal-weight portfolio of its members 12.9%.
- The cost of that return is **deep drawdowns**: −49% to −58% in 2008, 30–40% falls every few years, and up to 3 years below a previous high.
- **Recommended version:** Rule C (section 7.4). It is Rule B plus two changes: buy only stocks within 10% of their 52-week high, and keep a stock that slips below rank 40 while it stays above its 50-day average. Monthly, it returned 22.0% a year after tax, with a −39% worst fall and 29 trades a year. Put at most 50% of equity money into it. **It is now named Summit Momentum (SUMMIT-20); the rulebook is [strategies/summit-momentum.md](../strategies/summit-momentum.md).**
- An earlier test using *today's* Nifty 500 list showed 31–32% a year. That figure was inflated by survivorship bias. With the actual members at each point in time, the honest figure is 20–25%.

## 2. Data and method

| Item | Detail |
|---|---|
| Period | Jan 2007 – Nov 2026 (signals use data back to 2005) |
| Universe | **Actual Nifty 500 members at each date.** Built from 21 archived NSE constituent lists (2006–2026); each date uses the latest list on or before it, so there is no look-ahead |
| Prices | NSE daily bhavcopy files (official end-of-day price data), 2005–2026, which include delisted stocks, merged with Yahoo adjusted prices. Splits and bonus issues were detected and adjusted; demergers were smoothed |
| Stocks covered | 2,140 symbols, including delisted ones (DHFL, Jaiprakash Associates, Allahabad Bank, RCom, Jet Airways and others) |
| Execution | Signal at month-end close, trade at the next day's open |
| Costs | 0.25% per side (STT, stamp duty, exchange fees, GST, slippage) |
| Tax | Indian STCG/LTCG (short- and long-term capital gains tax) settled each financial year |
| Cash | Earns 6% a year |
| Benchmarks | Nifty 500 index (price only); equal-weight portfolio of the same eligible universe |

**Validation:** the backtest roughly tracks the real Nifty200 Momentum 30 ETF (MOMENTUM.NS):

| Year | ETF | Backtest (actual members) | Backtest (today's list, biased) |
|---|---|---|---|
| 2023 | +41% | +52% | +91% |
| 2024 | +22% | +12% | +38% |
| 2025 | −6% | −7% | −10% |
| 2026 YTD | −2% | +6% | +43% |

**Known caveats:**
- The archived member lists have gaps (2006–10, 2010–14, 2015–18, 2020–22, 2024–25). A stock that joined the index during a gap only becomes buyable at the next list, which makes results slightly pessimistic.
- Stocks without Yahoo data have no dividends.
- Demergers are smoothed rather than modelled.
- The index benchmark is price only (no dividends).

## 3. Momentum score

For each eligible stock on the last trading day of the month:

1. Calculate:
   - **12-1 month return:** the return over the last 12 months, leaving out the most recent month. Divide it by 1-year volatility.
   - **6-1 month return:** the same over 6 months. Divide it by 1-year volatility.
2. Convert each of the two numbers into a z-score across all eligible stocks and cap it at ±3. A z-score is the number of standard deviations from the average.
3. **Score = average of the two z-scores.** Rank from high to low.

**Eligible stocks:**
- Nifty 500 member on that date.
- At least 250 trading days of history.
- Median daily traded value over the last 60 days of at least ₹5 crore.
- Not an ETF.

## 4. Strategy rules

### Rule A (base)

At each month-end:

1. **Sell** any holding that:
   - has dropped below rank 40,
   - closed below its own 200-day average, or
   - has left the Nifty 500 or been delisted.
2. **Buy** to bring the portfolio back up to 20 stocks, taking the top-20 ranked stocks not already held. A stock qualifies only if:
   - its close is above its 200-day average, and
   - it had no single-day move bigger than 25% in the last 12 months.
3. **Size:** each new position gets 1/20 of the current portfolio value. Existing positions are not resized.
4. **Never** use stop-losses or trade during the month.

### Rule B (base for Rule C in section 7.4)

Rule A plus a market check:

- If the **Nifty 500 is below its 200-day average** at month-end, **make no new buys**.
- Existing holdings stay, and the normal sell rules still apply.

The effect is that in a falling market, holdings keep getting sold and the money stays in cash. The portfolio moves out of stocks gradually and refills once the market recovers.

## 5. Results (actual members at each date, after tax)

### 5.1 Headline numbers

| Measure | Rule A | Rule B |
|---|---|---|
| CAGR after tax | 21.0% | 20.6% |
| CAGR before tax | 22.8% | 22.5% |
| Sharpe ratio | 0.66 | 0.69 |
| Worst fall | −58% | −49% |
| Volatility | 25% | 22% |
| Trades per year | 53 | 44 |
| Win rate | 50% | 52% |
| Average win / average loss | +34% / −13% | +35% / −12% |
| Median holding period | 92 days | 92 days |
| Exits by rank / below 200-day average / delisted | 868 / 182 / 2 | 761 / 107 / 2 |
| Beat equal-weight over rolling 12 months | 75% of the time | 70% |
| ₹10 lakh grows to | ₹439 lakh | ₹411 lakh |
| Total tax paid | ₹54 lakh | ₹50 lakh |
| Average stocks held | 19.3 | 15.9 |

Benchmarks for the same period: Nifty 500 index 10.4% CAGR with a −64% worst fall; equal-weight universe 12.9%.

### 5.2 Calendar-year returns (%)

| Year | A | B | Equal-weight | Nifty 500 |
|---|---|---|---|---|
| 2007 | +107 | +107 | +90 | +61 |
| 2008 | −52 | −40 | −60 | −57 |
| 2009 | +79 | +75 | +123 | +89 |
| 2010 | +20 | +18 | +14 | +14 |
| 2011 | −17 | −10 | −36 | −27 |
| 2012 | +33 | +23 | +43 | +32 |
| 2013 | +6 | +3 | −6 | +4 |
| 2014 | +102 | +94 | +48 | +38 |
| 2015 | +8 | +9 | +3 | −1 |
| 2016 | −6 | +1 | +6 | +4 |
| 2017 | +99 | +94 | +54 | +36 |
| 2018 | −9 | −9 | −17 | −3 |
| 2019 | +11 | −1 | −7 | +8 |
| 2020 | +52 | +44 | +24 | +17 |
| 2021 | +64 | +65 | +49 | +30 |
| 2022 | +4 | +2 | +4 | +3 |
| 2023 | +54 | +50 | +44 | +26 |
| 2024 | +13 | +13 | +22 | +15 |
| 2025 | −12 | −14 | −1 | +7 |
| 2026 (to 11 Nov) | +8 | +6 | +3 | 0 |

### 5.3 Drawdowns (falls from a previous peak)

**Rule A:**

| Peak | Bottom | Fall | Recovered | Time below peak |
|---|---|---|---|---|
| Jan 2008 | Mar 2009 | −58% | Oct 2010 | 33 months |
| Aug 2018 | Mar 2020 | −40% | Sep 2020 | 25 months |
| Jul 2024 | Apr 2025 | −35% | not yet | 28 months so far |
| Nov 2010 | Feb 2011 | −29% | Dec 2013 | 37 months |
| Apr 2022 | Jun 2022 | −28% | Jun 2023 | 14 months |

**Rule B:**

| Peak | Bottom | Fall | Recovered | Time below peak |
|---|---|---|---|---|
| Jan 2008 | Mar 2008 | −49% | Jan 2010 | 24 months |
| Aug 2018 | Mar 2020 | −37% | Nov 2020 | 26 months |
| Jul 2024 | Mar 2026 | −32% | not yet | 28 months so far |
| Nov 2010 | Feb 2011 | −26% | Dec 2013 | 37 months |

**Nifty 500 index:** −64% in 2008, taking 76 months to recover; −38% in 2020; −19% in the 2024–25 correction.

### 5.4 Number of stocks held: how Rule B moves to cash

| Month-end | Jan 08 | Mar 08 | Jun 08 | Oct 08 | Mar 09 | Apr 09 | Jan 25 | Feb 25 | Apr 25 | May 25 | Mar 26 | May 26 | Jul 26 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Rule A | 20 | 6 | 7 | 3 | 13 | 18 | 20 | 15 | 20 | 20 | 18 | 20 | 20 |
| Rule B | 20 | 4 | 0 | 0 | 0 | 17 | 8 | 3 | 1 | 20 | 3 | 1 | 20 |

Rule B cannot prevent losses within a month. In January 2025 both rules lost 15%, because selling only happens at month-end.

### 5.5 2025 and 2026

| | Rule A | Rule B | Equal-weight | Nifty 500 |
|---|---|---|---|---|
| 2025 | −12.2% | −13.8% | −1.4% | +6.7% |
| 2026 (to 11 Nov) | +7.9% | +5.6% | +3.1% | 0.0% |

Most of the 2025 loss came in January and February: −15% and −9% for Rule A. The stocks that had led in 2024, mostly small and mid caps, fell hardest in that correction.

## 6. Survivorship bias: why the universe matters

All figures are after tax for 2007–2026, shown as CAGR / Sharpe / worst fall. The last column is the equal-weight portfolio of the same universe (CAGR only).

| Universe | No 200-day exit | With 200-day exit (A) | A + market check (B) | Equal-weight |
|---|---|---|---|---|
| Today's Nifty 500 list (biased) | 31.6% / 0.95 / −68% | 32.2% / 1.01 / −54% | 31.4% / 1.07 / −41% | 19.0% |
| **Actual members at each date** | 20.3% / 0.61 / −70% | 21.0% / 0.66 / −58% | 20.6% / 0.69 / −49% | 12.9% |
| Top 500 by traded value at each date | 23.6% / 0.67 / −74% | 24.9% / 0.73 / −60% | 24.3% / 0.76 / −50% | 12.8% |

Using today's list adds about 10 percentage points a year that is not real. The true figure probably lies between the "actual members" row and the "top 500 by traded value" row (20–25%). The member lists have gaps, so the "actual members" row is slightly pessimistic.

## 7. Variants explored

### 7.1 Exit rules (actual members, after tax)

| Variant | CAGR | Worst fall | Verdict |
|---|---|---|---|
| No 200-day exit (rank > 40 only) | 20.3% | −70% | Drawdown too deep |
| **Month-end close below 200-day average (A)** | 21.0% | −58% | Kept |
| A + Nifty 500 market check (B) | 20.6% | −49% | **Recommended** |
| Month-end close below 100-day average | 19.6% | −48% | Similar drawdown, lower return |
| Daily close below 100-day average | 18.3% | −43% | More trades and tax |
| 20% trailing stop | 16.4% | −64% | Rejected |
| 10% fixed stop | 18.7% | −64% | Rejected |
| Top 15 / sell below rank 30, + 200-day exit | 21.9% | −60% | Slightly better, but more concentrated |

These were also tested and **did not improve** results:
- ATR (average true range) trailing stops
- Rewarding smooth trends: the share of up-days
- Closeness to the 52-week high as an extra factor
- Volatility-targeted position sizing
- Moving fully to cash when the market turns down, instead of only stopping new buys

Momentum stocks often drop sharply and then recover, so tight stops sell at the bottom.

### 7.2 Which index to use for the market check (Rule B)

| Market check uses | CAGR | Sharpe | Worst fall | CAGR from 2009 | Worst fall from 2009 | Avg stocks held |
|---|---|---|---|---|---|---|
| No check (A) | 21.0% | 0.66 | −58% | 23.6% | −40% | 19.3 |
| **Nifty 500** | 20.6% | 0.69 | −49% | 21.6% | −37% | 15.9 |
| Nifty 50 | 21.2% | 0.71 | −49% | 22.3% | −34% | 16.4 |
| Nifty Next 50 | 20.1% | 0.67 | −49% | 21.2% | −37% | 16.0 |
| Midcap 50 | 19.3% | 0.64 | −49% | 20.2% | −37% | 15.8 |
| Smallcap 250 | 18.7% | 0.63 | −49% | 19.6% | −40% | 14.9 |
| Breadth: at least 50% of stocks above their 200-day average | 18.5% | 0.63 | −45% | 18.9% | −40% | 14.2 |

- The Nifty 50 is marginally best because it gives fewer false alarms in corrections limited to small and mid caps (2016, 2019, 2022). The 0.6% edge is within noise.
- The smallcap index and breadth checks are too cautious: they cost 2–2.5% a year for little drawdown benefit.
- No index prevents losses when everything falls together, as in 2008, 2020 and 2024–25.
- The Nifty 50 and Midcap 50 histories start in Sep 2007, so those checks only became active from April 2008.

### 7.3 How often to rebalance (Rule B)

Results depend on which day you trade ("timing luck"), so each frequency was run on several schedules: different trading days of the month, different weekdays, or different months in the cycle. Raw output is in `data/rebalance.txt`.

| Frequency | CAGR (best and worst schedule) | Average | Sharpe | Worst fall (average) | Trades per year | Median holding period |
|---|---|---|---|---|---|---|
| Daily | 21.8% | 21.8% | 0.73 | −42% | 71 | 57 days |
| **Weekly** (5 weekdays) | 20.9–23.2% | **21.8%** | 0.72 | **−43%** | 59 | 70–77 days |
| Weekly, sell below rank 50 | 19.8–22.7% | 21.1% | 0.70 | −43% | 50 | 91 days |
| Every 2 weeks | 21.9–22.1% | 22.0% | 0.73 | −44% | 52 | 84 days |
| **Monthly** (8 days of the month) | 19.2–22.5% | **21.0%** | 0.70 | −46% | 44 | 92 days |
| Every 2 months | 18.7–19.2% | 19.0% | 0.63 | −49% | 36 | 122 days |
| Quarterly | 16.5–20.1% | 19.0% | 0.66 | −46% | 30 | 181 days |
| Every 6 months | 13.7–17.9% | 15.5% | 0.52 | −46% | 20 | 184 days |

Other variants:

| Variant | CAGR | Worst fall |
|---|---|---|
| Monthly rebalance with a weekly sell check | 20.0% | −42% |
| Quarterly rebalance with a monthly sell check | 16.3% | −39% |
| Weekly at 0.5% cost per side (double) | 21.7% | −42% |
| Monthly at 0.5% cost per side | 19.5% | −49% |

Weekly versus monthly on other universes:

| Universe | Monthly | Weekly |
|---|---|---|
| Top 500 by traded value | 24.3% / −50% | 24.5% / −46% |
| Today's list | 29.9% / −39% | 30.3% / −36% |

Findings:
- **Rebalancing less often than monthly is clearly worse.** Quarterly costs about 2% a year and semi-annual about 5–6%. Momentum signals fade within a few months.
- The Nifty200 Momentum 30 index rebalances semi-annually. That suits a large fund that must limit trading, but costs return.
- **Weekly versus monthly is close.** Weekly adds about +0.8% a year, which is not statistically significant (t-statistic 1.8; weekly beat monthly in 54% of months). It does reduce the average worst fall by 3–6 points in every universe, because 200-day breaks and market-check signals are acted on sooner.
- Weekly also has costs: about 35% more trades, more short-term gains tax events, and work every week.
- **Timing luck is as large as the frequency effect.** The same monthly rules return 19.2–22.5% depending only on which day of the month you trade. The month-end schedule (20.6%) happened to be below average.
- Mid-month (10 trading days before month-end) was the best monthly day. That is likely luck; don't pick a day based on it.
- Quarterly rebalancing at the end of Feb/May/Aug/Nov (20.1%) beat Mar/Jun/Sep/Dec (16.5%). This is consistent with published research on window-dressing (fund managers buying recent winners before quarter-end), but it is still a single test.
- **Splitting capital into tranches** on different rebalance days evens out timing luck rather than improving the average. Example: 4 monthly tranches, each trading on a different day, gave 21.1% / −46%.
- Adding a weekly sell-only check to a monthly rebalance cuts drawdowns but gives up return: cash sits idle until month-end.

### 7.4 Entry and exit signals (Rule B as the base)

Each variant is averaged over 4 monthly schedules and 3 weekday schedules to remove timing luck. Raw output is in `data/entry_exit.txt` and `data/entry_exit_combo.txt` (`python entry_exit.py [combo]`).

| Variant | Monthly CAGR / Sharpe / worst fall | Trades/yr | Weekly CAGR / Sharpe / worst fall | Trades/yr | Verdict |
|---|---|---|---|---|---|
| Base | 21.0% / 0.70 / −46% | 44 | 22.0% / 0.73 / −43% | 59 | |
| **Entry: within 10% of the 52-week high** (candidates from the top 30) | 22.0% / 0.75 / **−41%** | 41 | 22.0% / 0.75 / **−39%** | 56 | **Better** |
| Entry: within 15% / 20% of the 52-week high | 21.7% / 21.3%, −42% | 43 | 21.6% / 21.6%, −41% / −44% | 57 | Better, but less so |
| Entry: within 5% of the 52-week high | 20.6% / −41% | 39 | 20.7% / −40% | 56 | Too strict |
| Entry: breakout within 3% of the 20-day high | 20.0% / −41% | 40 | 20.5% / −41% | 58 | Lower return |
| Entry: pullback to ≤3% above the 20-day average | 17.5% / −45% | 52 | 20.2% / −43% | 68 | **Worse** |
| Entry: pullback to ≤8% above the 20-day average | 19.8% / −46% | 46 | 20.8% / −44% | 62 | Worse |
| Entry: skip if >50% above the 200-day average | 14.9% / −40% | 47 | 17.3% / −41% | 68 | **Much worse** |
| Entry: skip if >100% above the 200-day average | 20.2% / −43% | 45 | 21.5% / −42% | 60 | Worse |
| Exit: below the 150-day average instead of 200 | 20.0% / −44% | 46 | 20.4% / −41% | 63 | Worse |
| Exit: below the 100-day average instead of 200 | 18.5% / −39% | 51 | 18.7% / −38% | 76 | Worse |
| Exit: 25% trailing stop (checked on rebalance days) | 19.6% / −42% | 46 | 19.8% / −45% | 63 | Worse |
| Exit: 35% trailing stop | 20.1% / −43% | 44 | 20.7% / −44% | 60 | Worse |
| Exit: sell below rank 60 | 20.6% / −46% | 36 | 21.7% / −44% | 45 | Same, fewer trades |
| **Exit: "ride winners"** (rank exit only once below the 50-day average) | 21.0% / 0.70 / −45% | **31** | 22.4% / 0.74 / −43% | **43** | **Same return, 30% fewer trades** |
| Exit: ride winners, 100-day average | 20.7% / −44% | 29 | 21.9% / −43% | 38 | Similar |
| **52-week entry (10%) + ride winners (50-day)** | **22.0% / 0.76 / −39%** | **29** | **23.6% / 0.81 / −41%** | **39** | **Best** |
| 52-week entry (15%) + ride winners (50-day) | 21.7% / 0.74 / −40% | 30 | 22.8% / 0.77 / −42% | 41 | Robust |
| 52-week entry (10%) + ride winners (100-day) | 21.5% / 0.75 / −39% | 27 | 22.5% / 0.77 / −40% | 35 | Robust |

Findings:
- **Buy strength, not weakness.** Pullback entries and limits on how far a stock is above its average all cut returns. The biggest momentum winners are always "extended".
- **Near the 52-week high is a useful confirmation.** A stock that has lost more than 10% from its high has momentum that is already fading. This works as an entry filter, although adding it to the ranking score did not help (section 7.1). It is backed by research on the 52-week high (George & Hwang, 2004).
- **Faster exits hurt.** 100/150-day averages and trailing stops sell winners during normal pullbacks.
- **"Ride winners" keeps the return and cuts trades.** A stock that has slipped in rank but is still above its 50-day average is still trending, so keep it. Trades fall by about a third and the median holding period rises from 94 to 150 days. That means more trades qualify for long-term gains tax and costs fall.
- **The improvement is consistent** across nearby settings (52-week 10–20%, top 20/30/40 candidates, 50- or 100-day average) and in 2016–2026 alone. It is still modest: about +1% a year and 5–7 points less drawdown, after testing about 30 variants.

### Rule C (Rule B with improved entry and exit)

At each month-end (or each week):

1. **Sell** a holding if:
   - it is below its 200-day average, or
   - it has left the Nifty 500, or
   - it has dropped below rank 40 **and** is below its 50-day average.
2. **Market check:** if the Nifty 500 is below its 200-day average, buy nothing.
3. **Buy** to fill empty slots up to 20, going down the top-30 ranks. A stock qualifies if:
   - it is above its 200-day average,
   - it is **within 10% of its 52-week high**, and
   - it had no single-day move bigger than 25% in the last year.

   Unfilled slots stay in cash.

The exact definitions and the checklist are in the SUMMIT-20 rulebook: [strategies/summit-momentum.md](../strategies/summit-momentum.md).

## 8. Recommendation

1. **Strategy:** Rule C (section 7.4): Rule B plus the 52-week-high entry check and the "ride winners" exit.
   - Monthly: 22.0% CAGR with a −39% worst fall and 29 trades a year. Weekly: 23.6% with −41% and 39 trades a year.
   - Rule B is the simpler fallback.
   - The Nifty 50 is an acceptable market-check index; the difference is noise.
   - **Frequency:** monthly is fine. Weekly is a modest upgrade.
   - Don't go slower than monthly.
2. **Allocation:** at most 50% of equity money in the strategy, the rest in a Nifty 50 or Nifty 500 index fund. The estimated mix (not backtested) gives about 15–16% a year with a worst fall of about −30%.
3. **Expectations:**
   - About 20% a year after tax over the long run.
   - Losing years about 1 in 4.
   - 30–40% falls every few years and −50% in a severe crash.
   - Up to 3 years below a previous high.
4. **Discipline:** follow the rules every month without overriding them. The main way momentum strategies fail is that people abandon them during a drawdown.
5. **Minimum capital:** about ₹10 lakh, so each position is at least ₹50,000.
6. **Low-effort alternative:** a Nifty200 Momentum 30 index fund or ETF.
   - For: no trading, and tax only when you sell.
   - Against: no market check, so drawdowns similar to Rule A, plus a fee of roughly 0.3–0.5% a year.
7. **Current state:** the strategy is about 30% below its July 2024 peak in the backtest.

## 9. Next step (planned)

Build a **Momentum rank** view in the app:
- **Data:** the current Nifty 500 member list, and Kite historical prices fetched at no more than 3 requests per second and cached for the day.
- **Columns:** rank, score, 12-1 return, 6-1 return, volatility, % above or below the 200-day and 50-day averages, % below the 52-week high.
- **Flags (SUMMIT-20 rulebook):**
  - Buy: top 30, above the 200-day average, within 10% of the 52-week high, no move bigger than 25% in a day
  - Hold
  - Sell: below the 200-day average, out of the universe, or below rank 40 and below the 50-day average. Provisional during the month, confirmed at month-end
  - Already held (from your Kite holdings)
  - Entry blocked, with the reason
- **Market indicator:** whether the Nifty 500 is above or below its 200-day average.

## 10. Reproduce

Run from the `backtest/` folder (Python 3.13, pandas, numpy):

```powershell
python pit.py            # first run: downloads member lists, bhavcopy files, builds data/pit_panel.pkl (~6 min)
python survivorship.py   # universe comparison -> data/survivorship.txt
python run.py            # variants on the original (today's list) universe -> data/results.txt
```

```python
from engine import Config, run, metrics
A = Config(universe='pit', ma_exit=200)
B = A.but(regime='no_new_buys')                       # market check on the Nifty 500
B50 = A.but(regime='no_new_buys', regime_index='NIFTY50')
BW = B.but(rebalance='W', exit_rank=50)               # weekly; rebalance: D/W/2W/M/2M/Q/6M, rebal_offset, rebal_phase, exit_freq
C = B.but(entry_breakout=0.10, breakout_days=252, buy_rank=30, rank_exit_ma=50)  # Rule C
r = run(B); print(metrics(r['nav']))
```

| File | Purpose |
|---|---|
| `pit.py` | Member-list snapshots, bhavcopy download, symbol renames, split adjustment, panel build |
| `data.py` | Yahoo price and index download (`load_prices`, `load_indices`) |
| `engine.py` | `Config`, eligibility, scoring, monthly rebalance simulation, tax, metrics |
| `survivorship.py` | Comparison across universes |
| `run.py` | Variant grid on the original universe |
| `entry_exit.py` | Entry and exit variants, averaged over rebalance schedules |

## 11. How to run Rule C

Rule C has been turned into a strategy called **Summit Momentum (SUMMIT-20)**. Its full rulebook (settings, formulas, monthly checklist, special situations, costs and tax, discipline) is in [strategies/summit-momentum.md](../strategies/summit-momentum.md).
