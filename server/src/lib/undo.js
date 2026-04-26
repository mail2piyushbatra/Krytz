/**
 * ✦ UNDO SYSTEM
 * Doc 7: "last 5 actions reversible"
 * Before done/snooze/drop: snapshot item state → undo_log
 * POST /action/undo — restores last action, invalidates plan cache
 * GET  /action/history — last 5 reversible actions
 */
'use strict';

const { v4: uuid } = require('uuid');
const MAX_UNDO_HISTORY = 10;

async function snapshotForUndo(db, userId, itemId, actionType) {
  const { rows } = await db.query(`SELECT * FROM items WHERE id=$1 AND user_id=$2`, [itemId, userId]);
  if (rows.length === 0) throw new Error(`Item ${itemId} not found`);
  const item = rows[0];
  const { rows: snoozes } = await db.query(`SELECT snooze_until FROM snoozes WHERE item_id=$1 AND user_id=$2`, [itemId, userId]);

  const snapshot = { state: item.state, priority: item.priority, confidence: item.confidence, blocker: item.blocker, last_seen: item.last_seen, mention_count: item.mention_count, snooze_until: snoozes[0]?.snooze_until || null };

  await db.query(`INSERT INTO undo_log(id,user_id,action_type,item_id,snapshot) VALUES($1,$2,$3,$4,$5)`, [uuid(), userId, actionType, itemId, JSON.stringify(snapshot)]);

  // Keep only MAX_UNDO_HISTORY entries per user
  await db.query(`DELETE FROM undo_log WHERE id IN (SELECT id FROM undo_log WHERE user_id=$1 AND reversed=false ORDER BY created_at DESC OFFSET $2)`, [userId, MAX_UNDO_HISTORY]);
}

async function undoLastAction(db, userId) {
  const { rows } = await db.query(`SELECT ul.*, i.canonical_text FROM undo_log ul LEFT JOIN items i ON i.id=ul.item_id WHERE ul.user_id=$1 AND ul.reversed=false AND ul.item_id IS NOT NULL ORDER BY ul.created_at DESC LIMIT 1`, [userId]);
  if (rows.length === 0) return { ok: false, message: 'Nothing to undo' };

  const entry = rows[0], snapshot = entry.snapshot;

  // Restore item state
  await db.query(
    `UPDATE items SET state=$2, priority=$3, confidence=$4, blocker=$5, last_seen=$6, mention_count=$7, updated_at=now() WHERE id=$1`,
    [entry.item_id, snapshot.state, snapshot.priority, snapshot.confidence, snapshot.blocker, snapshot.last_seen, snapshot.mention_count]
  );

  // Restore or remove snooze
  if (snapshot.snooze_until) {
    await db.query(`INSERT INTO snoozes(user_id,item_id,snooze_until) VALUES($1,$2,$3) ON CONFLICT(user_id,item_id) DO UPDATE SET snooze_until=$3`, [userId, entry.item_id, snapshot.snooze_until]);
  } else {
    await db.query(`DELETE FROM snoozes WHERE user_id=$1 AND item_id=$2`, [userId, entry.item_id]);
  }

  // Insert reverse transition event
  await db.query(`INSERT INTO item_events(id,item_id,from_state,to_state,confidence,reason) SELECT uuid_generate_v4(),$1,state,$2,0.9,'undo' FROM items WHERE id=$1`, [entry.item_id, snapshot.state]);

  await db.query(`UPDATE undo_log SET reversed=true WHERE id=$1`, [entry.id]);

  // Refresh priority + invalidate plan cache
  try { const { refreshPriority } = require('../engines/graph/item.graph'); await refreshPriority(db, entry.item_id); } catch (_) {}
  try { const { invalidatePlanCache } = require('../engines/intelligence/plan.engine'); await invalidatePlanCache(db, userId); } catch (_) {}

  return { ok: true, undone: entry.action_type, itemId: entry.item_id, itemText: entry.canonical_text, restoredTo: snapshot.state };
}

async function getUndoHistory(db, userId, limit = 5) {
  const { rows } = await db.query(
    `SELECT ul.id, ul.action_type, ul.created_at, ul.reversed, i.canonical_text, i.state AS current_state
     FROM undo_log ul LEFT JOIN items i ON i.id=ul.item_id
     WHERE ul.user_id=$1 ORDER BY ul.created_at DESC LIMIT $2`,
    [userId, limit]
  );
  return rows.map(r => ({ id: r.id, actionType: r.action_type, itemText: r.canonical_text, currentState: r.current_state, reversed: r.reversed, at: r.created_at, canUndo: !r.reversed }));
}

module.exports = { snapshotForUndo, undoLastAction, getUndoHistory };
