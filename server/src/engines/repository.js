/**
 * âœ¦ Krytz REPOSITORY â€” v3
 *
 * Decouples all engines from the database driver.
 * Engines depend on this interface â€” NEVER on pg or SQL directly.
 *
 * Implementations:
 *   PgRepository       â€” production (PostgreSQL via pg Pool)
 *   InMemoryRepository â€” tests / local dev without DB
 *
 * Interface methods required by engines:
 *
 *   CortexEngine:
 *     findEntry(entryId)
 *     upsertExtractedState(entryId, state)
 *
 *   StateEngine:
 *     getEntriesForDay(userId, start, end, opts?)
 *     upsertDailyState(userId, date, data)
 *     getDailyState(userId, date)
 *     getDailyStatesRange(userId, start, end)
 *     getEntriesRange(userId, from, to, opts?)
 *
 *   RecallEngine:
 *     getEntriesRange(userId, from, to, opts?)
 *     searchEntriesByKeywords(userId, keywords, opts?)
 */

'use strict';

const db = require('../lib/db');

// â”€â”€â”€ PgRepository (production) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
class PgRepository {

  // â”€â”€ Entry â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  async findEntry(entryId) {
    const { rows } = await db.query(
      `SELECT e.*, row_to_json(es.*) AS extracted_state
       FROM entries e
       LEFT JOIN extracted_states es ON es.entry_id = e.id
       WHERE e.id = $1`,
      [entryId]
    );
    if (rows.length === 0) return null;
    return this._mapEntry(rows[0]);
  }

  async upsertExtractedState(entryId, state) {
    // Strip internal fields before persisting
    const { confidence, _local, ...clean } = state;
    const json = {
      actionItems: clean.actionItems || [],
      blockers:    clean.blockers || [],
      completions: clean.completions || [],
      deadlines:   clean.deadlines || [],
      tags:        clean.tags || [],
      sentiment:   clean.sentiment || null,
    };

    const { rows } = await db.query(
      `INSERT INTO extracted_states(entry_id, action_items, blockers, completions, deadlines, tags, sentiment, processed_at)
       VALUES($1, $2, $3, $4, $5, $6, $7, now())
       ON CONFLICT (entry_id) DO UPDATE SET
         action_items = $2, blockers = $3, completions = $4,
         deadlines = $5, tags = $6, sentiment = $7, processed_at = now()
       RETURNING *`,
      [entryId, JSON.stringify(json.actionItems), JSON.stringify(json.blockers),
       JSON.stringify(json.completions), JSON.stringify(json.deadlines),
       JSON.stringify(json.tags), json.sentiment]
    );
    return rows[0];
  }

  /**
   * Get entries for a specific day (dayStart â†’ dayEnd).
   * Used by StateEngine.recomputeDaily.
   */
  async getEntriesForDay(userId, dayStart, dayEnd, opts = {}) {
    const order = opts.orderBy === 'asc' ? 'ASC' : 'DESC';
    const { rows } = await db.query(
      `SELECT e.*, row_to_json(es.*) AS extracted_state
       FROM entries e
       LEFT JOIN extracted_states es ON es.entry_id = e.id
       WHERE e.user_id = $1 AND e.timestamp >= $2 AND e.timestamp <= $3
       ORDER BY e.timestamp ${order}`,
      [userId, dayStart, dayEnd]
    );
    return rows.map(r => this._mapEntry(r));
  }

  /**
   * Get entries in a time range with optional extracted state.
   * Used by RecallEngine and StateEngine.
   */
  async getEntriesRange(userId, from, to, opts = {}) {
    const order = opts.orderBy === 'asc' ? 'ASC' : 'DESC';
    const limit = opts.limit || 200;
    const { rows } = await db.query(
      `SELECT e.*, row_to_json(es.*) AS extracted_state
       FROM entries e
       LEFT JOIN extracted_states es ON es.entry_id = e.id
       WHERE e.user_id = $1 AND e.timestamp >= $2 AND e.timestamp <= $3
       ORDER BY e.timestamp ${order}
       LIMIT $4`,
      [userId, from, to, limit]
    );
    return rows.map(r => this._mapEntry(r));
  }

  /**
   * Keyword search entries (case-insensitive ILIKE).
   * Used by RecallEngine when time-range retrieval returns sparse results.
   */
  async searchEntriesByKeywords(userId, keywords, opts = {}) {
    if (!keywords || keywords.length === 0) return [];
    const limit = opts.limit || 20;
    const kwConditions = keywords.map((_, i) => `e.raw_text ILIKE $${i + 2}`);
    const params = [userId, ...keywords.map(kw => `%${kw}%`)];

    const { rows } = await db.query(
      `SELECT e.*, row_to_json(es.*) AS extracted_state
       FROM entries e
       LEFT JOIN extracted_states es ON es.entry_id = e.id
       WHERE e.user_id = $1 AND (${kwConditions.join(' OR ')})
       ORDER BY e.timestamp DESC
       LIMIT $${params.length + 1}`,
      [...params, limit]
    );
    return rows.map(r => this._mapEntry(r));
  }

  // â”€â”€ Daily state â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  async getDailyState(userId, date) {
    const { rows } = await db.query(
      'SELECT * FROM daily_states WHERE user_id = $1 AND date = $2',
      [userId, date]
    );
    if (rows.length === 0) return null;
    return this._mapDailyState(rows[0]);
  }

  async upsertDailyState(userId, date, data) {
    const { rows } = await db.query(
      `INSERT INTO daily_states(user_id, date, open_items, blocker_count, completed_count, deadlines, summary, computed_at)
       VALUES($1, $2, $3, $4, $5, $6, $7, now())
       ON CONFLICT (user_id, date) DO UPDATE SET
         open_items = $3, blocker_count = $4, completed_count = $5,
         deadlines = $6, summary = $7, computed_at = now()
       RETURNING *`,
      [userId, date, data.openItems || 0, data.blockerCount || 0,
       data.completedCount || 0, JSON.stringify(data.deadlines || []), data.summary || null]
    );
    return this._mapDailyState(rows[0]);
  }

  async getDailyStatesRange(userId, from, to) {
    const { rows } = await db.query(
      `SELECT * FROM daily_states
       WHERE user_id = $1 AND date >= $2 AND date <= $3
       ORDER BY date ASC`,
      [userId, from, to || new Date()]
    );
    return rows.map(r => this._mapDailyState(r));
  }

  // â”€â”€ Entry count â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  async countEntries(userId) {
    const { rows } = await db.query(
      'SELECT count(*) AS n FROM entries WHERE user_id = $1', [userId]
    );
    return parseInt(rows[0].n);
  }

  // â”€â”€ Mappers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  _mapEntry(row) {
    const es = row.extracted_state;
    return {
      id:        row.id,
      userId:    row.user_id,
      rawText:   row.raw_text,
      source:    row.source,
      hasFiles:  row.has_files,
      timestamp: row.timestamp,
      project:   row.project || null,
      extractedState: es ? {
        id:          es.id,
        entryId:     es.entry_id,
        actionItems: _parseJson(es.action_items, []),
        blockers:    _parseJson(es.blockers, []),
        completions: _parseJson(es.completions, []),
        deadlines:   _parseJson(es.deadlines, []),
        tags:        _parseJson(es.tags, []),
        sentiment:   es.sentiment,
        processedAt: es.processed_at,
      } : null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  _mapDailyState(row) {
    return {
      id:             row.id,
      userId:         row.user_id,
      date:           row.date,
      openItems:      row.open_items,
      blockerCount:   row.blocker_count,
      completedCount: row.completed_count,
      deadlines:      _parseJson(row.deadlines, []),
      summary:        row.summary,
      byProject:      _parseJson(row.by_project, {}),
      computedAt:     row.computed_at,
    };
  }
}

