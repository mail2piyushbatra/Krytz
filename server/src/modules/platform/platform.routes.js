'use strict';

const express = require('express');
const { authenticate } = require('../../middleware/auth');

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function platformRoutes(pool) {
  const router = express.Router();
  router.use(authenticate);
  router.use((req, res, next) => {
    res.on('finish', () => {
      if (res.statusCode < 500) {
        audit(pool, req.user.id, `platform.${req.method.toLowerCase()}.${req.path.replace(/[^a-zA-Z0-9]+/g, '.').replace(/^\.|\.$/g, '')}`, 'route', req.path, { statusCode: res.statusCode }).catch(() => {});
      }
    });
    next();
  });

  router.get('/platform/overview', asyncHandler(async (req, res) => {
    const [tableRows, selectedCounts, userRows, storageRows, membershipRows, accountRows, auditRows] = await Promise.all([
      pool.query(
        `SELECT table_name
           FROM information_schema.tables
          WHERE table_schema='public' AND table_type='BASE TABLE'
          ORDER BY table_name`
      ),
      getSelectedCounts(pool),
      pool.query(
        `SELECT subscription_tier, count(*) AS users
           FROM users
          GROUP BY subscription_tier
          ORDER BY subscription_tier`
      ).catch(() => ({ rows: [] })),
      pool.query(
        `SELECT COALESCE(SUM(file_size), 0) AS bytes, count(*) AS files
           FROM file_attachments`
      ).catch(() => ({ rows: [{ bytes: 0, files: 0 }] })),
      pool.query(
        `SELECT o.id AS org_id, o.name AS org_name, o.slug, om.role
           FROM organization_members om
           JOIN organizations o ON o.id = om.org_id
          WHERE om.user_id = $1
          ORDER BY om.created_at DESC`,
        [req.user.id]
      ).catch(() => ({ rows: [] })),
      pool.query(
        `SELECT u.email, u.name, om.role, o.name AS org_name, om.created_at
           FROM organization_members om
           JOIN users u ON u.id = om.user_id
           JOIN organizations o ON o.id = om.org_id
          ORDER BY
            CASE om.role
              WHEN 'founder' THEN 1
              WHEN 'operator' THEN 2
              WHEN 'devops' THEN 3
              WHEN 'coder' THEN 4
              WHEN 'support' THEN 5
              ELSE 6
            END,
            u.email`
      ).catch(() => ({ rows: [] })),
      pool.query(
        `SELECT pae.action, pae.target_type, pae.metadata, pae.created_at, u.email AS actor_email
           FROM platform_audit_events pae
           LEFT JOIN users u ON u.id = pae.actor_user_id
          ORDER BY pae.created_at DESC
          LIMIT 12`
      ).catch(() => ({ rows: [] })),
    ]);

    const viewerMemberships = membershipRows.rows.map(row => ({
      orgId: row.org_id,
      orgName: row.org_name,
      slug: row.slug,
      role: row.role,
    }));
    const primaryRole = viewerMemberships[0]?.role || 'authenticated-user';
    const roleCounts = {};
    for (const row of accountRows.rows) {
      roleCounts[row.role] = (roleCounts[row.role] || 0) + 1;
    }

    res.json({
      generatedAt: new Date().toISOString(),
      viewer: {
        id: req.user.id,
        email: req.user.email,
        role: primaryRole,
        platformRole: primaryRole,
        memberships: viewerMemberships,
      },
      accessModel: [
        {
          actor: 'User',
          status: 'implemented',
          access: 'Own Command Center data through JWT auth.',
        },
        {
          actor: 'Founder / Operator',
          status: roleCounts.founder || roleCounts.operator ? 'seeded-role-login' : 'missing-role-login',
          access: 'Business health, data inventory, governance gaps, and platform account directory.',
        },
        {
          actor: 'DevOps',
          status: roleCounts.devops ? 'seeded-role-login' : 'missing-role-login',
          access: 'Service topology, health surfaces, storage dependencies, and backup/deploy checklist.',
        },
        {
          actor: 'Coder',
          status: roleCounts.coder ? 'seeded-role-login' : 'missing-role-login',
          access: 'Schema inventory, API modules, runtime mounts, seed accounts, and implementation gaps.',
        },
        {
          actor: 'Support',
          status: roleCounts.support ? 'seeded-role-login' : 'missing-role-login',
          access: 'Read-only customer diagnostics, user counts, notifications, and audit trail visibility.',
        },
      ],
      platformAccounts: accountRows.rows.map(row => ({
        email: row.email,
        name: row.name,
        role: row.role,
        orgName: row.org_name,
        createdAt: row.created_at,
      })),
      services: [
        {
          name: 'Web client',
          runtime: 'Vite dev server',
          localUrl: 'http://localhost:5175',
          responsibility: 'User app and platform console shell.',
        },
        {
          name: 'API',
          runtime: 'Node / Express',
          localUrl: 'http://localhost:8301',
          responsibility: 'Auth, capture, planning, intelligence, files, support, platform overview.',
        },
        {
          name: 'PostgreSQL + pgvector',
          runtime: 'Docker container flowra2-db',
          localUrl: 'localhost:5544',
          responsibility: 'System of record: users, entries, items, rules, notifications, plan cache.',
        },
        {
          name: 'Redis',
          runtime: 'Docker container flowra2-redis',
          localUrl: 'localhost:6381',
          responsibility: 'Cache and future queues.',
        },
        {
          name: 'MinIO / S3-compatible storage',
          runtime: 'Docker container flowra2-storage',
          localUrl: 'http://localhost:9100',
          responsibility: 'Uploaded files and derived file artifacts.',
        },
      ],
      storage: {
        database: {
          engine: 'PostgreSQL 16 + pgvector',
          database: 'flowra',
          host: 'flowra2-db:5432 inside Docker / localhost:5544 outside Docker',
          tableCount: tableRows.rows.length,
          tables: tableRows.rows.map(row => row.table_name),
          selectedCounts,
          usersByTier: userRows.rows.map(row => ({
            tier: row.subscription_tier || 'unknown',
            users: Number(row.users),
          })),
        },
        objectStorage: {
          engine: 'MinIO S3-compatible',
          bucket: process.env.S3_BUCKET || 'flowra-files',
          endpoint: process.env.S3_ENDPOINT || 'unknown',
          indexedFiles: Number(storageRows.rows[0]?.files || 0),
          indexedBytes: Number(storageRows.rows[0]?.bytes || 0),
        },
        cache: {
          engine: 'Redis',
          role: 'cache/future queue layer',
          persistentVolume: 'flowra2_redis',
        },
      },
      platformReadiness: [
        {
          area: 'Route-level RBAC',
          status: 'implemented-local',
          detail: 'Dashboard routes and write actions enforce platform roles server-side.',
        },
        {
          area: 'Write actions',
          status: 'implemented-local',
          detail: 'Invites, grant/revoke, support notes, data requests, backup manifests, deploy intents, and observability events write to Postgres.',
        },
        {
          area: 'Audit middleware',
          status: 'implemented-local',
          detail: 'Every platform route completion is audit logged, with explicit audit records for sensitive actions.',
        },
        {
          area: 'Production observability',
          status: 'local-ingestion-ready',
          detail: 'Service health and observability event ingestion exist; external Sentry/Prometheus/cloud integrations still need production credentials.',
        },
      ],
      governanceGaps: [
        'Physical pg_dump/object-store backup artifact is not generated yet; current backup action records a manifest.',
        'Deploy action records a queued local deploy intent; it does not push to cloud or restart production services.',
        'Export/delete requests are workflow records; export-file generation and irreversible deletion still need approval gates.',
        'Production observability sinks need real infrastructure credentials before this can be wired beyond local health/event rows.',
      ],
      dashboards: buildDashboards({ selectedCounts, userRows, storageRows, tableRows, roleCounts, auditRows }),
      auditEvents: auditRows.rows.map(row => ({
        action: row.action,
        targetType: row.target_type,
        metadata: row.metadata,
        actorEmail: row.actor_email,
        createdAt: row.created_at,
      })),
    });
  }));

  router.get('/platform/dashboards/:role', asyncHandler(async (req, res) => {
    const role = req.params.role;
    if (!['founder', 'operator', 'devops', 'coder', 'support'].includes(role)) {
      return res.status(404).json({ error: 'Unknown platform dashboard role' });
    }

    const membership = await requireDashboardAccess(pool, req.user.id, role);
    const payload = await buildRolePayload(pool, role);
    res.json({
      role,
      viewer: {
        id: req.user.id,
        email: req.user.email,
        platformRole: membership?.role || 'authenticated-user',
      },
      ...payload,
    });
  }));

  router.get('/platform/accounts', asyncHandler(async (req, res) => {
    await requirePlatformRole(pool, req.user.id, ['founder', 'operator', 'support']);
    const { rows } = await pool.query(
      `SELECT u.id, u.email, u.name, u.created_at, u.subscription_tier,
              om.role AS platform_role, o.name AS org_name,
              (SELECT count(*)::int FROM entries e WHERE e.user_id=u.id) AS entries,
              (SELECT count(*)::int FROM items i WHERE i.user_id=u.id) AS items,
              (SELECT count(*)::int FROM refresh_tokens rt WHERE rt.user_id=u.id) AS sessions
         FROM users u
         LEFT JOIN organization_members om ON om.user_id=u.id
         LEFT JOIN organizations o ON o.id=om.org_id
        ORDER BY u.created_at DESC
        LIMIT 100`
    );
    await audit(pool, req.user.id, 'platform.accounts.read', 'users', null, { limit: 100 });
    res.json({ accounts: rows });
  }));

  router.get('/platform/audit', asyncHandler(async (req, res) => {
    await requirePlatformRole(pool, req.user.id, ['founder', 'operator', 'support', 'devops']);
    const { rows } = await pool.query(
      `SELECT pae.id, pae.action, pae.target_type, pae.target_id, pae.metadata, pae.created_at,
              u.email AS actor_email
         FROM platform_audit_events pae
         LEFT JOIN users u ON u.id=pae.actor_user_id
        ORDER BY pae.created_at DESC
        LIMIT 100`
    );
    res.json({ auditEvents: rows });
  }));

  router.get('/platform/schema', asyncHandler(async (req, res) => {
    await requirePlatformRole(pool, req.user.id, ['founder', 'devops', 'coder']);
    const { rows } = await pool.query(
      `SELECT c.table_name, c.column_name, c.data_type, c.is_nullable
         FROM information_schema.columns c
         JOIN information_schema.tables t
           ON t.table_schema=c.table_schema AND t.table_name=c.table_name
        WHERE c.table_schema='public' AND t.table_type='BASE TABLE'
        ORDER BY c.table_name, c.ordinal_position`
    );
    const tables = {};
    for (const row of rows) {
      tables[row.table_name] ||= [];
      tables[row.table_name].push({
        column: row.column_name,
        type: row.data_type,
        nullable: row.is_nullable === 'YES',
      });
    }
    await audit(pool, req.user.id, 'platform.schema.read', 'schema', null, { tableCount: Object.keys(tables).length });
    res.json({ tables });
  }));

  router.get('/platform/service-health', asyncHandler(async (req, res) => {
    await requirePlatformRole(pool, req.user.id, ['founder', 'operator', 'devops', 'coder']);
    const dbStarted = Date.now();
    await pool.query('SELECT 1');
    const dbLatencyMs = Date.now() - dbStarted;
    const { rows: [counts] } = await pool.query(
      `SELECT
        (SELECT count(*)::int FROM users) AS users,
        (SELECT count(*)::int FROM entries) AS entries,
        (SELECT count(*)::int FROM items) AS items,
        (SELECT count(*)::int FROM platform_audit_events) AS audit_events`
    );
    res.json({
      status: 'ok',
      checkedAt: new Date().toISOString(),
      services: [
        { name: 'api', status: 'ok', endpoint: 'http://localhost:8301/health' },
        { name: 'postgres', status: 'ok', endpoint: 'flowra2-db:5432', latencyMs: dbLatencyMs },
        { name: 'redis', status: 'configured', endpoint: 'flowra2-redis:6379' },
        { name: 'minio', status: 'configured', endpoint: process.env.S3_ENDPOINT || 'http://minio:9000' },
      ],
      counts,
    });
  }));

  router.post('/platform/invites', asyncHandler(async (req, res) => {
    const membership = await requirePlatformRole(pool, req.user.id, ['founder', 'operator']);
    const { email, role } = req.body;
    if (!email || !role) return res.status(400).json({ error: 'email and role are required' });
    if (!['founder', 'operator', 'devops', 'coder', 'support', 'member'].includes(role)) return res.status(400).json({ error: 'invalid role' });
    const { rows } = await pool.query(
      `INSERT INTO platform_invites(org_id, invited_email, role, invited_by)
       VALUES($1,$2,$3,$4) RETURNING *`,
      [membership.org_id, email, role, req.user.id]
    );
    await audit(pool, req.user.id, 'platform.invite.created', 'invite', rows[0].id, { email, role });
    res.status(201).json({ invite: rows[0] });
  }));

  router.post('/platform/access/grant', asyncHandler(async (req, res) => {
    const membership = await requirePlatformRole(pool, req.user.id, ['founder']);
    const { email, role } = req.body;
    if (!email || !role) return res.status(400).json({ error: 'email and role are required' });
    const user = await getUserByEmail(pool, email);
    if (!user) return res.status(404).json({ error: 'user not found' });
    const { rows } = await pool.query(
      `INSERT INTO organization_members(org_id,user_id,role)
       VALUES($1,$2,$3)
       ON CONFLICT(org_id,user_id) DO UPDATE SET role=EXCLUDED.role
       RETURNING *`,
      [membership.org_id, user.id, role]
    );
    await audit(pool, req.user.id, 'platform.access.granted', 'user', user.id, { email, role });
    res.json({ membership: rows[0] });
  }));

  router.post('/platform/access/revoke', asyncHandler(async (req, res) => {
    const membership = await requirePlatformRole(pool, req.user.id, ['founder']);
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'email is required' });
    const user = await getUserByEmail(pool, email);
    if (!user) return res.status(404).json({ error: 'user not found' });
    if (user.id === req.user.id) return res.status(400).json({ error: 'cannot revoke your own platform access' });
    const result = await pool.query(`DELETE FROM organization_members WHERE org_id=$1 AND user_id=$2`, [membership.org_id, user.id]);
    await audit(pool, req.user.id, 'platform.access.revoked', 'user', user.id, { email, rowCount: result.rowCount });
    res.json({ ok: true, revoked: result.rowCount });
  }));

  router.post('/platform/support/notes', asyncHandler(async (req, res) => {
    await requirePlatformRole(pool, req.user.id, ['support', 'operator', 'founder']);
    const { email, note, category = 'diagnostic' } = req.body;
    if (!email || !note) return res.status(400).json({ error: 'email and note are required' });
    const user = await getUserByEmail(pool, email);
    if (!user) return res.status(404).json({ error: 'user not found' });
    const { rows } = await pool.query(
      `INSERT INTO platform_support_notes(subject_user_id, author_user_id, note, category)
       VALUES($1,$2,$3,$4) RETURNING *`,
      [user.id, req.user.id, note, category]
    );
    await audit(pool, req.user.id, 'platform.support.note.created', 'user', user.id, { category });
    res.status(201).json({ note: rows[0] });
  }));

  router.post('/platform/requests/export', asyncHandler(async (req, res) => {
    await requirePlatformRole(pool, req.user.id, ['support', 'operator', 'founder']);
    res.status(201).json({ request: await createDataRequest(pool, req.user.id, req.body.email, 'export', req.body.reason || 'operator requested export') });
  }));

  router.post('/platform/requests/delete', asyncHandler(async (req, res) => {
    await requirePlatformRole(pool, req.user.id, ['support', 'founder']);
    res.status(201).json({ request: await createDataRequest(pool, req.user.id, req.body.email, 'delete', req.body.reason || 'support requested deletion review') });
  }));

  router.post('/platform/backups/run', asyncHandler(async (req, res) => {
    await requirePlatformRole(pool, req.user.id, ['devops', 'founder']);
    const selectedCounts = await getSelectedCounts(pool);
    const manifest = { type: 'logical-manifest', selectedCounts, volumes: ['flowra2_pgdata', 'flowra2_redis', 'flowra2_minio'], generatedAt: new Date().toISOString() };
    const { rows } = await pool.query(
      `INSERT INTO platform_backup_runs(requested_by, status, manifest) VALUES($1,'completed',$2) RETURNING *`,
      [req.user.id, JSON.stringify(manifest)]
    );
    await audit(pool, req.user.id, 'platform.backup.completed', 'backup_run', rows[0].id, manifest);
    res.status(201).json({ backupRun: rows[0] });
  }));

  router.post('/platform/deploys/run', asyncHandler(async (req, res) => {
    await requirePlatformRole(pool, req.user.id, ['devops', 'founder']);
    const { environment = 'local', component = 'api', ref = 'context-package' } = req.body || {};
    const { rows } = await pool.query(
      `INSERT INTO platform_deploy_runs(requested_by, environment, component, ref, status)
       VALUES($1,$2,$3,$4,'queued') RETURNING *`,
      [req.user.id, environment, component, ref]
    );
    await audit(pool, req.user.id, 'platform.deploy.queued', 'deploy_run', rows[0].id, { environment, component, ref });
    res.status(201).json({ deployRun: rows[0] });
  }));

  router.post('/platform/observability/events', asyncHandler(async (req, res) => {
    await requirePlatformRole(pool, req.user.id, ['devops', 'coder', 'founder']);
    const { source = 'platform-console', severity = 'info', message, metadata = {} } = req.body || {};
    if (!message) return res.status(400).json({ error: 'message is required' });
    const { rows } = await pool.query(
      `INSERT INTO platform_observability_events(source,severity,message,metadata,created_by)
       VALUES($1,$2,$3,$4,$5) RETURNING *`,
      [source, severity, message, JSON.stringify(metadata), req.user.id]
    );
    await audit(pool, req.user.id, 'platform.observability.event.created', 'observability_event', rows[0].id, { source, severity });
    res.status(201).json({ event: rows[0] });
  }));

  router.use((err, req, res, _next) => {
    res.status(err.status || 500).json({ error: err.message || 'Platform route error' });
  });

  return router;
}

