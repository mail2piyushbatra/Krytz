const { z } = require('zod');

const createCategorySchema = z.object({
  name:      z.string().min(1).max(50),
  color:     z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#6c5ce7'),
  sortOrder: z.number().int().min(0).default(0),
});

const updateCategorySchema = z.object({
  name:      z.string().min(1).max(50).optional(),
  color:     z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  sortOrder: z.number().int().min(0).optional(),
});

module.exports = { createCategorySchema, updateCategorySchema };
