/** ✦ Krytz — Inspector Screen (v3: premium data platform UI)
 *
 * Observability, causality graph, and engine health.
 * Also manages connectors (Layer 5 gap).
 */
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { inspector } from '../services/api';
import useAuthStore from '../stores/authStore';
import { Card, MetricCard, Badge, ActionBtn, PageLoader, EmptyState } from '../components/ui/UiKit';
import { Background, Controls, MarkerType, MiniMap, ReactFlow } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { 
  Heart, GitBranch, Activity, AlertTriangle, Plug, Lock,
  Server, Database, Cpu, Wifi, Clock, CheckCircle2, XCircle, 
  RefreshCw
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

const CONNECTOR_LABELS = {
  google_calendar: 'Google Calendar',
  gmail: 'Gmail',
  notion: 'Notion',
};

const CONNECTOR_PLATFORMS = [
  { id: 'google_calendar', label: CONNECTOR_LABELS.google_calendar, Icon: Clock },
  { id: 'gmail', label: CONNECTOR_LABELS.gmail, Icon: Wifi },
  { id: 'notion', label: CONNECTOR_LABELS.notion, Icon: Database },
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

  const loadData = useCallback(async () => {
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
  }, [activeTab]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (!hasPlatformAccess) {
        setLoading(false);
        return;
      }
      loadData();
    }, 0);
    return () => clearTimeout(timer);
  }, [hasPlatformAccess, loadData]);

  async function handleAddConnector(platform) {
    if (!platform || !hasPlatformAccess) return;
    try {
      const config = promptConnectorConfig(platform);
      if (!config) return;
      await inspector.registerConnector(platform, config);
      await loadData();
    } catch (err) {
      alert(`Failed to connect ${CONNECTOR_LABELS[platform] || platform}: ${err.message}`);
    }
  }

  async function handleSyncConnector(platform) {
    if (!platform || !hasPlatformAccess) return;
    try {
      const result = await inspector.syncConnector(platform);
      await loadData();
      alert(`Synced ${CONNECTOR_LABELS[platform] || platform}: ${result.importedCount || 0} items imported.`);
    } catch (err) {
      alert(`Failed to sync ${CONNECTOR_LABELS[platform] || platform}: ${err.message}`);
    }
  }

  async function handleDisconnectConnector(platform) {
    if (!platform || !hasPlatformAccess) return;
    const label = CONNECTOR_LABELS[platform] || platform;
    if (!window.confirm(`Disconnect ${label}?`)) return;
    try {
      await inspector.disconnectConnector(platform);
      await loadData();
    } catch (err) {
      alert(`Failed to disconnect ${label}: ${err.message}`);
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
            {activeTab === 'connectors' && (
              <ConnectorsTab
                connectors={data.connectors}
                onAdd={handleAddConnector}
                onSync={handleSyncConnector}
                onDisconnect={handleDisconnectConnector}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

function promptConnectorConfig(platform) {
  const label = CONNECTOR_LABELS[platform] || platform;
  const raw = window.prompt(`${label} access token or JSON config`);
  if (raw === null) return null;
  const trimmed = raw.trim();
  if (!trimmed) throw new Error('Connector credential is required');
  if (!trimmed.startsWith('{')) return { accessToken: trimmed };
  return JSON.parse(trimmed);
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
  const flow = buildInspectorFlow(graph);
  return (
    <div className="graph-view">
      <div className="graph-stats-row">
        <MetricCard title="Nodes" value={graph.nodes?.length || 0} icon={GitBranch} />
        <MetricCard title="Edges" value={graph.edges?.length || 0} icon={Activity} />
      </div>
      <Card className="graph-flow-card">
        {flow.nodes.length === 0 ? (
          <p className="health-no-data">No connected graph nodes yet.</p>
        ) : (
          <ReactFlow
            className="graph-flow"
            nodes={flow.nodes}
            edges={flow.edges}
            fitView
            minZoom={0.45}
            maxZoom={1.6}
            nodesDraggable={false}
            nodesConnectable={false}
            proOptions={{ hideAttribution: true }}
          >
            <MiniMap pannable zoomable nodeStrokeWidth={3} />
            <Controls showInteractive={false} />
            <Background gap={16} size={1} color="rgba(148, 163, 184, 0.16)" />
          </ReactFlow>
        )}
      </Card>
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
function ConnectorsTab({ connectors, onAdd, onSync, onDisconnect }) {
  return (
    <div className="connectors-view">
      <Card className="connector-add-card">
        <h3>Add Data Source</h3>
        <div className="connector-add-grid">
          {CONNECTOR_PLATFORMS.map(p => (
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
          {connectors.map(c => {
            const platform = c.platform || c.adapter_name || c.name;
            const label = c.displayName || CONNECTOR_LABELS[platform] || platform;
            const status = c.status || c.state || 'disconnected';
            const isConnected = status === 'connected' || status === 'syncing';
            return (
              <Card key={c.id || platform} className="connector-card">
                <div className="connector-header">
                  <strong>{label}</strong>
                  <Badge intent={status === 'connected' ? 'positive' : status === 'error' ? 'negative' : 'warning'}>
                    {status}
                  </Badge>
                </div>
                <div className="connector-meta">
                  <Clock size={12} />
                  {c.created_at ? `Added: ${new Date(c.created_at).toLocaleDateString()}` : 'Not connected'}
                </div>
                <p className="connector-detail">{connectorMetaText(c.meta)}</p>
                <div className="connector-actions">
                  {isConnected ? (
                    <>
                      <ActionBtn variant="ghost" icon={RefreshCw} onClick={() => onSync(platform)} className="btn-sm">
                        Sync
                      </ActionBtn>
                      <ActionBtn variant="ghost" icon={XCircle} onClick={() => onDisconnect(platform)} className="btn-sm">
                        Disconnect
                      </ActionBtn>
                    </>
                  ) : (
                    <ActionBtn variant="secondary" icon={Plug} onClick={() => onAdd(platform)} className="btn-sm">
                      Connect
                    </ActionBtn>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function connectorMetaText(meta = {}) {
  const details = [
    meta.email,
    meta.calendarSummary,
    meta.workspaceName,
    meta.lastSyncAt ? `Last sync: ${new Date(meta.lastSyncAt).toLocaleString()}` : null,
    Number.isFinite(meta.lastSyncCount) ? `Items: ${meta.lastSyncCount}` : null,
  ].filter(Boolean);
  return details.join(' | ') || 'Awaiting credentials';
}

function buildInspectorFlow(graph, { nodeLimit = 18, edgeLimit = 32 } = {}) {
  const baseNodes = (graph?.nodes || []).slice(0, nodeLimit);
  const positions = new Map(
    baseNodes.map((node, index) => {
      const column = index % 3;
      const row = Math.floor(index / 3);
      return [node.id, { x: 90 + column * 220, y: 70 + row * 96, node }];
    })
  );

  const nodes = [...positions.entries()].map(([id, item]) => ({
    id,
    position: { x: item.x, y: item.y },
    data: { label: truncate(item.node.label, 20) },
    draggable: false,
    style: {
      width: 160,
      minHeight: 44,
      borderRadius: 12,
      border: `1px solid ${item.node.state === 'DONE' ? 'rgba(34, 197, 94, 0.38)' : item.node.blocker ? 'rgba(212, 155, 75, 0.45)' : 'rgba(255, 255, 255, 0.1)'}`,
      background: item.node.state === 'DONE' ? 'rgba(34, 197, 94, 0.12)' : item.node.blocker ? 'rgba(212, 155, 75, 0.12)' : 'rgba(15, 23, 42, 0.92)',
      color: '#f8fafc',
      fontSize: '12px',
      fontWeight: 600,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '10px 12px',
      textAlign: 'center',
      lineHeight: 1.35,
    },
  }));

  const edges = (graph?.edges || [])
    .filter(edge => positions.has(edge.source) && positions.has(edge.target))
    .slice(0, edgeLimit)
    .map(edge => ({
      id: edge.id || `${edge.source}-${edge.target}`,
      source: edge.source,
      target: edge.target,
      label: edge.label || edge.type || '',
      type: 'smoothstep',
      markerEnd: { type: MarkerType.ArrowClosed, color: 'rgba(148, 163, 184, 0.78)' },
      style: { stroke: 'rgba(148, 163, 184, 0.7)', strokeWidth: 1.4 },
      labelStyle: { fill: 'rgba(226, 232, 240, 0.88)', fontSize: 10, fontWeight: 600 },
      labelBgStyle: { fill: 'rgba(15, 23, 42, 0.88)', fillOpacity: 1 },
      labelBgPadding: [6, 3],
      labelBgBorderRadius: 6,
    }));

  return { nodes, edges };
}

function truncate(value, max = 80) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}
