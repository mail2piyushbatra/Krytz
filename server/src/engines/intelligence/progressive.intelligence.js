/**
 * âœ¦ PROGRESSIVE INTELLIGENCE
 * Day 1 â†’ simple, Day 7 â†’ personalized, Day 30 â†’ predictive.
 * Cold start bootstrap: helpful empty state for new users.
 */
'use strict';

const STAGES = {
  simple:       { name: 'simple',       minEntries: 0,  minDays: 0,  maxNextItems: 3, showConfidence: false, useSemanticRank: false, useRules: false, planMessage: "Getting started â€” just capture things and we'll track them." },
  personalized: { name: 'personalized', minEntries: 10, minDays: 7,  maxNextItems: 5, showConfidence: true,  useSemanticRank: true,  useRules: true,  planMessage: null },
  predictive:   { name: 'predictive',   minEntries: 50, minDays: 30, maxNextItems: 5, showConfidence: true,  useSemanticRank: true,  useRules: true,  proactive: true, planMessage: null },
};

async function getUserStage(db, userId) {
  const { rows: cached } = await db.query(`SELECT stage, entries_count, first_entry_at FROM user_intelligence_stage WHERE user_id=$1`, [userId]);
  if (cached.length > 0) { const row = cached[0]; const upgraded = await _maybeUpgrade(db, userId, row.stage, row.entries_count, row.first_entry_at); return STAGES[upgraded] || STAGES.simple; }
  const { rows: entryInfo } = await db.query(`SELECT count(*) AS n, MIN(timestamp) AS first_at FROM entries WHERE user_id=$1`, [userId]);
  const count = parseInt(entryInfo[0]?.n || 0), firstAt = entryInfo[0]?.first_at;
  const stage = _computeStage(count, firstAt);
  await db.query(`INSERT INTO user_intelligence_stage(user_id,stage,entries_count,first_entry_at) VALUES($1,$2,$3,$4) ON CONFLICT(user_id) DO UPDATE SET stage=EXCLUDED.stage, entries_count=EXCLUDED.entries_count, updated_at=now()`, [userId, stage, count, firstAt]);
  return STAGES[stage] || STAGES.simple;
}

function getColdStartPlan(timezone = 'UTC') {
  return { focus: null, next: [], blockers: [], carryovers: [], totalOpen: 0, confidence: 0, empty: true, coldStart: true, stage: 'simple', message: "Welcome to Krytz. Start by capturing anything on your mind â€” tasks, notes, ideas. We'll handle the rest.", suggestions: ["Try: 'Finish the project proposal by Friday'", "Try: 'Call the client about the contract'", "Try: 'Buy groceries â€” milk, eggs, bread'"], generatedAt: new Date().toISOString() };
}

function applyStageToplan(plan, stage) {
  const s = STAGES[stage] || STAGES.simple;
  return { ...plan, next: plan.next.slice(0, s.maxNextItems), confidence: s.showConfidence ? plan.confidence : undefined, stage: s.name, message: s.planMessage || undefined };
}

async function onEntryCreated(db, userId) {
  await db.query(`INSERT INTO user_intelligence_stage(user_id,stage,entries_count,first_entry_at) VALUES($1,'simple',1,now()) ON CONFLICT(user_id) DO UPDATE SET entries_count=user_intelligence_stage.entries_count+1, updated_at=now()`, [userId]);
  const { rows } = await db.query(`SELECT stage, entries_count, first_entry_at FROM user_intelligence_stage WHERE user_id=$1`, [userId]);
  if (rows.length > 0) await _maybeUpgrade(db, userId, rows[0].stage, rows[0].entries_count, rows[0].first_entry_at);
}

async function recordSuggestionEvent(db, userId, itemId, eventType, planConfidence) {
  await db.query(`INSERT INTO suggestion_events(user_id,item_id,event_type,plan_confidence) VALUES($1,$2,$3,$4)`, [userId, itemId, eventType, planConfidence || null]);
}

async function getSuggestionMetrics(db, userId, windowDays = 7) {
  const { rows } = await db.query(`SELECT event_type, count(*) AS n FROM suggestion_events WHERE user_id=$1 AND created_at > now() - $2::interval GROUP BY event_type`, [userId, `${windowDays} days`]);
  const counts = {};
  for (const r of rows) counts[r.event_type] = parseInt(r.n);
  const shown = counts.shown || 0, accepted = counts.accepted || 0, ignored = counts.ignored || 0;
  return { shown, accepted, ignored, snoozed: counts.snoozed || 0, dropped: counts.dropped || 0, acceptRate: shown > 0 ? parseFloat((accepted/shown).toFixed(3)) : null, ignoreRate: shown > 0 ? parseFloat((ignored/shown).toFixed(3)) : null };
}

function _computeStage(entryCount, firstAt) {
  if (!firstAt || entryCount < STAGES.personalized.minEntries) return 'simple';
  const daysSince = (Date.now() - new Date(firstAt).getTime()) / 86_400_000;
  if (daysSince >= STAGES.predictive.minDays && entryCount >= STAGES.predictive.minEntries) return 'predictive';
  if (daysSince >= STAGES.personalized.minDays && entryCount >= STAGES.personalized.minEntries) return 'personalized';
  return 'simple';
}

async function _maybeUpgrade(db, userId, currentStage, entryCount, firstAt) {
  const newStage = _computeStage(entryCount, firstAt);
  if (newStage !== currentStage) { await db.query(`UPDATE user_intelligence_stage SET stage=$2, updated_at=now() WHERE user_id=$1`, [userId, newStage]); return newStage; }
  return currentStage;
}

module.exports = { getUserStage, getColdStartPlan, applyStageToplan, onEntryCreated, recordSuggestionEvent, getSuggestionMetrics, STAGES };
