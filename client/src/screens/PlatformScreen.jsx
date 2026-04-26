import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { platform } from '../services/api';
import './PlatformScreen.css';

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
  const activeRole = roleMeta[role] ? role : null;
  const [state, setState] = useState({ loading: true, overview: null, rolePayload: null, actionResult: null, actionLoading: '', error: '' });

  useEffect(() => {
    async function load() {
      try {
        setState(prev => ({ ...prev, loading: true, error: '', actionResult: null }));
        const overview = await platform.overview();
        const rolePayload = activeRole ? await platform.roleDashboard(activeRole) : null;
        setState(prev => ({ ...prev, loading: false, overview, rolePayload, error: '' }));
      } catch (error) {
        setState(prev => ({ ...prev, loading: false, rolePayload: null, error: error.message }));
      }
    }
    load();
  }, [activeRole]);

  const overview = state.overview;

  return (
    <div className="platform-screen page-container">
      <header className="platform-hero">
        <p className="eyebrow">Platform control plane</p>
        {activeRole ? (
          <>
            <h1>{roleMeta[activeRole].title}</h1>
            <p>{roleMeta[activeRole].promise}</p>
          </>
        ) : (
          <>
            <h1>The app needs operators, builders, and data visibility too.</h1>
            <p>
              This console is the first non-user surface: access model, role dashboards,
              services, storage, audit, and governance gaps.
            </p>
          </>
        )}
      </header>

      {state.error && <div className="command-error">{state.error}</div>}
      {state.loading && <div className="platform-card skeleton platform-loading" />}

      {overview && (
        <>
          <RoleSwitch activeRole={activeRole} />

          <section className="platform-grid">
            <Metric title="Tables" value={overview.storage.database.tableCount} note="Postgres public schema" />
            <Metric title="Users" value={overview.storage.database.selectedCounts.users} note="local dev database" />
            <Metric title="Entries" value={overview.storage.database.selectedCounts.entries} note="raw captured memory" />
            <Metric title="Items" value={overview.storage.database.selectedCounts.items} note="computed operating state" />
          </section>

          {activeRole ? (
            <RoleDashboard
              role={activeRole}
              overview={overview}
              rolePayload={state.rolePayload}
              actionResult={state.actionResult}
              actionLoading={state.actionLoading}
              onRunAction={async action => {
                setState(prev => ({ ...prev, actionLoading: action, actionResult: null, error: '' }));
                try {
                  const result = await runPlatformAction(action, activeRole);
                  setState(prev => ({ ...prev, actionLoading: '', actionResult: { action, result }, error: '' }));
                } catch (error) {
                  setState(prev => ({ ...prev, actionLoading: '', actionResult: null, error: error.message }));
                }
              }}
            />
          ) : (
            <PlatformHub overview={overview} />
          )}
        </>
      )}
    </div>
  );
}

async function runPlatformAction(action, role) {
  if (action === 'accounts') return platform.accounts();
  if (action === 'audit') return platform.audit();
  if (action === 'schema') return platform.schema();
  if (action === 'health') return platform.serviceHealth();
  if (action === 'role') return platform.roleDashboard(role);
  if (action === 'invite') return platform.invite(`invite.${Date.now()}@flowra.local`, role === 'founder' ? 'operator' : role);
  if (action === 'grant') return platform.grant('support.platform@flowra.local', 'support');
  if (action === 'support-note') return platform.supportNote('flowra.synthetic.1.20260426121047@example.com', `Support diagnostic note from ${role} dashboard`);
  if (action === 'export-request') return platform.exportRequest('flowra.synthetic.1.20260426121047@example.com', `Export review requested from ${role} dashboard`);
  if (action === 'delete-request') return platform.deleteRequest('flowra.synthetic.2.20260426121047@example.com', `Deletion review requested from ${role} dashboard`);
  if (action === 'backup-run') return platform.backupRun();
  if (action === 'deploy-run') return platform.deployRun('local', 'api', 'context-package');
  if (action === 'observability-event') return platform.observabilityEvent(`Synthetic observability event from ${role} dashboard`, 'info');
  throw new Error(`Unknown platform action: ${action}`);
}

