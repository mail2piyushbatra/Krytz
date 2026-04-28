/**
 * ✦ CAUSALITY GRAPH ENGINE
 *
 * Full dependency DAG operations for the item_edges table.
 * Provides: cycle detection, transitive closure, bottleneck detection,
 * critical path analysis, and dependency health scoring.
 *
 * Architecture:
 *   item_edges(from_item, to_item, type, user_id)
 *   from_item DEPENDS ON to_item (from_item cannot start until to_item finishes)
 *
 * Key algorithms:
 *   - Cycle detection at insert time (DFS)
 *   - Transitive closure (BFS reachability)
 *   - Bottleneck score: fanout × (1 / depth) — items that unlock the most
 *   - Critical path: longest chain of unresolved dependencies
 */
'use strict';

const { v4: uuid } = require('uuid');
const logger = require('../../lib/logger');

// ─── Constants ────────────────────────────────────────────────────────────────
const MAX_PROPAGATION_DEPTH = 10;
const MAX_PROPAGATION_NODES = 50;
const EDGE_TYPES = Object.freeze({
  DEPENDS_ON:  'DEPENDS_ON',    // from_item depends on to_item
  BLOCKS:      'BLOCKS',        // from_item blocks to_item (inverse of DEPENDS_ON)
  RELATED_TO:  'RELATED_TO',    // soft link, no ordering constraint
});

/**
 * Add a dependency edge with cycle detection.
 * @returns {{ edgeId, valid, cycle }} - cycle is set if the edge would create a cycle
 */
async function addEdge(db, userId, fromItem, toItem, type = EDGE_TYPES.DEPENDS_ON) {
  // 1. Check if edge already exists
  const { rows: existing } = await db.query(
    `SELECT id FROM item_edges WHERE user_id = $1 AND from_item = $2 AND to_item = $3`,
    [userId, fromItem, toItem]
  );
  if (existing.length > 0) return { edgeId: existing[0].id, valid: true, cycle: null, existing: true };

  // 2. Self-loop check
  if (fromItem === toItem) return { edgeId: null, valid: false, cycle: [fromItem], reason: 'self_loop' };

  // 3. Cycle detection: would adding fromItem→toItem create a cycle?
  //    A cycle exists if toItem can already reach fromItem
  const reachable = await getReachableNodes(db, userId, toItem, 'downstream');
  if (reachable.has(fromItem)) {
    return { edgeId: null, valid: false, cycle: [...reachable, fromItem], reason: 'cycle_detected' };
  }

  // 4. Insert edge
  const edgeId = uuid();
  await db.query(
    `INSERT INTO item_edges(id, user_id, from_item, to_item, type)
     VALUES($1, $2, $3, $4, $5)`,
    [edgeId, userId, fromItem, toItem, type]
  );

  logger.info('Edge added', { userId, fromItem, toItem, type });
  return { edgeId, valid: true, cycle: null };
}

/**
 * Remove a dependency edge.
 */
async function removeEdge(db, userId, edgeId) {
  await db.query(
    `DELETE FROM item_edges WHERE id = $1 AND user_id = $2`,
    [edgeId, userId]
  );
}

/**
 * Get all edges for a user.
 */
async function getEdges(db, userId) {
  const { rows } = await db.query(
    `SELECT e.*, i1.canonical_text AS from_text, i2.canonical_text AS to_text
     FROM item_edges e
     JOIN items i1 ON i1.id = e.from_item
     JOIN items i2 ON i2.id = e.to_item
     WHERE e.user_id = $1
     ORDER BY e.created_at DESC`,
    [userId]
  );
  return rows;
}

/**
 * BFS reachability from a node.
 * @param {string} direction - 'upstream' (items this depends on) or 'downstream' (items depending on this)
 * @returns {Set<string>} - set of reachable item IDs
 */
async function getReachableNodes(db, userId, itemId, direction = 'downstream') {
  const visited = new Set();
  const queue   = [itemId];
  let depth     = 0;

  while (queue.length > 0 && depth < MAX_PROPAGATION_DEPTH && visited.size < MAX_PROPAGATION_NODES) {
    const batch = [...queue];
    queue.length = 0;

    const column    = direction === 'downstream' ? 'to_item' : 'from_item';
    const joinCol   = direction === 'downstream' ? 'from_item' : 'to_item';
    const ids       = batch.filter(id => !visited.has(id));

    if (ids.length === 0) break;
    for (const id of ids) visited.add(id);

    const { rows } = await db.query(
      `SELECT ${column} AS next_id FROM item_edges
       WHERE user_id = $1 AND ${joinCol} = ANY($2::text[])`,
      [userId, ids]
    );

    for (const row of rows) {
      if (!visited.has(row.next_id)) queue.push(row.next_id);
    }
    depth++;
  }

  visited.delete(itemId); // don't include the starting node
  return visited;
}

/**
 * Compute the transitive closure — all items reachable from a given item in both directions.
 */
async function transitiveClosure(db, userId, itemId) {
  const upstream   = await getReachableNodes(db, userId, itemId, 'upstream');
  const downstream = await getReachableNodes(db, userId, itemId, 'downstream');

  return {
    itemId,
    upstream:   [...upstream],
    downstream: [...downstream],
    totalReachable: upstream.size + downstream.size,
  };
}

