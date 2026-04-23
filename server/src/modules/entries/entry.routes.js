const express = require('express');
const { authenticate } = require('../../middleware/auth');
const { validate } = require('../../middleware/validate');
const { createEntrySchema } = require('./entry.schema');
const { z } = require('zod');
const entryService = require('./entry.service');

const router = express.Router();

router.use(authenticate);

// POST /api/v1/entries — Create new capture
router.post('/', validate(createEntrySchema), async (req, res, next) => {
  try {
    const entry = await entryService.createEntry(req.user.id, req.body);
    res.status(201).json({ success: true, data: { entry } });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/entries — List entries (paginated, filterable)
router.get('/', async (req, res, next) => {
  try {
    const { date, from, to, source, tag, page, limit } = req.query;
    const result = await entryService.getEntries(req.user.id, {
      date, from, to, source, tag,
      page: page ? parseInt(page) : 1,
      limit: limit ? Math.min(parseInt(limit), 100) : 20,
    });
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/entries/search — Full-text search
router.get('/search', async (req, res, next) => {
  try {
    const { q, page, limit } = req.query;
    if (!q) return res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'Query parameter "q" is required.' },
    });
    const result = await entryService.searchEntries(req.user.id, q, {
      page: page ? parseInt(page) : 1,
      limit: limit ? Math.min(parseInt(limit), 100) : 20,
    });
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/entries/:id — Get single entry
router.get('/:id', async (req, res, next) => {
  try {
    const entry = await entryService.getEntry(req.user.id, req.params.id);
    res.json({ success: true, data: { entry } });
  } catch (err) {
    next(err);
  }
});

// PUT /api/v1/entries/:id — Update entry text
const updateEntrySchema = z.object({
  rawText: z.string().min(1, 'Text is required').max(10000, 'Text too long'),
});

router.put('/:id', validate(updateEntrySchema), async (req, res, next) => {
  try {
    const entry = await entryService.updateEntry(req.user.id, req.params.id, req.body);
    res.json({ success: true, data: { entry } });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/v1/entries/:id — Delete entry
router.delete('/:id', async (req, res, next) => {
  try {
    const result = await entryService.deleteEntry(req.user.id, req.params.id);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
