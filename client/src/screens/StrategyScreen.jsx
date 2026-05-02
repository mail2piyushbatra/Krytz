/** ✦ Krytz — Strategy Screen (v2)
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
import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
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
          {capacity.recommendation && <p className="strategy-panel-rec">{capacity.recommendation}</p>}
          {capacity.burnout?.signals?.length > 0 && (
            <div className="strategy-panel-signals">
              {capacity.burnout.signals.map((s, i) => <Badge key={i} intent="warning">{s}</Badge>)}
            </div>
          )}
        </Card>
      )}

      {/* ── Contradictions Panel ──────────────────────────── */}
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
                        <strong>{catDetail.avgCompletionDays !== null && catDetail.avgCompletionDays !== undefined ? `${catDetail.avgCompletionDays.toFixed(1)} days` : '—'}</strong>
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
  const forceGraph = useMemo(() => buildCanvasForceGraph(graph, { nodeLimit: 36, edgeLimit: 72 }), [graph]);
  const [selectedNode, setSelectedNode] = useState(null);

  return (
    <div className="strategy-panel animate-fadeIn strategy-graph-panel">
      <div className="strategy-panel-header">
        <h3>Task State Graph</h3>
        <span className="strategy-panel-count">{graph?.stats?.nodeCount || 0} items</span>
      </div>

      {!graph ? (
        <p className="strategy-panel-empty">Task graph is not available yet.</p>
      ) : forceGraph.nodes.length === 0 ? (
        <p className="strategy-panel-empty">No active graph nodes yet. Add connected tasks to build the network.</p>
      ) : (
        <div className="strategy-graph-stack">
          <div className="strategy-graph-summary">
            <div className="strategy-graph-stat-row"><span>Edges</span><strong>{graph.stats?.edgeCount || 0}</strong></div>
            <div className="strategy-graph-stat-row"><span>Connected</span><strong>{graph.stats?.connectedNodeCount || 0}</strong></div>
            <div className="strategy-graph-stat-row"><span>Blocked</span><strong>{graph.stats?.blockerCount || 0}</strong></div>
            <div className="strategy-graph-stat-row"><span>Groups</span><strong>{graph.stats?.categoryCount || 0}</strong></div>
          </div>

          <CanvasForceGraph
            graph={forceGraph}
            selectedNode={selectedNode}
            onNodeClick={setSelectedNode}
          />

          {selectedNode && (
            <div className="strategy-force-selection">
              <strong>{selectedNode.id}</strong>
              <span>{selectedNode.kind}</span>
            </div>
          )}

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

function CanvasForceGraph({ graph, selectedNode, onNodeClick }) {
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const hitRef = useRef({ nodes: [], links: [] });

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    const rect = wrap.getBoundingClientRect();
    const width = Math.max(320, Math.round(rect.width));
    const height = Math.max(420, Math.round(rect.height));
    const dpr = window.devicePixelRatio || 1;

    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const hit = drawCanvasForceGraph(ctx, graph, {
      width,
      height,
      selectedNodeId: selectedNode?.key,
    });
    hitRef.current = hit;
  }, [graph, selectedNode]);

  useEffect(() => {
    draw();
    const wrap = wrapRef.current;
    if (!wrap || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(draw);
    observer.observe(wrap);
    return () => observer.disconnect();
  }, [draw]);

  const handleClick = useCallback((event) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const point = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };

    const clickedNode = [...hitRef.current.nodes]
      .reverse()
      .find(node => distance(point, node) <= node.radius + 6);

    if (clickedNode) {
      onNodeClick?.(clickedNode.raw);
      return;
    }

    const clickedLink = hitRef.current.links.find(link => distanceToSegment(point, link.source, link.target) < 7);
    if (clickedLink) onNodeClick?.(clickedLink.raw.targetNode || clickedLink.raw.sourceNode);
  }, [onNodeClick]);

  const handleMove = useCallback((event) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const point = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
    const overNode = hitRef.current.nodes.some(node => distance(point, node) <= node.radius + 6);
    canvas.style.cursor = overNode ? 'pointer' : 'grab';
  }, []);

  return (
    <div className="strategy-graph-canvas" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        className="strategy-force-canvas"
        aria-label="Task force graph"
        role="img"
        onClick={handleClick}
        onMouseMove={handleMove}
      />
    </div>
  );
}

