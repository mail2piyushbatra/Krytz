/** ✦ FLOWRA — Timeline Screen (Phase 3: inline edit) */
import { useState, useEffect, useCallback, useRef } from 'react';
import { entries } from '../services/api';
import './TimelineScreen.css';

export default function TimelineScreen() {
  const [allEntries, setAllEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [search, setSearch] = useState('');
  const [dateFilter, setDateFilter] = useState('');
  const [flash, setFlash] = useState(null);

  const fetchEntries = useCallback(async (pg = 1, append = false) => {
    if (pg === 1) setLoading(true);
    else setLoadingMore(true);

    try {
      const params = { page: pg, limit: 20 };
      if (dateFilter) params.date = dateFilter;

      const data = await entries.list(params);
      const fetched = data?.entries || [];
      const meta = data?.meta || data?.pagination || {};

      if (append) {
        setAllEntries(prev => [...prev, ...fetched]);
      } else {
        setAllEntries(fetched);
      }

      setHasMore(meta.hasMore || false);
      setPage(pg);
    } catch {}

    setLoading(false);
    setLoadingMore(false);
  }, [dateFilter]);

  useEffect(() => { fetchEntries(1, false); }, [dateFilter, fetchEntries]);

  function handleLoadMore() {
    fetchEntries(page + 1, true);
  }

  async function handleDelete(entryId) {
    if (!confirm('Delete this entry?')) return;
    try {
      await entries.delete(entryId);
      setAllEntries(prev => prev.filter(e => e.id !== entryId));
      setFlash('Deleted');
      setTimeout(() => setFlash(null), 2000);
    } catch (err) {
      setFlash(`Error: ${err.message}`);
      setTimeout(() => setFlash(null), 3000);
    }
  }

  async function handleUpdate(entryId, newText) {
    try {
      await entries.update(entryId, newText);
      setAllEntries(prev => prev.map(e => e.id === entryId ? { ...e, rawText: newText, raw_text: newText } : e));
      setFlash('Updated ✓');
      setTimeout(() => setFlash(null), 2000);
    } catch (err) {
      setFlash(`Error: ${err.message}`);
      setTimeout(() => setFlash(null), 3000);
    }
  }

  // Filter by search locally
  const filtered = search.trim()
    ? allEntries.filter(e => {
        const text = (e.rawText || e.raw_text || e.text || '').toLowerCase();
        return text.includes(search.toLowerCase());
      })
    : allEntries;

  // Group by date
  const grouped = {};
  filtered.forEach(entry => {
    const d = new Date(entry.timestamp || entry.createdAt || entry.created_at);
    const key = d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' });
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(entry);
  });

  return (
    <div className="page-container animate-fadeIn" id="timeline-screen">
      <div className="timeline-header">
        <h1 className="page-title">Timeline</h1>
        <div className="timeline-controls">
          <div className="timeline-search-box">
            <span className="tl-search-icon">🔍</span>
            <input
              className="tl-search-input"
              type="text"
              placeholder="Search entries..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              id="timeline-search"
            />
            {search && (
              <button className="tl-search-clear" onClick={() => setSearch('')}>✕</button>
            )}
          </div>
          <input
            className="tl-date-picker"
            type="date"
            value={dateFilter}
            onChange={e => setDateFilter(e.target.value)}
            title="Jump to date"
            id="timeline-date-picker"
          />
          {dateFilter && (
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => setDateFilter('')}
              title="Clear date filter"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {flash && (
        <div className={`capture-flash animate-slideDown ${flash.startsWith('Error') ? 'flash-error' : 'flash-success'}`}>
          {flash}
        </div>
      )}

      {loading ? (
        <div className="timeline-loading">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="skeleton" style={{ height: '80px', marginBottom: '12px' }} />
          ))}
        </div>
      ) : Object.keys(grouped).length > 0 ? (
        <>
          <div className="timeline-groups">
            {Object.entries(grouped).map(([date, items]) => (
              <div key={date} className="timeline-group animate-slideUp">
                <div className="timeline-date">{date}</div>
                <div className="timeline-day-entries">
                  {items.map((entry, i) => (
                    <TLEntry key={entry.id || i} entry={entry} onDelete={handleDelete} onUpdate={handleUpdate} />
                  ))}
                </div>
              </div>
            ))}
          </div>

          {hasMore && !search && (
            <div className="tl-load-more">
              <button
                className="btn btn-secondary"
                onClick={handleLoadMore}
                disabled={loadingMore}
              >
                {loadingMore ? <span className="spinner" /> : 'Load More ↓'}
              </button>
            </div>
          )}
        </>
      ) : (
        <div className="empty-state">
          <div className="empty-icon">{search ? '🔍' : '📅'}</div>
          <div className="empty-title">{search ? 'No matching entries' : 'No entries yet'}</div>
          <div className="empty-desc">
            {search
              ? 'Try a different search term.'
              : 'Start capturing on the Today tab to see your timeline build up.'}
          </div>
          {(search || dateFilter) && (
            <button className="btn btn-secondary" onClick={() => { setSearch(''); setDateFilter(''); }}>
              Clear Filters
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function TLEntry({ entry, onDelete, onUpdate }) {
  const [hovered, setHovered] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState('');
  const editRef = useRef(null);

  const time = new Date(entry.timestamp || entry.createdAt || entry.created_at)
    .toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });

  const rawText = entry.rawText || entry.raw_text || entry.text;

  function startEdit() {
    setEditText(rawText);
    setEditing(true);
    setTimeout(() => editRef.current?.focus(), 50);
  }
  function cancelEdit() { setEditing(false); }
  function saveEdit() {
    if (editText.trim() && editText.trim() !== rawText) onUpdate(entry.id, editText.trim());
    setEditing(false);
  }
  function handleEditKey(e) {
    if (e.key === 'Escape') cancelEdit();
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveEdit(); }
  }

  async function handleDel() {
    setDeleting(true);
    await onDelete(entry.id);
  }

  return (
    <div
      className={`tl-entry card ${deleting ? 'entry-deleting' : ''}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="tl-entry-header">
        <span className="tl-time">{time}</span>
        <div className="tl-entry-actions">
          <span className="tl-source badge badge-tag">{entry.source || 'manual'}</span>
          <button
            className={`btn btn-ghost btn-sm tl-edit ${hovered ? 'visible' : ''}`}
            onClick={startEdit}
            title="Edit"
          >
            ✏️
          </button>
          <button
            className={`btn btn-ghost btn-sm tl-delete ${hovered ? 'visible' : ''}`}
            onClick={handleDel}
            title="Delete"
          >
            🗑️
          </button>
        </div>
      </div>
      {editing ? (
        <div className="entry-edit-box">
          <textarea
            ref={editRef}
            className="entry-edit-input"
            value={editText}
            onChange={e => setEditText(e.target.value)}
            onKeyDown={handleEditKey}
            rows={3}
          />
          <div className="entry-edit-actions">
            <button className="btn btn-sm btn-ghost" onClick={cancelEdit}>Cancel</button>
            <button className="btn btn-sm btn-primary" onClick={saveEdit}>Save</button>
          </div>
        </div>
      ) : (
        <p className="tl-text" onDoubleClick={startEdit} title="Double-click to edit">{rawText}</p>
      )}
      {renderBadges(entry)}
    </div>
  );
}

function renderBadges(entry) {
  const ex = entry.extractedState || entry.extracted_state;
  if (!ex) return null;
  const badges = [];
  (ex.actionItems || ex.action_items || []).forEach(a => badges.push({ t: 'action', text: typeof a === 'string' ? a : a.text || 'item' }));
  (ex.blockers || []).forEach(b => badges.push({ t: 'blocker', text: typeof b === 'string' ? b : b.text || 'blocker' }));
  (ex.completions || []).forEach(c => badges.push({ t: 'done', text: typeof c === 'string' ? c : c.text || 'done' }));
  (ex.deadlines || []).forEach(d => badges.push({ t: 'deadline', text: typeof d === 'string' ? d : d.text || 'deadline' }));
  if (!badges.length) return null;
  return (
    <div className="entry-badges" style={{ marginTop: '8px' }}>
      {badges.slice(0, 5).map((b, i) => (
        <span key={i} className={`badge badge-${b.t}`} style={{ animationDelay: `${i * 50}ms` }}>
          {b.text.slice(0, 35)}
        </span>
      ))}
    </div>
  );
}
