/**
 * RLS middleware.
 * Sets app.current_user_id in Postgres per authenticated request.
 */
'use strict';

const jwt = require('jsonwebtoken');

function rlsMiddleware(pool) {
  return async (req, res, next) => {
    let client;
    let finalized = false;
    let contextStore = null;

    try {
      attachUserFromBearer(req);
      if (!req.user?.id) return next();

      client = await pool.connect();
      req.dbClient = client;
      req.db = client;

      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.current_user_id', $1, true)`, [req.user.id]);

      const finalize = async (commit) => {
        if (finalized) return;
        finalized = true;
        if (contextStore) contextStore.active = false;
        try {
          await client.query(commit ? 'COMMIT' : 'ROLLBACK');
        } finally {
          client.release();
        }
      };

      res.once('finish', () => {
        void finalize(res.statusCode < 400);
      });
      res.once('close', () => {
        if (!res.writableEnded) void finalize(false);
      });

      if (typeof pool.runWithClient === 'function') {
        return pool.runWithClient(client, (store) => {
          contextStore = store;
          next();
        });
      }

      return next();
    } catch (err) {
      if (client && !finalized) {
        finalized = true;
        try { await client.query('ROLLBACK'); } catch {}
        client.release();
      }
      return next(err);
    }
  };
}

function attachUserFromBearer(req) {
  if (req.user?.id) return;
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return;

  const decoded = jwt.verify(authHeader.split(' ')[1], process.env.JWT_SECRET);
  req.user = { id: decoded.sub, email: decoded.email };
}

async function withUserContext(pool, userId, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.current_user_id', $1, true)`, [userId]);
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

async function withAdminContext(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.current_user_id', $1, true)`, ['']);
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
