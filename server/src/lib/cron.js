/**
 * ✦ CRON SCHEDULER
 *
 * All scheduled jobs in one place. Call startCron(db) once at server startup.
 *
 * Jobs:
 *   Every hour    — rule sweep (evaluate rules for all active items)
 *   Every hour    — expire snoozed items (restore to plan)
 *   Nightly 2am   — memory consolidation (cluster old episodes → summaries)
 *   Nightly 3am   — RL policy optimizer (tune rule thresholds)
 *   Nightly 4am   — TSG maintenance (decay + drop old items)
 *   Daily midnight — reset plan cache + process GDPR deletions
 *
 * Uses node-cron if installed; falls back to setInterval.
 */

'use strict';

const logger = require('./logger');

// Lazy-load engine modules — jobs resolve deps at call time, not import time.
// This lets cron.js load cleanly even if optional modules aren't deployed yet.
function _consolidate()         { try { return require('../engines/memory/memory').consolidate;         } catch (_) { return null; } }
function _optimizeAllRules()    { try { return require('../engines/eval/policy.optimizer').optimizeAllRules;    } catch (_) { return null; } }
function _evaluateRulesForItem(){ try { return require('../engines/automation/rule.evaluator').evaluateRulesForItem; } catch (_) { return null; } }
function _enqueueActions()      { try { return require('../engines/automation/action.executor').enqueueActions;      } catch (_) { return null; } }
function _refreshPriority()     { try { return require('../engines/graph/item.graph').refreshPriority;     } catch (_) { return null; } }

// ─── Job: hourly rule sweep ───────────────────────────────────────────────────
async function jobRuleSweep(db) {
  logger.info('Rule sweep starting');
  try {
    const evalFn    = _evaluateRulesForItem();
    const enqueueFn = _enqueueActions();
    if (!evalFn) { logger.warn('rule.evaluator not available — skipping sweep'); return; }

    const { rows: users } = await db.query(
      `SELECT DISTINCT user_id FROM entries WHERE timestamp > now() - interval '7 days'`
    );
    let totalFired = 0;
    for (const { user_id } of users) {
      try {
        const { rows: items } = await db.query(
          `SELECT * FROM items WHERE user_id=$1 AND state IN ('OPEN','IN_PROGRESS') ORDER BY priority DESC LIMIT 50`,
          [user_id]
        );
        for (const item of items) {
          try {
            const decisions = await evalFn(db, user_id, item);
            if (decisions.length > 0 && enqueueFn) { enqueueFn(db, decisions); totalFired += decisions.length; }
          } catch (_) {}
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

// ─── Job: nightly memory consolidation ───────────────────────────────────────
async function jobMemoryConsolidate(db) {
  logger.info('Memory consolidation starting');
  try {
    const consolidateFn = _consolidate();
    if (!consolidateFn) { logger.warn('memory.consolidate not available — skipping'); return; }
    const { rows: users } = await db.query(
      `SELECT DISTINCT user_id FROM episodic_memory WHERE ts < now() - interval '7 days' AND indexed_at IS NOT NULL`
    );
    let totalSummaries = 0;
    for (const { user_id } of users) {
      try { const r = await consolidateFn(db, user_id, { daysOld: 7, minClusterSize: 3 }); totalSummaries += r.summaries; }
      catch (err) { logger.warn('Consolidation failed for user', { user_id, error: err.message }); }
    }
    logger.info('Memory consolidation complete', { users: users.length, summaries: totalSummaries });
  } catch (err) { logger.error('Memory consolidation job failed', { error: err.message }); }
}

// ─── Job: RL policy optimizer ─────────────────────────────────────────────────
async function jobOptimizeRules(db) {
  logger.info('Policy optimization starting');
  try {
    const optimizeFn = _optimizeAllRules();
    if (!optimizeFn) { logger.warn('policy.optimizer not available — skipping'); return; }
    const { rows: users } = await db.query(`SELECT DISTINCT user_id FROM rules WHERE enabled=true AND user_id IS NOT NULL`);
    for (const { user_id } of users) {
      try { const results = await optimizeFn(db, user_id); const changed = results.filter(r => r?.changed).length; if (changed > 0) logger.info('Rules optimized', { user_id, changed }); }
      catch (err) { logger.warn('Rule optimization failed for user', { user_id, error: err.message }); }
    }
  } catch (err) { logger.error('Policy optimization job failed', { error: err.message }); }
}

// ─── Job: TSG daily maintenance (decay + drop) ────────────────────────────────
async function jobTSGMaintenance(db) {
  logger.info('TSG maintenance starting');
  try {
    const refreshFn = _refreshPriority();
    const { rows: staleItems } = await db.query(
      `SELECT id, user_id FROM items WHERE state IN ('OPEN','IN_PROGRESS') AND last_seen < now() - interval '7 days'`
    );
    let dropped = 0;
    for (const item of staleItems) {
      try {
        await db.query(`UPDATE items SET state='DROPPED', updated_at=now() WHERE id=$1`, [item.id]);
        await db.query(`INSERT INTO item_events(id,item_id,from_state,to_state,confidence,reason) VALUES(uuid_generate_v4(),$1,'OPEN','DROPPED',0.3,'cron_maintenance')`, [item.id]);
        dropped++;
      } catch (_) {}
    }
    const { rows: activeItems } = await db.query(`SELECT id FROM items WHERE state IN ('OPEN','IN_PROGRESS') LIMIT 500`);
    if (refreshFn) { for (const { id } of activeItems) await refreshFn(db, id).catch(() => {}); }
    logger.info('TSG maintenance complete', { droppedStale: dropped, prioritiesRefreshed: activeItems.length });
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
  } catch (_) { /* gdpr module optional */ }
}

// ─── Main scheduler ───────────────────────────────────────────────────────────
function startCron(db) {
  let cron;
  try { cron = require('node-cron'); } catch (_) { cron = null; }

  if (cron) {
    cron.schedule('0 * * * *',  () => jobRuleSweep(db));
    cron.schedule('15 * * * *', () => jobExpireSnoozes(db));
    cron.schedule('0 2 * * *',  () => jobMemoryConsolidate(db));
    cron.schedule('0 3 * * *',  () => jobOptimizeRules(db));
    cron.schedule('0 4 * * *',  () => jobTSGMaintenance(db));
    cron.schedule('0 0 * * *',  () => jobMidnightMaintenance(db));
    logger.info('Cron scheduler started (node-cron)', { jobs: ['rule-sweep','expire-snoozes','memory-consolidate','optimize-rules','tsg-maintenance','midnight-maintenance'] });
  } else {
    setInterval(() => jobRuleSweep(db),          60 * 60 * 1000);
    setInterval(() => jobExpireSnoozes(db),       60 * 60 * 1000);
    setInterval(() => jobMemoryConsolidate(db), 24 * 60 * 60 * 1000);
    setInterval(() => jobOptimizeRules(db),     24 * 60 * 60 * 1000);
    setInterval(() => jobTSGMaintenance(db),    24 * 60 * 60 * 1000);
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
    memoryConsolidate:    jobMemoryConsolidate,
    optimizeRules:        jobOptimizeRules,
    tsgMaintenance:       jobTSGMaintenance,
    midnightMaintenance:  jobMidnightMaintenance,
  },
};
