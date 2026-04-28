const db = require('../../lib/db');
const logger = require('../../lib/logger');
const { AppError } = require('../../middleware/errorHandler');

/**
 * Create a new capture entry.
 * Stores the entry immediately, then handles type-specific behavior:
 *   capture → full Cortex pipeline (normalize → extract → state)
 *   todo    → local fast-path extraction (skip LLM)
 *   done    → instant: mark matching item DONE in TSG
 *   blocked → instant: mark matching item as blocker in TSG
 *   note    → store only, no extraction
 */
async function createEntry(userId, { rawText, source, type, category, fileKeys, fileMeta, timestamp }) {
  const hasFiles = Boolean(fileKeys && fileKeys.length > 0);
  const ts = timestamp ? new Date(timestamp) : new Date();
  const entryType = type || 'capture';

  const { rows } = await db.query(
    `INSERT INTO entries(user_id, raw_text, source, has_files, timestamp)
     VALUES($1, $2, $3, $4, $5)
     RETURNING *`,
    [userId, rawText, source || 'manual', hasFiles, ts]
  );

  const entry = toApiEntry(rows[0]);

  // Create file attachment records if files were uploaded
  if (hasFiles) {
    for (let i = 0; i < fileKeys.length; i++) {
      const key = fileKeys[i];
      const meta = (fileMeta && fileMeta[i]) || {};
      const ext = key.split('.').pop().toLowerCase();
      const typeMap = {
        jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
        webp: 'image/webp', pdf: 'application/pdf',
      };
      await db.query(
        `INSERT INTO file_attachments(entry_id, file_name, file_type, file_url, file_key, file_size)
         VALUES($1, $2, $3, $4, $5, $6)`,
        [
          entry.id,
          meta.fileName || key.split('/').pop(),
          meta.fileType || typeMap[ext] || 'application/octet-stream',
          `${process.env.S3_ENDPOINT}/${process.env.S3_BUCKET}/${key}`,
          key,
          meta.fileSize || 0,
        ]
      );
    }
  }

  // ─── Type-specific handling ──────────────────────────────────────────────

  const { engines } = require('../../engines');

  if (entryType === 'done') {
    // INSTANT: Mark matching item as DONE in TSG + DB
    await _handleInstantDone(userId, rawText, entry.id, category, engines);
  } else if (entryType === 'blocked') {
    // INSTANT: Mark matching item as blocker in TSG + DB
    await _handleInstantBlocked(userId, rawText, entry.id, category, engines);
  } else if (entryType === 'note') {
    // Store only — no extraction, no state change
    logger.info('Note entry stored (no extraction)', { entryId: entry.id });
  } else {
    // 'capture' or 'todo' — delegate to Cortex pipeline
    engines.cortex.ingestAsync(entry.id, rawText, {
      source: source || 'manual',
      type: entryType,
      category: category || 'uncategorized',
      fileKey: hasFiles ? fileKeys[0] : null,
      fileType: hasFiles && fileMeta && fileMeta[0] ? fileMeta[0].fileType : null,
    });
  }

  // Load extracted state + files for response
  const full = await _loadFullEntry(entry.id);
  return full;
}

/**
 * Instant done: find matching open item and mark it DONE.
 * No LLM call — pure text matching against TSG.
 */
async function _handleInstantDone(userId, text, entryId, category, engines) {
  try {
    // Try TSG match first (in-memory fuzzy match)
    if (engines.state && engines.state._tsg) {
      const tsg = engines.state._tsg;
      const match = tsg._findMatch(text, userId);
      if (match && match.state !== 'DONE') {
        const prevState = match.state;
        match.transitionTo('DONE', 1.0);
        await tsg._persistItem(match, prevState);
        logger.info('Instant DONE via TSG match', { userId, itemId: match.id, text });
        return;
      }
    }

    // Fallback: direct DB match (uses pg_trgm similarity if available, else ILIKE)
    let rows;
    try {
      const result = await db.query(
        `UPDATE items SET state = 'DONE', confidence = 1.0, updated_at = now(), last_seen = now()
         WHERE id = (
           SELECT id FROM items
           WHERE user_id = $1 AND state IN ('OPEN', 'IN_PROGRESS')
           ORDER BY similarity(canonical_text, $2) DESC, last_seen DESC
           LIMIT 1
         ) RETURNING id, canonical_text`,
        [userId, text]
      );
      rows = result.rows;
    } catch (simErr) {
      // pg_trgm not available — fall back to ILIKE substring match
      // pg_trgm not available — fall back to FTS search_vector match
      const keywords = text.split(/\s+/).filter(w => w.length > 3).slice(0, 3);
      if (keywords.length === 0) { rows = []; }
      else {
        const result = await db.query(
          `UPDATE items SET state = 'DONE', confidence = 1.0, updated_at = now(), last_seen = now()
           WHERE id = (
             SELECT id FROM items
             WHERE user_id = $1 AND state IN ('OPEN', 'IN_PROGRESS') AND search_vector @@ plainto_tsquery('english', $2)
             ORDER BY ts_rank(search_vector, plainto_tsquery('english', $2)) DESC, last_seen DESC LIMIT 1
           ) RETURNING id, canonical_text`,
          [userId, keywords.join(' ')]
        );
        rows = result.rows;
      }
    }

    if (rows.length > 0) {
      await db.query(
        `INSERT INTO item_events (item_id, from_state, to_state, confidence, reason)
         VALUES ($1, 'OPEN', 'DONE', 1.0, $2)`,
        [rows[0].id, `Marked done via entry ${entryId}`]
      );
      logger.info('Instant DONE via DB match', { userId, itemId: rows[0].id, matched: rows[0].canonical_text });
    } else {
      // No match — create a new DONE item as a completion record
      await db.query(
        `INSERT INTO items (user_id, canonical_text, state, category, confidence, source_entry_id)
         VALUES ($1, $2, 'DONE', $3, 1.0, $4)`,
        [userId, text, category || 'uncategorized', entryId]
      );
      logger.info('Instant DONE — new completion item', { userId, text });
    }
  } catch (err) {
    logger.warn('Instant DONE failed, falling back to async', { error: err.message });
  }
}

