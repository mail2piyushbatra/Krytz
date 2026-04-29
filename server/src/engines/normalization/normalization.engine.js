/**
 * âœ¦ NORMALIZATION ENGINE â€” v2
 *
 * Transforms any raw input into Krytz's Internal Representation (IR).
 *
 * Upgrades from v1:
 *   - Confidence scoring on every IR object
 *   - Ambiguity detection: flags "tomorrow", "next week", relative dates
 *   - Real iCal (.ics) parsing â€” not just JSON calendar events
 *   - Real EML/RFC-2822 email parsing â€” strips quoted text
 *   - Added input size guard (truncate + warn on oversized inputs)
 */

'use strict';

const BaseEngine = require('../base.engine');
const logger     = require('../../lib/logger');

const MAX_INPUT_CHARS = 50_000;

const AMBIGUOUS_DATE_PATTERNS = [
  /\btomorrow\b/i,
  /\bnext\s+(week|month|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
  /\bthis\s+(week|month|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
  /\bin\s+\d+\s+(days?|weeks?|months?)\b/i,
  /\bsoon\b/i, /\bshortly\b/i, /\bthe day after\b/i,
];

function detectAmbiguities(text) {
  const found = [];
  for (const pattern of AMBIGUOUS_DATE_PATTERNS) {
    const match = text.match(pattern);
    if (match) found.push({ type: 'relative_date', match: match[0] });
  }
  return found;
}

function scoreConfidence({ charCount, hasStructure, hasActionKeywords, hasAmbiguities, type }) {
  let score = 0.5;
  if (charCount > 200)   score += 0.15;
  if (charCount > 50)    score += 0.05;
  if (charCount < 10)    score -= 0.3;
  if (hasStructure)      score += 0.15;
  if (hasActionKeywords) score += 0.1;
  if (hasAmbiguities)    score -= 0.1;
  if (type === 'calendar_event' || type === 'email') score += 0.1;
  if (type === 'image')  score -= 0.1;
  return Math.max(0, Math.min(1, parseFloat(score.toFixed(2))));
}

const ACTION_KEYWORDS = /\b(todo|do|need|must|should|review|finish|complete|send|call|schedule|fix|update|check|follow up|deadline|by)\b/i;

function parseICal(raw) {
  const events = [];
  const blocks = raw.split('BEGIN:VEVENT');
  for (const block of blocks.slice(1)) {
    const get = (key) => { const m = block.match(new RegExp(`${key}[^:]*:([^\\r\\n]+)`)); return m ? m[1].trim() : null; };
    const summary = get('SUMMARY');
    if (summary) {
      const dtstart = get('DTSTART'), dtend = get('DTEND');
      events.push({ summary, start: dtstart ? parseICalDate(dtstart) : null, end: dtend ? parseICalDate(dtend) : null, location: get('LOCATION'), description: (get('DESCRIPTION') || '').replace(/\\n/g, '\n').replace(/\\,/g, ',') || null });
    }
  }
  return events;
}

function parseICalDate(s) {
  if (s.length >= 8) {
    const y = s.slice(0,4), mo = s.slice(4,6), d = s.slice(6,8);
    const t = s.length > 8 ? `T${s.slice(9,11)}:${s.slice(11,13)}:${s.slice(13,15)}Z` : 'T00:00:00Z';
    return new Date(`${y}-${mo}-${d}${t}`).toISOString();
  }
  return s;
}

function parseEML(raw) {
  const lines = raw.split(/\r?\n/);
  const headers = {};
  let bodyStart = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === '') { bodyStart = i + 1; break; }
    const sep = lines[i].indexOf(':');
    if (sep > 0) headers[lines[i].slice(0, sep).trim().toLowerCase()] = lines[i].slice(sep + 1).trim();
  }
  const body = lines.slice(bodyStart).join('\n')
    .replace(/^>.*$/gm, '').replace(/--\s*\n[\s\S]*$/, '')
    .replace(/Sent from my [\w\s]+\.?$/im, '').replace(/Get Outlook for [\w\s]+\.?$/im, '').trim();
  return { subject: headers['subject'] || null, from: headers['from'] || null, date: headers['date'] || null, body };
}

class NormalizationEngine extends BaseEngine {
  constructor() { super('normalization'); this.normalizers = new Map(); }

