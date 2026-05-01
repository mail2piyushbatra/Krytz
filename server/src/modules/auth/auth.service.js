const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { AppError } = require('../../middleware/errorHandler');
const pool = require('../../lib/db');

const SALT_ROUNDS = 12;

const ACCOUNT_DELETION_STEPS = [
  ['platform_support_notes', 'subject_user_id = $1 OR author_user_id = $1'],
  ['platform_data_requests', 'subject_user_id = $1 OR requester_user_id = $1'],
  ['platform_audit_events', 'actor_user_id = $1'],
  ['platform_backup_runs', 'requested_by = $1'],
  ['platform_deploy_runs', 'requested_by = $1'],
  ['platform_observability_events', 'created_by = $1'],
  ['file_attachments', 'entry_id IN (SELECT id FROM entries WHERE user_id = $1)'],
  ['extracted_states', 'entry_id IN (SELECT id FROM entries WHERE user_id = $1)'],
  ['decision_traces', 'user_id = $1'],
  ['traces', 'user_id = $1'],
  ['anomaly_events', 'user_id = $1'],
  ['command_log', 'user_id = $1'],
  ['user_learning_model', 'user_id = $1'],
  ['connector_state', 'user_id = $1'],
  ['plan_cache', 'user_id = $1'],
  ['cost_usage', 'user_id = $1'],
  ['capture_queue', 'user_id = $1'],
  ['notifications', 'user_id = $1'],
  ['feedback', 'user_id = $1'],
  ['memory_summaries', 'user_id = $1'],
  ['semantic_memory', 'user_id = $1'],
  ['episodic_memory', 'user_id = $1'],
  ['entity_aliases', 'user_id = $1'],
  ['entities', 'user_id = $1'],
  ['commitment_dependencies', 'commitment_id IN (SELECT id FROM commitments WHERE user_id = $1) OR depends_on_id IN (SELECT id FROM commitments WHERE user_id = $1)'],
  ['contradictions', 'user_id = $1'],
  ['commitments', 'user_id = $1'],
  ['time_estimates', 'user_id = $1'],
  ['deletion_requests', 'user_id = $1'],
  ['stripe_customers', 'user_id = $1'],
  ['action_runs', 'item_id IN (SELECT id FROM items WHERE user_id = $1) OR rule_id IN (SELECT id FROM rules WHERE user_id = $1)'],
  ['rules', 'user_id = $1'],
  ['item_events', 'item_id IN (SELECT id FROM items WHERE user_id = $1)'],
  ['item_edges', 'user_id = $1 OR from_item IN (SELECT id FROM items WHERE user_id = $1) OR to_item IN (SELECT id FROM items WHERE user_id = $1)'],
  ['suggestion_events', 'user_id = $1'],
  ['undo_log', 'user_id = $1'],
  ['snoozes', 'user_id = $1'],
  ['items', 'user_id = $1'],
  ['entries', 'user_id = $1'],
  ['categories', 'user_id = $1'],
  ['daily_states', 'user_id = $1'],
  ['metrics', 'user_id = $1'],
  ['events', 'user_id = $1'],
  ['refresh_tokens', 'user_id = $1'],
  ['organization_members', 'user_id = $1'],
];

async function register({ email, password, name }) {
  const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
  if (existing.rows.length > 0) {
    throw new AppError('Email already registered.', 409, 'CONFLICT');
  }

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  const { rows } = await pool.query(
    `INSERT INTO users(email, password_hash, name)
     VALUES($1, $2, $3)
     RETURNING id, email, name, timezone, onboarded, settings, created_at`,
    [email, passwordHash, name || null]
  );

  await bootstrapFirstPlatformFounder(rows[0].id);

  // Seed default categories so auto-categorization works from the first task
  try {
    const { seedDefaults } = require('../categories/category.service');
    await seedDefaults(rows[0].id);
  } catch { /* non-blocking — categories can be created later */ }

  const user = await toApiUser(rows[0]);
  const tokens = await generateTokens(user);
  return { user, ...tokens };
}

async function login({ email, password }) {
  const { rows } = await pool.query(
    `SELECT id, email, name, password_hash, timezone, onboarded, settings, created_at
     FROM users
     WHERE email = $1`,
    [email]
  );

  if (rows.length === 0) {
    throw new AppError('Invalid email or password.', 401, 'UNAUTHORIZED');
  }

  const valid = await bcrypt.compare(password, rows[0].password_hash || '');
  if (!valid) {
    throw new AppError('Invalid email or password.', 401, 'UNAUTHORIZED');
  }

  const user = await toApiUser(rows[0]);
  const tokens = await generateTokens(user);
  return { user, ...tokens };
}

