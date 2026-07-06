import { useEffect, useMemo, useRef, useState } from 'react';
import { loadInstrumentIndex, searchInstruments } from '../screener/instruments';
import { bookmarkKey } from '../screener/bookmarks';

export default function BookmarkSearch({ onAdd, isBookmarked, disabled = false }) {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');

    loadInstrumentIndex()
      .then((data) => {
        if (!cancelled) setIndex(data);
      })
      .catch((loadError) => {
        if (!cancelled) setError(loadError.message || 'Unable to load instrument list.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const results = useMemo(() => {
    if (!query.trim() || !index) return [];
    return searchInstruments(index, query);
  }, [index, query]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query, results.length]);

  useEffect(() => {
    function onPointerDown(event) {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, []);

  const showDropdown = open && query.trim().length > 0;

  function selectItem(item) {
    onAdd?.(item);
    setQuery('');
    setOpen(false);
  }

  function onKeyDown(event) {
    if (!showDropdown || !results.length) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((current) => (current + 1) % results.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((current) => (current - 1 + results.length) % results.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      selectItem(results[activeIndex]);
    } else if (event.key === 'Escape') {
      setOpen(false);
    }
  }

  return (
    <div className="bookmark-search" ref={rootRef}>
      <div className="bookmark-search-field">
        <span className="bookmark-search-icon" aria-hidden>⌕</span>
        <input
          type="search"
          value={query}
          disabled={disabled}
          placeholder="Search eg: reliance, nifty, infy"
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
        />
        {loading && <span className="bookmark-search-status">Loading…</span>}
      </div>

      {error && <div className="bookmark-search-error">{error}</div>}

      {showDropdown && (
        <div className="bookmark-search-dropdown" role="listbox">
          {!results.length && !loading && (
            <div className="bookmark-search-empty">No instruments found</div>
          )}

          {results.map((item, index) => {
            const key = bookmarkKey(item);
            const saved = isBookmarked?.(item);
            const active = index === activeIndex;

            return (
              <button
                key={`${key}-${item.segment}`}
                type="button"
                role="option"
                aria-selected={active}
                className={`bookmark-search-item${active ? ' active' : ''}${saved ? ' saved' : ''}`}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => selectItem(item)}
              >
                <span className="bookmark-search-symbol">{item.tradingsymbol}</span>
                <span className="bookmark-search-meta">
                  <span className="bookmark-search-name">{item.name}</span>
                  <span className="bookmark-search-tag">{item.segmentLabel}</span>
                </span>
                <span className="bookmark-search-action">{saved ? 'Saved' : 'Add'}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
