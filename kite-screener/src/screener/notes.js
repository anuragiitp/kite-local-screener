// Notes live under the kite-screener prefix so the existing Backup export/import includes them.
export const NOTES_STORAGE_KEY = 'kite-screener-notes';

function normalizeNote(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = typeof raw.id === 'string' && raw.id ? raw.id : null;
  if (!id) return null;
  const now = new Date().toISOString();
  return {
    id,
    body: typeof raw.body === 'string' ? raw.body : '',
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : now,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : now,
  };
}

export function loadNotes() {
  try {
    const raw = localStorage.getItem(NOTES_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.map(normalizeNote).filter(Boolean) : [];
  } catch {
    return [];
  }
}

/** Returns false when the browser refused to store the notes (e.g. storage full). */
export function saveNotes(notes) {
  try {
    localStorage.setItem(NOTES_STORAGE_KEY, JSON.stringify(notes));
    return true;
  } catch {
    return false;
  }
}

export function createNote() {
  const now = new Date().toISOString();
  return {
    id: `note-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    body: '',
    createdAt: now,
    updatedAt: now,
  };
}

export function noteTitle(note) {
  const line = note.body.split('\n').find((l) => l.trim());
  return line ? line.trim().slice(0, 80) : 'Untitled note';
}

export function notePreview(note) {
  const lines = note.body.split('\n').map((l) => l.trim()).filter(Boolean);
  return lines.slice(1).join(' ').slice(0, 120);
}
