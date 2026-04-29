import { useEffect, useState, useRef, useCallback } from 'react';
import { Link, useParams } from 'react-router-dom';
import { analytics, categories, dataExport, inspector, items, platform } from '../services/api';
import useAuthStore from '../stores/authStore';
import { Card, MetricCard, ProgressRing } from '../components/ui/UiKit';
import { Database, Users, FileText, LayoutList } from 'lucide-react';
import './PlatformScreen.css';

// Role hierarchy â€” who can see which dashboards
const ROLE_ACCESS = {
  founder:  ['founder', 'operator', 'devops', 'coder', 'support'],
  operator: ['operator', 'support'],
  devops:   ['devops'],
  coder:    ['coder'],
  support:  ['support'],
  member:   [], // no platform access
};

const PLATFORM_ROLES = ['founder', 'operator', 'devops', 'coder', 'support'];

const roleMeta = {
  founder: {
    label: 'Founder',
    title: 'Founder command dashboard',
    promise: 'Business, growth, risk, and governance in one operating view.',
    modules: [
      ['Business pulse', 'Users, entries, computed items, and activation health.'],
      ['Governance board', 'RBAC gaps, audit readiness, role coverage, and policy backlog.'],
      ['Revenue posture', 'Tier split, cost posture, plan limits, and billing readiness.'],
      ['Decision queue', 'What must be decided before this can become a real platform.'],
    ],
  },
  operator: {
    label: 'Operator',
    title: 'Operator control dashboard',
    promise: 'Daily platform operations, customer health, and execution hygiene.',
    modules: [
      ['Operations queue', 'Open users, stale signals, support pressure, and platform tasks.'],
      ['Customer state', 'Accounts, memory volume, notifications, and user-facing health.'],
      ['Runbook status', 'Backup, restore, support handoff, data export, and incident process.'],
      ['Quality control', 'Synthetic users, test coverage, smoke checks, and release readiness.'],
    ],
  },
  devops: {
    label: 'DevOps',
    title: 'DevOps infrastructure dashboard',
    promise: 'Runtime health, deploy surface, storage, backups, and observability.',
    modules: [
      ['Service health', 'API, client, Postgres, Redis, MinIO, and health endpoints.'],
      ['Storage operations', 'Database tables, file bucket, Redis volume, and retention needs.'],
      ['Deploy control', 'Environment variables, rollback path, build status, and release gates.'],
      ['Observability', 'Logs, metrics, alerts, queue depth, and future tracing hooks.'],
    ],
  },
  coder: {
    label: 'Coder',
    title: 'Coder implementation dashboard',
    promise: 'Schema, API, runtime mounts, package diffs, and build gaps for engineers.',
    modules: [
      ['API contract', 'Auth, capture, plan, explain, action, platform overview.'],
      ['Schema map', 'v3 SQL tables, platform tables, row counts, and drift markers.'],
      ['Runtime package', 'Context-only mounts, diffs, build artifacts, and non-repo policy.'],
      ['Backlog to code', 'RBAC enforcement, audit middleware, admin invites, and support tools.'],
    ],
  },
  support: {
    label: 'Support',
    title: 'Support diagnostics dashboard',
    promise: 'Customer diagnostics without unsafe data mutation.',
    modules: [
      ['Account lookup', 'User count, session footprint, tier state, and support identity.'],
      ['Data diagnostics', 'Entries/items/notifications/rules without editing customer data.'],
      ['User workflows', 'Export request, delete request, password/session issue, incident escalation.'],
      ['Audit backed actions', 'Every support action must become an audit event before production.'],
    ],
  },
};

export default function PlatformScreen() {
  const { role } = useParams();
  const user = useAuthStore(s => s.user);
  const userRole = user?.platformRole || user?.role || 'member';
  const allowedRoles = ROLE_ACCESS[userRole] || [];
  const hasPlatformAccess = allowedRoles.length > 0 || PLATFORM_ROLES.includes(userRole);
  const activeRole = roleMeta[role] && allowedRoles.includes(role) ? role : null;
  const blockedRole = roleMeta[role] && !allowedRoles.includes(role) ? role : null;
  const [state, setState] = useState({ loading: true, overview: null, rolePayload: null, workspace: null, actionResult: null, actionLoading: '', error: '', accounts: [] });
  const healthIntervalRef = useRef(null);

  // Fetch accounts for dynamic email resolution (replaces hardcoded emails)
  const loadAccounts = useCallback(async () => {
    try {
      const res = await platform.accounts();
      return res?.accounts || res || [];
    } catch { return []; }
  }, []);

  useEffect(() => {
    async function load() {
      if (!hasPlatformAccess) {
        setState(prev => ({ ...prev, loading: false, error: 'Access denied: insufficient platform privileges.' }));
        return;
      }
      if (blockedRole) {
        setState(prev => ({ ...prev, loading: false, overview: null, rolePayload: null, workspace: null, error: '' }));
        return;
      }
      try {
        setState(prev => ({ ...prev, loading: true, error: '', actionResult: null }));
        const [overview, accounts, workspace] = await Promise.all([
          platform.overview(),
          loadAccounts(),
          activeRole ? loadRoleWorkspace(activeRole) : Promise.resolve(null),
        ]);
        const rolePayload = activeRole ? await platform.roleDashboard(activeRole) : null;
        setState(prev => ({ ...prev, loading: false, overview, rolePayload, workspace, accounts, error: '' }));
      } catch (error) {
        setState(prev => ({ ...prev, loading: false, rolePayload: null, workspace: null, error: error.message }));
      }
    }
    load();
  }, [activeRole, blockedRole, hasPlatformAccess, loadAccounts]);

  // Auto-refresh service health every 30s when on devops dashboard
  useEffect(() => {
    if (activeRole === 'devops' || activeRole === 'operator') {
      healthIntervalRef.current = setInterval(async () => {
        try {
          const health = await platform.serviceHealth();
          setState(prev => ({
            ...prev,
            overview: prev.overview ? { ...prev.overview, serviceHealth: health } : prev.overview,
          }));
        } catch { /* silent */ }
      }, 30_000);
    }
    return () => clearInterval(healthIntervalRef.current);
  }, [activeRole]);

  // Auth gate: block unauthorized users
  if (!hasPlatformAccess) {
    return (
      <div className="platform-screen page-container">
        <div className="platform-gate">
          <div className="platform-gate-icon">ðŸ”’</div>
          <h2>Platform Access Required</h2>
          <p>Your account ({user?.email || 'unknown'}) does not have platform privileges.</p>
          <p className="platform-gate-hint">Contact a founder or operator to request access.</p>
          <Link to="/" className="btn btn-primary">â† Back to Command Center</Link>
        </div>
      </div>
    );
  }

  if (blockedRole) {
    return (
      <div className="platform-screen page-container">
        <div className="platform-gate">
          <div className="platform-gate-icon">LOCKED</div>
          <h2>Access denied</h2>
          <p>Your {userRole} role cannot open the {roleMeta[blockedRole].label} dashboard.</p>
          <p className="platform-gate-hint">Use an allowed dashboard or ask a founder to update your platform role.</p>
          <Link to="/platform/hub" className="btn btn-primary">Back to Platform Hub</Link>
        </div>
      </div>
    );
  }

  const overview = state.overview;
  const heroEyebrow = activeRole ? `${roleMeta[activeRole].label} role dashboard` : 'Platform operating hub';

  return (
    <div className="platform-screen page-container">
      <header className="platform-hero">
        <p className="eyebrow">{heroEyebrow}</p>
        {activeRole ? (
          <>
            <h1>{roleMeta[activeRole].title}</h1>
            <p>{roleMeta[activeRole].promise} Live queues, workspace signals, and executable role actions are loaded into this view.</p>
          </>
        ) : (
          <>
            <h1>Platform operating hub</h1>
            <p>
              Role dashboards, service ownership, storage, audit, and governance surfaces for the platform team.
            </p>
          </>
        )}
      </header>

      {state.error && <div className="command-error">{state.error}</div>}
      {state.loading && <div className="platform-card skeleton platform-loading" />}

      {overview && (
        <>
          <RoleSwitch activeRole={activeRole} allowedRoles={allowedRoles} />

          {activeRole ? (
            <RoleDashboard
              role={activeRole}
              overview={overview}
              rolePayload={state.rolePayload}
              workspace={state.workspace}
              actionResult={state.actionResult}
              actionLoading={state.actionLoading}
              accounts={state.accounts}
              onRunAction={async action => {
                setState(prev => ({ ...prev, actionLoading: action, actionResult: null, error: '' }));
                try {
                  const result = await runPlatformAction(action, activeRole, state.accounts, state.workspace);
                  const [overview, workspace] = await Promise.all([
                    platform.overview(),
                    loadRoleWorkspace(activeRole),
                  ]);
                  setState(prev => ({ ...prev, overview, workspace, actionLoading: '', actionResult: { action, result }, error: '' }));
                } catch (error) {
                  setState(prev => ({ ...prev, actionLoading: '', actionResult: null, error: error.message }));
                }
              }}
            />
          ) : (
            <>
              <PlatformDataStrip overview={overview} />
              <PlatformHub overview={overview} allowedRoles={allowedRoles} />
            </>
          )}
        </>
      )}
    </div>
  );
}

