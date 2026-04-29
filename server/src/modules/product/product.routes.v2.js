/**
 * âœ¦ PRODUCT ROUTES â€” v2
 *
 * POST  /api/v1/capture         â€” ingest entry, async pipeline
 * GET   /api/v1/plan/today      â€” stage-aware plan (simple/personalized/predictive)
 * GET   /api/v1/explain/:itemId â€” why is this item in my plan?
 * POST  /api/v1/action          â€” done / snooze / drop  (pre-snapshot for undo)
 * POST  /api/v1/action/undo     â€” undo last action
 * GET   /api/v1/action/history  â€” last 5 reversible actions
 * POST  /api/v1/feedback        â€” thumbs up/down/ignore/dismiss
 * GET   /api/v1/metrics/suggestions â€” accept_rate, ignore_rate, snoozed, dropped
 * GET   /api/v1/metrics/costs   â€” today's LLM spend
 */

'use strict';

const express      = require('express');
const { v4: uuid } = require('uuid');
const { authenticate } = require('../../middleware/auth');
const logger = require('../../lib/logger');

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function requireFields(body, fields) {
  const missing = fields.filter(f => body[f] === undefined || body[f] === null);
  if (missing.length) { const e = new Error(`Missing: ${missing.join(', ')}`); e.status = 400; throw e; }
}

