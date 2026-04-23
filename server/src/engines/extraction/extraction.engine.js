/**
 * ✦ EXTRACTION ENGINE
 *
 * AI-powered state extraction from normalized IR.
 * This is the core intelligence — takes cleaned text and produces structured state.
 *
 * Pipeline:
 *   IR (from NormalizationEngine) → ExtractionEngine → ExtractedState
 *
 * Capabilities:
 *   - Text extraction (action items, blockers, completions, deadlines, tags, sentiment)
 *   - Image understanding (via GPT-4o Vision API)
 *   - Batch extraction (multiple entries)
 *   - PII stripping before LLM calls
 */

const OpenAI = require('openai');
const BaseEngine = require('../base.engine');

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

class ExtractionEngine extends BaseEngine {
  constructor() {
    super('extraction');
    this.client = null;
    this.model = 'gpt-4o-mini';
    this.visionModel = 'gpt-4o';
  }

  async initialize() {
    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey || apiKey === 'sk-your-openai-api-key') {
      console.warn('  ⚠ ExtractionEngine: No valid OPENAI_API_KEY. Extraction will return empty state.');
      this.client = null;
    } else {
      this.client = new OpenAI({ apiKey });
    }

    await super.initialize();
  }

  /**
   * Extract structured state from an IR object.
   *
   * @param {Object} ir - Internal Representation from NormalizationEngine
   * @returns {Object} ExtractedState
   */
  async extract(ir) {
    this.ensureReady();
    this.trackCall();

    // If no LLM client, return empty state
    if (!this.client) {
      return this._emptyState();
    }

    try {
      // Check if this requires vision processing
      if (ir.metadata && ir.metadata.requiresVision && ir.metadata.fileKey) {
        return await this._extractFromImage(ir);
      }

      return await this._extractFromText(ir.content);
    } catch (err) {
      this.trackError();
      console.error(`✦ Extraction failed:`, err.message);
      return this._emptyState();
    }
  }

  /**
   * Extract state from plain text using LLM.
   */
  async _extractFromText(text) {
    if (!text || text.trim().length === 0) {
      return this._emptyState();
    }

    // Strip PII before sending to LLM
    const sanitized = this._stripPII(text);

    const completion = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        { role: 'system', content: EXTRACTION_SYSTEM_PROMPT },
        { role: 'user', content: sanitized },
      ],
      temperature: 0.1,
      max_tokens: 1000,
      response_format: { type: 'json_object' },
    });

    const content = completion.choices[0].message.content;
    const parsed = JSON.parse(content);

    return this._validateState(parsed);
  }

  /**
   * Extract text and state from an image using Vision API.
   */
  async _extractFromImage(ir) {
    const fileUrl = `${process.env.S3_ENDPOINT}/${process.env.S3_BUCKET}/${ir.metadata.fileKey}`;

    // Step 1: Describe the image
    const visionCompletion = await this.client.chat.completions.create({
      model: this.visionModel,
      messages: [
        { role: 'system', content: VISION_SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'text', text: ir.content || 'Describe this image and extract any actionable information.' },
            { type: 'image_url', image_url: { url: fileUrl, detail: 'auto' } },
          ],
        },
      ],
      max_tokens: 1500,
    });

    const imageDescription = visionCompletion.choices[0].message.content;

    // Step 2: Combine user text + image description, then extract state
    const combinedText = [
      ir.content ? `User note: ${ir.content}` : '',
      `Image content: ${imageDescription}`,
    ].filter(Boolean).join('\n\n');

    return await this._extractFromText(combinedText);
  }

  /**
   * Batch extract state from multiple IR objects.
   */
  async extractBatch(irArray) {
    return Promise.all(irArray.map((ir) => this.extract(ir)));
  }

  /**
   * Strip personally identifiable information before sending to LLM.
   */
  _stripPII(text) {
    let sanitized = text;

    // Remove email addresses
    sanitized = sanitized.replace(/[\w.+-]+@[\w.-]+\.\w{2,}/g, '[EMAIL]');

    // Remove phone numbers (various formats)
    sanitized = sanitized.replace(/(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g, '[PHONE]');

    // Remove credit card numbers
    sanitized = sanitized.replace(/\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g, '[CARD]');

    // Remove SSN patterns
    sanitized = sanitized.replace(/\b\d{3}[-]?\d{2}[-]?\d{4}\b/g, '[SSN]');

    return sanitized;
  }

  /**
   * Validate extracted state structure — ensure all fields exist with correct types.
   */
  _validateState(parsed) {
    return {
      actionItems: Array.isArray(parsed.actionItems)
        ? parsed.actionItems.filter((i) => i && typeof i.text === 'string')
        : [],
      blockers: Array.isArray(parsed.blockers)
        ? parsed.blockers.filter((i) => i && typeof i.text === 'string')
        : [],
      completions: Array.isArray(parsed.completions)
        ? parsed.completions.filter((i) => i && typeof i.text === 'string')
        : [],
      deadlines: Array.isArray(parsed.deadlines)
        ? parsed.deadlines.filter((i) => i && typeof i.task === 'string' && typeof i.date === 'string')
        : [],
      tags: Array.isArray(parsed.tags)
        ? parsed.tags.filter((t) => typeof t === 'string').map((t) => t.toLowerCase())
        : [],
      sentiment: ['focused', 'stressed', 'neutral', 'productive', 'overwhelmed'].includes(parsed.sentiment)
        ? parsed.sentiment
        : 'neutral',
    };
  }

  /**
   * Return empty state — used as fallback when extraction fails or no LLM key.
   */
  _emptyState() {
    return {
      actionItems: [],
      blockers: [],
      completions: [],
      deadlines: [],
      tags: [],
      sentiment: 'neutral',
    };
  }
}

module.exports = ExtractionEngine;
