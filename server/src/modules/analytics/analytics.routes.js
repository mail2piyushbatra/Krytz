/**
 * âœ¦ Krytz â€” Analytics Routes
 *
 * Big-picture intelligence endpoints.
 */

const express = require('express');
const { authenticate } = require('../../middleware/auth');
const analyticsService = require('./analytics.service');

const router = express.Router();

router.use(authenticate);

// GET /api/v1/analytics/overview â€” Full dashboard: categories, blockers, velocity
router.get('/overview', async (req, res, next) => {
  try {
    const overview = await analyticsService.getOverview(req.user.id);
    res.json({ success: true, data: overview });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/analytics/category/:name â€” Deep dive into one category
router.get('/category/:name', async (req, res, next) => {
  try {
    const result = await analyticsService.getCategoryAnalytics(req.user.id, req.params.name);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
