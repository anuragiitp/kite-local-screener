import { useCallback, useEffect, useState } from 'react';
import IndexTicker from './IndexTicker';
import NotesDrawer from './NotesDrawer';

function formatClock(date) {
  return date.toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });
}

export default function GlobalFilterBar({
  indexLiveTicks = {},
  indexTokensById = {},
}) {
  const [now, setNow] = useState(() => new Date());
  const [notesOpen, setNotesOpen] = useState(false);
  const closeNotes = useCallback(() => setNotesOpen(false), []);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <>
      <header className="global-bar">
        <IndexTicker
          liveTicks={indexLiveTicks}
          tokensById={indexTokensById}
        />
        <button
          type="button"
          className={`header-notes-btn${notesOpen ? ' active' : ''}`}
          onClick={() => setNotesOpen((v) => !v)}
          aria-expanded={notesOpen}
          title="Notes"
        >
          Notes
        </button>
        <time className="header-clock" dateTime={now.toISOString()}>
          {formatClock(now)}
        </time>
      </header>
      {/* Outside the header: its backdrop-filter would trap the fixed-position drawer. */}
      <NotesDrawer open={notesOpen} onClose={closeNotes} />
    </>
  );
}
