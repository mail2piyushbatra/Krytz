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
const logger = require('./logger');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on('error', (err) => {
  logger.error('Unexpected pool error', { error: err.message });
});

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
module.exports.verifyConnection = verifyConnection;
module.exports.closePool = closePool;