async function refresh(refreshToken) {
  const { rows } = await pool.query(
    `SELECT rt.id AS token_id,
            rt.expires_at,
            u.id,
            u.email,
            u.name,
            u.timezone,
            u.onboarded,
            u.settings,
            u.created_at
     FROM refresh_tokens rt
     JOIN users u ON u.id = rt.user_id
     WHERE rt.token = $1`,
    [refreshToken]
  );

  if (rows.length === 0 || new Date(rows[0].expires_at) < new Date()) {
    if (rows.length > 0) {
      await pool.query('DELETE FROM refresh_tokens WHERE id = $1', [rows[0].token_id]);
    }
    throw new AppError('Invalid or expired refresh token.', 401, 'UNAUTHORIZED');
  }

  await pool.query('DELETE FROM refresh_tokens WHERE id = $1', [rows[0].token_id]);

  const user = await toApiUser(rows[0]);
  const tokens = await generateTokens(user);
  return { user, ...tokens };
}

async function getProfile(userId) {
  const { rows } = await pool.query(
    `SELECT id, email, name, timezone, onboarded, settings, created_at
     FROM users
     WHERE id = $1`,
    [userId]
  );

  if (rows.length === 0) throw new AppError('User not found.', 404, 'NOT_FOUND');
  return toApiUser(rows[0]);
}

async function deleteAccount(userId) {
  const client = await pool.connect();
  const tableCache = new Map();
  let fileKeys = [];

  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.current_user_id', $1, true)`, [userId]);

    const user = await getUserForDeletion(client, userId);
    if (!user) throw new AppError('User not found.', 404, 'NOT_FOUND');

    fileKeys = await getAccountFileKeys(client, tableCache, userId);

    if (user.email) {
      await deleteWhereIfTableExists(
        client,
        tableCache,
        'platform_invites',
        'invited_by = $1 OR lower(invited_email) = lower($2)',
        [userId, user.email]
      );
    } else {
      await deleteWhereIfTableExists(client, tableCache, 'platform_invites', 'invited_by = $1', [userId]);
    }

    for (const [tableName, whereClause] of ACCOUNT_DELETION_STEPS) {
      await deleteWhereIfTableExists(client, tableCache, tableName, whereClause, [userId]);
    }

    await deleteWhereIfTableExists(client, tableCache, 'users', 'id = $1', [userId]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  if (fileKeys.length > 0) {
    const { deleteFilesFromS3 } = require('../files/file.service');
    await deleteFilesFromS3(fileKeys);
  }

  return { message: 'Account and all data deleted.' };
}

async function getUserForDeletion(client, userId) {
  const { rows } = await client.query('SELECT id, email FROM users WHERE id = $1', [userId]);
  return rows[0] || null;
}

async function getAccountFileKeys(client, tableCache, userId) {
  const hasEntries = await tableExists(client, tableCache, 'entries');
  const hasFiles = await tableExists(client, tableCache, 'file_attachments');
  if (!hasEntries || !hasFiles) return [];

  const { rows } = await client.query(
    `SELECT DISTINCT fa.file_key
       FROM file_attachments fa
       JOIN entries e ON e.id = fa.entry_id
      WHERE e.user_id = $1
        AND fa.file_key IS NOT NULL`,
    [userId]
  );
  return rows.map((row) => row.file_key).filter(Boolean);
}

async function deleteWhereIfTableExists(client, tableCache, tableName, whereClause, params) {
  if (!(await tableExists(client, tableCache, tableName))) return 0;
  const { rowCount } = await client.query(`DELETE FROM ${tableName} WHERE ${whereClause}`, params);
  return rowCount;
}

async function tableExists(client, tableCache, tableName) {
  assertSafeTableName(tableName);
  if (tableCache.has(tableName)) return tableCache.get(tableName);

  const { rows: [row] } = await client.query('SELECT to_regclass($1) AS table_name', [`public.${tableName}`]);
  const exists = Boolean(row.table_name);
  tableCache.set(tableName, exists);
  return exists;
}

function assertSafeTableName(tableName) {
  if (!/^[a-z_][a-z0-9_]*$/.test(tableName)) {
    throw new Error(`Unsafe table name: ${tableName}`);
  }
}

async function generateTokens(user) {
  const accessToken = jwt.sign(
    { sub: user.id, email: user.email },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '15m' }
  );

  const refreshToken = crypto.randomBytes(40).toString('hex');
  await pool.query(
    `INSERT INTO refresh_tokens(token, user_id, expires_at)
     VALUES($1, $2, $3)`,
    [refreshToken, user.id, new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)]
  );

  return { accessToken, refreshToken };
}

async function toApiUser(row) {
  const platformMemberships = await getPlatformMemberships(row.id);
  const primaryMembership = platformMemberships[0] || null;
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: primaryMembership?.role || 'member',
    platformRole: primaryMembership?.role || null,
    platformMemberships,
    timezone: row.timezone,
    daily_cost_usd: row.daily_cost_usd,
    onboarded: row.onboarded,
    settings: row.settings,
    createdAt: row.created_at,
  };
}