function _parseJson(val, fallback) {
  if (val === null || val === undefined) return fallback;
  if (typeof val === 'object') return val; // already parsed
  try { return JSON.parse(val); } catch { return fallback; }
}

// â”€â”€â”€ InMemoryRepository (tests / local dev without DB) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
class InMemoryRepository {
  constructor() {
    this._entries         = new Map();
    this._extractedStates = new Map();
    this._dailyStates     = new Map();
  }

  async findEntry(id) {
    const entry = this._entries.get(id) || null;
    if (!entry) return null;
    return {
      ...entry,
      extractedState: this._extractedStates.get(id) || null,
    };
  }

  async upsertExtractedState(entryId, state) {
    const { confidence, _local, ...clean } = state;
    const record = { entryId, ...clean, processedAt: new Date() };
    this._extractedStates.set(entryId, record);
    return record;
  }

  async getEntriesForDay(userId, start, end, opts = {}) {
    return [...this._entries.values()]
      .filter(e =>
        e.userId === userId &&
        new Date(e.timestamp) >= start &&
        new Date(e.timestamp) <= end
      )
      .map(e => ({
        ...e,
        extractedState: opts.includeExtracted !== false
          ? (this._extractedStates.get(e.id) || null)
          : undefined,
      }));
  }

  async getEntriesRange(userId, from, to, opts = {}) {
    return [...this._entries.values()]
      .filter(e =>
        e.userId === userId &&
        new Date(e.timestamp) >= from &&
        new Date(e.timestamp) <= to
      )
      .slice(0, opts.limit || 200)
      .map(e => ({
        ...e,
        extractedState: opts.includeExtracted
          ? (this._extractedStates.get(e.id) || null)
          : undefined,
      }));
  }

