/**
 * ✦ PLAN ENGINE
 * Powers GET /plan/today — assembles focus task + next tasks + blockers.
 * Algorithm: score items (recency + frequency + deadline + blocker + causal),
 * cache result 5 min, expose GET /explain/:itemId.
 */
'use strict';

const logger = { info: (msg, m = {}) => console.log(JSON.stringify({ level: 'info', ts: new Date().toISOString(), system: 'plan-engine', msg, ...m })) };

const CACHE_TTL_MINUTES = 5;

async function buildTodayPlan(db, userId, timezone = 'UTC') {
  const cached = await _getCachedPlan(db, userId, timezone);
  if (cached) { logger.info('Plan cache hit', { userId }); return { ...cached, fromCache: true }; }

  const { rows: items } = await db.query(
    `SELECT i.*,
            EXTRACT(EPOCH FROM (now() - i.last_seen))  / 86400 AS recency_days,
            EXTRACT(EPOCH FROM (now() - i.first_seen)) / 86400 AS persistence_days,
            EXTRACT(EPOCH FROM (i.deadline - now()))   / 86400 AS deadline_days,
            (SELECT count(*) FROM item_edges e JOIN items d ON d.id = e.to_item WHERE e.from_item = i.id AND d.state NOT IN ('DONE','DROPPED')) AS downstream_open,
            EXISTS(SELECT 1 FROM snoozes s WHERE s.item_id = i.id AND s.user_id = $1 AND s.snooze_until > now()) AS snoozed
     FROM items i WHERE i.user_id = $1 AND i.state IN ('OPEN', 'IN_PROGRESS') ORDER BY i.priority DESC`,
    [userId]
  );

  const active = items.filter(i => !i.snoozed);
  if (active.length === 0) return _emptyPlan(userId, timezone);

  const scored   = active.map(i => ({ ...i, _score: _scoreItem(i) })).sort((a, b) => b._score - a._score);
  const blockers  = scored.filter(i => i.blocker);
  const actionable = scored.filter(i => !i.blocker);
  const inProgress = actionable.filter(i => i.state === 'IN_PROGRESS');
  const focus      = inProgress[0] || actionable[0] || null;
  const next       = actionable.filter(i => i.id !== focus?.id).slice(0, 5);
  const carryovers = actionable.filter(i => i.id !== focus?.id && parseFloat(i.persistence_days) > 2).slice(0, 3);
  const confidence = _computePlanConfidence(active.length, focus);

  const plan = { userId, timezone, focus: focus ? _serializeItem(focus) : null, next: next.map(_serializeItem), blockers: blockers.slice(0, 3).map(_serializeItem), carryovers: carryovers.map(_serializeItem), totalOpen: active.length, confidence, generatedAt: new Date().toISOString() };
  await _cachePlan(db, userId, timezone, plan);
  logger.info('Plan built', { userId, totalOpen: active.length });
  return plan;
}

