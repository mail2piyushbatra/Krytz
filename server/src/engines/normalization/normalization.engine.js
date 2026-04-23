/**
 * ✦ NORMALIZATION ENGINE
 *
 * Transforms any raw input into Flowra's Internal Representation (IR).
 * This is the first stage in the pipeline — before Cortex, before extraction.
 *
 * Pipeline:
 *   Raw Input → NormalizationEngine → IR → ExtractionEngine → State
 *
 * IR Schema:
 *   {
 *     type: 'text' | 'image' | 'pdf' | 'calendar_event' | 'email' | 'task',
 *     content: string,           // normalized text content
 *     metadata: {
 *       source: string,          // 'manual' | 'calendar' | 'gmail' | 'notion'
 *       timestamp: Date,
 *       originalFormat: string,  // original MIME type or format
 *       fileKey: string | null,  // S3 key if file-based
 *       charCount: number,
 *     }
 *   }
 */

const BaseEngine = require('../base.engine');

class NormalizationEngine extends BaseEngine {
  constructor() {
    super('normalization');

    // Normalizer registry: maps input types to normalizer functions
    this.normalizers = new Map();
  }

  async initialize() {
    // Register built-in normalizers
    this.registerNormalizer('text', this._normalizeText.bind(this));
    this.registerNormalizer('image/jpeg', this._normalizeImage.bind(this));
    this.registerNormalizer('image/png', this._normalizeImage.bind(this));
    this.registerNormalizer('image/webp', this._normalizeImage.bind(this));
    this.registerNormalizer('application/pdf', this._normalizePDF.bind(this));
    this.registerNormalizer('calendar_event', this._normalizeCalendarEvent.bind(this));
    this.registerNormalizer('email', this._normalizeEmail.bind(this));
    this.registerNormalizer('notion_task', this._normalizeNotionTask.bind(this));

    await super.initialize();
  }

  /**
   * Register a normalizer function for a given input type.
   */
  registerNormalizer(type, normalizerFn) {
    this.normalizers.set(type, normalizerFn);
  }

  /**
   * Normalize raw input into Internal Representation (IR).
   *
   * @param {Object} input - Raw input
   * @param {string} input.type - Input type (text, image/jpeg, application/pdf, calendar_event, email)
   * @param {string} input.content - Raw content (text or extracted text)
   * @param {string} input.source - Source identifier
   * @param {Date} input.timestamp - When this was captured
   * @param {string} [input.fileKey] - S3 file key if applicable
   * @returns {Object} IR - Internal Representation
   */
  async normalize(input) {
    this.ensureReady();
    this.trackCall();

    const { type, content, source, timestamp, fileKey } = input;

    // Find normalizer for this type
    const normalizer = this.normalizers.get(type);

    if (!normalizer) {
      // Fallback: treat as plain text
      return this._normalizeText({ content, source, timestamp, fileKey });
    }

    try {
      const ir = await normalizer({ content, source, timestamp, fileKey });
      return ir;
    } catch (err) {
      this.trackError();
      console.error(`✦ Normalization failed for type ${type}:`, err.message);
      // Fallback: return raw content as text IR
      return this._normalizeText({ content: content || '', source, timestamp, fileKey });
    }
  }

  /**
   * Normalize a batch of inputs.
   */
  async normalizeBatch(inputs) {
    return Promise.all(inputs.map((input) => this.normalize(input)));
  }

  // ─── Built-in Normalizers ─────────────────────────────────────

  /**
   * Text normalizer: clean and structure raw text input.
   */
  async _normalizeText({ content, source, timestamp, fileKey }) {
    // Clean the text: trim, collapse whitespace, remove control chars
    const cleaned = content
      .trim()
      .replace(/\r\n/g, '\n')
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '') // remove control chars except \n \t
      .replace(/\n{3,}/g, '\n\n') // collapse excessive newlines
      .replace(/ {2,}/g, ' '); // collapse excessive spaces

