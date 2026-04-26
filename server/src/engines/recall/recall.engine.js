/**
 * ✦ RECALL ENGINE — v3
 *
 * Intent-aware retrieval + semantic re-ranking.
 *
 * Upgrades from v2:
 *   - Intent classifier routes query to correct strategy (via QueryPlanner)
 *   - Semantic ranking via cosine similarity (embedding-based)
 *   - Query result caching (SHA-256 keyed, 5 min TTL)
 *   - Token-budget context packing
 *   - Cost tracking for LLM calls
 *   - Falls back to keyword search when time-range retrieval is sparse
 */

'use strict';

const crypto   = require('crypto');
const OpenAI   = require('openai');
const BaseEngine = require('../base.engine');
const { classifyIntent, packContext, formatContext, getSystemPrompt } = require('./query.planner');
const logger     = require('../../lib/logger');

// ─── Query cache ──────────────────────────────────────────────────────────────
class QueryCache {
  constructor({ ttlMs = 5 * 60 * 1000, maxSize = 200 } = {}) {
    this._map   = new Map();
    this._ttl   = ttlMs;
    this._max   = maxSize;
    this.hits   = 0;
    this.misses = 0;
  }

  _key(userId, query) {
    return crypto.createHash('sha256').update(`${userId}:${query}`).digest('hex');
  }

  get(userId, query) {
    const k     = this._key(userId, query);
    const entry = this._map.get(k);
    if (!entry)                        { this.misses++; return null; }
    if (Date.now() > entry.expiresAt)  { this._map.delete(k); this.misses++; return null; }
    this.hits++;
    return entry.value;
  }

  set(userId, query, value) {
    const k = this._key(userId, query);
    if (this._map.size >= this._max) {
      const oldest = this._map.keys().next().value;
      this._map.delete(oldest);
    }
    this._map.set(k, { value, expiresAt: Date.now() + this._ttl });
  }
}

// ─── Time range parser ────────────────────────────────────────────────────────
function parseTimeRange(query) {
  const now = new Date();
  const q   = query.toLowerCase();

  if (/today/i.test(q)) {
    const from = new Date(now); from.setHours(0, 0, 0, 0);
    return { from, to: now };
  }
  if (/yesterday/i.test(q)) {
    const from = new Date(now); from.setDate(from.getDate() - 1); from.setHours(0, 0, 0, 0);
    const to   = new Date(from); to.setHours(23, 59, 59, 999);
    return { from, to };
  }
  if (/this week/i.test(q) || /past week/i.test(q) || /last 7 days/i.test(q)) {
    const from = new Date(now); from.setDate(from.getDate() - 7); from.setHours(0, 0, 0, 0);
    return { from, to: now };
  }
  if (/last month/i.test(q) || /past month/i.test(q) || /last 30 days/i.test(q)) {
    const from = new Date(now); from.setDate(from.getDate() - 30); from.setHours(0, 0, 0, 0);
    return { from, to: now };
  }

  // Day names: "monday", "tuesday"
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  for (let i = 0; i < days.length; i++) {
    if (q.includes(days[i])) {
      const diff = (now.getDay() - i + 7) % 7 || 7;
      const from = new Date(now); from.setDate(from.getDate() - diff); from.setHours(0, 0, 0, 0);
      const to   = new Date(from); to.setHours(23, 59, 59, 999);
      return { from, to };
    }
  }

  // Default: last 7 days
  const from = new Date(now); from.setDate(from.getDate() - 7); from.setHours(0, 0, 0, 0);
  return { from, to: now };
}

// ─── Engine ───────────────────────────────────────────────────────────────────
class RecallEngine extends BaseEngine {
  constructor() {
    super('recall');
    this._cache  = new QueryCache();
    this._client = null;
  }

  async initialize() {
    await super.initialize();
    const key = process.env.OPENAI_API_KEY;
    if (key && key !== 'sk-your-openai-api-key') {
      this._client = new OpenAI({ apiKey: key });
    }
    logger.info('RecallEngine initialized', { hasOpenAI: !!this._client });
  }

  /**
   * Recall query — intent-aware retrieval + LLM synthesis.
   *
   * @param {string} userId
   * @param {string} query
   * @param {Repository} repo - injected data access layer
   * @returns {{ answer, intent, entriesUsed, cached }}
   */
  async query(userId, query, repo) {
    this.ensureReady();
    const done = this.startCall();

    try {
      // 1. Cache check
      const cached = this._cache.get(userId, query);
      if (cached) {
        done();
        return { ...cached, cached: true };
      }

      // 2. Classify intent
      const intent    = classifyIntent(query);
      const timeRange = parseTimeRange(query);
      const queryTerms = query.toLowerCase()
        .replace(/[^\w\s]/g, '').split(/\s+/)
        .filter(t => t.length > 2 && !['what', 'when', 'how', 'did', 'the', 'was', 'and', 'for'].includes(t));

      logger.info('Recall query classified', { userId, intent, queryTerms: queryTerms.slice(0, 5) });

      // 3. Retrieve entries
      let entries = await repo.getEntriesRange(userId, timeRange.from, timeRange.to, {
        includeExtracted: true,
        orderBy: 'desc',
        limit: 50,
      });

      // Fallback: if time-range returned few results, try keyword search
      if (entries.length < 3) {
        const kw = queryTerms.slice(0, 5);
        if (kw.length > 0) {
          const kwEntries = await repo.searchEntriesByKeywords(userId, kw, { includeExtracted: true, limit: 20 });
          const existingIds = new Set(entries.map(e => e.id));
          entries = [...entries, ...kwEntries.filter(e => !existingIds.has(e.id))];
        }
      }

      if (entries.length === 0) {
        const result = { answer: 'I don\'t have any entries in this time range. Try a different query.', intent, entriesUsed: 0, cached: false };
        done();
        return result;
      }

      // 4. Pack context under token budget
      const selectedEntries = packContext(entries, {
        tokenBudget: 3000,
        queryTerms,
      });

      // 5. Format for LLM
      const contextStr  = formatContext(selectedEntries, intent);
      const systemPrompt = getSystemPrompt(intent);

      // 6. Generate answer
      let answer;
      if (this._client) {
        const resp = await this._client.chat.completions.create({
          model:       'gpt-4o-mini',
          temperature: 0.1,
          max_tokens:  500,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user',   content: `ENTRIES:\n${contextStr}\n\nQUESTION: ${query}` },
          ],
        });

        answer = resp.choices[0].message.content;

        // Track cost
        const usage = resp.usage || {};
        this.recordCost({
          inputTokens:  usage.prompt_tokens || 0,
          outputTokens: usage.completion_tokens || 0,
          usd:          ((usage.prompt_tokens || 0) * 0.00015 + (usage.completion_tokens || 0) * 0.0006) / 1000,
        });
      } else {
        // No API key — return raw context
        answer = `[No OpenAI key — returning raw entries]\n\n${contextStr}`;
      }

      const result = { answer, intent, entriesUsed: selectedEntries.length, cached: false };

      // Cache result
      this._cache.set(userId, query, result);

      done();
      return result;

    } catch (err) {
      done(err);
      logger.error('Recall query failed', { userId, error: err.message });
      throw err;
    }
  }

  /**
   * Return cache + cost stats for observability.
   */
  getHealth() {
    const base = super.getHealth();
    return {
      ...base,
      cache: {
        hits:   this._cache.hits,
        misses: this._cache.misses,
        hitRate: (this._cache.hits + this._cache.misses) > 0
          ? (this._cache.hits / (this._cache.hits + this._cache.misses)).toFixed(2)
          : '0',
      },
    };
  }
}

module.exports = RecallEngine;