async function getPlatformMemberships(userId) {
  const { rows } = await pool.query(
    `SELECT om.role, o.id AS "orgId", o.name AS "orgName", o.slug AS "orgSlug"
       FROM organization_members om
       JOIN organizations o ON o.id = om.org_id
      WHERE om.user_id = $1
      ORDER BY om.created_at DESC`,
    [userId]
  ).catch(() => ({ rows: [] }));
  return rows;
}

async function bootstrapFirstPlatformFounder(userId) {
  const { rows: [row] } = await pool.query(
    `SELECT count(*)::int AS count FROM organization_members`
  ).catch(() => ({ rows: [{ count: 1 }] }));

  if (row.count > 0) return;

  const { rows: [org] } = await pool.query(
    `INSERT INTO organizations(name, slug)
     VALUES('Krytz Local Ops', 'Krytz-local-ops')
     ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`
  );
  await pool.query(
    `INSERT INTO organization_members(org_id, user_id, role)
     VALUES($1, $2, 'founder')
     ON CONFLICT (org_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
    [org.id, userId]
  );
}

async function updateProfile(userId, updates) {
  const sets = [];
  const params = [];
  let idx = 1;

  if (updates.name !== undefined) {
    sets.push(`name = $${idx++}`);
    params.push(updates.name);
  }
  if (updates.timezone !== undefined) {
    sets.push(`timezone = $${idx++}`);
    params.push(updates.timezone);
  }
  if (updates.onboarded !== undefined) {
    sets.push(`onboarded = $${idx++}`);
    params.push(updates.onboarded);
  }
  if (updates.settings !== undefined) {
    sets.push(`settings = $${idx++}`);
    params.push(updates.settings);
  }
  if (updates.daily_cost_usd !== undefined) {
    const budget = parseFloat(updates.daily_cost_usd);
    if (isNaN(budget) || budget < 0 || budget > 10) {
      throw new AppError('daily_cost_usd must be between 0 and 10', 400, 'BAD_REQUEST');
    }
    sets.push(`daily_cost_usd = $${idx++}`);
    params.push(budget);
  }

  if (sets.length === 0) throw new AppError('No fields to update', 400, 'BAD_REQUEST');

  sets.push(`updated_at = now()`);
  params.push(userId);

  const { rows } = await pool.query(
    `UPDATE users
     SET ${sets.join(', ')}
     WHERE id = $${idx}
     RETURNING id, email, name, timezone, daily_cost_usd, onboarded, settings, created_at`,
    params
  );

  if (rows.length === 0) throw new AppError('User not found.', 404, 'NOT_FOUND');
  return toApiUser(rows[0]);
}

async function forgotPassword(email) {
  const { rows } = await pool.query('SELECT id, name FROM users WHERE email = $1', [email]);
  if (rows.length === 0) {
    return { message: 'If that email exists, a reset link has been sent.' };
  }

  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

  await pool.query(
    'UPDATE users SET reset_token = $1, reset_expires_at = $2 WHERE id = $3',
    [token, expires, rows[0].id]
  );

  console.log(`\n\n=== PASSWORD RESET LINK ===\nMock email sent to ${email}\nReset Token: ${token}\nURL: http://localhost:5173/?resetToken=${token}\n===========================\n\n`);

  return { message: 'If that email exists, a reset link has been sent.' };
}

async function resetPassword(token, newPassword) {
  const { rows } = await pool.query(
    'SELECT id, reset_expires_at FROM users WHERE reset_token = $1',
    [token]
  );

  if (rows.length === 0) {
    throw new AppError('Invalid or expired reset token', 400, 'BAD_REQUEST');
  }

  if (new Date(rows[0].reset_expires_at) < new Date()) {
    throw new AppError('Reset token has expired', 400, 'BAD_REQUEST');
  }

  const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);

  await pool.query(
    'UPDATE users SET password_hash = $1, reset_token = NULL, reset_expires_at = NULL WHERE id = $2',
    [passwordHash, rows[0].id]
  );

  return { message: 'Password has been reset successfully.' };
}

async function changePassword(userId, currentPassword, newPassword) {
  const { rows } = await pool.query('SELECT password_hash FROM users WHERE id = $1', [userId]);
  if (rows.length === 0) throw new AppError('User not found.', 404, 'NOT_FOUND');

  const valid = await bcrypt.compare(currentPassword, rows[0].password_hash || '');
  if (!valid) throw new AppError('Incorrect current password.', 401, 'UNAUTHORIZED');

  const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
  await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, userId]);

  return { message: 'Password updated successfully.' };
}

module.exports = { register, login, refresh, getProfile, updateProfile, deleteAccount, forgotPassword, resetPassword, changePassword };
