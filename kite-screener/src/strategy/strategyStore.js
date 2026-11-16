// Persistence for paper-trading runs.
// Master copy: chrome.storage.local through the extension (survives clearing site data).
// Mirror copy: IndexedDB (used when the extension is unavailable). Both carry a SHA-256 checksum.

import { bridgeRequest } from './strategyBridge';
import { idbGet, idbPut } from './strategyData';
import { LEDGER_SCHEMA } from './paperLedger';

export const EXPORT_APP = 'kite-screener-strategy';
export const EXPORT_FORMAT = 1;
export const STRATEGY_CODES = ['SUMMIT-20'];
const MAX_IMPORT_BYTES = 25 * 1024 * 1024;

const storeKey = (code) => `kite-strategy:${code}`;
const undoKey = (code) => `kite-strategy:${code}:undo`;

async function sha256(text) {
  const bytes = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function pack(state) {
  const body = JSON.stringify(state);
  const checksum = await sha256(body);
  const savedAt = new Date().toISOString();
  return { text: `{"format":${EXPORT_FORMAT},"savedAt":"${savedAt}","checksum":"${checksum}","state":${body}}`, checksum };
}

async function unpack(text) {
  if (!text) return null;
  const parsed = JSON.parse(text);
  if (!parsed?.state || (await sha256(JSON.stringify(parsed.state))) !== parsed.checksum) {
    throw new Error('Saved run failed its checksum');
  }
  return { state: parsed.state, savedAt: parsed.savedAt || parsed.state.updatedAt || '' };
}

async function writeKey(key, text) {
  const results = await Promise.allSettled([
    bridgeRequest('strategyStore', { op: 'set', key, value: text }, 15000),
    idbPut('ledgers', { key, value: text, savedAt: new Date().toISOString() }),
  ]);
  const master = results[0].status === 'fulfilled' && results[0].value.ok;
  const mirror = results[1].status === 'fulfilled';
  if (!master && !mirror) throw new Error('Could not save the paper-trading run');
  return { master, mirror };
}

async function readKey(key) {
  const [masterReply, mirrorRow] = await Promise.all([
    bridgeRequest('strategyStore', { op: 'get', key }, 10000),
    idbGet('ledgers', key).catch(() => null),
  ]);
  const candidates = [];
  const problems = [];
  if (masterReply.ok && masterReply.value) {
    try {
      candidates.push({ ...(await unpack(masterReply.value)), source: 'extension' });
    } catch (error) {
      problems.push(`extension copy: ${error.message}`);
    }
  }
  if (mirrorRow?.value) {
    try {
      candidates.push({ ...(await unpack(mirrorRow.value)), source: 'browser' });
    } catch (error) {
      problems.push(`browser copy: ${error.message}`);
    }
  }
  // Newest write wins (imports/undo keep the state's own updatedAt, so it can't be used here).
  candidates.sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)));
  const best = candidates[0] || null;
  const warnings = [...problems];
  if (!masterReply.ok) {
    warnings.push(masterReply.timeout || /unknown message/i.test(masterReply.error || '')
      ? 'Extension storage unavailable — reload the extension in chrome://extensions. Using the browser copy.'
      : `Extension storage error: ${masterReply.error}`);
  }
  return { state: best?.state || null, source: best?.source || null, warnings };
}

export async function loadRun(code) {
  return readKey(storeKey(code));
}

/** Save the run. touch=false keeps updatedAt (used when restoring an exact imported state). */
export async function saveRun(state, { touch = true } = {}) {
  if (touch) state.updatedAt = new Date().toISOString();
  const { text } = await pack(state);
  return writeKey(storeKey(state.run.strategy), text);
}

async function keepUndo(code, label) {
  const current = await readKey(storeKey(code));
  if (!current.state) return false;
  const { text } = await pack({ ...current.state, undoLabel: label, undoSavedAt: new Date().toISOString() });
  await writeKey(undoKey(code), text);
  return true;
}

export async function loadUndo(code) {
  const { state } = await readKey(undoKey(code));
  return state;
}

export async function restoreUndo(code) {
  const state = await loadUndo(code);
  if (!state) throw new Error('Nothing to undo');
  const { undoLabel, undoSavedAt, ...rest } = state;
  await keepUndo(code, 'before undo');
  await saveRun(rest, { touch: false });
  return rest;
}

