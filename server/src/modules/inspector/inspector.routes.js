/**
 * ✦ INSPECTOR ROUTES — Observability & Engine Introspection
 *
 * GET  /api/v1/inspector/traces         — Recent decision/observability traces
 * GET  /api/v1/inspector/replay/:id     — Replay a specific trace (time-travel)
 * GET  /api/v1/inspector/anomalies      — Anomaly events
 * GET  /api/v1/inspector/decisions       — Recent decision engine outputs
 * GET  /api/v1/inspector/graph           — Causality graph snapshot
 * GET  /api/v1/inspector/health          — Engine fleet health
 * POST /api/v1/inspector/connectors      — Register connector
 * GET  /api/v1/inspector/connectors      — List connectors
 */

'use strict';

const express = require('express');
const { authenticate } = require('../../middleware/auth');
const logger = require('../../lib/logger');

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function inspectorRoutes(pool) {
  const router = express.Router();
  router.use(authenticate);
  router.use(asyncHandler(async (req, _res, next) => {
    await requirePlatformRole(pool, req.user.id, ['founder', 'operator', 'devops', 'coder', 'support']);
    next();
  }));

  // ── Traces ──────────────────────────────────────────────────────
  router.get('/traces', asyncHandler(async (req, res) => {
    const limit = Math.min(parseInt(req.query.limit || '50'), 200);
    const { rows } = await pool.query(
      `SELECT * FROM traces WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [req.user.id, limit]
    ).catch(() => ({ rows: [] }));
    res.json({ traces: rows });
  }));

  // ── Replay ──────────────────────────────────────────────────────
  router.get('/replay/:traceId', asyncHandler(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT * FROM traces WHERE id = $1 AND user_id = $2`,
      [req.params.traceId, req.user.id]
    ).catch(() => ({ rows: [] }));
    if (rows.length === 0) return res.status(404).json({ error: 'Trace not found' });

    const trace = rows[0];
    // Reconstruct state at trace time
    const { rows: itemsAtTime } = await pool.query(
      `SELECT i.*, ie.from_state, ie.to_state, ie.reason, ie.created_at AS event_time
       FROM items i
       LEFT JOIN item_events ie ON ie.item_id = i.id AND ie.created_at <= $2
       WHERE i.user_id = $1
       ORDER BY ie.created_at DESC`,
      [req.user.id, trace.created_at]
    ).catch(() => ({ rows: [] }));

    res.json({ trace, stateSnapshot: itemsAtTime.slice(0, 50) });
  }));

  // ── Anomalies ───────────────────────────────────────────────────
  router.get('/anomalies', asyncHandler(async (req, res) => {
    const limit = Math.min(parseInt(req.query.limit || '30'), 100);
    const { rows } = await pool.query(
      `SELECT * FROM anomaly_events WHERE user_id = $1 ORDER BY detected_at DESC LIMIT $2`,
      [req.user.id, limit]
    ).catch(() => ({ rows: [] }));
    res.json({ anomalies: rows });
  }));

  // ── Decisions ───────────────────────────────────────────────────
  router.get('/decisions', asyncHandler(async (req, res) => {
    const limit = Math.min(parseInt(req.query.limit || '30'), 100);
    const { rows } = await pool.query(
      `SELECT * FROM decision_traces WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [req.user.id, limit]
    ).catch(() => ({ rows: [] }));
    res.json({ decisions: rows });
  }));

  // ── Causality Graph ─────────────────────────────────────────────
  router.get('/graph', asyncHandler(async (req, res) => {
    const { rows: deps } = await pool.query(
      `SELECT cd.*, i1.text AS from_text, i2.text AS to_text
       FROM commitment_dependencies cd
       JOIN items i1 ON i1.id = cd.from_item_id
       JOIN items i2 ON i2.id = cd.to_item_id
       WHERE i1.user_id = $1`,
      [req.user.id]
    ).catch(() => ({ rows: [] }));

    const { rows: items } = await pool.query(
      `SELECT id, text, state, priority, category, deadline FROM items
       WHERE user_id = $1 AND state NOT IN ('DONE','DROPPED')
       ORDER BY priority DESC LIMIT 100`,
      [req.user.id]
    ).catch(() => ({ rows: [] }));

    // Build adjacency structure for frontend visualization
    const nodes = items.map(i => ({ id: i.id, label: i.text?.slice(0, 60), state: i.state, priority: i.priority, category: i.category }));
    const edges = deps.map(d => ({ from: d.from_item_id, to: d.to_item_id, type: d.dependency_type }));

    res.json({ nodes, edges, totalDependencies: edges.length });
  }));

  // ── Engine Fleet Health ─────────────────────────────────────────
  router.get('/health', (req, res) => {
    const { getSystemHealth } = require('../../engines');
    res.json(getSystemHealth());
  });

  // ── Connectors ──────────────────────────────────────────────────
  router.get('/connectors', asyncHandler(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT * FROM connector_state WHERE user_id = $1 ORDER BY created_at DESC`,
      [req.user.id]
    ).catch(() => ({ rows: [] }));
    res.json({ connectors: rows });
  }));

  router.post('/connectors', asyncHandler(async (req, res) => {
    const { platform, config = {} } = req.body;
    if (!platform) return res.status(400).json({ error: 'platform is required' });

    const { v4: uuid } = require('uuid');
    const id = uuid();
    await pool.query(
      `INSERT INTO connector_state (id, user_id, platform, status, config, created_at)
       VALUES ($1, $2, $3, 'pending', $4, now())
       ON CONFLICT (user_id, platform) DO UPDATE SET config = $4, status = 'pending'`,
      [id, req.user.id, platform, JSON.stringify(config)]
    );
    res.status(201).json({ ok: true, connectorId: id });
  }));

  // ── Error handler ───────────────────────────────────────────────
  router.use((err, req, res, _next) => {
    const status = err.status || 500;
    logger.error('Inspector route error', { path: req.path, error: err.message });
    res.status(status).json({ error: err.message || 'Internal server error' });
  });

  return router;
}

async function requirePlatformRole(pool, userId, allowedRoles) {
  const { rows } = await pool.query(
    `SELECT om.role
       FROM organization_members om
      WHERE om.user_id = $1
      ORDER BY om.created_at DESC
      LIMIT 1`,
    [userId]
  ).catch(() => ({ rows: [] }));

  const role = rows[0]?.role;
  if (!role || !allowedRoles.includes(role)) {
    const err = new Error(`Platform role required: ${allowedRoles.join(', ')}`);
    err.status = 403;
    throw err;
  }
}

module.exports = inspectorRoutes;
