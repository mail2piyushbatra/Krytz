import { useEffect, useState } from 'react';
import { plan, stats } from '../services/api';
import './StrategyScreen.css';

export default function StrategyScreen() {
  const [state, setState] = useState({ loading: true, capacity: null, stats: null, error: '' });

  useEffect(() => {
    async function load() {
      try {
        const [capacity, appStats] = await Promise.all([
          plan.capacity().catch(() => null),
          stats.get().catch(() => null),
        ]);
        setState({ loading: false, capacity, stats: appStats, error: '' });
      } catch (error) {
        setState({ loading: false, capacity: null, stats: null, error: error.message });
      }
    }
    load();
  }, []);

  const memoryDepth = getMemoryDepth(state.stats);
  const capacityValue = getCapacityValue(state.capacity);

  return (
    <div className="strategy-screen page-container">
      <p className="eyebrow">Strategy layer</p>
      <h1>Shape the system, not just the task list.</h1>
      {state.error && <div className="command-error">{state.error}</div>}
      <div className="strategy-grid">
        <section className="strategy-card">
          <span>Capacity</span>
          <strong>{state.loading ? '...' : capacityValue}</strong>
          <p>Flowra will use this panel for load, constraints, and working agreements.</p>
        </section>
        <section className="strategy-card">
          <span>Memory depth</span>
          <strong>{state.loading ? '...' : memoryDepth}</strong>
          <p>Captured entries and derived items become the app's operating memory.</p>
        </section>
        <section className="strategy-card wide">
          <span>Next build gap</span>
          <strong>Rules, goals, and review loops</strong>
          <p>This shell stays thin until the v3 rules/goals contracts are adopted, so the product direction is visible without faking backend behavior.</p>
        </section>
      </div>
    </div>
  );
}

function getCapacityValue(capacity) {
  if (!capacity) return 'Learning';
  if (typeof capacity.availableHours === 'number') return `${capacity.availableHours}h`;
  if (typeof capacity.hours === 'number') return `${capacity.hours}h`;
  if (typeof capacity.availableMins === 'number') return `${Math.round(capacity.availableMins / 60)}h`;
  return 'Learning';
}

function getMemoryDepth(stats) {
  if (!stats) return 'Live';
  if (typeof stats.totalEntries === 'number') return String(stats.totalEntries);
  if (typeof stats.entries === 'number') return String(stats.entries);
  if (stats.entries && typeof stats.entries.total === 'number') return String(stats.entries.total);
  if (typeof stats.totalItems === 'number') return String(stats.totalItems);
  return 'Live';
}