  async searchEntriesByKeywords(userId, keywords, opts = {}) {
    if (!keywords || keywords.length === 0) return [];
    return [...this._entries.values()]
      .filter(e =>
        e.userId === userId &&
        keywords.some(kw => e.rawText?.toLowerCase().includes(kw.toLowerCase()))
      )
      .slice(0, opts.limit || 20)
      .map(e => ({
        ...e,
        extractedState: opts.includeExtracted
          ? (this._extractedStates.get(e.id) || null)
          : undefined,
      }));
  }

  async getDailyState(userId, date) {
    return this._dailyStates.get(`${userId}:${date.toISOString().split('T')[0]}`) || null;
  }

  async upsertDailyState(userId, date, data) {
    const key    = `${userId}:${date.toISOString().split('T')[0]}`;
    const record = { userId, date, ...data };
    this._dailyStates.set(key, record);
    return record;
  }

  async getDailyStatesRange(userId, from, to) {
    const end = to || new Date();
    return [...this._dailyStates.values()]
      .filter(d =>
        d.userId === userId &&
        new Date(d.date) >= from &&
        new Date(d.date) <= end
      )
      .sort((a, b) => new Date(a.date) - new Date(b.date));
  }

  async countEntries(userId) {
    return [...this._entries.values()].filter(e => e.userId === userId).length;
  }

  // â”€â”€ Test helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  _seedEntry(entry) {
    this._entries.set(entry.id, {
      timestamp: new Date(),
      source:    'manual',
      ...entry,
    });
    return this;
  }

  _seedExtractedState(entryId, state) {
    this._extractedStates.set(entryId, { entryId, processedAt: new Date(), ...state });
    return this;
  }

  _clear() {
    this._entries.clear();
    this._extractedStates.clear();
    this._dailyStates.clear();
    return this;
  }
}

// Default singleton â€” production use
const defaultRepository = new PgRepository();

module.exports = defaultRepository;
module.exports.PgRepository       = PgRepository;
module.exports.InMemoryRepository = InMemoryRepository;
