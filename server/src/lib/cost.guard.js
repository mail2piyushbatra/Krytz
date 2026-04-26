/**
 * ✦ COST GUARD
 * Enforces per-user daily LLM spend limits.
 * Call canAffordLLM() BEFORE any LLM op. Call recordSpend() AFTER.
 * If budget exceeded: LLM disabled, falls back to local extraction.
 */
'use strict';

const logger = require('./logger');
const DEFAULT_DAILY_BUDGET_USD = 0.10;

async function canAffordLLM(db, userId, estimatedCostUsd = 0.001) {
  const { rows } = await db.query(
    `SELECT COALESCE(u.daily_cost_usd, $2) AS budget, COALESCE(SUM(cu.usd_spent), 0) AS spent
     FROM users u LEFT JOIN cost_usage cu ON cu.user_id=u.id AND cu.date=CURRENT_DATE
     WHERE u.id=$1 GROUP BY u.daily_cost_usd`,
    [userId, DEFAULT_DAILY_BUDGET_USD]
  ).catch(() => ({ rows: [] }));

  if (rows.length === 0) return { allowed: true, remaining: DEFAULT_DAILY_BUDGET_USD, spent: 0 };

  const budget    = parseFloat(rows[0].budget);
  const spent     = parseFloat(rows[0].spent);
  const remaining = budget - spent;
  const allowed   = remaining >= estimatedCostUsd;

  if (!allowed) logger.warn('Daily budget exceeded — LLM disabled', { userId, budget, spent, remaining });
  return { allowed, remaining: Math.max(0, remaining), spent, budget };
}

async function recordSpend(db, userId, { usd, tokens = 0 }) {
  if (!usd || usd <= 0) return;
  await db.query(
    `INSERT INTO cost_usage(user_id, date, usd_spent, token_count)
     VALUES($1, CURRENT_DATE, $2, $3)
     ON CONFLICT(user_id, date) DO UPDATE
       SET usd_spent=cost_usage.usd_spent+EXCLUDED.usd_spent,
           token_count=cost_usage.token_count+EXCLUDED.token_count,
           updated_at=now()`,
    [userId, usd, tokens]
  ).catch(() => {});
}

async function getTodaySpend(db, userId) {
  const { rows } = await db.query(
    `SELECT COALESCE(SUM(cu.usd_spent),0) AS spent, COALESCE(SUM(cu.token_count),0) AS tokens, COALESCE(u.daily_cost_usd,$2) AS budget
     FROM users u LEFT JOIN cost_usage cu ON cu.user_id=u.id AND cu.date=CURRENT_DATE
     WHERE u.id=$1 GROUP BY u.daily_cost_usd`,
    [userId, DEFAULT_DAILY_BUDGET_USD]
  ).catch(() => ({ rows: [] }));
  if (rows.length === 0) return { spent: 0, tokens: 0, budget: DEFAULT_DAILY_BUDGET_USD, pct: 0 };
  const spent = parseFloat(rows[0].spent), budget = parseFloat(rows[0].budget);
  return { spent, tokens: parseInt(rows[0].tokens), budget, pct: budget > 0 ? Math.round((spent/budget)*100) : 0, remaining: Math.max(0, budget-spent) };
}

module.exports = { canAffordLLM, recordSpend, getTodaySpend };