function PlatformHub({ overview }) {
  return (
    <>
      <section className="platform-section">
        <div className="platform-section-head">
          <h2>Role logins</h2>
          <span>real local accounts</span>
        </div>
        <div className="login-table">
          {overview.platformAccounts.map(account => (
            <article className="platform-card login-card" key={`${account.email}-${account.role}`}>
              <span>{account.role}</span>
              <h3>{account.email}</h3>
              <p>{account.name || 'Unnamed platform account'} / {account.orgName}</p>
              <code>password: Platform123!</code>
            </article>
          ))}
        </div>
      </section>

      <section className="platform-section">
        <div className="platform-section-head">
          <h2>Dashboard routes</h2>
          <span>separate work surfaces</span>
        </div>
        <div className="dashboard-grid">
          {Object.keys(roleMeta).map(key => (
            <RoleRouteCard key={key} role={key} />
          ))}
        </div>
      </section>

      <SharedPlatformSections overview={overview} />
    </>
  );
}

function RoleSwitch({ activeRole }) {
  return (
    <nav className="role-switch" aria-label="Platform role dashboards">
      <Link className={!activeRole ? 'active' : ''} to="/platform">Hub</Link>
      {Object.entries(roleMeta).map(([key, meta]) => (
        <Link className={activeRole === key ? 'active' : ''} key={key} to={`/platform/${key}`}>
          {meta.label}
        </Link>
      ))}
    </nav>
  );
}

function RoleRouteCard({ role }) {
  const meta = roleMeta[role];
  return (
    <Link className="platform-card role-route-card" to={`/platform/${role}`}>
      <span>{role}</span>
      <h3>{meta.title}</h3>
      <p>{meta.promise}</p>
      <code>open /platform/{role}</code>
    </Link>
  );
}

function RoleDashboard({ role, overview, rolePayload, actionResult, actionLoading, onRunAction }) {
  const meta = roleMeta[role];
  const dashboardKey = role === 'operator' ? 'founder' : role;
  const dashboard = overview.dashboards?.[dashboardKey] || overview.dashboards?.founder;
  return (
    <>
      <section className="platform-section role-dashboard-shell">
        <div className="platform-section-head">
          <h2>{meta.label} dashboard</h2>
          <span>dedicated route /platform/{role}</span>
        </div>
        <div className="role-dashboard-grid">
          <DashboardPanel dashboard={dashboard} />
          <RoleOperatingModel role={role} rolePayload={rolePayload} onRunAction={onRunAction} actionLoading={actionLoading} />
        </div>
      </section>
      <RoleToolbelt role={role} overview={overview} actionLoading={actionLoading} onRunAction={onRunAction} />
      <ActionResultPanel actionResult={actionResult} />
      <SharedPlatformSections overview={overview} compact />
    </>
  );
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
};

function RoleOperatingModel({ role, rolePayload, onRunAction, actionLoading }) {
  const model = rolePayload?.dashboard;
  if (!model) return <RoleModules role={role} />;
  const records = Object.entries(model.records || {}).filter(([, rows]) => rows?.length);
  return (
    <article className="platform-card role-operating-model">
      <span>{role} operating model</span>
      <h3>{model.mission}</h3>

      <div className="role-queue-grid">
        {(model.liveQueues || []).map(queue => (
          <button className="queue-action" key={queue.label} onClick={() => onRunAction(queue.action)} disabled={actionLoading === queue.action}>
            <span>{queue.label}</span>
            <strong>{queue.value ?? 'n/a'}</strong>
            <small>{actionLoading === queue.action ? 'Running...' : actionLabels[queue.action] || queue.action}</small>
          </button>
        ))}
      </div>

      <div className="role-need-list">
        <h4>What this role needs</h4>
        {model.needs.map(need => <p key={need}>{need}</p>)}
      </div>

      <div className="role-action-row">
        {(model.primaryActions || []).map(action => (
          <button className="btn btn-secondary btn-sm" key={action} disabled={actionLoading === action} onClick={() => onRunAction(action)}>
            {actionLoading === action ? 'Running...' : actionLabels[action] || action}
          </button>
        ))}
      </div>

      {records.length > 0 && (
        <div className="role-records">
          <h4>Recent live records</h4>
          {records.slice(0, 3).map(([name, rows]) => (
            <section key={name}>
              <strong>{name.replace(/([A-Z])/g, ' $1').trim()}</strong>
              {rows.slice(0, 2).map((row, index) => (
                <p key={`${name}-${index}`}>{summarizeRecord(row)}</p>
              ))}
            </section>
          ))}
        </div>
      )}
    </article>
  );
}

