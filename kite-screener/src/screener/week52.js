import { lookupWeek52Levels } from './screenerTokenCache';

const NEAR_RATIO = 0.02;

function positive(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function format(value) {
  return value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function levelsForRow(row) {
  const high = positive(row.week_52_high);
  const low = positive(row.week_52_low);
  if (high && low) {
    return low <= high ? { high, low } : null;
  }
  return lookupWeek52Levels(row);
}

/**
 * 52W breakout/breakdown/near state for a table row, or null.
 * Returns null whenever data is missing or inconsistent, so a badge is never shown on doubt.
 */
export function getWeek52State(row) {
  if (!row || row.type === 'separator') return null;

  const levels = levelsForRow(row);
  if (!levels) return null;

  const ltp = positive(row.last_price);
  const prevClose = positive(row.close);
  if (!ltp || !prevClose) return null;

  // Prev close outside the 52W range means stale levels or an unadjusted split/bonus.
  if (prevClose > levels.high || prevClose < levels.low) return null;

  const dayHigh = positive(row.high);
  const dayLow = positive(row.low);
  const validDay = dayHigh && dayLow && dayLow <= dayHigh;

  // Same comparison as the 52W High Breakout / Low Breakdown presets.
  const brokeHigh = validDay && dayHigh >= levels.high;
  const brokeLow = validDay && dayLow <= levels.low;

  if (brokeHigh && (!brokeLow || ltp >= (levels.high + levels.low) / 2)) {
    return {
      kind: 'high',
      label: '52W H',
      title: `52W high: today's high ${format(dayHigh)} ≥ 52W high ${format(levels.high)}`,
    };
  }
  if (brokeLow) {
    return {
      kind: 'low',
      label: '52W L',
      title: `52W low: today's low ${format(dayLow)} ≤ 52W low ${format(levels.low)}`,
    };
  }

  const nearHigh = ltp >= levels.high * (1 - NEAR_RATIO);
  const nearLow = ltp <= levels.low * (1 + NEAR_RATIO);
  // A very narrow 52W range would be near both ends; that signal is noise.
  if (nearHigh === nearLow) return null;

  if (nearHigh) {
    const pct = ((levels.high - ltp) / levels.high) * 100;
    return {
      kind: 'near-high',
      label: '≈52W H',
      title: `${pct.toFixed(1)}% below 52W high ${format(levels.high)}`,
    };
  }

  const pct = ((ltp - levels.low) / levels.low) * 100;
  return {
    kind: 'near-low',
    label: '≈52W L',
    title: `${pct.toFixed(1)}% above 52W low ${format(levels.low)}`,
  };
}
