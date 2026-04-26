/**
 * ✦ FLOWRA REPOSITORY — v2
 *
 * Decouples all engines from Prisma.
 * Engines depend on this interface — NEVER on Prisma directly.
 *
 * Implementations:
 *   PrismaRepository   — production (PostgreSQL via Prisma ORM)
 *   InMemoryRepository — tests / local dev without DB
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

const prisma = require('../lib/prisma');

// ─── PrismaRepository (production) ───────────────────────────────────────────
class PrismaRepository {

  // ── Entry ─────────────────────────────────────────────────────────────────

  async findEntry(entryId) {
    return prisma.entry.findUnique({
      where:   { id: entryId },
      include: { extractedState: true },
    });
  }

  async upsertExtractedState(entryId, state) {
    // Strip internal fields before persisting
    const { confidence, _local, ...clean } = state;
    return prisma.extractedState.upsert({
      where:  { entryId },
      update: { ...clean, processedAt: new Date() },
      create: { entryId, ...clean },
    });
  }

  /**
   * Get entries for a specific day (dayStart → dayEnd).
   * Used by StateEngine.recomputeDaily.
   */
  async getEntriesForDay(userId, dayStart, dayEnd, opts = {}) {
    return prisma.entry.findMany({
      where: {
        userId,
        timestamp: { gte: dayStart, lte: dayEnd },
      },
      include:  opts.includeExtracted !== false ? { extractedState: true } : undefined,
      orderBy:  { timestamp: opts.orderBy === 'asc' ? 'asc' : 'desc' },
    });
  }

  /**
   * Get entries in a time range with optional extracted state.
   * Used by RecallEngine and StateEngine.
   */
  async getEntriesRange(userId, from, to, opts = {}) {
    return prisma.entry.findMany({
      where: {
        userId,
        timestamp: { gte: from, lte: to },
      },
      include:  opts.includeExtracted ? { extractedState: true } : undefined,
      orderBy:  { timestamp: opts.orderBy === 'asc' ? 'asc' : 'desc' },
      take:     opts.limit || 200,
    });
  }

  /**
   * Keyword search entries (case-insensitive LIKE).
   * Used by RecallEngine when time-range retrieval returns sparse results.
   */
  async searchEntriesByKeywords(userId, keywords, opts = {}) {
    if (!keywords || keywords.length === 0) return [];
    return prisma.entry.findMany({
      where: {
        userId,
        OR: keywords.map(kw => ({ rawText: { contains: kw, mode: 'insensitive' } })),
      },
      include:  opts.includeExtracted ? { extractedState: true } : undefined,
      orderBy:  { timestamp: 'desc' },
      take:     opts.limit || 20,
    });
  }

  // ── Daily state ────────────────────────────────────────────────────────────

  async getDailyState(userId, date) {
    return prisma.dailyState.findUnique({
      where: { userId_date: { userId, date } },
    });
  }

  async upsertDailyState(userId, date, data) {
    return prisma.dailyState.upsert({
      where:  { userId_date: { userId, date } },
      update: { ...data, computedAt: new Date() },
      create: { userId, date, ...data },
    });
  }

  async getDailyStatesRange(userId, from, to) {
    return prisma.dailyState.findMany({
      where:   { userId, date: { gte: from, lte: to || new Date() } },
      orderBy: { date: 'asc' },
    });
  }

  // ── Entry count ───────────────────────────────────────────────────────────

  async countEntries(userId) {
    return prisma.entry.count({ where: { userId } });
  }
}

// ─── InMemoryRepository (tests / local dev without DB) ───────────────────────
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

  // ── Test helpers ──────────────────────────────────────────────────────────

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

// Default singleton — production use
const defaultRepository = new PrismaRepository();

module.exports = defaultRepository;
module.exports.PrismaRepository   = PrismaRepository;
module.exports.InMemoryRepository = InMemoryRepository;