function productRoutesV2(engines, pool) {
  const router = express.Router();

  // All product routes require authentication
  router.use(authenticate);

  // â”€â”€ POST /capture â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  router.post('/capture', asyncHandler(async (req, res) => {
    const userId = req.user.id;
    const { raw_input, source = 'manual', client_ts } = req.body;

    if (!raw_input?.trim())         return res.status(400).json({ error: 'raw_input is required' });
    if (raw_input.length > 50_000)  return res.status(400).json({ error: 'Input too long (max 50,000 chars)' });

    // Check daily capture tier limit
    const { checkDailyCapture } = require('../../lib/tiers');
    const captureLimitCheck = await checkDailyCapture(pool, userId).catch(() => ({ allowed: true }));
    if (!captureLimitCheck.allowed) {
      return res.status(429).json({ error: `Daily capture limit reached (${captureLimitCheck.max}/day). Upgrade to Pro for unlimited captures.` });
    }

    const entryId = uuid();
    const ts      = client_ts ? new Date(client_ts) : new Date();

    await pool.query(
      `INSERT INTO entries(id, user_id, raw_text, source, timestamp) VALUES($1,$2,$3,$4,$5)`,
      [entryId, userId, raw_input.trim(), source, ts]
    );

    const itemId = uuid();
    await pool.query(
      `INSERT INTO items(id, user_id, canonical_text, state, priority, confidence, source_entry_id, first_seen, last_seen)
       VALUES($1,$2,$3,'OPEN',0.5,0.35,$4,$5,$5)
       ON CONFLICT DO NOTHING`,
      [itemId, userId, raw_input.trim(), entryId, ts]
    ).catch((err) => {
      logger.warn('Basic item creation skipped', { entryId, error: err.message });
    });

    // 202 immediately â€” pipeline runs async
    res.status(202).json({ ok: true, entryId, itemId, status: 'processing' });

    // â”€â”€ Async pipeline â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    setImmediate(async () => {
      try {
        const { canAffordLLM, recordSpend } = require('../../lib/cost.guard');
        const { invalidatePlanCache }        = require('../../engines/intelligence/plan.engine');
        const { onEntryCreated }             = require('../../engines/intelligence/progressive.intelligence');
        const { scanForContradictions }      = require('../../engines/intelligence/contradiction.detector');

        const budget = await canAffordLLM(pool, userId, 0.002).catch(() => ({ allowed: false }));

        if (engines?.cortex && process.env.Krytz_V3_CAPTURE_USE_LEGACY_CORTEX === 'true') {
          await engines.cortex.ingest(entryId, raw_input.trim(), { source, timestamp: ts, skipLLM: !budget.allowed }).catch(() => {});
        }

        await onEntryCreated(pool, userId).catch(() => {});
        await invalidatePlanCache(pool, userId).catch(() => {});

        // Scan for new contradictions introduced by this entry
        await scanForContradictions(pool, userId).catch(() => {});

        if (budget.allowed) await recordSpend(pool, userId, { usd: 0.001, tokens: 500 }).catch(() => {});

        logger.info('Capture pipeline complete', { entryId, userId });
      } catch (err) {
        logger.error('Async ingest failed', { entryId, error: err.message });
      }
    });
  }));

  // â”€â”€ GET /plan/today â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  router.get('/plan/today', asyncHandler(async (req, res) => {
    const userId = req.user.id;
    const tz     = req.user.timezone || 'UTC';

    const { buildTodayPlan, explainItem }                               = require('../../engines/intelligence/plan.engine');
    const { getUserStage, getColdStartPlan, applyStageToplan, recordSuggestionEvent } = require('../../engines/intelligence/progressive.intelligence');

    const { rows: [ec] } = await pool.query(`SELECT count(*) AS n FROM entries WHERE user_id=$1`, [userId]);
    if (parseInt(ec.n) === 0) return res.json(getColdStartPlan(tz));

    const stage = await getUserStage(pool, userId);
    let   plan  = await buildTodayPlan(pool, userId, tz);
    plan        = applyStageToplan(plan, stage.name);

    if (plan.focus) await recordSuggestionEvent(pool, userId, plan.focus.id, 'shown', plan.confidence).catch(() => {});
    res.json(plan);
  }));

  // â”€â”€ GET /explain/:itemId â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  router.get('/explain/:itemId', asyncHandler(async (req, res) => {
    const { explainItem } = require('../../engines/intelligence/plan.engine');
    res.json(await explainItem(pool, req.user.id, req.params.itemId));
  }));

  // â”€â”€ POST /action â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  router.post('/action', asyncHandler(async (req, res) => {
    const userId = req.user.id;
    const { itemId, type, snoozeMins = 180 } = req.body;

    requireFields(req.body, ['itemId', 'type']);
    if (!['done', 'snooze', 'drop'].includes(type)) {
      return res.status(400).json({ error: 'type must be done, snooze, or drop' });
    }

    const { rows } = await pool.query(`SELECT id, state FROM items WHERE id=$1 AND user_id=$2`, [itemId, userId]);
    if (rows.length === 0) return res.status(404).json({ error: 'Item not found' });

    const { snapshotForUndo }    = require('../../lib/undo');
    const { invalidatePlanCache } = require('../../engines/intelligence/plan.engine');
    const { recordSuggestionEvent } = require('../../engines/intelligence/progressive.intelligence');

    // Snapshot BEFORE acting
    await snapshotForUndo(pool, userId, itemId, type);

    let result = {};

    if (type === 'done') {
      await pool.query(`UPDATE items SET state='DONE', updated_at=now() WHERE id=$1 AND user_id=$2`, [itemId, userId]);
      await pool.query(`INSERT INTO item_events(id,item_id,from_state,to_state,confidence,reason) VALUES(uuid_generate_v4(),$1,'OPEN','DONE',0.9,'user_action')`, [itemId]).catch(() => {});
      await recordSuggestionEvent(pool, userId, itemId, 'accepted', null).catch(() => {});
      result = { state: 'DONE' };

    } else if (type === 'snooze') {
      const snoozeUntil = new Date(Date.now() + snoozeMins * 60_000);
      await pool.query(`INSERT INTO snoozes(user_id,item_id,snooze_until) VALUES($1,$2,$3) ON CONFLICT(user_id,item_id) DO UPDATE SET snooze_until=EXCLUDED.snooze_until`, [userId, itemId, snoozeUntil]);
      await recordSuggestionEvent(pool, userId, itemId, 'snoozed', null).catch(() => {});
      result = { snoozedUntil: snoozeUntil };

    } else if (type === 'drop') {
      await pool.query(`UPDATE items SET state='DROPPED', updated_at=now() WHERE id=$1 AND user_id=$2`, [itemId, userId]);
      await pool.query(`INSERT INTO item_events(id,item_id,from_state,to_state,confidence,reason) VALUES(uuid_generate_v4(),$1,'OPEN','DROPPED',0.5,'user_dropped')`, [itemId]).catch(() => {});
      await recordSuggestionEvent(pool, userId, itemId, 'dropped', null).catch(() => {});
      result = { state: 'DROPPED' };
    }

    await invalidatePlanCache(pool, userId).catch(() => {});
    res.json({ ok: true, itemId, type, result });
  }));

  // â”€â”€ POST /action/undo â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  router.post('/action/undo', asyncHandler(async (req, res) => {
    const { undoLastAction } = require('../../lib/undo');
    const result = await undoLastAction(pool, req.user.id);
    if (!result.ok) return res.status(400).json(result);
    res.json(result);
  }));

  // â”€â”€ GET /action/history â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  router.get('/action/history', asyncHandler(async (req, res) => {
    const { getUndoHistory } = require('../../lib/undo');
    const history = await getUndoHistory(pool, req.user.id, 5);
    res.json({ history });
  }));

  // â”€â”€ POST /feedback â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  router.post('/feedback', asyncHandler(async (req, res) => {
    const userId = req.user.id;
    const { type, targetType, targetId, reason } = req.body;

    requireFields(req.body, ['type', 'targetType', 'targetId']);

    const validTypes       = ['thumbs_up', 'thumbs_down', 'ignore', 'dismiss'];
    const validTargetTypes = ['item', 'suggestion', 'extraction', 'recall', 'rule', 'notification'];
    if (!validTypes.includes(type))            return res.status(400).json({ error: `Invalid type: ${type}` });
    if (!validTargetTypes.includes(targetType)) return res.status(400).json({ error: `Invalid targetType: ${targetType}` });

    await pool.query(`INSERT INTO feedback(id,user_id,type,target_type,target_id,payload) VALUES(uuid_generate_v4(),$1,$2,$3,$4,$5)`, [userId, type, targetType, targetId, JSON.stringify({ reason })]).catch(() => {});

    if (targetType === 'item' && (type === 'thumbs_down' || type === 'ignore')) {
      await pool.query(`UPDATE items SET confidence=GREATEST(0.1,confidence*0.8) WHERE id=$1 AND user_id=$2`, [targetId, userId]).catch(() => {});
      const { invalidatePlanCache } = require('../../engines/intelligence/plan.engine');
      const { recordSuggestionEvent } = require('../../engines/intelligence/progressive.intelligence');
      await invalidatePlanCache(pool, userId).catch(() => {});
      await recordSuggestionEvent(pool, userId, targetId, 'ignored', null).catch(() => {});
    }

    res.json({ ok: true });
  }));

  // â”€â”€ GET /metrics/suggestions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  router.get('/metrics/suggestions', asyncHandler(async (req, res) => {
    const { getSuggestionMetrics } = require('../../engines/intelligence/progressive.intelligence');
    const days = Math.min(parseInt(req.query.days || '7'), 90);
    res.json({ windowDays: days, ...await getSuggestionMetrics(pool, req.user.id, days) });
  }));

  // â”€â”€ GET /metrics/costs â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  router.get('/metrics/costs', asyncHandler(async (req, res) => {
    const { getTodaySpend } = require('../../lib/cost.guard');
    res.json(await getTodaySpend(pool, req.user.id));
  }));

  // â”€â”€ Error handler â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  router.use((err, req, res, _next) => {
    const status = err.status || 500;
    logger.error('Product v2 route error', { path: req.path, error: err.message, status });
    res.status(status).json({ error: err.message || 'Internal server error' });
  });

  return router;
}

module.exports = productRoutesV2;
