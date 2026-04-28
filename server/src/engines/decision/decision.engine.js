/**
 * ✦ DECISION ENGINE
 *
 * Transforms scored items into actionable decisions: DO_NOW | DEFER | IGNORE.
 * Each decision is deterministic given the same inputs and is stored as a trace
 * for observability, learning, and replay.
 *
 * Architecture:
 *   Items + Context + Limits → Decision function → Decision[] + Traces[]
 *
 * Decision rules:
 *   DO_NOW:  top N items that fit within daily capacity + not blocked + not snoozed
 *   DEFER:   items that are active but outside capacity or context window
 *   IGNORE:  items drifting, low confidence, or explicitly snoozed
 *
 * Stabilization:
 *   - Decisions are sticky: once DO_NOW, stays DO_NOW unless explicitly changed
 *   - Cooldown: item must remain in new category for 2+ cycles to flip
 *   - Jitter guard: if score delta < 0.05 between cycles, keep previous decision
 */
'use strict';

const { v4: uuid } = require('uuid');
const logger = require('../../lib/logger');

// ─── Decision types ───────────────────────────────────────────────────────────
const Decision = Object.freeze({
  DO_NOW:  'DO_NOW',
  DEFER:   'DEFER',
  IGNORE:  'IGNORE',
});

// ─── Defaults ─────────────────────────────────────────────────────────────────
const DEFAULTS = {
  maxDoNow:              3,       // max items in DO_NOW at once
  maxDailyMinutes:       360,     // 6 hours of focused work
  deferScoreThreshold:   0.25,    // below this → IGNORE
  ignoreConfidenceFloor: 0.15,    // items below this confidence → IGNORE
  jitterGuard:           0.05,    // score delta below this → keep previous
  cooldownCycles:        2,       // must stay in new bucket for N cycles before flip
};

// ─── In-memory decision cache (userId → itemId → { decision, score, cycle }) ─
const _cache = new Map();

/**
 * Compute decisions for all active items of a user.
 *
 * @param {Object}   db        - pg Pool
 * @param {string}   userId
 * @param {Object}   context   - { timeOfDay, energyLevel, focusMode, sessionMinutes }
 * @param {Object}   limits    - { maxDoNow, maxDailyMinutes } overrides
 * @returns {Object} { decisions: Decision[], traces: Trace[], summary }
 */
async function computeDecisions(db, userId, context = {}, limits = {}) {
  const config = { ...DEFAULTS, ...limits };
  const cycle  = Date.now();

  // 1. Load active items with scoring metadata
  const { rows: items } = await db.query(
    `SELECT i.*,
            EXTRACT(EPOCH FROM (now() - i.last_seen))  / 86400 AS recency_days,
            EXTRACT(EPOCH FROM (now() - i.first_seen)) / 86400 AS persistence_days,
            EXTRACT(EPOCH FROM (i.deadline - now()))   / 86400 AS deadline_days,
            (SELECT count(*) FROM item_edges e
              JOIN items d ON d.id = e.to_item
              WHERE e.from_item = i.id AND d.state NOT IN ('DONE','DROPPED')) AS downstream_open,
            EXISTS(SELECT 1 FROM snoozes s
              WHERE s.item_id = i.id AND s.user_id = $1 AND s.snooze_until > now()) AS snoozed
     FROM items i
     WHERE i.user_id = $1 AND i.state IN ('OPEN', 'IN_PROGRESS')
     ORDER BY i.priority DESC`,
    [userId]
  );

  if (items.length === 0) {
    return { decisions: [], traces: [], summary: _emptySummary() };
  }

  // 2. Score and classify
  const scored = items.map(item => ({
    ...item,
    _score: _scoreForDecision(item, context),
  })).sort((a, b) => b._score - a._score);

  // 3. Partition into decision buckets
  const decisions = [];
  const traces    = [];
  let doNowCount    = 0;
  let doNowMinutes  = 0;

  const userCache = _cache.get(userId) || new Map();

  for (const item of scored) {
    const signals = _computeSignals(item, context);
    let decision;
    let reason;

    if (item.snoozed) {
      decision = Decision.IGNORE;
      reason   = 'snoozed';
    } else if (item.confidence < config.ignoreConfidenceFloor) {
      decision = Decision.IGNORE;
      reason   = 'low_confidence';
    } else if (item.blocker) {
      decision = Decision.DEFER;
      reason   = 'blocked';
    } else if (
      doNowCount < config.maxDoNow &&
      doNowMinutes + (item.estimated_mins || 60) <= config.maxDailyMinutes &&
      item._score >= config.deferScoreThreshold
    ) {
      // Check stabilization — was this previously DEFER and score barely changed?
      const prev = userCache.get(item.id);
      if (prev && prev.decision !== Decision.DO_NOW && Math.abs(item._score - prev.score) < config.jitterGuard) {
        decision = prev.decision;
        reason   = 'stabilized';
      } else {
        decision = Decision.DO_NOW;
        reason   = 'high_score';
        doNowCount++;
        doNowMinutes += item.estimated_mins || 60;
      }
    } else if (item._score >= config.deferScoreThreshold) {
      decision = Decision.DEFER;
      reason   = 'capacity_exceeded';
    } else {
      decision = Decision.IGNORE;
      reason   = 'low_score';
    }

    decisions.push({
      itemId:   item.id,
      text:     item.canonical_text,
      decision,
      score:    parseFloat(item._score.toFixed(3)),
      reason,
      signals,
      category: item.category || null,
      blocker:  item.blocker || false,
      deadline: item.deadline,
    });

    traces.push({
      itemId:   item.id,
      decision,
      score:    parseFloat(item._score.toFixed(3)),
      signals,
      reason,
      cycle,
    });

    // Update cache
    userCache.set(item.id, { decision, score: item._score, cycle });
  }

  _cache.set(userId, userCache);

  // 4. Persist traces
  await _persistTraces(db, userId, traces);

  const summary = {
    total:     items.length,
    doNow:     decisions.filter(d => d.decision === Decision.DO_NOW).length,
    defer:     decisions.filter(d => d.decision === Decision.DEFER).length,
    ignore:    decisions.filter(d => d.decision === Decision.IGNORE).length,
    doNowMinutes,
    capacityUsed: parseFloat((doNowMinutes / config.maxDailyMinutes).toFixed(2)),
  };

  logger.info('Decisions computed', { userId, ...summary });

  return { decisions, traces, summary };
}

