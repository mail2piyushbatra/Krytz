/**
 * ✦ CONTRADICTION DETECTOR
 * Detects 3 classes post-ingest: deadline conflicts, schedule overloads, commitment conflicts.
 * Persists contradictions + creates notifications.
 */
'use strict';

const { v4: uuid } = require('uuid');
const logger = { info: (msg, m={}) => console.log(JSON.stringify({level:'info',ts:new Date().toISOString(),system:'contradiction-detector',msg,...m})), warn: (msg, m={}) => console.warn(JSON.stringify({level:'warn',ts:new Date().toISOString(),system:'contradiction-detector',msg,...m})) };

async function scanForContradictions(db, userId, newItemIds = []) {
  const [type1, type2, type3] = await Promise.all([detectDeadlineConflicts(db, userId, newItemIds), detectScheduleClashes(db, userId), detectCommitmentConflicts(db, userId, newItemIds)]);
  const found = [...type1, ...type2, ...type3];
  for (const c of found) await _persistContradiction(db, userId, c);
  if (found.length > 0) logger.info('Contradictions detected', { userId, count: found.length, types: found.map(c => c.type) });
  return found;
}

async function detectDeadlineConflicts(db, userId) {
  const { rows } = await db.query(`SELECT a.id AS item_a_id, a.canonical_text AS item_a_text, a.deadline AS deadline_a, b.id AS item_b_id, b.canonical_text AS item_b_text, b.deadline AS deadline_b, e.type AS edge_type FROM item_edges e JOIN items a ON a.id = e.to_item JOIN items b ON b.id = e.from_item WHERE e.user_id=$1 AND a.deadline IS NOT NULL AND b.deadline IS NOT NULL AND a.state NOT IN ('DONE','DROPPED') AND b.state NOT IN ('DONE','DROPPED')`, [userId]);
  const conflicts = [];
  for (const row of rows) {
    const deadlineA = new Date(row.deadline_a), deadlineB = new Date(row.deadline_b);
    if (deadlineA < deadlineB) conflicts.push({ type: 'DEADLINE_CONFLICT', severity: _deadlineSeverity(deadlineA, deadlineB), itemAId: row.item_a_id, itemBId: row.item_b_id, message: `"${_short(row.item_a_text)}" is due ${_relDate(deadlineA)} but depends on "${_short(row.item_b_text)}" which is due ${_relDate(deadlineB)} — impossible order.`, detail: { itemA: { id: row.item_a_id, text: row.item_a_text, deadline: row.deadline_a }, itemB: { id: row.item_b_id, text: row.item_b_text, deadline: row.deadline_b }, edge: row.edge_type } });
  }
  return conflicts;
}

async function detectScheduleClashes(db, userId) {
  const { rows } = await db.query(`SELECT id, canonical_text, deadline, priority, estimated_mins FROM items WHERE user_id=$1 AND state IN ('OPEN','IN_PROGRESS') AND deadline::date = CURRENT_DATE ORDER BY priority DESC`, [userId]);
  if (rows.length < 2) return [];
  const totalMins = rows.reduce((s, r) => s + (parseInt(r.estimated_mins) || 60), 0);
  if (totalMins <= 480) return [];
  return [{ type: 'SCHEDULE_OVERLOAD', severity: totalMins > 960 ? 'high' : 'medium', message: `${rows.length} tasks due today totalling ~${Math.round(totalMins/60)}h. Available time is ~8h.`, detail: { tasks: rows.map(r => ({ id: r.id, text: _short(r.canonical_text), estimatedMins: r.estimated_mins || 60 })), totalMins, availMins: 480, overloadMins: totalMins - 480 } }];
}

async function detectCommitmentConflicts(db, userId) {
  const { rows } = await db.query(`SELECT c1.id AS c1_id, c1.commitment_text, c1.due_date AS c1_due, c1.counterparty_name AS c1_party, c2.id AS c2_id, c2.commitment_text AS c2_text, c2.due_date AS c2_due, c2.counterparty_name AS c2_party FROM commitments c1 JOIN commitment_dependencies cd ON cd.commitment_id=c1.id JOIN commitments c2 ON c2.id=cd.depends_on_id WHERE c1.user_id=$1 AND c1.status='open' AND c2.status='open' AND c1.due_date IS NOT NULL AND c2.due_date IS NOT NULL AND c1.due_date < c2.due_date`, [userId]).catch(() => ({ rows: [] }));
  return rows.map(row => ({ type: 'COMMITMENT_CONFLICT', severity: 'high', message: `You promised "${_short(row.commitment_text)}" to ${row.c1_party} by ${_relDate(new Date(row.c1_due))}, but it depends on "${_short(row.c2_text)}" which isn't due until ${_relDate(new Date(row.c2_due))}.`, detail: { commitment1: { id: row.c1_id, text: row.commitment_text, dueDate: row.c1_due, party: row.c1_party }, commitment2: { id: row.c2_id, text: row.c2_text, dueDate: row.c2_due, party: row.c2_party } } }));
}

async function _persistContradiction(db, userId, contradiction) {
  const hash = require('crypto').createHash('md5').update(`${userId}:${contradiction.type}:${contradiction.message}`).digest('hex').slice(0, 16);
  const { rows: existing } = await db.query(`SELECT id FROM contradictions WHERE user_id=$1 AND hash=$2 AND resolved=false`, [userId, hash]).catch(() => ({ rows: [] }));
  if (existing.length > 0) return;
  await db.query(`INSERT INTO contradictions(id,user_id,type,severity,message,detail,hash) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`, [uuid(), userId, contradiction.type, contradiction.severity || 'medium', contradiction.message, JSON.stringify(contradiction.detail), hash]).catch(() => {});
  await db.query(`INSERT INTO notifications(id,user_id,type,title,body,meta) VALUES($1,$2,'alert','Conflict detected',$3,$4)`, [uuid(), userId, contradiction.message, JSON.stringify({ contradictionType: contradiction.type })]).catch(() => {});
}

async function getContradictions(db, userId) {
  const { rows } = await db.query(`SELECT id,type,severity,message,detail,created_at FROM contradictions WHERE user_id=$1 AND resolved=false ORDER BY CASE severity WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, created_at DESC`, [userId]).catch(() => ({ rows: [] }));
  return rows;
}

async function resolveContradiction(db, userId, contradictionId) {
  await db.query(`UPDATE contradictions SET resolved=true, resolved_at=now() WHERE id=$1 AND user_id=$2`, [contradictionId, userId]);
}

function _short(text, max = 40) { return text?.length > max ? text.slice(0, max) + '…' : text; }
function _relDate(date) { const days = Math.round((date - Date.now()) / 86_400_000); return days === 0 ? 'today' : days === 1 ? 'tomorrow' : days === -1 ? 'yesterday' : days < 0 ? `${Math.abs(days)} days ago` : `in ${days} days`; }
function _deadlineSeverity(dateA, dateB) { const gap = Math.abs((dateB - dateA) / 86_400_000); return gap <= 1 ? 'high' : gap <= 3 ? 'medium' : 'low'; }

module.exports = { scanForContradictions, getContradictions, resolveContradiction, detectDeadlineConflicts, detectScheduleClashes };