function buildCanvasForceGraph(graph, { nodeLimit = 36, edgeLimit = 72 } = {}) {
  const taskNodes = (graph?.nodes || []).slice(0, nodeLimit);
  const taskIds = new Set(taskNodes.map(node => node.id));
  const dependencies = (graph?.edges || [])
    .filter(edge => taskIds.has(edge.source) && taskIds.has(edge.target))
    .slice(0, edgeLimit);
  const degree = new Map(taskNodes.map(node => [node.id, 0]));
  dependencies.forEach(edge => {
    degree.set(edge.source, (degree.get(edge.source) || 0) + 1);
    degree.set(edge.target, (degree.get(edge.target) || 0) + 1);
  });

  const grouped = new Map();
  taskNodes.forEach(node => {
    const group = node.category || 'uncategorized';
    if (!grouped.has(group)) grouped.set(group, []);
    grouped.get(group).push(node);
  });

  const categories = [...grouped.keys()].sort((a, b) => a.localeCompare(b));
  const nodes = [{
    key: 'root-user',
    id: 'You',
    group: 'user',
    kind: 'user',
    val: 15,
    color: '#1f2937',
    ring: 0,
    angle: -Math.PI / 2,
    depth: 1,
  }];
  const links = [];

  categories.forEach((category, index) => {
    const color = pickCanvasColor(category);
    const angle = categoryAngle(index, categories.length);
    const categoryKey = `category-${slugify(category)}`;
    const categoryTasks = grouped.get(category) || [];

    nodes.push({
      key: categoryKey,
      id: category,
      group: category,
      kind: 'category',
      val: 8 + categoryTasks.length,
      color,
      ring: 1,
      angle,
      depth: Math.sin(angle),
    });

    links.push({
      source: 'root-user',
      target: categoryKey,
      value: category,
      kind: 'hierarchy',
      color: 'rgba(100, 116, 139, 0.48)',
    });

    const spread = Math.min(Math.PI / 1.8, 0.34 * Math.max(categoryTasks.length - 1, 1));
    categoryTasks
      .sort((a, b) => String(a.label || '').localeCompare(String(b.label || '')))
      .forEach((task, taskIndex) => {
        const offset = categoryTasks.length === 1
          ? 0
          : -spread / 2 + (spread * (taskIndex / Math.max(categoryTasks.length - 1, 1)));
        const taskAngle = angle + offset;
        const taskKey = task.id;
        const blocked = Boolean(task.blocker);

        nodes.push({
          key: taskKey,
          id: task.label || task.title || task.id,
          group: category,
          kind: 'task',
          val: 4 + (degree.get(task.id) || 0) + (blocked ? 2 : 0),
          color: blocked ? '#fb923c' : color,
          ring: 2,
          angle: taskAngle,
          depth: Math.sin(taskAngle),
          state: task.state || 'OPEN',
          blocker: blocked,
        });

        links.push({
          source: categoryKey,
          target: taskKey,
          value: 'owns',
          kind: 'hierarchy',
          color: colorToRgba(blocked ? '#fb923c' : color, 0.46),
        });
      });
  });

  dependencies.forEach(edge => {
    const sourceNode = nodes.find(node => node.key === edge.source);
    const targetNode = nodes.find(node => node.key === edge.target);
    if (!sourceNode || !targetNode) return;
    links.push({
      source: edge.source,
      target: edge.target,
      value: edge.label || edge.type || 'linked',
      kind: 'dependency',
      color: colorToRgba(sourceNode.color, 0.24),
    });
  });

  return { nodes, links };
}

