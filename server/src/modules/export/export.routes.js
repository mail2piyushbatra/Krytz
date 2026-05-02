/**
 * ✦ Krytz — Export Routes
 *
 * GET /api/v1/export — Full JSON dump of the user's ledger.
 * Satisfies audit requirement Â§3.2.
 */

const express = require('express');
const { authenticate } = require('../../middleware/auth');
const db = require('../../lib/db');
const logger = require('../../lib/logger');

const router = express.Router();

router.use(authenticate);

// GET /api/v1/export — Full ledger export
router.get('/', async (req, res, next) => {
  try {
    const userId = req.user.id;

    // Items
    const items = await db.query(
      `SELECT * FROM items WHERE user_id = $1 ORDER BY created_at DESC`,
      [userId]
    );

    // Categories
    const categories = await db.query(
      `SELECT * FROM categories WHERE user_id = $1 ORDER BY sort_order`,
      [userId]
    );

    // Item events (last 500)
    const events = await db.query(
      `SELECT ie.* FROM item_events ie
       JOIN items i ON i.id = ie.item_id
       WHERE i.user_id = $1
       ORDER BY ie.created_at DESC
       LIMIT 500`,
      [userId]
    );

    // Entries (last 200)
    const entries = await db.query(
      `SELECT id, raw_text, source, 'entry' AS type, created_at FROM entries
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 200`,
      [userId]
    );

    const exportData = {
      exportedAt: new Date().toISOString(),
      version: 'Krytz-v3',
      user: { id: userId, email: req.user.email },
      summary: {
        totalItems: items.rows.length,
        totalCategories: categories.rows.length,
        totalEvents: events.rows.length,
        totalEntries: entries.rows.length,
      },
      items: items.rows,
      categories: categories.rows,
      events: events.rows,
      entries: entries.rows,
    };

    logger.info('Data exported', { userId, items: items.rows.length });

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition',
      `attachment; filename="Krytz-export-${new Date().toISOString().slice(0, 10)}.json"`
    );
    res.json({ success: true, data: exportData });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