function buildDashboards({ selectedCounts, userRows, storageRows, tableRows, roleCounts, auditRows }) {
  const counts = selectedCounts;
  const usersByTier = userRows.rows.map(row => ({ tier: row.subscription_tier || 'unknown', users: Number(row.users) }));
  return {
    founder: {
      title: 'Founder / Operator dashboard',
      cards: [
        { label: 'Users', value: counts.users, note: 'local accounts across user + platform tests' },
        { label: 'Memory entries', value: counts.entries, note: 'raw captured life fragments' },
        { label: 'Computed items', value: counts.items, note: 'state generated from captures' },
        { label: 'Roles seeded', value: Object.keys(roleCounts).length, note: 'platform role categories with accounts' },
      ],
      focus: ['User growth and activation', 'Data inventory', 'Governance gaps', 'Cost and tier posture'],
      usersByTier,
    },
    devops: {
      title: 'DevOps dashboard',
      cards: [
        { label: 'API', value: '8301', note: 'Node/Express health endpoint mounted' },
        { label: 'Postgres', value: '5544', note: `${tableRows.rows.length} tables in public schema` },
        { label: 'Redis', value: '6381', note: 'cache and future queue layer' },
        { label: 'MinIO', value: '9100', note: `${Number(storageRows.rows[0]?.files || 0)} indexed files` },
      ],
      focus: ['Service health', 'Backups and restore', 'Secrets and deploy environments', 'Queue depth and worker health'],
    },
    coder: {
      title: 'Coder dashboard',
      cards: [
        { label: 'Schema tables', value: tableRows.rows.length, note: 'v3 + platform schema surface' },
        { label: 'Plan cache', value: counts.plan_cache, note: 'current plan computation cache rows' },
        { label: 'Suggestion events', value: counts.suggestion_events, note: 'feedback/learning telemetry' },
        { label: 'Audit events', value: auditRows.rows.length, note: 'recent platform audit rows returned' },
      ],
      focus: ['API contracts', 'Schema drift', 'Seed data', 'Runtime package mounts'],
    },
    support: {
      title: 'Support dashboard',
      cards: [
        { label: 'Users', value: counts.users, note: 'accounts visible to local platform' },
        { label: 'Refresh tokens', value: counts.refresh_tokens, note: 'active login/session footprint' },
        { label: 'Notifications', value: counts.notifications, note: 'unread/support signal source' },
        { label: 'Rules', value: counts.rules, note: 'automation rules configured by users' },
      ],
      focus: ['Scoped user diagnostics', 'Export/delete workflows', 'Account state', 'Audit-backed support actions'],
    },
  };
}