async function safeCall(fn, fallback) {
  try {
    return await fn();
  } catch (error) {
    return { error: error.message, fallback };
  }
}

async function loadRoleWorkspace(role) {
  const wantsOps = ['founder', 'operator', 'devops', 'coder', 'support'].includes(role);
  if (!wantsOps) return null;

  const [
    analyticsOverview,
    activeItems,
    blockers,
    completions,
    categoryList,
    inspectorHealth,
    traces,
    decisions,
    anomalies,
    graph,
    connectors,
  ] = await Promise.all([
    safeCall(() => analytics.overview(), null),
    safeCall(() => items.list({ limit: 8, sort: 'priority' }), { items: [], meta: {} }),
    safeCall(() => items.list({ blocker: 'true', limit: 8, sort: 'recent' }), { items: [], meta: {} }),
    safeCall(() => items.completions(7), null),
    safeCall(() => categories.list(), { categories: [] }),
    safeCall(() => inspector.health(), null),
    safeCall(() => inspector.traces(8), { traces: [] }),
    safeCall(() => inspector.decisions(8), { decisions: [] }),
    safeCall(() => inspector.anomalies(8), { anomalies: [] }),
    safeCall(() => inspector.graph(), { nodes: [], edges: [] }),
    safeCall(() => inspector.connectors(), { connectors: [] }),
  ]);

  return {
    analytics: analyticsOverview?.fallback ?? analyticsOverview,
    activeItems: activeItems?.fallback ?? activeItems,
    blockers: blockers?.fallback ?? blockers,
    completions: completions?.fallback ?? completions,
    categories: categoryList?.fallback ?? categoryList,
    inspectorHealth: inspectorHealth?.fallback ?? inspectorHealth,
    traces: traces?.fallback ?? traces,
    decisions: decisions?.fallback ?? decisions,
    anomalies: anomalies?.fallback ?? anomalies,
    graph: graph?.fallback ?? graph,
    connectors: connectors?.fallback ?? connectors,
    errors: [
      analyticsOverview,
      activeItems,
      blockers,
      completions,
      categoryList,
      inspectorHealth,
      traces,
      decisions,
      anomalies,
      graph,
      connectors,
    ].filter(result => result?.error).map(result => result.error),
  };
}

// Resolve a real account email dynamically instead of hardcoded synthetic emails
function resolveAccountEmail(accounts, index = 0) {
  if (accounts?.length > index) return accounts[index].email;
  return `user.${Date.now()}@Krytz.local`; // fallback
}

function resolveGrantTargetEmail(accounts) {
  const supportAccount = accounts?.find(account => account.role === 'support');
  if (supportAccount) return supportAccount.email;

  const nonOwnerAccount = accounts?.find(account => !['founder', 'operator'].includes(account.role));
  if (nonOwnerAccount) return nonOwnerAccount.email;

  throw new Error('No safe non-owner account available for grant testing');
}

async function runPlatformAction(action, role, accounts = [], workspace = {}) {
  if (action === 'accounts') return platform.accounts();
  if (action === 'audit') return platform.audit();
  if (action === 'schema') return platform.schema();
  if (action === 'health') return platform.serviceHealth();
  if (action === 'role') return platform.roleDashboard(role);
  if (action === 'invite') return platform.invite(`invite.${Date.now()}@Krytz.local`, role === 'founder' ? 'operator' : role);
  if (action === 'grant') return platform.grant(resolveGrantTargetEmail(accounts), 'support');
  if (action === 'support-note') return platform.supportNote(resolveAccountEmail(accounts, 0), `Support diagnostic note from ${role} dashboard`);
  if (action === 'export-request') return platform.exportRequest(resolveAccountEmail(accounts, 0), `Export review requested from ${role} dashboard`);
  if (action === 'delete-request') return platform.deleteRequest(resolveAccountEmail(accounts, 1), `Deletion review requested from ${role} dashboard`);
  if (action === 'backup-run') return platform.backupRun();
  if (action === 'deploy-run') return platform.deployRun('local', 'api', 'role-workflow');
  if (action === 'observability-event') return platform.observabilityEvent(`Observability event from ${role} dashboard`, 'info');
  if (action === 'analytics-overview') return analytics.overview();
  if (action === 'categories') return categories.list();
  if (action === 'export-json') return dataExport.download();
  if (action === 'export-csv') return dataExport.downloadCSV();
  if (action === 'inspector-health') return inspector.health();
  if (action === 'inspector-traces') return inspector.traces(20);
  if (action === 'inspector-decisions') return inspector.decisions(20);
  if (action === 'inspector-graph') return inspector.graph();
  if (action === 'inspector-anomalies') return inspector.anomalies(20);
  if (action === 'connector-gmail') return inspector.registerConnector('gmail', { source: 'platform-workflow', role });
  if (action === 'connector-calendar') return inspector.registerConnector('google_calendar', { source: 'platform-workflow', role });
  if (action === 'complete-first-open') {
    const first = workspace?.activeItems?.items?.[0];
    if (!first) throw new Error('No open item available to complete');
    return items.markDone(first.id);
  }
  if (action === 'clear-first-blocker') {
    const first = workspace?.blockers?.items?.[0];
    if (!first) throw new Error('No blocker item available to clear');
    return items.toggleBlocker(first.id, false);
  }
  if (action === 'create-operator-item') {
    return items.create({ text: `Platform follow-up from ${role} workflow`, category: 'operations', priority: 0.7 });
  }
  throw new Error(`Unknown platform action: ${action}`);
}

