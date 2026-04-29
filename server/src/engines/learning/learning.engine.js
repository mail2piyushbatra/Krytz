/**
 * âœ¦ LEARNING ENGINE
 *
 * Adapts Krytz to user behavior over time. Learns from outcomes to calibrate:
 *   1. Capacity limits (how much can this user realistically handle?)
 *   2. Priority signal weights (what signals matter most for this user?)
 *   3. Context boost effectiveness (which boosts actually improve outcomes?)
 *   4. Anomaly thresholds (per-user spike/oscillation tolerance)
 *   5. Behavior pattern detection (procrastination, focus blocks, overcommitment)
 *
 * Progressive stages (from progressive.intelligence.js):
 *   Day 1 (simple):       no learning, defaults only
 *   Day 7 (personalized): basic calibration from completion history
 *   Day 30 (predictive):  full adaptive learning
 *
 * Algorithm: sliding window analysis of completed items + decision outcomes
 */
'use strict';

const logger = require('../../lib/logger');

// â”€â”€â”€ Default user model â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const DEFAULT_MODEL = {
  capacityLimits: {
    maxDailyMinutes:    360,
    maxConcurrentTasks: 5,
    avgSessionMinutes:  90,
    learned:            false,
  },
  priorityWeights: {
    recency:  0.25,
    frequency: 0.20,
    deadline: 0.20,
    blocker:  0.15,
    causal:   0.10,
    context:  0.05,
    momentum: 0.05,
    learned:  false,
  },
  contextBoosts: {
    morningMomentum: 0.05,
    focusModeShort:  0.10,
    lowEnergyQuick:  0.10,
    learned:         false,
  },
  anomalyThresholds: {
    spikeThreshold:      0.5,
    oscillationMinFlips: 3,
    thrashMinCycles:     3,
    learned:             false,
  },
  behaviorPatterns: [],
  lastCalibrated:   null,
  totalCompletions: 0,
  daysSinceStart:   0,
};

/**
 * Get the learned user model. Falls back to defaults if not enough data.
 */
async function getUserModel(db, userId) {
  const { rows: cached } = await db.query(
    `SELECT model FROM user_learning_model WHERE user_id = $1`,
    [userId]
  ).catch(() => ({ rows: [] }));

  if (cached.length > 0 && cached[0].model) {
    return { ...DEFAULT_MODEL, ...cached[0].model };
  }

  return { ...DEFAULT_MODEL };
}

/**
 * Run a full calibration cycle. Call periodically (daily or on significant events).
 */
async function calibrate(db, userId) {
  const model = await getUserModel(db, userId);
  const start = Date.now();

  // 1. Calibrate capacity limits
  const capacity = await _calibrateCapacity(db, userId);
  if (capacity) model.capacityLimits = { ...model.capacityLimits, ...capacity, learned: true };

  // 2. Calibrate priority weights
  const weights = await _calibratePriorityWeights(db, userId);
  if (weights) model.priorityWeights = { ...model.priorityWeights, ...weights, learned: true };

  // 3. Calibrate context boost effectiveness
  const boosts = await _calibrateContextBoosts(db, userId);
  if (boosts) model.contextBoosts = { ...model.contextBoosts, ...boosts, learned: true };

  // 4. Detect behavior patterns
  const patterns = await _detectBehaviorPatterns(db, userId);
  if (patterns.length > 0) model.behaviorPatterns = patterns;

  // 5. Calibrate anomaly thresholds
  const anomalyThresholds = await _calibrateAnomalyThresholds(db, userId);
  if (anomalyThresholds) model.anomalyThresholds = { ...model.anomalyThresholds, ...anomalyThresholds, learned: true };

  model.lastCalibrated = new Date().toISOString();

  // Persist
  await db.query(
    `INSERT INTO user_learning_model(user_id, model) VALUES($1, $2)
     ON CONFLICT(user_id) DO UPDATE SET model = $2, updated_at = now()`,
    [userId, JSON.stringify(model)]
  ).catch(() => {});

  logger.info('Learning calibration complete', {
    userId, durationMs: Date.now() - start,
    capacityLearned: capacity !== null,
    weightsLearned: weights !== null,
    patternsFound: patterns.length,
  });

  return model;
}

