/**
 * ✦ ADAPTIVE POLICY OPTIMIZER (RL-LITE)
 *
 * Continuously tunes rule thresholds based on observed outcomes.
 *
 * Architecture:
 *   Execution → recordOutcome() → metrics store
 *   Periodic sweep → optimizeRule() → adjusts rule.params
 *   Evaluator reads rule.params → injects into condition context
 *
 * Algorithm: contextual bandit (epsilon-greedy style)
 *   - Too noisy (low success rate, high fire rate) → tighten thresholds
 *   - Too strict (high success rate, very low fire rate) → loosen
 *   - Within target band → leave unchanged
 *
 * Also includes:
 *   - Extraction quality scorer (precision/recall vs golden set)
 *   - Recall answer scorer (fact coverage)
 *   - chooseExtractionPath: routes to right extraction strategy by current stats
 */

'use strict';

const logger = require('../../lib/logger');

// ─── In-memory outcome store (upgrade to DB later) ────────────────────────────
const _outcomes = new Map();  // ruleId → [{ fired, useful, cost, ts }]
const _fires    = new Map();  // ruleId → count

/**
 * Record the outcome of a rule execution.
 */
function recordOutcome(ruleId, { fired, useful, cost = 0 } = {}) {
  if (!_outcomes.has(ruleId)) _outcomes.set(ruleId, []);
  _outcomes.get(ruleId).push({ fired, useful, cost, ts: Date.now() });

  if (fired) {
    _fires.set(ruleId, (_fires.get(ruleId) || 0) + 1);
  }
}

/**
 * Get aggregated stats for a rule.
 */
function getRuleStats(ruleId, { windowDays = 7 } = {}) {
  const outcomes = _outcomes.get(ruleId) || [];
  const cutoff = Date.now() - windowDays * 24 * 60 * 60 * 1000;
  const recent = outcomes.filter(o => o.ts >= cutoff);

  const total       = recent.length;
  const useful      = recent.filter(o => o.useful).length;
  const successRate = total > 0 ? useful / total : null;
  const fireCount   = _fires.get(ruleId) || 0;
  const fireRate    = fireCount / Math.max(1, windowDays);
  const avgCost     = total > 0 ? recent.reduce((s, o) => s + o.cost, 0) / total : 0;

  return { total, successRate, fireRate, avgCost };
}

// ─── Bandit optimizer ─────────────────────────────────────────────────────────
// Target band: successRate 0.5–0.8, fireRate < 0.3/day
const TARGETS = {
  successRateMin: 0.50,
  successRateMax: 0.80,
  fireRateMax:    0.30,   // fires per day
  minSamples:     5,      // don't tune without enough data
};

function optimizeRule(rule) {
  const stats = getRuleStats(rule.id);

  if (stats.total < TARGETS.minSamples) {
    logger.info('Skipping optimization — insufficient samples', { ruleId: rule.id, samples: stats.total });
    return null;
  }

  const p = { ...(rule.params || {}) };
  let changed = false;

  const { successRate, fireRate } = stats;

  if (successRate < TARGETS.successRateMin && fireRate > TARGETS.fireRateMax) {
    // Too noisy — tighten
    if ('persistence_days' in p) { p.persistence_days = Math.min((p.persistence_days || 3) + 1, 14); changed = true; }
    if ('cooldown_seconds' in p) { p.cooldown_seconds = Math.min((p.cooldown_seconds || 3600) * 2, 86400); changed = true; }
    logger.info('Tightening rule', { ruleId: rule.id, reason: `successRate=${successRate?.toFixed(2)}, fireRate=${fireRate?.toFixed(2)}` });

  } else if (successRate !== null && successRate > TARGETS.successRateMax && fireRate < 0.05) {
    // Too strict — loosen
    if ('persistence_days' in p) { p.persistence_days = Math.max((p.persistence_days || 3) - 1, 1); changed = true; }
    if ('cooldown_seconds' in p) { p.cooldown_seconds = Math.max(Math.floor((p.cooldown_seconds || 3600) / 2), 900); changed = true; }
    logger.info('Loosening rule', { ruleId: rule.id, reason: `successRate=${successRate?.toFixed(2)}, fireRate=${fireRate?.toFixed(2)}` });
  }

  return { ruleId: rule.id, stats, params: p, changed };
}

// ─── Extraction quality scorer ────────────────────────────────────────────────
function scoreExtraction(pred, gold) {
  const pSet = new Set((pred.actionItems || []).map(x => x.text?.toLowerCase().trim()));
  const gSet = new Set((gold.actionItems || []).map(x => x.text?.toLowerCase().trim()));

  const tp        = [...pSet].filter(x => gSet.has(x)).length;
  const precision = tp / (pSet.size || 1);
  const recall    = tp / (gSet.size || 1);
  const f1        = precision + recall > 0 ? 2 * precision * recall / (precision + recall) : 0;

  return { precision: parseFloat(precision.toFixed(3)), recall: parseFloat(recall.toFixed(3)), f1: parseFloat(f1.toFixed(3)) };
}

// ─── Recall quality scorer ────────────────────────────────────────────────────
function scoreRecall(answer, expectedFacts) {
  const a    = (answer || '').toLowerCase();
  const hits = (expectedFacts || []).filter(f => a.includes(f.toLowerCase())).length;
  return parseFloat((hits / Math.max(1, expectedFacts.length)).toFixed(3));
}

// ─── Extraction path router ───────────────────────────────────────────────────
// Uses live quality stats to route each extraction to the right strategy.
function chooseExtractionPath({ precision, cost, latencyMs } = {}) {
  if (precision !== null && precision < 0.65) return 'LLM_STRICT';    // quality too low → strict LLM
  if (cost      !== null && cost > 0.003)     return 'RULE_HEAVY';    // too expensive → lean on rules
  if (latencyMs !== null && latencyMs > 3000) return 'RULE_HEAVY';    // too slow → local first
  return 'HYBRID';                                                     // default
}

module.exports = {
  recordOutcome,
  getRuleStats,
  optimizeRule,
  scoreExtraction,
  scoreRecall,
  chooseExtractionPath,
};
