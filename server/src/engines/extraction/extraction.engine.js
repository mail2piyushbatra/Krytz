/**
 * ✦ EXTRACTION ENGINE — v2
 *
 * AI-powered state extraction from normalized IR.
 *
 * Upgrades from v1:
 *   - Fixed Vision URL bug — images proxied through signed URL, never localhost
 *   - Added extraction cache (hash-based, TTL-aware) — same text never hits LLM twice
 *   - Added local fast-path: regex pre-scan for obvious items before LLM call
 *   - Replaced console.* with structured logger
 *   - Added token estimation + cost tracking
 *   - Confidence scoring on extracted state
 *   - Graceful degradation: local extraction if LLM unavailable
 */

'use strict';

const crypto     = require('crypto');
const OpenAI     = require('openai');
const BaseEngine = require('../base.engine');
const logger     = require('../../lib/logger');

// ─── Prompts ──────────────────────────────────────────────────────────────────
const EXTRACTION_SYSTEM_PROMPT = `You are a state extraction engine for Flowra, a personal tracking app.
Given a user's text, extract structured state information.

Return ONLY valid JSON with this exact schema:
{
  "actionItems": [{"text": "concise description", "dueDate": "YYYY-MM-DD or null"}],
  "blockers": [{"text": "what's blocking", "since": "YYYY-MM-DD or null"}],
  "completions": [{"text": "what was finished"}],
  "deadlines": [{"task": "task name", "date": "YYYY-MM-DD"}],
  "tags": ["lowercase-tag"],
  "sentiment": "focused|stressed|neutral|productive|overwhelmed"
}

Rules:
- Extract ONLY what is explicitly stated or strongly implied
- NEVER hallucinate tasks, deadlines, or information not in the text
- Keep each item under 15 words
- Tags: lowercase, use project names or categories
- If nothing extractable, return empty arrays
- Sentiment: infer from tone. Default to "neutral" if unclear`;

const VISION_SYSTEM_PROMPT = `You are analyzing an image captured by a user in their personal tracking app Flowra.
Describe what you see and extract any actionable information.
Focus on: text in the image, diagrams, whiteboard content, screenshots of tasks, etc.
Return a plain text description that can be further processed for action items.`;

// ─── Local fast-path patterns ─────────────────────────────────────────────────
// Catches obvious items instantly without an LLM call.
// Results are merged with LLM output (LLM takes precedence on overlap).
const LOCAL_PATTERNS = {
  actionItems: [
    /(?:todo|to-do|to do|need to|must|should|will)\s*:?\s*(.{5,80})/gi,
    /(?:^|\n)\s*[-*•]\s*(?!\[x\])(.{5,80})/g,  // unchecked bullet points
  ],
  completions: [
    /(?:done|finished|completed|shipped|merged|deployed)\s*:?\s*(.{5,80})/gi,
    /(?:^|\n)\s*\[x\]\s*(.{5,80})/g, // checked markdown boxes
  ],
  blockers: [
    /(?:blocker|blocked|blocking|waiting on|stuck on|can't|cannot)\s*:?\s*(.{5,80})/gi,
  ],
  deadlines: [
    /(?:due|deadline|by)\s+(?:on\s+)?(\w+\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s*\d{4})?|\d{4}-\d{2}-\d{2})/gi,
  ],
};

function localExtract(text) {
  const state = { actionItems: [], blockers: [], completions: [], deadlines: [], tags: [], sentiment: null };

  for (const pattern of LOCAL_PATTERNS.actionItems) {
    for (const m of text.matchAll(pattern)) {
      const t = m[1].trim();
      if (t.length > 4 && !state.actionItems.find(i => i.text === t)) {
        state.actionItems.push({ text: t, dueDate: null, _local: true });
      }
    }
  }
  for (const pattern of LOCAL_PATTERNS.completions) {
    for (const m of text.matchAll(pattern)) {
      const t = m[1].trim();
      if (t.length > 4 && !state.completions.find(i => i.text === t)) {
        state.completions.push({ text: t, _local: true });
      }
    }
  }
  for (const pattern of LOCAL_PATTERNS.blockers) {
    for (const m of text.matchAll(pattern)) {
      const t = m[1].trim();
      if (t.length > 4 && !state.blockers.find(i => i.text === t)) {
        state.blockers.push({ text: t, since: null, _local: true });
      }
    }
  }

  return state;
}

// ─── Extraction cache (hash-keyed, TTL-aware) ─────────────────────────────────
class ExtractionCache {
  constructor({ ttlMs = 24 * 60 * 60 * 1000, maxSize = 2000 } = {}) {
    this._store  = new Map();
    this._ttlMs  = ttlMs;
    this._max    = maxSize;
    this.hits    = 0;
    this.misses  = 0;
  }

  _key(text) {
    return crypto.createHash('sha256').update(text).digest('hex');
  }

