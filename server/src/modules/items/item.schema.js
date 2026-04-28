const { z } = require('zod');

const itemStates = ['OPEN', 'IN_PROGRESS', 'DONE', 'DROPPED'];

const listItemsSchema = z.object({
  state:    z.enum(itemStates).optional(),
  category: z.string().max(100).optional(),
  blocker:  z.enum(['true', 'false']).optional(),
  since:    z.string().optional(),  // e.g. "7d", "30d", ISO date
  sort:     z.enum(['priority', 'deadline', 'recent', 'created']).default('priority'),
  page:     z.coerce.number().int().min(1).default(1),
  limit:    z.coerce.number().int().min(1).max(100).default(50),
});

const createItemSchema = z.object({
  text:     z.string().min(1).max(500),
  category: z.string().max(100).default('uncategorized'),
  deadline: z.string().datetime().optional().nullable(),
  blocker:  z.boolean().default(false),
  priority: z.number().min(0).max(1).default(0.5),
});

const updateItemSchema = z.object({
  text:     z.string().min(1).max(500).optional(),
  state:    z.enum(itemStates).optional(),
  category: z.string().max(100).optional(),
  deadline: z.string().datetime().optional().nullable(),
  blocker:  z.boolean().optional(),
  priority: z.number().min(0).max(1).optional(),
});

module.exports = { listItemsSchema, createItemSchema, updateItemSchema, itemStates };
