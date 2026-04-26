/**
 * ✦ TEMPORAL RESOLVER
 * Resolves "tomorrow 5pm", "next Monday", "in 3 days" → ISO timestamps.
 * Uses chrono-node if installed, falls back to regex patterns.
 * Also detects ambiguous temporal references ("soon", "later", "at some point").
 */
'use strict';

const AMBIGUOUS = [
  { pattern: /\bsoon\b/i,          type: 'vague_time',    token: 'soon' },
  { pattern: /\blater\b/i,         type: 'vague_time',    token: 'later' },
  { pattern: /\bat some point\b/i, type: 'vague_time',    token: 'at some point' },
  { pattern: /\beventually\b/i,    type: 'vague_time',    token: 'eventually' },
  { pattern: /\bit\b/i,            type: 'vague_subject', token: 'it' },
  { pattern: /\bthis\b/i,          type: 'vague_subject', token: 'this' },
  { pattern: /\bthat thing\b/i,    type: 'vague_subject', token: 'that thing' },
];

function resolveTemporalExpressions(text, timezone = 'UTC', anchor = new Date()) {
  const resolved = [], ambiguous = [];
  let chrono;
  try { chrono = require('chrono-node'); } catch (_) { chrono = null; }

  if (chrono) {
    const results = chrono.parse(text, anchor, { forwardDate: true });
    for (const r of results) {
      resolved.push({ text: r.text, iso: toUserTZ(r.start.date(), timezone), start: r.index, end: r.index + r.text.length, certain: r.start.knownValues.hour !== undefined });
    }
  } else {
    const regexPatterns = [
      { re: /\btomorrow\b/gi, offsetDays: 1 }, { re: /\btoday\b/gi, offsetDays: 0 }, { re: /\byesterday\b/gi, offsetDays: -1 },
      { re: /\bnext\s+monday\b/gi, weekday: 1 }, { re: /\bnext\s+tuesday\b/gi, weekday: 2 }, { re: /\bnext\s+wednesday\b/gi, weekday: 3 },
      { re: /\bnext\s+thursday\b/gi, weekday: 4 }, { re: /\bnext\s+friday\b/gi, weekday: 5 },
      { re: /\bin\s+(\d+)\s+days?\b/gi, dynamic: true }, { re: /\bin\s+(\d+)\s+weeks?\b/gi, dynamic: true, multiplier: 7 },
    ];
    for (const p of regexPatterns) {
      let m;
      const re = new RegExp(p.re.source, p.re.flags);
      while ((m = re.exec(text)) !== null) {
        let date;
        if (p.offsetDays !== undefined)  { date = new Date(anchor); date.setDate(date.getDate() + p.offsetDays); }
        else if (p.weekday !== undefined) { date = nextWeekday(anchor, p.weekday); }
        else if (p.dynamic)              { const n = parseInt(m[1]) * (p.multiplier || 1); date = new Date(anchor); date.setDate(date.getDate() + n); }
        if (date) resolved.push({ text: m[0], iso: toUserTZ(date, timezone), start: m.index, end: m.index + m[0].length, certain: false });
      }
    }
  }

  for (const { pattern, type, token } of AMBIGUOUS) {
    if (pattern.test(text)) {
      const alreadyResolved = resolved.some(r => r.text.toLowerCase().includes(token));
      if (!alreadyResolved) ambiguous.push({ token, type });
    }
  }

  return { resolved, ambiguous };
}

function enrichIRWithTemporal(ir, timezone = 'UTC') {
  if (!ir?.content) return ir;
  const { resolved, ambiguous } = resolveTemporalExpressions(ir.content, timezone, new Date());
  return { ...ir, metadata: { ...ir.metadata, temporal: { resolved: resolved.map(r => ({ text: r.text, iso: r.iso, certain: r.certain })), ambiguous: ambiguous.length > 0, ambiguities: ambiguous } } };
}

function toUserTZ(date, timezone) {
  try { return new Intl.DateTimeFormat('sv-SE', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(date).replace(' ', 'T'); }
  catch (_) { return date.toISOString(); }
}

function nextWeekday(from, weekday) { const d = new Date(from); const diff = (weekday - d.getDay() + 7) % 7 || 7; d.setDate(d.getDate() + diff); return d; }

module.exports = { resolveTemporalExpressions, enrichIRWithTemporal };