  async initialize() {
    this.registerNormalizer('text',            this._normalizeText.bind(this));
    this.registerNormalizer('image/jpeg',      this._normalizeImage.bind(this));
    this.registerNormalizer('image/png',       this._normalizeImage.bind(this));
    this.registerNormalizer('image/webp',      this._normalizeImage.bind(this));
    this.registerNormalizer('application/pdf', this._normalizePDF.bind(this));
    this.registerNormalizer('calendar_event',  this._normalizeCalendarEvent.bind(this));
    this.registerNormalizer('text/calendar',   this._normalizeICalFile.bind(this));
    this.registerNormalizer('email',           this._normalizeEmail.bind(this));
    this.registerNormalizer('message/rfc822',  this._normalizeEMLFile.bind(this));
    this.registerNormalizer('notion_task',     this._normalizeNotionTask.bind(this));
    await super.initialize();
    logger.info('NormalizationEngine ready', { normalizers: this.normalizers.size });
  }

  registerNormalizer(type, fn) { this.normalizers.set(type, fn); }

  async normalize(input) {
    this.ensureReady();
    const done = this.startCall();
    const { type, content, source, timestamp, fileKey } = input;
    let safeContent = content;
    if (typeof content === 'string' && content.length > MAX_INPUT_CHARS) {
      logger.warn('Input truncated', { type, originalLength: content.length, truncatedTo: MAX_INPUT_CHARS });
      safeContent = content.slice(0, MAX_INPUT_CHARS);
    }
    const normalizer = this.normalizers.get(type);
    try {
      const ir = normalizer
        ? await normalizer({ content: safeContent, source, timestamp, fileKey })
        : await this._normalizeText({ content: safeContent || '', source, timestamp, fileKey });
      done();
      return ir;
    } catch (err) {
      done(err);
      logger.error('Normalization failed', { type, error: err.message });
      return this._normalizeText({ content: safeContent || '', source, timestamp, fileKey });
    }
  }

  async normalizeBatch(inputs) { return Promise.all(inputs.map(i => this.normalize(i))); }