/**
 * Instant blocked: find matching item and flag it as blocker.
 */
async function _handleInstantBlocked(userId, text, entryId, category, engines) {
  try {
    // Try TSG match
    if (engines.state && engines.state._tsg) {
      const tsg = engines.state._tsg;
      const match = tsg._findMatch(text, userId);
      if (match) {
        match.blocker = true;
        match.reinforce(0.05);
        await tsg._persistItem(match, null);
        // Also update DB directly
        await db.query(
          `UPDATE items SET blocker = true, updated_at = now() WHERE id = $1`,
          [match.id]
        );
        logger.info('Instant BLOCKED via TSG match', { userId, itemId: match.id });
        return;
      }
    }

    // Fallback: create new blocked item
    await db.query(
      `INSERT INTO items (user_id, canonical_text, state, category, blocker, confidence, source_entry_id)
       VALUES ($1, $2, 'OPEN', $3, true, 0.8, $4)`,
      [userId, text, category || 'uncategorized', entryId]
    );
    await db.query(
      `INSERT INTO item_events (item_id, from_state, to_state, confidence, reason)
       VALUES ((SELECT id FROM items WHERE source_entry_id = $1 LIMIT 1), NULL, 'OPEN', 0.8, 'Created as blocker')`,
      [entryId]
    );
    logger.info('Instant BLOCKED — new blocker item', { userId, text });
  } catch (err) {
    logger.warn('Instant BLOCKED failed', { error: err.message });
  }
}

/**
 * Update an existing entry's text.
 * Re-triggers Cortex extraction on the updated content.
 */
async function updateEntry(userId, entryId, { rawText }) {
  const { rows: existing } = await db.query(
    'SELECT id, user_id, source FROM entries WHERE id = $1', [entryId]
  );

  if (existing.length === 0) throw new AppError('Entry not found.', 404, 'NOT_FOUND');
  if (existing[0].user_id !== userId) throw new AppError('Access denied.', 403, 'FORBIDDEN');

  await db.query(
    'UPDATE entries SET raw_text = $1, updated_at = now() WHERE id = $2',
    [rawText, entryId]
  );

  const full = await _loadFullEntry(entryId);

  // Re-process through Cortex with updated text
  const { engines } = require('../../engines');
  engines.cortex.ingestAsync(entryId, rawText, { source: existing[0].source });

  return full;
}

/**
 * Get entries for a user with filtering and pagination.
 */
async function getEntries(userId, { date, from, to, source, tag, page = 1, limit = 20 }) {
  const conditions = ['e.user_id = $1'];
  const params = [userId];
  let paramIdx = 2;

  if (date) {
    const dayStart = new Date(date);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(date);
    dayEnd.setHours(23, 59, 59, 999);
    conditions.push(`e.timestamp >= $${paramIdx} AND e.timestamp <= $${paramIdx + 1}`);
    params.push(dayStart, dayEnd);
    paramIdx += 2;
  } else if (from || to) {
    if (from) { conditions.push(`e.timestamp >= $${paramIdx}`); params.push(new Date(from)); paramIdx++; }
    if (to)   { conditions.push(`e.timestamp <= $${paramIdx}`); params.push(new Date(to)); paramIdx++; }
  }

  if (source) { conditions.push(`e.source = $${paramIdx}`); params.push(source); paramIdx++; }

  const where = conditions.join(' AND ');
  const offset = (page - 1) * limit;

  const [entriesResult, countResult] = await Promise.all([
    db.query(
      `SELECT e.*, row_to_json(es.*) AS extracted_state
       FROM entries e
       LEFT JOIN extracted_states es ON es.entry_id = e.id
       WHERE ${where}
       ORDER BY e.timestamp DESC
       OFFSET $${paramIdx} LIMIT $${paramIdx + 1}`,
      [...params, offset, limit]
    ),
    db.query(`SELECT count(*) AS total FROM entries e WHERE ${where}`, params),
  ]);

  const entries = entriesResult.rows.map(toApiEntry);
  const total = parseInt(countResult.rows[0].total);

  // Load files for entries that have them
  const withFiles = entries.filter(e => e.hasFiles);
  if (withFiles.length > 0) {
    const ids = withFiles.map(e => e.id);
    const { rows: fileRows } = await db.query(
      `SELECT * FROM file_attachments WHERE entry_id = ANY($1)`, [ids]
    );
    const fileMap = {};
    for (const f of fileRows) {
      if (!fileMap[f.entry_id]) fileMap[f.entry_id] = [];
      fileMap[f.entry_id].push(toApiFile(f));
    }
    for (const e of entries) e.files = fileMap[e.id] || [];
  }

  return {
    entries,
    meta: { page, limit, total, hasMore: offset + entries.length < total },
  };
}

