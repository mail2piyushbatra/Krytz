const prisma = require('../../lib/prisma');
const { AppError } = require('../../middleware/errorHandler');

/**
 * Create a new capture entry.
 * Stores the entry immediately, then delegates to Cortex for async AI processing.
 */
async function createEntry(userId, { rawText, source, fileKeys, fileMeta, timestamp }) {
  const hasFiles = fileKeys && fileKeys.length > 0;

  const entry = await prisma.entry.create({
    data: {
      userId,
      rawText,
      source: source || 'manual',
      hasFiles,
      timestamp: timestamp ? new Date(timestamp) : new Date(),
      ...(hasFiles && {
        files: {
          create: fileKeys.map((key, i) => {
            const meta = (fileMeta && fileMeta[i]) || {};
            const ext = key.split('.').pop().toLowerCase();
            const typeMap = {
              jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
              webp: 'image/webp', pdf: 'application/pdf',
            };
            return {
              fileName: meta.fileName || key.split('/').pop(),
              fileType: meta.fileType || typeMap[ext] || 'application/octet-stream',
              fileUrl: `${process.env.S3_ENDPOINT}/${process.env.S3_BUCKET}/${key}`,
              fileKey: key,
              fileSize: meta.fileSize || 0,
            };
          }),
        },
      }),
    },
    include: {
      extractedState: true,
      files: true,
    },
  });

  // Delegate to Cortex for async AI extraction
  const { engines } = require('../../engines');
  engines.cortex.ingestAsync(entry.id, rawText, {
    source: source || 'manual',
    fileKey: hasFiles ? fileKeys[0] : null,
    fileType: hasFiles && fileMeta && fileMeta[0] ? fileMeta[0].fileType : null,
  });

  return entry;
}

/**
 * Update an existing entry's text.
 * Re-triggers Cortex extraction on the updated content.
 */
async function updateEntry(userId, entryId, { rawText }) {
  const entry = await prisma.entry.findUnique({ where: { id: entryId } });

  if (!entry) throw new AppError('Entry not found.', 404, 'NOT_FOUND');
  if (entry.userId !== userId) throw new AppError('Access denied.', 403, 'FORBIDDEN');

  const updated = await prisma.entry.update({
    where: { id: entryId },
    data: {
      rawText,
      updatedAt: new Date(),
    },
    include: {
      extractedState: true,
      files: true,
    },
  });

  // Re-process through Cortex with updated text
  const { engines } = require('../../engines');
  engines.cortex.ingestAsync(entryId, rawText, { source: updated.source });

  return updated;
}

/**
 * Get entries for a user with filtering and pagination.
 */
async function getEntries(userId, { date, from, to, source, tag, page = 1, limit = 20 }) {
  const where = { userId };

  if (date) {
    const dayStart = new Date(date);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(date);
    dayEnd.setHours(23, 59, 59, 999);
    where.timestamp = { gte: dayStart, lte: dayEnd };
  } else if (from || to) {
    where.timestamp = {};
    if (from) where.timestamp.gte = new Date(from);
    if (to) where.timestamp.lte = new Date(to);
  }

  if (source) where.source = source;

  if (tag) {
    where.extractedState = {
      tags: { path: [], array_contains: [tag] },
    };
  }

  const skip = (page - 1) * limit;

  const [entries, total] = await Promise.all([
    prisma.entry.findMany({
      where,
      include: { extractedState: true, files: true },
      orderBy: { timestamp: 'desc' },
      skip,
      take: limit,
    }),
    prisma.entry.count({ where }),
  ]);

  return {
    entries,
    meta: { page, limit, total, hasMore: skip + entries.length < total },
  };
}

/**
 * Get a single entry by ID (with ownership check).
 */
async function getEntry(userId, entryId) {
  const entry = await prisma.entry.findUnique({
    where: { id: entryId },
    include: { extractedState: true, files: true },
  });

  if (!entry) throw new AppError('Entry not found.', 404, 'NOT_FOUND');
  if (entry.userId !== userId) throw new AppError('Access denied.', 403, 'FORBIDDEN');

  return entry;
}

/**
 * Delete an entry (with ownership check).
 * Purges associated S3 files before deleting DB records.
 */
async function deleteEntry(userId, entryId) {
  const entry = await prisma.entry.findUnique({
    where: { id: entryId },
    include: { files: { select: { fileKey: true } } },
  });

  if (!entry) throw new AppError('Entry not found.', 404, 'NOT_FOUND');
  if (entry.userId !== userId) throw new AppError('Access denied.', 403, 'FORBIDDEN');

  if (entry.files && entry.files.length > 0) {
    const { deleteFilesFromS3 } = require('../files/file.service');
    await deleteFilesFromS3(entry.files.map((f) => f.fileKey));
  }

  await prisma.entry.delete({ where: { id: entryId } });

  // Recompute state via engine
  const { engines } = require('../../engines');
  await engines.state.recomputeDaily(userId, entry.timestamp);

  return { message: 'Entry deleted.' };
}

/**
 * Full-text search across entries.
 */
async function searchEntries(userId, query, { page = 1, limit = 20 }) {
  const skip = (page - 1) * limit;

  const where = {
    userId,
    rawText: { contains: query, mode: 'insensitive' },
  };

  const [entries, total] = await Promise.all([
    prisma.entry.findMany({
      where,
      include: { extractedState: true },
      orderBy: { timestamp: 'desc' },
      skip,
      take: limit,
    }),
    prisma.entry.count({ where }),
  ]);

  return {
    entries,
    meta: { page, limit, total, hasMore: skip + entries.length < total },
  };
}

module.exports = { createEntry, updateEntry, getEntries, getEntry, deleteEntry, searchEntries };
