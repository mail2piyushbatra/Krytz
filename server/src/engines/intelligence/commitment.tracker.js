/**
 * ✦ COMMITMENT TRACKER
 * Tasks you PROMISED to someone by a date. Auto-creates follow-up reminder rule at 75% of time window.
 */
'use strict';

const { v4: uuid } = require('uuid');
const OpenAI = require('openai');

const COMMITMENT_PROMPT = `Extract explicit commitments from this text.
A commitment is when the speaker promises to do something for another person by a certain time.
Return JSON array (empty if none): [{"text":"concise description","counterparty":"name or null","dueExpression":"raw time expression or null","confidence":0.0-1.0}]
Only extract EXPLICIT commitments with clear ownership ("I will","I'll","I promised","will send","getting back to"). Return [] if nothing qualifies.`;

const COMMITMENT_PATTERNS = [
  /\bI(?:'ll| will| shall| must)\s+(?:send|get|have|give|share|deliver|finish|complete|review|call|email|let)\b/gi,
  /\bI\s+(?:promised|told|said|committed)\b/gi,
  /\b(?:getting|get)\s+back\s+to\b/gi,
  /\bwill\s+have\s+(?:it|that|this|the\s+\w+)\s+(?:ready|done|finished|sent)\b/gi,
  /\bneed\s+to\s+(?:get\s+back|follow\s+up|update|let\s+\w+\s+know)\b/gi,
];

function hasCommitmentSignal(text) { return COMMITMENT_PATTERNS.some(p => p.test(text)); }

async function extractCommitments(text, timezone = 'UTC') {
  if (!hasCommitmentSignal(text)) return [];
  const client = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;
  if (!client) return _regexCommitments(text);
  try {
    const resp = await client.chat.completions.create({ model: 'gpt-4o-mini', temperature: 0, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: COMMITMENT_PROMPT }, { role: 'user', content: text.slice(0, 3000) }], max_tokens: 500 });
    const raw  = JSON.parse(resp.choices[0].message.content);
    const list = Array.isArray(raw) ? raw : (raw.commitments || raw.items || []);
    const { resolveTemporalExpressions } = require('./temporal.resolver');
    return list.filter(c => c.confidence >= 0.6).map(c => { let dueDate = null; if (c.dueExpression) { const resolved = resolveTemporalExpressions(c.dueExpression, timezone); dueDate = resolved.resolved[0]?.iso || null; } return { text: c.text, counterpartyName: c.counterparty, dueDate, confidence: c.confidence }; });
  } catch (_) { return _regexCommitments(text); }
}

function _regexCommitments(text) {
  const commits = [];
  const pattern = /I(?:'ll| will)\s+([^\n.!?]{5,60}?)\s+(?:to|for)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+(?:by|before|on)\s+([^\n.!?]{3,30})/gi;
  let m;
  while ((m = pattern.exec(text)) !== null) commits.push({ text: m[1].trim(), counterpartyName: m[2].trim(), dueDate: null, rawDue: m[3].trim(), confidence: 0.7 });
  return commits;
}

async function saveCommitment(db, userId, commitment, sourceEntryId) {
  const id = uuid();
  await db.query(`INSERT INTO commitments(id,user_id,commitment_text,counterparty_name,due_date,confidence,source_entry_id,status) VALUES($1,$2,$3,$4,$5,$6,$7,'open') ON CONFLICT DO NOTHING`, [id, userId, commitment.text, commitment.counterpartyName, commitment.dueDate, commitment.confidence, sourceEntryId]);
  if (commitment.dueDate) await _createFollowUpRule(db, userId, id, commitment);
  return id;
}

async function processCommitmentsFromEntry(db, userId, entryText, sourceEntryId, timezone = 'UTC') {
  const found = await extractCommitments(entryText, timezone);
  const saved = [];
  for (const c of found) { const id = await saveCommitment(db, userId, c, sourceEntryId); saved.push({ id, ...c }); }
  return saved;
}

async function getOpenCommitments(db, userId) {
  const { rows } = await db.query(`SELECT c.*, e.canonical_name AS counterparty_canonical, CASE WHEN c.due_date < now() THEN 'overdue' WHEN c.due_date < now() + interval '24 hours' THEN 'due_soon' ELSE 'open' END AS urgency FROM commitments c LEFT JOIN entities e ON e.id=c.counterparty_entity_id WHERE c.user_id=$1 AND c.status='open' ORDER BY c.due_date ASC NULLS LAST`, [userId]).catch(() => ({ rows: [] }));
  return rows;
}

async function fulfillCommitment(db, userId, commitmentId) {
  await db.query(`UPDATE commitments SET status='fulfilled', fulfilled_at=now() WHERE id=$1 AND user_id=$2`, [commitmentId, userId]);
}

async function _createFollowUpRule(db, userId, commitmentId, commitment) {
  const dueDate = new Date(commitment.dueDate), now = Date.now();
  const totalMs = dueDate - now;
  if (totalMs <= 0) return;
  const reminderAt = new Date(now + totalMs * 0.75);
  const party = commitment.counterpartyName ? ` for ${commitment.counterpartyName}` : '';
  const body  = `Commitment due soon${party}: "${commitment.text.slice(0, 80)}"`;
  await db.query(`INSERT INTO rules(id,user_id,name,condition,action,cooldown_seconds,source,mode) VALUES($1,$2,$3,$4,$5,86400,'system','live')`, [uuid(), userId, `Follow-up: ${commitment.text.slice(0, 50)}`, JSON.stringify({ op: 'AND', args: [{ op: 'EQ', left: { var: 'time.hour' }, right: { const: reminderAt.getHours() } }, { op: 'GTE', left: { var: 'item.persistence_days' }, right: { const: 0 } }] }), JSON.stringify({ type: 'NOTIFY', title: 'Commitment reminder', body, dedupe: `commitment-${commitmentId}` }), 86400]).catch(() => {});
}

module.exports = { extractCommitments, saveCommitment, processCommitmentsFromEntry, getOpenCommitments, fulfillCommitment };
