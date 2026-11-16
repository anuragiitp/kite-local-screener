// Parity check: JS SUMMIT-20 engine vs backtest/engine.py (Rule C).
// Fixture: python backtest/export_js_parity.py  ->  backtest/data/js_parity.json
// Run:     node scripts/strategy-parity.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { rankUniverse } from '../src/strategy/summitMomentum.js';
import { createRun, advance } from '../src/strategy/paperLedger.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(path.join(here, '../../backtest/data/js_parity.json'), 'utf8'));
const toNum = (arr) => Float64Array.from(arr, (v) => (v === null ? NaN : v));

const panel = {
  dates: fixture.dates,
  bench: toNum(fixture.bench),
  series: {},
};
for (const [sym, s] of Object.entries(fixture.symbols)) {
  panel.series[sym] = { close: toNum(s.close), open: toNum(s.open), tval: toNum(s.tval) };
}
const ref = fixture.reference;
let failures = 0;
const fail = (msg) => {
  failures += 1;
  console.log('  FAIL', msg);
};

console.log('1) Rankings on each signal day');
for (const [date, sig] of Object.entries(ref.signals)) {
  const i = panel.dates.indexOf(date);
  const { ranked } = rankUniverse(panel, i, fixture.members[date]);
  const top = ranked.slice(0, sig.top.length);
  let maxDiff = 0;
  let orderOk = true;
  sig.top.forEach(([sym, score], k) => {
    // fixture scores are rounded to 6 dp, so a swap of two near-equal scores is not a difference
    if (top[k]?.sym !== sym && !(Math.abs((top[k]?.score ?? Infinity) - score) < 2e-6)) {
      orderOk = false;
      console.log(`    rank ${k + 1}: py ${sym} ${score} js ${top[k]?.sym} ${top[k]?.score}`);
    }
    const mine = ranked.find((r) => r.sym === sym);
    maxDiff = Math.max(maxDiff, mine ? Math.abs(mine.score - score) : Infinity);
  });
  const line = `${date}: scored ${ranked.length}/${sig.count}, top-${sig.top.length} order ${orderOk ? 'same' : 'DIFF'}, max score diff ${maxDiff.toExponential(1)}`;
  if (!orderOk || ranked.length !== sig.count || maxDiff > 1e-4) fail(line);
  else console.log('  ok  ', line);
}

console.log('2) Full replay (fractional shares, no circuit rule, no initial build)');
const startIndex = fixture.startIndex;
const state = createRun({
  panel,
  startIndex,
  universe: [],
  capital: 1000000,
  options: { wholeShares: false, circuitRule: false, initialBuild: false },
});
advance(state, panel, (d) => fixture.members[d] || []);

const key = (sym, entry, exit) => `${sym}|${entry}|${exit}`;
const pyTrades = new Map(ref.trades.map(([entry, exit, sym, ret, why]) => [key(sym, entry, exit), { ret, why }]));
const jsTrades = new Map(state.trades.map((t) => [key(t.sym, t.entryDate, t.exitDate), t]));
const missing = [...pyTrades.keys()].filter((k) => !jsTrades.has(k));
const extra = [...jsTrades.keys()].filter((k) => !pyTrades.has(k));
let maxRetDiff = 0;
for (const [k, t] of jsTrades) {
  const p = pyTrades.get(k);
  if (p) maxRetDiff = Math.max(maxRetDiff, Math.abs(p.ret - t.ret));
}
const tradeLine = `closed trades py ${pyTrades.size} js ${jsTrades.size}, missing ${missing.length}, extra ${extra.length}, max return diff ${maxRetDiff.toExponential(1)}`;
if (missing.length || extra.length || maxRetDiff > 1e-4) {
  fail(tradeLine);
  missing.slice(0, 10).forEach((k) => console.log('    missing', k));
  extra.slice(0, 10).forEach((k) => console.log('    extra  ', k));
} else console.log('  ok  ', tradeLine);

const pyNav = new Map(ref.nav);
let maxNavDiff = 0;
let compared = 0;
for (const row of state.nav) {
  const p = pyNav.get(row.date);
  if (p === undefined) continue;
  compared += 1;
  maxNavDiff = Math.max(maxNavDiff, Math.abs(row.nav / p - 1));
}
const lastPy = ref.nav[ref.nav.length - 1];
const lastJs = state.nav[state.nav.length - 1];
const navLine = `NAV rows ${compared}/${ref.nav.length}, max rel diff ${maxNavDiff.toExponential(1)}, final py ${lastPy[1]} js ${lastJs.nav}`;
if (compared !== ref.nav.length || maxNavDiff > 1e-6) fail(navLine);
else console.log('  ok  ', navLine);

console.log('3) Same replay with whole shares + circuit rule (app settings, info only)');
const app = createRun({ panel, startIndex, universe: [], capital: 1000000, options: { initialBuild: false } });
advance(app, panel, (d) => fixture.members[d] || []);
console.log(`  final NAV ${app.nav[app.nav.length - 1].nav} vs fractional ${lastJs.nav}; trades ${app.trades.length}`);

console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll parity checks passed');
process.exit(failures ? 1 : 0);