  get(text) {
    const key   = this._key(text);
    const entry = this._store.get(key);
    if (!entry) { this.misses++; return null; }
    if (Date.now() - entry.cachedAt > this._ttlMs) {
      this._store.delete(key);
      this.misses++;
      return null;
    }
    this.hits++;
    return entry.value;
  }

  set(text, value) {
    if (this._store.size >= this._max) {
      // evict oldest
      const oldest = this._store.keys().next().value;
      this._store.delete(oldest);
    }
    this._store.set(this._key(text), { value, cachedAt: Date.now() });
  }

  get stats() {
    const total = this.hits + this.misses;
    return {
      hits:    this.hits,
      misses:  this.misses,
      hitRate: total > 0 ? (this.hits / total).toFixed(2) : 0,
      size:    this._store.size,
    };
  }
}

// ─── Token estimator (rough: 1 token ≈ 4 chars) ──────────────────────────────
function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}

// ─── ExtractionEngine ─────────────────────────────────────────────────────────
class ExtractionEngine extends BaseEngine {
  constructor({ getSignedUrl } = {}) {
    super('extraction');
    this.client       = null;
    this.model        = 'gpt-4o-mini';
    this.visionModel  = 'gpt-4o';
    this._cache       = new ExtractionCache();
    this._costs       = { inputTokens: 0, outputTokens: 0, calls: 0 };

    // Injected function: (fileKey) => Promise<string signedUrl>
    // Fixes the localhost/MinIO bug — images are served via signed URL
    // that OpenAI can actually reach (not internal MinIO addresses).
    this._getSignedUrl = getSignedUrl || null;
  }

  async initialize() {
    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey || apiKey === 'sk-your-openai-api-key') {
      logger.warn('ExtractionEngine: No valid OPENAI_API_KEY. LLM extraction disabled — local fast-path only.');
      this.client = null;
    } else {
      this.client = new OpenAI({ apiKey });
      logger.info('ExtractionEngine ready', { mode: 'LLM + local fast-path' });
    }

    if (!this._getSignedUrl) {
      logger.warn('ExtractionEngine: No getSignedUrl injected — image/Vision extraction disabled.');
    }

