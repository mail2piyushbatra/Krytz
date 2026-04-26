/**
 * ✦ QUERY PLANNER
 *
 * Classifies recall query intent and routes to the correct retrieval strategy.
 *
 * Intent types:
 *   FACT       - "what did I do on Monday" → keyword + time-range
 *   SUMMARY    - "how was my week" → state snapshots + summaries
 *   CAUSAL     - "why am I stuck on X" → blocker graph traversal
 *   TEMPORAL   - "when did I last work on X" → timeline scan
 *   PREDICTIVE - "will I finish X by Friday" → state model (future: ML)
 *
 * Context packing:
 *   Selects the best K entries that fit under the token budget,
 *   scored by relevance × recency × novelty.
 */

'use strict';

// ─── Intent classifier ────────────────────────────────────────────────────────
const INTENT_RULES = [
  { intent: 'CAUSAL',     patterns: [/\bwhy\b/i, /\bwhat.+caus/i, /\bbecause\b/i, /\bblocked\b/i, /\bstuck\b/i] },
  { intent: 'PREDICTIVE', patterns: [/\bwill i\b/i, /\bcan i\b/i, /\bby (monday|tuesday|wednesday|thursday|friday|next week|friday)/i, /\bfinish by\b/i] },
  { intent: 'TEMPORAL',   patterns: [/\bwhen did\b/i, /\blast time\b/i, /\bhow long\b/i, /\bsince when\b/i] },
  { intent: 'SUMMARY',    patterns: [/\bhow.+week\b/i, /\bsummary\b/i, /\boverview\b/i, /\bprogress\b/i, /\bhow am i doing\b/i] },
  { intent: 'FACT',       patterns: [/\bwhat did\b/i, /\bwhat have\b/i, /\bshow me\b/i, /\blist\b/i, /\bfind\b/i] },
];

function classifyIntent(query) {
  const q = query.toLowerCase();
  for (const rule of INTENT_RULES) {
    if (rule.patterns.some(p => p.test(q))) return rule.intent;
  }
  return 'FACT'; // default
}

// ─── Context packer ───────────────────────────────────────────────────────────
// Selects entries that maximise information under a token budget.
// Score = α·relevance + β·recency + γ·novelty

function packContext(entries, {
  tokenBudget  = 3000,
  alpha        = 0.5,   // relevance weight
  beta         = 0.3,   // recency weight
  gamma        = 0.2,   // novelty weight
  queryTerms   = [],
} = {}) {

  const now      = Date.now();
  const maxAge   = 30 * 24 * 60 * 60 * 1000; // 30 days

  // Score each entry
  const scored = entries.map(entry => {
    // Relevance: term overlap with query
    const text    = (entry.rawText || '').toLowerCase();
    const hits    = queryTerms.filter(t => text.includes(t)).length;
    const relevance = queryTerms.length > 0 ? hits / queryTerms.length : 0.5;

    // Recency: linear decay over maxAge
    const age     = now - new Date(entry.timestamp).getTime();
    const recency = Math.max(0, 1 - age / maxAge);

    // Novelty: penalise entries that share many terms with already-selected
    // (computed lazily below during selection)

    const score  = alpha * relevance + beta * recency;
    const tokens = Math.ceil((entry.rawText || '').length / 4); // rough estimate

    return { entry, score, tokens, relevance, recency };
  });

  // Greedy selection with novelty penalty
  scored.sort((a, b) => b.score - a.score);

  const selected    = [];
  const usedTerms   = new Set();
  let remaining     = tokenBudget;

  for (const item of scored) {
    if (item.tokens > remaining) continue;

    // Novelty: fraction of entry terms NOT yet in usedTerms
    const entryTerms = (item.entry.rawText || '')
      .toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/)
      .filter(t => t.length > 3);
    const novel = entryTerms.length > 0
      ? entryTerms.filter(t => !usedTerms.has(t)).length / entryTerms.length
      : 0.5;

    const finalScore = alpha * item.relevance + beta * item.recency + gamma * novel;

    selected.push({ ...item, novel, finalScore });
    for (const t of entryTerms) usedTerms.add(t);
    remaining -= item.tokens;
  }

  return selected.map(s => s.entry);
}

// ─── Context formatter ────────────────────────────────────────────────────────
// Builds the LLM prompt context string from selected entries.
// Different intent types get different formatting.

function formatContext(entries, intent) {
  const lines = [];

  for (const entry of entries) {
    const date = new Date(entry.timestamp).toISOString().split('T')[0];
    const time = new Date(entry.timestamp).toTimeString().slice(0, 5);

    if (intent === 'SUMMARY') {
      // For summaries, prefer extracted state over raw text
      const es = entry.extractedState;
      if (es) {
        const parts = [];
        if (es.actionItems?.length)  parts.push(`Actions: ${es.actionItems.map(i => i.text).join('; ')}`);
        if (es.completions?.length)  parts.push(`Done: ${es.completions.map(i => i.text).join('; ')}`);
        if (es.blockers?.length)     parts.push(`Blockers: ${es.blockers.map(i => i.text).join('; ')}`);
        if (es.sentiment && es.sentiment !== 'neutral') parts.push(`Mood: ${es.sentiment}`);
        if (parts.length > 0) {
          lines.push(`[${date}] ${parts.join(' | ')}`);
          continue;
        }
      }
    }

    if (intent === 'CAUSAL') {
      // For causal queries, include blockers and their context
      const es   = entry.extractedState;
      const text = entry.rawText.slice(0, 300);
      lines.push(`[${date} ${time}] ${text}`);
      if (es?.blockers?.length) {
        lines.push(`  ⚠ Blockers: ${es.blockers.map(i => i.text).join('; ')}`);
      }
      continue;
    }

    // Default: raw text with extracted summary
    const text = entry.rawText.length > 400 ? entry.rawText.slice(0, 400) + '...' : entry.rawText;
    lines.push(`[${date} ${time}] ${text}`);
  }

  return lines.join('\n\n');
}

// ─── Intent-specific system prompts ──────────────────────────────────────────
const PROMPTS = {
  FACT: `You are a personal recall assistant. Answer the question based ONLY on the provided entries.
Be concise, use bullet points for multiple items, reference specific dates. Never invent information.`,

  SUMMARY: `You are summarizing a user's activity period. Based on the entries:
1. What were the main themes or projects?
2. What was completed vs still open?
3. What patterns or blockers stand out?
Be concise but insightful. Never invent information.`,

  CAUSAL: `You are analyzing why the user is blocked or stuck. Based on the entries:
1. What is the specific blocker?
2. When did it first appear?
3. What has been tried?
Reason carefully. Never speculate beyond the evidence.`,

  TEMPORAL: `You are finding when specific events occurred. Based on the entries:
- Find the most relevant timestamps
- State them precisely
- Note if something recurred over time`,

  PREDICTIVE: `You are assessing likelihood of completion. Based on the entries:
- What is the current state of the work?
- What blockers exist?
- Given the pace so far, is the target realistic?
Be honest about uncertainty. Never make confident predictions from limited data.`,
};

function getSystemPrompt(intent) {
  return PROMPTS[intent] || PROMPTS.FACT;
}

module.exports = { classifyIntent, packContext, formatContext, getSystemPrompt };