function summarizeRecord(row) {
  if (row.invited_email) return `${row.invited_email} / ${row.role} / ${row.status}`;
  if (row.subject_email && row.type) return `${row.subject_email} / ${row.type} / ${row.status}`;
  if (row.subject_email && row.note) return `${row.subject_email} / ${row.category}: ${row.note}`;
  if (row.component) return `${row.environment}/${row.component} / ${row.status} / ${row.ref}`;
  if (row.severity) return `${row.severity} / ${row.source}: ${row.message}`;
  if (row.status && row.id) return `${row.id} / ${row.status}`;
  return JSON.stringify(row).slice(0, 160);
}

function RoleModules({ role }) {
  return (
    <article className="platform-card role-modules">
      <span>{role} modules</span>
      <h3>Work areas</h3>
      <div>
        {roleMeta[role].modules.map(([title, body]) => (
          <section key={title}>
            <strong>{title}</strong>
            <p>{body}</p>
          </section>
        ))}
      </div>
    </article>
  );
}

function RoleToolbelt({ role, overview, actionLoading, onRunAction }) {
  const rows = {
    founder: [
      ['Create operator invite', `${overview.platformAccounts.length} platform logins`, 'invite'],
      ['Grant support access', 'idempotently ensures support platform role exists', 'grant'],
      ['Open governance board', `${overview.governanceGaps.length} unresolved gaps`, 'audit'],
    ],
    operator: [
      ['Check activation pool', `${overview.storage.database.selectedCounts.users} local accounts`, 'accounts'],
      ['Create export request', 'records a data export workflow request', 'export-request'],
      ['Write support note', 'records operator diagnostic context', 'support-note'],
    ],
    devops: [
      ['Run service health', 'http://localhost:8301/health', 'health'],
      ['Create backup manifest', 'records DB/object/cache backup run metadata', 'backup-run'],
      ['Queue local deploy run', 'records environment/component/ref deploy intent', 'deploy-run'],
    ],
    coder: [
      ['Inspect schema', `${overview.storage.database.tableCount} public tables`, 'schema'],
      ['Emit observability event', 'writes a platform observability row', 'observability-event'],
      ['Inspect backend audit', 'reads implementation/action history', 'audit'],
    ],
    support: [
      ['Account diagnostics', `${overview.storage.database.selectedCounts.users} users visible locally`, 'accounts'],
      ['Write support note', 'adds a note to a synthetic user record', 'support-note'],
      ['Create delete request', 'records deletion review without deleting data', 'delete-request'],
    ],
  };

  return (
    <section className="platform-section">
      <div className="platform-section-head">
        <h2>{roleMeta[role].label} toolbelt</h2>
        <span>role-specific actions</span>
      </div>
      <div className="toolbelt-grid">
        {(rows[role] || []).map(([label, value, action]) => (
          <article className="platform-card" key={label}>
            <span>tool</span>
            <h3>{label}</h3>
            <p>{value}</p>
            <button className="btn btn-secondary btn-sm platform-action-btn" disabled={actionLoading === action} onClick={() => onRunAction(action)}>
              {actionLoading === action ? 'Running...' : 'Run connected check'}
            </button>
          </article>
        ))}
      </div>
    </section>
  );
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

function DashboardPanel({ dashboard }) {
  return (
    <article className="platform-card dashboard-panel">
      <h3>{dashboard.title}</h3>
      <div className="mini-metrics">
        {dashboard.cards.map(card => (
          <div key={card.label}>
            <span>{card.label}</span>
            <strong>{card.value}</strong>
            <p>{card.note}</p>
          </div>
        ))}
      </div>
      <ul>
        {dashboard.focus.map(item => <li key={item}>{item}</li>)}
      </ul>
    </article>
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
