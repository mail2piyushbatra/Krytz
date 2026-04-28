const express = require('express');
const { authenticate } = require('../../middleware/auth');

const router = express.Router();

router.use(authenticate);

// POST /api/v1/recall — Natural language query over user history
router.post('/', async (req, res, next) => {
  try {
    const { query } = req.body;
    if (!query || typeof query !== 'string' || query.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Query is required.' },
      });
    }

    const { engines, repository } = require('../../engines');
    const result = await engines.recall.query(req.user.id, query.trim(), repository);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