function PlatformHub({ overview, allowedRoles }) {
  return (
    <>
      <RoleDashboardMatrix overview={overview} allowedRoles={allowedRoles} />

      <PlatformOperatingMap overview={overview} allowedRoles={allowedRoles} />

      <section className="platform-section">
        <div className="platform-section-head">
          <h2>Role logins</h2>
          <span>platform accounts</span>
        </div>
        <div className="login-table">
          {overview.platformAccounts.map(account => (
            <article className="platform-card login-card" key={`${account.email}-${account.role}`}>
              <span>{account.role}</span>
              <h3>{account.email}</h3>
              <p>{account.name || 'Unnamed platform account'} / {account.orgName}</p>
              {/* Credentials hidden â€” no raw passwords in UI */}
              <code className="login-credential-masked">â—â—â—â—â—â—â—â—â—â—</code>
            </article>
          ))}
        </div>
      </section>

      <SharedPlatformSections overview={overview} />
    </>
  );
}

function RoleDashboardMatrix({ overview, allowedRoles }) {
  const roles = Object.keys(roleMeta).filter(key => allowedRoles.includes(key));
  return (
    <section className="platform-section role-dashboard-matrix">
      <div className="platform-section-head">
        <div>
          <h2>Role KPI dashboards</h2>
          <p>Each platform user lands on a dedicated dashboard with role-specific cards, gauges, and drill-down bars.</p>
        </div>
        <span>{roles.length} dashboards</span>
      </div>
      <div className="dashboard-grid dashboard-grid--matrix">
        {roles.map(key => (
          <RoleRouteCard key={key} role={key} overview={overview} />
        ))}
      </div>
    </section>
  );
}

function PlatformDataStrip({ overview }) {
  return (
    <section className="platform-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 'var(--space-4)', marginBottom: 'var(--space-8)' }}>
      <MetricCard title="Tables" value={overview.storage.database.tableCount} trendValue="Postgres public schema" icon={Database} />
      <MetricCard title="Users" value={overview.storage.database.selectedCounts.users} trendValue="local dev database" icon={Users} />
      <MetricCard title="Entries" value={overview.storage.database.selectedCounts.entries} trendValue="raw captured memory" icon={FileText} />
      <MetricCard title="Items" value={overview.storage.database.selectedCounts.items} trendValue="computed operating state" icon={LayoutList} />
    </section>
  );
}

function PlatformOperatingMap({ overview, allowedRoles }) {
  const counts = overview.storage?.database?.selectedCounts || {};
  const rows = [
    {
      plane: 'customer operations',
      owner: allowedRoles.includes('operator') ? 'operator' : 'founder',
      signal: counts.users ?? 0,
      label: 'accounts',
      detail: 'Activation, support load, export/delete requests, and account state.',
      route: allowedRoles.includes('operator') ? '/platform/operator' : '/platform/founder',
    },
    {
      plane: 'product intelligence',
      owner: allowedRoles.includes('coder') ? 'coder' : 'founder',
      signal: counts.items ?? 0,
      label: 'items',
      detail: 'Capture to extraction to decision output must be inspectable and fixable.',
      route: allowedRoles.includes('coder') ? '/platform/coder' : '/platform/founder',
    },
    {
      plane: 'runtime control',
      owner: allowedRoles.includes('devops') ? 'devops' : 'founder',
      signal: overview.serviceHealth?.status || 'local',
      label: 'health',
      detail: 'Deploys, backups, connectors, and observability need explicit ownership.',
      route: allowedRoles.includes('devops') ? '/platform/devops' : '/platform/founder',
    },
    {
      plane: 'trust and governance',
      owner: allowedRoles.includes('support') ? 'support' : 'founder',
      signal: overview.auditEvents?.length ?? 0,
      label: 'audit rows',
      detail: 'Every privileged action should leave evidence and route to the right owner.',
      route: allowedRoles.includes('support') ? '/platform/support' : '/platform/founder',
    },
  ];

  return (
    <section className="platform-operating-map">
      <div className="platform-section-head">
        <div>
          <h2>Platform operating map</h2>
          <p>Backend-side depth should be ownership plus action paths, not only KPI cards.</p>
        </div>
        <span>{rows.length} operating planes</span>
      </div>
      <div className="platform-plane-grid">
        {rows.map(row => (
          <Link className="platform-plane-card" key={row.plane} to={row.route}>
            <span>{row.plane}</span>
            <div>
              <strong>{row.signal}</strong>
              <em>{row.label}</em>
            </div>
            <p>{row.detail}</p>
            <code>owner: {row.owner}</code>
          </Link>
        ))}
      </div>
    </section>
  );
}

function RoleSwitch({ activeRole, allowedRoles }) {
  return (
    <nav className="role-switch" aria-label="Platform role dashboards">
      <Link className={!activeRole ? 'active' : ''} to="/platform/hub">Hub</Link>
      {Object.entries(roleMeta)
        .filter(([key]) => allowedRoles.includes(key))
        .map(([key, meta]) => (
          <Link className={activeRole === key ? 'active' : ''} key={key} to={`/platform/${key}`}>
            {meta.label}
          </Link>
        ))}
    </nav>
  );
}

function RoleRouteCard({ role, overview }) {
  const meta = roleMeta[role];
  const model = overview ? buildRoleKpiModel(role, overview, null, null) : null;
  const leadCard = model?.cards?.[0];
  return (
    <Link className={`platform-card role-route-card role-route-card--${role}`} to={`/platform/${role}`}>
      <div className="role-route-topline">
        <span>{role}</span>
        <strong>{model?.gauge?.value ?? 'open'}</strong>
      </div>
      <h3>{meta.title}</h3>
      <p>{model?.title || meta.promise}</p>
      {model && (
        <>
          <div className="role-route-mini-kpis">
            {model.cards.slice(0, 4).map(card => (
              <div key={card.label}>
                <span>{card.label}</span>
                <strong>{card.value}</strong>
              </div>
            ))}
          </div>
          <div className="role-route-bars">
            {model.chart.rows.slice(0, 3).map(row => (
              <div key={row.label}>
                <span>{row.label}</span>
                <i><b style={{ width: `${row.percent}%` }} /></i>
                <strong>{row.value}</strong>
              </div>
            ))}
          </div>
          <small>{leadCard?.note || model.subtitle}</small>
        </>
      )}
      <code>open /platform/{role}</code>
    </Link>
  );
}

