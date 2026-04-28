/**
 * ✦ OBSERVABILITY ENGINE
 *
 * Trace storage, replay, and anomaly detection for the 5D engine.
 *
 * Components:
 *   1. Trace Store — append-only log of task state snapshots
 *   2. Replay Engine — reconstruct system state at any past timestamp
 *   3. Anomaly Detector — spike, oscillation, and thrash detection
 *   4. Auto-mitigation — dampening and freezing on detected anomalies
 *
 * Anomaly types:
 *   PRIORITY_SPIKE:     abs(current - prev) > 0.5
 *   PRIORITY_OSCILLATION: 3+ sign flips in last 5 changes
 *   STATE_THRASH:       rapid ACTIVE→DRIFT→ACTIVE→DRIFT cycling
 */
'use strict';

const { v4: uuid } = require('uuid');
const logger = require('../../lib/logger');

// ─── Anomaly thresholds (defaults, per-user calibration via Learning Engine) ──
const THRESHOLDS = {
  spikeThreshold:      0.5,    // priority delta that qualifies as spike
  oscillationWindow:   5,      // number of recent changes to check
  oscillationMinFlips: 3,      // min sign flips to flag oscillation
  thrashWindow:        7,      // days to check for state thrashing
  thrashMinCycles:     3,      // min ACTIVE→DRIFT cycles to flag
  emaDampingAlpha:     0.3,    // stronger EMA on spike (default is 0.85)
  freezeDurationMs:    3600000, // 1 hour freeze on oscillation
};

// ─── Trace Store ──────────────────────────────────────────────────────────────

/**
 * Record a trace snapshot for an item.
 */
