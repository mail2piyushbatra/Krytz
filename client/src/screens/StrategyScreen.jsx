/** ✦ FLOWRA — Strategy Screen (v2)
 *
 * Live executive lens with ACTIONABLE intelligence:
 * - KPI strip + velocity bar
 * - Category health grid with drill-down (paginated)
 * - Top priority items WITH action buttons (done / snooze / unblock)
 * - Blockers spotlight with clear-blocker action
 * - Contradictions & commitments panels (from /intelligence)
 * - Capacity workload view (from /intelligence/capacity)
 * - Time estimation insights
 * - Week-over-week comparison
 */
import { useEffect, useState, useCallback } from 'react';
import { analytics, items, categories as catApi, intelligence, plan, actions } from '../services/api';
import { Card, MetricCard, Badge, ProgressRing, ActionBtn, PageLoader, EmptyState } from '../components/ui/UiKit';
import { RadarHealthChart } from '../components/ui/Charts';
import { Activity, AlertTriangle, CheckCircle, Clock, Zap } from 'lucide-react';
import './StrategyScreen.css';

export default function StrategyScreen() {
  const [loading, setLoading]           = useState(true);
  const [overview, setOverview]         = useState(null);
  const [openItems, setOpenItems]       = useState([]);
  const [completions, setCompletions]   = useState(null);
  const [prevWeekComps, setPrevWeekComps] = useState(null);
  const [cats, setCats]                 = useState([]);
  const [error, setError]               = useState(null);
  const [toast, setToast]               = useState(null);
  const [focusCat, setFocusCat]         = useState(null);
  const [catDetail, setCatDetail]       = useState(null);
  const [catLoading, setCatLoading]     = useState(false);
  const [catPage, setCatPage]           = useState(0);

  // Intelligence panels
  const [contradictions, setContradictions] = useState([]);
  const [commitments, setCommitments]       = useState([]);
  const [capacity, setCapacity]             = useState(null);
  const [estimationStats, setEstimationStats] = useState(null);

  // Active section toggle
  const [activePanel, setActivePanel] = useState(null); // 'contradictions' | 'commitments' | 'capacity' | 'estimates'

  const showToast = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  }, []);

  const loadData = useCallback(async () => {
    try {
      const [ov, itemsData, comps, prevComps, catsData] = await Promise.all([
        analytics.overview().catch(() => null),
        items.list({ state: 'OPEN', limit: 100 }).catch(() => ({ items: [] })),
        items.completions(7).catch(() => null),
        items.completions(14).catch(() => null),
        catApi.list().catch(() => ({ categories: [] })),
      ]);
      setOverview(ov);
      setOpenItems(itemsData?.items || []);
      setCompletions(comps);
      setPrevWeekComps(prevComps);
      setCats((catsData?.categories || []).filter(c => c.id));

      // Load intelligence data (non-blocking)
      Promise.all([
        intelligence.contradictions().catch(() => ({ contradictions: [] })),
        intelligence.commitments().catch(() => ({ commitments: [] })),
        plan.capacity().catch(() => null),
        intelligence.estimationStats().catch(() => null),
      ]).then(([contra, commit, cap, est]) => {
        setContradictions(contra?.contradictions || contra || []);
        setCommitments(commit?.commitments || commit || []);
        setCapacity(cap);
        setEstimationStats(est);
      });
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // ── Actions ───────────────────────────────────────────────
  async function handleMarkDone(itemId) {
    try {
      await items.markDone(itemId);
      showToast('✓ Marked done');
      loadData();
    } catch { showToast('Failed to mark done'); }
  }

  async function handleSnooze(itemId) {
    try {
      await actions.submit(itemId, 'snooze', 180);
      showToast('⏸ Snoozed for 3h');
      loadData();
    } catch { showToast('Failed to snooze'); }
  }

  async function handleUnblock(itemId) {
    try {
      await items.toggleBlocker(itemId, false);
      showToast('✓ Blocker cleared');
      loadData();
    } catch { showToast('Failed to clear blocker'); }
  }

  async function handleResolveContradiction(id) {
    try {
      await intelligence.resolveContradiction(id);
      showToast('✓ Contradiction resolved');
      setContradictions(prev => prev.filter(c => c.id !== id));
    } catch { showToast('Failed to resolve'); }
  }

  async function handleFulfillCommitment(id) {
    try {
      await intelligence.fulfillCommitment(id);
      showToast('✓ Commitment fulfilled');
      setCommitments(prev => prev.filter(c => c.id !== id));
    } catch { showToast('Failed to fulfill'); }
  }

  // ── Drill category ────────────────────────────────────────
  async function drillCat(catName) {
    if (focusCat === catName) { setFocusCat(null); setCatDetail(null); setCatPage(0); return; }
    setFocusCat(catName);
    setCatLoading(true);
    setCatPage(0);
    try {
      const d = await analytics.category(catName);
      setCatDetail(d);
    } catch { setCatDetail(null); }
    setCatLoading(false);
  }

  // ── Derived numbers ───────────────────────────────────────
  const blockers        = openItems.filter(i => i.blocker);
  const overdueItems    = openItems.filter(i => i.dueDate && new Date(i.dueDate) < new Date());
  const totalOpen       = openItems.length;
  const completedWeek   = completions?.totalCompleted ?? 0;
  const velocity        = totalOpen > 0 ? Math.round((completedWeek / Math.max(totalOpen + completedWeek, 1)) * 100) : 0;

  // Week-over-week delta
  const prevWeekCompleted = prevWeekComps ? (prevWeekComps.totalCompleted ?? 0) - completedWeek : 0;
  const weekDelta         = prevWeekCompleted > 0 ? completedWeek - prevWeekCompleted : null;

  // Items grouped by category for health grid
  const byCategory = {};
  for (const item of openItems) {
    const c = item.category || 'uncategorized';
    if (!byCategory[c]) byCategory[c] = { open: 0, blockers: 0 };
    byCategory[c].open++;
    if (item.blocker) byCategory[c].blockers++;
  }

  const healthRows = cats.map(cat => ({
    name: cat.name,
    color: cat.color,
    open: byCategory[cat.name]?.open ?? 0,
    blockers: byCategory[cat.name]?.blockers ?? 0,
  })).sort((a, b) => b.open - a.open || b.blockers - a.blockers);

  // Top-priority open items
  const topItems = [...openItems]
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0) || new Date(a.createdAt) - new Date(b.createdAt))
    .slice(0, 5);

  if (loading) return <PageLoader text="Building your overview..." />;

  return (
    <div className="strategy-screen page-container animate-fadeIn" id="strategy-screen">
      {toast && <div className="command-toast animate-slideUp">{toast}</div>}

      <p className="strategy-eyebrow">Your big picture</p>
      <h1 className="strategy-headline">Shape your week,<br />not just the task list.</h1>

      {error && <div className="command-error">{error}</div>}

      {/* ── KPI strip ─────────────────────────────────────── */}
      <div className="strategy-kpis-grid">
        <MetricCard 
          title="Open Items" 
          value={totalOpen} 
          icon={Activity} 
          intent="neutral" 
        />
        <MetricCard 
          title="Blockers" 
          value={blockers.length} 
          icon={AlertTriangle} 
          intent="warning" 
        />
        <MetricCard 
          title="Overdue" 
          value={overdueItems.length} 
          icon={Clock} 
          intent="negative" 
        />
        <MetricCard 
          title="Done This Week" 
          value={completedWeek} 
          icon={CheckCircle} 
          intent="positive" 
          trend={weekDelta >= 0 ? 'up' : 'down'}
          trendValue={`${Math.abs(weekDelta || 0)} vs last week`}
        />
        <MetricCard 
          title="Completion Rate" 
          value={`${velocity}%`} 
          icon={Zap} 
          intent="accent" 
        />
      </div>

      {/* ── Velocity bar ──────────────────────────────────── */}
      <div className="strategy-velocity-wrap">
        <div className="strategy-velocity-label">
          <span>Weekly flow</span>
          <span className="strategy-velocity-pct">{velocity}% throughput</span>
        </div>
        <div className="strategy-velocity-track">
          <div
            className="strategy-velocity-fill"
            style={{ width: `${Math.min(velocity, 100)}%` }}
          />
        </div>
      </div>

      {/* ── Intelligence panels toggle ────────────────────── */}
      <div className="strategy-intel-bar">
        <button
          className={`strategy-intel-btn ${activePanel === 'capacity' ? 'active' : ''}`}
          onClick={() => setActivePanel(activePanel === 'capacity' ? null : 'capacity')}
        >
          ⚡ Capacity {capacity?.capacity?.status && <span className={`strategy-intel-dot strategy-intel-${capacity.capacity.status}`} />}
        </button>
        <button
          className={`strategy-intel-btn ${activePanel === 'contradictions' ? 'active' : ''}`}
          onClick={() => setActivePanel(activePanel === 'contradictions' ? null : 'contradictions')}
        >
          ⚠ Conflicts {contradictions.length > 0 && <span className="strategy-intel-count">{contradictions.length}</span>}
        </button>
        <button
          className={`strategy-intel-btn ${activePanel === 'commitments' ? 'active' : ''}`}
          onClick={() => setActivePanel(activePanel === 'commitments' ? null : 'commitments')}
        >
          🤝 Commitments {commitments.length > 0 && <span className="strategy-intel-count">{commitments.length}</span>}
        </button>
        <button
          className={`strategy-intel-btn ${activePanel === 'estimates' ? 'active' : ''}`}
          onClick={() => setActivePanel(activePanel === 'estimates' ? null : 'estimates')}
        >
          ⏱ Estimates
        </button>
      </div>

      {/* ── Capacity Panel ────────────────────────────────── */}
      {activePanel === 'capacity' && capacity && (
        <Card className="strategy-panel animate-fadeIn">
          <div className="strategy-panel-header">
            <h3>How busy are you?</h3>
            <Badge intent={capacity.capacity?.status === 'overloaded' ? 'negative' : 'positive'}>
              {capacity.capacity?.status || 'Unknown'}
            </Badge>
          </div>
          
          <div className="strategy-panel-content-flex">
            <div className="strategy-panel-ring">
              <ProgressRing 
                percentage={capacity.capacity?.capacityRatio != null ? Math.round(capacity.capacity.capacityRatio * 100) : 0} 
                size={140} 
                strokeWidth={12}
                label={`${capacity.capacity?.capacityRatio != null ? Math.round(capacity.capacity.capacityRatio * 100) : 0}%`}
                sublabel="Used"
                color={capacity.capacity?.status === 'overloaded' ? 'var(--danger)' : 'var(--accent-primary)'}
              />
            </div>
            
            <div className="strategy-panel-grid-flex">
              <div className="strategy-panel-stat">
                <span className="strategy-panel-stat-val">{capacity.capacity?.openItems ?? '—'}</span>
                <span className="strategy-panel-stat-lbl">Open items</span>
              </div>
              <div className="strategy-panel-stat">
                <span className="strategy-panel-stat-val">{capacity.streak?.current ?? '—'}</span>
                <span className="strategy-panel-stat-lbl">Day streak</span>
              </div>
              <div className="strategy-panel-stat">
                <span className={`strategy-panel-stat-val ${capacity.burnout?.risk === 'high' ? 'strategy-danger-val' : ''}`}>
                  {capacity.burnout?.risk || '—'}
                </span>
                <span className="strategy-panel-stat-lbl">Workload level</span>
              </div>
            </div>
          </div>
          
          {capacity.capacity?.insight && <p className="strategy-panel-insight">{capacity.capacity.insight}</p>}
          {capacity.recommendation && <p className="strategy-panel-rec">💡 {capacity.recommendation}</p>}
          {capacity.burnout?.signals?.length > 0 && (
            <div className="strategy-panel-signals">
              {capacity.burnout.signals.map((s, i) => <Badge key={i} intent="warning">⚠ {s}</Badge>)}
            </div>
          )}
        </Card>
      )}

      {/* ── Contradictions Panel ──────────────────────────── */}
      {activePanel === 'contradictions' && (
        <div className="strategy-panel animate-fadeIn">
          <div className="strategy-panel-header">
            <h3>Potential Conflicts</h3>
            <span className="strategy-panel-count">{contradictions.length}</span>
          </div>
          {contradictions.length === 0 ? (
            <p className="strategy-panel-empty">No conflicts detected — your plan is consistent.</p>
          ) : contradictions.map(c => (
            <div key={c.id} className={`strategy-contradiction-card strategy-sev-${c.severity || 'medium'}`}>
              <div className="strategy-contradiction-type">{c.type?.replace(/_/g, ' ')}</div>
              <p className="strategy-contradiction-msg">{c.message}</p>
              <ActionBtn 
                className="strategy-action-btn strategy-action-resolve" 
                onClick={() => handleResolveContradiction(c.id)}
                variant="ghost"
              >
                Resolve
              </ActionBtn>
            </div>
          ))}
        </div>
      )}

      {/* ── Commitments Panel ─────────────────────────────── */}
      {activePanel === 'commitments' && (
        <div className="strategy-panel animate-fadeIn">
          <div className="strategy-panel-header">
            <h3>Promises You've Made</h3>
            <span className="strategy-panel-count">{commitments.length}</span>
          </div>
          {commitments.length === 0 ? (
            <p className="strategy-panel-empty">No active commitments right now.</p>
          ) : commitments.map(c => (
            <div key={c.id} className={`strategy-commitment-card ${c.urgency === 'overdue' ? 'strategy-commitment-overdue' : ''}`}>
              <div className="strategy-commitment-body">
                <span className="strategy-commitment-text">{c.commitment_text}</span>
                <div className="strategy-commitment-meta">
                  {c.counterparty_name && <span className="badge badge-tag">→ {c.counterparty_name}</span>}
                  {c.due_date && (
                    <span className={`badge ${c.urgency === 'overdue' ? 'badge-action' : c.urgency === 'due_soon' ? 'badge-deadline' : 'badge-tag'}`}>
                      {new Date(c.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </span>
                  )}
                  {c.urgency && <span className={`strategy-urgency-tag strategy-urgency-${c.urgency}`}>{c.urgency.replace('_', ' ')}</span>}
                </div>
              </div>
              <ActionBtn 
                className="strategy-action-btn strategy-action-done" 
                onClick={() => handleFulfillCommitment(c.id)}
                variant="ghost"
              >
                Fulfill
              </ActionBtn>
            </div>
          ))}
        </div>
      )}

      {/* ── Estimation Stats Panel ────────────────────────── */}
      {activePanel === 'estimates' && (
        <div className="strategy-panel animate-fadeIn">
          <div className="strategy-panel-header">
            <h3>How accurate are your time estimates?</h3>
          </div>
          {!estimationStats || estimationStats.totalTasks === 0 ? (
            <p className="strategy-panel-empty">Not enough completed tasks with time data yet. Complete tasks and record actual times to see insights.</p>
          ) : (
            <>
              <div className="strategy-panel-grid">
                <div className="strategy-panel-stat">
                  <span className="strategy-panel-stat-val">{estimationStats.totalTasks}</span>
                  <span className="strategy-panel-stat-lbl">Tasks measured</span>
                </div>
                <div className="strategy-panel-stat">
                  <span className="strategy-panel-stat-val">{estimationStats.avgEstimateMins}m</span>
                  <span className="strategy-panel-stat-lbl">Avg. estimated</span>
                </div>
                <div className="strategy-panel-stat">
                  <span className="strategy-panel-stat-val">{estimationStats.avgActualMins}m</span>
                  <span className="strategy-panel-stat-lbl">Avg. actual</span>
                </div>
                <div className="strategy-panel-stat">
                  <span className="strategy-panel-stat-val">{estimationStats.accuracyRatio}x</span>
                  <span className="strategy-panel-stat-lbl">Estimate accuracy</span>
                </div>
              </div>
              <p className="strategy-panel-insight">{estimationStats.insight}</p>
              {estimationStats.biasLabel && <p className="strategy-panel-rec">📊 {estimationStats.biasLabel}</p>}
            </>
          )}
        </div>
      )}

      {/* ── Category health grid & Radar Chart ───────────────── */}
      <div className="section-title" style={{ marginBottom: 'var(--space-4)', marginTop: 'var(--space-4)' }}>
        Category Health
      </div>
      
      {healthRows.length > 2 && (
        <Card className="strategy-radar-card" style={{ marginBottom: 'var(--space-6)' }}>
          <RadarHealthChart 
            data={healthRows.map(r => ({ subject: r.name, value: r.open > 0 ? (r.blockers > 0 ? 50 : 100) : 0 }))} 
            height={280} 
          />
        </Card>
      )}

      <div className="strategy-health-grid">
        {healthRows.length === 0 ? (
          <div className="strategy-empty">No categories yet — add them in Settings.</div>
        ) : healthRows.map(cat => {
          const status = cat.blockers > 0 ? 'at-risk' : cat.open > 5 ? 'heavy' : cat.open > 0 ? 'active' : 'clear';
          const isOpen = focusCat === cat.name;
          const ITEMS_PER_PAGE = 5;
          const drillItems = catDetail?.topItems || [];
          const pagedItems = drillItems.slice(catPage * ITEMS_PER_PAGE, (catPage + 1) * ITEMS_PER_PAGE);
          const totalPages = Math.ceil(drillItems.length / ITEMS_PER_PAGE);
          return (
            <div
              key={cat.name}
              className={`strategy-health-card strategy-health-${status} ${isOpen ? 'strategy-health-open' : ''}`}
              style={{ '--cat-color': cat.color || 'var(--text-tertiary)' }}
              onClick={() => drillCat(cat.name)}
            >
              <div className="strategy-health-header">
                <span className="strategy-cat-dot" style={{ background: cat.color }} />
                <span className="strategy-health-name">{cat.name}</span>
                <span className={`strategy-health-tag strategy-tag-${status}`}>
                  {status === 'at-risk' ? '⚠ Blocked' : status === 'heavy' ? '● Loaded' : status === 'active' ? '✓ Active' : '— Clear'}
                </span>
              </div>
              <div className="strategy-health-stats">
                <span>{cat.open} open</span>
                {cat.blockers > 0 && <span className="strategy-blocked-count">{cat.blockers} blocked</span>}
              </div>

              {/* Drill-down panel with pagination */}
              {isOpen && (
                <div className="strategy-drill" onClick={e => e.stopPropagation()}>
                  {catLoading ? (
                    <div className="strategy-drill-loading">
                      <span className="spinner" /> Loading…
                    </div>
                  ) : catDetail ? (
                    <>
                      <div className="strategy-drill-row">
                        <span>Avg completion</span>
                        <strong>{catDetail.avgCompletionDays != null ? `${catDetail.avgCompletionDays.toFixed(1)} days` : '—'}</strong>
                      </div>
                      <div className="strategy-drill-row">
                        <span>Completed (30d)</span>
                        <strong>{catDetail.completedLast30 ?? '—'}</strong>
                      </div>
                      {pagedItems.map((it, i) => (
                        <div key={i} className="strategy-drill-item">
                          <span className="strategy-drill-bullet">›</span>
                          <span className="strategy-drill-item-text">{it.text || it.canonical_text}</span>
                          <button className="strategy-drill-done-btn" onClick={() => handleMarkDone(it.id)} title="Mark done">✓</button>
                        </div>
                      ))}
                      {totalPages > 1 && (
                        <div className="strategy-drill-pagination">
                          <button disabled={catPage === 0} onClick={() => setCatPage(p => p - 1)}>‹</button>
                          <span>{catPage + 1} / {totalPages}</span>
                          <button disabled={catPage >= totalPages - 1} onClick={() => setCatPage(p => p + 1)}>›</button>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="strategy-drill-empty">No analytics yet for this category.</div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Top 5 priority items WITH ACTIONS ────────────── */}
      {topItems.length > 0 && (
        <>
          <div className="section-title" style={{ margin: 'var(--space-6) 0 var(--space-4)' }}>
            Highest Priority Open Items
          </div>
          <div className="strategy-top-items">
            {topItems.map((item, i) => (
              <div key={item.id} className="strategy-top-item">
                <span className="strategy-top-rank">#{i + 1}</span>
                <div className="strategy-top-body">
                  <span className="strategy-top-text">{item.text || item.canonical_text}</span>
                  <div className="strategy-top-meta">
                    {item.category && (
                      <span className="badge badge-tag">{item.category}</span>
                    )}
                    {item.blocker && <span className="badge badge-blocker">Blocked</span>}
                    {item.dueDate && (
                      <span className={`badge ${new Date(item.dueDate) < new Date() ? 'badge-action' : 'badge-deadline'}`}>
                        {new Date(item.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </span>
                    )}
                    {item.estimated_mins && (
                      <span className="badge badge-estimate">~{item.estimated_mins}m</span>
                    )}
                  </div>
                </div>
                <div className="strategy-top-actions">
                  <ActionBtn className="strategy-action-btn strategy-action-done" onClick={() => handleMarkDone(item.id)} variant="ghost" title="Done">✓</ActionBtn>
                  <ActionBtn className="strategy-action-btn strategy-action-snooze" onClick={() => handleSnooze(item.id)} variant="ghost" title="Snooze 3h">⏸</ActionBtn>
                </div>
                {typeof item.priority === 'number' && (
                  <span className="strategy-priority-bar">
                    <span style={{ width: `${Math.round(item.priority * 100)}%` }} />
                  </span>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {/* ── Blockers spotlight WITH ACTIONS ────────────────── */}
      {blockers.length > 0 && (
        <>
          <div className="section-title" style={{ margin: 'var(--space-6) 0 var(--space-4)' }}>
            Active Blockers
          </div>
          <div className="strategy-blockers">
            {blockers.slice(0, 6).map(b => (
              <div key={b.id} className="strategy-blocker-item">
                <span className="strategy-blocker-icon">⚠</span>
                <div className="strategy-blocker-body">
                  <span className="strategy-blocker-text">{b.text || b.canonical_text}</span>
                  {b.category && <span className="badge badge-tag" style={{ marginLeft: 6 }}>{b.category}</span>}
                </div>
                <ActionBtn className="strategy-action-btn strategy-action-resolve" onClick={() => handleUnblock(b.id)} variant="ghost" title="Clear blocker">
                  Unblock
                </ActionBtn>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

