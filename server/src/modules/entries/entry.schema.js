const { z } = require('zod');

const createEntrySchema = z.object({
  rawText: z.string().min(1, 'Text is required').max(10000, 'Text too long (max 10,000 chars)'),
  source: z.enum(['manual', 'calendar', 'gmail', 'notion']).default('manual'),
  fileKeys: z.array(z.string()).max(5).optional(),
  timestamp: z.string().datetime().optional(),
});

module.exports = { createEntrySchema };