/** Delete the run (a copy is kept for undo). */
export async function resetRun(code) {
  await keepUndo(code, 'before reset');
  const reply = await bridgeRequest('strategyStore', { op: 'remove', key: storeKey(code) }, 10000);
  // Otherwise the extension copy would bring the run back on the next load.
  if (!reply.ok) throw new Error(`Could not delete the run from extension storage (${reply.error || 'no answer'}). Reload the extension and try again.`);
  await idbPut('ledgers', { key: storeKey(code), value: '', savedAt: new Date().toISOString() });
}

// ---------- export / import ----------

export async function exportPayload(state) {
  const { checksum } = await pack(state);
  return {
    app: EXPORT_APP,
    format: EXPORT_FORMAT,
    strategy: state.run.strategy,
    exportedAt: new Date().toISOString(),
    checksum,
    state,
  };
}

function downloadText(filename, text, type = 'application/json') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export async function exportRunFile(state) {
  const payload = await exportPayload(state);
  downloadText(`${state.run.strategy.toLowerCase()}-paper-${payload.exportedAt.slice(0, 10)}.json`, JSON.stringify(payload));
  await markBackedUp(state.run.strategy);
}

function validateState(state, code) {
  const fail = (msg) => {
    throw new Error(`Invalid run file: ${msg}`);
  };
  if (!state || typeof state !== 'object') fail('no state');
  if (state.schema !== LEDGER_SCHEMA) fail(`unsupported schema ${state.schema}`);
  if (state.run?.strategy !== code) fail(`strategy is ${state.run?.strategy}, expected ${code}`);
  if (typeof state.run.startDate !== 'string' || typeof state.lastProcessed !== 'string') fail('missing dates');
  if (!Number.isFinite(state.cash) || !Number.isFinite(state.run.capital)) fail('bad cash');
  if (!state.positions || typeof state.positions !== 'object' || Array.isArray(state.positions)) fail('bad positions');
  ['nav', 'trades', 'fills', 'journal'].forEach((k) => {
    if (!Array.isArray(state[k])) fail(`bad ${k}`);
  });
  Object.entries(state.positions).forEach(([sym, p]) => {
    if (!/^[A-Z0-9&_.-]{1,30}$/.test(sym) || !Number.isFinite(p?.qty) || !Number.isFinite(p?.basis)) fail(`bad position ${sym}`);
  });
}

/** Parse and verify an export (file text or parsed object). Returns { state, exportedAt }. */
export async function parseRunExport(input, code = 'SUMMIT-20') {
  let payload = input;
  if (typeof input === 'string') {
    if (input.length > MAX_IMPORT_BYTES) throw new Error('File is too large');
    try {
      payload = JSON.parse(input);
    } catch {
      throw new Error('File is not valid JSON');
    }
  }
  if (payload?.app !== EXPORT_APP || payload?.format !== EXPORT_FORMAT) throw new Error('Not a strategy paper-trading export');
  validateState(payload.state, code);
  if ((await sha256(JSON.stringify(payload.state))) !== payload.checksum) {
    throw new Error('Checksum mismatch — the file was edited or is damaged');
  }
  return { state: payload.state, exportedAt: payload.exportedAt };
}

/** Replace the current run with an imported one (current run is kept for undo). */
export async function commitImport(state) {
  await keepUndo(state.run.strategy, 'before import');
  await saveRun(state, { touch: false });
}

// ---------- backup integration ----------

export async function collectStrategyBackups() {
  const out = {};
  for (const code of STRATEGY_CODES) {
    const { state } = await loadRun(code);
    if (state) out[code] = await exportPayload(state);
  }
  return out;
}

export async function parseStrategyBackups(strategies) {
  if (!strategies || typeof strategies !== 'object' || Array.isArray(strategies)) throw new Error('Backup strategies section is invalid');
  const parsed = [];
  for (const [code, payload] of Object.entries(strategies)) {
    if (!STRATEGY_CODES.includes(code)) continue;
    parsed.push((await parseRunExport(payload, code)).state);
  }
  return parsed;
}

export async function restoreStrategyStates(states) {
  for (const state of states) await commitImport(state);
}

// ---------- backup reminder ----------

export async function markBackedUp(code) {
  await idbPut('meta', { key: `backup:${code}`, at: new Date().toISOString() }).catch(() => {});
}

export async function lastBackup(code) {
  return (await idbGet('meta', `backup:${code}`).catch(() => null))?.at || null;
}
