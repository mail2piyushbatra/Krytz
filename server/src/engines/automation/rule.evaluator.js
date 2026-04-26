/**
 * ✦ RULE EVALUATOR
 *
 * Deterministic condition interpreter + context builder.
 * Evaluates all enabled rules against an item, respects cooldowns,
 * returns fired decisions ready for the action queue.
 */

'use strict';

// ─── Condition interpreter ────────────────────────────────────────────────────
function evalCond(node, ctx) {
  switch (node.op) {
    case 'AND':    return node.args.every(a => evalCond(a, ctx));
    case 'OR':     return node.args.some(a  => evalCond(a, ctx));
    case 'EQ':     return getVal(node.left, ctx) === getVal(node.right, ctx);
    case 'GT':     return getVal(node.left, ctx) >   getVal(node.right, ctx);
    case 'GTE':    return getVal(node.left, ctx) >=  getVal(node.right, ctx);
    case 'LT':     return getVal(node.left, ctx) <   getVal(node.right, ctx);
    case 'LTE':    return getVal(node.left, ctx) <=  getVal(node.right, ctx);
    case 'EXISTS': return getPath(ctx, node.path) != null;
    case 'MATCH':  return new RegExp(node.regex, 'i').test(String(getPath(ctx, node.path) || ''));
    default:       return false;
  }
}

function getVal(expr, ctx) {
  if ('const' in expr) {
    // Allow param refs: { "const": { "param": "persistence_days" } }
    if (typeof expr.const === 'object' && expr.const !== null && 'param' in expr.const) {
      return ctx._params?.[expr.const.param] ?? expr.const.default ?? 0;
    }
    return expr.const;
  }
  if ('var' in expr) return getPath(ctx, expr.var);
  return null;
}

// Dot-path resolver: "item.state" → ctx.item.state
function getPath(ctx, path) {
  return path.split('.').reduce((obj, key) => obj?.[key], ctx);
}

// ─── Template materializer ────────────────────────────────────────────────────
// Replaces {{item.text}}, {{item.id}} etc. in action strings
function materialize(action, ctx) {
  const clone = JSON.parse(JSON.stringify(action));
  const replace = (s) => typeof s === 'string'
    ? s.replace(/\{\{([^}]+)\}\}/g, (_, path) => String(getPath(ctx, path) ?? ''))
    : s;

  if (clone.title) clone.title = replace(clone.title);
  if (clone.body)  clone.body  = replace(clone.body);
  if (clone.dedupe) clone.dedupe = replace(clone.dedupe);
  if (clone.url)   clone.url   = replace(clone.url);

  // Inject resolved IDs for executors
  clone.userId = ctx._userId;
  clone.itemId = ctx.item?.id;

  return clone;
}

// ─── Cooldown check ───────────────────────────────────────────────────────────
function inCooldown(rule) {
  if (!rule.last_fired_at || !rule.cooldown_seconds) return false;
  const elapsed = (Date.now() - new Date(rule.last_fired_at).getTime()) / 1000;
  return elapsed < rule.cooldown_seconds;
}

// ─── Context builder ──────────────────────────────────────────────────────────
/**
 * Assembles the full evaluation context for a (userId, item) pair.
 * Includes: item fields, memory signals, time signals.
 *
 * NOTE: This version works with the TemporalStateGraph (in-memory)
 * rather than raw SQL queries. For pgvector-backed item.graph.js,
 * swap this builder.
 */
function buildContextFromTSG(userId, item) {
  const now          = new Date();
  const persistDays  = Math.floor((now - new Date(item.firstSeen)) / 86_400_000);
  const recencyDays  = Math.floor((now - new Date(item.lastSeen))  / 86_400_000);
  const deadlineDays = item.dueDate
    ? Math.ceil((new Date(item.dueDate) - now) / 86_400_000)
    : null;

  return {
    _userId:  userId,
    _params:  {},
    item: {
      id:                  item.id,
      text:                item.text,
      state:               item.state,
      priority:            item.priority,
      project:             item.project,
      blocker:             false,
      persistence_days:    persistDays,
      recency_days:        recencyDays,
      deadline_days:       deadlineDays,
      downstream_open:     0,
      blocked_by_prereq:   false,
      mention_count:       item.mentions || 1,
    },
    memory: {
      recurrence_7d: item.mentions || 0,
    },
    time: {
      hour:        now.getHours(),
      day_of_week: now.getDay(),   // 0=Sun
    },
  };
}

/**
 * Evaluate all rules against a TSG item.
 * Returns array of { rule, payload, dedupeKey } decisions.
 *
 * @param {Array} rules - Array of rule objects (from wherever they're stored)
 * @param {string} userId
 * @param {Object} item - TSGNode.toJSON() output
 */
function evaluateRulesForTSGItem(rules, userId, item) {
  const ctx       = buildContextFromTSG(userId, item);
  const decisions = [];

  for (const rule of rules) {
    if (!rule.enabled || rule.mode === 'paused') continue;
    if (inCooldown(rule)) continue;

    // Inject RL-tuned params into context
    ctx._params = rule.params || {};

    let pass;
    try { pass = evalCond(rule.condition, ctx); }
    catch (e) { continue; }  // malformed condition — skip, don't crash

    if (!pass) continue;

    const payload    = materialize(rule.action, ctx);
    const dedupeKey  = payload.dedupe || `${rule.id}:${item.id}:${Math.floor(Date.now() / 86_400_000)}`;

    decisions.push({ rule, payload, dedupeKey, shadow: rule.mode === 'shadow' });
  }

  return decisions;
}

module.exports = { evaluateRulesForTSGItem, evalCond, buildContextFromTSG, materialize };
