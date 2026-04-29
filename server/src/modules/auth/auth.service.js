const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { Pool } = require('pg');
const { AppError } = require('../../middleware/errorHandler');

const SALT_ROUNDS = 12;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

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
  } catch (err) { /* non-blocking — categories can be created later */ }

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
  await pool.query('DELETE FROM users WHERE id = $1', [userId]);
  return { message: 'Account and all data deleted.' };
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
