/** âœ¦ Krytz â€” Strategy Screen (v2)
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
import { Card, MetricCard, Badge, ProgressRing, ActionBtn, PageLoader } from '../components/ui/UiKit';
import { RadarHealthChart } from '../components/ui/Charts';
import { Activity, AlertTriangle, Brain, CheckCircle, Clock, GitBranch, Zap } from 'lucide-react';
import './StrategyScreen.css';

export default function StrategyScreen() {
  const [loading, setLoading]           = useState(true);
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
  const [taskGraph, setTaskGraph]           = useState(null);
  const [weeklyMemory, setWeeklyMemory]     = useState(null);

  // Active section toggle
  const [activePanel, setActivePanel] = useState(null); // 'contradictions' | 'commitments' | 'capacity' | 'estimates' | 'graph' | 'memory'

  const showToast = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  }, []);

  const loadData = useCallback(async () => {
    try {
      const [itemsData, comps, prevComps, catsData] = await Promise.all([
        items.list({ state: 'OPEN', limit: 100 }).catch(() => ({ items: [] })),
        items.completions(7).catch(() => null),
        items.completions(14).catch(() => null),
        catApi.list().catch(() => ({ categories: [] })),
      ]);
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
        intelligence.taskGraph(36).catch(() => null),
        intelligence.weeklyMemory(7, 18).catch(() => null),
      ]).then(([contra, commit, cap, est, graph, memory]) => {
        setContradictions(contra?.contradictions || contra || []);
        setCommitments(commit?.commitments || commit || []);
        setCapacity(cap);
        setEstimationStats(est);
        setTaskGraph(graph);
        setWeeklyMemory(memory);
      });
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => { loadData(); }, 0);
    return () => clearTimeout(timer);
  }, [loadData]);

  // â”€â”€ Actions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  async function handleMarkDone(itemId) {
    try {
      await items.markDone(itemId);
      showToast('âœ“ Marked done');
      loadData();
    } catch { showToast('Failed to mark done'); }
  }

  async function handleSnooze(itemId) {
    try {
      await actions.submit(itemId, 'snooze', 180);
      showToast('â¸ Snoozed for 3h');
      loadData();
    } catch { showToast('Failed to snooze'); }
  }

  async function handleUnblock(itemId) {
    try {
      await items.toggleBlocker(itemId, false);
      showToast('âœ“ Blocker cleared');
      loadData();
    } catch { showToast('Failed to clear blocker'); }
  }

  async function handleResolveContradiction(id) {
    try {
      await intelligence.resolveContradiction(id);
      showToast('âœ“ Contradiction resolved');
      setContradictions(prev => prev.filter(c => c.id !== id));
    } catch { showToast('Failed to resolve'); }
  }

  async function handleFulfillCommitment(id) {
    try {
      await intelligence.fulfillCommitment(id);
      showToast('âœ“ Commitment fulfilled');
      setCommitments(prev => prev.filter(c => c.id !== id));
    } catch { showToast('Failed to fulfill'); }
  }

  // â”€â”€ Drill category â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

  // â”€â”€ Derived numbers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

      {/* â”€â”€ KPI strip â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
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

      {/* â”€â”€ Velocity bar â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
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

      {/* â”€â”€ Intelligence panels toggle â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      <div className="strategy-intel-bar">
        <button
          className={`strategy-intel-btn ${activePanel === 'capacity' ? 'active' : ''}`}
          onClick={() => setActivePanel(activePanel === 'capacity' ? null : 'capacity')}
        >
          <Zap size={14} /> Capacity {capacity?.capacity?.status && <span className={`strategy-intel-dot strategy-intel-${capacity.capacity.status}`} />}
        </button>
        <button
          className={`strategy-intel-btn ${activePanel === 'graph' ? 'active' : ''}`}
          onClick={() => setActivePanel(activePanel === 'graph' ? null : 'graph')}
        >
          <GitBranch size={14} /> Task Graph {taskGraph?.stats?.edgeCount > 0 && <span className="strategy-intel-count">{taskGraph.stats.edgeCount}</span>}
        </button>
        <button
          className={`strategy-intel-btn ${activePanel === 'memory' ? 'active' : ''}`}
          onClick={() => setActivePanel(activePanel === 'memory' ? null : 'memory')}
        >
          <Brain size={14} /> Weekly Memory {weeklyMemory?.evidence?.length > 0 && <span className="strategy-intel-count">{weeklyMemory.evidence.length}</span>}
        </button>
        <button
          className={`strategy-intel-btn ${activePanel === 'contradictions' ? 'active' : ''}`}
          onClick={() => setActivePanel(activePanel === 'contradictions' ? null : 'contradictions')}
        >
          <AlertTriangle size={14} /> Conflicts {contradictions.length > 0 && <span className="strategy-intel-count">{contradictions.length}</span>}
        </button>
        <button
          className={`strategy-intel-btn ${activePanel === 'commitments' ? 'active' : ''}`}
          onClick={() => setActivePanel(activePanel === 'commitments' ? null : 'commitments')}
        >
          <CheckCircle size={14} /> Commitments {commitments.length > 0 && <span className="strategy-intel-count">{commitments.length}</span>}
        </button>
        <button
          className={`strategy-intel-btn ${activePanel === 'estimates' ? 'active' : ''}`}
          onClick={() => setActivePanel(activePanel === 'estimates' ? null : 'estimates')}
        >
          <Clock size={14} /> Estimates
        </button>
      </div>

      {/* â”€â”€ Capacity Panel â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
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
                percentage={capacity.capacity?.capacityRatio !== null && capacity.capacity?.capacityRatio !== undefined ? Math.round(capacity.capacity.capacityRatio * 100) : 0}
                size={140}
                strokeWidth={12}
                label={`${capacity.capacity?.capacityRatio !== null && capacity.capacity?.capacityRatio !== undefined ? Math.round(capacity.capacity.capacityRatio * 100) : 0}%`}
                sublabel="Used"
                color={capacity.capacity?.status === 'overloaded' ? 'var(--danger)' : 'var(--accent-primary)'}
              />
            </div>
            
            <div className="strategy-panel-grid-flex">
              <div className="strategy-panel-stat">
                <span className="strategy-panel-stat-val">{capacity.capacity?.openItems ?? 'â€”'}</span>
                <span className="strategy-panel-stat-lbl">Open items</span>
              </div>
              <div className="strategy-panel-stat">
                <span className="strategy-panel-stat-val">{capacity.streak?.current ?? 'â€”'}</span>
                <span className="strategy-panel-stat-lbl">Day streak</span>
              </div>
              <div className="strategy-panel-stat">
                <span className={`strategy-panel-stat-val ${capacity.burnout?.risk === 'high' ? 'strategy-danger-val' : ''}`}>
                  {capacity.burnout?.risk || 'â€”'}
                </span>
                <span className="strategy-panel-stat-lbl">Workload level</span>
              </div>
            </div>
          </div>
          
          {capacity.capacity?.insight && <p className="strategy-panel-insight">{capacity.capacity.insight}</p>}
          {capacity.recommendation && <p className="strategy-panel-rec">{capacity.recommendation}</p>}
          {capacity.burnout?.signals?.length > 0 && (
            <div className="strategy-panel-signals">
              {capacity.burnout.signals.map((s, i) => <Badge key={i} intent="warning">{s}</Badge>)}
            </div>
          )}
        </Card>
      )}

      {/* â”€â”€ Contradictions Panel â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      {activePanel === 'graph' && (
        <TaskGraphPanel graph={taskGraph} />
      )}

      {activePanel === 'memory' && (
        <WeeklyMemoryPanel insight={weeklyMemory} />
      )}

      {activePanel === 'contradictions' && (
        <div className="strategy-panel animate-fadeIn">
          <div className="strategy-panel-header">
            <h3>Potential Conflicts</h3>
            <span className="strategy-panel-count">{contradictions.length}</span>
          </div>
          {contradictions.length === 0 ? (
            <p className="strategy-panel-empty">No conflicts detected â€” your plan is consistent.</p>
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

      {/* â”€â”€ Commitments Panel â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
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
                  {c.counterparty_name && <span className="badge badge-tag">â†’ {c.counterparty_name}</span>}
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

      {/* â”€â”€ Estimation Stats Panel â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
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
              {estimationStats.biasLabel && <p className="strategy-panel-rec">ðŸ“Š {estimationStats.biasLabel}</p>}
            </>
          )}
        </div>
      )}

      {/* â”€â”€ Category health grid & Radar Chart â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
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
          <div className="strategy-empty">No categories yet â€” add them in Settings.</div>
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
                  {status === 'at-risk' ? 'âš  Blocked' : status === 'heavy' ? 'â— Loaded' : status === 'active' ? 'âœ“ Active' : 'â€” Clear'}
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
                      <span className="spinner" /> Loadingâ€¦
                    </div>
                  ) : catDetail ? (
                    <>
                      <div className="strategy-drill-row">
                        <span>Avg completion</span>
                        <strong>{catDetail.avgCompletionDays !== null && catDetail.avgCompletionDays !== undefined ? `${catDetail.avgCompletionDays.toFixed(1)} days` : 'â€”'}</strong>
                      </div>
                      <div className="strategy-drill-row">
                        <span>Completed (30d)</span>
                        <strong>{catDetail.completedLast30 ?? 'â€”'}</strong>
                      </div>
                      {pagedItems.map((it, i) => (
                        <div key={i} className="strategy-drill-item">
                          <span className="strategy-drill-bullet">â€º</span>
                          <span className="strategy-drill-item-text">{it.text || it.canonical_text}</span>
                          <button className="strategy-drill-done-btn" onClick={() => handleMarkDone(it.id)} title="Mark done">âœ“</button>
                        </div>
                      ))}
                      {totalPages > 1 && (
                        <div className="strategy-drill-pagination">
                          <button disabled={catPage === 0} onClick={() => setCatPage(p => p - 1)}>â€¹</button>
                          <span>{catPage + 1} / {totalPages}</span>
                          <button disabled={catPage >= totalPages - 1} onClick={() => setCatPage(p => p + 1)}>â€º</button>
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

      {/* â”€â”€ Top 5 priority items WITH ACTIONS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
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
                  <ActionBtn className="strategy-action-btn strategy-action-done" onClick={() => handleMarkDone(item.id)} variant="ghost" title="Done">âœ“</ActionBtn>
                  <ActionBtn className="strategy-action-btn strategy-action-snooze" onClick={() => handleSnooze(item.id)} variant="ghost" title="Snooze 3h">â¸</ActionBtn>
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

      {/* â”€â”€ Blockers spotlight WITH ACTIONS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      {blockers.length > 0 && (
        <>
          <div className="section-title" style={{ margin: 'var(--space-6) 0 var(--space-4)' }}>
            Active Blockers
          </div>
          <div className="strategy-blockers">
            {blockers.slice(0, 6).map(b => (
              <div key={b.id} className="strategy-blocker-item">
                <span className="strategy-blocker-icon"><AlertTriangle size={14} /></span>
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

function TaskGraphPanel({ graph }) {
  const nodes = (graph?.nodes || []).slice(0, 24);
  const edges = graph?.edges || [];
  const layout = buildGraphLayout(nodes);
  const positions = new Map(layout.map(node => [node.id, node]));
  const visibleEdges = edges.filter(edge => positions.has(edge.source) && positions.has(edge.target)).slice(0, 48);

  return (
    <div className="strategy-panel animate-fadeIn strategy-graph-panel">
      <div className="strategy-panel-header">
        <h3>Task State Graph</h3>
        <span className="strategy-panel-count">{graph?.stats?.nodeCount || 0} items</span>
      </div>

      {!graph ? (
        <p className="strategy-panel-empty">Task graph is not available yet.</p>
      ) : nodes.length === 0 ? (
        <p className="strategy-panel-empty">No active graph nodes yet. Add connected tasks to build the network.</p>
      ) : (
        <div className="strategy-graph-layout">
          <div className="strategy-graph-canvas">
            <svg className="strategy-graph-svg" viewBox="0 0 900 360" role="img" aria-label="Task dependency graph">
              <defs>
                <marker id="strategy-graph-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" />
                </marker>
              </defs>
              {visibleEdges.map(edge => {
                const source = positions.get(edge.source);
                const target = positions.get(edge.target);
                const midX = (source.x + target.x) / 2;
                const midY = (source.y + target.y) / 2;
                return (
                  <g key={edge.id || `${edge.source}-${edge.target}`} className="strategy-graph-edge">
                    <line x1={source.x} y1={source.y} x2={target.x} y2={target.y} markerEnd="url(#strategy-graph-arrow)" />
                    <text x={midX} y={midY - 5}>{edge.label}</text>
                  </g>
                );
              })}
              {layout.map(node => (
                <g
                  key={node.id}
                  className={`strategy-graph-node ${node.blocker ? 'strategy-graph-node--blocked' : ''}`}
                  transform={`translate(${node.x} ${node.y})`}
                >
                  <circle r={node.blocker ? 18 : 16} />
                  <text className="strategy-graph-node-label" y={34}>{truncate(node.label, 18)}</text>
                  <title>{node.label}</title>
                </g>
              ))}
            </svg>
          </div>

          <div className="strategy-graph-sidebar">
            <div className="strategy-graph-stat-row"><span>Edges</span><strong>{graph.stats?.edgeCount || 0}</strong></div>
            <div className="strategy-graph-stat-row"><span>Connected</span><strong>{graph.stats?.connectedNodeCount || 0}</strong></div>
            <div className="strategy-graph-stat-row"><span>Blocked</span><strong>{graph.stats?.blockerCount || 0}</strong></div>
            <div className="strategy-graph-stat-row"><span>Groups</span><strong>{graph.stats?.categoryCount || 0}</strong></div>

            <div className="strategy-bottleneck-list">
              <span className="strategy-mini-heading">Bottlenecks</span>
              {(graph.bottlenecks || []).length === 0 ? (
                <span className="strategy-muted-line">No dependency bottlenecks found.</span>
              ) : graph.bottlenecks.map(node => (
                <div key={node.id} className="strategy-bottleneck-item">
                  <span>{truncate(node.label, 58)}</span>
                  <small>{node.outgoing || 0} outgoing</small>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function WeeklyMemoryPanel({ insight }) {
  const themes = insight?.themes || [];
  const risks = insight?.risks || [];
  const suggestedFocus = insight?.suggestedFocus || [];
  const evidence = insight?.evidence || [];
  const counts = insight?.sourceCounts || {};

  return (
    <div className="strategy-panel animate-fadeIn strategy-memory-panel">
      <div className="strategy-panel-header">
        <h3>Weekly Memory RAG</h3>
        <span className="strategy-panel-count">{insight?.mode || 'pending'}</span>
      </div>

      {!insight ? (
        <p className="strategy-panel-empty">Weekly memory insight is not available yet.</p>
      ) : (
        <div className="strategy-memory-grid">
          <div className="strategy-memory-summary">
            <span className="strategy-mini-heading">Synthesis</span>
            <p>{insight.summary}</p>
            <div className="strategy-memory-sources">
              <span>Entries: {counts.entries || 0}</span>
              <span>Episodic: {counts.episodic || 0}</span>
              <span>Semantic: {counts.semantic || 0}</span>
              <span>Items: {counts.activeItems || 0}</span>
            </div>
          </div>

          <div className="strategy-memory-columns">
            <MemoryList title="Themes" items={themes} empty="No recurring themes found." />
            <MemoryList title="Risks" items={risks} empty="No memory-backed risks found." />
            <MemoryList title="Suggested Focus" items={suggestedFocus} empty="No focus recommendation yet." />
          </div>

          <div className="strategy-memory-evidence">
            <span className="strategy-mini-heading">Retrieved Evidence</span>
            {evidence.length === 0 ? (
              <span className="strategy-muted-line">No retrieved evidence in this window.</span>
            ) : evidence.map(item => (
              <div key={`${item.type}-${item.id}`} className="strategy-memory-evidence-item">
                <div>
                  <strong>{item.type}</strong>
                  {item.label && <span>{item.label}</span>}
                </div>
                <p>{item.snippet}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function MemoryList({ title, items, empty }) {
  return (
    <div className="strategy-memory-list">
      <span className="strategy-mini-heading">{title}</span>
      {items.length === 0 ? (
        <span className="strategy-muted-line">{empty}</span>
      ) : items.map((item, index) => (
        <div key={`${title}-${index}`} className="strategy-memory-item">{item}</div>
      ))}
    </div>
  );
}

function buildGraphLayout(nodes) {
  const width = 900;
  const height = 360;
  const columns = Math.min(6, Math.max(1, Math.ceil(Math.sqrt(nodes.length * 1.6))));
  const rows = Math.max(1, Math.ceil(nodes.length / columns));
  const xGap = width / (columns + 1);
  const yGap = height / (rows + 1);

  return nodes.map((node, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    return {
      ...node,
      x: Math.round(xGap * (column + 1)),
      y: Math.round(yGap * (row + 1)),
    };
  });
}

function truncate(value, max = 80) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}

