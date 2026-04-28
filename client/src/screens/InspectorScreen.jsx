/** ✦ FLOWRA — Inspector Screen (v3: premium data platform UI)
 *
 * Observability, causality graph, and engine health.
 * Also manages connectors (Layer 5 gap).
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { inspector } from '../services/api';
import useAuthStore from '../stores/authStore';
import { Card, MetricCard, Badge, ActionBtn, PageLoader, EmptyState, ProgressRing } from '../components/ui/UiKit';
import { 
  Heart, GitBranch, Activity, AlertTriangle, Plug, Lock,
  Server, Database, Cpu, Wifi, Clock, CheckCircle2, XCircle, 
  ArrowRight, Plus, RefreshCw
} from 'lucide-react';
import './InspectorScreen.css';

const PLATFORM_ROLES = ['founder', 'operator', 'devops', 'coder', 'support'];

const TABS = [
  { key: 'health', label: 'Health', Icon: Heart },
  { key: 'graph', label: 'Graph', Icon: GitBranch },
  { key: 'traces', label: 'Traces', Icon: Activity },
  { key: 'anomalies', label: 'Anomalies', Icon: AlertTriangle },
  { key: 'connectors', label: 'Connectors', Icon: Plug },
];

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
      <div className="inspector-screen page-container">
        <EmptyState
          icon={Lock}
          title="Platform Access Required"
          description={`Your account (${user?.email || 'current user'}) does not have platform privileges for Inspector observability. Contact a founder or operator to request access.`}
          action={<Link to="/" className="btn btn-secondary">Back to Command Center</Link>}
        />
      </div>
    );
  }

  return (
    <div className="inspector-screen page-container animate-fadeIn">
      <header className="inspector-header">
        <div>
          <p className="eyebrow">Observability</p>
          <h1 className="page-title">Inspector</h1>
        </div>
        <ActionBtn variant="ghost" icon={RefreshCw} onClick={loadData} className="btn-sm">
          Refresh
        </ActionBtn>
      </header>

      {/* Tab navigation */}
      <nav className="inspector-tabs">
        {TABS.map(tab => {
          const TabIcon = tab.Icon;
          return (
            <button
              key={tab.key}
              className={`inspector-tab ${activeTab === tab.key ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.key)}
            >
              <TabIcon size={16} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </nav>

      {error && (
        <Card className="inspector-error">
          <AlertTriangle size={16} />
          <span>{error}</span>
        </Card>
      )}

      <div className="inspector-content">
        {loading ? (
          <PageLoader text={`Loading ${activeTab}...`} />
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

/* ── Health Tab ── */
function HealthTab({ health }) {
  if (!health) return <EmptyState icon={Heart} title="No health data" description="Engine fleet has not reported yet." />;

  const sections = [
    { key: 'engines', title: 'Engine Fleet', Icon: Cpu, data: health.engines },
    { key: 'tsg', title: 'Temporal State Graph', Icon: GitBranch, data: health.tsg },
    { key: 'embedding', title: 'Embedding Pipeline', Icon: Database, data: health.embedding },
    { key: 'phase4to7', title: 'Phase 4-7 Subsystems', Icon: Server, data: health.phase4to7 },
  ];

  return (
    <div className="health-grid">
      {sections.map(sec => (
        <Card key={sec.key} className="health-card">
          <div className="health-card-header">
            <sec.Icon size={18} className="health-card-icon" />
            <h3>{sec.title}</h3>
            {sec.data && <StatusDot status={getStatus(sec.data)} />}
          </div>
          <div className="health-card-body">
            {sec.data ? (
              <HealthDataGrid data={sec.data} />
            ) : (
              <p className="health-no-data">Not reporting</p>
            )}
          </div>
        </Card>
      ))}
    </div>
  );
}

function HealthDataGrid({ data }) {
  if (typeof data !== 'object' || data === null) {
    return <span className="health-value-inline">{String(data)}</span>;
  }
  return (
    <div className="health-data-grid">
      {Object.entries(data).map(([key, val]) => (
        <div key={key} className="health-data-row">
          <span className="health-data-key">{key.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ')}</span>
          <span className="health-data-val">
            {typeof val === 'object' ? (
              <Badge intent="default">{JSON.stringify(val)}</Badge>
            ) : typeof val === 'boolean' ? (
              val ? <CheckCircle2 size={14} className="health-ok" /> : <XCircle size={14} className="health-fail" />
            ) : (
              <strong>{String(val)}</strong>
            )}
          </span>
        </div>
      ))}
    </div>
  );
}

function StatusDot({ status }) {
  const colors = { ok: 'var(--status-done)', warn: '#f39c12', error: 'var(--danger)' };
  return (
    <span className="health-status-dot" style={{ background: colors[status] || colors.ok }} title={status} />
  );
}

function getStatus(data) {
  if (!data) return 'error';
  const str = JSON.stringify(data).toLowerCase();
  if (str.includes('error') || str.includes('false')) return 'warn';
  return 'ok';
}

/* ── Graph Tab ── */
function GraphTab({ graph }) {
  if (!graph) return <EmptyState icon={GitBranch} title="No graph data" description="The temporal state graph is empty." />;
  return (
    <div className="graph-view">
      <div className="graph-stats-row">
        <MetricCard title="Nodes" value={graph.nodes?.length || 0} icon={GitBranch} />
        <MetricCard title="Edges" value={graph.edges?.length || 0} icon={Activity} />
      </div>
      <div className="graph-nodes-list">
        {graph.nodes?.slice(0, 15).map(n => (
          <Card key={n.id} className="graph-node-card">
            <Badge intent={n.state === 'DONE' ? 'positive' : n.state === 'OPEN' ? 'accent' : 'warning'}>
              {n.state}
            </Badge>
            <span className="graph-node-label">{n.label}</span>
          </Card>
        ))}
        {graph.nodes?.length > 15 && (
          <div className="graph-more">
            <Badge intent="default">+{graph.nodes.length - 15} more nodes</Badge>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Traces Tab ── */
function TracesTab({ traces }) {
  if (!traces?.length) return <EmptyState icon={Activity} title="No traces found" description="System activity traces will appear here." />;
  return (
    <div className="traces-list">
      {traces.map(t => (
        <Card key={t.id} className="trace-card">
          <div className="trace-header">
            <Badge intent="accent">{t.action_type || 'system'}</Badge>
            <span className="trace-time">
              <Clock size={12} />
              {new Date(t.created_at).toLocaleString()}
            </span>
          </div>
          <pre className="trace-body">{JSON.stringify(t.diff || t.metadata || {}, null, 2)}</pre>
        </Card>
      ))}
    </div>
  );
}

/* ── Anomalies Tab ── */
function AnomaliesTab({ anomalies }) {
  if (!anomalies?.length) {
    return (
      <EmptyState
        icon={CheckCircle2}
        title="All clear!"
        description="No anomalies detected. The engine fleet is operating normally."
      />
    );
  }
  return (
    <div className="anomalies-list">
      {anomalies.map(a => (
        <Card key={a.id} className="anomaly-card">
          <div className="anomaly-header">
            <AlertTriangle size={16} className="anomaly-icon" />
            <strong>{a.type}</strong>
            <span className="anomaly-time">{new Date(a.detected_at).toLocaleString()}</span>
          </div>
          <p className="anomaly-desc">{a.description}</p>
        </Card>
      ))}
    </div>
  );
}

/* ── Connectors Tab ── */
function ConnectorsTab({ connectors, onAdd }) {
  const PLATFORMS = [
    { id: 'google_calendar', label: 'Google Calendar', Icon: Clock },
    { id: 'gmail', label: 'Gmail', Icon: Wifi },
    { id: 'notion', label: 'Notion', Icon: Database },
  ];

  return (
    <div className="connectors-view">
      <Card className="connector-add-card">
        <h3>Add Data Source</h3>
        <div className="connector-add-grid">
          {PLATFORMS.map(p => (
            <ActionBtn
              key={p.id}
              variant="secondary"
              icon={p.Icon}
              onClick={() => onAdd(p.id)}
            >
              {p.label}
            </ActionBtn>
          ))}
        </div>
      </Card>

      <h3 className="connector-section-title">Active Connectors</h3>
      {connectors?.length === 0 ? (
        <EmptyState icon={Plug} title="No connectors configured" description="Add a data source above to start syncing." />
      ) : (
        <div className="connectors-grid">
          {connectors.map(c => (
            <Card key={c.id} className="connector-card">
              <div className="connector-header">
                <strong>{c.platform}</strong>
                <Badge intent={c.status === 'active' ? 'positive' : c.status === 'error' ? 'negative' : 'warning'}>
                  {c.status}
                </Badge>
              </div>
              <div className="connector-meta">
                <Clock size={12} />
                Added: {new Date(c.created_at).toLocaleDateString()}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