async function explainItem(db, userId, itemId) {
  const { rows } = await db.query(
    `SELECT i.*, EXTRACT(EPOCH FROM (now() - i.last_seen)) / 86400 AS recency_days, EXTRACT(EPOCH FROM (now() - i.first_seen)) / 86400 AS persistence_days, EXTRACT(EPOCH FROM (i.deadline - now())) / 86400 AS deadline_days, (SELECT count(*) FROM item_edges e JOIN items d ON d.id = e.to_item WHERE e.from_item = i.id AND d.state NOT IN ('DONE','DROPPED')) AS downstream_open FROM items i WHERE i.id = $1 AND i.user_id = $2`,
    [itemId, userId]
  );
  if (rows.length === 0) throw Object.assign(new Error('Item not found'), { status: 404 });
  const item = rows[0];
  const factors = [];
  const recencyDays = parseFloat(item.recency_days || 0);
  const persistDays = parseFloat(item.persistence_days || 0);
  const deadlineDays = item.deadline_days != null ? parseFloat(item.deadline_days) : null;
  const downstreamOpen = parseInt(item.downstream_open || 0);
  if (item.state === 'IN_PROGRESS') factors.push({ key: 'in_progress', text: 'You already started this', weight: 'high' });
  if (deadlineDays !== null && deadlineDays <= 1) factors.push({ key: 'deadline_urgent', text: 'Due very soon', weight: 'high' });
  else if (deadlineDays !== null && deadlineDays <= 3) factors.push({ key: 'deadline_close', text: `Due in ${Math.round(deadlineDays)} days`, weight: 'medium' });
  if (downstreamOpen > 0) factors.push({ key: 'blocking', text: `Blocking ${downstreamOpen} other task${downstreamOpen > 1 ? 's' : ''}`, weight: 'high' });
  if (item.mention_count >= 3) factors.push({ key: 'recurring', text: `Mentioned ${item.mention_count} times`, weight: 'medium' });
  if (persistDays > 3) factors.push({ key: 'stale', text: `Open for ${Math.round(persistDays)} days`, weight: 'medium' });
  const { rows: transitions } = await db.query(`SELECT from_state, to_state, confidence, reason, created_at FROM item_events WHERE item_id = $1 ORDER BY created_at DESC LIMIT 3`, [itemId]);
  return { itemId, text: item.canonical_text, state: item.state, priority: item.priority, score: parseFloat(_scoreItem(item).toFixed(3)), factors: factors.slice(0, 3), transitions: transitions.map(t => ({ from: t.from_state, to: t.to_state, when: t.created_at, reason: t.reason })) };
}

function _scoreItem(item) {
  const recency  = Math.max(0, 1 - (parseFloat(item.recency_days)  || 0) / 7);
  const freq     = Math.min(1, (item.mention_count || 1) / 5);
  const deadline = item.deadline_days != null ? Math.max(0, 1 - parseFloat(item.deadline_days) / 7) : 0;
  const blocker  = item.blocker ? 1.0 : 0;
  const causal   = Math.min(1, parseInt(item.downstream_open || 0) / 5);
  const inProg   = item.state === 'IN_PROGRESS' ? 0.2 : 0;
  return 0.30*recency + 0.20*freq + 0.20*deadline + 0.15*blocker + 0.10*causal + 0.05*inProg;
}

function _computePlanConfidence(itemCount, focus) {
  if (!focus)              return 0.2;
  if (itemCount < 3)       return 0.5;
  if (focus.mention_count >= 3) return 0.85;
  return 0.70;
}

function _serializeItem(item) {
  return { id: item.id, text: item.canonical_text, state: item.state, project: item.project, priority: parseFloat((item.priority || 0).toFixed(3)), score: item._score ? parseFloat(item._score.toFixed(3)) : undefined, blocker: item.blocker || false, deadlineDays: item.deadline_days != null ? Math.round(parseFloat(item.deadline_days)) : null, persistDays: item.persistence_days ? Math.round(parseFloat(item.persistence_days)) : 0, downstreamOpen: parseInt(item.downstream_open || 0) };
}

function _emptyPlan(userId, timezone) {
  return { userId, timezone, focus: null, next: [], blockers: [], carryovers: [], totalOpen: 0, confidence: 0, empty: true, message: 'Nothing open — great job, or add something to capture.', generatedAt: new Date().toISOString() };
}

async function _getCachedPlan(db, userId, timezone) {
  try { const { rows } = await db.query(`SELECT plan FROM plan_cache WHERE user_id=$1 AND date=CURRENT_DATE AND timezone=$2 AND generated_at > now() - interval '${CACHE_TTL_MINUTES} minutes' ORDER BY generated_at DESC LIMIT 1`, [userId, timezone]); return rows.length > 0 ? rows[0].plan : null; } catch (_) { return null; }
}

async function _cachePlan(db, userId, timezone, plan) {
  try { await db.query(`INSERT INTO plan_cache(user_id, date, timezone, plan) VALUES($1, CURRENT_DATE, $2, $3) ON CONFLICT(user_id, date, timezone) DO UPDATE SET plan=EXCLUDED.plan, generated_at=now()`, [userId, timezone, JSON.stringify(plan)]); } catch (_) {}
}

async function invalidatePlanCache(db, userId) {
  await db.query(`DELETE FROM plan_cache WHERE user_id=$1 AND date=CURRENT_DATE`, [userId]);
}

module.exports = { buildTodayPlan, explainItem, invalidatePlanCache };
