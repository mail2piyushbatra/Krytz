/**
 * ✦ RECALL ENGINE
 *
 * Natural language query system over user's entry history.
 * Retrieves relevant entries, builds context, and asks LLM to answer.
 *
 * Strategies:
 *   - Time-based retrieval ("what did I do last week?")
 *   - Keyword search ("anything about Rajesh?")
 *   - Full context dump (for short time ranges)
 */

const OpenAI = require('openai');
const BaseEngine = require('../base.engine');
const prisma = require('../../lib/prisma');

const RECALL_SYSTEM_PROMPT = `You are a personal recall assistant for Flowra.
The user will ask about their past activities. You have access to their timeline entries below.

Rules:
- Answer based ONLY on the provided entries. Do NOT speculate or invent information.
- Be concise but complete. Use bullet points for multiple items.
- Reference specific dates when relevant.
- If the entries don't contain enough info, say so honestly.
- Never make up activities, meetings, or tasks that aren't in the entries.`;

class RecallEngine extends BaseEngine {
  constructor() {
    super('recall');
    this.client = null;
    this.model = 'gpt-4o-mini';
    this.maxContextEntries = 50;
    this.maxContextChars = 12000;
  }

  async initialize() {
    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey || apiKey === 'sk-your-openai-api-key') {
      console.warn('  ⚠ RecallEngine: No valid OPENAI_API_KEY. Recall will return fallback responses.');
      this.client = null;
    } else {
      this.client = new OpenAI({ apiKey });
    }

