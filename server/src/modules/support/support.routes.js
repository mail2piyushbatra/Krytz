/**
 * ✦ SUPPORT ROUTES
 *
 * POST   /api/v1/rules              — create rule (NL or raw DSL)
 * GET    /api/v1/rules              — list user's rules
 * PATCH  /api/v1/rules/:id          — enable / disable / edit
 * DELETE /api/v1/rules/:id          — delete rule
 *
 * GET    /api/v1/notifications      — unread notifications (paginated)
 * POST   /api/v1/notifications/:id/read  — mark single read
 * POST   /api/v1/notifications/read-all  — mark all read
 *
 * GET    /api/v1/stats              — total entries, items by state, streak, cost
 * PATCH  /api/v1/profile            — update name, timezone, daily_cost_usd
 */

'use strict';

const express      = require('express');
const { v4: uuid } = require('uuid');
const { authenticate } = require('../../middleware/auth');
const logger = require('../../lib/logger');

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function supportRoutes(pool) {
  const router = express.Router();

  // All support routes require authentication
  router.use(authenticate);

  // ── RULES ───────────────────────────────────────────────────────────────────

  // POST /rules — create from NL or raw DSL object
  router.post('/rules', asyncHandler(async (req, res) => {
    const userId = req.user.id;
    const { nl, rule: rawRule, mode = 'live' } = req.body;

    if (!nl && !rawRule) {
      return res.status(400).json({ error: 'Provide nl (natural language) or rule (DSL object)' });
    }

    // Check rule limit for free tier
    const { checkRuleLimit } = _tiers();
    if (checkRuleLimit) {
      const limitCheck = await checkRuleLimit(pool, userId).catch(() => ({ allowed: true }));
      if (limitCheck && !limitCheck.allowed) return res.status(403).json({ error: limitCheck.message || 'Rule limit reached on free plan.' });
    }

    let ruleObj, warnings = [];

    const dsl = _ruleDsl();

    if (nl) {
      if (!dsl?.compileRule) return res.status(422).json({ error: 'NL rule compilation not available' });
      try {
        const compiled = await dsl.compileRule(nl);
        ruleObj  = compiled.rule;
        warnings = compiled.warnings || [];
      } catch (err) {
        return res.status(422).json({ error: `Rule compilation failed: ${err.message}` });
      }
    } else {
      if (dsl?.validateRule) {
        const errors = dsl.validateRule(rawRule);
        if (errors.length > 0) return res.status(422).json({ error: `Validation failed: ${errors.join('; ')}` });
      }
      ruleObj  = rawRule;
      warnings = dsl?.lintRule ? dsl.lintRule(rawRule) : [];
    }

    const id = uuid();
    await pool.query(
      `INSERT INTO rules(id,user_id,name,condition,action,cooldown_seconds,priority,mode,source,nl_input,lint_warnings)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [id, userId, ruleObj.name, JSON.stringify(ruleObj.condition), JSON.stringify(ruleObj.action),
       ruleObj.cooldown_seconds || 0, ruleObj.priority || 0, mode, nl ? 'nl_compiled' : 'user',
       nl || null, JSON.stringify(warnings)]
    );

    logger.info('Rule created', { userId, ruleId: id, source: nl ? 'nl' : 'dsl' });
    res.status(201).json({ ok: true, ruleId: id, warnings });
  }));

  // GET /rules
  router.get('/rules', asyncHandler(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT id, name, enabled, mode, priority, cooldown_seconds, condition, action,
              lint_warnings, last_fired_at, source, nl_input, created_at
       FROM rules WHERE user_id=$1 ORDER BY priority DESC, created_at DESC`,
      [req.user.id]
    );
    res.json({ rules: rows });
  }));

  // PATCH /rules/:id
  router.patch('/rules/:id', asyncHandler(async (req, res) => {
    const userId = req.user.id;
    const { id }  = req.params;
    const { enabled, mode, priority, cooldown_seconds } = req.body;

    const fields = [], vals = [];
    let idx = 1;
    if (enabled           !== undefined) { fields.push(`enabled=$${idx++}`);           vals.push(enabled); }
    if (mode              !== undefined) { fields.push(`mode=$${idx++}`);               vals.push(mode); }
    if (priority          !== undefined) { fields.push(`priority=$${idx++}`);           vals.push(priority); }
    if (cooldown_seconds  !== undefined) { fields.push(`cooldown_seconds=$${idx++}`);   vals.push(cooldown_seconds); }

    if (fields.length === 0) return res.status(400).json({ error: 'No fields to update' });

    fields.push('updated_at=now()');
    vals.push(id, userId);

    const { rowCount } = await pool.query(
      `UPDATE rules SET ${fields.join(', ')} WHERE id=$${idx} AND user_id=$${idx + 1}`, vals
    );
    if (rowCount === 0) return res.status(404).json({ error: 'Rule not found' });
    res.json({ ok: true });
  }));

  // DELETE /rules/:id
  router.delete('/rules/:id', asyncHandler(async (req, res) => {
    const { rowCount } = await pool.query(`DELETE FROM rules WHERE id=$1 AND user_id=$2`, [req.params.id, req.user.id]);
    if (rowCount === 0) return res.status(404).json({ error: 'Rule not found' });
    res.json({ ok: true });
  }));

  // ── NOTIFICATIONS ────────────────────────────────────────────────────────────

  // GET /notifications
  router.get('/notifications', asyncHandler(async (req, res) => {
    const userId     = req.user.id;
    const limit      = Math.min(parseInt(req.query.limit || '20'), 100);
    const unreadOnly = req.query.unread !== 'false';

    const { rows } = await pool.query(
      `SELECT id, type, title, body, meta, read, created_at FROM notifications
       WHERE user_id=$1 AND dismissed=false ${unreadOnly ? 'AND read=false' : ''}
       ORDER BY created_at DESC LIMIT $2`,
      [userId, limit]
    );

    const { rows: [counts] } = await pool.query(
      `SELECT count(*) FILTER (WHERE NOT read AND NOT dismissed) AS unread FROM notifications WHERE user_id=$1`,
      [userId]
    );

    res.json({ notifications: rows, unreadCount: parseInt(counts?.unread || 0) });
  }));

  // POST /notifications/:id/read
  router.post('/notifications/:id/read', asyncHandler(async (req, res) => {
    await pool.query(`UPDATE notifications SET read=true WHERE id=$1 AND user_id=$2`, [req.params.id, req.user.id]);
    res.json({ ok: true });
  }));

  // POST /notifications/read-all
  router.post('/notifications/read-all', asyncHandler(async (req, res) => {
    await pool.query(`UPDATE notifications SET read=true WHERE user_id=$1 AND read=false`, [req.user.id]);
    res.json({ ok: true });
  }));

  // ── STATS ────────────────────────────────────────────────────────────────────

  // GET /stats
  router.get('/stats', asyncHandler(async (req, res) => {
    const userId = req.user.id;

    const [entries, items, streak, costs] = await Promise.all([
      pool.query(
        `SELECT count(*) AS total,
                count(*) FILTER (WHERE timestamp > now() - interval '7 days')  AS last_7d,
                count(*) FILTER (WHERE timestamp > now() - interval '30 days') AS last_30d,
                count(DISTINCT timestamp::date) AS active_days
         FROM entries WHERE user_id=$1`,
        [userId]
      ),
      pool.query(`SELECT state, count(*) AS n FROM items WHERE user_id=$1 GROUP BY state`, [userId]),
      pool.query(
        `WITH daily AS (SELECT DISTINCT timestamp::date AS d FROM entries WHERE user_id=$1),
              streak_g AS (SELECT d, d - (ROW_NUMBER() OVER (ORDER BY d))::int AS grp FROM daily)
         SELECT count(*) AS streak FROM streak_g WHERE grp=(SELECT grp FROM streak_g ORDER BY d DESC LIMIT 1)`,
        [userId]
      ),
      pool.query(`SELECT COALESCE(SUM(usd_spent),0) AS today_usd FROM cost_usage WHERE user_id=$1 AND date=CURRENT_DATE`, [userId]),
    ]);

    const itemsByState = {};
    for (const row of items.rows) itemsByState[row.state] = parseInt(row.n);

    res.json({
      entries: { total: parseInt(entries.rows[0].total), last7d: parseInt(entries.rows[0].last_7d), last30d: parseInt(entries.rows[0].last_30d), activeDays: parseInt(entries.rows[0].active_days) },
      items: { open: itemsByState['OPEN'] || 0, inProgress: itemsByState['IN_PROGRESS'] || 0, done: itemsByState['DONE'] || 0, dropped: itemsByState['DROPPED'] || 0 },
      streak:   parseInt(streak.rows[0]?.streak || 0),
      costs: { todayUsd: parseFloat(costs.rows[0].today_usd).toFixed(4) },
    });
  }));

  // ── PROFILE ──────────────────────────────────────────────────────────────────

  // PATCH /profile
  router.patch('/profile', asyncHandler(async (req, res) => {
    const userId = req.user.id;
    const { name, timezone, daily_cost_usd } = req.body;

    const fields = [], vals = [];
    let idx = 1;

    if (name !== undefined) {
      if (typeof name !== 'string' || name.trim().length < 1) return res.status(400).json({ error: 'name must be a non-empty string' });
      fields.push(`name=$${idx++}`); vals.push(name.trim());
    }

    if (timezone !== undefined) {
      try { Intl.DateTimeFormat(undefined, { timeZone: timezone }); }
      catch (_) { return res.status(400).json({ error: `Invalid timezone: ${timezone}` }); }
      fields.push(`timezone=$${idx++}`); vals.push(timezone);
    }

    if (daily_cost_usd !== undefined) {
      const budget = parseFloat(daily_cost_usd);
      if (isNaN(budget) || budget < 0 || budget > 10) return res.status(400).json({ error: 'daily_cost_usd must be between 0 and 10' });
      fields.push(`daily_cost_usd=$${idx++}`); vals.push(budget);
    }

    if (fields.length === 0) return res.status(400).json({ error: 'No fields to update' });

    vals.push(userId);
    await pool.query(`UPDATE users SET ${fields.join(', ')} WHERE id=$${idx}`, vals);
    res.json({ ok: true });
  }));

  // ── Error handler ─────────────────────────────────────────────────────────────
  router.use((err, req, res, _next) => {
    const status = err.status || 500;
    logger.error('Support route error', { path: req.path, error: err.message, status });
    res.status(status).json({ error: err.message || 'Internal server error' });
  });

  return router;
}

// ── Helpers (lazy loads to avoid boot-time failures) ─────────────────────────
function _tiers() { try { return require('../../lib/tiers'); } catch (_) { return {}; } }
function _ruleDsl() { try { return require('../../engines/automation/rule.dsl'); } catch (_) { return null; } }

module.exports = supportRoutes;
