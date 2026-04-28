/**
 * ✦ FLOWRA — Items Routes
 *
 * The todo ledger API. Full CRUD over items with filtering,
 * dynamic sort scoring, and completion tracking.
 */

const express = require('express');
const { authenticate } = require('../../middleware/auth');
const { validate } = require('../../middleware/validate');
const { listItemsSchema, createItemSchema, updateItemSchema } = require('./item.schema');
const itemService = require('./item.service');

const router = express.Router();

router.use(authenticate);

// GET /api/v1/items — List items (filterable by state, category, blocker)
router.get('/', async (req, res, next) => {
  try {
    const filters = listItemsSchema.parse(req.query);
    const result = await itemService.listItems(req.user.id, filters);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/items/completions — Completion ledger (done items + stats)
router.get('/completions', async (req, res, next) => {
  try {
    const days = Math.min(parseInt(req.query.days) || 7, 90);
    const result = await itemService.getCompletionStats(req.user.id, days);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/items/search — Semantic search using vector embeddings
router.post('/search', async (req, res, next) => {
  try {
    const { query, limit, threshold } = req.body;
    if (!query || typeof query !== 'string' || !query.trim()) {
      return res.status(400).json({ success: false, error: { message: 'Query is required' } });
    }
    const results = await itemService.semanticSearch(req.user.id, query.trim(), {
      limit: Math.min(parseInt(limit) || 10, 50),
      threshold: parseFloat(threshold) || 0.3,
    });
    res.json({ success: true, data: { results, count: results.length } });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/items/:id — Single item with event history
router.get('/:id', async (req, res, next) => {
  try {
    const result = await itemService.getItem(req.user.id, req.params.id);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/items — Create item directly (bypasses entry → extraction)
router.post('/', validate(createItemSchema), async (req, res, next) => {
  try {
    const item = await itemService.createItem(req.user.id, req.body);
    res.status(201).json({ success: true, data: { item } });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/v1/items/:id — Update state, category, text, priority, etc.
router.patch('/:id', validate(updateItemSchema), async (req, res, next) => {
  try {
    const item = await itemService.updateItem(req.user.id, req.params.id, req.body);
    res.json({ success: true, data: { item } });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/v1/items/:id — Soft-delete (mark DROPPED)
router.delete('/:id', async (req, res, next) => {
  try {
    const result = await itemService.deleteItem(req.user.id, req.params.id);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
