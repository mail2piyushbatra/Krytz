/** ✦ FLOWRA — Timeline Screen (v3: premium visual feed) */
import { useState, useEffect, useCallback, useRef } from 'react';
import { entries } from '../services/api';
import { Card, ActionBtn, PageLoader, EmptyState, Badge } from '../components/ui/UiKit';
import { Calendar, Search, X, Pencil, Trash2, MessageSquare, CheckCircle2, AlertTriangle, Clock, FileText } from 'lucide-react';
import './TimelineScreen.css';

export default function TimelineScreen() {
  const [allEntries, setAllEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [dateFilter, setDateFilter] = useState('');
  const [flash, setFlash] = useState(null);
  const observerRef = useRef(null);

  const fetchEntries = useCallback(async (pg = 1, append = false) => {
    if (pg === 1) setLoading(true);
    else setLoadingMore(true);

    try {
      const params = { page: pg, limit: 20 };
      if (dateFilter) params.date = dateFilter;
      if (debouncedSearch) params.q = debouncedSearch;

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
  }, [dateFilter, debouncedSearch]);

  useEffect(() => { fetchEntries(1, false); }, [dateFilter, debouncedSearch, fetchEntries]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 500);
    return () => clearTimeout(t);
  }, [search]);

  const handleObserver = useCallback((entries) => {
    const target = entries[0];
    if (target.isIntersecting && hasMore && !loading && !loadingMore) {
      handleLoadMore();
    }
  }, [hasMore, loading, loadingMore]);

  useEffect(() => {
    const option = { root: null, rootMargin: '20px', threshold: 0 };
    const observer = new IntersectionObserver(handleObserver, option);
    if (observerRef.current) observer.observe(observerRef.current);
    return () => observer.disconnect();
  }, [handleObserver]);

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

  // Entries are filtered server-side now
  const filtered = allEntries;
  const totalEntries = filtered.length;
  const actionCount = filtered.filter(entry => (entry.extractedItems || entry.extracted_items || []).length > 0).length;
  const blockerCount = filtered.filter(entry => hasExtraction(entry, 'blocker')).length;
  const sourceCount = new Set(filtered.map(entry => entry.source || 'manual')).size;

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
      <header className="timeline-header">
        <div>
          <p className="eyebrow">Journal</p>
          <h1 className="page-title">Timeline</h1>
        </div>
        <div className="timeline-controls">
          <div className="tl-search-box">
            <Search size={16} className="tl-search-icon" />
            <input
              className="tl-search-input"
              type="text"
              placeholder="Search entries..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              id="timeline-search"
            />
            {search && (
              <button className="tl-search-clear" onClick={() => setSearch('')}>
                <X size={14} />
              </button>
            )}
          </div>
          <div className="tl-date-wrap">
            <Calendar size={16} className="tl-date-icon" />
            <input
              className="tl-date-picker"
              type="date"
              value={dateFilter}
              onChange={e => setDateFilter(e.target.value)}
              title="Jump to date"
              id="timeline-date-picker"
            />
          </div>
          {dateFilter && (
            <ActionBtn variant="ghost" className="btn-sm" onClick={() => setDateFilter('')}>
              <X size={14} /> Clear
            </ActionBtn>
          )}
        </div>
      </header>

      <section className="timeline-kpi-grid" aria-label="Your timeline">
        <TimelineKpiCard label="Entries" value={totalEntries} detail={search || dateFilter ? 'matching current filters' : 'loaded in feed'} icon={FileText} />
        <TimelineKpiCard label="Actions" value={actionCount} detail="entries with extracted items" icon={CheckCircle2} tone="positive" />
        <TimelineKpiCard label="Blockers" value={blockerCount} detail="needs attention" icon={AlertTriangle} tone={blockerCount > 0 ? 'warning' : 'neutral'} />
        <TimelineKpiCard label="Sources" value={sourceCount} detail="capture channels" icon={MessageSquare} />
      </section>

      {flash && (
        <div className={`tl-flash animate-slideDown ${flash.startsWith('Error') ? 'tl-flash-error' : 'tl-flash-success'}`}>
          {flash}
        </div>
      )}

      {loading ? (
        <PageLoader text="Loading your journal..." />
      ) : Object.keys(grouped).length > 0 ? (
        <>
          <div className="timeline-feed">
            {Object.entries(grouped).map(([date, items]) => (
              <div key={date} className="tl-day-group">
                <div className="tl-day-label">
                  <span className="tl-day-dot" />
                  <span>{date}</span>
                </div>
                <div className="tl-day-entries">
                  {items.map((entry, i) => (
                    <TLEntry key={entry.id || i} entry={entry} onDelete={handleDelete} onUpdate={handleUpdate} />
                  ))}
                </div>
              </div>
            ))}
          </div>

          {hasMore && (
            <div className="tl-load-more" ref={observerRef}>
              {loadingMore && <span className="spinner" />}
            </div>
          )}
        </>
      ) : (
        <EmptyState
          icon={search ? Search : Calendar}
          title={search ? 'No matching entries' : 'No entries yet'}
          description={search
            ? 'Try a different search term.'
            : 'Add your first thought to see your timeline here.'}
          action={(search || dateFilter) ? (
            <ActionBtn variant="secondary" onClick={() => { setSearch(''); setDateFilter(''); }}>
              Clear Filters
            </ActionBtn>
          ) : null}
        />
      )}
    </div>
  );
}

