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

  const user = toApiUser(rows[0]);
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

  const user = toApiUser(rows[0]);
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

  const user = toApiUser(rows[0]);
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

function toApiUser(row) {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    timezone: row.timezone,
    onboarded: row.onboarded,
    settings: row.settings,
    createdAt: row.created_at,
  };
}

module.exports = { register, login, refresh, getProfile, deleteAccount };
