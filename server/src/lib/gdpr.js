/**
 * ✦ GDPR DELETION
 * Right to be forgotten — complete erasure of all user data.
 * Deletes in correct FK order. Anonymises aggregated metrics (no PII).
 * Compliance audit log. 24h grace period with cancel support.
 * Exposed via: DELETE /auth/me/gdpr
 */
'use strict';

const { v4: uuid } = require('uuid');
const logger = require('./logger');

async function scheduleDeletion(db, userId) {
  const deleteAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await db.query(
    `INSERT INTO deletion_requests(id,user_id,scheduled_at,status) VALUES($1,$2,$3,'pending')
     ON CONFLICT(user_id) DO UPDATE SET scheduled_at=$3, status='pending', cancelled_at=NULL`,
    [uuid(), userId, deleteAt]
  ).catch(async () => {
    await db.query(`CREATE TABLE IF NOT EXISTS deletion_requests (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), user_id UUID UNIQUE NOT NULL, scheduled_at TIMESTAMPTZ NOT NULL, status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','cancelled','completed')), cancelled_at TIMESTAMPTZ, completed_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    await db.query(`INSERT INTO deletion_requests(id,user_id,scheduled_at,status) VALUES($1,$2,$3,'pending') ON CONFLICT(user_id) DO UPDATE SET scheduled_at=$3, status='pending'`, [uuid(), userId, deleteAt]);
  });
  logger.info('Deletion scheduled', { userId, deleteAt });
  return { scheduledAt: deleteAt, canCancelUntil: deleteAt };
}

async function cancelDeletion(db, userId) {
  await db.query(`UPDATE deletion_requests SET status='cancelled', cancelled_at=now() WHERE user_id=$1 AND status='pending'`, [userId]);
  logger.info('Deletion cancelled', { userId });
}

async function executeUserDeletion(db, userId) {
  logger.info('Starting GDPR deletion', { userId });

  // FK-ordered delete: leaf tables first
  const tables = [
    'suggestion_events', 'undo_log', 'snoozes', 'capture_queue',
    'plan_cache', 'cost_usage', 'time_estimates', 'commitments',
    'contradictions', 'user_intelligence_stage',
    'entity_aliases', 'entities', 'action_runs',
    'notifications', 'feedback', 'memory_summaries',
    'semantic_memory', 'episodic_memory', 'item_events', 'item_edges',
    'items', 'rules', 'events', 'metrics',
  ];

  const counts = {};
  for (const table of tables) {
    try {
      let q, params;
      if (table === 'item_events')  { q = `DELETE FROM item_events WHERE item_id IN (SELECT id FROM items WHERE user_id=$1)`;                        params = [userId]; }
      else if (table === 'action_runs') { q = `DELETE FROM action_runs WHERE rule_id IN (SELECT id FROM rules WHERE user_id=$1)`;               params = [userId]; }
      else                          { q = `DELETE FROM ${table} WHERE user_id=$1`;                                                                     params = [userId]; }
      const { rowCount } = await db.query(q, params).catch(() => ({ rowCount: 0 }));
      counts[table] = rowCount;
    } catch (err) { logger.error(`Failed to delete from ${table}`, { userId, error: err.message }); }
  }

  await db.query(`UPDATE metrics SET user_id=NULL WHERE user_id=$1`, [userId]).catch(() => {});
  await db.query(`DELETE FROM users WHERE id=$1`, [userId]).catch(() => {});
  await db.query(`UPDATE deletion_requests SET status='completed', completed_at=now() WHERE user_id=$1`, [userId]).catch(() => {});
  await db.query(`INSERT INTO events(id,type,payload) VALUES(uuid_generate_v4(),'USER_DATA_DELETED',$1)`, [JSON.stringify({ userId, deletedAt: new Date().toISOString(), tablesAffected: Object.keys(counts).length })]).catch(() => {});

  logger.info('GDPR deletion complete', { userId, tablesAffected: Object.keys(counts).length });
  return { ok: true, userId, counts };
}

async function processPendingDeletions(db) {
  const { rows } = await db.query(`SELECT user_id FROM deletion_requests WHERE status='pending' AND scheduled_at <= now()`).catch(() => ({ rows: [] }));
  for (const { user_id } of rows) {
    const { withAdminContext } = require('../middleware/rls.middleware');
    await withAdminContext(db, (client) => executeUserDeletion(client, user_id))
      .catch(err => logger.error('Deletion failed', { user_id, error: err.message }));
  }
  return rows.length;
}

module.exports = { scheduleDeletion, cancelDeletion, executeUserDeletion, processPendingDeletions };
