import { useEffect, useRef } from 'react';
import { createChart } from 'lightweight-charts';

const BASE_OPTIONS = {
  autoSize: true,
  layout: {
    background: { type: 'solid', color: '#ffffff' },
    textColor: '#636c76',
    fontFamily: "Inter, 'Segoe UI', system-ui, sans-serif",
    fontSize: 11,
  },
  grid: {
    vertLines: { color: 'rgba(208,215,222,0.35)' },
    horzLines: { color: 'rgba(208,215,222,0.35)' },
  },
  rightPriceScale: { borderColor: '#d0d7de' },
  timeScale: { borderColor: '#d0d7de', rightOffset: 2 },
};

function rebased(nav, field, base) {
  const first = nav.find((r) => Number.isFinite(r[field]) && r[field] > 0);
  if (!first) return [];
  return nav
    .filter((r) => Number.isFinite(r[field]) && r[field] > 0)
    .map((r) => ({ time: r.date, value: (r[field] / first[field]) * base }));
}

/** Strategy value vs Nifty 500 / Nifty 50 (all rebased to 100) and the strategy drawdown. */
export default function StrategyNavChart({ nav, drawdown }) {
  const perfRef = useRef(null);
  const ddRef = useRef(null);

  useEffect(() => {
    const perfWrap = perfRef.current;
    const ddWrap = ddRef.current;
    if (!perfWrap || !ddWrap || nav.length < 1) return undefined;

    const perf = createChart(perfWrap, { ...BASE_OPTIONS, rightPriceScale: { ...BASE_OPTIONS.rightPriceScale, scaleMargins: { top: 0.08, bottom: 0.08 } } });
    const line = (color, title, width = 2) => perf.addLineSeries({ color, lineWidth: width, title, priceLineVisible: false });
    line('#ff5722', 'SUMMIT-20', 2).setData(rebased(nav, 'nav', 100));
    line('#4184f3', 'Nifty 500', 1.5).setData(rebased(nav, 'n500', 100));
    line('#8a92a3', 'Nifty 50', 1).setData(rebased(nav, 'n50', 100));
    perf.timeScale().fitContent();

    const dd = createChart(ddWrap, { ...BASE_OPTIONS, rightPriceScale: { ...BASE_OPTIONS.rightPriceScale, scaleMargins: { top: 0.05, bottom: 0.02 } } });
    const ddSeries = dd.addAreaSeries({
      lineColor: '#cf222e',
      topColor: 'rgba(207,34,46,0.05)',
      bottomColor: 'rgba(207,34,46,0.25)',
      lineWidth: 1,
      priceLineVisible: false,
      title: 'Drawdown %',
    });
    ddSeries.setData(nav.map((r, k) => ({ time: r.date, value: Math.round(drawdown[k] * 10000) / 100 })));
    dd.timeScale().fitContent();

    const sync = (source, target) => source.timeScale().subscribeVisibleLogicalRangeChange((range) => {
      if (range) target.timeScale().setVisibleLogicalRange(range);
    });
    sync(perf, dd);

    return () => {
      perf.remove();
      dd.remove();
    };
  }, [nav, drawdown]);

  if (nav.length < 2) {
    return <div className="strategy-chart-empty">The chart appears after the first completed session.</div>;
  }
  return (
    <div className="strategy-chart">
      <div className="strategy-chart-perf" ref={perfRef} />
      <div className="strategy-chart-dd" ref={ddRef} />
    </div>
  );
}