function drawCanvasForceGraph(ctx, graph, { width, height, selectedNodeId }) {
  const center = { x: width / 2, y: height / 2 };
  const radiusBase = Math.min(width, height);
  const nodes = assignCanvasPositions(graph.nodes, center, radiusBase);
  const byKey = new Map(nodes.map(node => [node.key, node]));
  const links = graph.links
    .map(link => ({
      ...link,
      sourceNode: byKey.get(link.source),
      targetNode: byKey.get(link.target),
    }))
    .filter(link => link.sourceNode && link.targetNode);

  ctx.clearRect(0, 0, width, height);
  drawCanvasBackdrop(ctx, width, height);

  links
    .sort((a, b) => (a.kind === 'dependency' ? -1 : 1) - (b.kind === 'dependency' ? -1 : 1))
    .forEach(link => drawCanvasLink(ctx, link));

  nodes
    .sort((a, b) => a.z - b.z)
    .forEach(node => drawCanvasNode(ctx, node, node.key === selectedNodeId));

  return {
    nodes: nodes.map(node => ({ ...node, raw: node.raw })),
    links: links.map(link => ({ source: link.sourceNode, target: link.targetNode, raw: link })),
  };
}

function assignCanvasPositions(nodes, center, radiusBase) {
  const rootRadius = Math.max(76, radiusBase * 0.11);
  const categoryRadius = Math.max(170, radiusBase * 0.27);
  const taskRadius = Math.max(285, radiusBase * 0.43);

  return nodes.map((node, index) => {
    const radius = node.ring === 0 ? 0 : node.ring === 1 ? categoryRadius : taskRadius + ((index % 2) * 26);
    const perspective = 0.47;
    const depth = node.ring === 0 ? 1 : node.depth;
    const scale = node.ring === 0 ? 1.25 : clamp(0.82 + ((depth + 1) * 0.17) - (node.ring * 0.035), 0.72, 1.16);
    const x = center.x + Math.cos(node.angle) * radius * scale;
    const y = center.y + Math.sin(node.angle) * radius * perspective * scale + (node.ring * 18);
    const nodeRadius = Math.sqrt(node.val || 1) * 7 * scale;

    return {
      ...node,
      raw: node,
      x,
      y,
      z: 100 + ((depth + 1) * 100) + (node.ring * 12),
      radius: clamp(nodeRadius, node.kind === 'task' ? 22 : 34, node.kind === 'user' ? 72 : 54),
    };
  });
}

