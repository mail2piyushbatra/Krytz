import React, { useEffect, useState, useCallback, useRef } from 'react';
import { items as itemsApi, entries } from '../services/api';
import { Card, ActionBtn, PageLoader, EmptyState, Badge } from '../components/ui/UiKit';
import { AlertTriangle, CheckCircle2, Circle, Clock, ListChecks, Plus, Send, TrendingUp, X, History, Tag, Zap, AlertCircle } from 'lucide-react';
import './TasksScreen.css';

export default function TasksScreen() {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('OPEN'); // OPEN or DONE
  const [newTaskText, setNewTaskText] = useState('');
  const [adding, setAdding] = useState(false);
  const [selectedTask, setSelectedTask] = useState(null);
  const [taskDetail, setTaskDetail] = useState(null);
  const inputRef = useRef(null);

  const loadTasks = useCallback(async () => {
    setLoading(true);
    try {
      const res = await itemsApi.list({ limit: 100 });
      setTasks(res.items || []);
    } catch (err) {
      console.error(err);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  const handleToggleTask = async (task) => {
    const isDone = task.state === 'DONE';
    const newState = isDone ? 'OPEN' : 'DONE';
    
    // Optimistic update
    setTasks(prev => prev.map(t => t.id === task.id ? { ...t, state: newState } : t));
    
    try {
      if (isDone) {
        await itemsApi.update(task.id, { state: 'OPEN' });
      } else {
        await itemsApi.markDone(task.id);
      }
    } catch {
      // Revert on failure
      loadTasks();
    }
  };

  const handleAddTask = async (e) => {
    if (e) e.preventDefault();
    const text = newTaskText.trim();
    if (!text) return;
    
    setAdding(true);
    try {
      // Use the entries.todo shortcut — creates a direct action item without LLM
      await entries.todo(text);
      setNewTaskText('');
      // Reload to pick up the new item
      await loadTasks();
      // Switch to Open view to see it
      setFilter('OPEN');
      inputRef.current?.focus();
    } catch (err) {
      console.error('Failed to add task:', err);
    }
    setAdding(false);
  };

  const handleInputKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleAddTask();
    }
  };

  const openTask = async (task) => {
    setSelectedTask(task);
    try {
      const detail = await itemsApi.get(task.id);
      setTaskDetail(detail);
    } catch { setTaskDetail(null); }
  };

  const closeDetail = () => { setSelectedTask(null); setTaskDetail(null); };

  const filteredTasks = tasks.filter(t => filter === 'OPEN' ? t.state !== 'DONE' && t.state !== 'DROPPED' : t.state === 'DONE');
  const staleCount = tasks.filter(t => t.state !== 'DONE' && t.state !== 'DROPPED' && t.lastSeen && (Date.now() - new Date(t.lastSeen).getTime()) > 7 * 24 * 60 * 60 * 1000).length;
  const openCount = tasks.filter(t => t.state !== 'DONE' && t.state !== 'DROPPED').length;
  const doneCount = tasks.filter(t => t.state === 'DONE').length;
  const blockerCount = tasks.filter(t => t.blocker && t.state !== 'DONE' && t.state !== 'DROPPED').length;
  const overdueCount = tasks.filter(t => t.deadline && new Date(t.deadline) < new Date() && t.state !== 'DONE' && t.state !== 'DROPPED').length;
  const dueSoonCount = tasks.filter(t => {
    if (!t.deadline || t.state === 'DONE' || t.state === 'DROPPED') return false;
    const due = new Date(t.deadline).getTime();
    const now = Date.now();
    return due >= now && due <= now + 3 * 24 * 60 * 60 * 1000;
  }).length;
  const completionRate = Math.round((doneCount / Math.max(openCount + doneCount, 1)) * 100);
  const categoryCounts = buildTaskCategoryCounts(tasks);

  if (loading && tasks.length === 0) {
    return <PageLoader text="Getting your tasks..." />;
  }

  return (
    <div className="tasks-screen page-container">
      {staleCount > 0 && (
        <div className="drift-alert animate-slideUp">
          <AlertCircle size={16} />
          <span><strong>{staleCount}</strong> {staleCount === 1 ? 'task hasn\'t' : 'tasks haven\'t'} been updated in over a week. Review them?</span>
        </div>
      )}
      <header className="tasks-header">
        <div>
          <p className="eyebrow">Tasks</p>
          <h1>Your active tasks</h1>
        </div>
        
        <div className="tasks-filters">
          <ActionBtn 
            variant={filter === 'OPEN' ? 'primary' : 'ghost'} 
            onClick={() => setFilter('OPEN')}
          >
            Open ({openCount})
          </ActionBtn>
          <ActionBtn 
            variant={filter === 'DONE' ? 'primary' : 'ghost'} 
            onClick={() => setFilter('DONE')}
          >
            Done ({doneCount})
          </ActionBtn>
        </div>
      </header>

      <section className="tasks-kpi-grid" aria-label="Task overview">
        <TaskKpiCard icon={ListChecks} label="Open" value={openCount} detail="to do" />
        <TaskKpiCard icon={AlertTriangle} label="Blocked" value={blockerCount} detail="need attention" tone="warning" />
        <TaskKpiCard icon={Clock} label="Due soon" value={dueSoonCount} detail={`${overdueCount} overdue`} tone={overdueCount > 0 ? 'danger' : 'neutral'} />
        <TaskKpiCard icon={TrendingUp} label="Completion" value={`${completionRate}%`} detail={`${doneCount} done`} tone="positive" />
      </section>

      {categoryCounts.length > 0 && (
        <section className="tasks-dashboard-panel">
          <div className="tasks-panel-head">
            <span>By category</span>
            <strong>{categoryCounts.length} categories</strong>
          </div>
          <div className="tasks-lane-grid">
            {categoryCounts.slice(0, 6).map(category => (
              <article className="tasks-lane-card" key={category.name}>
                <span>{category.name}</span>
                <strong>{category.open}</strong>
                <div className="tasks-lane-meter">
                  <i style={{ width: `${category.percent}%` }} />
                </div>
                <small>{category.done} done / {category.blocked} blocked</small>
              </article>
            ))}
          </div>
        </section>
      )}

      {/* Inline task creation */}
      <form className="task-add-form" onSubmit={handleAddTask}>
        <div className="task-add-inner">
          <Plus size={18} className="task-add-icon" />
          <input
            ref={inputRef}
            className="task-add-input"
            type="text"
            placeholder="Add a task... (press Enter)"
            value={newTaskText}
            onChange={e => setNewTaskText(e.target.value)}
            onKeyDown={handleInputKeyDown}
            disabled={adding}
            id="task-add-input"
          />
          {newTaskText.trim() && (
            <ActionBtn
              type="submit"
              variant="primary"
              className="btn-sm task-add-btn"
              disabled={adding}
              icon={Send}
            >
              Add
            </ActionBtn>
          )}
        </div>
      </form>

      <div className="tasks-list stagger">
        {filteredTasks.length === 0 ? (
          <EmptyState 
            title={filter === 'OPEN' ? 'No open tasks' : 'No completed tasks yet'} 
            description={filter === 'OPEN' ? 'Type above to add your first task, or use Quick Add from the main screen.' : 'Check off some tasks to see them here.'}
          />
        ) : (
          filteredTasks.map(task => {
            const isOverdue = task.deadline && new Date(task.deadline) < new Date();
            return (
              <Card key={task.id} className={`task-card ${task.state === 'DONE' ? 'task-done' : ''} ${isStale(task) ? 'task-stale' : ''}`} onClick={() => openTask(task)} style={{ cursor: 'pointer' }}>
                <button 
                  className="task-check-btn" 
                  onClick={(e) => { e.stopPropagation(); handleToggleTask(task); }}
                  title="Mark done / undo"
                >
                  {task.state === 'DONE' ? <CheckCircle2 className="task-icon-done" /> : <Circle className="task-icon-open" />}
                </button>
                
                <div className="task-content">
                  <p className="task-text">{task.canonical_text || task.text}</p>
                  <div className="task-meta">
                    {task.category && <Badge intent="default">{task.category}</Badge>}
                    {task.blocker && <Badge intent="warning">Blocked</Badge>}
                    {isStale(task) && <Badge intent="warning"><AlertCircle size={12} style={{ marginRight: 2 }} />Stale</Badge>}
                    {task.deadline && (
                      <Badge intent={isOverdue ? 'negative' : 'accent'}>
                        <Clock size={12} style={{ marginRight: 4 }} />
                        {new Date(task.deadline).toLocaleDateString()}
                      </Badge>
                    )}
                    {task.priority > 0.65 && <Badge intent="accent"><Zap size={12} /> High</Badge>}
                  </div>
                </div>
              </Card>
            );
          })
        )}
      </div>

      {/* Task Detail Modal */}
      {selectedTask && (
        <div className="task-detail-overlay" onClick={closeDetail}>
          <div className="task-detail-modal animate-slideUp" onClick={e => e.stopPropagation()}>
            <div className="task-detail-header">
              <h2>{selectedTask.canonical_text || selectedTask.text}</h2>
              <button className="task-detail-close" onClick={closeDetail}><X size={20} /></button>
            </div>

            <div className="task-detail-badges">
              <Badge intent="default"><Tag size={12} /> {selectedTask.category || 'uncategorized'}</Badge>
              <Badge intent={selectedTask.state === 'DONE' ? 'positive' : 'accent'}>{selectedTask.state}</Badge>
              {selectedTask.blocker && <Badge intent="warning">Blocked</Badge>}
              {selectedTask.priority > 0 && <Badge intent="accent"><Zap size={12} /> Priority: {Math.round(selectedTask.priority * 100)}%</Badge>}
              {selectedTask.deadline && <Badge intent="default"><Clock size={12} /> {new Date(selectedTask.deadline).toLocaleDateString()}</Badge>}
            </div>

            <div className="task-detail-meta">
              <div><small>Created</small><span>{new Date(selectedTask.createdAt).toLocaleString()}</span></div>
              <div><small>Last updated</small><span>{selectedTask.lastSeen ? new Date(selectedTask.lastSeen).toLocaleString() : '—'}</span></div>
              <div><small>Mentions</small><span>{selectedTask.mentionCount || 1}</span></div>
              <div><small>Confidence</small><span>{Math.round((selectedTask.confidence || 0.8) * 100)}%</span></div>
            </div>

            {taskDetail?.events?.length > 0 && (
              <div className="task-detail-history">
                <h3><History size={16} /> History</h3>
                <ul>
                  {taskDetail.events.map((evt, i) => (
                    <li key={i}>
                      <span className="evt-time">{new Date(evt.createdAt).toLocaleString()}</span>
                      <span className="evt-change">{evt.fromState || '—'} → {evt.toState}</span>
                      {evt.reason && <span className="evt-reason">{evt.reason}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="task-detail-actions">
              <ActionBtn onClick={() => { handleToggleTask(selectedTask); closeDetail(); }}>
                {selectedTask.state === 'DONE' ? 'Reopen' : '✓ Mark Done'}
              </ActionBtn>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function isStale(task) {
  if (task.state === 'DONE' || task.state === 'DROPPED') return false;
  if (!task.lastSeen) return false;
  return (Date.now() - new Date(task.lastSeen).getTime()) > 7 * 24 * 60 * 60 * 1000;
}

function TaskKpiCard({ icon: Icon, label, value, detail, tone = 'neutral' }) {
  return (
    <article className={`tasks-kpi-card tasks-kpi-card--${tone}`}>
      <div className="tasks-kpi-icon"><Icon size={18} /></div>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function buildTaskCategoryCounts(tasks) {
  const rows = new Map();
  for (const task of tasks) {
    const name = task.category || 'uncategorized';
    const existing = rows.get(name) || { name, open: 0, done: 0, blocked: 0 };
    if (task.state === 'DONE') existing.done += 1;
    else if (task.state !== 'DROPPED') existing.open += 1;
    if (task.blocker && task.state !== 'DONE' && task.state !== 'DROPPED') existing.blocked += 1;
    rows.set(name, existing);
  }
  const max = Math.max(...Array.from(rows.values()).map(row => row.open), 1);
  return Array.from(rows.values())
    .map(row => ({ ...row, percent: Math.max(6, Math.round((row.open / max) * 100)) }))
    .sort((a, b) => b.open - a.open || b.blocked - a.blocked);
}
