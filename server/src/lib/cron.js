/**
 * ✦ CRON SCHEDULER
 *
 * All scheduled jobs in one place. Call startCron(db) once at server startup.
 *
 * Jobs:
 *   Every hour    — rule sweep (evaluate rules for all active items)
 *   Every hour    — expire snoozed items (restore to plan)
 *   Nightly 4am   — TSG maintenance (decay + drop old items)
 *   Daily midnight — reset plan cache + process GDPR deletions
 *
 * Phase 3 (not yet implemented — commented out of schedule):
 *   Nightly 2am   — memory consolidation (cluster old episodes → summaries)
 *   Nightly 3am   — RL policy optimizer (tune rule thresholds)
 *
 * Uses node-cron if installed; falls back to setInterval.
 */

'use strict';

const logger = require('./logger');

// ─── Direct imports for modules that exist ────────────────────────────────────
const { evaluateRulesForTSGItem } = require('../engines/automation/rule.evaluator');
const { optimizeRule }            = require('../engines/eval/policy.optimizer');

// ─── Job: hourly rule sweep ───────────────────────────────────────────────────
async function jobRuleSweep(db) {
  logger.info('Rule sweep starting');
  try {
    const { rows: users } = await db.query(
      `SELECT DISTINCT user_id FROM entries WHERE timestamp > now() - interval '7 days'`
    );
    let totalFired = 0;
    for (const { user_id } of users) {
      try {
        // Load user's enabled rules
        const { rows: rules } = await db.query(
          `SELECT * FROM rules WHERE (user_id = $1 OR user_id IS NULL) AND enabled = true`,
          [user_id]
        );
        if (rules.length === 0) continue;

        // Load user's active items from DB
        const { rows: items } = await db.query(
          `SELECT * FROM items WHERE user_id=$1 AND state IN ('OPEN','IN_PROGRESS') ORDER BY priority DESC LIMIT 50`,
          [user_id]
        );

        for (const item of items) {
          try {
            // Build TSG-compatible item shape for the evaluator
            const tsgItem = {
              id:        item.id,
              text:      item.canonical_text,
              state:     item.state,
              priority:  item.priority,
              project:   'general',
              dueDate:   item.deadline,
              firstSeen: item.first_seen,
              lastSeen:  item.last_seen,
              mentions:  item.mention_count,
            };

            const decisions = evaluateRulesForTSGItem(rules, user_id, tsgItem);
            for (const decision of decisions) {
              if (decision.shadow) continue; // shadow mode = log only, don't execute

              // Dedupe: skip if already fired today
              const { rows: existing } = await db.query(
                `SELECT id FROM action_runs WHERE dedupe_key = $1`,
                [decision.dedupeKey]
              );
              if (existing.length > 0) continue;

              // Log action run
              await db.query(
                `INSERT INTO action_runs(rule_id, item_id, result, dedupe_key) VALUES($1, $2, $3, $4)`,
                [decision.rule.id, item.id, JSON.stringify(decision.payload), decision.dedupeKey]
              );

              // Update rule's last_fired_at
              await db.query(
                `UPDATE rules SET last_fired_at = now() WHERE id = $1`,
                [decision.rule.id]
              );

              totalFired++;
            }
          } catch (err) {
            logger.warn('Rule evaluation failed for item', { item_id: item.id, error: err.message });
          }
        }
      } catch (err) { logger.warn('Rule sweep failed for user', { user_id, error: err.message }); }
    }
    logger.info('Rule sweep complete', { users: users.length, totalFired });
  } catch (err) { logger.error('Rule sweep job failed', { error: err.message }); }
}

// ─── Job: expire snoozes ──────────────────────────────────────────────────────
async function jobExpireSnoozes(db) {
  try {
    const { rowCount } = await db.query(`DELETE FROM snoozes WHERE snooze_until <= now()`);
    if (rowCount > 0) logger.info('Snoozes expired', { count: rowCount });
  } catch (err) { logger.error('Expire snoozes failed', { error: err.message }); }
}