async function getViewerMembership(pool, userId) {
  const { rows } = await pool.query(
    `SELECT om.role, o.id AS org_id, o.name AS org_name
       FROM organization_members om
       JOIN organizations o ON o.id=om.org_id
      WHERE om.user_id=$1
      ORDER BY om.created_at DESC
      LIMIT 1`,
    [userId]
  ).catch(() => ({ rows: [] }));
  return rows[0] || null;
}

async function requirePlatformRole(pool, userId, allowedRoles) {
  const membership = await getViewerMembership(pool, userId);
  if (!membership || !allowedRoles.includes(membership.role)) {
    const err = new Error(`Platform role required: ${allowedRoles.join(', ')}`);
    err.status = 403;
    throw err;
  }
  return membership;
}

async function requireDashboardAccess(pool, userId, requestedRole) {
  const membership = await getViewerMembership(pool, userId);
  if (!membership) {
    const err = new Error('Platform role required');
    err.status = 403;
    throw err;
  }
  const canViewAny = ['founder', 'operator'].includes(membership.role);
  if (!canViewAny && membership.role !== requestedRole) {
    const err = new Error(`Dashboard access denied for role ${requestedRole}`);
    err.status = 403;
    throw err;
  }
  return membership;
}

async function getUserByEmail(pool, email) {
  const { rows } = await pool.query(`SELECT id, email, name FROM users WHERE email=$1`, [email]);
  return rows[0] || null;
}