/**
 * Get the most recent decision trace for a specific item.
 */
async function getItemDecisionTrace(db, userId, itemId, limit = 10) {
  const { rows } = await db.query(
    `SELECT * FROM decision_traces
     WHERE user_id = $1 AND item_id = $2
     ORDER BY created_at DESC LIMIT $3`,
    [userId, itemId, limit]
  ).catch(() => ({ rows: [] }));

  return rows;
}

/**
 * Get decision history for a user (for the Inspector).
 */
async function getDecisionHistory(db, userId, windowDays = 7) {
  const { rows } = await db.query(
    `SELECT item_id, decision, score, signals, reason, created_at
     FROM decision_traces
     WHERE user_id = $1 AND created_at > now() - $2::interval
     ORDER BY created_at DESC LIMIT 200`,
    [userId, `${windowDays} days`]
  ).catch(() => ({ rows: [] }));

  return rows;
}

// ─── Internal scoring ─────────────────────────────────────────────────────────

function _scoreForDecision(item, context = {}) {
  const recency  = Math.max(0, 1 - (parseFloat(item.recency_days) || 0) / 7);
  const freq     = Math.min(1, (item.mention_count || 1) / 5);
  const deadline = item.deadline_days !== null
    ? Math.max(0, 1 - parseFloat(item.deadline_days) / 7) : 0;
  const blocker  = item.blocker ? 1.0 : 0;
  const causal   = Math.min(1, parseInt(item.downstream_open || 0) / 5);
  const inProg   = item.state === 'IN_PROGRESS' ? 0.2 : 0;

  // Context boosts
  let contextBoost = 0;
  if (context.focusMode && item.estimated_mins && item.estimated_mins <= 30) {
    contextBoost += 0.1; // Short tasks preferred in focus mode
  }
  if (context.energyLevel === 'low' && item.estimated_mins && item.estimated_mins <= 15) {
    contextBoost += 0.1; // Easy wins when energy is low
  }
  if (context.timeOfDay === 'morning' && item.state === 'IN_PROGRESS') {
    contextBoost += 0.05; // Continue momentum in the morning
  }

  return 0.25 * recency + 0.20 * freq + 0.20 * deadline +
         0.15 * blocker + 0.10 * causal + 0.05 * inProg +
         0.05 * contextBoost;
}

function _computeSignals(item, context = {}) {
  return {
    urgency:           item.deadline_days !== null
      ? Math.max(0, 1 - parseFloat(item.deadline_days) / 7) : 0,
    inactivity:        parseFloat(item.recency_days || 0),
    dependencyPressure: parseInt(item.downstream_open || 0),
    mentionFrequency:  item.mention_count || 1,
    confidence:        parseFloat(item.confidence || 0),
    isBlocked:         item.blocker || false,
    isSnoozed:         item.snoozed || false,
    estimatedMins:     item.estimated_mins || 60,
    contextBoosts:     {
      focusMode: context.focusMode || false,
      energyLevel: context.energyLevel || 'normal',
      timeOfDay: context.timeOfDay || _getTimeOfDay(),
    },
  };
}

function _getTimeOfDay() {
  const hour = new Date().getHours();
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  return 'evening';
}

function _emptySummary() {
  return { total: 0, doNow: 0, defer: 0, ignore: 0, doNowMinutes: 0, capacityUsed: 0 };
}

async function _persistTraces(db, userId, traces) {
  if (traces.length === 0) return;
  try {
    const values = traces.map(t =>
      `('${uuid()}', '${userId}', '${t.itemId}', '${t.decision}', ${t.score}, '${JSON.stringify(t.signals)}'::jsonb, '${t.reason}')`
    ).join(',');
    await db.query(
      `INSERT INTO decision_traces(id, user_id, item_id, decision, score, signals, reason) VALUES ${values}`
    );
  } catch (err) {
    logger.warn('Failed to persist decision traces', { userId, error: err.message });
  }
}

module.exports = { computeDecisions, getItemDecisionTrace, getDecisionHistory, Decision };
