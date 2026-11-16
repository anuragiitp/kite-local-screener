// Fund reference data shared by scripts/generate-mf-categories.mjs and the in-app refresh:
// SEBI category (AMFI NAVAll.txt), IDCW/bonus ISINs Kite mislabels as growth, and AUM (Coin).
// Keep this file free of imports so Node can load it directly.

// www.amfiindia.com 302-redirects here; the browser drops our CORS header across that redirect.
export const AMFI_URL = 'https://portal.amfiindia.com/spages/NAVAll.txt';
export const COIN_URL = 'https://coin.zerodha.com/';

// [regex on the AMFI sub-category, label, group]; first match wins.
const RULES = [
  [/^Large Cap/i, 'Large Cap', 'Equity'],
  [/^Large & Mid Cap/i, 'Large & Mid Cap', 'Equity'],
  [/^Mid Cap/i, 'Mid Cap', 'Equity'],
  [/^Small Cap/i, 'Small Cap', 'Equity'],
  [/^Multi Cap/i, 'Multi Cap', 'Equity'],
  [/^Flexi Cap/i, 'Flexi Cap', 'Equity'],
  [/^Focused/i, 'Focused', 'Equity'],
  [/^Value/i, 'Value', 'Equity'],
  [/^Contra/i, 'Contra', 'Equity'],
  [/^Dividend Yield/i, 'Dividend Yield', 'Equity'],
  [/^ELSS/i, 'ELSS', 'Equity'],
  [/^(Sectoral|Thematic)/i, 'Sectoral / Thematic', 'Equity'],
  [/^Aggressive Hybrid/i, 'Aggressive Hybrid', 'Hybrid'],
  [/Balanced Advantage|Dynamic Asset Allocation/i, 'Balanced Advantage', 'Hybrid'],
  [/^Multi Asset/i, 'Multi Asset', 'Hybrid'],
  [/^Equity Savings/i, 'Equity Savings', 'Hybrid'],
  [/^Arbitrage/i, 'Arbitrage', 'Hybrid'],
  [/^Conservative Hybrid/i, 'Conservative Hybrid', 'Hybrid'],
  [/^Balanced Hybrid/i, 'Balanced Hybrid', 'Hybrid'],
  [/Retirement|Children|Life Cycle/i, 'Solution Oriented', 'Other'],
];

// AMFI still lists some debt schemes under pre-2018 names.
const DEBT_RULES = [
  [/Overnight/i, 'Overnight'],
  [/Liquid/i, 'Liquid'],
  [/Money Market/i, 'Money Market'],
  [/Ultra Short to Short|Low Duration/i, 'Low Duration'],
  [/Ultra Short/i, 'Ultra Short Duration'],
  [/Medium to Long/i, 'Medium to Long Duration'],
  [/^Short/i, 'Short Duration'],
  [/^Medium/i, 'Medium Duration'],
  [/^Long/i, 'Long Duration'],
  [/Dynamic/i, 'Dynamic Bond'],
  [/Banking and PSU/i, 'Banking & PSU'],
  [/Corporate Bond/i, 'Corporate Bond'],
  [/Credit Risk/i, 'Credit Risk'],
  [/Floating|Floater/i, 'Floater'],
  [/Gilt/i, 'Gilt'],
];

const KITE_FALLBACK = {
  Equity: ['Other Equity', 'Equity'],
  'Index Funds': ['Index Fund', 'Index'],
  Debt: ['Other Debt', 'Debt'],
  Hybrid: ['Other Hybrid', 'Hybrid'],
  'Fund of Funds': ['FoF Domestic', 'FoF'],
};

export function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