// ─── Job: RL policy optimizer ─────────────────────────────────────────────────
async function jobOptimizeRules(db) {
  logger.info('Policy optimization starting');
  try {
    const { rows: rules } = await db.query(
      `SELECT * FROM rules WHERE enabled = true AND user_id IS NOT NULL`
    );

    let changed = 0;
    for (const rule of rules) {
      try {
        const result = optimizeRule(rule);
        if (result && result.changed) {
          await db.query(
            `UPDATE rules SET params = $1, updated_at = now() WHERE id = $2`,
            [JSON.stringify(result.params), rule.id]
          );
          changed++;
        }
      } catch (err) {
        logger.warn('Rule optimization failed', { ruleId: rule.id, error: err.message });
      }
    }

    logger.info('Policy optimization complete', { rulesEvaluated: rules.length, changed });
  } catch (err) { logger.error('Policy optimization job failed', { error: err.message }); }
}

// ─── Job: TSG daily maintenance (decay + drop) ────────────────────────────────
async function jobTSGMaintenance(_db) {
  logger.info('TSG maintenance starting');
  try {
    // Use the TSG singleton — it writes through to DB via _persistItem()
    const { tsg } = require('../engines');
    const dropped = await tsg.runDailyMaintenance();
    logger.info('TSG maintenance complete', { droppedStale: dropped.length });
  } catch (err) { logger.error('TSG maintenance failed', { error: err.message }); }
}

// ─── Job: reset plan cache + process GDPR deletions at midnight ──────────────
async function jobMidnightMaintenance(db) {
  try {
    const { rowCount } = await db.query(`DELETE FROM plan_cache WHERE date < CURRENT_DATE`);
    if (rowCount > 0) logger.info('Plan cache cleared', { count: rowCount });
  } catch (err) { logger.error('Plan cache reset failed', { error: err.message }); }

  // Process any pending GDPR deletions
  try {
    const { processPendingDeletions } = require('./gdpr');
    const n = await processPendingDeletions(db);
    if (n > 0) logger.info('GDPR deletions processed', { count: n });
  } catch (_) { /* gdpr module optional — Phase 3 */ }
}

// ─── Main scheduler ───────────────────────────────────────────────────────────
function startCron(db) {
  let cron;
  try { cron = require('node-cron'); } catch (_) { cron = null; }

  if (cron) {
    cron.schedule('0 * * * *',  () => jobRuleSweep(db));
    cron.schedule('15 * * * *', () => jobExpireSnoozes(db));
    cron.schedule('0 3 * * *',  () => jobOptimizeRules(db));
    cron.schedule('0 4 * * *',  () => jobTSGMaintenance(db));
    cron.schedule('0 0 * * *',  () => jobMidnightMaintenance(db));
    logger.info('Cron scheduler started (node-cron)', {
      jobs: ['rule-sweep', 'expire-snoozes', 'optimize-rules', 'tsg-maintenance', 'midnight-maintenance'],
    });
  } else {
    setInterval(() => jobRuleSweep(db),            60 * 60 * 1000);
    setInterval(() => jobExpireSnoozes(db),         60 * 60 * 1000);
    setInterval(() => jobOptimizeRules(db),       24 * 60 * 60 * 1000);
    setInterval(() => jobTSGMaintenance(db),      24 * 60 * 60 * 1000);
    setInterval(() => jobMidnightMaintenance(db), 24 * 60 * 60 * 1000);
    logger.warn('Cron using setInterval fallback — install node-cron for precise scheduling');
  }

  // Run expire-snoozes immediately on startup (catch any that expired while server was down)
  jobExpireSnoozes(db).catch(() => {});
}

module.exports = {
  startCron,
  jobs: {
    ruleSweep:            jobRuleSweep,
    expireSnoozes:        jobExpireSnoozes,
    optimizeRules:        jobOptimizeRules,
    tsgMaintenance:       jobTSGMaintenance,
    midnightMaintenance:  jobMidnightMaintenance,
  },
};