    await super.initialize();
  }

  /**
   * Answer a natural language query using the user's entries.
   *
   * @param {string} userId - User ID
   * @param {string} query - Natural language question
   * @returns {Object} { answer, sourceEntries, confidence }
   */
  async query(userId, query) {
    this.ensureReady();
    this.trackCall();

    // 1. Determine time range from query
    const timeRange = this._parseTimeRange(query);

    // 2. Retrieve relevant entries
    const entries = await this._retrieveEntries(userId, query, timeRange);

    if (entries.length === 0) {
      return {
        answer: "I don't have enough entries to answer that yet. Keep capturing!",
        sourceEntries: [],
        confidence: 'low',
      };
    }

    // 3. If no LLM client, return raw entries summary
    if (!this.client) {
      return {
        answer: `Found ${entries.length} entries in the time range. LLM not configured for full recall.`,
        sourceEntries: entries.slice(0, 5).map(this._formatSourceEntry),
        confidence: 'low',
      };
    }

    // 4. Build context from entries
    const context = this._buildContext(entries);

    // 5. Ask LLM
    try {
      const completion = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'system', content: RECALL_SYSTEM_PROMPT },
          { role: 'user', content: `Here are the user's entries:\n\n${context}\n\nQuestion: ${query}` },
        ],
        temperature: 0.3,
        max_tokens: 1500,
      });

      const answer = completion.choices[0].message.content;

      return {
        answer,
        sourceEntries: entries.slice(0, 5).map(this._formatSourceEntry),
        confidence: entries.length > 10 ? 'high' : entries.length > 3 ? 'medium' : 'low',
      };
    } catch (err) {
      this.trackError();
      console.error('✦ Recall query failed:', err.message);
      return {
        answer: 'Sorry, I had trouble processing your question. Please try again.',
        sourceEntries: [],
        confidence: 'low',
      };
    }
  }

  /**
   * Parse natural language query to determine time range.
   */
  _parseTimeRange(query) {
    const now = new Date();
    const q = query.toLowerCase();

    // "today"
    if (q.includes('today')) {
      const start = new Date(now);
      start.setHours(0, 0, 0, 0);
      return { from: start, to: now };
    }

    // "yesterday"
    if (q.includes('yesterday')) {
      const start = new Date(now);
      start.setDate(start.getDate() - 1);
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setHours(23, 59, 59, 999);
      return { from: start, to: end };
    }

    // "this week" / "last week"
    if (q.includes('this week')) {
      const start = new Date(now);
      start.setDate(start.getDate() - start.getDay()); // start of week (Sunday)
      start.setHours(0, 0, 0, 0);
      return { from: start, to: now };
    }

    if (q.includes('last week')) {
      const start = new Date(now);
      start.setDate(start.getDate() - start.getDay() - 7);
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setDate(end.getDate() + 6);
      end.setHours(23, 59, 59, 999);
      return { from: start, to: end };
    }

    // "last X days"
    const daysMatch = q.match(/last\s+(\d+)\s+days?/);
    if (daysMatch) {
      const days = parseInt(daysMatch[1]);
      const start = new Date(now);
      start.setDate(start.getDate() - days);
      start.setHours(0, 0, 0, 0);
      return { from: start, to: now };
    }

    // "this month"
    if (q.includes('this month')) {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      return { from: start, to: now };
    }

    // Default: last 30 days
    const start = new Date(now);
    start.setDate(start.getDate() - 30);
    return { from: start, to: now };
  }

  /**
   * Retrieve entries matching the query context.
   * Combines time-based and keyword-based retrieval.
   */
  async _retrieveEntries(userId, query, timeRange) {
    // Time-based retrieval
    const entries = await prisma.entry.findMany({
      where: {
        userId,
        timestamp: {
          gte: timeRange.from,
          lte: timeRange.to,
        },
      },
      include: { extractedState: true },
      orderBy: { timestamp: 'desc' },
      take: this.maxContextEntries,
    });

    // If few results from time range, also search by keyword
    if (entries.length < 5) {
      const keywords = this._extractKeywords(query);

      if (keywords.length > 0) {
        const keywordEntries = await prisma.entry.findMany({
          where: {
            userId,
            OR: keywords.map((kw) => ({
              rawText: { contains: kw, mode: 'insensitive' },
            })),
          },
          include: { extractedState: true },
          orderBy: { timestamp: 'desc' },
          take: 20,
        });

        // Merge and deduplicate
        const entryIds = new Set(entries.map((e) => e.id));
        for (const entry of keywordEntries) {
          if (!entryIds.has(entry.id)) {
            entries.push(entry);
            entryIds.add(entry.id);
          }
        }
      }
    }

    return entries;
  }

  /**
   * Extract meaningful keywords from query for search.
   */
  _extractKeywords(query) {
    const stopWords = new Set([
      'what', 'did', 'do', 'does', 'i', 'my', 'me', 'the', 'a', 'an', 'is', 'was',
      'were', 'have', 'has', 'had', 'about', 'with', 'for', 'on', 'in', 'at', 'to',
      'of', 'and', 'or', 'this', 'that', 'last', 'week', 'today', 'yesterday',
      'how', 'many', 'much', 'when', 'where', 'any', 'anything', 'something',
    ]);

    return query
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter((word) => word.length > 2 && !stopWords.has(word));
  }

  /**
   * Build LLM context string from entries, respecting token limits.
   */
  _buildContext(entries) {
    let totalChars = 0;
    const lines = [];

    for (const entry of entries) {
      const date = entry.timestamp.toISOString().split('T')[0];
      const time = entry.timestamp.toTimeString().split(' ')[0].slice(0, 5);

      let line = `[${date} ${time}] ${entry.rawText}`;

      if (entry.extractedState) {
        const es = entry.extractedState;
        const parts = [];
        if (Array.isArray(es.actionItems) && es.actionItems.length > 0) {
          parts.push(`Actions: ${es.actionItems.map((i) => i.text).join('; ')}`);
        }
        if (Array.isArray(es.blockers) && es.blockers.length > 0) {
          parts.push(`Blockers: ${es.blockers.map((i) => i.text).join('; ')}`);
        }
        if (Array.isArray(es.completions) && es.completions.length > 0) {
          parts.push(`Done: ${es.completions.map((i) => i.text).join('; ')}`);
        }
        if (parts.length > 0) {
          line += `\n  → ${parts.join(' | ')}`;
        }
      }

      if (totalChars + line.length > this.maxContextChars) break;

      lines.push(line);
      totalChars += line.length;
    }

    return lines.join('\n\n');
  }

  /**
   * Format an entry for the sourceEntries response.
   */
  _formatSourceEntry(entry) {
    return {
      id: entry.id,
      rawText: entry.rawText.length > 200 ? entry.rawText.slice(0, 200) + '...' : entry.rawText,
      timestamp: entry.timestamp,
    };
  }
}

module.exports = RecallEngine;
