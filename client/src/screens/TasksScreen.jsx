import React, { useEffect, useState, useCallback } from 'react';
import { items as itemsApi } from '../services/api';
import { Card, ActionBtn, PageLoader, EmptyState, Badge } from '../components/ui/UiKit';
import { CheckCircle2, Circle, Clock } from 'lucide-react';
import './TasksScreen.css';

export default function TasksScreen() {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('OPEN'); // OPEN or DONE

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
        // We'd typically have an un-done endpoint, assuming update is available
        await itemsApi.update(task.id, { state: 'OPEN' });
      } else {
        await itemsApi.markDone(task.id);
      }
    } catch {
      // Revert on failure
      loadTasks();
    }
  };

  const filteredTasks = tasks.filter(t => filter === 'OPEN' ? t.state !== 'DONE' && t.state !== 'DROPPED' : t.state === 'DONE');

  if (loading && tasks.length === 0) {
    return <PageLoader text="Loading your tasks..." />;
  }

  return (
    <div className="tasks-screen page-container">
      <header className="tasks-header">
        <div>
          <p className="eyebrow">Action Items</p>
          <h1>Your active tasks</h1>
        </div>
        
        <div className="tasks-filters">
          <ActionBtn 
            variant={filter === 'OPEN' ? 'primary' : 'ghost'} 
            onClick={() => setFilter('OPEN')}
          >
            Open ({tasks.filter(t => t.state !== 'DONE').length})
          </ActionBtn>
          <ActionBtn 
            variant={filter === 'DONE' ? 'primary' : 'ghost'} 
            onClick={() => setFilter('DONE')}
          >
            Completed
          </ActionBtn>
        </div>
      </header>

      <div className="tasks-list stagger">
        {filteredTasks.length === 0 ? (
          <EmptyState 
            title={filter === 'OPEN' ? 'No open tasks' : 'No completed tasks yet'} 
            description={filter === 'OPEN' ? 'You are all caught up! Go to the Command Center to capture new items.' : 'Check off some tasks to see them here.'}
          />
        ) : (
          filteredTasks.map(task => {
            const isOverdue = task.deadline && new Date(task.deadline) < new Date();
            return (
              <Card key={task.id} className={`task-card ${task.state === 'DONE' ? 'task-done' : ''}`}>
                <button 
                  className="task-check-btn" 
                  onClick={() => handleToggleTask(task)}
                  title="Toggle status"
                >
                  {task.state === 'DONE' ? <CheckCircle2 className="task-icon-done" /> : <Circle className="task-icon-open" />}
                </button>
                
                <div className="task-content">
                  <p className="task-text">{task.text}</p>
                  <div className="task-meta">
                    {task.category && <Badge intent="default">{task.category}</Badge>}
                    {task.blocker && <Badge intent="warning">Blocked</Badge>}
                    {task.deadline && (
                      <Badge intent={isOverdue ? 'negative' : 'accent'} icon={Clock}>
                        {new Date(task.deadline).toLocaleDateString()}
                      </Badge>
                    )}
                  </div>
                </div>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}