/**
 * Detect bottleneck items — items that block the most downstream work.
 * Bottleneck score = downstream_count × (1 / max_depth)
 */
async function detectBottlenecks(db, userId, limit = 10) {
  const { rows: items } = await db.query(
    `SELECT i.id, i.canonical_text, i.state, i.priority, i.blocker, i.deadline,
            (SELECT count(DISTINCT e.from_item) FROM item_edges e
              JOIN items d ON d.id = e.from_item
              WHERE e.to_item = i.id AND e.user_id = $1 AND d.state NOT IN ('DONE','DROPPED')) AS downstream_count
     FROM items i
     WHERE i.user_id = $1 AND i.state IN ('OPEN', 'IN_PROGRESS')
     ORDER BY downstream_count DESC
     LIMIT $2`,
    [userId, limit]
  );

  return items.map(item => ({
    id:               item.id,
    text:             item.canonical_text,
    state:            item.state,
    priority:         item.priority,
    blocker:          item.blocker,
    downstreamCount:  parseInt(item.downstream_count || 0),
    bottleneckScore:  parseInt(item.downstream_count || 0) > 0
      ? parseFloat((parseInt(item.downstream_count) / MAX_PROPAGATION_DEPTH).toFixed(3))
      : 0,
    impact:           parseInt(item.downstream_count || 0) >= 3 ? 'high'
                    : parseInt(item.downstream_count || 0) >= 1 ? 'medium' : 'none',
  }));
}

/**
 * Critical path: longest chain of unresolved dependencies from any root.
 * Returns the chain of items + total estimated duration.
 */
async function findCriticalPath(db, userId) {
  // Find roots: items with no upstream dependencies
  const { rows: roots } = await db.query(
    `SELECT i.id FROM items i
     WHERE i.user_id = $1 AND i.state IN ('OPEN', 'IN_PROGRESS')
       AND NOT EXISTS (SELECT 1 FROM item_edges e WHERE e.from_item = i.id AND e.user_id = $1)`,
    [userId]
  );

  let longestPath     = [];
  let longestDuration = 0;

  for (const root of roots) {
    const path = await _dfsLongestPath(db, userId, root.id, new Set(), 0);
    if (path.duration > longestDuration) {
      longestPath     = path.chain;
      longestDuration = path.duration;
    }
  }

  return {
    path:              longestPath,
    totalEstimatedMins: longestDuration,
    depth:              longestPath.length,
  };
}

async function _dfsLongestPath(db, userId, itemId, visited, depth) {
  if (visited.has(itemId) || depth >= MAX_PROPAGATION_DEPTH) {
    return { chain: [], duration: 0 };
  }

  visited.add(itemId);

  const { rows: [item] } = await db.query(
    `SELECT id, canonical_text, estimated_mins FROM items WHERE id = $1 AND user_id = $2`,
    [itemId, userId]
  ).catch(() => ({ rows: [null] }));

  if (!item) return { chain: [], duration: 0 };

  const { rows: dependents } = await db.query(
    `SELECT e.from_item FROM item_edges e
     JOIN items d ON d.id = e.from_item
     WHERE e.to_item = $1 AND e.user_id = $2 AND d.state NOT IN ('DONE','DROPPED')`,
    [itemId, userId]
  );

  let best = { chain: [], duration: 0 };
  for (const dep of dependents) {
    const sub = await _dfsLongestPath(db, userId, dep.from_item, new Set(visited), depth + 1);
    if (sub.duration > best.duration) best = sub;
  }

  const mins = parseInt(item.estimated_mins || 60);
  return {
    chain:    [{ id: item.id, text: item.canonical_text, estimatedMins: mins }, ...best.chain],
    duration: mins + best.duration,
  };
}

/**
 * Get dependency health for a specific item.
 */
async function getItemDependencyHealth(db, userId, itemId) {
  const closure = await transitiveClosure(db, userId, itemId);
  const { rows: upstreamItems } = await db.query(
    `SELECT id, canonical_text, state, priority, blocker FROM items
     WHERE id = ANY($1::text[]) AND user_id = $2`,
    [[...closure.upstream], userId]
  ).catch(() => ({ rows: [] }));

  const blockedUpstream = upstreamItems.filter(i => i.state !== 'DONE' && i.state !== 'DROPPED');
  const health = blockedUpstream.length === 0 ? 'clear'
               : blockedUpstream.some(i => i.blocker) ? 'blocked'
               : 'waiting';

  return {
    itemId,
    health,
    upstream:           closure.upstream,
    downstream:         closure.downstream,
    blockedUpstream:    blockedUpstream.map(i => ({ id: i.id, text: i.canonical_text, state: i.state })),
    canStart:           blockedUpstream.length === 0,
    totalReachable:     closure.totalReachable,
  };
}

module.exports = {
  addEdge,
  removeEdge,
  getEdges,
  getReachableNodes,
  transitiveClosure,
  detectBottlenecks,
  findCriticalPath,
  getItemDependencyHealth,
  EDGE_TYPES,
  MAX_PROPAGATION_DEPTH,
  MAX_PROPAGATION_NODES,
};
