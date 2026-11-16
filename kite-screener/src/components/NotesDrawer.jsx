import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  NOTES_STORAGE_KEY,
  createNote,
  loadNotes,
  notePreview,
  noteTitle,
  saveNotes,
} from '../screener/notes';

const SAVE_DELAY_MS = 400;

function formatWhen(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const today = new Date().toDateString() === d.toDateString();
  return today
    ? d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })
    : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' });
}

const dropBlank = (list, keepId) => list.filter((n) => n.id === keepId || n.body.trim());

function NotesDrawer({ open, onClose }) {
  const [notes, setNotes] = useState(() => loadNotes());
  const [selectedId, setSelectedId] = useState(null);
  const [query, setQuery] = useState('');
  const [saveState, setSaveState] = useState('saved');
  const notesRef = useRef(notes);
  const dirtyRef = useRef(false);
  const timerRef = useRef(null);
  const editorRef = useRef(null);
  notesRef.current = notes;

  const flush = useCallback(() => {
    clearTimeout(timerRef.current);
    timerRef.current = null;
    if (!dirtyRef.current) return;
    dirtyRef.current = false;
    setSaveState(saveNotes(dropBlank(notesRef.current)) ? 'saved' : 'error');
  }, []);

  const update = useCallback((next) => {
    setNotes(next);
    notesRef.current = next;
    dirtyRef.current = true;
    setSaveState('saving');
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(flush, SAVE_DELAY_MS);
  }, [flush]);

  useEffect(() => {
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [flush]);

  // Pick up edits made in another tab.
  useEffect(() => {
    const onStorage = (event) => {
      if (event.key !== NOTES_STORAGE_KEY || dirtyRef.current) return;
      setNotes(loadNotes());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  useEffect(() => {
    if (open) return;
    flush();
    setNotes((current) => {
      const next = dropBlank(current);
      return next.length === current.length ? current : next;
    });
  }, [open, flush]);

  const sorted = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...notes]
      .filter((n) => !q || n.body.toLowerCase().includes(q))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [notes, query]);

  const selected = notes.find((n) => n.id === selectedId) || null;

  const selectNote = (id) => {
    if (id === selectedId) return;
    const pruned = dropBlank(notesRef.current, id);
    if (pruned.length !== notesRef.current.length) update(pruned);
    setSelectedId(id);
  };

  const addNote = () => {
    const note = createNote();
    update([note, ...dropBlank(notesRef.current)]);
    setSelectedId(note.id);
    setQuery('');
    requestAnimationFrame(() => editorRef.current?.focus());
  };

  const editBody = (body) => {
    update(notesRef.current.map((n) => (n.id === selectedId ? { ...n, body, updatedAt: new Date().toISOString() } : n)));
  };

  const deleteNote = () => {
    if (!selected) return;
    if (selected.body.trim() && !window.confirm(`Delete "${noteTitle(selected)}"?`)) return;
    update(notesRef.current.filter((n) => n.id !== selected.id));
    setSelectedId(null);
  };

  const onKeyDown = (event) => {
    if (event.key === 'Escape') {
      // Keep Escape from also reaching page-level handlers (e.g. dashboard row deselect).
      event.stopPropagation();
      onClose();
    }
  };

  if (!open) return null;

  const savedLabel = saveState === 'error'
    ? 'Not saved — browser storage is full'
    : saveState === 'saving' ? 'Saving…' : 'Saved';

  return (
    <aside className="notes-drawer" role="dialog" aria-label="Notes" onKeyDown={onKeyDown}>
      <div className="notes-head">
        <h2>Notes <span className="notes-count">{notes.filter((n) => n.body.trim()).length}</span></h2>
        <div className="notes-head-actions">
          <button type="button" className="notes-btn notes-btn-primary" onClick={addNote}>+ New</button>
          <button type="button" className="notes-btn" onClick={onClose} title="Close (Esc)" aria-label="Close notes">✕</button>
        </div>
      </div>

      <input
        type="search"
        className="notes-search"
        placeholder="Search notes"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      <div className="notes-list">
        {sorted.length === 0 && (
          <div className="notes-empty">{query ? 'No matching notes.' : 'No notes yet. Click "+ New" to write one.'}</div>
        )}
        {sorted.map((n) => (
          <button
            key={n.id}
            type="button"
            className={`notes-item${n.id === selectedId ? ' active' : ''}`}
            onClick={() => selectNote(n.id)}
          >
            <span className="notes-item-title">{noteTitle(n)}</span>
            <span className="notes-item-meta">
              <span>{formatWhen(n.updatedAt)}</span>
              {notePreview(n) && <span className="notes-item-preview">{notePreview(n)}</span>}
            </span>
          </button>
        ))}
      </div>

      {selected ? (
        <div className="notes-editor">
          <div className="notes-editor-bar">
            <span className={saveState === 'error' ? 'notes-error' : ''}>{savedLabel} · edited {formatWhen(selected.updatedAt)}</span>
            <button type="button" className="notes-btn notes-btn-danger" onClick={deleteNote}>Delete</button>
          </div>
          <textarea
            ref={editorRef}
            className="notes-textarea"
            value={selected.body}
            placeholder="First line is the title…"
            onChange={(e) => editBody(e.target.value)}
            spellCheck
          />
        </div>
      ) : (
        <div className="notes-editor notes-editor-empty">Select a note or create a new one.</div>
      )}
    </aside>
  );
}

export default memo(NotesDrawer);
