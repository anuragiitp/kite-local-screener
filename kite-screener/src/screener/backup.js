import { collectStrategyBackups, parseStrategyBackups, restoreStrategyStates } from '../strategy/strategyStore';

const APP_ID = 'kite-screener';
const BACKUP_VERSION = 1;
const KEY_PREFIX = 'kite-screener';
// Daily caches rebuild automatically and are too large to be worth backing up.
const EXCLUDED_PREFIXES = ['kite-screener-instrument-dump-', 'kite-screener-token-map-'];
const ARRAY_KEYS = ['kite-screener-watchlists', 'kite-screener-bookmarks', 'kite-screener-hidden-symbols', 'kite-screener-notes', 'kite-screener-mf-watchlist'];
const MAX_IMPORT_BYTES = 30 * 1024 * 1024;

function isBackupKey(key) {
  return typeof key === 'string'
    && key.startsWith(KEY_PREFIX)
    && !EXCLUDED_PREFIXES.some((prefix) => key.startsWith(prefix));
}

function currentBackupKeys() {
  const keys = [];
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (isBackupKey(key)) keys.push(key);
  }
  return keys;
}

export async function exportBackup() {
  const data = {};
  currentBackupKeys().sort().forEach((key) => {
    data[key] = localStorage.getItem(key);
  });

  const backup = { app: APP_ID, version: BACKUP_VERSION, exportedAt: new Date().toISOString(), data };
  // Paper-trading runs live outside localStorage; add them when present (optional field).
  try {
    const strategies = await collectStrategyBackups();
    if (Object.keys(strategies).length) backup.strategies = strategies;
  } catch {
    // strategy storage unavailable — export the rest as before
  }
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `kite-screener-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function parseBackup(text) {
  let backup;
  try {
    backup = JSON.parse(text);
  } catch {
    throw new Error('File is not valid JSON.');
  }

  if (backup?.app !== APP_ID || backup?.version !== BACKUP_VERSION) {
    throw new Error('Not a Kite screener backup file.');
  }
  if (!backup.data || typeof backup.data !== 'object' || Array.isArray(backup.data)) {
    throw new Error('Backup has no data.');
  }

  const entries = Object.entries(backup.data).filter(([key]) => isBackupKey(key));
  if (entries.some(([, value]) => typeof value !== 'string')) {
    throw new Error('Backup contains invalid values.');
  }

  ARRAY_KEYS.forEach((key) => {
    const value = backup.data[key];
    if (value === undefined) return;
    let parsed;
    try {
      parsed = JSON.parse(value);
    } catch {
      parsed = null;
    }
    if (!Array.isArray(parsed)) throw new Error(`Backup entry "${key}" is corrupted.`);
  });

  if (!entries.length) throw new Error('Backup is empty.');
  return { entries, exportedAt: backup.exportedAt, strategies: backup.strategies };
}

/** Replaces saved lists and settings with the backup contents. */
export async function importBackup(file) {
  if (!file) throw new Error('No file selected.');
  if (file.size > MAX_IMPORT_BYTES) throw new Error('Backup file is too large.');

  const { entries, exportedAt, strategies } = parseBackup(await file.text());
  // Validate strategy runs (checksums) before changing anything.
  const strategyStates = strategies === undefined ? [] : await parseStrategyBackups(strategies);

  const previous = currentBackupKeys().map((key) => [key, localStorage.getItem(key)]);
  try {
    previous.forEach(([key]) => localStorage.removeItem(key));
    entries.forEach(([key, value]) => localStorage.setItem(key, value));
  } catch (error) {
    currentBackupKeys().forEach((key) => localStorage.removeItem(key));
    previous.forEach(([key, value]) => localStorage.setItem(key, value));
    throw new Error(`Restore failed: ${error.message}`);
  }

  if (strategyStates.length) await restoreStrategyStates(strategyStates);

  return { count: entries.length, exportedAt, strategies: strategyStates.length };
}