function RoleDashboard({ role, overview, rolePayload, workspace, actionResult, actionLoading, onRunAction }) {
  const meta = roleMeta[role];
  return (
    <>
      <RoleKpiDashboard
        role={role}
        overview={overview}
        rolePayload={rolePayload}
        workspace={workspace}
        onRunAction={onRunAction}
        actionLoading={actionLoading}
      />
      <section className="platform-section role-workflow-shell">
        <div className="platform-section-head">
          <h2>{meta.label} workflow console</h2>
          <span>live queues + executable actions</span>
        </div>
        <RoleWorkflow
          role={role}
          overview={overview}
          rolePayload={rolePayload}
          workspace={workspace}
          onRunAction={onRunAction}
          actionLoading={actionLoading}
        />
      </section>
      <ActionResultPanel actionResult={actionResult} />
      <SharedPlatformSections overview={overview} compact />
    </>
  );
}

function RoleKpiDashboard({ role, overview, rolePayload, workspace, onRunAction, actionLoading }) {
  const model = buildRoleKpiModel(role, overview, rolePayload, workspace);
  return (
    <section className={`role-kpi-board role-kpi-board--${role}`}>
      <div className="role-kpi-topline">
        <div>
          <span>{model.kicker}</span>
          <h2>{model.title}</h2>
          <p>{model.subtitle}</p>
        </div>
        <button
          className="btn btn-primary"
          disabled={actionLoading === model.primaryAction}
          onClick={() => onRunAction(model.primaryAction)}
        >
          {actionLoading === model.primaryAction ? 'Running...' : model.primaryActionLabel}
        </button>
      </div>

      <div className="role-kpi-layout">
        <div className="role-kpi-card-grid">
          {model.cards.map(card => (
            <article className="role-kpi-card" key={card.label}>
              <span>{card.label}</span>
              <strong>{card.value}</strong>
              <p>{card.note}</p>
            </article>
          ))}
        </div>

        <article className="role-kpi-gauge-container">
          <ProgressRing 
            percentage={model.gauge.percent} 
            size={142} 
            strokeWidth={12}
            label={model.gauge.value}
            sublabel={model.gauge.label}
            color="var(--accent-primary)"
          />
        </article>

        <article className="role-kpi-chart">
          <div className="role-kpi-chart-head">
            <span>{model.chart.title}</span>
            <strong>{model.chart.value}</strong>
          </div>
          <div className="role-kpi-bars">
            {model.chart.rows.map(row => (
              <button
                key={row.label}
                disabled={!row.action || actionLoading === row.action}
                onClick={() => row.action && onRunAction(row.action)}
              >
                <span>{row.label}</span>
                <i><b style={{ width: `${row.percent}%` }} /></i>
                <strong>{row.value}</strong>
              </button>
            ))}
          </div>
        </article>
      </div>
    </section>
  );
}

function buildRoleKpiModel(role, overview, rolePayload, workspace) {
  const counts = overview.storage?.database?.selectedCounts || {};
  const analyticsSummary = workspace?.analytics?.summary || {};
  const activeItems = workspace?.activeItems?.items || [];
  const blockers = workspace?.blockers?.items || [];
  const traces = workspace?.traces?.traces || [];
  const decisions = workspace?.decisions?.decisions || [];
  const anomalies = workspace?.anomalies?.anomalies || [];
  const connectors = workspace?.connectors?.connectors || [];
  const auditCount = overview.auditEvents?.length || 0;
  const tableCount = overview.storage?.database?.tableCount || 0;
  const serviceCount = overview.serviceHealth?.services?.length || overview.services?.length || 0;
  const workflowCards = rolePayload?.cards || [];

  const percent = (value, max) => Math.max(4, Math.min(100, Math.round((Number(value || 0) / Math.max(Number(max || 1), 1)) * 100)));
  const rowsFrom = (rows, fallbackAction) => rows.map(row => ({
    label: row.label,
    value: row.value,
    percent: row.percent ?? percent(row.value, rows.reduce((max, r) => Math.max(max, Number(r.value) || 0), 1)),
    action: row.action || fallbackAction,
  }));

  const models = {
    founder: {
      kicker: 'founder cockpit',
      title: 'Growth, risk, and governance at a glance.',
      subtitle: 'Founder should see business health first, then drill into operations, roles, and audit.',
      primaryAction: 'audit',
      primaryActionLabel: 'Review audit',
      gauge: { value: counts.users ?? 0, label: 'users', percent: percent(counts.users, 50), note: 'Activation base in the local platform database.' },
      cards: [
        { label: 'Entries', value: counts.entries ?? 0, note: 'Raw captured memory volume.' },
        { label: 'Items', value: counts.items ?? 0, note: 'Computed product state.' },
        { label: 'Audit', value: auditCount, note: 'Governance events visible.' },
        { label: 'Roles', value: overview.platformAccounts?.length ?? 0, note: 'Seeded platform accounts.' },
      ],
      chart: {
        title: 'Business mix',
        value: 'live',
        rows: rowsFrom([
          { label: 'Users', value: counts.users ?? 0, action: 'accounts' },
          { label: 'Entries', value: counts.entries ?? 0, action: 'analytics-overview' },
          { label: 'Items', value: counts.items ?? 0, action: 'analytics-overview' },
          { label: 'Audit', value: auditCount, action: 'audit' },
        ]),
      },
    },
    operator: {
      kicker: 'operator board',
      title: 'Daily execution, customer health, and blocker movement.',
      subtitle: 'Operator dashboard starts with queues and throughput, not schema table counts.',
      primaryAction: 'create-operator-item',
      primaryActionLabel: 'Create ops item',
      gauge: { value: activeItems.length, label: 'active', percent: percent(activeItems.length, 20), note: 'Open work available for operational triage.' },
      cards: [
        { label: 'Blockers', value: blockers.length, note: 'Items needing operator movement.' },
        { label: 'Completed 7d', value: workspace?.completions?.totalCompleted ?? 0, note: 'Recent throughput.' },
        { label: 'Accounts', value: counts.users ?? 0, note: 'Customer state to support.' },
        { label: 'Categories', value: workspace?.categories?.categories?.length ?? 0, note: 'Work routing lanes.' },
      ],
      chart: {
        title: 'Ops pressure',
        value: analyticsSummary.openItems ?? activeItems.length,
        rows: rowsFrom([
          { label: 'Open work', value: activeItems.length, action: 'complete-first-open' },
          { label: 'Blockers', value: blockers.length, action: 'clear-first-blocker' },
          { label: 'Completed', value: workspace?.completions?.totalCompleted ?? 0, action: 'analytics-overview' },
          { label: 'Accounts', value: counts.users ?? 0, action: 'accounts' },
        ]),
      },
    },
    devops: {
      kicker: 'devops board',
      title: 'Runtime, deploy, backup, and integration readiness.',
      subtitle: 'DevOps should land on service health and operational controls, not user totals.',
      primaryAction: 'health',
      primaryActionLabel: 'Run health check',
      gauge: { value: overview.serviceHealth?.status || 'local', label: 'health', percent: overview.serviceHealth?.status === 'ok' ? 100 : 64, note: 'Current local service health posture.' },
      cards: [
        { label: 'Services', value: serviceCount, note: 'API, DB, cache, object storage.' },
        { label: 'Connectors', value: connectors.length, note: 'Registered integrations.' },
        { label: 'Anomalies', value: anomalies.length, note: 'Runtime signals returned.' },
        { label: 'Tables', value: tableCount, note: 'Backup and schema scope.' },
      ],
      chart: {
        title: 'Runtime lanes',
        value: serviceCount,
        rows: rowsFrom([
          { label: 'Services', value: serviceCount, action: 'health' },
          { label: 'Traces', value: traces.length, action: 'inspector-traces' },
          { label: 'Connectors', value: connectors.length, action: 'connector-gmail' },
          { label: 'Anomalies', value: anomalies.length, action: 'inspector-anomalies' },
        ]),
      },
    },
    coder: {
      kicker: 'coder board',
      title: 'Implementation evidence, schema, traces, and decision replay.',
      subtitle: 'Coder dashboard should expose the contract and failing paths before generic metrics.',
      primaryAction: 'schema',
      primaryActionLabel: 'Inspect schema',
      gauge: { value: tableCount, label: 'tables', percent: percent(tableCount, 60), note: 'API/data contract footprint.' },
      cards: [
        { label: 'Traces', value: traces.length, note: 'Engine and action traces.' },
        { label: 'Decisions', value: decisions.length, note: 'Decision engine replay surface.' },
        { label: 'Categories', value: workspace?.categories?.categories?.length ?? 0, note: 'User-facing taxonomy.' },
        { label: 'Audit', value: auditCount, note: 'Platform action evidence.' },
      ],
      chart: {
        title: 'Engineering evidence',
        value: traces.length + decisions.length,
        rows: rowsFrom([
          { label: 'Tables', value: tableCount, action: 'schema' },
          { label: 'Traces', value: traces.length, action: 'inspector-traces' },
          { label: 'Decisions', value: decisions.length, action: 'inspector-decisions' },
          { label: 'Audit', value: auditCount, action: 'audit' },
        ]),
      },
    },
    support: {
      kicker: 'support board',
      title: 'Customer diagnostics, notes, and data request intake.',
      subtitle: 'Support starts from accounts and safe workflow actions, not infrastructure metrics.',
      primaryAction: 'accounts',
      primaryActionLabel: 'Open accounts',
      gauge: { value: counts.users ?? 0, label: 'accounts', percent: percent(counts.users, 50), note: 'Customers available for diagnostics.' },
      cards: [
        { label: 'Entries', value: counts.entries ?? 0, note: 'Context available to inspect.' },
        { label: 'Items', value: counts.items ?? 0, note: 'Customer task footprint.' },
        { label: 'Blockers', value: blockers.length, note: 'Support-relevant blockers.' },
        { label: 'Audit', value: auditCount, note: 'Support action trail.' },
      ],
      chart: {
        title: 'Support load',
        value: counts.users ?? 0,
        rows: rowsFrom([
          { label: 'Accounts', value: counts.users ?? 0, action: 'accounts' },
          { label: 'Entries', value: counts.entries ?? 0, action: 'analytics-overview' },
          { label: 'Items', value: counts.items ?? 0, action: 'analytics-overview' },
          { label: 'Audit', value: auditCount, action: 'audit' },
        ]),
      },
    },
  };

  const model = models[role] || models.support;
  if (workflowCards.length > 0 && role === 'founder') {
    model.cards = workflowCards.slice(0, 4).map(card => ({ label: card.label, value: card.value, note: card.note }));
  }
  return model;
}

