/**
 * ✦ INTELLIGENCE ROUTES — v1
 *
 * GET  /api/v1/intelligence/contradictions              — active conflicts
 * POST /api/v1/intelligence/contradictions/:id/resolve  — mark resolved
 * GET  /api/v1/intelligence/commitments                 — open commitments
 * POST /api/v1/intelligence/commitments/:id/fulfill     — mark fulfilled
 * POST /api/v1/intelligence/simulate                    — what-if mutation
 * GET  /api/v1/intelligence/items/:id/estimate          — time estimate
 * POST /api/v1/intelligence/items/:id/time              — record actual time
 * GET  /api/v1/intelligence/estimation/stats            — estimation bias
 * GET  /api/v1/intelligence/capacity                    — workload + burnout
 * GET  /api/v1/intelligence/billing/tier                — tier + usage
 * POST /api/v1/intelligence/billing/checkout            — Stripe checkout
 * DELETE /api/v1/intelligence/auth/me/gdpr              — schedule deletion
 * POST /api/v1/intelligence/auth/me/gdpr/cancel         — cancel deletion
 */

'use strict';

const express = require('express');
const { authenticate } = require('../../middleware/auth');
const logger = require('../../lib/logger');

// Intelligence modules — lazy-loaded so the route file loads even if
// individual modules are not yet wired to a live DB.
function _require(path) { try { return require(path); } catch (e) { return null; } }

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function intelligenceRoutes(pool) {
  const router = express.Router();

  // All intelligence routes require authentication
  router.use(authenticate);

  // Attach pg pool to req.db so handlers can query directly
  router.use((req, _res, next) => { req.db = pool; next(); });

  // ── Contradictions ──────────────────────────────────────────────────────────
  router.get('/contradictions', asyncHandler(async (req, res) => {
    const { getContradictions } = require('../../engines/intelligence/contradiction.detector');
    const { requireFeature }    = require('../../lib/tiers');
    await requireFeature('contradictionDetector')(req, res, async () => {
      const list = await getContradictions(pool, req.user.id);
      res.json({ contradictions: list });
    });
  }));

  router.post('/contradictions/:id/resolve', asyncHandler(async (req, res) => {
    const { resolveContradiction } = require('../../engines/intelligence/contradiction.detector');
    await resolveContradiction(pool, req.user.id, req.params.id);
    res.json({ ok: true });
  }));

  // ── Commitments ─────────────────────────────────────────────────────────────
  router.get('/commitments', asyncHandler(async (req, res) => {
    const { getOpenCommitments } = require('../../engines/intelligence/commitment.tracker');
    const list = await getOpenCommitments(pool, req.user.id);
    res.json({ commitments: list });
  }));

  router.post('/commitments/:id/fulfill', asyncHandler(async (req, res) => {
    const { fulfillCommitment } = require('../../engines/intelligence/commitment.tracker');
    await fulfillCommitment(pool, req.user.id, req.params.id);
    res.json({ ok: true });
  }));

  // ── What-if simulator ────────────────────────────────────────────────────────
  router.post('/simulate', asyncHandler(async (req, res) => {
    const { requireFeature }  = require('../../lib/tiers');
    const { simulate }        = require('../../engines/intelligence/whatif.simulator');
    const { buildTodayPlan }  = require('../../engines/intelligence/plan.engine');

    await requireFeature('whatIfSimulator')(req, res, async () => {
      const { mutation } = req.body;
      if (!mutation?.type) return res.status(400).json({ error: 'mutation.type is required' });

      const tz = req.user.timezone || 'UTC';
      const { rows: items } = await pool.query(
        `SELECT i.*,
                EXTRACT(EPOCH FROM (now() - i.last_seen))  / 86400 AS recency_days,
                EXTRACT(EPOCH FROM (now() - i.first_seen)) / 86400 AS persistence_days,
                EXTRACT(EPOCH FROM (i.deadline - now()))   / 86400 AS deadline_days,
                (SELECT count(*) FROM item_edges e JOIN items d ON d.id=e.to_item
                 WHERE e.from_item=i.id AND d.state NOT IN ('DONE','DROPPED'))       AS downstream_open,
                EXISTS(SELECT 1 FROM snoozes s WHERE s.item_id=i.id AND s.user_id=$1 AND s.snooze_until>now()) AS snoozed
         FROM items i WHERE i.user_id=$1 AND i.state IN ('OPEN','IN_PROGRESS')`,
        [req.user.id]
      );
      const currentPlan = await buildTodayPlan(pool, req.user.id, tz);
      res.json(simulate(items, currentPlan, mutation));
    });
  }));

  // ── Time estimation ──────────────────────────────────────────────────────────
  router.get('/items/:id/estimate', asyncHandler(async (req, res) => {
    const { requireFeature } = require('../../lib/tiers');
    const { estimateTime }   = require('../../engines/intelligence/time.estimation');
    await requireFeature('timeEstimation')(req, res, async () => {
      res.json(await estimateTime(pool, req.user.id, req.params.id));
    });
  }));

  router.post('/items/:id/time', asyncHandler(async (req, res) => {
    const { recordActualTime } = require('../../engines/intelligence/time.estimation');
    const { actualMins } = req.body;
    if (!actualMins || actualMins <= 0) return res.status(400).json({ error: 'actualMins must be > 0' });
    await recordActualTime(pool, req.user.id, req.params.id, actualMins);
    res.json({ ok: true });
  }));

  router.get('/estimation/stats', asyncHandler(async (req, res) => {
    const { requireFeature }    = require('../../lib/tiers');
    const { getEstimationStats } = require('../../engines/intelligence/time.estimation');
    await requireFeature('timeEstimation')(req, res, async () => {
      res.json(await getEstimationStats(pool, req.user.id));
    });
  }));

  // ── Capacity ─────────────────────────────────────────────────────────────────
  router.get('/capacity', asyncHandler(async (req, res) => {
    const { computeCapacity } = require('../../engines/intelligence/capacity.model');
    res.json(await computeCapacity(pool, req.user.id));
  }));

  router.get('/task-graph', asyncHandler(async (req, res) => {
    const { buildTaskGraph } = require('../../engines/intelligence/weekly.planner');
    res.json(await buildTaskGraph(pool, req.user.id, { limit: req.query.limit }));
  }));

  router.get('/weekly-memory', asyncHandler(async (req, res) => {
    const { buildWeeklyMemoryInsights } = require('../../engines/intelligence/weekly.planner');
    res.json(await buildWeeklyMemoryInsights(pool, req.user.id, req.user.timezone || 'UTC', {
      days: req.query.days,
      limit: req.query.limit,
    }));
  }));

  // ── Plan today (intelligence-flavoured) ──────────────────────────────────────
  router.get('/plan/today', asyncHandler(async (req, res) => {
    const { buildTodayPlan }                                            = require('../../engines/intelligence/plan.engine');
    const { getUserStage, getColdStartPlan, applyStageToplan, recordSuggestionEvent } = require('../../engines/intelligence/progressive.intelligence');
    const tz = req.user.timezone || 'UTC';
    const { rows: [ec] } = await pool.query(`SELECT count(*) AS n FROM entries WHERE user_id=$1`, [req.user.id]);
    if (parseInt(ec.n) === 0) return res.json(getColdStartPlan(tz));
    const stage = await getUserStage(pool, req.user.id);
    let plan    = await buildTodayPlan(pool, req.user.id, tz);
    plan        = applyStageToplan(plan, stage.name);
    if (plan.focus) await recordSuggestionEvent(pool, req.user.id, plan.focus.id, 'shown', plan.confidence).catch(() => {});
    res.json(plan);
  }));

  // ── Plan week ────────────────────────────────────────────────────────────────
  router.get('/plan/week', asyncHandler(async (req, res) => {
    const { buildWeeklyPlan } = require('../../engines/intelligence/weekly.planner');
    res.json(await buildWeeklyPlan(pool, req.user.id, req.user.timezone || 'UTC'));
  }));

  // ── Billing ─────────────────────────────────────────────────────────────────
  router.get('/billing/tier', asyncHandler(async (req, res) => {
    const { TIERS, checkItemLimit } = require('../../lib/tiers');
    const tier      = req.userTier || TIERS.free;
    const itemLimit = await checkItemLimit(pool, req.user.id);
    res.json({ tier: tier.name, limits: tier, usage: itemLimit });
  }));

  router.post('/billing/checkout', asyncHandler(async (req, res) => {
    const { createCheckoutSession } = require('../../lib/tiers');
    const { priceId, successUrl, cancelUrl } = req.body;
    if (!priceId) return res.status(400).json({ error: 'priceId required' });
    const session = await createCheckoutSession(req.user.id, priceId, successUrl || `${process.env.APP_URL}/settings?upgraded=1`, cancelUrl || `${process.env.APP_URL}/settings`);
    res.json(session);
  }));

  // ── GDPR ─────────────────────────────────────────────────────────────────────
  router.delete('/auth/me/gdpr', asyncHandler(async (req, res) => {
    const { scheduleDeletion } = require('../../lib/gdpr');
    const result = await scheduleDeletion(pool, req.user.id);
    res.json({ ok: true, message: 'Your data deletion has been scheduled. You have 24 hours to cancel.', ...result });
  }));

  router.post('/auth/me/gdpr/cancel', asyncHandler(async (req, res) => {
    const { cancelDeletion } = require('../../lib/gdpr');
    await cancelDeletion(pool, req.user.id);
    res.json({ ok: true, message: 'Deletion cancelled. Your data is safe.' });
  }));

  // ── Error handler ────────────────────────────────────────────────────────────
  router.use((err, req, res, _next) => {
    const status = err.status || 500;
    logger.error('Intelligence route error', { path: req.path, error: err.message, status });
    res.status(status).json({ error: err.message || 'Internal server error' });
  });

  return router;
}

// ─── Stripe webhook — no auth, raw body ──────────────────────────────────────
function stripeWebhookRoute(pool) {
  const router = express.Router();
  router.post('/billing/webhook',
    express.raw({ type: 'application/json' }),
    asyncHandler(async (req, res) => {
      const { handleStripeWebhook } = require('../../lib/tiers');
      const sig    = req.headers['stripe-signature'];
      const result = await handleStripeWebhook(pool, req.body, sig);
      res.json(result);
    })
  );
  return router;
}

module.exports = { intelligenceRoutes, stripeWebhookRoute };
