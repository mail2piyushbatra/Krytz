const express = require('express');
const { authenticate } = require('../../middleware/auth');

const router = express.Router();

router.use(authenticate);

// GET /api/v1/state/today — Today's aggregated state
router.get('/today', async (req, res, next) => {
  try {
    const { engines } = require('../../engines');
    const state = await engines.cortex.getTodayState(req.user.id);
    res.json({ success: true, data: { state } });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/state/week — Weekly state breakdown
router.get('/week', async (req, res, next) => {
  try {
    const { engines } = require('../../engines');
    const week = await engines.cortex.getWeeklyState(req.user.id);
    res.json({ success: true, data: week });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/state/carryovers — Items carried over from previous days
router.get('/carryovers', async (req, res, next) => {
  try {
    const { engines } = require('../../engines');
    const carryOvers = await engines.cortex.getCarryOvers(req.user.id);
    res.json({ success: true, data: { carryOvers } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