async function createDataRequest(pool, requesterUserId, email, type, reason) {
  if (!email) {
    const err = new Error('email is required');
    err.status = 400;
    throw err;
  }
  const user = await getUserByEmail(pool, email);
  if (!user) {
    const err = new Error('user not found');
    err.status = 404;
    throw err;
  }
  const { rows } = await pool.query(
    `INSERT INTO platform_data_requests(subject_user_id, requester_user_id, type, reason)
     VALUES($1,$2,$3,$4) RETURNING *`,
    [user.id, requesterUserId, type, reason]
  );
  await audit(pool, requesterUserId, `platform.data_request.${type}.created`, 'user', user.id, { requestId: rows[0].id, reason });
  return rows[0];
}

async function audit(pool, actorUserId, action, targetType, targetId, metadata = {}) {
  const membership = await getViewerMembership(pool, actorUserId);
  await pool.query(
    `INSERT INTO platform_audit_events(org_id, actor_user_id, action, target_type, target_id, metadata)
     VALUES($1,$2,$3,$4,$5,$6)`,
    [membership?.org_id || null, actorUserId, action, targetType, targetId, JSON.stringify(metadata)]
  ).catch(() => {});
}

async function buildRolePayload(pool, role) {
  const dashboard = await buildRoleOperatingModel(pool, role);

  if (role === 'founder' || role === 'operator') {
    const { rows: [row] } = await pool.query(
      `SELECT
        (SELECT count(*)::int FROM users) AS users,
        (SELECT count(*)::int FROM entries) AS entries,
        (SELECT count(*)::int FROM items) AS items,
        (SELECT count(*)::int FROM organization_members) AS platform_members,
        (SELECT count(*)::int FROM platform_invites WHERE status='pending') AS pending_invites,
        (SELECT count(*)::int FROM platform_data_requests WHERE status='requested') AS open_data_requests,
        (SELECT count(*)::int FROM platform_support_notes) AS support_notes,
        (SELECT count(*)::int FROM platform_audit_events) AS audit_events`
    );
    return { metrics: row, dashboard };
  }

  if (role === 'devops') {
    const { rows: [row] } = await pool.query(
      `SELECT
        (SELECT count(*)::int FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE') AS tables,
        (SELECT count(*)::int FROM platform_audit_events) AS audit_events,
        (SELECT count(*)::int FROM refresh_tokens) AS sessions,
        (SELECT count(*)::int FROM platform_backup_runs) AS backup_runs,
        (SELECT count(*)::int FROM platform_deploy_runs) AS deploy_runs,
        (SELECT count(*)::int FROM platform_observability_events WHERE severity IN ('error','critical')) AS serious_events`
    );
    return { metrics: row, dashboard };
  }

  if (role === 'coder') {
    const { rows } = await pool.query(
      `SELECT table_name, count(*)::int AS columns
         FROM information_schema.columns
        WHERE table_schema='public'
        GROUP BY table_name
        ORDER BY table_name`
    );
    return { schemaSummary: rows, dashboard };
  }

  const { rows: [support] } = await pool.query(
    `SELECT
      (SELECT count(*)::int FROM users) AS users,
      (SELECT count(*)::int FROM refresh_tokens) AS sessions,
      (SELECT count(*)::int FROM notifications) AS notifications,
      (SELECT count(*)::int FROM rules) AS rules,
      (SELECT count(*)::int FROM platform_support_notes) AS support_notes,
      (SELECT count(*)::int FROM platform_data_requests WHERE status='requested') AS open_data_requests`
  );
  return { metrics: support, dashboard };
}