function drawCanvasBackdrop(ctx, width, height) {
  const centerX = width / 2;
  const centerY = height / 2 + 24;
  ctx.save();
  ctx.fillStyle = '#eef3f8';
  ctx.fillRect(0, 0, width, height);
  const gradient = ctx.createRadialGradient(centerX, centerY, 80, centerX, centerY, Math.max(width, height) * 0.78);
  gradient.addColorStop(0, 'rgba(255, 255, 255, 0.98)');
  gradient.addColorStop(0.56, 'rgba(226, 232, 240, 0.76)');
  gradient.addColorStop(1, 'rgba(203, 213, 225, 0.88)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  ctx.translate(centerX, centerY);
  ctx.strokeStyle = 'rgba(100, 116, 139, 0.14)';
  ctx.lineWidth = 1;
  for (let r = 90; r < Math.min(width, height) * 0.58; r += 72) {
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 1.38, r * 0.44, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  for (let a = 0; a < Math.PI * 2; a += Math.PI / 10) {
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * 54, Math.sin(a) * 20);
    ctx.lineTo(Math.cos(a) * width * 0.48, Math.sin(a) * height * 0.22);
    ctx.stroke();
  }
  ctx.restore();
}

function drawCanvasLink(ctx, link) {
  const source = link.sourceNode;
  const target = link.targetNode;
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const length = Math.max(Math.sqrt((dx * dx) + (dy * dy)), 1);
  const endX = target.x - (dx / length) * (target.radius + 2);
  const endY = target.y - (dy / length) * (target.radius + 2);
  const startX = source.x + (dx / length) * (source.radius + 2);
  const startY = source.y + (dy / length) * (source.radius + 2);
  const arrowLength = 5.5;
  const angle = Math.atan2(endY - startY, endX - startX);

  ctx.save();
  ctx.strokeStyle = link.color;
  ctx.lineWidth = link.kind === 'dependency' ? 1 : 1.35;
  ctx.globalAlpha = link.kind === 'dependency' ? 0.52 : 0.86;
  if (link.kind === 'dependency') ctx.setLineDash([4, 7]);
  ctx.beginPath();
  ctx.moveTo(startX, startY);
  ctx.lineTo(endX, endY);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = link.color;
  ctx.beginPath();
  ctx.moveTo(endX, endY);
  ctx.lineTo(endX - arrowLength * Math.cos(angle - Math.PI / 6), endY - arrowLength * Math.sin(angle - Math.PI / 6));
  ctx.lineTo(endX - arrowLength * Math.cos(angle + Math.PI / 6), endY - arrowLength * Math.sin(angle + Math.PI / 6));
  ctx.closePath();
  ctx.fill();

  if (link.kind === 'dependency') {
    const label = String(link.value || '');
    const fontSize = 10;
    ctx.font = `${fontSize}px Sans-Serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(71, 85, 105, 0.64)';
    ctx.fillText(label, (startX + endX) / 2, (startY + endY) / 2 - 5);
  }
  ctx.restore();
}

function drawCanvasNode(ctx, node, selected) {
  const labelYAxis = node.radius + 14;
  const fontSize = node.kind === 'user' ? 15 : node.kind === 'category' ? 13 : 12;
  const label = truncate(node.id, node.kind === 'task' ? 22 : 18);

  ctx.save();
  ctx.shadowColor = node.kind === 'user' ? 'rgba(15, 23, 42, 0.34)' : colorToRgba(node.color, 0.24);
  ctx.shadowBlur = selected ? 28 : 18;
  ctx.shadowOffsetY = 12;
  ctx.fillStyle = node.color;
  ctx.beginPath();
  ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2, false);
  ctx.fill();

  const shine = ctx.createRadialGradient(
    node.x - node.radius * 0.32,
    node.y - node.radius * 0.32,
    1,
    node.x,
    node.y,
    node.radius,
  );
  shine.addColorStop(0, 'rgba(255,255,255,0.38)');
  shine.addColorStop(0.55, 'rgba(255,255,255,0.06)');
  shine.addColorStop(1, 'rgba(15,23,42,0.20)');
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = shine;
  ctx.beginPath();
  ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2, false);
  ctx.fill();

  if (selected) {
    ctx.strokeStyle = 'rgba(15, 23, 42, 0.72)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(node.x, node.y, node.radius + 5, 0, Math.PI * 2, false);
    ctx.stroke();
  }

  ctx.font = `${fontSize}px Sans-Serif`;
  const textWidth = ctx.measureText(label).width;
  const bckgDimensions = [textWidth, fontSize].map(n => n + fontSize * 0.2);
  ctx.fillStyle = 'transparent';
  ctx.fillRect(node.x - bckgDimensions[0] / 2, node.y + labelYAxis - bckgDimensions[1] / 2, ...bckgDimensions);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = node.color;
  ctx.fillText(label, node.x, node.y + labelYAxis);

  if (node.kind === 'user') {
    ctx.fillStyle = '#ffffff';
    ctx.font = '700 16px Sans-Serif';
    ctx.fillText(label, node.x, node.y);
  }

  ctx.restore();
}

function distance(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt((dx * dx) + (dy * dy));
}

function distanceToSegment(point, source, target) {
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const lengthSq = (dx * dx) + (dy * dy);
  if (lengthSq === 0) return distance(point, source);
  const t = clamp(((point.x - source.x) * dx + (point.y - source.y) * dy) / lengthSq, 0, 1);
  return distance(point, {
    x: source.x + t * dx,
    y: source.y + t * dy,
  });
}

function pickCanvasColor(group) {
  const palette = ['#2ec4b6', '#38bdf8', '#a78bfa', '#facc15', '#fb7185', '#4ade80'];
  const key = String(group || 'uncategorized');
  const hash = [...key].reduce((total, char) => total + char.charCodeAt(0), 0);
  return palette[hash % palette.length];
}

function colorToRgba(hex, alpha = 1) {
  const normalized = String(hex || '#64748b').replace('#', '');
  const value = normalized.length === 3
    ? normalized.split('').map(char => char + char).join('')
    : normalized.padEnd(6, '0').slice(0, 6);
  const int = Number.parseInt(value, 16);
  const red = (int >> 16) & 255;
  const green = (int >> 8) & 255;
  const blue = int & 255;
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function buildGraphLayout(nodes) {
  const width = 1360;
  const height = 860;
  const centerX = width / 2;
  const centerY = height / 2;
  const rootNode = {
    id: 'root-user',
    label: 'You',
    kind: 'root',
    x: centerX,
    y: centerY,
    scale: 1.18,
    depth: 1,
    zIndex: 5000,
  };

  const grouped = new Map();
  for (const node of nodes) {
    const category = node.category || 'uncategorized';
    if (!grouped.has(category)) grouped.set(category, []);
    grouped.get(category).push(node);
  }

  const categories = [...grouped.keys()].sort((a, b) => a.localeCompare(b));
  const categoryRadius = 245;
  const taskRadius = 450;
  const layout = [rootNode];

  categories.forEach((category, categoryIndex) => {
    const angle = categoryAngle(categoryIndex, categories.length);
    const categoryId = `category-${slugify(category)}`;
    const categoryPoint = projectGraphPoint(centerX, centerY, categoryRadius, angle, 1);
    const categoryTasks = (grouped.get(category) || []).sort((a, b) => a.label.localeCompare(b.label));

    layout.push({
      id: categoryId,
      label: category,
      category,
      kind: 'category',
      x: categoryPoint.x,
      y: categoryPoint.y,
      scale: categoryPoint.scale,
      depth: categoryPoint.depth,
      zIndex: categoryPoint.zIndex,
    });

    const spread = Math.min(Math.PI / 1.95, 0.34 * Math.max(categoryTasks.length - 1, 1));
    categoryTasks.forEach((task, taskIndex) => {
      const offset = categoryTasks.length === 1
        ? 0
        : -spread / 2 + (spread * (taskIndex / Math.max(categoryTasks.length - 1, 1)));
      const taskAngle = angle + offset;
      const stagger = taskIndex % 2 === 0 ? 0 : 34;
      const taskPoint = projectGraphPoint(centerX, centerY, taskRadius + stagger, taskAngle, 2);
      layout.push({
        ...task,
        kind: 'task',
        x: taskPoint.x,
        y: taskPoint.y,
        scale: taskPoint.scale,
        depth: taskPoint.depth,
        zIndex: taskPoint.zIndex,
        parentCategoryId: categoryId,
      });
    });
  });

  return layout;
}

function buildFlowGraph(graph, { nodeLimit = 24, edgeLimit = 48 } = {}) {
  const baseNodes = (graph?.nodes || []).slice(0, nodeLimit);
  const visibleEdges = (graph?.edges || [])
    .filter(edge => baseNodes.some(node => node.id === edge.source) && baseNodes.some(node => node.id === edge.target))
    .slice(0, edgeLimit);
  const layout = buildGraphLayout(baseNodes);
  const positions = new Map(layout.map(node => [node.id, node]));
  const degreeMap = new Map(baseNodes.map(node => [node.id, 0]));
  visibleEdges.forEach(edge => {
    degreeMap.set(edge.source, (degreeMap.get(edge.source) || 0) + 1);
    degreeMap.set(edge.target, (degreeMap.get(edge.target) || 0) + 1);
  });

  const nodes = layout.map(node => {
    const degree = degreeMap.get(node.id) || 0;
    const color = pickGraphColor(node.category, node.blocker, node.kind);
    const scale = node.scale || 1;
    const baseSize = node.kind === 'root'
      ? 146
      : node.kind === 'category'
        ? 118
        : clamp(92 + (degree * 18) + (node.blocker ? 10 : 0), 92, 164);
    const size = Math.round(baseSize * scale);
    return {
      id: node.id,
      position: { x: node.x, y: node.y },
      zIndex: node.zIndex,
      className: `strategy-graph-rf-node strategy-graph-rf-node--${node.kind}`,
      data: {
        label: (
          <div className="strategy-graph-node-shell">
            {node.kind === 'category' && <span className="strategy-graph-node-kicker">category</span>}
            {node.kind === 'root' && <span className="strategy-graph-node-kicker">user</span>}
            <strong className="strategy-graph-node-title">{truncate(node.label, node.kind === 'task' ? 28 : 18)}</strong>
            <div className="strategy-graph-node-meta">
              {node.kind === 'task' ? (
                <span className="strategy-graph-node-state">{String(node.state || 'OPEN').toLowerCase()}</span>
              ) : null}
            </div>
          </div>
        ),
        blocked: Boolean(node.blocker),
        state: node.state || 'OPEN',
        kind: node.kind,
      },
      draggable: false,
      selectable: true,
      style: {
        width: size,
        minHeight: size,
        '--node-depth': node.depth || 0,
        borderRadius: 999,
        border: `1px solid ${color.border}`,
        background: `radial-gradient(circle at 35% 30%, ${color.glow}, ${color.fill})`,
        color: color.text,
        boxShadow: `${color.shadow}, inset -14px -18px 28px rgba(15, 23, 42, 0.18), inset 10px 10px 22px rgba(255, 255, 255, 0.16)`,
        fontSize: '12px',
        fontWeight: 700,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
        textAlign: 'center',
        lineHeight: 1.2,
        opacity: node.kind === 'root' ? 1 : clamp(0.78 + ((node.depth || 0) * 0.16), 0.74, 1),
      },
    };
  });

  const hierarchyEdges = layout
    .filter(node => node.kind === 'category' || node.kind === 'task')
    .map(node => {
      if (node.kind === 'category') {
        return {
          id: `root-link:${node.id}`,
          source: 'root-user',
          target: node.id,
          type: 'straight',
          className: 'strategy-graph-edge strategy-graph-edge--root',
          animated: false,
          markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: 'rgba(148, 163, 184, 0.5)' },
          style: {
            stroke: 'rgba(100, 116, 139, 0.54)',
            strokeWidth: 2,
            opacity: 0.72,
          },
        };
      }

      const color = pickGraphColor(node.category, node.blocker, 'task');
      return {
        id: `category-link:${node.parentCategoryId}:${node.id}`,
        source: node.parentCategoryId,
        target: node.id,
        type: 'straight',
        className: 'strategy-graph-edge strategy-graph-edge--task',
        animated: false,
        markerEnd: { type: MarkerType.ArrowClosed, width: 13, height: 13, color: color.edge },
        style: {
          stroke: color.edge,
          strokeWidth: 1.65,
          opacity: 0.62 + ((node.depth || 0) * 0.16),
        },
      };
    });

  const dependencyEdges = visibleEdges
    .filter(edge => positions.has(edge.source) && positions.has(edge.target))
    .map(edge => ({
      id: `dependency:${edge.id || `${edge.source}-${edge.target}`}`,
      source: edge.source,
      target: edge.target,
      type: 'straight',
      className: 'strategy-graph-edge strategy-graph-edge--dependency',
      animated: false,
      markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: pickGraphColor(positions.get(edge.source)?.category).edge },
      style: {
        stroke: pickGraphColor(positions.get(edge.source)?.category).edge,
        strokeWidth: 1.1,
        opacity: 0.34,
        strokeDasharray: '5 6',
      },
    }));

  return { nodes, edges: [...hierarchyEdges, ...dependencyEdges] };
}

function truncate(value, max = 80) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function categoryAngle(index, count) {
  if (count === 1) return -Math.PI / 2;
  if (count === 2) return index === 0 ? -2.42 : 0.72;
  return ((Math.PI * 2) / Math.max(count, 1)) * index - (Math.PI / 2);
}

function projectGraphPoint(centerX, centerY, radius, angle, ring) {
  const depth = Math.sin(angle);
  const scale = clamp(0.84 + ((depth + 1) * 0.15) - (ring * 0.02), 0.78, 1.16);
  const x = centerX + (Math.cos(angle) * radius * scale);
  const y = centerY + (Math.sin(angle) * radius * 0.46 * scale) + (ring * 16);
  return {
    x: Math.round(x),
    y: Math.round(y),
    depth,
    scale,
    zIndex: Math.round(1000 + ((depth + 1) * 800) + (ring * 40)),
  };
}

function slugify(value) {
  return String(value || 'uncategorized')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'uncategorized';
}

function pickGraphColor(category, blocked = false, kind = 'task') {
  if (kind === 'root') {
    return {
      glow: 'rgba(255, 255, 255, 0.32)',
      fill: 'rgba(30, 41, 59, 0.98)',
      border: 'rgba(71, 85, 105, 0.56)',
      edge: 'rgba(100, 116, 139, 0.40)',
      shadow: '0 30px 72px rgba(15, 23, 42, 0.36)',
      text: '#f8fafc',
    };
  }

  if (blocked) {
    return {
      glow: 'rgba(248, 113, 113, 0.32)',
      fill: 'rgba(251, 146, 60, 0.88)',
      border: 'rgba(251, 146, 60, 0.64)',
      edge: 'rgba(251, 146, 60, 0.48)',
      shadow: '0 26px 58px rgba(194, 65, 12, 0.28)',
      text: '#fff7ed',
    };
  }

  const palette = [
    {
      glow: 'rgba(96, 165, 250, 0.34)',
      fill: 'rgba(14, 165, 233, 0.92)',
      border: 'rgba(125, 211, 252, 0.58)',
      edge: 'rgba(56, 189, 248, 0.42)',
      shadow: '0 26px 58px rgba(14, 165, 233, 0.24)',
      text: '#f0f9ff',
    },
    {
      glow: 'rgba(74, 222, 128, 0.34)',
      fill: 'rgba(74, 222, 128, 0.88)',
      border: 'rgba(187, 247, 208, 0.56)',
      edge: 'rgba(74, 222, 128, 0.36)',
      shadow: '0 26px 58px rgba(22, 163, 74, 0.22)',
      text: '#f0fdf4',
    },
    {
      glow: 'rgba(250, 204, 21, 0.30)',
      fill: 'rgba(253, 224, 71, 0.88)',
      border: 'rgba(254, 240, 138, 0.54)',
      edge: 'rgba(250, 204, 21, 0.34)',
      shadow: '0 26px 58px rgba(202, 138, 4, 0.22)',
      text: '#422006',
    },
    {
      glow: 'rgba(192, 132, 252, 0.30)',
      fill: 'rgba(217, 70, 239, 0.84)',
      border: 'rgba(233, 213, 255, 0.52)',
      edge: 'rgba(217, 70, 239, 0.30)',
      shadow: '0 26px 58px rgba(192, 38, 211, 0.20)',
      text: '#fdf4ff',
    },
  ];

  const key = String(category || 'uncategorized');
  const hash = [...key].reduce((total, char) => total + char.charCodeAt(0), 0);
  const base = palette[hash % palette.length];

  if (kind === 'category') {
    return {
      ...base,
      glow: base.glow.replace('0.34', '0.24').replace('0.30', '0.22'),
      fill: base.fill.replace('0.92', '0.78').replace('0.88', '0.76').replace('0.84', '0.74'),
    };
  }

  return base;
}

