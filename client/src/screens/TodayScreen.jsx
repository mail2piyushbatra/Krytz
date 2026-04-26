/** ✦ FLOWRA — Today View (Phase 3: inline edit, file upload) */
import { useState, useEffect, useRef } from 'react';
import { entries, files as filesApi, plan, stats } from '../services/api';
import useAuthStore from '../stores/authStore';
import AnimatedCounter from '../components/AnimatedCounter';
import './TodayScreen.css';

const API_BASE = 'http://localhost:3001/api/v1';

export default function TodayScreen() {
  const { user } = useAuthStore();
  const [captureText, setCaptureText] = useState('');
  const [capturing, setCapturing] = useState(false);
  const [focused, setFocused] = useState(false);
  const [files, setFiles] = useState([]);
  const [todayPlan, setTodayPlan] = useState(null);
  const [userStats, setUserStats] = useState(null);
  const [timeline, setTimeline] = useState([]);
  const [carryOvers, setCarryOvers] = useState([]);
  const [weekSummary, setWeekSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [flash, setFlash] = useState(null);
  const [filter, setFilter] = useState(null);
  const [showWeek, setShowWeek] = useState(false);
  const textareaRef = useRef(null);
  const fileRef = useRef(null);

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'short', day: 'numeric',
  });

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    setLoading(true);
    const token = localStorage.getItem('flowra_token');
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

    try {
      const [p, s, e, co, w] = await Promise.allSettled([
        plan.today(),
        stats.get(),
        entries.list({ limit: 50 }),
        fetch(`${API_BASE}/state/carryovers`, { headers }).then(r => r.json()).then(d => d.data?.carryOvers || []),
        fetch(`${API_BASE}/state/week`, { headers }).then(r => r.json()).then(d => d.data || d),
      ]);
      if (p.status === 'fulfilled') setTodayPlan(p.value);
      if (s.status === 'fulfilled') setUserStats(s.value);
      if (e.status === 'fulfilled') setTimeline(e.value?.entries || e.value || []);
      if (co.status === 'fulfilled') setCarryOvers(co.value || []);
      if (w.status === 'fulfilled') setWeekSummary(w.value);
    } catch {}
    setLoading(false);
  }

  async function handleCapture(e) {
    e.preventDefault();
    if (!captureText.trim() || capturing) return;
    setCapturing(true);
    try {
      // Upload files first if any
      let fileKeys = [];
      let fileMeta = [];
      if (files.length > 0) {
        try {
          const uploads = await Promise.all(
            files.map(f => filesApi.upload(f))
          );
          fileKeys = uploads.map(u => u.fileKey);
          fileMeta = uploads.map(u => ({ fileName: u.fileName, fileType: u.fileType, fileSize: u.fileSize }));
        } catch (uploadErr) {
          // File upload failed (S3 not configured) — continue without files
          console.warn('File upload failed, capturing without files:', uploadErr.message);
        }
      }
      await entries.capture(captureText.trim());
      setCaptureText('');
      setFiles([]);
      setFlash(fileKeys.length ? `Captured with ${fileKeys.length} file(s) ✓` : 'Captured ✓');
      setTimeout(() => setFlash(null), 2000);
      textareaRef.current?.blur();
      setFocused(false);
      setTimeout(loadData, 800);
    } catch (err) {
      setFlash(`Error: ${err.message}`);
      setTimeout(() => setFlash(null), 3000);
    }
    setCapturing(false);
  }

  async function handleDelete(entryId) {
    if (!confirm('Delete this entry?')) return;
    try {
      await entries.delete(entryId);
      setTimeline(prev => prev.filter(e => e.id !== entryId));
      setFlash('Entry deleted');
      setTimeout(() => setFlash(null), 2000);
      stats.get().then(s => setUserStats(s)).catch(() => {});
    } catch (err) {
      setFlash(`Error: ${err.message}`);
      setTimeout(() => setFlash(null), 3000);
    }
  }

  async function handleUpdate(entryId, newText) {
    try {
      await entries.update(entryId, newText);
      setTimeline(prev => prev.map(e => e.id === entryId ? { ...e, rawText: newText, raw_text: newText } : e));
      setFlash('Entry updated ✓');
      setTimeout(() => setFlash(null), 2000);
    } catch (err) {
      setFlash(`Error: ${err.message}`);
      setTimeout(() => setFlash(null), 3000);
    }
  }

  async function handleAction(itemId, type) {
    try {
      const token = localStorage.getItem('flowra_token');
      await fetch(`${API_BASE}/action`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId, type }),
      });
      setFlash(`${type === 'done' ? '✅ Done' : type === 'snooze' ? '⏰ Snoozed' : '🗑️ Dropped'}!`);
      setTimeout(() => setFlash(null), 2000);
      setTimeout(loadData, 500);
    } catch (err) {
      setFlash(`Error: ${err.message}`);
      setTimeout(() => setFlash(null), 3000);
    }
  }

  function handleKeyDown(e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') handleCapture(e);
  }

  function handleFileSelect(e) {
    const selected = Array.from(e.target.files || []).slice(0, 3);
    setFiles(selected);
    if (selected.length && !focused) setFocused(true);
  }

  function removeFile(idx) { setFiles(prev => prev.filter((_, i) => i !== idx)); }
  function toggleFilter(type) { setFilter(prev => prev === type ? null : type); }

  const filteredTimeline = filter
    ? timeline.filter(entry => {
        const ex = entry.extractedState || entry.extracted_state;
        if (!ex) return false;
        if (filter === 'action') return (ex.actionItems || ex.action_items || []).length > 0;
        if (filter === 'blocker') return (ex.blockers || []).length > 0;
        if (filter === 'done') return (ex.completions || []).length > 0;
        if (filter === 'deadline') return (ex.deadlines || []).length > 0;
        return true;
      })
    : timeline;

  const stateCards = [
    { key: 'action',   label: 'Action Items', value: userStats?.items?.open       ?? 0, color: 'var(--status-action)',  icon: '🔴' },
    { key: 'blocker',  label: 'Blockers',     value: userStats?.items?.inProgress ?? 0, color: 'var(--status-blocker)', icon: '🟡' },
    { key: 'done',     label: 'Completed',    value: userStats?.items?.done       ?? 0, color: 'var(--status-done)',    icon: '🟢' },
    { key: 'deadline', label: 'Streak',       value: userStats?.streak            ?? 0, color: 'var(--status-deadline)',icon: '🔵' },
  ];

  return (
    <div className="page-container animate-fadeIn" id="today-screen">
      {/* Header */}
      <div className="today-header">
        <div>
          <h1 className="page-title">{today}</h1>
          <p className="today-greeting">
            {getGreeting()}, <span className="text-accent">{user?.name || user?.email?.split('@')[0] || 'there'}</span>
          </p>
        </div>
        {weekSummary && (
          <button className="btn btn-secondary btn-sm" onClick={() => setShowWeek(prev => !prev)}>
            📊 {showWeek ? 'Hide' : 'Week'}
          </button>
        )}
      </div>

      {/* Weekly Summary (collapsible) */}
      {showWeek && weekSummary && (
        <div className="week-summary glass animate-slideDown">
          <div className="week-header">📊 Weekly Summary</div>
          {weekSummary.summary ? (
            <p className="week-text">{weekSummary.summary}</p>
          ) : weekSummary.days ? (
            <div className="week-days">
              {Object.entries(weekSummary.days || {}).map(([day, data]) => (
                <div key={day} className="week-day">
                  <span className="week-day-label">{day}</span>
                  <div className="week-day-bar" style={{ width: `${Math.min(100, (data.entries || 0) * 20)}%` }} />
                  <span className="week-day-count">{data.entries || 0}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="week-text" style={{ color: 'var(--text-tertiary)' }}>
              Weekly data will appear after a few days of capturing.
            </p>
          )}
        </div>
      )}

      {/* Capture Input */}
      <form className={`capture-box ${focused ? 'capture-focused' : ''}`} onSubmit={handleCapture} id="capture-form">
        <textarea
          ref={textareaRef}
          className="capture-input"
          placeholder="What's happening?"
          value={captureText}
          onChange={e => setCaptureText(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => !captureText && !files.length && setFocused(false)}
          onKeyDown={handleKeyDown}
          rows={focused ? 3 : 1}
          id="capture-input"
        />
        {files.length > 0 && (
          <div className="capture-files">
            {files.map((f, i) => (
              <div key={i} className="capture-file-chip">
                <span className="file-chip-icon">{f.type.startsWith('image/') ? '🖼️' : '📄'}</span>
                <span className="file-chip-name">{f.name.length > 20 ? f.name.slice(0, 18) + '…' : f.name}</span>
                <button type="button" className="file-chip-remove" onClick={() => removeFile(i)}>×</button>
              </div>
            ))}
          </div>
        )}
        <div className="capture-footer">
          <div className="capture-actions">
            <button type="button" className="btn btn-ghost btn-icon capture-attach" onClick={() => fileRef.current?.click()} title="Attach file">📎</button>
            <input ref={fileRef} type="file" hidden multiple accept="image/*,application/pdf,.doc,.docx,.txt" onChange={handleFileSelect} />
            <span className="capture-hint">Ctrl+Enter to capture</span>
          </div>
          <button className="btn btn-primary" type="submit" disabled={!captureText.trim() || capturing} id="capture-submit">
            {capturing ? <span className="spinner" /> : 'Capture'}
          </button>
        </div>
      </form>

      {flash && (
        <div className={`capture-flash animate-slideDown ${flash.startsWith('Error') ? 'flash-error' : 'flash-success'}`}>
          {flash}
        </div>
      )}

      {/* State Panel */}
      <div className="section-title">Your State</div>
      <div className="state-grid stagger">
        {stateCards.map(card => (
          <div className={`metric-card ${filter === card.key ? 'metric-active' : ''}`} key={card.key}
            onClick={() => toggleFilter(card.key)} role="button" tabIndex={0} title={`Filter by ${card.label}`}>
            <div className="metric-value" style={{ color: card.color }}>
              <span className="metric-icon">{card.icon}</span>{' '}
              <AnimatedCounter value={card.value} />
            </div>
            <div className="metric-label">{card.label}</div>
          </div>
        ))}
      </div>

      {filter && (
        <div className="filter-active animate-slideDown">
          <span>Filtering by: <strong>{filter}</strong></span>
          <button className="btn btn-ghost btn-sm" onClick={() => setFilter(null)}>Clear ✕</button>
        </div>
      )}

      {/* Carry-over items */}
      {carryOvers.length > 0 && (
        <>
          <div className="section-title" style={{ marginTop: 'var(--space-4)' }}>Carry-Over Items</div>
          <div className="carryover-list stagger">
            {carryOvers.map((item, i) => (
              <div key={item.id || i} className="carryover-item card">
                <div className="carryover-main">
                  <span className={`badge badge-${item.state === 'OPEN' ? 'action' : item.state === 'BLOCKED' ? 'blocker' : 'tag'}`}>
                    {item.state || 'OPEN'}
                  </span>
                  <span className="carryover-text">{item.title || item.text || item.description}</span>
                </div>
                <div className="carryover-actions">
                  <button className="btn btn-sm btn-ghost action-done" onClick={() => handleAction(item.id, 'done')} title="Mark done">✅</button>
                  <button className="btn btn-sm btn-ghost action-snooze" onClick={() => handleAction(item.id, 'snooze')} title="Snooze 3h">⏰</button>
                  <button className="btn btn-sm btn-ghost action-drop" onClick={() => handleAction(item.id, 'drop')} title="Drop">🗑️</button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Plan insight */}
      {todayPlan?.message && (
        <div className="plan-insight glass animate-slideUp">
          <span className="plan-icon">💡</span>
          <p>{todayPlan.message}</p>
          {todayPlan.stage && <span className="badge badge-tag">{todayPlan.stage}</span>}
        </div>
      )}

      {/* Focus item from plan */}
      {todayPlan?.focus && (
        <div className="focus-item card animate-slideUp">
          <div className="focus-header">
            <span className="focus-label">🎯 Focus</span>
            <span className="badge badge-action">{todayPlan.focus.state || 'OPEN'}</span>
          </div>
          <p className="focus-text">{todayPlan.focus.title || todayPlan.focus.text}</p>
          <div className="focus-actions">
            <button className="btn btn-sm btn-primary" onClick={() => handleAction(todayPlan.focus.id, 'done')}>✅ Done</button>
            <button className="btn btn-sm btn-secondary" onClick={() => handleAction(todayPlan.focus.id, 'snooze')}>⏰ Snooze</button>
          </div>
        </div>
      )}

      {/* Timeline */}
      <div className="section-title" style={{ marginTop: 'var(--space-8)' }}>
        Timeline {filter && `(${filteredTimeline.length})`}
      </div>
      {loading ? (
        <div className="timeline-skeleton">
          {[1, 2, 3].map(i => (
            <div key={i} className="skeleton-entry">
              <div className="skeleton" style={{ width: '60px', height: '14px' }} />
              <div className="skeleton" style={{ width: '100%', height: '60px', marginTop: '8px' }} />
            </div>
          ))}
        </div>
      ) : filteredTimeline.length > 0 ? (
        <div className="timeline stagger">
          {filteredTimeline.map((entry, i) => (
            <TimelineEntry key={entry.id || i} entry={entry} onDelete={handleDelete} onUpdate={handleUpdate} />
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <div className="empty-icon">{filter ? '🔍' : '📝'}</div>
          <div className="empty-title">{filter ? `No ${filter} entries found` : 'Your day is a blank page'}</div>
          <div className="empty-desc">
            {filter ? 'Try clearing the filter.' : "What's happening? Capture something above to see it here."}
          </div>
          {filter && <button className="btn btn-secondary" onClick={() => setFilter(null)}>Clear Filter</button>}
        </div>
      )}
    </div>
  );
}

function TimelineEntry({ entry, onDelete, onUpdate }) {
  const [hovered, setHovered] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState('');
  const editRef = useRef(null);

  const time = new Date(entry.timestamp || entry.createdAt || entry.created_at).toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', hour12: true,
  });

  const rawText = entry.rawText || entry.raw_text || entry.text;

  function startEdit() {
    setEditText(rawText);
    setEditing(true);
    setTimeout(() => editRef.current?.focus(), 50);
  }

  function cancelEdit() { setEditing(false); }

  function saveEdit() {
    if (editText.trim() && editText.trim() !== rawText) {
      onUpdate(entry.id, editText.trim());
    }
    setEditing(false);
  }

  function handleEditKeyDown(e) {
    if (e.key === 'Escape') cancelEdit();
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveEdit(); }
  }

  const extracted = entry.extractedState || entry.extracted_state;
  const badges = [];
  if (extracted) {
    (extracted.actionItems || extracted.action_items || []).forEach(a =>
      badges.push({ type: 'action', text: typeof a === 'string' ? a : a.text || a.description || 'action' }));
    (extracted.blockers || []).forEach(b =>
      badges.push({ type: 'blocker', text: typeof b === 'string' ? b : b.text || b.description || 'blocker' }));
    (extracted.completions || []).forEach(c =>
      badges.push({ type: 'done', text: typeof c === 'string' ? c : c.text || c.description || 'done' }));
    (extracted.deadlines || []).forEach(d =>
      badges.push({ type: 'deadline', text: typeof d === 'string' ? d : d.text || d.description || 'deadline' }));
  }

  return (
    <div className={`timeline-entry card ${deleting ? 'entry-deleting' : ''}`}
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <div className="entry-header">
        <div className="entry-time">{time}</div>
        <div className={`entry-actions ${hovered ? 'visible' : ''}`}>
          <button className="btn btn-ghost btn-sm entry-edit-btn" onClick={startEdit} title="Edit">✏️</button>
          <button className="btn btn-ghost btn-sm entry-delete-btn" onClick={() => { setDeleting(true); onDelete(entry.id); }} title="Delete">🗑️</button>
        </div>
      </div>
      {editing ? (
        <div className="entry-edit-box">
          <textarea
            ref={editRef}
            className="entry-edit-input"
            value={editText}
            onChange={e => setEditText(e.target.value)}
            onKeyDown={handleEditKeyDown}
            rows={3}
          />
          <div className="entry-edit-actions">
            <button className="btn btn-sm btn-ghost" onClick={cancelEdit}>Cancel</button>
            <button className="btn btn-sm btn-primary" onClick={saveEdit}>Save</button>
          </div>
        </div>
      ) : (
        <div className="entry-text" onDoubleClick={startEdit} title="Double-click to edit">{rawText}</div>
      )}
      {entry.source && entry.source !== 'manual' && (
        <span className="badge badge-tag" style={{ marginTop: '6px' }}>{entry.source}</span>
      )}
      {badges.length > 0 && (
        <div className="entry-badges">
          {badges.slice(0, 6).map((b, i) => (
            <span key={i} className={`badge badge-${b.type}`} style={{ animationDelay: `${i * 50}ms` }}>
              {b.type === 'action' && '🔴 '}{b.type === 'blocker' && '🟡 '}
              {b.type === 'done' && '🟢 '}{b.type === 'deadline' && '🔵 '}
              {b.text.slice(0, 40)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}