  async _normalizeText({ content, source, timestamp, fileKey }) {
    const cleaned = (content || '').trim().replace(/\r\n/g, '\n').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '').replace(/\n{3,}/g, '\n\n').replace(/ {2,}/g, ' ');
    const ambiguities = detectAmbiguities(cleaned);
    return { type: 'text', content: cleaned, metadata: { source: source || 'manual', timestamp: timestamp || new Date(), originalFormat: 'text/plain', fileKey: fileKey || null, charCount: cleaned.length, ambiguities, confidence: scoreConfidence({ charCount: cleaned.length, hasStructure: false, hasActionKeywords: ACTION_KEYWORDS.test(cleaned), hasAmbiguities: ambiguities.length > 0, type: 'text' }) } };
  }

  async _normalizeImage({ content, source, timestamp, fileKey }) {
    return { type: 'image', content: content || '', metadata: { source: source || 'manual', timestamp: timestamp || new Date(), originalFormat: 'image', fileKey, charCount: (content || '').length, requiresVision: true, ambiguities: [], confidence: scoreConfidence({ charCount: (content || '').length, hasStructure: false, hasActionKeywords: false, hasAmbiguities: false, type: 'image' }) } };
  }

  async _normalizePDF({ content, source, timestamp, fileKey }) {
    const cleaned = (content || '').trim().replace(/\r\n/g, '\n').replace(/\f/g, '\n---\n').replace(/\n{3,}/g, '\n\n');
    const ambiguities = detectAmbiguities(cleaned);
    return { type: 'pdf', content: cleaned, metadata: { source: source || 'manual', timestamp: timestamp || new Date(), originalFormat: 'application/pdf', fileKey, charCount: cleaned.length, ambiguities, confidence: scoreConfidence({ charCount: cleaned.length, hasStructure: true, hasActionKeywords: ACTION_KEYWORDS.test(cleaned), hasAmbiguities: ambiguities.length > 0, type: 'pdf' }) } };
  }

  async _normalizeCalendarEvent({ content, source, timestamp }) {
    let eventText;
    try {
      const event = typeof content === 'string' ? JSON.parse(content) : content;
      const parts = [];
      if (event.summary)     parts.push(`Event: ${event.summary}`);
      if (event.start)       parts.push(`Time: ${new Date(event.start).toLocaleString()}`);
      if (event.end)         parts.push(`Until: ${new Date(event.end).toLocaleString()}`);
      if (event.location)    parts.push(`Location: ${event.location}`);
      if (event.description) parts.push(`Details: ${event.description}`);
      if (Array.isArray(event.attendees) && event.attendees.length > 0) parts.push(`Attendees: ${event.attendees.join(', ')}`);
      eventText = parts.join('\n');
    } catch { eventText = typeof content === 'string' ? content : JSON.stringify(content); }
    return { type: 'calendar_event', content: eventText, metadata: { source: 'calendar', timestamp: timestamp || new Date(), originalFormat: 'calendar/event', fileKey: null, charCount: eventText.length, ambiguities: detectAmbiguities(eventText), confidence: scoreConfidence({ charCount: eventText.length, hasStructure: true, hasActionKeywords: false, hasAmbiguities: false, type: 'calendar_event' }) } };
  }

  async _normalizeICalFile({ content, source, timestamp, fileKey }) {
    const events = parseICal(content || '');
    if (events.length === 0) return this._normalizeText({ content: content || '', source, timestamp, fileKey });
    const parts = events.map((ev, i) => { const lines = [`Event ${i+1}: ${ev.summary}`]; if (ev.start) lines.push(`  Time: ${new Date(ev.start).toLocaleString()}`); if (ev.location) lines.push(`  Location: ${ev.location}`); if (ev.description) lines.push(`  Details: ${ev.description}`); return lines.join('\n'); });
    const eventText = parts.join('\n\n');
    return { type: 'calendar_event', content: eventText, metadata: { source: 'calendar', timestamp: timestamp || new Date(), originalFormat: 'text/calendar', fileKey: fileKey || null, charCount: eventText.length, eventCount: events.length, ambiguities: [], confidence: scoreConfidence({ charCount: eventText.length, hasStructure: true, hasActionKeywords: false, hasAmbiguities: false, type: 'calendar_event' }) } };
  }

  async _normalizeEmail({ content, source, timestamp }) {
    let emailText;
    try {
      const email = typeof content === 'string' ? JSON.parse(content) : content;
      const parts = [];
      if (email.subject) parts.push(`Subject: ${email.subject}`);
      if (email.from)    parts.push(`From: ${email.from}`);
      if (email.date)    parts.push(`Date: ${new Date(email.date).toLocaleString()}`);
      if (email.body) { const body = email.body.replace(/--\s*\n[\s\S]*$/, '').replace(/Sent from my [\w\s]+\.?$/im, '').replace(/^>.*$/gm, '').trim(); if (body) parts.push(`\n${body}`); }
      emailText = parts.join('\n');
    } catch { emailText = typeof content === 'string' ? content : JSON.stringify(content); }
    const ambiguities = detectAmbiguities(emailText);
    return { type: 'email', content: emailText, metadata: { source: 'gmail', timestamp: timestamp || new Date(), originalFormat: 'email/message', fileKey: null, charCount: emailText.length, ambiguities, confidence: scoreConfidence({ charCount: emailText.length, hasStructure: true, hasActionKeywords: ACTION_KEYWORDS.test(emailText), hasAmbiguities: ambiguities.length > 0, type: 'email' }) } };
  }

  async _normalizeEMLFile({ content, source, timestamp, fileKey }) {
    const parsed = parseEML(content || '');
    const parts  = [];
    if (parsed.subject) parts.push(`Subject: ${parsed.subject}`);
    if (parsed.from)    parts.push(`From: ${parsed.from}`);
    if (parsed.date)    parts.push(`Date: ${parsed.date}`);
    if (parsed.body)    parts.push(`\n${parsed.body}`);
    const emailText = parts.join('\n');
    const ambiguities = detectAmbiguities(emailText);
    return { type: 'email', content: emailText, metadata: { source: source || 'email', timestamp: timestamp || new Date(), originalFormat: 'message/rfc822', fileKey: fileKey || null, charCount: emailText.length, ambiguities, confidence: scoreConfidence({ charCount: emailText.length, hasStructure: true, hasActionKeywords: ACTION_KEYWORDS.test(emailText), hasAmbiguities: ambiguities.length > 0, type: 'email' }) } };
  }

  async _normalizeNotionTask({ content, source, timestamp }) {
    let taskText;
    try {
      const task = typeof content === 'string' ? JSON.parse(content) : content;
      const parts = [];
      if (task.title)       parts.push(`Task: ${task.title}`);
      if (task.status)      parts.push(`Status: ${task.status}`);
      if (task.dueDate)     parts.push(`Due: ${task.dueDate}`);
      if (task.priority)    parts.push(`Priority: ${task.priority}`);
      if (task.description) parts.push(`\n${task.description}`);
      taskText = parts.join('\n');
    } catch { taskText = typeof content === 'string' ? content : JSON.stringify(content); }
    const ambiguities = detectAmbiguities(taskText);
    return { type: 'task', content: taskText, metadata: { source: 'notion', timestamp: timestamp || new Date(), originalFormat: 'notion/task', fileKey: null, charCount: taskText.length, ambiguities, confidence: scoreConfidence({ charCount: taskText.length, hasStructure: true, hasActionKeywords: ACTION_KEYWORDS.test(taskText), hasAmbiguities: ambiguities.length > 0, type: 'task' }) } };
  }
}

module.exports = NormalizationEngine;