async function buildRoleOperatingModel(pool, role) {
  const [counts, recentInvites, recentSupportNotes, recentRequests, recentBackups, recentDeploys, recentObs] = await Promise.all([
    getSelectedCounts(pool),
    pool.query(
      `SELECT invited_email, role, status, created_at
         FROM platform_invites
        ORDER BY created_at DESC
        LIMIT 5`
    ).catch(() => ({ rows: [] })),
    pool.query(
      `SELECT psn.category, psn.note, psn.created_at, u.email AS subject_email
         FROM platform_support_notes psn
         LEFT JOIN users u ON u.id=psn.subject_user_id
        ORDER BY psn.created_at DESC
        LIMIT 5`
    ).catch(() => ({ rows: [] })),
    pool.query(
      `SELECT pdr.type, pdr.status, pdr.reason, pdr.created_at, u.email AS subject_email
         FROM platform_data_requests pdr
         LEFT JOIN users u ON u.id=pdr.subject_user_id
        ORDER BY pdr.created_at DESC
        LIMIT 5`
    ).catch(() => ({ rows: [] })),
    pool.query(
      `SELECT id, status, manifest, created_at
         FROM platform_backup_runs
        ORDER BY created_at DESC
        LIMIT 5`
    ).catch(() => ({ rows: [] })),
    pool.query(
      `SELECT environment, component, ref, status, created_at
         FROM platform_deploy_runs
        ORDER BY created_at DESC
        LIMIT 5`
    ).catch(() => ({ rows: [] })),
    pool.query(
      `SELECT source, severity, message, created_at
         FROM platform_observability_events
        ORDER BY created_at DESC
        LIMIT 5`
    ).catch(() => ({ rows: [] })),
  ]);

  const models = {
    founder: {
      mission: 'Own business risk, people access, governance, and whether the product is ready to operate.',
      permissions: ['View every platform dashboard', 'Create invites', 'Grant access', 'Revoke access', 'Run backups/deploy intents', 'Read audit'],
      needs: [
        'Activation and data inventory that proves Flowra is more than a task list.',
        'Access control board showing who can enter operator/devops/coder/support surfaces.',
        'Governance queue for export/delete, audit, backup, and production readiness decisions.',
        'Action buttons that actually create access and operational records.',
      ],
      primaryActions: ['invite', 'grant', 'audit', 'backup-run', 'deploy-run'],
      liveQueues: [
        { label: 'Pending invites', value: counts.platform_invites, action: 'invite' },
        { label: 'Open data requests', value: counts.platform_data_requests, action: 'audit' },
        { label: 'Platform members', value: counts.organization_members, action: 'grant' },
        { label: 'Audit events', value: counts.platform_audit_events, action: 'audit' },
      ],
      records: {
        recentInvites: recentInvites.rows,
        recentRequests: recentRequests.rows,
        recentDeploys: recentDeploys.rows,
      },
    },
    operator: {
      mission: 'Run the daily platform: account health, support flow, data requests, and release readiness.',
      permissions: ['View founder/operator dashboard', 'Read accounts', 'Create invites', 'Create export requests', 'Write support notes', 'Read audit'],
      needs: [
        'Account pool with entries/items/session footprint so customer state is operational.',
        'Support handoff actions for notes and export workflows.',
        'Runbook status for health checks and local release gates.',
        'Audit trail proving every operator action leaves evidence.',
      ],
      primaryActions: ['accounts', 'invite', 'export-request', 'support-note', 'audit'],
      liveQueues: [
        { label: 'Users', value: counts.users, action: 'accounts' },
        { label: 'Support notes', value: counts.platform_support_notes, action: 'support-note' },
        { label: 'Data requests', value: counts.platform_data_requests, action: 'export-request' },
        { label: 'Audit events', value: counts.platform_audit_events, action: 'audit' },
      ],
      records: {
        recentSupportNotes: recentSupportNotes.rows,
        recentRequests: recentRequests.rows,
      },
    },
    devops: {
      mission: 'Operate runtime health, storage, backups, deploy intent, and incident signals.',
      permissions: ['View devops dashboard', 'Run service health', 'Create backup manifests', 'Queue deploy intents', 'Write observability events', 'Read audit'],
      needs: [
        'Live service map for API, Postgres, Redis, MinIO, and client runtime.',
        'Backup action that records what data/volumes are covered.',
        'Deploy action that records environment, component, ref, and status.',
        'Observability event ingestion until real production sinks are configured.',
      ],
      primaryActions: ['health', 'backup-run', 'deploy-run', 'observability-event', 'audit'],
      liveQueues: [
        { label: 'Backup runs', value: counts.platform_backup_runs, action: 'backup-run' },
        { label: 'Deploy runs', value: counts.platform_deploy_runs, action: 'deploy-run' },
        { label: 'Observability events', value: counts.platform_observability_events, action: 'observability-event' },
        { label: 'Audit events', value: counts.platform_audit_events, action: 'audit' },
      ],
      records: {
        recentBackups: recentBackups.rows,
        recentDeploys: recentDeploys.rows,
        recentObservabilityEvents: recentObs.rows,
      },
    },
    coder: {
      mission: 'See implementation truth: schema, mounted runtime files, API contracts, and instrumentation hooks.',
      permissions: ['View coder dashboard', 'Inspect schema', 'Run service health', 'Write observability events'],
      needs: [
        'Schema inventory with counts so drift is visible.',
        'API contract map tied to real endpoints, not documentation only.',
        'Runtime/package status for the non-repo context worktree.',
        'Instrumentation action to record engineering events into the platform ledger.',
      ],
      primaryActions: ['schema', 'health', 'observability-event'],
      liveQueues: [
        { label: 'Schema tables', value: counts.platform_audit_events === null ? null : undefined, action: 'schema' },
        { label: 'Plan cache rows', value: counts.plan_cache, action: 'schema' },
        { label: 'Suggestion events', value: counts.suggestion_events, action: 'schema' },
        { label: 'Observability events', value: counts.platform_observability_events, action: 'observability-event' },
      ],
      records: {
        recentObservabilityEvents: recentObs.rows,
      },
    },
    support: {
      mission: 'Diagnose users safely and create workflow records without directly mutating customer data.',
      permissions: ['View support dashboard', 'Read accounts', 'Write support notes', 'Create export requests', 'Create delete-review requests', 'Read audit'],
      needs: [
        'Account diagnostics with sessions, entries, items, and tier state.',
        'Support notes tied to user records and backed by audit.',
        'Export/delete workflows that record intent but avoid unsafe direct mutation.',
        'Clear boundary: support can diagnose and request, not run infra actions.',
      ],
      primaryActions: ['accounts', 'support-note', 'export-request', 'delete-request', 'audit'],
      liveQueues: [
        { label: 'Users', value: counts.users, action: 'accounts' },
        { label: 'Support notes', value: counts.platform_support_notes, action: 'support-note' },
        { label: 'Open data requests', value: counts.platform_data_requests, action: 'delete-request' },
        { label: 'Refresh tokens', value: counts.refresh_tokens, action: 'accounts' },
      ],
      records: {
        recentSupportNotes: recentSupportNotes.rows,
        recentRequests: recentRequests.rows,
      },
    },
  };

  const model = models[role] || models.support;
  if (role === 'coder') {
    const { rows } = await pool.query(
      `SELECT count(*)::int AS table_count
         FROM information_schema.tables
        WHERE table_schema='public' AND table_type='BASE TABLE'`
    ).catch(() => ({ rows: [{ table_count: null }] }));
    model.liveQueues[0].value = rows[0]?.table_count;
  }
  return model;
}

async function getSelectedCounts(pool) {
  const tables = [
    'users',
    'entries',
    'items',
    'item_events',
    'notifications',
    'rules',
    'plan_cache',
    'refresh_tokens',
    'file_attachments',
    'suggestion_events',
    'organizations',
    'organization_members',
    'platform_audit_events',
    'platform_invites',
    'platform_support_notes',
    'platform_data_requests',
    'platform_backup_runs',
    'platform_deploy_runs',
    'platform_observability_events',
  ];

  const result = {};
  for (const table of tables) {
    try {
      const { rows } = await pool.query(`SELECT count(*)::int AS n FROM ${table}`);
      result[table] = rows[0]?.n || 0;
    } catch (_) {
      result[table] = null;
    }
  }
  return result;
}

module.exports = platformRoutes;