/**
 * Get a single entry by ID (with ownership check).
 */
async function getEntry(userId, entryId) {
  const full = await _loadFullEntry(entryId);
  if (!full) throw new AppError('Entry not found.', 404, 'NOT_FOUND');
  if (full.userId !== userId) throw new AppError('Access denied.', 403, 'FORBIDDEN');
  return full;
}

/**
 * Delete an entry (with ownership check).
 * Purges associated S3 files before deleting DB records.
 */
async function deleteEntry(userId, entryId) {
  const { rows } = await db.query(
    'SELECT id, user_id, timestamp FROM entries WHERE id = $1', [entryId]
  );

  if (rows.length === 0) throw new AppError('Entry not found.', 404, 'NOT_FOUND');
  if (rows[0].user_id !== userId) throw new AppError('Access denied.', 403, 'FORBIDDEN');

  // Get file keys for S3 cleanup
  const { rows: fileRows } = await db.query(
    'SELECT file_key FROM file_attachments WHERE entry_id = $1', [entryId]
  );

  if (fileRows.length > 0) {
    const { deleteFilesFromS3 } = require('../files/file.service');
    await deleteFilesFromS3(fileRows.map((f) => f.file_key));
  }

  // Cascade deletes extracted_states and file_attachments via FK
  await db.query('DELETE FROM entries WHERE id = $1', [entryId]);

  // Recompute state via engine
  const { engines } = require('../../engines');
  const repo = require('../../engines/repository');
  await engines.state.recomputeDaily(userId, rows[0].timestamp, repo);

  return { message: 'Entry deleted.' };
}

/**
 * Full-text search across entries.
 */
async function searchEntries(userId, query, { page = 1, limit = 20 }) {
  const offset = (page - 1) * limit;

  const [entriesResult, countResult] = await Promise.all([
    db.query(
      `SELECT e.*, row_to_json(es.*) AS extracted_state
       FROM entries e
       LEFT JOIN extracted_states es ON es.entry_id = e.id
       WHERE e.user_id = $1 AND e.search_vector @@ plainto_tsquery('english', $2)
       ORDER BY ts_rank(e.search_vector, plainto_tsquery('english', $2)) DESC, e.timestamp DESC
       OFFSET $3 LIMIT $4`,
      [userId, query, offset, limit]
    ),
    db.query(
      `SELECT count(*) AS total FROM entries 
       WHERE user_id = $1 AND search_vector @@ plainto_tsquery('english', $2)`,
      [userId, query]
    ),
  ]);

  const entries = entriesResult.rows.map(toApiEntry);
  const total = parseInt(countResult.rows[0].total);

  return {
    entries,
    meta: { page, limit, total, hasMore: offset + entries.length < total },
  };
}

// ─── Internal helpers ─────────────────────────────────────────────

async function _loadFullEntry(entryId) {
  const { rows } = await db.query(
    `SELECT e.*, row_to_json(es.*) AS extracted_state
     FROM entries e
     LEFT JOIN extracted_states es ON es.entry_id = e.id
     WHERE e.id = $1`,
    [entryId]
  );
  if (rows.length === 0) return null;

  const entry = toApiEntry(rows[0]);

  const { rows: fileRows } = await db.query(
    'SELECT * FROM file_attachments WHERE entry_id = $1',
    [entryId]
  );
  entry.files = fileRows.map(toApiFile);

  return entry;
}

function toApiEntry(row) {
  return {
    id: row.id,
    userId: row.user_id,
    rawText: row.raw_text,
    source: row.source,
    hasFiles: row.has_files,
    timestamp: row.timestamp,
    extractedState: row.extracted_state || null,
    files: row.files || [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toApiFile(row) {
  return {
    id: row.id,
    entryId: row.entry_id,
    fileName: row.file_name,
    fileType: row.file_type,
    fileUrl: row.file_url,
    fileKey: row.file_key,
    fileSize: row.file_size,
    extractedText: row.extracted_text,
    createdAt: row.created_at,
  };
}

module.exports = { createEntry, updateEntry, getEntries, getEntry, deleteEntry, searchEntries };