    return {
      type: 'text',
      content: cleaned,
      metadata: {
        source: source || 'manual',
        timestamp: timestamp || new Date(),
        originalFormat: 'text/plain',
        fileKey: fileKey || null,
        charCount: cleaned.length,
      },
    };
  }

  /**
   * Image normalizer: wraps image reference for vision processing.
   * Actual image-to-text extraction happens in ExtractionEngine.
   */
  async _normalizeImage({ content, source, timestamp, fileKey }) {
    return {
      type: 'image',
      content: content || '', // companion text entered by user
      metadata: {
        source: source || 'manual',
        timestamp: timestamp || new Date(),
        originalFormat: 'image',
        fileKey: fileKey,
        charCount: content ? content.length : 0,
        requiresVision: true, // flag for ExtractionEngine to use Vision API
      },
    };
  }

  /**
   * PDF normalizer: extracts text from PDF content.
   * Expects `content` to already be extracted text (by file.service.js).
   */
  async _normalizePDF({ content, source, timestamp, fileKey }) {
    const cleaned = content
      .trim()
      .replace(/\r\n/g, '\n')
      .replace(/\f/g, '\n---\n') // page breaks
      .replace(/\n{3,}/g, '\n\n');

    return {
      type: 'pdf',
      content: cleaned,
      metadata: {
        source: source || 'manual',
        timestamp: timestamp || new Date(),
        originalFormat: 'application/pdf',
        fileKey: fileKey,
        charCount: cleaned.length,
      },
    };
  }

  /**
   * Calendar event normalizer: structures event data into readable text.
   */
  async _normalizeCalendarEvent({ content, source, timestamp }) {
    // Content is expected to be a JSON string of calendar event data
    let eventText;

    try {
      const event = typeof content === 'string' ? JSON.parse(content) : content;
      const parts = [];

      if (event.summary) parts.push(`Event: ${event.summary}`);
      if (event.start) parts.push(`Time: ${new Date(event.start).toLocaleString()}`);
      if (event.end) parts.push(`Until: ${new Date(event.end).toLocaleString()}`);
      if (event.location) parts.push(`Location: ${event.location}`);
      if (event.description) parts.push(`Details: ${event.description}`);
      if (event.attendees && event.attendees.length > 0) {
        parts.push(`Attendees: ${event.attendees.join(', ')}`);
      }

      eventText = parts.join('\n');
    } catch {
      // If parsing fails, use raw content
      eventText = typeof content === 'string' ? content : JSON.stringify(content);
    }

    return {
      type: 'calendar_event',
      content: eventText,
      metadata: {
        source: 'calendar',
        timestamp: timestamp || new Date(),
        originalFormat: 'calendar/event',
        fileKey: null,
        charCount: eventText.length,
      },
    };
  }

  /**
   * Email normalizer: extracts actionable content from email data.
   * Strips signatures, threads, and non-actionable content.
   */
  async _normalizeEmail({ content, source, timestamp }) {
    let emailText;

    try {
      const email = typeof content === 'string' ? JSON.parse(content) : content;
      const parts = [];

      if (email.subject) parts.push(`Subject: ${email.subject}`);
      if (email.from) parts.push(`From: ${email.from}`);
      if (email.date) parts.push(`Date: ${new Date(email.date).toLocaleString()}`);

      // Extract body, stripping common signature patterns
      if (email.body) {
        let body = email.body;
        // Remove email signatures (common patterns)
        body = body.replace(/--\s*\n[\s\S]*$/, ''); // -- signature
        body = body.replace(/Sent from my [\w\s]+$/i, ''); // mobile signatures
        body = body.replace(/^>.*$/gm, ''); // quoted replies
        body = body.trim();

        if (body) parts.push(`\n${body}`);
      }

      emailText = parts.join('\n');
    } catch {
      emailText = typeof content === 'string' ? content : JSON.stringify(content);
    }

    return {
      type: 'email',
      content: emailText,
      metadata: {
        source: 'gmail',
        timestamp: timestamp || new Date(),
        originalFormat: 'email/message',
        fileKey: null,
        charCount: emailText.length,
      },
    };
  }

  /**
   * Notion task normalizer: structures task data.
   */
  async _normalizeNotionTask({ content, source, timestamp }) {
    let taskText;

    try {
      const task = typeof content === 'string' ? JSON.parse(content) : content;
      const parts = [];

      if (task.title) parts.push(`Task: ${task.title}`);
      if (task.status) parts.push(`Status: ${task.status}`);
      if (task.dueDate) parts.push(`Due: ${task.dueDate}`);
      if (task.priority) parts.push(`Priority: ${task.priority}`);
      if (task.description) parts.push(`\n${task.description}`);

      taskText = parts.join('\n');
    } catch {
      taskText = typeof content === 'string' ? content : JSON.stringify(content);
    }

    return {
      type: 'task',
      content: taskText,
      metadata: {
        source: 'notion',
        timestamp: timestamp || new Date(),
        originalFormat: 'notion/task',
        fileKey: null,
        charCount: taskText.length,
      },
    };
  }
}

module.exports = NormalizationEngine;
