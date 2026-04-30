/**
 * ✦ DATABASE — pg Pool singleton
 *
 * Single shared Pool for the entire server process.
 * Replaces Prisma — all data access uses raw SQL via this pool.
 *
 * Usage:
 *   const db = require('./db');
 *   const { rows } = await db.query('SELECT * FROM users WHERE id=$1', [id]);
 */

'use strict';

const { Pool } = require('pg');
const { AsyncLocalStorage } = require('async_hooks');
const logger = require('./logger');

const requestDbContext = new AsyncLocalStorage();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on('error', (err) => {
  logger.error('Unexpected pool error', { error: err.message });
});

const baseQuery = pool.query.bind(pool);
pool.query = (...args) => {
  const store = requestDbContext.getStore();
  if (store?.active && store.client) return store.client.query(...args);
  return baseQuery(...args);
};

function runWithClient(client, fn) {
  const store = { active: true, client };
  return requestDbContext.run(store, () => fn(store));
}

/**
 * Verify database connectivity. Call once at startup.
 */
async function verifyConnection() {
  const client = await pool.connect();
  try {
    await client.query('SELECT 1');
    logger.info('Database connected', { host: pool.options.host || 'from-url' });
  } finally {
    client.release();
  }
}

/**
 * Graceful shutdown — drain all connections.
 */
async function closePool() {
  await pool.end();
  logger.info('Database pool closed');
}

module.exports = pool;
module.exports.runWithClient = runWithClient;
module.exports.verifyConnection = verifyConnection;
module.exports.closePool = closePool;
