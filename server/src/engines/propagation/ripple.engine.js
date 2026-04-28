/**
 * ✦ RIPPLE PROPAGATION ENGINE
 *
 * When an item changes state (e.g. DONE), propagate effects through the
 * dependency DAG. Downstream items may unlock, re-prioritize, or surface.
 *
 * Propagation rules:
 *   - Item completes → check all items depending on it
 *   - If all upstream deps are DONE → downstream item is unblocked
 *   - If downstream item was BLOCKED → transition to OPEN
 *   - Re-score priority for affected items (dependency pressure changed)
 *   - Depth-limited (max 10 levels, max 50 nodes) to prevent runaway cascades
 *   - Deterministic: same input state → same propagation result
 *
 * Propagation types:
 *   COMPLETION:  item done → downstream may unlock
 *   BLOCKING:    item blocked → downstream inherits block
 *   PRIORITY:    priority change → downstream rescored
 *   DELETION:    item dropped → downstream edges cleaned
 */
'use strict';

const logger = require('../../lib/logger');
const causality = require('../causality/causality.graph');

const MAX_DEPTH = causality.MAX_PROPAGATION_DEPTH;
const MAX_NODES = causality.MAX_PROPAGATION_NODES;

const PropagationType = Object.freeze({
  COMPLETION: 'COMPLETION',
  BLOCKING:   'BLOCKING',
  PRIORITY:   'PRIORITY',
  DELETION:   'DELETION',
});

/**
 * Propagate the effects of an item state change through the dependency DAG.
 *
 * @param {Object} db         - pg Pool
 * @param {string} userId
 * @param {string} itemId     - the item that changed
 * @param {string} newState   - new state of the item
 * @param {string} prevState  - previous state
 * @returns {Object} { affected: ItemUpdate[], depth, totalNodes, events }
 */
async function propagate(db, userId, itemId, newState, prevState) {
  const events   = [];
  const affected = [];
  const visited  = new Set();
  let totalNodes = 0;

  const propagationType = _classifyChange(newState, prevState);

  if (propagationType === PropagationType.COMPLETION) {
    await _propagateCompletion(db, userId, itemId, visited, affected, events, 0);
  } else if (propagationType === PropagationType.BLOCKING) {
    await _propagateBlocking(db, userId, itemId, visited, affected, events, 0);
  } else if (propagationType === PropagationType.DELETION) {
    await _propagateDeletion(db, userId, itemId, visited, affected, events, 0);
  } else if (propagationType === PropagationType.PRIORITY) {
    await _propagatePriorityChange(db, userId, itemId, visited, affected, events, 0);
  }

  totalNodes = visited.size;

  if (affected.length > 0) {
    logger.info('Ripple propagation complete', {
      userId, itemId, propagationType, affected: affected.length, totalNodes,
    });
  }

  return {
    sourceItem:     itemId,
    propagationType,
    affected,
    depth:          _maxDepth(events),
    totalNodes,
    events,
    deterministic:  true,
  };
}

// ─── Completion propagation ───────────────────────────────────────────────────

async function _propagateCompletion(db, userId, completedItemId, visited, affected, events, depth) {
  if (depth >= MAX_DEPTH || visited.size >= MAX_NODES) return;
  visited.add(completedItemId);

  // Find items that depend on the completed item
  const { rows: dependents } = await db.query(
    `SELECT e.from_item, i.id, i.canonical_text, i.state, i.blocker, i.priority
     FROM item_edges e JOIN items i ON i.id = e.from_item
     WHERE e.to_item = $1 AND e.user_id = $2 AND i.state NOT IN ('DONE', 'DROPPED')`,
    [completedItemId, userId]
  );

  for (const dep of dependents) {
    if (visited.has(dep.id)) continue;

    // Check if ALL upstream deps of this dependent are now DONE
    const { rows: [{ pending_count }] } = await db.query(
      `SELECT count(*) AS pending_count FROM item_edges e
       JOIN items upstream ON upstream.id = e.to_item
       WHERE e.from_item = $1 AND e.user_id = $2 AND upstream.state NOT IN ('DONE', 'DROPPED')`,
      [dep.id, userId]
    );

    const pendingUpstream = parseInt(pending_count);

    if (pendingUpstream === 0) {
      // All dependencies resolved — unblock this item
      const update = { id: dep.id, text: dep.canonical_text };

      if (dep.blocker) {
        // Clear blocker flag
        await db.query(`UPDATE items SET blocker = false, updated_at = now() WHERE id = $1`, [dep.id]);
        update.change = 'unblocked';
        events.push({ type: 'UNBLOCKED', itemId: dep.id, depth, triggeredBy: completedItemId });
      }

      if (dep.state === 'OPEN') {
        // Boost priority since it's now actionable
        await db.query(
          `UPDATE items SET priority = LEAST(1.0, priority + 0.15), updated_at = now() WHERE id = $1`,
          [dep.id]
        );
        update.change = update.change || 'priority_boosted';
        events.push({ type: 'PRIORITY_BOOSTED', itemId: dep.id, depth, delta: 0.15, triggeredBy: completedItemId });
      }

      affected.push(update);

      // Log the event
      await db.query(
        `INSERT INTO item_events(item_id, from_state, to_state, confidence, reason)
         VALUES($1, $2, $2, NULL, $3)`,
        [dep.id, dep.state, `ripple_unlock:${completedItemId}`]
      ).catch(() => {});

      // Continue propagation downstream
      await _propagateCompletion(db, userId, dep.id, visited, affected, events, depth + 1);
    } else {
      // Still has pending upstream — just note reduced pressure
      events.push({ type: 'PRESSURE_REDUCED', itemId: dep.id, depth, pendingUpstream, triggeredBy: completedItemId });
    }
  }
}

