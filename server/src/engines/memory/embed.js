/**
 * ✦ EMBEDDING PIPELINE
 *
 * Unified embedding layer used by: item matching, semantic memory,
 * recall retrieval, and memory consolidation.
 *
 * Features:
 *   - In-process LRU cache (SHA-256 keyed, 10k entries)
 *   - Batch embedding (up to 100 texts per API call)
 *   - Cost tracking
 *   - Graceful fallback: zero vector when LLM unavailable
 */

'use strict';

const crypto = require('crypto');
const OpenAI = require('openai');

const MODEL        = 'text-embedding-3-small';
const DIMENSIONS   = 1536;
const MAX_CHARS    = 2000;
const BATCH_SIZE   = 100;
const CACHE_MAX    = 10_000;
const COST_PER_1M  = 0.02; // USD, text-embedding-3-small

// ─── LRU cache ────────────────────────────────────────────────────────────────
class EmbedCache {
  constructor(max = CACHE_MAX) {
    this._map = new Map();
    this._max = max;
    this.hits = 0; this.misses = 0;
  }
  _key(text) { return crypto.createHash('sha256').update(text).digest('hex'); }
  get(text)  { const k = this._key(text); const v = this._map.get(k); if (v) { this._map.delete(k); this._map.set(k, v); this.hits++; return v; } this.misses++; return null; }
  set(text, vec) {
    const k = this._key(text);
    if (this._map.size >= this._max) this._map.delete(this._map.keys().next().value);
    this._map.set(k, vec);
  }
  get stats() { const t = this.hits+this.misses; return { hits: this.hits, misses: this.misses, hitRate: t > 0 ? (this.hits/t).toFixed(2) : 0, size: this._map.size }; }
}

const _cache = new EmbedCache();
let   _client = null;
const _costs  = { calls: 0, tokens: 0, usd: 0 };

function _getClient() {
  if (!_client) {
    const key = process.env.OPENAI_API_KEY;
    if (!key || key === 'sk-your-openai-api-key') return null;
    _client = new OpenAI({ apiKey: key });
  }
  return _client;
}

function _zeroVec() { return new Array(DIMENSIONS).fill(0); }

// ─── Single embed ─────────────────────────────────────────────────────────────
async function embed(text) {
  const safe = (text || '').slice(0, MAX_CHARS);
  if (!safe.trim()) return _zeroVec();

  const cached = _cache.get(safe);
  if (cached) return cached;

  const client = _getClient();
  if (!client) return _zeroVec();

  const resp = await client.embeddings.create({ model: MODEL, input: safe });
  const vec  = resp.data[0].embedding;
  const toks = resp.usage.total_tokens;

  _costs.calls++;
  _costs.tokens += toks;
  _costs.usd    += (toks / 1_000_000) * COST_PER_1M;

  _cache.set(safe, vec);
  return vec;
}

// ─── Batch embed (deduplicates + caches) ──────────────────────────────────────
async function embedBatch(texts) {
  const results = new Array(texts.length);
  const toFetch = [];  // { idx, text }

  for (let i = 0; i < texts.length; i++) {
    const safe = (texts[i] || '').slice(0, MAX_CHARS);
    const hit  = _cache.get(safe);
    if (hit) { results[i] = hit; }
    else     { toFetch.push({ idx: i, text: safe }); }
  }

  if (toFetch.length === 0) return results;

  const client = _getClient();
  if (!client) {
    for (const { idx } of toFetch) results[idx] = _zeroVec();
    return results;
  }

  // Batch in groups of BATCH_SIZE
  for (let b = 0; b < toFetch.length; b += BATCH_SIZE) {
    const chunk = toFetch.slice(b, b + BATCH_SIZE);
    const resp  = await client.embeddings.create({ model: MODEL, input: chunk.map(c => c.text) });

    _costs.calls++;
    _costs.tokens += resp.usage.total_tokens;
    _costs.usd    += (resp.usage.total_tokens / 1_000_000) * COST_PER_1M;

    resp.data.forEach((item, i) => {
      const { idx, text } = chunk[i];
      _cache.set(text, item.embedding);
      results[idx] = item.embedding;
    });
  }

  return results;
}

// ─── Cosine similarity ────────────────────────────────────────────────────────
function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i]*b[i]; na += a[i]*a[i]; nb += b[i]*b[i]; }
  return na === 0 || nb === 0 ? 0 : dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function embedStats() {
  return { cache: _cache.stats, costs: { ..._costs } };
}

module.exports = { embed, embedBatch, cosine, embedStats, DIMENSIONS };
