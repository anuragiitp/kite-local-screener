import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { loadInstrumentIndex, searchInstruments } from '../screener/instruments';
import { bookmarkKey } from '../screener/bookmarks';

function freezeSearchItem(item) {
  if (!item?.tradingsymbol) return null;
  return {
    tradingsymbol: String(item.tradingsymbol).trim(),
    name: item.name || '',
    exchange: item.exchange || item.segment || 'NSE',
    segment: item.segment || item.exchange || 'NSE',
    internalId: item.internalId ?? null,
    instrument_token: item.instrument_token ?? null,
  };
}

function pickDefaultResult(results, query, isBookmarked) {
  if (!results.length) return null;

  const q = query.trim().toUpperCase();
  const exact = results.filter((item) => item.tradingsymbol.toUpperCase() === q);
  const candidates = exact.length ? exact : results;
  const addable = candidates.filter((item) => !isBookmarked?.(item));
  const pool = addable.length ? addable : candidates;

  const nse = pool.find((item) => (item.segment || item.exchange || '').toUpperCase() === 'NSE');
  return nse || pool[0];
}

function resolveEnterItem(results, query, isBookmarked, activeIndex, keyboardNav) {
  if (!results.length) return null;

  if (keyboardNav) {
    return results[activeIndex] || null;
  }

  return pickDefaultResult(results, query, isBookmarked);
}

export default function BookmarkSearch({ onAdd, onGoTo, isBookmarked, disabled = false }) {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [dropdownRect, setDropdownRect] = useState(null);
  const keyboardNavRef = useRef(false);
  const rootRef = useRef(null);
  const fieldRef = useRef(null);

  const results = useMemo(() => {
    if (!query.trim() || !index) return [];
    return searchInstruments(index, query);
  }, [index, query]);

  const defaultIndex = useMemo(() => {
    const item = pickDefaultResult(results, query, isBookmarked);
    if (!item) return 0;
    const idx = results.indexOf(item);
    return idx >= 0 ? idx : 0;
  }, [results, query, isBookmarked]);

  const showDropdown = open && query.trim().length > 0;

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

  useEffect(() => {
    keyboardNavRef.current = false;
  }, [query]);

  useEffect(() => {
    if (!keyboardNavRef.current) setActiveIndex(defaultIndex);
  }, [defaultIndex]);

  useEffect(() => {
    function onPointerDown(event) {
      if (!rootRef.current?.contains(event.target)
        && !event.target.closest?.('.bookmark-search-dropdown-portal')) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, []);

  useEffect(() => {
    const panel = rootRef.current?.closest('.table-panel');
    if (!panel) return undefined;

    panel.classList.toggle('search-dropdown-open', showDropdown);
    return () => panel.classList.remove('search-dropdown-open');
  }, [showDropdown]);

  useLayoutEffect(() => {
    if (!showDropdown || !fieldRef.current) {
      setDropdownRect(null);
      return undefined;
    }

    const updateRect = () => {
      if (!fieldRef.current) return;
      const rect = fieldRef.current.getBoundingClientRect();
      setDropdownRect({
        top: rect.bottom - 4,
        left: rect.left,
        width: rect.width,
      });
    };

    updateRect();
    window.addEventListener('resize', updateRect);
    window.addEventListener('scroll', updateRect, true);
    return () => {
      window.removeEventListener('resize', updateRect);
      window.removeEventListener('scroll', updateRect, true);
    };
  }, [showDropdown, query, results.length]);

  function selectItem(item) {
    const frozen = freezeSearchItem(item);
    if (!frozen) return;

    if (isBookmarked?.(frozen)) {
      onGoTo?.(frozen);
      setQuery('');
      setOpen(false);
      keyboardNavRef.current = false;
      return;
    }

    onAdd?.(frozen);
    setQuery('');
    setOpen(false);
    keyboardNavRef.current = false;
  }

  function onKeyDown(event) {
    if (!showDropdown || !results.length) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      keyboardNavRef.current = true;
      setActiveIndex((current) => (current + 1) % results.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      keyboardNavRef.current = true;
      setActiveIndex((current) => (current - 1 + results.length) % results.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const item = resolveEnterItem(
        results,
        query,
        isBookmarked,
        activeIndex,
        keyboardNavRef.current,
      );
      selectItem(item);
    } else if (event.key === 'Escape') {
      setOpen(false);
    }
  }

  const dropdown = showDropdown && dropdownRect ? (
    <div
      className="bookmark-search-dropdown bookmark-search-dropdown-portal"
      role="listbox"
      style={{
        top: dropdownRect.top,
        left: dropdownRect.left,
        width: dropdownRect.width,
      }}
    >
      {!results.length && !loading && (
        <div className="bookmark-search-empty">No instruments found</div>
      )}

      {results.map((item, index) => {
        const key = `${bookmarkKey(item)}:${item.internalId ?? index}`;
        const saved = isBookmarked?.(item);
        const active = index === activeIndex;

        return (
          <button
            key={key}
            type="button"
            role="option"
            aria-selected={active}
            className={`bookmark-search-item${active ? ' active' : ''}${saved ? ' saved' : ''}`}
            onMouseEnter={() => {
              keyboardNavRef.current = true;
              setActiveIndex(index);
            }}
            onPointerDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              selectItem(item);
            }}
          >
            <span className="bookmark-search-symbol">{item.tradingsymbol}</span>
            <span className="bookmark-search-meta">
              <span className="bookmark-search-name">{item.name}</span>
              <span className="bookmark-search-tag">{item.segmentLabel}</span>
            </span>
            <span className="bookmark-search-action">{saved ? 'Open' : 'Add'}</span>
          </button>
        );
      })}
    </div>
  ) : null;

  return (
    <div className="bookmark-search" ref={rootRef}>
      <div className="bookmark-search-field" ref={fieldRef}>
        <span className="bookmark-search-icon" aria-hidden>⌕</span>
        <input
          type="text"
          autoComplete="off"
          spellCheck={false}
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

      {dropdown ? createPortal(dropdown, document.body) : null}
    </div>
  );
}
