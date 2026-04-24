const { z } = require('zod');
const { ALLOWED_FILE_TYPES, MAX_TEXT_LENGTH } = require('../../../../shared/constants');

const fileMetaSchema = z.object({
  fileName: z.string().min(1).max(255),
  fileType: z.enum(ALLOWED_FILE_TYPES),
  fileSize: z.number().int().min(0).max(10 * 1024 * 1024),
});

const createEntrySchema = z.object({
  rawText: z.string().min(1, 'Text is required').max(MAX_TEXT_LENGTH, `Text too long (max ${MAX_TEXT_LENGTH} chars)`),
  source: z.enum(['manual', 'calendar', 'gmail', 'notion']).default('manual'),
  fileKeys: z.array(z.string()).max(5).optional(),
  fileMeta: z.array(fileMetaSchema).max(5).optional(),
  timestamp: z.string().datetime().optional(),
});

const updateEntrySchema = z.object({
  rawText: z.string().min(1, 'Text is required').max(MAX_TEXT_LENGTH, `Text too long (max ${MAX_TEXT_LENGTH} chars)`),
});

module.exports = { createEntrySchema, updateEntrySchema };