    await super.initialize();
  }

  /**
   * Inject signed URL function after initialization.
   * Called from engines/index.js after S3 client is ready.
   */
  setSignedUrlFn(fn) {
    this._getSignedUrl = fn;
  }

  // ─── Main extract ──────────────────────────────────────────────────────────

  async extract(ir) {
    this.ensureReady();
    const done = this.startCall();

    try {
      let result;
      if (ir.metadata?.requiresVision && ir.metadata?.fileKey) {
        result = await this._extractFromImage(ir);
      } else {
        result = await this._extractFromText(ir.content, ir.metadata);
      }
      done();
      return result;
    } catch (err) {
      done(err);
      logger.error('Extraction failed', { error: err.message });
      return this._emptyState();
    }
  }

  async extractBatch(irArray) {
    return Promise.all(irArray.map(ir => this.extract(ir)));
  }

  // ─── Text extraction ───────────────────────────────────────────────────────

  async _extractFromText(text, metadata = {}) {
    if (!text || text.trim().length < 5) return this._emptyState();

    const sanitized = this._stripPII(text);

    // 1. Always run local fast-path first (free, instant)
    const localState = localExtract(sanitized);
    const hasLocalHits = localState.actionItems.length > 0 ||
                         localState.completions.length  > 0 ||
                         localState.blockers.length     > 0;

    // 2. Check cache before hitting LLM
    const cached = this._cache.get(sanitized);
    if (cached) {
      logger.info('Extraction cache hit', { stats: this._cache.stats });
      return cached;
    }

    // 3. If no LLM, return local results (still useful for obvious cases)
    if (!this.client) {
      const fallback = this._mergeLocalWithLLM(localState, null);
      fallback.confidence = hasLocalHits ? 'local' : 'none';
      // Cache local result too — same input never re-scanned
      this._cache.set(sanitized, fallback);
      return fallback;
    }

    // 4. LLM extraction
    const inputTokens = estimateTokens(sanitized);
    this._costs.inputTokens += inputTokens;
    this._costs.calls++;

    const completion = await this.client.chat.completions.create({
      model:           this.model,
      messages: [
        { role: 'system', content: EXTRACTION_SYSTEM_PROMPT },
        { role: 'user',   content: sanitized },
      ],
      temperature:     0.1,
      max_tokens:      1000,
      response_format: { type: 'json_object' },
    });

    const raw      = completion.choices[0].message.content;
    const parsed   = JSON.parse(raw);
    const llmState = this._validateState(parsed);

    this._costs.outputTokens += estimateTokens(raw);

    // 5. Merge local + LLM (LLM wins on overlap, local fills gaps)
    const merged = this._mergeLocalWithLLM(localState, llmState);
    merged.confidence = 'llm';

    // 6. Cache result
    this._cache.set(sanitized, merged);

    logger.info('Text extracted', {
      actionItems: merged.actionItems.length,
      confidence:  merged.confidence,
      inputTokens,
    });

    return merged;
  }

  // ─── Image extraction (Vision API) ────────────────────────────────────────

  async _extractFromImage(ir) {
    if (!this._getSignedUrl) {
      logger.warn('Image extraction skipped — no getSignedUrl injected');
      return this._emptyState();
    }
    if (!this.client) {
      logger.warn('Image extraction skipped — no LLM client');
      return this._emptyState();
    }

    // Get a publicly accessible signed URL (never localhost — fixes MinIO bug)
    const signedUrl = await this._getSignedUrl(ir.metadata.fileKey);

    logger.info('Running Vision extraction', { fileKey: ir.metadata.fileKey });

    const visionCompletion = await this.client.chat.completions.create({
      model: this.visionModel,
      messages: [
        { role: 'system', content: VISION_SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'text',      text: ir.content || 'Describe this image and extract any actionable information.' },
            { type: 'image_url', image_url: { url: signedUrl, detail: 'auto' } },
          ],
        },
      ],
      max_tokens: 1500,
    });

    const imageDescription = visionCompletion.choices[0].message.content;
    this._costs.calls++;
    this._costs.outputTokens += estimateTokens(imageDescription);

    const combinedText = [
      ir.content ? `User note: ${ir.content}` : '',
      `Image content: ${imageDescription}`,
    ].filter(Boolean).join('\n\n');

    return await this._extractFromText(combinedText, ir.metadata);
  }

  // ─── Merge local + LLM results ─────────────────────────────────────────────
  // LLM items take precedence. Local items fill in anything LLM missed.

  _mergeLocalWithLLM(local, llm) {
    if (!llm) {
      return {
        actionItems:  local.actionItems.map(({ _local, ...i }) => i),
        blockers:     local.blockers.map(({ _local, ...i }) => i),
        completions:  local.completions.map(({ _local, ...i }) => i),
        deadlines:    [],
        tags:         [],
        sentiment:    'neutral',
      };
    }

    const dedup = (llmArr, localArr, key = 'text') => {
      const texts  = new Set(llmArr.map(i => i[key]?.toLowerCase()));
      const extras = localArr
        .filter(i => !texts.has(i[key]?.toLowerCase()))
        .map(({ _local, ...rest }) => rest);
      return [...llmArr, ...extras];
    };

    return {
      actionItems: dedup(llm.actionItems, local.actionItems),
      blockers:    dedup(llm.blockers,    local.blockers),
      completions: dedup(llm.completions, local.completions),
      deadlines:   llm.deadlines,
      tags:        llm.tags,
      sentiment:   llm.sentiment,
    };
  }

  // ─── PII stripping ─────────────────────────────────────────────────────────

  _stripPII(text) {
    return text
      .replace(/[\w.+-]+@[\w.-]+\.\w{2,}/g,                          '[EMAIL]')
      .replace(/(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g, '[PHONE]')
      .replace(/\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g,       '[CARD]')
      .replace(/\b\d{3}[-]?\d{2}[-]?\d{4}\b/g,                       '[SSN]');
  }

  // ─── Validation ────────────────────────────────────────────────────────────

  _validateState(parsed) {
    return {
      actionItems: Array.isArray(parsed.actionItems)
        ? parsed.actionItems.filter(i => i && typeof i.text === 'string')
        : [],
      blockers: Array.isArray(parsed.blockers)
        ? parsed.blockers.filter(i => i && typeof i.text === 'string')
        : [],
      completions: Array.isArray(parsed.completions)
        ? parsed.completions.filter(i => i && typeof i.text === 'string')
        : [],
      deadlines: Array.isArray(parsed.deadlines)
        ? parsed.deadlines.filter(i => i && typeof i.task === 'string' && typeof i.date === 'string')
        : [],
      tags: Array.isArray(parsed.tags)
        ? parsed.tags.filter(t => typeof t === 'string').map(t => t.toLowerCase())
        : [],
      sentiment: ['focused', 'stressed', 'neutral', 'productive', 'overwhelmed'].includes(parsed.sentiment)
        ? parsed.sentiment
        : 'neutral',
    };
  }

  _emptyState() {
    return { actionItems: [], blockers: [], completions: [], deadlines: [], tags: [], sentiment: 'neutral', confidence: 'none' };
  }

  // ─── Observability ─────────────────────────────────────────────────────────

  getHealth() {
    return {
      ...super.getHealth(),
      cache:          this._cache.stats,
      costs:          { ...this._costs },
      hasLLM:         !!this.client,
      hasSignedUrlFn: !!this._getSignedUrl,
    };
  }
}

module.exports = ExtractionEngine;