function TimelineKpiCard({ label, value, detail, icon: Icon, tone = 'neutral' }) {
  return (
    <article className={`timeline-kpi-card timeline-kpi-card--${tone}`}>
      <div className="timeline-kpi-icon"><Icon size={18} /></div>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function hasExtraction(entry, type) {
  const extracted = [
    ...(entry.extractedItems || entry.extracted_items || []),
    ...(entry.items || []),
  ];
  return extracted.some(item => (item.type || item.state || item.kind || '').toLowerCase().includes(type));
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
    <Card
      className={`tl-entry ${deleting ? 'tl-entry-deleting' : ''}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Timeline connector dot */}
      <div className="tl-entry-connector">
        <div className="tl-entry-dot" />
        <div className="tl-entry-line" />
      </div>

      <div className="tl-entry-body">
        <div className="tl-entry-header">
          <div className="tl-entry-meta">
            <Clock size={12} />
            <span className="tl-time">{time}</span>
            <Badge intent="default">{entry.source || 'manual'}</Badge>
          </div>
          <div className={`tl-entry-actions ${hovered ? 'tl-actions-visible' : ''}`}>
            <button className="tl-action-btn" onClick={startEdit} title="Edit">
              <Pencil size={14} />
            </button>
            <button className="tl-action-btn tl-action-delete" onClick={handleDel} title="Delete">
              <Trash2 size={14} />
            </button>
          </div>
        </div>

        {editing ? (
          <div className="tl-edit-box">
            <textarea
              ref={editRef}
              className="tl-edit-input"
              value={editText}
              onChange={e => setEditText(e.target.value)}
              onKeyDown={handleEditKey}
              rows={3}
            />
            <div className="tl-edit-actions">
              <ActionBtn variant="ghost" className="btn-sm" onClick={cancelEdit}>Cancel</ActionBtn>
              <ActionBtn variant="primary" className="btn-sm" onClick={saveEdit}>Save</ActionBtn>
            </div>
          </div>
        ) : (
          <p className="tl-text" onDoubleClick={startEdit} title="Double-click to edit">{rawText}</p>
        )}

        {renderBadges(entry)}
      </div>
    </Card>
  );
}

function renderBadges(entry) {
  const ex = entry.extractedState || entry.extracted_state;
  if (!ex) return null;
  const badges = [];
  (ex.actionItems || ex.action_items || []).forEach(a => badges.push({ t: 'action', text: typeof a === 'string' ? a : a.text || 'item', icon: CheckCircle2 }));
  (ex.blockers || []).forEach(b => badges.push({ t: 'blocker', text: typeof b === 'string' ? b : b.text || 'blocker', icon: AlertTriangle }));
  (ex.completions || []).forEach(c => badges.push({ t: 'done', text: typeof c === 'string' ? c : c.text || 'done', icon: CheckCircle2 }));
  (ex.deadlines || []).forEach(d => badges.push({ t: 'deadline', text: typeof d === 'string' ? d : d.text || 'deadline', icon: Clock }));
  if (!badges.length) return null;
  return (
    <div className="tl-extraction-badges">
      {badges.slice(0, 5).map((b, i) => (
        <span key={i} className={`tl-extract-badge tl-extract-${b.t}`} style={{ animationDelay: `${i * 60}ms` }}>
          <b.icon size={12} />
          {b.text.slice(0, 40)}
        </span>
      ))}
    </div>
  );
}