const actionLabels = {
  accounts: 'Open accounts',
  audit: 'Read audit',
  schema: 'Inspect schema',
  health: 'Run health',
  invite: 'Create invite',
  grant: 'Grant access',
  revoke: 'Revoke access',
  'support-note': 'Write note',
  'export-request': 'Request export',
  'delete-request': 'Request deletion review',
  'backup-run': 'Create backup manifest',
  'deploy-run': 'Queue deploy',
  'observability-event': 'Emit observability event',
  'analytics-overview': 'Refresh analytics',
  categories: 'Open categories',
  'export-json': 'Download JSON export',
  'export-csv': 'Download CSV export',
  'inspector-health': 'Inspect engines',
  'inspector-traces': 'Open traces',
  'inspector-decisions': 'Open decisions',
  'inspector-graph': 'Open graph',
  'inspector-anomalies': 'Open anomalies',
  'connector-gmail': 'Register Gmail connector',
  'connector-calendar': 'Register Calendar connector',
  'complete-first-open': 'Complete top item',
  'clear-first-blocker': 'Clear top blocker',
  'create-operator-item': 'Create ops item',
};

function RoleWorkflow({ role, overview, rolePayload, workspace, onRunAction, actionLoading }) {
  const workflow = buildRoleWorkflow(role, overview, rolePayload, workspace);
  return (
    <div className="role-workflow">
      <div className="workflow-command">
        <div>
          <span>{workflow.mode}</span>
          <h3>{workflow.title}</h3>
          <p>{workflow.brief}</p>
        </div>
        <div className="workflow-action-row">
          {workflow.primaryActions.map(action => (
            <button
              className="btn btn-secondary btn-sm"
              disabled={actionLoading === action}
              key={action}
              onClick={() => onRunAction(action)}
            >
              {actionLoading === action ? 'Running...' : actionLabels[action] || action}
            </button>
          ))}
        </div>
      </div>

      <div className="workflow-lane-grid">
        {workflow.lanes.map(lane => (
          <article className="workflow-lane" key={lane.title}>
            <div className="workflow-lane-head">
              <div>
                <span>{lane.kicker}</span>
                <h3>{lane.title}</h3>
              </div>
              <strong>{lane.value}</strong>
            </div>
            <p>{lane.description}</p>
            <div className="workflow-metrics">
              {lane.metrics.map(metric => (
                <div key={metric.label}>
                  <span>{metric.label}</span>
                  <strong>{metric.value}</strong>
                </div>
              ))}
            </div>
            <div className="workflow-queue">
              {lane.queue.length > 0 ? lane.queue.slice(0, 4).map(item => (
                <button
                  className="workflow-queue-item"
                  disabled={!lane.action || actionLoading === lane.action}
                  key={item.id || item.label}
                  onClick={() => lane.action && onRunAction(lane.action)}
                >
                  <strong>{item.label}</strong>
                  <span>{item.meta}</span>
                </button>
              )) : (
                <div className="workflow-empty">{lane.empty}</div>
              )}
            </div>
            <div className="workflow-action-row">
              {lane.actions.map(action => (
                <button
                  className="btn btn-secondary btn-sm"
                  disabled={actionLoading === action}
                  key={action}
                  onClick={() => onRunAction(action)}
                >
                  {actionLoading === action ? 'Running...' : actionLabels[action] || action}
                </button>
              ))}
            </div>
          </article>
        ))}
      </div>

      <div className="workflow-evidence">
        <div className="platform-section-head">
          <h2>Live evidence</h2>
          <span>{workflow.evidenceLabel}</span>
        </div>
        <div className="workflow-evidence-grid">
          {workflow.evidence.map(item => (
            <article className="evidence-card" key={item.label}>
              <span>{item.label}</span>
              <strong>{item.value}</strong>
              <p>{item.note}</p>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}

function buildRoleWorkflow(role, overview, rolePayload, workspace = {}) {
  const analyticsSummary = workspace?.analytics?.summary || {};
  const activeItems = workspace?.activeItems?.items || [];
  const blockers = workspace?.blockers?.items || [];
  const categoriesList = workspace?.analytics?.categories || workspace?.categories?.categories || [];
  const traces = workspace?.traces?.traces || [];
  const decisions = workspace?.decisions?.decisions || [];
  const anomalies = workspace?.anomalies?.anomalies || [];
  const connectors = workspace?.connectors?.connectors || [];
  const graph = workspace?.graph || {};
  const counts = overview.storage?.database?.selectedCounts || {};
  const roleModel = rolePayload?.dashboard || {};
  const fallbackMission = roleModel.mission || roleMeta[role].promise;

  const itemQueue = activeItems.map(item => ({
    id: item.id,
    label: item.canonical_text || item.text || 'Untitled item',
    meta: `${item.state || 'OPEN'} / ${item.category || 'uncategorized'} / p${formatNumber(item.priority)}`,
  }));
  const blockerQueue = blockers.map(item => ({
    id: item.id,
    label: item.canonical_text || item.text || 'Blocked item',
    meta: `${item.category || 'uncategorized'} / ${formatDate(item.deadline || item.dueDate || item.createdAt)}`,
  }));
  const categoryQueue = categoriesList.map(category => ({
    id: category.id || category.name,
    label: category.name || category.category || 'Uncategorized',
    meta: `${category.open ?? category.total ?? category.count ?? 0} active / ${category.done ?? 0} done`,
  }));
  const traceQueue = traces.map(trace => ({
    id: trace.id,
    label: trace.engine || trace.type || trace.source || 'Trace',
    meta: formatDate(trace.created_at || trace.createdAt),
  }));
  const decisionQueue = decisions.map(decision => ({
    id: decision.id,
    label: decision.decision_type || decision.action || decision.strategy || 'Decision',
    meta: `${decision.confidence ?? decision.score ?? 'n/a'} confidence / ${formatDate(decision.created_at || decision.createdAt)}`,
  }));
  const connectorQueue = connectors.map(connector => ({
    id: connector.id || connector.platform,
    label: connector.platform || 'Connector',
    meta: `${connector.status || 'unknown'} / ${formatDate(connector.created_at || connector.createdAt)}`,
  }));
  const anomalyQueue = anomalies.map(anomaly => ({
    id: anomaly.id,
    label: anomaly.type || anomaly.source || 'Anomaly',
    meta: `${anomaly.severity || 'info'} / ${formatDate(anomaly.detected_at || anomaly.createdAt)}`,
  }));

  const baseEvidence = [
    { label: 'Open items', value: analyticsSummary.openItems ?? activeItems.length ?? 0, note: 'From items + analytics overview.' },
    { label: 'Blockers', value: analyticsSummary.blockers ?? blockers.length ?? 0, note: 'Actionable queue, not a static stat.' },
    { label: 'Graph nodes', value: graph.nodes?.length ?? 0, note: `${graph.edges?.length ?? graph.totalDependencies ?? 0} dependency edges.` },
    { label: 'Inspector traces', value: traces.length, note: `${decisions.length} decisions and ${anomalies.length} anomalies loaded.` },
  ];

  const workflows = {
    founder: {
      mode: 'governance cockpit',
      title: 'Decide what can ship, who has power, and what data leaves the platform.',
      brief: fallbackMission,
      evidenceLabel: 'business + control signals',
      primaryActions: ['analytics-overview', 'invite', 'grant', 'export-json'],
      evidence: [
        ...baseEvidence,
        { label: 'Platform logins', value: overview.platformAccounts?.length ?? 0, note: 'Current privileged accounts.' },
        { label: 'Governance gaps', value: overview.governanceGaps?.length ?? 0, note: 'Production blockers that still need closure.' },
      ],
      lanes: [
        {
          kicker: 'access control',
          title: 'Grant, invite, and review platform operators',
          value: overview.platformAccounts?.length ?? 0,
          description: 'Founder workflow needs account power, audit visibility, and explicit role movement.',
          metrics: [
            { label: 'Logins', value: overview.platformAccounts?.length ?? 0 },
            { label: 'Audit rows', value: overview.auditEvents?.length ?? 0 },
          ],
          queue: (overview.platformAccounts || []).map(account => ({ id: account.email, label: account.email, meta: `${account.role} / ${account.orgName}` })),
          empty: 'No platform accounts returned.',
          action: 'accounts',
          actions: ['invite', 'grant', 'audit'],
        },
        {
          kicker: 'product pressure',
          title: 'Turn user work into product decisions',
          value: analyticsSummary.openItems ?? activeItems.length,
          description: 'Open items, blockers, and category pressure show what the app is actually managing.',
          metrics: [
            { label: 'Users', value: counts.users ?? 'n/a' },
            { label: 'Entries', value: counts.entries ?? 'n/a' },
          ],
          queue: blockerQueue.length ? blockerQueue : itemQueue,
          empty: 'No open product pressure found.',
          action: blockerQueue.length ? 'clear-first-blocker' : 'complete-first-open',
          actions: ['analytics-overview', 'clear-first-blocker', 'create-operator-item'],
        },
        {
          kicker: 'data control',
          title: 'Export and deletion governance',
          value: counts.items ?? 0,
          description: 'The platform owner must be able to inspect storage and run export workflows.',
          metrics: [
            { label: 'Items', value: counts.items ?? 0 },
            { label: 'Tables', value: overview.storage?.database?.tableCount ?? 0 },
          ],
          queue: categoryQueue,
          empty: 'No categories available for export scoping.',
          action: 'export-json',
          actions: ['export-json', 'export-csv', 'export-request'],
        },
      ],
    },
    operator: {
      mode: 'daily operations',
      title: 'Triage the live ledger, move blockers, and hand off customer work.',
      brief: fallbackMission,
      evidenceLabel: 'queue + handoff signals',
      primaryActions: ['accounts', 'analytics-overview', 'create-operator-item', 'support-note'],
      evidence: baseEvidence,
      lanes: [
        {
          kicker: 'todo ledger',
          title: 'Move active work forward',
          value: activeItems.length,
          description: 'Operators should work from the item ledger directly, not from read-only totals.',
          metrics: [
            { label: 'Open', value: analyticsSummary.openItems ?? activeItems.length },
            { label: 'Blocked', value: analyticsSummary.blockers ?? blockers.length },
          ],
          queue: itemQueue,
          empty: 'No active items to triage.',
          action: 'complete-first-open',
          actions: ['complete-first-open', 'create-operator-item', 'analytics-overview'],
        },
        {
          kicker: 'customer handoff',
          title: 'Account and support workflow',
          value: overview.platformAccounts?.length ?? 0,
          description: 'Support notes and export requests must be connected to real platform records.',
          metrics: [
            { label: 'Users', value: counts.users ?? 'n/a' },
            { label: 'Audit', value: overview.auditEvents?.length ?? 0 },
          ],
          queue: (overview.platformAccounts || []).map(account => ({ id: account.email, label: account.email, meta: `${account.role} / ${account.name || 'unnamed'}` })),
          empty: 'No account records returned.',
          action: 'accounts',
          actions: ['accounts', 'support-note', 'export-request'],
        },
        {
          kicker: 'release gate',
          title: 'Health before operational changes',
          value: overview.serviceHealth?.status || 'check',
          description: 'Operators need a release gate before creating customer-visible process changes.',
          metrics: [
            { label: 'Services', value: overview.serviceHealth?.services?.length ?? overview.services?.length ?? 0 },
            { label: 'Gaps', value: overview.governanceGaps?.length ?? 0 },
          ],
          queue: traceQueue,
          empty: 'No recent traces returned.',
          action: 'inspector-traces',
          actions: ['health', 'inspector-health', 'audit'],
        },
      ],
    },
    devops: {
      mode: 'runtime operations',
      title: 'Operate health, backups, deploys, connectors, and engine observability.',
      brief: fallbackMission,
      evidenceLabel: 'runtime + inspector signals',
      primaryActions: ['health', 'backup-run', 'deploy-run', 'inspector-health', 'observability-event'],
      evidence: [
        ...baseEvidence,
        { label: 'Connectors', value: connectors.length, note: 'Registered integration state.' },
        { label: 'Service health', value: overview.serviceHealth?.status || 'unknown', note: 'Local API/runtime health check result.' },
      ],
      lanes: [
        {
          kicker: 'health',
          title: 'Runtime checkover',
          value: overview.serviceHealth?.status || 'run',
          description: 'DevOps owns live service checks and engine health, not dashboard-only status.',
          metrics: [
            { label: 'Services', value: overview.serviceHealth?.services?.length ?? overview.services?.length ?? 0 },
            { label: 'Inspector', value: workspace?.inspectorHealth?.status || workspace?.inspectorHealth?.ok || 'loaded' },
          ],
          queue: traceQueue,
          empty: 'No traces available yet.',
          action: 'inspector-traces',
          actions: ['health', 'inspector-health', 'inspector-traces'],
        },
        {
          kicker: 'release',
          title: 'Backup and deploy control',
          value: overview.auditEvents?.length ?? 0,
          description: 'Backup manifests and deploy runs must be executable from the platform surface.',
          metrics: [
            { label: 'Audit rows', value: overview.auditEvents?.length ?? 0 },
            { label: 'Tables', value: overview.storage?.database?.tableCount ?? 0 },
          ],
          queue: anomalyQueue,
          empty: 'No anomalies returned.',
          action: 'inspector-anomalies',
          actions: ['backup-run', 'deploy-run', 'observability-event'],
        },
        {
          kicker: 'integrations',
          title: 'Connector readiness',
          value: connectors.length,
          description: 'Connector registration is a workflow, because integrations change runtime behavior.',
          metrics: [
            { label: 'Connectors', value: connectors.length },
            { label: 'Graph edges', value: graph.edges?.length ?? graph.totalDependencies ?? 0 },
          ],
          queue: connectorQueue,
          empty: 'No connectors registered.',
          action: 'connector-gmail',
          actions: ['connector-gmail', 'connector-calendar', 'inspector-graph'],
        },
      ],
    },
    coder: {
      mode: 'implementation console',
      title: 'Inspect contracts, schema, traces, graph state, and failing decision paths.',
      brief: fallbackMission,
      evidenceLabel: 'schema + engine evidence',
      primaryActions: ['schema', 'inspector-traces', 'inspector-decisions', 'inspector-graph'],
      evidence: [
        ...baseEvidence,
        { label: 'Categories', value: categoriesList.length, note: 'Schema-backed item grouping surface.' },
        { label: 'Decisions', value: decisions.length, note: 'Decision engine records available for replay work.' },
      ],
      lanes: [
        {
          kicker: 'contracts',
          title: 'Schema and route contract',
          value: overview.storage?.database?.tableCount ?? 0,
          description: 'Coder workflow starts from real tables, categories, and API contracts.',
          metrics: [
            { label: 'Tables', value: overview.storage?.database?.tableCount ?? 0 },
            { label: 'Categories', value: categoriesList.length },
          ],
          queue: categoryQueue,
          empty: 'No category rows returned.',
          action: 'categories',
          actions: ['schema', 'categories', 'analytics-overview'],
        },
        {
          kicker: 'debug',
          title: 'Trace and decision replay',
          value: traces.length + decisions.length,
          description: 'Engine behavior must be inspectable through traces and decisions, not guessed from UI.',
          metrics: [
            { label: 'Traces', value: traces.length },
            { label: 'Decisions', value: decisions.length },
          ],
          queue: decisionQueue.length ? decisionQueue : traceQueue,
          empty: 'No traces or decisions returned.',
          action: decisionQueue.length ? 'inspector-decisions' : 'inspector-traces',
          actions: ['inspector-traces', 'inspector-decisions', 'inspector-graph'],
        },
        {
          kicker: 'observability',
          title: 'Write and inspect platform events',
          value: anomalies.length,
          description: 'The engineering console needs a write path to prove audit and observability plumbing.',
          metrics: [
            { label: 'Anomalies', value: anomalies.length },
            { label: 'Audit rows', value: overview.auditEvents?.length ?? 0 },
          ],
          queue: anomalyQueue,
          empty: 'No anomalies returned.',
          action: 'inspector-anomalies',
          actions: ['observability-event', 'inspector-anomalies', 'audit'],
        },
      ],
    },
    support: {
      mode: 'customer diagnostics',
      title: 'Diagnose accounts, add notes, and create export/delete requests without unsafe mutation.',
      brief: fallbackMission,
      evidenceLabel: 'support-safe records',
      primaryActions: ['accounts', 'support-note', 'export-request', 'delete-request'],
      evidence: [
        ...baseEvidence,
        { label: 'Accounts', value: counts.users ?? 0, note: 'Customer records available to inspect.' },
        { label: 'Audit rows', value: overview.auditEvents?.length ?? 0, note: 'Support actions must leave evidence.' },
      ],
      lanes: [
        {
          kicker: 'diagnostics',
          title: 'Account lookup and account-safe checks',
          value: counts.users ?? 0,
          description: 'Support needs account context without developer-only database access.',
          metrics: [
            { label: 'Users', value: counts.users ?? 0 },
            { label: 'Entries', value: counts.entries ?? 0 },
          ],
          queue: (overview.platformAccounts || []).map(account => ({ id: account.email, label: account.email, meta: `${account.role} / ${account.orgName}` })),
          empty: 'No account rows returned.',
          action: 'accounts',
          actions: ['accounts', 'analytics-overview', 'support-note'],
        },
        {
          kicker: 'data requests',
          title: 'Export and delete request intake',
          value: counts.items ?? 0,
          description: 'Support should create review requests, not directly delete or export user data silently.',
          metrics: [
            { label: 'Items', value: counts.items ?? 0 },
            { label: 'Files', value: overview.storage?.objectStorage?.indexedFiles ?? 0 },
          ],
          queue: categoryQueue,
          empty: 'No categories returned for scoping requests.',
          action: 'export-request',
          actions: ['export-request', 'delete-request', 'audit'],
        },
        {
          kicker: 'resolution',
          title: 'Blocker note and escalation loop',
          value: blockers.length,
          description: 'A support dashboard should expose blockers and let support record context.',
          metrics: [
            { label: 'Blockers', value: blockers.length },
            { label: 'Traces', value: traces.length },
          ],
          queue: blockerQueue,
          empty: 'No blockers returned.',
          action: 'clear-first-blocker',
          actions: ['clear-first-blocker', 'support-note', 'accounts'],
        },
      ],
    },
  };

  return workflows[role] || workflows.support;
}

function formatNumber(value) {
  if (value === undefined || value === null || value === '') return 'n/a';
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return String(value);
  return numeric % 1 === 0 ? numeric : numeric.toFixed(2);
}

function formatDate(value) {
  if (!value) return 'no date';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString();
}

function ActionResultPanel({ actionResult }) {
  if (!actionResult) return null;
  const preview = summarizeActionResult(actionResult.result);
  return (
    <section className="platform-section">
      <div className="platform-section-head">
        <h2>Connected result</h2>
        <span>{actionResult.action}</span>
      </div>
      <div className="platform-card action-result">
        {preview.map(row => (
          <div key={row.label}>
            <strong>{row.label}</strong>
            <p>{row.value}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function summarizeActionResult(result) {
  if (result.accounts) {
    return [
      { label: 'Accounts returned', value: result.accounts.length },
      { label: 'First account', value: result.accounts[0]?.email || 'none' },
    ];
  }
  if (result.auditEvents) {
    return [
      { label: 'Audit rows returned', value: result.auditEvents.length },
      { label: 'Latest action', value: result.auditEvents[0]?.action || 'none' },
    ];
  }
  if (result.invite) {
    return [
      { label: 'Invite created', value: result.invite.invited_email },
      { label: 'Role', value: result.invite.role },
      { label: 'Status', value: result.invite.status },
    ];
  }
  if (result.membership) {
    return [
      { label: 'Membership changed', value: result.membership.user_id },
      { label: 'Role', value: result.membership.role },
    ];
  }
  if (result.note) {
    return [
      { label: 'Support note created', value: result.note.id },
      { label: 'Category', value: result.note.category },
    ];
  }
  if (result.request) {
    return [
      { label: 'Data request created', value: result.request.id },
      { label: 'Type', value: result.request.type },
      { label: 'Status', value: result.request.status },
    ];
  }
  if (result.backupRun) {
    return [
      { label: 'Backup run', value: result.backupRun.id },
      { label: 'Status', value: result.backupRun.status },
    ];
  }
  if (result.deployRun) {
    return [
      { label: 'Deploy run', value: result.deployRun.id },
      { label: 'Status', value: result.deployRun.status },
      { label: 'Component', value: result.deployRun.component },
    ];
  }
  if (result.event) {
    return [
      { label: 'Observability event', value: result.event.id },
      { label: 'Severity', value: result.event.severity },
      { label: 'Message', value: result.event.message },
    ];
  }
  if (result.tables) {
    return [
      { label: 'Schema tables returned', value: Object.keys(result.tables).length },
      { label: 'First table', value: Object.keys(result.tables)[0] || 'none' },
    ];
  }
  if (result.services) {
    return [
      { label: 'Service status', value: result.status },
      { label: 'Services checked', value: result.services.length },
      { label: 'DB latency', value: `${result.services.find(service => service.name === 'postgres')?.latencyMs ?? 'n/a'}ms` },
    ];
  }
  if (result.metrics) {
    return Object.entries(result.metrics).map(([label, value]) => ({ label, value }));
  }
  if (result.schemaSummary) {
    return [
      { label: 'Tables summarized', value: result.schemaSummary.length },
      { label: 'First table', value: result.schemaSummary[0]?.table_name || 'none' },
    ];
  }
  return [{ label: 'Result', value: JSON.stringify(result).slice(0, 240) }];
}

function SharedPlatformSections({ overview, compact = false }) {
  return (
    <>
      <section className="platform-section">
        <div className="platform-section-head">
          <h2>Who can access what?</h2>
          <span>current state: role-gated routes and actions</span>
        </div>
        <div className="access-list">
          {overview.accessModel.map(actor => (
            <article className="platform-card" key={actor.actor}>
              <span>{actor.status}</span>
              <h3>{actor.actor}</h3>
              <p>{actor.access}</p>
            </article>
          ))}
        </div>
      </section>

      {!compact && (
        <section className="platform-section">
          <div className="platform-section-head">
            <h2>Runtime services</h2>
            <span>local Docker topology</span>
          </div>
          <div className="service-list">
            {overview.services.map(service => (
              <article className="platform-card" key={service.name}>
                <span>{service.runtime}</span>
                <h3>{service.name}</h3>
                <p>{service.responsibility}</p>
                <code>{service.localUrl}</code>
              </article>
            ))}
          </div>
        </section>
      )}

      <section className="platform-section">
        <div className="platform-section-head">
          <h2>Platform readiness</h2>
          <span>implemented vs production boundary</span>
        </div>
        <div className="readiness-grid">
          {(overview.platformReadiness || []).map(item => (
            <article className="platform-card readiness-card" key={item.area}>
              <span>{item.status}</span>
              <h3>{item.area}</h3>
              <p>{item.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="platform-section platform-storage">
        <div>
          <h2>Where data is stored</h2>
          <p>
            PostgreSQL is the source of truth. Redis is cache/future queues.
            MinIO is file/object storage. The user app should not hide this from operators.
          </p>
        </div>
        <div className="storage-map">
          <StorageNode title="Database" rows={overview.storage.database.selectedCounts} footer={overview.storage.database.host} />
          <StorageNode
            title="Object storage"
            rows={{
              indexedFiles: overview.storage.objectStorage.indexedFiles,
              indexedBytes: overview.storage.objectStorage.indexedBytes,
            }}
            footer={`${overview.storage.objectStorage.engine} / ${overview.storage.objectStorage.bucket}`}
          />
          <StorageNode title="Cache" rows={{ role: overview.storage.cache.role }} footer={overview.storage.cache.persistentVolume} />
        </div>
      </section>

      <section className="platform-section">
        <div className="platform-section-head">
          <h2>Production work left</h2>
          <span>not local placeholders</span>
        </div>
        <div className="gap-list">
          {overview.governanceGaps.map(gap => <div key={gap}>{gap}</div>)}
        </div>
      </section>

      <section className="platform-section">
        <div className="platform-section-head">
          <h2>Audit trail</h2>
          <span>recent platform events</span>
        </div>
        <div className="audit-list">
          {(overview.auditEvents || []).map((event, index) => (
            <article className="platform-card audit-card" key={`${event.action}-${event.createdAt}-${index}`}>
              <span>{event.action}</span>
              <h3>{event.actorEmail || 'system'}</h3>
              <p>{event.targetType || 'platform'} / {new Date(event.createdAt).toLocaleString()}</p>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}

function Metric({ title, value, note }) {
  return (
    <article className="platform-metric">
      <span>{title}</span>
      <strong>{value ?? 'n/a'}</strong>
      <p>{note}</p>
    </article>
  );
}

function StorageNode({ title, rows, footer }) {
  return (
    <article className="platform-card storage-node">
      <h3>{title}</h3>
      <dl>
        {Object.entries(rows).map(([key, value]) => (
          <div key={key}>
            <dt>{key}</dt>
            <dd>{String(value ?? 'n/a')}</dd>
          </div>
        ))}
      </dl>
      <code>{footer}</code>
    </article>
  );
}