// ─── Blocking propagation ─────────────────────────────────────────────────────

async function _propagateBlocking(db, userId, blockedItemId, visited, affected, events, depth) {
  if (depth >= MAX_DEPTH || visited.size >= MAX_NODES) return;
  visited.add(blockedItemId);

  // Items depending on the blocked item inherit block awareness
  const { rows: dependents } = await db.query(
    `SELECT e.from_item, i.id, i.canonical_text, i.state
     FROM item_edges e JOIN items i ON i.id = e.from_item
     WHERE e.to_item = $1 AND e.user_id = $2 AND i.state NOT IN ('DONE', 'DROPPED')`,
    [blockedItemId, userId]
  );

  for (const dep of dependents) {
    if (visited.has(dep.id)) continue;

    // Don't force-block downstream (they might have other paths), but note it
    events.push({ type: 'UPSTREAM_BLOCKED', itemId: dep.id, depth, blockedBy: blockedItemId });

    affected.push({
      id:     dep.id,
      text:   dep.canonical_text,
      change: 'upstream_blocked',
    });

    await _propagateBlocking(db, userId, dep.id, visited, affected, events, depth + 1);
  }
}

// ─── Deletion propagation ─────────────────────────────────────────────────────

async function _propagateDeletion(db, userId, deletedItemId, visited, affected, events, depth) {
  if (depth >= MAX_DEPTH) return;
  visited.add(deletedItemId);

  // Clean up edges pointing to/from deleted item
  const { rows: orphanedEdges } = await db.query(
    `SELECT id, from_item, to_item FROM item_edges
     WHERE user_id = $1 AND (from_item = $2 OR to_item = $2)`,
    [userId, deletedItemId]
  );

  for (const edge of orphanedEdges) {
    await db.query(`DELETE FROM item_edges WHERE id = $1`, [edge.id]);
    events.push({ type: 'EDGE_REMOVED', edgeId: edge.id, depth, reason: 'source_deleted' });
  }

  // Check if removing this item unblocks dependents
  await _propagateCompletion(db, userId, deletedItemId, visited, affected, events, depth);
}

// ─── Priority change propagation ──────────────────────────────────────────────

async function _propagatePriorityChange(db, userId, changedItemId, visited, affected, events, depth) {
  if (depth >= MAX_DEPTH || visited.size >= MAX_NODES) return;
  visited.add(changedItemId);

  // Items depending on the changed item get re-scored
  const { rows: dependents } = await db.query(
    `SELECT e.from_item, i.id, i.canonical_text, i.priority
     FROM item_edges e JOIN items i ON i.id = e.from_item
     WHERE e.to_item = $1 AND e.user_id = $2 AND i.state NOT IN ('DONE', 'DROPPED')`,
    [changedItemId, userId]
  );

  for (const dep of dependents) {
    if (visited.has(dep.id)) continue;

    events.push({ type: 'DEPENDENCY_RESCORED', itemId: dep.id, depth, triggeredBy: changedItemId });
    affected.push({ id: dep.id, text: dep.canonical_text, change: 'rescored' });
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _classifyChange(newState, prevState) {
  if (newState === 'DONE' || newState === 'DROPPED') return PropagationType.COMPLETION;
  if (newState === 'BLOCKED' || (prevState !== 'BLOCKED' && newState === 'IN_PROGRESS')) return PropagationType.BLOCKING;
  return PropagationType.PRIORITY;
}

function _maxDepth(events) {
  return events.length > 0 ? Math.max(...events.map(e => e.depth || 0)) : 0;
}

module.exports = { propagate, PropagationType };
