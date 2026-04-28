/** ✦ FLOWRA — Inspector Screen
 *
 * Observability, causality graph, and engine health.
 * Also manages connectors (Layer 5 gap).
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { inspector } from '../services/api';
import useAuthStore from '../stores/authStore';
import './InspectorScreen.css';

const PLATFORM_ROLES = ['founder', 'operator', 'devops', 'coder', 'support'];

export default function InspectorScreen() {
  const user = useAuthStore(s => s.user);
  const hasPlatformAccess = PLATFORM_ROLES.includes(user?.platformRole || user?.role);
  const [activeTab, setActiveTab] = useState('health');
  const [data, setData] = useState({
    health: null,
    traces: [],
    anomalies: [],
    graph: null,
    connectors: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!hasPlatformAccess) {
      setLoading(false);
      return;
    }
    loadData();
  }, [activeTab, hasPlatformAccess]);

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      if (activeTab === 'health') {
        const health = await inspector.health();
        setData(s => ({ ...s, health }));
      } else if (activeTab === 'traces') {
        const traces = await inspector.traces();
        setData(s => ({ ...s, traces: traces?.traces || [] }));
      } else if (activeTab === 'anomalies') {
        const anomalies = await inspector.anomalies();
        setData(s => ({ ...s, anomalies: anomalies?.anomalies || [] }));
      } else if (activeTab === 'graph') {
        const graph = await inspector.graph();
        setData(s => ({ ...s, graph }));
      } else if (activeTab === 'connectors') {
        const connectors = await inspector.connectors();
        setData(s => ({ ...s, connectors: connectors?.connectors || [] }));
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleAddConnector(platform) {
    if (!platform || !hasPlatformAccess) return;
    try {
      await inspector.registerConnector(platform);
      await loadData(); // refresh
    } catch (err) {
      alert(`Failed to add connector: ${err.message}`);
    }
  }

  if (!hasPlatformAccess) {
    return (
      <div className="inspector-access-card page-container">
        <div className="inspector-access-icon">lock</div>
        <h2>Platform Access Required</h2>
        <p>
          Your account ({user?.email || 'current user'}) does not have platform
          privileges for Inspector observability.
        </p>
        <p>Contact a founder or operator to request access.</p>
        <Link to="/" className="btn btn-secondary">Back to Command Center</Link>
      </div>
    );
  }

  return (
    <div className="inspector-screen page-container">
      <header className="page-header">
        <h1 className="page-title">Inspector</h1>
        <p className="page-subtitle">Engine fleet observability and connector management.</p>
      </header>

      <nav className="inspector-tabs">
        <button className={`tab-btn ${activeTab === 'health' ? 'active' : ''}`} onClick={() => setActiveTab('health')}>Health</button>
        <button className={`tab-btn ${activeTab === 'graph' ? 'active' : ''}`} onClick={() => setActiveTab('graph')}>Graph</button>
        <button className={`tab-btn ${activeTab === 'traces' ? 'active' : ''}`} onClick={() => setActiveTab('traces')}>Traces</button>
        <button className={`tab-btn ${activeTab === 'anomalies' ? 'active' : ''}`} onClick={() => setActiveTab('anomalies')}>Anomalies</button>
        <button className={`tab-btn ${activeTab === 'connectors' ? 'active' : ''}`} onClick={() => setActiveTab('connectors')}>Connectors</button>
      </nav>

      {error && <div className="error-banner">{error}</div>}

      <div className="inspector-content">
        {loading ? (
          <div className="inspector-loading">Loading {activeTab}...</div>
        ) : (
          <>
            {activeTab === 'health' && <HealthTab health={data.health} />}
            {activeTab === 'graph' && <GraphTab graph={data.graph} />}
            {activeTab === 'traces' && <TracesTab traces={data.traces} />}
            {activeTab === 'anomalies' && <AnomaliesTab anomalies={data.anomalies} />}
            {activeTab === 'connectors' && <ConnectorsTab connectors={data.connectors} onAdd={handleAddConnector} />}
          </>
        )}
      </div>
    </div>
  );
}

function HealthTab({ health }) {
  if (!health) return <div>No health data</div>;
  return (
    <div className="health-grid">
      <div className="health-card">
        <h3>Engines</h3>
        <pre>{JSON.stringify(health.engines, null, 2)}</pre>
      </div>
      <div className="health-card">
        <h3>TSG (Temporal State Graph)</h3>
        <pre>{JSON.stringify(health.tsg, null, 2)}</pre>
      </div>
      <div className="health-card">
        <h3>Embedding</h3>
        <pre>{JSON.stringify(health.embedding, null, 2)}</pre>
      </div>
      <div className="health-card">
        <h3>Phase 4-7 Subsystems</h3>
        <pre>{JSON.stringify(health.phase4to7, null, 2)}</pre>
      </div>
    </div>
  );
}

function GraphTab({ graph }) {
  if (!graph) return <div>No graph data</div>;
  return (
    <div className="graph-view">
      <div className="graph-stats">
        <div className="stat-box"><strong>{graph.nodes?.length || 0}</strong> Nodes</div>
        <div className="stat-box"><strong>{graph.edges?.length || 0}</strong> Edges</div>
      </div>
      <div className="graph-nodes-list">
        {graph.nodes?.slice(0, 10).map(n => (
          <div key={n.id} className="graph-node">
            <span className={`node-state state-${n.state.toLowerCase()}`}>{n.state}</span>
            <span className="node-label">{n.label}</span>
          </div>
        ))}
        {graph.nodes?.length > 10 && <div className="more-nodes">...and {graph.nodes.length - 10} more</div>}
      </div>
    </div>
  );
}

function TracesTab({ traces }) {
  if (!traces?.length) return <div className="empty-state">No traces found.</div>;
  return (
    <div className="traces-list">
      {traces.map(t => (
        <div key={t.id} className="trace-card">
          <div className="trace-header">
            <span className="trace-type">{t.action_type || 'system'}</span>
            <span className="trace-time">{new Date(t.created_at).toLocaleString()}</span>
          </div>
          <pre className="trace-body">{JSON.stringify(t.diff || t.metadata || {}, null, 2)}</pre>
        </div>
      ))}
    </div>
  );
}

function AnomaliesTab({ anomalies }) {
  if (!anomalies?.length) return <div className="empty-state">No anomalies detected. All clear! 🚀</div>;
  return (
    <div className="anomalies-list">
      {anomalies.map(a => (
        <div key={a.id} className="anomaly-card">
          <div className="anomaly-header">
            <strong>{a.type}</strong>
            <span>{new Date(a.detected_at).toLocaleString()}</span>
          </div>
          <p>{a.description}</p>
        </div>
      ))}
    </div>
  );
}

function ConnectorsTab({ connectors, onAdd }) {
  return (
    <div className="connectors-view">
      <div className="add-connector">
        <h3>Add Data Source</h3>
        <div className="connector-buttons">
          <button className="btn btn-secondary" onClick={() => onAdd('google_calendar')}>Google Calendar</button>
          <button className="btn btn-secondary" onClick={() => onAdd('gmail')}>Gmail</button>
          <button className="btn btn-secondary" onClick={() => onAdd('notion')}>Notion</button>
        </div>
      </div>
      
      <h3>Active Connectors</h3>
      {connectors?.length === 0 ? (
        <p className="empty-state">No connectors configured.</p>
      ) : (
        <div className="connectors-list">
          {connectors.map(c => (
            <div key={c.id} className="connector-card">
              <div className="connector-header">
                <strong>{c.platform}</strong>
                <span className={`status-badge status-${c.status}`}>{c.status}</span>
              </div>
              <div className="connector-meta">
                Added: {new Date(c.created_at).toLocaleDateString()}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