// â”€â”€â”€ Capacity Calibration â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function _calibrateCapacity(db, userId) {
  // Look at actual completion patterns to estimate true daily capacity
  const { rows } = await db.query(
    `SELECT date,
            sum(COALESCE(estimated_mins, 60)) AS total_mins,
            count(*) AS completed_count
     FROM daily_states ds
     WHERE ds.user_id = $1 AND ds.date > CURRENT_DATE - 30
     GROUP BY ds.date
     ORDER BY ds.date`,
    [userId]
  ).catch(() => ({ rows: [] }));

  if (rows.length < 7) return null; // Not enough data

  const dailyMins    = rows.map(r => parseInt(r.total_mins || 0));
  const dailyCounts  = rows.map(r => parseInt(r.completed_count || 0));

  // Use 75th percentile as max capacity (realistic max, not best day)
  const sortedMins   = [...dailyMins].sort((a, b) => a - b);
  const p75Index     = Math.floor(sortedMins.length * 0.75);
  const maxDaily     = sortedMins[p75Index] || 360;

  // Average concurrent tasks
  const avgConcurrent = Math.round(_avg(dailyCounts));

  // Average session length (from entry timestamps)
  const { rows: sessions } = await db.query(
    `SELECT EXTRACT(EPOCH FROM (MAX(timestamp) - MIN(timestamp))) / 60 AS session_mins
     FROM entries WHERE user_id = $1 AND timestamp > now() - interval '30 days'
     GROUP BY timestamp::date
     HAVING count(*) > 1`,
    [userId]
  ).catch(() => ({ rows: [] }));

  const avgSession = sessions.length > 0
    ? Math.round(_avg(sessions.map(s => parseFloat(s.session_mins || 90))))
    : 90;

  return {
    maxDailyMinutes:    Math.max(120, Math.min(600, maxDaily)),
    maxConcurrentTasks: Math.max(2, Math.min(10, avgConcurrent)),
    avgSessionMinutes:  Math.max(15, Math.min(240, avgSession)),
  };
}

// â”€â”€â”€ Priority Weight Calibration â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function _calibratePriorityWeights(db, userId) {
  // Compare what the user actually completed vs what was suggested
  const { rows: completed } = await db.query(
    `SELECT i.priority, i.mention_count, i.blocker, i.deadline,
            EXTRACT(EPOCH FROM (i.updated_at - i.first_seen)) / 86400 AS completion_days,
            (SELECT count(*) FROM item_edges e WHERE e.from_item = i.id) AS downstream_count
     FROM items i
     WHERE i.user_id = $1 AND i.state = 'DONE'
       AND i.updated_at > now() - interval '30 days'
     ORDER BY i.updated_at DESC LIMIT 50`,
    [userId]
  ).catch(() => ({ rows: [] }));

  if (completed.length < 10) return null;

  // Analyze which signals correlate with quick completion
  const quickCompletions = completed.filter(r => parseFloat(r.completion_days || 999) < 3);
  const slowCompletions  = completed.filter(r => parseFloat(r.completion_days || 0) >= 3);

  if (quickCompletions.length < 3) return null;

  // Items completed quickly tend to have these properties:
  const quickAvgMentions = _avg(quickCompletions.map(r => r.mention_count || 1));
  const slowAvgMentions  = _avg(slowCompletions.map(r => r.mention_count || 1));
  const quickHasDeadline = quickCompletions.filter(r => r.deadline).length / quickCompletions.length;
  const quickHasBlocker  = quickCompletions.filter(r => r.blocker).length / quickCompletions.length;

  // Adjust weights: signals that correlate with quick completion get boosted
  const weights = { ...DEFAULT_MODEL.priorityWeights };
  if (quickAvgMentions > slowAvgMentions * 1.5) weights.frequency = Math.min(0.35, weights.frequency + 0.05);
  if (quickHasDeadline > 0.5) weights.deadline = Math.min(0.35, weights.deadline + 0.05);
  if (quickHasBlocker > 0.3) weights.blocker = Math.min(0.25, weights.blocker + 0.05);

  // Normalize to sum = 1.0
  const total = Object.values(weights).filter(v => typeof v === 'number').reduce((s, v) => s + v, 0);
  for (const key of Object.keys(weights)) {
    if (typeof weights[key] === 'number') weights[key] = parseFloat((weights[key] / total).toFixed(3));
  }

  return weights;
}

// â”€â”€â”€ Context Boost Calibration â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function _calibrateContextBoosts(db, userId) {
  // Analyze completion times â€” when does the user actually complete things?
  const { rows } = await db.query(
    `SELECT EXTRACT(HOUR FROM ie.created_at) AS hour,
            count(*) AS completions
     FROM item_events ie
     WHERE ie.created_at > now() - interval '30 days'
       AND ie.to_state = 'DONE'
       AND ie.item_id IN (SELECT id FROM items WHERE user_id = $1)
     GROUP BY EXTRACT(HOUR FROM ie.created_at)
     ORDER BY completions DESC`,
    [userId]
  ).catch(() => ({ rows: [] }));

  if (rows.length < 3) return null;

  const morningCompletions   = rows.filter(r => parseInt(r.hour) < 12).reduce((s, r) => s + parseInt(r.completions), 0);
  const afternoonCompletions = rows.filter(r => parseInt(r.hour) >= 12 && parseInt(r.hour) < 17).reduce((s, r) => s + parseInt(r.completions), 0);
  const eveningCompletions   = rows.filter(r => parseInt(r.hour) >= 17).reduce((s, r) => s + parseInt(r.completions), 0);
  const total = morningCompletions + afternoonCompletions + eveningCompletions;

  if (total < 5) return null;

  return {
    morningMomentum: morningCompletions / total > 0.4 ? 0.15 : 0.05,
    focusModeShort:  0.10, // keep default â€” hard to measure without focus mode data
    lowEnergyQuick:  0.10, // keep default
  };
}

