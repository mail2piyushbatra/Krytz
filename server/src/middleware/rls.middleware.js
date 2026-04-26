/**
 * ✦ RLS MIDDLEWARE
 * Sets app.current_user_id in Postgres per-request — activates Row Level Security.
 * No query can return data for a different user, even if there's a route bug.
 *
 * Usage in server.js:
 *   app.use('/api', authMiddleware);
 *   app.use('/api', tierMiddleware(pool));
 *   app.use('/api', rlsMiddleware(pool));
 */
'use strict';

// ─── Express middleware ───────────────────────────────────────────────────────
function rlsMiddleware(pool) {
  return async (req, res, next) => {
    if (!req.user?.id) return next();

    const client = await pool.connect();
    req.dbClient = client;
    req.db       = client;

    try {
      await client.query(`SET LOCAL app.current_user_id = '${req.user.id}'`);
      next();
    } catch (err) {
      client.release();
      next(err);
    }

    res.on('finish', () => { try { client.release(); } catch (_) {} });
    res.on('close',  () => { try { client.release(); } catch (_) {} });
  };
}

// ─── Background job helper ────────────────────────────────────────────────────
async function withUserContext(pool, userId, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL app.current_user_id = '${userId}'`);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ─── Admin context (bypasses RLS for GDPR, analytics, migrations) ─────────────
async function withAdminContext(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL app.current_user_id = ''`);  // no match = no RLS restriction
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { rlsMiddleware, withUserContext, withAdminContext };