function classify(header, name) {
  const m = header.match(/^[^(]*\((.*)\)\s*$/);
  const inner = m ? m[1] : header;
  if (/^Close Ended|^Interval/i.test(header)) return ['Close Ended / Interval', 'Other'];
  const dash = inner.lastIndexOf(' - ');
  const group = dash >= 0 ? inner.slice(0, dash) : inner;
  const sub = (dash >= 0 ? inner.slice(dash + 3) : inner).trim();

  if (/Index Funds/i.test(group) || /^Index Funds$/i.test(sub)) {
    if (/Debt/i.test(sub)) return ['Debt Index', 'Debt'];
    if (/Hybrid/i.test(sub)) return ['Hybrid Index', 'Hybrid'];
    return ['Index Fund', 'Index'];
  }
  if (/FoF|Fund of Funds/i.test(group) || /FoF|Fund of Funds/i.test(sub)) {
    if (/gold|silver|precious/i.test(name)) return ['Gold / Silver FoF', 'FoF'];
    return /Overseas/i.test(group + sub) ? ['FoF Overseas', 'FoF'] : ['FoF Domestic', 'FoF'];
  }
  if (/Debt|Income|Gilt/i.test(group) || /^(Gilt|Income)$/i.test(inner)) {
    const debt = DEBT_RULES.find(([re]) => re.test(sub));
    return [debt ? debt[1] : 'Other Debt', 'Debt'];
  }
  const rule = RULES.find(([re]) => re.test(sub));
  if (rule) return [rule[1], rule[2]];
  return [sub || 'Other', 'Other'];
}

/**
 * Coin ships its daily fund table inside a lazy webpack chunk; rows look like
 * [isin, purchase, redemption, divDate, divPct, nav, navDate, change, 1Y..5Y, aumCr, ...].
 * `getText(url)` fetches a URL as text; `preferChunk` is tried first (last chunk that matched).
 */
export async function fetchCoinAum(getText, preferChunk = '') {
  const html = await getText(COIN_URL);
  const appPath = html.match(/src="(\/static\/js\/app\.[^"]+\.js)"/)?.[1];
  if (!appPath) throw new Error('Coin app bundle not found');
  const app = await getText(new URL(appPath, COIN_URL).href);
  const chunkMap = app.match(/static\/js\/"\+\w\+"\."\+(\{[^}]+\})/)?.[1];
  if (!chunkMap) throw new Error('Coin chunk map not found');
  const chunks = Object.entries(JSON.parse(chunkMap.replace(/(\d+):/g, '"$1":')));
  chunks.sort(([a], [b]) => Number(b === preferChunk) - Number(a === preferChunk));
  for (const [id, hash] of chunks) {
    const js = await getText(new URL(`static/js/${id}.${hash}.js`, COIN_URL).href);
    const rows = js.match(/\["INF[A-Z0-9]{9}",[01],[01],[^[\]]*\]/g);
    if (!rows || rows.length < 500) continue;
    const aum = {};
    let date = '';
    rows.forEach((text) => {
      const row = JSON.parse(text);
      const crores = Number(row[13]);
      if (Number.isFinite(crores) && crores > 0) aum[row[0]] = crores < 10 ? Math.round(crores * 10) / 10 : Math.round(crores);
      if (typeof row[6] === 'string' && row[6] > date) date = row[6];
    });
    return { aum, date, chunk: id };
  }
  throw new Error('Coin fund table not found');
}

/**
 * funds: [{ isin, schemeType }] (Kite direct growth). coin: { aum, date } or null.
 * Returns { categories: [{label, group}], byIsin: {isin: index}, notGrowth: [isin], aum, aumDate, stats }.
 */
export function buildReference(funds, amfiText, coin) {
  const kite = new Map(funds.map((f) => [f.isin, f]));
  const amfiCat = new Map();
  const notGrowth = new Set();
  let header = '';
  amfiText.split(/\r?\n/).forEach((raw) => {
    const line = raw.trim();
    if (!line) return;
    if (!line.includes(';')) {
      if (line.includes('(')) header = line;
      return;
    }
    const c = line.split(';');
    // Scheme names may themselves contain ';' — the last two fields are NAV and date.
    const schemeName = c.slice(3, -2).join(';');
    const isNotGrowth = /idcw|dividend|bonus|payout|reinvest/i.test(schemeName.replace(/dividend yield/gi, ''));
    [c[1], c[2]].forEach((value) => {
      const id = (value || '').trim();
      if (/^INF\w{9}$/.test(id) && kite.has(id)) {
        amfiCat.set(id, classify(header, c[3] || ''));
        if (isNotGrowth) notGrowth.add(id);
      }
    });
  });

  const categories = [];
  const labelIndex = new Map();
  const byIsin = {};
  const aum = {};
  let fallback = 0;
  [...kite.keys()].sort().forEach((isin) => {
    const { schemeType } = kite.get(isin);
    let cat = amfiCat.get(isin);
    if (/Long Short/i.test(schemeType)) cat = ['SIF Long-Short', 'Other'];
    if (!cat) {
      fallback += 1;
      cat = KITE_FALLBACK[schemeType] || ['Other', 'Other'];
    }
    const key = `${cat[1]}|${cat[0]}`;
    if (!labelIndex.has(key)) {
      labelIndex.set(key, categories.length);
      categories.push({ label: cat[0], group: cat[1] });
    }
    byIsin[isin] = labelIndex.get(key);
    if (coin?.aum?.[isin] > 0) aum[isin] = coin.aum[isin];
  });

  return {
    categories,
    byIsin,
    notGrowth: [...notGrowth].sort(),
    aum,
    aumDate: coin?.date || '',
    stats: { funds: kite.size, amfiMatched: amfiCat.size, fallback, notGrowth: notGrowth.size, aum: Object.keys(aum).length },
  };
}
