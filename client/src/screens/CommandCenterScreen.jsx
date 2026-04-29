/** ✦ FLOWRA — Command Center
 *
 * The executive operations surface. Items grouped by category,
 * dynamic priority sorting, capture with type buttons, completion ledger,
 * and intelligence signals — all in one view.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { items as itemsApi, categories as catApi, analytics as analyticsApi, entries, plan as planApi, dataExport, files, actions } from '../services/api';
import AnimatedCounter from '../components/AnimatedCounter';
import { Card, MetricCard, ProgressRing, TrajectoryChart, ActionBtn, PageLoader, EmptyState } from '../components/ui/UiKit';
import './CommandCenterScreen.css';

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function CommandCenterScreen() {
  const [items, setItems] = useState([]);
  const [categories, setCategories] = useState([]);
  const [overview, setOverview] = useState(null);
  const [completions, setCompletions] = useState(null);
  const [focus, setFocus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeCategory, setActiveCategory] = useState(null); // null = all
  const [captureOpen, setCaptureOpen] = useState(false);
  const [showCompleted, setShowCompleted] = useState(false);
  const [toast, setToast] = useState(null);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [batchMode, setBatchMode] = useState(false);
  const [draggedId, setDraggedId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const filters = { sort: 'priority' };
      if (activeCategory) filters.category = activeCategory;

      const [itemsRes, catRes, overviewRes, completionsRes, planRes] = await Promise.allSettled([
        itemsApi.list(filters),
        catApi.list(),
        analyticsApi.overview(),
        itemsApi.completions(7),
        planApi.today().catch(() => null),
      ]);

      if (itemsRes.status === 'fulfilled') setItems(itemsRes.value?.items || []);
      if (catRes.status === 'fulfilled') setCategories(catRes.value?.categories || []);
      if (overviewRes.status === 'fulfilled') setOverview(overviewRes.value);
      if (completionsRes.status === 'fulfilled') setCompletions(completionsRes.value);
      if (planRes.status === 'fulfilled' && planRes.value) setFocus(planRes.value.focus || null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [activeCategory]);

  useEffect(() => { load(); }, [load]);

  // Listen for global ⌘K shortcut
  useEffect(() => {
    function handleOpenCapture() { setCaptureOpen(true); }
    window.addEventListener('flowra:open-capture', handleOpenCapture);
    return () => window.removeEventListener('flowra:open-capture', handleOpenCapture);
  }, []);

  // ── Keyboard shortcuts ────────────────────────────────────
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); setCaptureOpen(true); }
      if (e.key === 'Escape' && captureOpen) setCaptureOpen(false);
      if (e.key === 'Escape' && batchMode) { setBatchMode(false); setSelectedIds(new Set()); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [captureOpen, batchMode]);

  function showToast(msg, type = 'success') {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 2600);
  }

  async function handleMarkDone(item) {
    try {
      await itemsApi.markDone(item.id);
      showToast(`✅ "${item.text}" completed`);
      load();
    } catch (err) { showToast(err.message, 'error'); }
  }

  async function handleToggleBlocker(item) {
    try {
      await itemsApi.toggleBlocker(item.id, !item.blocker);
      showToast(item.blocker ? `Blocker cleared` : `⚠ Marked as blocker`);
      load();
    } catch (err) { showToast(err.message, 'error'); }
  }

  async function handleDrop(item) {
    try {
      await itemsApi.remove(item.id);
      showToast(`Dropped "${item.text}"`);
      load();
    } catch (err) { showToast(err.message, 'error'); }
  }

  async function handleSnooze(item, mins = 180) {
    try {
      await actions.submit(item.id, 'snooze', mins);
      showToast(`⏸ Snoozed for ${mins >= 60 ? `${mins/60}h` : `${mins}m`}`);
      load();
    } catch (err) { showToast(err.message, 'error'); }
  }

  async function handleExport() {
    try {
      showToast('Exporting your ledger...');
      await dataExport.download();
      showToast('✅ Export downloaded');
    } catch (err) { showToast(err.message, 'error'); }
  }

  // ── Batch actions ──────────────────────────────────────────
  function toggleSelect(id) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function batchMarkDone() {
    for (const id of selectedIds) {
      try { await itemsApi.markDone(id); } catch {}
    }
    showToast(`✅ ${selectedIds.size} items done`);
    setSelectedIds(new Set()); setBatchMode(false); load();
  }

  async function batchDrop() {
    for (const id of selectedIds) {
      try { await itemsApi.remove(id); } catch {}
    }
    showToast(`Dropped ${selectedIds.size} items`);
    setSelectedIds(new Set()); setBatchMode(false); load();
  }

  // ── Drag & Drop ────────────────────────────────────────────
  function handleDragStart(e, id) {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', id);
    setDraggedId(id);
    setTimeout(() => {
      e.target.style.opacity = '0.5';
    }, 0);
  }

  function handleDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }

  async function handleDropOnItem(e, targetId) {
    e.preventDefault();
    const sourceId = draggedId || e.dataTransfer.getData('text/plain');
    if (!sourceId || sourceId === targetId) return;

    const targetItem = items.find(i => i.id === targetId);
    if (!targetItem) return;

    const newPriority = targetItem.priority > 0.9 ? targetItem.priority - 0.01 : targetItem.priority + 0.01;
    
    setItems(prev => prev.map(i => i.id === sourceId ? { ...i, priority: newPriority } : i));
    setDraggedId(null);

    try {
      await itemsApi.update(sourceId, { priority: newPriority });
      load();
    } catch {
      load();
    }
  }

  function handleDragEnd(e) {
    e.target.style.opacity = '1';
    setDraggedId(null);
  }

  // ── Partition items ──────────────────────────────────────

  const blockerItems = items.filter(i => i.blocker && i.state !== 'DONE');
  const activeItems = items.filter(i => !i.blocker && i.state !== 'DONE');
  const summary = overview?.summary || {};
  const totalOpen = summary.totalOpen ?? items.filter(i => i.state !== 'DONE' && i.state !== 'DROPPED').length;
  const totalBlocked = summary.totalBlocked ?? blockerItems.length;
  const totalDone = summary.totalDone ?? items.filter(i => i.state === 'DONE').length;
  const totalOverdue = summary.overdue ?? countDueItems(items, -1);
  const dueSoon = countDueItems(items, 3);
  const weeklyVelocity = overview?.crossCutting?.weeklyVelocity || {};
  const weeklyCompleted = weeklyVelocity.completed ?? completions?.totalCompleted ?? 0;
  const weeklyCreated = weeklyVelocity.created ?? items.filter(i => isWithinDays(i.createdAt || i.created_at, 7)).length;
  const completionRate = Math.round((weeklyCompleted / Math.max(weeklyCompleted + totalOpen, 1)) * 100);
  const categoryDashboard = buildCategoryDashboard(overview?.categories || [], categories, items);
  const completionTrend = buildCompletionTrend(completions?.items || []);

  // ── Group by category for "all" view ─────────────────────

  const groupedByCategory = {};
  if (!activeCategory) {
    for (const item of items.filter(i => i.state !== 'DONE')) {
      const cat = item.category || 'uncategorized';
      if (!groupedByCategory[cat]) groupedByCategory[cat] = [];
      groupedByCategory[cat].push(item);
    }
  }

  return (
    <div className="command-center page-container">
      {/* ── Header ───────────────────────────────────────── */}
      <header className="cc-header">
        <div>
          <p className="eyebrow">Command Center</p>
          <h1 className="cc-title">
            {getDayGreeting()}
          </h1>
        </div>
        <div className="cc-header-actions">
          <button className={`btn btn-ghost btn-sm ${batchMode ? 'btn-active' : ''}`} onClick={() => { setBatchMode(v => !v); setSelectedIds(new Set()); }} title="Select multiple">
            ☐ Select
          </button>
          <button className="btn btn-secondary" onClick={handleExport} title="Download full ledger JSON">
            ↓ Export
          </button>
          <button className="btn btn-primary btn-lg" onClick={() => setCaptureOpen(true)} title="Cmd+K">
            + Capture
          </button>
        </div>
      </header>

      {/* ── Batch Action Bar ─────────────────────────────── */}
      {batchMode && selectedIds.size > 0 && (
        <div className="cc-batch-bar animate-slideUp">
          <span>{selectedIds.size} selected</span>
          <button className="btn btn-sm btn-primary" onClick={batchMarkDone}>✓ Done</button>
          <button className="btn btn-sm btn-ghost" onClick={batchDrop}>× Drop</button>
          <button className="btn btn-sm btn-ghost" onClick={() => { setSelectedIds(new Set()); }}>Clear</button>
        </div>
      )}

      {error && <div className="command-error">{error}</div>}

      {/* ── Summary Metrics ──────────────────────────────── */}
      <section className="cc-metrics stagger">
        <div className="metric-card" onClick={() => { setActiveCategory(null); }}>
          <span className="metric-value"><AnimatedCounter value={totalOpen} /></span>
          <span className="metric-label">Open</span>
        </div>
        <div className="metric-card metric-blocker">
          <span className="metric-value"><AnimatedCounter value={totalBlocked} /></span>
          <span className="metric-label">Blocked</span>
        </div>
        <div className="metric-card metric-done" onClick={() => setShowCompleted(v => !v)}>
          <span className="metric-value"><AnimatedCounter value={totalDone} /></span>
          <span className="metric-label">Done</span>
        </div>
        <div className="metric-card metric-overdue">
          <span className="metric-value"><AnimatedCounter value={totalOverdue} /></span>
          <span className="metric-label">Overdue</span>
        </div>
      </section>

      {/* ── Category Tabs ────────────────────────────────── */}
      <PersonalOperatingDashboard
        totalOpen={totalOpen}
        totalBlocked={totalBlocked}
        totalDone={totalDone}
        dueSoon={dueSoon}
        weeklyCompleted={weeklyCompleted}
        weeklyCreated={weeklyCreated}
        completionRate={completionRate}
        categories={categoryDashboard}
        trend={completionTrend}
        onCapture={() => setCaptureOpen(true)}
        onShowCompleted={() => setShowCompleted(true)}
        onSelectCategory={setActiveCategory}
      />

      <CustomerOperatingWorkbench
        totalOpen={totalOpen}
        totalBlocked={totalBlocked}
        dueSoon={dueSoon}
        weeklyCreated={weeklyCreated}
        weeklyCompleted={weeklyCompleted}
        categories={categoryDashboard}
        focus={focus}
        onCapture={() => setCaptureOpen(true)}
        onShowCompleted={() => setShowCompleted(true)}
        onShowAll={() => setActiveCategory(null)}
      />

      <nav className="cc-category-tabs">
        <button
          className={`cc-cat-tab ${!activeCategory ? 'active' : ''}`}
          onClick={() => setActiveCategory(null)}
        >
          All
        </button>
        {categories.map(cat => (
          <button
            key={cat.id || cat.name}
            className={`cc-cat-tab ${activeCategory === cat.name ? 'active' : ''}`}
            onClick={() => setActiveCategory(cat.name)}
            style={{ '--cat-color': cat.color }}
          >
            <span className="cat-dot" style={{ background: cat.color }} />
            {cat.name}
            {cat.itemCounts && (
              <span className="cat-count">
                {(cat.itemCounts.open || 0) + (cat.itemCounts.inProgress || 0)}
              </span>
            )}
          </button>
        ))}
      </nav>

      {/* ── Focus Card (from plan engine) ────────────────── */}
      {focus && (
        <section className="cc-focus animate-slideUp">
          <div className="cc-focus-kicker">
            <span className="state-pill">Primary directive</span>
          </div>
          <h2 className="cc-focus-text">{focus.text}</h2>
          <div className="cc-focus-meta">
            {focus.project && <span className="badge badge-tag">{focus.project}</span>}
            {focus.deadlineDays !== null && focus.deadlineDays !== undefined && (
              <span className={`badge ${focus.deadlineDays <= 0 ? 'badge-action' : 'badge-deadline'}`}>
                {focus.deadlineDays <= 0 ? 'overdue' : `${focus.deadlineDays}d left`}
              </span>
            )}
            {focus.score !== null && focus.score !== undefined && <span className="badge badge-tag">score {focus.score}</span>}
          <div className="cc-focus-actions">
            <button className="btn btn-primary btn-sm" onClick={() => handleMarkDone(focus)}>✅ Done</button>
            <button className="btn btn-secondary btn-sm" onClick={() => handleToggleBlocker(focus)}>🚫 Blocked</button>
          </div>
        </section>
      )}

      {/* ── Loading State ────────────────────────────────── */}
      {loading && (
        <PageLoader text="Loading your intelligence ledger..." />
      )}

      {/* ── Blockers Banner ──────────────────────────────── */}
      {!loading && blockerItems.length > 0 && (
        <section className="cc-section">
          <div className="section-title">⚠ Blockers ({blockerItems.length})</div>
          <div className="cc-item-list stagger">
            {blockerItems.map(item => (
              <ItemRow
                key={item.id}
                item={item}
                onDone={handleMarkDone}
                onBlocker={handleToggleBlocker}
                onDrop={handleDrop}
                onSnooze={handleSnooze}
                onUpdate={load}
                categories={categories}
                isBlocker
                batchMode={batchMode}
                selected={selectedIds.has(item.id)}
                onToggleSelect={() => toggleSelect(item.id)}
                onDragStart={(e) => handleDragStart(e, item.id)}
                onDragOver={handleDragOver}
                onDrop={(e) => handleDropOnItem(e, item.id)}
                onDragEnd={handleDragEnd}
              />
            ))}
          </div>
        </section>
      )}

      {/* ── Items (grouped by category or flat) ──────────── */}
      {!loading && (
        activeCategory ? (
          <section className="cc-section">
            <div className="section-title">{activeCategory} ({activeItems.length})</div>
            {activeItems.length === 0 ? (
              <EmptyCategory onCapture={() => setCaptureOpen(true)} />
            ) : (
              <div className="cc-item-list stagger">
                {activeItems.map(item => (
                  <ItemRow key={item.id} item={item} onDone={handleMarkDone} onBlocker={handleToggleBlocker} onDrop={handleDrop} onSnooze={handleSnooze} onUpdate={load} categories={categories} batchMode={batchMode} selected={selectedIds.has(item.id)} onToggleSelect={() => toggleSelect(item.id)} onDragStart={(e) => handleDragStart(e, item.id)} onDragOver={handleDragOver} onDrop={(e) => handleDropOnItem(e, item.id)} onDragEnd={handleDragEnd} />
                ))}
              </div>
            )}
          </section>
        ) : (
          Object.keys(groupedByCategory).length > 0 ? (
            Object.entries(groupedByCategory).map(([catName, catItems]) => (
              <section className="cc-section" key={catName}>
                <div className="section-title">
                  <span className="cat-dot" style={{ background: categories.find(c => c.name === catName)?.color || '#8888a0' }} />
                  {catName} ({catItems.length})
                </div>
                <div className="cc-item-list stagger">
                  {catItems.map(item => (
                    <ItemRow key={item.id} item={item} onDone={handleMarkDone} onBlocker={handleToggleBlocker} onDrop={handleDrop} onSnooze={handleSnooze} onUpdate={load} categories={categories} batchMode={batchMode} selected={selectedIds.has(item.id)} onToggleSelect={() => toggleSelect(item.id)} onDragStart={(e) => handleDragStart(e, item.id)} onDragOver={handleDragOver} onDrop={(e) => handleDropOnItem(e, item.id)} onDragEnd={handleDragEnd} />
                  ))}
                </div>
              </section>
            ))
          ) : !loading && items.length === 0 && (
            <EmptyState 
              title="Your command center is empty" 
              description="Capture what's happening — meetings, blockers, tasks, decisions. Flowra will extract the action items and build your operating state."
              action={<ActionBtn onClick={() => setCaptureOpen(true)}>Capture your first signal</ActionBtn>}
            />
          )
        )
      )}

      {/* ── Completed This Week ──────────────────────────── */}
      {showCompleted && completions && completions.items?.length > 0 && (
        <section className="cc-section cc-completed animate-slideUp">
          <div className="section-title">✅ Completed this week ({completions.totalCompleted})</div>
          <div className="cc-item-list">
            {completions.items.slice(0, 10).map(item => (
              <div key={item.id} className="cc-done-item">
                <span className="cc-done-check">✓</span>
                <div>
                  <p>{item.text}</p>
                  <span className="cc-done-meta">
                    {item.category} · {timeAgo(item.completedAt)}
                  </span>
                </div>
              </div>
            ))}
          </div>
          {completions.byCategory?.length > 0 && (
            <div className="cc-completion-breakdown">
              {completions.byCategory.map(bc => (
                <span key={bc.category} className="badge badge-done">{bc.category}: {bc.count}</span>
              ))}
            </div>
          )}
        </section>
      )}

      {/* ── Category Health (from analytics) ─────────────── */}
      {overview?.categories?.length > 0 && (
        <section className="cc-section cc-health">
          <div className="section-title">Category Health</div>
          <div className="cc-health-grid stagger">
            {overview.categories.map(cat => (
              <CategoryHealthCard
                key={cat.name}
                cat={cat}
                color={categories.find(c => c.name === cat.name)?.color || '#8888a0'}
                onClick={() => setActiveCategory(cat.name)}
              />
            ))}
          </div>
          {overview.crossCutting && (
            <div className="cc-velocity">
              <span>This week: <strong>{overview.crossCutting.weeklyVelocity?.completed || 0}</strong> completed, <strong>{overview.crossCutting.weeklyVelocity?.created || 0}</strong> created</span>
              <span className={`badge badge-${overview.crossCutting.completionTrend === 'improving' ? 'done' : overview.crossCutting.completionTrend === 'declining' ? 'action' : 'tag'}`}>
                {overview.crossCutting.completionTrend}
              </span>
            </div>
          )}
        </section>
      )}

      {/* ── Capture Sheet ────────────────────────────────── */}
      <CaptureSheet
        open={captureOpen}
        categories={categories}
        defaultCategory={activeCategory}
        onClose={() => setCaptureOpen(false)}
        onCaptured={() => { setCaptureOpen(false); load(); }}
      />

      {/* ── Toast ────────────────────────────────────────── */}
      {toast && (
        <div className="toast-container">
          <div className={`toast toast-${toast.type}`}>{toast.msg}</div>
        </div>
      )}
    </div>
  );
}