async function recordTrace(db, userId, itemId, snapshot) {
  try {
    await db.query(
      `INSERT INTO traces(id, user_id, item_id, state, priority, decision, signals, boosts, reason)
       VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        uuid(), userId, itemId,
        snapshot.state, snapshot.priority, snapshot.decision || null,
        JSON.stringify(snapshot.signals || {}),
        JSON.stringify(snapshot.boosts || {}),
        snapshot.reason || null,
      ]
    );
  } catch (_) {
    // traces table may not exist yet — non-fatal
  }
}

/**
 * Get trace history for an item (for Inspector UI).
 */
async function getItemTraces(db, userId, itemId, limit = 100) {
  const { rows } = await db.query(
    `SELECT id, state, priority, decision, signals, boosts, reason, created_at
     FROM traces WHERE user_id = $1 AND item_id = $2
     ORDER BY created_at DESC LIMIT $3`,
    [userId, itemId, limit]
  ).catch(() => ({ rows: [] }));
  return rows;
}

/**
 * Get all traces in a time window (for system view).
 */
async function getTracesInWindow(db, userId, startTs, endTs, limit = 500) {
  const { rows } = await db.query(
    `SELECT id, item_id, state, priority, decision, signals, reason, created_at
     FROM traces WHERE user_id = $1 AND created_at BETWEEN $2 AND $3
     ORDER BY created_at ASC LIMIT $4`,
    [userId, startTs, endTs, limit]
  ).catch(() => ({ rows: [] }));
  return rows;
}

// ─── Replay Engine ────────────────────────────────────────────────────────────

/**
 * Reconstruct system state at a specific timestamp.
 * Uses binary search over traces to find the latest snapshot for each item.
 *
 * @param {Object} db
 * @param {string} userId
 * @param {Date}   targetTimestamp
 * @returns {Object} { items: ItemSnapshot[], timestamp }
 */
async function replayAt(db, userId, targetTimestamp) {
  const { rows } = await db.query(
    `SELECT DISTINCT ON (item_id)
       item_id, state, priority, decision, signals, boosts, reason, created_at
     FROM traces
     WHERE user_id = $1 AND created_at <= $2
     ORDER BY item_id, created_at DESC`,
    [userId, targetTimestamp]
  ).catch(() => ({ rows: [] }));

  return {
    timestamp: targetTimestamp,
    items: rows.map(r => ({
      itemId:    r.item_id,
      state:     r.state,
      priority:  r.priority,
      decision:  r.decision,
      signals:   r.signals,
      boosts:    r.boosts,
      reason:    r.reason,
      asOf:      r.created_at,
    })),
    itemCount: rows.length,
  };
}

/**
 * Get key timestamps where significant changes occurred (for time slider).
 */
async function getKeyTimestamps(db, userId, windowDays = 30) {
  const { rows } = await db.query(
    `SELECT created_at AS ts, count(*) AS changes
     FROM traces
     WHERE user_id = $1 AND created_at > now() - $2::interval
     GROUP BY date_trunc('hour', created_at), created_at
     HAVING count(*) > 1
     ORDER BY created_at DESC LIMIT 100`,
    [userId, `${windowDays} days`]
  ).catch(() => ({ rows: [] }));

  return rows.map(r => ({
    timestamp: r.ts,
    changes:   parseInt(r.changes),
  }));
}

// ─── Anomaly Detection ────────────────────────────────────────────────────────

/**
 * Scan for anomalies in a user's recent trace history.
 * Returns detected anomalies + auto-mitigation actions taken.
 */
async function detectAnomalies(db, userId) {
  const anomalies = [];

  const [spikes, oscillations, thrashes] = await Promise.all([
    _detectPrioritySpikes(db, userId),
    _detectPriorityOscillations(db, userId),
    _detectStateThrash(db, userId),
  ]);

  anomalies.push(...spikes, ...oscillations, ...thrashes);

  // Persist anomalies
  for (const anomaly of anomalies) {
    await _persistAnomaly(db, userId, anomaly);
  }

  if (anomalies.length > 0) {
    logger.info('Anomalies detected', { userId, count: anomalies.length, types: anomalies.map(a => a.type) });
  }

  return anomalies;
}

async function _detectPrioritySpikes(db, userId) {
  const { rows } = await db.query(
    `SELECT t1.item_id, t1.priority AS current_priority, t2.priority AS prev_priority,
            t1.created_at, i.canonical_text
     FROM traces t1
     JOIN LATERAL (
       SELECT priority FROM traces t2
       WHERE t2.item_id = t1.item_id AND t2.user_id = $1 AND t2.created_at < t1.created_at
       ORDER BY t2.created_at DESC LIMIT 1
     ) t2 ON true
     JOIN items i ON i.id = t1.item_id
     WHERE t1.user_id = $1 AND t1.created_at > now() - interval '24 hours'
       AND ABS(t1.priority - t2.priority) > $2`,
    [userId, THRESHOLDS.spikeThreshold]
  ).catch(() => ({ rows: [] }));

  return rows.map(r => ({
    type:     'PRIORITY_SPIKE',
    itemId:   r.item_id,
    text:     r.canonical_text,
    severity: Math.abs(r.current_priority - r.prev_priority) > 0.7 ? 'high' : 'medium',
    detail:   {
      previousPriority: parseFloat(r.prev_priority),
      currentPriority:  parseFloat(r.current_priority),
      delta:            parseFloat((r.current_priority - r.prev_priority).toFixed(3)),
    },
    mitigation: 'ema_damping',
    mitigationApplied: false,
  }));
}

async function _detectPriorityOscillations(db, userId) {
  // For each active item, check if priority direction flipped 3+ times recently
  const { rows: items } = await db.query(
    `SELECT DISTINCT item_id FROM traces
     WHERE user_id = $1 AND created_at > now() - interval '48 hours'`,
    [userId]
  ).catch(() => ({ rows: [] }));

  const oscillations = [];

  for (const { item_id } of items) {
    const { rows: history } = await db.query(
      `SELECT priority FROM traces
       WHERE user_id = $1 AND item_id = $2
       ORDER BY created_at DESC LIMIT $3`,
      [userId, item_id, THRESHOLDS.oscillationWindow]
    ).catch(() => ({ rows: [] }));

    if (history.length < 3) continue;

    let flips = 0;
    for (let i = 2; i < history.length; i++) {
      const dir1 = history[i-1].priority - history[i].priority;
      const dir2 = history[i-2].priority - history[i-1].priority;
      if ((dir1 > 0 && dir2 < 0) || (dir1 < 0 && dir2 > 0)) flips++;
    }

    if (flips >= THRESHOLDS.oscillationMinFlips) {
      oscillations.push({
        type:     'PRIORITY_OSCILLATION',
        itemId:   item_id,
        severity: 'medium',
        detail:   { flips, window: THRESHOLDS.oscillationWindow },
        mitigation: 'freeze_updates',
        mitigationApplied: false,
      });
    }
  }

  return oscillations;
}

async function _detectStateThrash(db, userId) {
  const { rows } = await db.query(
    `SELECT ie.item_id, i.canonical_text,
            count(*) FILTER (WHERE ie.to_state IN ('OPEN','IN_PROGRESS') AND ie.from_state IN ('DROPPED')) AS reactivations,
            count(*) FILTER (WHERE ie.to_state = 'DROPPED' AND ie.from_state IN ('OPEN','IN_PROGRESS')) AS deactivations
     FROM item_events ie
     JOIN items i ON i.id = ie.item_id
     WHERE ie.created_at > now() - $2::interval AND i.user_id = $1
     GROUP BY ie.item_id, i.canonical_text
     HAVING count(*) >= $3`,
    [userId, `${THRESHOLDS.thrashWindow} days`, THRESHOLDS.thrashMinCycles * 2]
  ).catch(() => ({ rows: [] }));

  return rows
    .filter(r => parseInt(r.reactivations) >= THRESHOLDS.thrashMinCycles)
    .map(r => ({
      type:     'STATE_THRASH',
      itemId:   r.item_id,
      text:     r.canonical_text,
      severity: 'high',
      detail:   {
        reactivations: parseInt(r.reactivations),
        deactivations: parseInt(r.deactivations),
      },
      mitigation: 'stabilize_state',
      mitigationApplied: false,
    }));
}

/**
 * Apply auto-mitigation for a detected anomaly.
 */
async function applyMitigation(db, userId, anomaly) {
  switch (anomaly.mitigation) {
    case 'ema_damping': {
      // Apply stronger EMA to prevent further spikes
      const damped = anomaly.detail.currentPriority * THRESHOLDS.emaDampingAlpha +
                     anomaly.detail.previousPriority * (1 - THRESHOLDS.emaDampingAlpha);
      await db.query(
        `UPDATE items SET priority = $2, updated_at = now() WHERE id = $1`,
        [anomaly.itemId, parseFloat(damped.toFixed(3))]
      );
      return { mitigated: true, action: 'ema_damping', newPriority: parseFloat(damped.toFixed(3)) };
    }
    case 'freeze_updates': {
      // Mark item as frozen (skip priority updates for freeze duration)
      await db.query(
        `UPDATE items SET meta = COALESCE(meta, '{}'::jsonb) || $2, updated_at = now() WHERE id = $1`,
        [anomaly.itemId, JSON.stringify({ frozenUntil: new Date(Date.now() + THRESHOLDS.freezeDurationMs).toISOString() })]
      ).catch(() => {});
      return { mitigated: true, action: 'freeze_updates', frozenUntil: new Date(Date.now() + THRESHOLDS.freezeDurationMs) };
    }
    case 'stabilize_state': {
      // Force item to stable state and boost confidence
      await db.query(
        `UPDATE items SET confidence = LEAST(1.0, confidence + 0.2), updated_at = now() WHERE id = $1`,
        [anomaly.itemId]
      ).catch(() => {});
      return { mitigated: true, action: 'stabilize_state' };
    }
    default:
      return { mitigated: false, reason: 'unknown_mitigation' };
  }
}

async function _persistAnomaly(db, userId, anomaly) {
  try {
    await db.query(
      `INSERT INTO anomaly_events(id, user_id, item_id, type, severity, detail, mitigation)
       VALUES($1, $2, $3, $4, $5, $6, $7)`,
      [uuid(), userId, anomaly.itemId, anomaly.type, anomaly.severity,
       JSON.stringify(anomaly.detail), anomaly.mitigation]
    );
  } catch (_) {
    // anomaly_events table may not exist yet — non-fatal
  }
}

/**
 * Get anomaly history for a user (Inspector UI).
 */
async function getAnomalyHistory(db, userId, windowDays = 30) {
  const { rows } = await db.query(
    `SELECT id, item_id, type, severity, detail, mitigation, created_at
     FROM anomaly_events WHERE user_id = $1 AND created_at > now() - $2::interval
     ORDER BY created_at DESC LIMIT 100`,
    [userId, `${windowDays} days`]
  ).catch(() => ({ rows: [] }));
  return rows;
}

module.exports = {
  recordTrace, getItemTraces, getTracesInWindow,
  replayAt, getKeyTimestamps,
  detectAnomalies, applyMitigation, getAnomalyHistory,
  THRESHOLDS,
};