// â”€â”€â”€ Behavior Pattern Detection â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function _detectBehaviorPatterns(db, userId) {
  const patterns = [];

  // 1. Procrastination: items that were created but not touched for 3+ days then completed in a rush
  const { rows: procrastination } = await db.query(
    `SELECT count(*) AS n FROM items
     WHERE user_id = $1 AND state = 'DONE'
       AND EXTRACT(EPOCH FROM (updated_at - first_seen)) / 86400 > 3
       AND EXTRACT(EPOCH FROM (updated_at - last_seen)) / 86400 < 1
       AND updated_at > now() - interval '30 days'`,
    [userId]
  ).catch(() => ({ rows: [{ n: 0 }] }));

  if (parseInt(procrastination[0].n) >= 5) {
    patterns.push({
      type:     'PROCRASTINATION',
      severity: parseInt(procrastination[0].n) >= 10 ? 'high' : 'medium',
      count:    parseInt(procrastination[0].n),
      insight:  `You tend to delay tasks then rush through them. Consider working on high-priority items earlier.`,
    });
  }

  // 2. Focus blocks: consecutive completions within short windows
  const { rows: focusBlocks } = await db.query(
    `SELECT date_trunc('hour', ie.created_at) AS block,
            count(*) AS completions
     FROM item_events ie
     WHERE ie.to_state = 'DONE'
       AND ie.created_at > now() - interval '30 days'
       AND ie.item_id IN (SELECT id FROM items WHERE user_id = $1)
     GROUP BY date_trunc('hour', ie.created_at)
     HAVING count(*) >= 3
     ORDER BY completions DESC LIMIT 5`,
    [userId]
  ).catch(() => ({ rows: [] }));

  if (focusBlocks.length >= 3) {
    patterns.push({
      type:     'FOCUS_BLOCKS',
      severity: 'positive',
      count:    focusBlocks.length,
      insight:  `You have productive focus blocks â€” ${focusBlocks.length} sessions with 3+ completions in an hour.`,
    });
  }

  // 3. Overcommitment: consistently more items created than completed
  const { rows: loadBalance } = await db.query(
    `SELECT
       (SELECT count(*) FROM items WHERE user_id = $1 AND first_seen > now() - interval '7 days') AS created,
       (SELECT count(*) FROM items WHERE user_id = $1 AND state = 'DONE' AND updated_at > now() - interval '7 days') AS completed`,
    [userId]
  ).catch(() => ({ rows: [{ created: 0, completed: 0 }] }));

  const created   = parseInt(loadBalance[0].created || 0);
  const completed = parseInt(loadBalance[0].completed || 0);
  if (created > completed * 2 && created > 5) {
    patterns.push({
      type:     'OVERCOMMITMENT',
      severity: created > completed * 3 ? 'high' : 'medium',
      count:    created - completed,
      insight:  `You're creating ${created} items but only completing ${completed} per week. Consider reducing intake.`,
    });
  }

  // 4. Weekend warrior: most activity on weekends
  const { rows: dayDistribution } = await db.query(
    `SELECT EXTRACT(DOW FROM ie.created_at) AS dow, count(*) AS n
     FROM item_events ie
     WHERE ie.to_state = 'DONE'
       AND ie.created_at > now() - interval '30 days'
       AND ie.item_id IN (SELECT id FROM items WHERE user_id = $1)
     GROUP BY EXTRACT(DOW FROM ie.created_at)`,
    [userId]
  ).catch(() => ({ rows: [] }));

  const weekendCompletions = dayDistribution.filter(r => parseInt(r.dow) === 0 || parseInt(r.dow) === 6)
    .reduce((s, r) => s + parseInt(r.n), 0);
  const weekdayCompletions = dayDistribution.filter(r => parseInt(r.dow) >= 1 && parseInt(r.dow) <= 5)
    .reduce((s, r) => s + parseInt(r.n), 0);

  if (weekendCompletions > weekdayCompletions && weekendCompletions > 5) {
    patterns.push({
      type:     'WEEKEND_WARRIOR',
      severity: 'info',
      count:    weekendCompletions,
      insight:  `You complete more tasks on weekends (${weekendCompletions}) than weekdays (${weekdayCompletions}). Consider redistributing.`,
    });
  }

  return patterns;
}

// â”€â”€â”€ Anomaly Threshold Calibration â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function _calibrateAnomalyThresholds(db, userId) {
  // Use historical priority variance to calibrate spike threshold
  const { rows } = await db.query(
    `SELECT stddev(priority) AS priority_stddev, avg(priority) AS priority_avg
     FROM traces WHERE user_id = $1 AND created_at > now() - interval '30 days'`,
    [userId]
  ).catch(() => ({ rows: [{}] }));

  const stddev = parseFloat(rows[0]?.priority_stddev || 0);
  if (stddev === 0) return null;

  // Spike threshold = 2 standard deviations (per-user calibration)
  return {
    spikeThreshold: parseFloat(Math.max(0.3, Math.min(0.8, stddev * 2)).toFixed(2)),
  };
}

// â”€â”€â”€ Helper â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function _avg(arr) { return arr.length ? arr.reduce((s, v) => s + (parseFloat(v) || 0), 0) / arr.length : 0; }

module.exports = { getUserModel, calibrate, DEFAULT_MODEL };