// ─── Item Row ─────────────────────────────────────────────────────────────────

function ItemRow({ item, onDone, onBlocker, onDrop, onSnooze, onUpdate, isBlocker, categories: cats, batchMode, selected, onToggleSelect, onDragStart, onDragOver, onDrop: handleDrop, onDragEnd }) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(item.text);
  const [detail, setDetail] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [editingDeadline, setEditingDeadline] = useState(false);
  const [deadlineVal, setDeadlineVal] = useState(item.deadline ? new Date(item.deadline).toISOString().slice(0,10) : '');
  const [editingPriority, setEditingPriority] = useState(false);
  const [priorityVal, setPriorityVal] = useState(Math.round((item.priority || 0.5) * 100));
  const [showSnoozeMenu, setShowSnoozeMenu] = useState(false);
  const editRef = useRef(null);

  const deadlineLabel = getDeadlineLabel(item.deadline);
  const isOverdue = item.deadline && new Date(item.deadline) < new Date();

  async function toggleExpand() {
    if (editing) return;
    if (!expanded && !detail) {
      setLoadingDetail(true);
      try {
        const res = await itemsApi.get(item.id);
        setDetail(res);
      } catch { /* ignore */ }
      setLoadingDetail(false);
    }
    setExpanded(v => !v);
  }

  function startEdit(e) {
    e.stopPropagation();
    setEditing(true);
    setEditText(item.text);
    setTimeout(() => editRef.current?.focus(), 30);
  }

  async function saveEdit() {
    setEditing(false);
    const trimmed = editText.trim();
    if (trimmed && trimmed !== item.text) {
      try {
        await itemsApi.update(item.id, { text: trimmed });
        if (onUpdate) onUpdate();
      } catch { /* revert */ setEditText(item.text); }
    }
  }

  function handleEditKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveEdit(); }
    if (e.key === 'Escape') { setEditing(false); setEditText(item.text); }
  }

  async function handleCategoryChange(newCat) {
    try {
      await itemsApi.update(item.id, { category: newCat });
      if (onUpdate) onUpdate();
    } catch { /* ignore */ }
  }

  async function handleDeadlineSave() {
    setEditingDeadline(false);
    try {
      await itemsApi.update(item.id, { deadline: deadlineVal || null });
      if (onUpdate) onUpdate();
    } catch { /* ignore */ }
  }

  async function handlePrioritySave() {
    setEditingPriority(false);
    try {
      await itemsApi.update(item.id, { priority: priorityVal / 100 });
      if (onUpdate) onUpdate();
    } catch { /* ignore */ }
  }

  return (
    <div 
      className={`cc-item ${isBlocker ? 'cc-item--blocker' : ''} ${isOverdue ? 'cc-item--overdue' : ''} ${expanded ? 'cc-item--expanded' : ''} ${selected ? 'cc-item--selected' : ''}`}
      draggable={!batchMode && !editing && !expanded}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={handleDrop}
      onDragEnd={onDragEnd}
    >
      {batchMode ? (
        <button className={`cc-item-check cc-batch-check ${selected ? 'cc-batch-checked' : ''}`} onClick={onToggleSelect}>
          {selected ? '☑' : '☐'}
        </button>
      ) : (
        <button className="cc-item-check" onClick={() => onDone(item)} title="Mark done">
          <span className="check-ring" />
        </button>
      )}
      <div className="cc-item-body" onClick={toggleExpand}>
        {editing ? (
          <input
            ref={editRef}
            className="cc-item-edit-input"
            value={editText}
            onChange={e => setEditText(e.target.value)}
            onBlur={saveEdit}
            onKeyDown={handleEditKey}
            onClick={e => e.stopPropagation()}
          />
        ) : (
          <p className="cc-item-text" onDoubleClick={startEdit} title="Double-click to edit">{item.text}</p>
        )}
        <div className="cc-item-badges">
          {item.blocker && <span className="badge badge-blocker">blocker</span>}
          {deadlineLabel && (
            <span className={`badge ${isOverdue ? 'badge-action' : 'badge-deadline'}`}>{deadlineLabel}</span>
          )}
          {item.category && item.category !== 'uncategorized' && (
            <span className="badge badge-tag">{item.category}</span>
          )}
          {item.confidence < 0.5 && <span className="badge badge-tag">low confidence</span>}
        </div>

        {/* ── Expanded Detail ──────────────────────── */}
        {expanded && (
          <div className="cc-item-detail" onClick={e => e.stopPropagation()}>
            {loadingDetail ? (
              <span className="spinner" />
            ) : (
              <>
                <div className="cc-detail-meta">
                  <span onClick={() => setEditingPriority(true)} className="cc-detail-editable" title="Click to edit priority">
                    Priority: {editingPriority ? '' : `${(item.priority * 100).toFixed(0)}%`}
                    {editingPriority && (
                      <span className="cc-inline-edit" onClick={e => e.stopPropagation()}>
                        <input type="range" min="0" max="100" value={priorityVal} onChange={e => setPriorityVal(+e.target.value)} className="cc-priority-slider" />
                        <span>{priorityVal}%</span>
                        <button className="cc-save-btn" onClick={handlePrioritySave}>✓</button>
                      </span>
                    )}
                  </span>
                  <span>Confidence: {(item.confidence * 100).toFixed(0)}%</span>
                  {item.estimatedMins && <span>Est: {item.estimatedMins}m</span>}
                  <span>Mentions: {item.mentionCount || 1}</span>
                  <span>First seen: {timeAgo(item.firstSeen)}</span>
                </div>
                {/* Deadline editor */}
                <div className="cc-detail-deadline">
                  <label onClick={() => setEditingDeadline(true)} className="cc-detail-editable">Deadline:</label>
                  {editingDeadline ? (
                    <span className="cc-inline-edit" onClick={e => e.stopPropagation()}>
                      <input type="date" className="input cc-date-input" value={deadlineVal} onChange={e => setDeadlineVal(e.target.value)} />
                      <button className="cc-save-btn" onClick={handleDeadlineSave}>✓</button>
                      <button className="cc-save-btn" onClick={() => { setDeadlineVal(''); handleDeadlineSave(); }}>✕</button>
                    </span>
                  ) : (
                    <span className="cc-detail-editable" onClick={() => setEditingDeadline(true)}>
                      {item.deadline ? new Date(item.deadline).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'none — click to set'}
                    </span>
                  )}
                </div>
                <div className="cc-detail-category">
                  <label>Category:</label>
                  <select
                    className="input cc-detail-select"
                    value={item.category || 'uncategorized'}
                    onChange={e => handleCategoryChange(e.target.value)}
                  >
                    <option value="uncategorized">uncategorized</option>
                    {(cats || []).filter(c => c.id).map(c => (
                      <option key={c.id} value={c.name}>{c.name}</option>
                    ))}
                  </select>
                </div>
                {detail?.events?.length > 0 && (
                  <div className="cc-detail-events">
                    <span className="cc-detail-events-title">Event History</span>
                    {detail.events.slice(0, 6).map((ev, i) => (
                      <div key={i} className="cc-detail-event">
                        <span className="badge badge-tag">{ev.fromState || '—'} → {ev.toState}</span>
                        <span className="cc-detail-event-time">{timeAgo(ev.createdAt)}</span>
                        {ev.reason && <span className="cc-detail-event-reason">{ev.reason}</span>}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
      <div className="cc-item-actions">
        <div className="cc-snooze-wrap">
          <button className="btn btn-icon btn-ghost" onClick={() => setShowSnoozeMenu(v => !v)} title="Snooze">
            ⏸
          </button>
          {showSnoozeMenu && (
            <div className="cc-snooze-menu" onClick={e => e.stopPropagation()}>
              <button onClick={() => { onSnooze(item, 60); setShowSnoozeMenu(false); }}>1h</button>
              <button onClick={() => { onSnooze(item, 180); setShowSnoozeMenu(false); }}>3h</button>
              <button onClick={() => { onSnooze(item, 1440); setShowSnoozeMenu(false); }}>1d</button>
              <button onClick={() => { onSnooze(item, 4320); setShowSnoozeMenu(false); }}>3d</button>
            </div>
          )}
        </div>
        <button className="btn btn-icon btn-ghost" onClick={() => onBlocker(item)} title={item.blocker ? 'Clear blocker' : 'Mark blocker'}>
          {item.blocker ? '✕' : '⚠'}
        </button>
        <button className="btn btn-icon btn-ghost" onClick={() => onDrop(item)} title="Drop">
          ×
        </button>
      </div>
    </div>
  );
}

// ─── Category Health Card ─────────────────────────────────────────────────────

function PersonalOperatingDashboard({
  totalOpen,
  totalBlocked,
  totalDone,
  dueSoon,
  weeklyCompleted,
  weeklyCreated,
  completionRate,
  categories,
  trend,
  onCapture,
  onShowCompleted,
  onSelectCategory,
}) {
  const stateTotal = Math.max(totalOpen + totalDone, 1);
  const openPct = Math.round((totalOpen / stateTotal) * 100);
  const donePct = Math.round((totalDone / stateTotal) * 100);
  const blockedPct = totalOpen > 0 ? Math.round((totalBlocked / totalOpen) * 100) : 0;
  const trendMax = Math.max(...trend.map(d => d.count), 1);

  return (
    <section className="cc-personal-dashboard animate-slideUp">
      <div className="cc-dashboard-main">
        <div className="cc-dashboard-copy">
          <p className="eyebrow">Personal dashboard</p>
          <h2>Your operating system, in numbers.</h2>
          <p>
            This is the customer view: live workload, risk, completion, and category pressure
            from your own captured data.
          </p>
          <div className="cc-dashboard-actions">
            <ActionBtn variant="primary" className="btn-sm" onClick={onCapture}>Capture signal</ActionBtn>
            <ActionBtn variant="secondary" className="btn-sm" onClick={onShowCompleted}>Review wins</ActionBtn>
          </div>
        </div>

        <div className="cc-dashboard-ring-container">
          <ProgressRing 
            percentage={completionRate} 
            size={160} 
            strokeWidth={14}
            label={`${completionRate}%`}
            sublabel="weekly flow"
            color="var(--gold)"
          />
        </div>
      </div>

      <div className="cc-dashboard-grid">
        <button className="cc-dashboard-card" onClick={() => onSelectCategory(null)}>
          <span className="cc-card-label">Open loop</span>
          <strong>{totalOpen}</strong>
          <span>{weeklyCreated} created this week</span>
        </button>
        <button className="cc-dashboard-card cc-dashboard-card--risk" onClick={() => onSelectCategory(null)}>
          <span className="cc-card-label">Blocked drag</span>
          <strong>{totalBlocked}</strong>
          <span>{blockedPct}% of active load</span>
        </button>
        <button className="cc-dashboard-card cc-dashboard-card--done" onClick={onShowCompleted}>
          <span className="cc-card-label">Output</span>
          <strong>{weeklyCompleted}</strong>
          <span>completed this week</span>
        </button>
        <button className="cc-dashboard-card cc-dashboard-card--due" onClick={() => onSelectCategory(null)}>
          <span className="cc-card-label">Next pressure</span>
          <strong>{dueSoon}</strong>
          <span>due within 3 days</span>
        </button>
      </div>

      <div className="cc-dashboard-visuals">
        <div className="cc-visual-card">
          <div className="cc-visual-header">
            <span>State mix</span>
            <strong>{donePct}% done</strong>
          </div>
          <div className="cc-state-stack" aria-label="State mix">
            <span className="cc-state-open" style={{ width: `${openPct}%` }} />
            <span className="cc-state-done" style={{ width: `${donePct}%` }} />
          </div>
          <div className="cc-state-legend">
            <span><i className="cc-state-open-dot" /> Open {openPct}%</span>
            <span><i className="cc-state-done-dot" /> Done {donePct}%</span>
          </div>
        </div>

        <div className="cc-visual-card">
          <div className="cc-visual-header">
            <span>Category pressure</span>
            <strong>{categories.length || 0}</strong>
          </div>
          <div className="cc-category-bars">
            {categories.length === 0 ? (
              <span className="cc-empty-mini">No category pressure yet.</span>
            ) : categories.map(cat => (
              <button key={cat.name} className="cc-category-bar-row" onClick={() => onSelectCategory(cat.name)}>
                <span>{cat.name}</span>
                <span className="cc-category-bar-track">
                  <span style={{ width: `${cat.percent}%`, background: cat.color }} />
                </span>
                <strong>{cat.total}</strong>
              </button>
            ))}
          </div>
        </div>

        <div className="cc-visual-card">
          <div className="cc-visual-header">
            <span>7-day output</span>
            <strong>{weeklyCompleted}</strong>
          </div>
          <div style={{ marginTop: 'var(--space-3)' }}>
            <TrajectoryChart 
              data={trend.map(d => ({ name: d.short, value: d.count }))} 
              height={140} 
              color="var(--gold)" 
            />
          </div>
        </div>
      </div>
    </section>
  );
}

function CustomerOperatingWorkbench({
  totalOpen,
  totalBlocked,
  dueSoon,
  weeklyCreated,
  weeklyCompleted,
  categories,
  focus,
  onCapture,
  onShowCompleted,
  onShowAll,
}) {
  const strongestCategory = categories[0];
  const lanes = [
    {
      label: 'capture layer',
      title: 'Feed the system',
      value: weeklyCreated,
      detail: `${weeklyCreated} signals captured this week`,
      body: 'The product only becomes intelligent when capture is fast enough to become a habit.',
      actions: [
        { kind: 'button', label: 'Capture now', onClick: onCapture },
        { kind: 'link', label: 'Review timeline', to: '/timeline' },
      ],
    },
    {
      label: 'decision layer',
      title: 'Move the pressure',
      value: totalBlocked,
      detail: `${dueSoon} due soon / ${totalOpen} open`,
      body: focus?.text || 'The command layer should continuously point at what to do next.',
      actions: [
        { kind: 'button', label: 'Show all work', onClick: onShowAll },
        { kind: 'link', label: 'Open strategy', to: '/strategy' },
      ],
    },
    {
      label: 'memory layer',
      title: 'Use what you captured',
      value: weeklyCompleted,
      detail: strongestCategory ? `${strongestCategory.name} is the heaviest lane` : 'No category pressure yet',
      body: 'Recall, search, and category history should turn old context into current decisions.',
      actions: [
        { kind: 'link', label: 'Ask recall', to: '/search' },
        { kind: 'button', label: 'Review wins', onClick: onShowCompleted },
      ],
    },
  ];

  return (
    <section className="cc-operating-workbench">
      <div className="cc-workbench-head">
        <div>
          <p className="eyebrow">Operating layers</p>
          <h2>Not just tasks: capture, decide, remember.</h2>
        </div>
        <span>{lanes.length} connected layers</span>
      </div>
      <div className="cc-workbench-lanes">
        {lanes.map(lane => (
          <article className="cc-workbench-lane" key={lane.label}>
            <span>{lane.label}</span>
            <div className="cc-workbench-lane-top">
              <h3>{lane.title}</h3>
              <strong>{lane.value}</strong>
            </div>
            <p>{lane.body}</p>
            <small>{lane.detail}</small>
            <div className="cc-workbench-actions">
              {lane.actions.map(action => action.kind === 'link' ? (
                <Link key={action.label} className="btn btn-secondary btn-sm" to={action.to}>{action.label}</Link>
              ) : (
                <button key={action.label} className="btn btn-primary btn-sm" onClick={action.onClick}>{action.label}</button>
              ))}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function CategoryHealthCard({ cat, color, onClick }) {
  const total = cat.open + cat.inProgress;
  const healthColors = { active: '#4B9B6B', 'at-risk': '#D49B4B', stalled: '#D4574B', clear: '#9DAABE' };

  return (
    <div className="cc-health-card" onClick={onClick} style={{ '--health-color': healthColors[cat.health] || '#8888a0' }}>
      <div className="cc-health-header">
        <span className="cat-dot" style={{ background: color }} />
        <span className="cc-health-name">{cat.name}</span>
        <span className={`cc-health-status cc-health-${cat.health}`}>{cat.health}</span>
      </div>
      <div className="cc-health-stats">
        <span>{total} active</span>
        {cat.blocked > 0 && <span className="cc-health-blocked">{cat.blocked} blocked</span>}
        <span>{cat.doneThisWeek} done/wk</span>
      </div>
      {cat.avgCompletionDays && (
        <div className="cc-health-avg">avg {cat.avgCompletionDays}d to complete</div>
      )}
    </div>
  );
}

function CaptureSheet({ open, categories: cats, defaultCategory, onClose, onCaptured }) {
  const [text, setText] = useState('');
  const [type, setType] = useState('capture');
  const [category, setCategory] = useState(defaultCategory || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [listening, setListening] = useState(false);
  const [attachedFile, setAttachedFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const ref = useRef(null);
  const fileInputRef = useRef(null);
  const recognitionRef = useRef(null);

  const speechSupported = typeof window !== 'undefined' &&
    ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window);

  useEffect(() => {
    if (open) {
      setText('');
      setType('capture');
      setCategory(defaultCategory || '');
      setError('');
      setListening(false);
      setTimeout(() => ref.current?.focus(), 50);
    } else {
      // Stop listening when closing
      if (recognitionRef.current) {
        recognitionRef.current.stop();
        recognitionRef.current = null;
      }
    }
  }, [open, defaultCategory]);

  function toggleVoice() {
    if (listening) {
      recognitionRef.current?.stop();
      setListening(false);
      return;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    let finalTranscript = text;

    recognition.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const t = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += (finalTranscript ? ' ' : '') + t;
        } else {
          interim = t;
        }
      }
      setText(finalTranscript + (interim ? ' ' + interim : ''));
    };

    recognition.onerror = () => {
      setListening(false);
      recognitionRef.current = null;
    };

    recognition.onend = () => {
      setListening(false);
      recognitionRef.current = null;
    };

    recognitionRef.current = recognition;
    recognition.start();
    setListening(true);
  }

  if (!open) return null;

  async function handleFileSelect(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const result = await files.upload(file);
      setAttachedFile({ ...result, name: file.name });
    } catch (err) {
      setError(`Upload failed: ${err.message}`);
    }
    setUploading(false);
  }

  async function submit(e) {
    if (e) e.preventDefault();
    if (!text.trim() && !attachedFile) return;
    if (listening) { recognitionRef.current?.stop(); setListening(false); }
    setSaving(true);
    setError('');
    try {
      const opts = { type, category: category || undefined };
      if (attachedFile) opts.fileKey = attachedFile.fileKey;
      await entries.capture(text.trim() || `[File: ${attachedFile?.name}]`, opts);
      setAttachedFile(null);
      onCaptured();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const typeButtons = [
    { key: 'capture', label: '🧠 Dump', desc: 'Full AI extraction' },
    { key: 'todo', label: '📋 Todo', desc: 'Direct action item' },
    { key: 'done', label: '✅ Done', desc: 'Mark completed' },
    { key: 'blocked', label: '🚫 Blocked', desc: 'Flag blocker' },
    { key: 'note', label: '💬 Note', desc: 'Journal entry' },
  ];

  return (
    <div className="capture-backdrop" onMouseDown={onClose}>
      <form className="capture-sheet" onSubmit={submit} onMouseDown={e => e.stopPropagation()}>
        <p className="eyebrow">Capture</p>

        {/* Type buttons */}
        <div className="capture-types">
          {typeButtons.map(tb => (
            <button
              key={tb.key}
              type="button"
              className={`capture-type-btn ${type === tb.key ? 'active' : ''}`}
              onClick={() => setType(tb.key)}
              title={tb.desc}
            >
              {tb.label}
            </button>
          ))}
        </div>

        {/* Category selector */}
        <div className="capture-category-row">
          <select
            className="input capture-category-select"
            value={category}
            onChange={e => setCategory(e.target.value)}
          >
            <option value="">No category</option>
            {(cats || []).filter(c => c.id).map(c => (
              <option key={c.id} value={c.name}>{c.name}</option>
            ))}
          </select>
        </div>

        <div className="capture-input-wrap">
          <textarea
            ref={ref}
            className="input"
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder={listening ? 'Listening...' : getPlaceholder(type)}
            rows={5}
          />
          <div className="capture-toolbar">
            {speechSupported && (
              <button
                type="button"
                className={`capture-mic-btn ${listening ? 'capture-mic-active' : ''}`}
                onClick={toggleVoice}
                title={listening ? 'Stop recording' : 'Voice capture'}
              >
                {listening ? '⏹' : '🎤'}
              </button>
            )}
            <button type="button" className="capture-attach-btn" onClick={() => fileInputRef.current?.click()} title="Attach file" disabled={uploading}>
              {uploading ? '⏳' : '📎'}
            </button>
            <input ref={fileInputRef} type="file" accept="image/*,.pdf" style={{ display: 'none' }} onChange={handleFileSelect} />
          </div>
        </div>

        {attachedFile && (
          <div className="capture-file-badge">
            📄 {attachedFile.name}
            <button type="button" onClick={() => setAttachedFile(null)} className="capture-file-remove">✕</button>
          </div>
        )}

        {error && <p className="capture-error">{error}</p>}

        <div className="capture-actions">
          <span className="capture-shortcut">⌘K to open</span>
          <ActionBtn type="button" variant="ghost" onClick={onClose}>Cancel</ActionBtn>
          <ActionBtn 
             variant="primary" 
             onClick={submit} 
             disabled={!text.trim() && !attachedFile}
          >
            {getSubmitLabel(type)}
          </ActionBtn>
        </div>
      </form>
    </div>
  );
}

// ─── Empty States ─────────────────────────────────────────────────────────────

function EmptyCategory({ onCapture }) {
  return (
    <div className="cc-empty-cat">
      <p>No active items in this category.</p>
      <button className="btn btn-sm btn-secondary" onClick={onCapture}>+ Add item</button>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildCategoryDashboard(overviewCategories, allCategories, allItems) {
  const fromOverview = overviewCategories.map(cat => ({
    name: cat.name,
    total: (cat.open || 0) + (cat.inProgress || 0),
    color: allCategories.find(c => c.name === cat.name)?.color || '#7c8fb3',
  }));
  const source = fromOverview.length > 0 ? fromOverview : Object.values(allItems.reduce((acc, item) => {
    if (item.state === 'DONE' || item.state === 'DROPPED') return acc;
    const name = item.category || 'uncategorized';
    acc[name] ||= {
      name,
      total: 0,
      color: allCategories.find(c => c.name === name)?.color || '#7c8fb3',
    };
    acc[name].total++;
    return acc;
  }, {}));
  const max = Math.max(...source.map(cat => cat.total), 1);
  return source
    .filter(cat => cat.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, 5)
    .map(cat => ({ ...cat, percent: Math.max(8, Math.round((cat.total / max) * 100)) }));
}

function buildCompletionTrend(doneItems) {
  const days = [];
  const today = new Date();
  for (let offset = 6; offset >= 0; offset--) {
    const day = new Date(today);
    day.setDate(today.getDate() - offset);
    const key = day.toISOString().slice(0, 10);
    days.push({
      key,
      count: 0,
      label: day.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
      short: day.toLocaleDateString('en-US', { weekday: 'narrow' }),
    });
  }
  for (const item of doneItems) {
    const completedAt = item.completedAt || item.completed_at || item.updatedAt || item.updated_at;
    if (!completedAt) continue;
    const key = new Date(completedAt).toISOString().slice(0, 10);
    const bucket = days.find(day => day.key === key);
    if (bucket) bucket.count++;
  }
  return days;
}

function countDueItems(allItems, daysAhead) {
  const now = new Date();
  return allItems.filter(item => {
    if (item.state === 'DONE' || item.state === 'DROPPED') return false;
    const rawDate = item.deadline || item.dueDate || item.due_date;
    if (!rawDate) return false;
    const diffDays = Math.ceil((new Date(rawDate) - now) / (1000 * 60 * 60 * 24));
    return daysAhead < 0 ? diffDays < 0 : diffDays >= 0 && diffDays <= daysAhead;
  }).length;
}

function isWithinDays(rawDate, days) {
  if (!rawDate) return false;
  const diffMs = Date.now() - new Date(rawDate).getTime();
  return diffMs >= 0 && diffMs <= days * 24 * 60 * 60 * 1000;
}

function getDayGreeting() {
  const hour = new Date().getHours();
  const day = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  return `${greeting} — ${day}`;
}

function getDeadlineLabel(deadline) {
  if (!deadline) return null;
  const d = new Date(deadline);
  const now = new Date();
  const diffMs = d - now;
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return `${Math.abs(diffDays)}d overdue`;
  if (diffDays === 0) return 'due today';
  if (diffDays === 1) return 'due tomorrow';
  if (diffDays <= 7) return `${diffDays}d left`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function timeAgo(date) {
  if (!date) return '';
  const s = Math.floor((Date.now() - new Date(date)) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function getPlaceholder(type) {
  switch (type) {
    case 'todo': return 'e.g. "Finalize Q3 roadmap with team input"';
    case 'done': return 'e.g. "Deployed staging fix for auth module"';
    case 'blocked': return 'e.g. "Waiting on finance team for pricing data"';
    case 'note': return 'e.g. "Call with Rajesh went well, he wants to move forward..."';
    default: return 'Dump what happened, what was promised, or what feels unresolved...';
  }
}

function getSubmitLabel(type) {
  switch (type) {
    case 'todo': return '📋 Add Todo';
    case 'done': return '✅ Mark Done';
    case 'blocked': return '🚫 Flag Blocker';
    case 'note': return '💬 Save Note';
    default: return '🧠 Capture & Extract';
  }
}
