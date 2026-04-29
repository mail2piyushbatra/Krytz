/**
 * âœ¦ SECURITY UTILS
 * Fixes three Doc 7 subtle bugs:
 *   (1) ReDoS risk in MATCH operator â€” safeRegex() with length + complexity + catastrophic pattern check
 *   (2) Dedupe key collision â€” buildDedupeKey() uses SHA-256(ruleId:itemId:timeWindow)
 *   (3) Embedding cache unbounded in multi-instance â€” RedisEmbedCache (L1 in-process + L2 Redis)
 */
'use strict';

const crypto = require('crypto');

// â”€â”€â”€ (1) Safe regex â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const MAX_REGEX_LENGTH     = 100;
const MAX_REGEX_COMPLEXITY = 10;

function _complexityScore(pattern) {
  return (pattern.match(/[*+?]|\{[^}]+\}|\|/g) || []).length;
}

function safeRegex(pattern, flags = 'i') {
  if (typeof pattern !== 'string') return { ok: false, error: 'Pattern must be a string' };
  if (pattern.length > MAX_REGEX_LENGTH) return { ok: false, error: `Regex too long (max ${MAX_REGEX_LENGTH} chars)` };
  if (_complexityScore(pattern) > MAX_REGEX_COMPLEXITY) return { ok: false, error: `Regex too complex (max ${MAX_REGEX_COMPLEXITY} quantifiers/alternations)` };

  const catastrophic = [/\(\?:.*\*\)\+/, /\(\.\*\)\+/, /\([^)]*\+[^)]*\)+/];
  for (const cp of catastrophic) {
    if (cp.test(pattern)) return { ok: false, error: 'Potentially catastrophic regex pattern rejected' };
  }

  try { return { ok: true, regex: new RegExp(pattern, flags) }; }
  catch (e) { return { ok: false, error: `Invalid regex: ${e.message}` }; }
}

function safeRegexTest(pattern, input) {
  const { ok, regex, error } = safeRegex(pattern);
  if (!ok) return { matched: false, error };
  return { matched: regex.test((input || '').slice(0, 500)) };
}

// â”€â”€â”€ (2) Dedupe key builder â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function buildDedupeKey(ruleId, itemId, windowMs = 24 * 60 * 60 * 1000) {
  const timeWindow = Math.floor(Date.now() / windowMs);
  return crypto.createHash('sha256').update(`${ruleId}:${itemId}:${timeWindow}`).digest('hex').slice(0, 32);
}

// â”€â”€â”€ (3) Redis-backed embed cache â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
class RedisEmbedCache {
  constructor(redis, { ttlSeconds = 86_400, prefix = 'Krytz:embed:' } = {}) {
    this._redis    = redis;
    this._ttl      = ttlSeconds;
    this._prefix   = prefix;
    this._local    = new Map();
    this._localMax = 1000;
    this.hits = 0; this.misses = 0;
  }

  _key(text) { return this._prefix + crypto.createHash('sha256').update(text).digest('hex'); }

  async get(text) {
    const key   = this._key(text);
    const local = this._local.get(key);
    if (local) { this.hits++; return local; }
    try {
      const raw = await this._redis.get(key);
      if (raw) { const vec = JSON.parse(raw); this._setLocal(key, vec); this.hits++; return vec; }
    } catch (_) {}
    this.misses++;
    return null;
  }

  async set(text, vec) {
    const key = this._key(text);
    this._setLocal(key, vec);
    try { await this._redis.set(key, JSON.stringify(vec), 'EX', this._ttl); } catch (_) {}
  }

  _setLocal(key, vec) {
    if (this._local.size >= this._localMax) this._local.delete(this._local.keys().next().value);
    this._local.set(key, vec);
  }

  get stats() {
    const t = this.hits + this.misses;
    return { hits: this.hits, misses: this.misses, hitRate: t > 0 ? (this.hits/t).toFixed(2) : 0, localSize: this._local.size, backend: 'redis' };
  }
}

module.exports = { safeRegex, safeRegexTest, buildDedupeKey, RedisEmbedCache };
