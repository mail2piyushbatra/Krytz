/**
 * ✦ Krytz — Categories Routes
 *
 * CRUD for user-defined category buckets.
 */

const express = require('express');
const { authenticate } = require('../../middleware/auth');
const { validate } = require('../../middleware/validate');
const { createCategorySchema, updateCategorySchema } = require('./category.schema');
const categoryService = require('./category.service');

const router = express.Router();

router.use(authenticate);

// GET /api/v1/categories — List all categories with item counts
router.get('/', async (req, res, next) => {
  try {
    // Auto-seed defaults for new users
    await categoryService.seedDefaults(req.user.id);
    const categories = await categoryService.listCategories(req.user.id);
    res.json({ success: true, data: { categories } });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/categories — Create new category
router.post('/', validate(createCategorySchema), async (req, res, next) => {
  try {
    const category = await categoryService.createCategory(req.user.id, req.body);
    res.status(201).json({ success: true, data: { category } });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/v1/categories/:id — Update name, color, sort order
router.patch('/:id', validate(updateCategorySchema), async (req, res, next) => {
  try {
    const category = await categoryService.updateCategory(req.user.id, req.params.id, req.body);
    res.json({ success: true, data: { category } });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/v1/categories/:id — Delete (items → uncategorized)
router.delete('/:id', async (req, res, next) => {
  try {
    const result = await categoryService.deleteCategory(req.user.id, req.params.id);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
