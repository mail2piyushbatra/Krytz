/**
 * ✦ WORKLOAD + CAPACITY MODEL
 * Answers: Am I overcommitted? Am I burning out? Am I in recovery?
 * Exposed via: GET /capacity
 */
'use strict';

const DEFAULT_FOCUS_HOURS_PER_DAY = 6;
const DEFAULT_WORK_DAYS_PER_WEEK  = 5;

async function computeCapacity(db, userId) {
  const [openLoad, weekHistory, streak] = await Promise.all([
    _getOpenLoad(db, userId),
    _getWeekHistory(db, userId),
    _getStreak(db, userId),
  ]);
  const availMinsThisWeek = DEFAULT_FOCUS_HOURS_PER_DAY * DEFAULT_WORK_DAYS_PER_WEEK * 60;
  const capacityRatio     = openLoad.totalEstimatedMins / availMinsThisWeek;
  const burnout   = _detectBurnout(weekHistory, streak);
  const recovery  = _detectRecovery(weekHistory);
  const overload  = _describeOverload(capacityRatio, openLoad);

  return {
    capacity: { totalEstimatedMins: openLoad.totalEstimatedMins, availMinsThisWeek, capacityRatio: parseFloat(capacityRatio.toFixed(2)), overloadedBy: Math.max(0, openLoad.totalEstimatedMins - availMinsThisWeek), status: capacityRatio > 1.4 ? 'overloaded' : capacityRatio > 1.1 ? 'stretched' : capacityRatio > 0.8 ? 'healthy' : 'underloaded', insight: overload, openItems: openLoad.itemCount, byProject: openLoad.byProject },
    burnout:  { risk: burnout.risk, signals: burnout.signals, insight: burnout.insight },
    recovery: { inRecovery: recovery.inRecovery, insight: recovery.insight },
    streak:   { current: streak.current, longest: streak.longest, broken: streak.broken },
    recommendation: _recommend(capacityRatio, burnout.risk, recovery.inRecovery),
  };
}

async function _getOpenLoad(db, userId) {
  const { rows } = await db.query(`SELECT count(*) AS item_count, sum(COALESCE(estimated_mins, 60)) AS total_mins, project FROM items WHERE user_id=$1 AND state IN ('OPEN','IN_PROGRESS') GROUP BY project`, [userId]).catch(() => ({ rows: [] }));
  return { totalEstimatedMins: rows.reduce((s, r) => s + parseInt(r.total_mins || 0), 0), itemCount: rows.reduce((s, r) => s + parseInt(r.item_count || 0), 0), byProject: rows.map(r => ({ project: r.project || 'general', items: parseInt(r.item_count), estimatedMins: parseInt(r.total_mins || 0) })) };
}

async function _getWeekHistory(db, userId) {
  const { rows } = await db.query(`SELECT date, completed_count, open_items, blocker_count FROM daily_states WHERE user_id=$1 AND date >= CURRENT_DATE - 14 ORDER BY date ASC`, [userId]).catch(() => ({ rows: [] }));
  return rows;
}

async function _getStreak(db, userId) {
  const { rows } = await db.query(
    `WITH daily AS (SELECT DISTINCT timestamp::date AS d FROM entries WHERE user_id=$1), streak_groups AS (SELECT d, d - (ROW_NUMBER() OVER (ORDER BY d))::int AS grp FROM daily)
     SELECT (SELECT count(*) FROM streak_groups WHERE grp = (SELECT grp FROM streak_groups ORDER BY d DESC LIMIT 1)) AS current, max(count(*)) OVER () AS longest, (CURRENT_DATE NOT IN (SELECT d FROM daily)) AS broken FROM streak_groups GROUP BY grp ORDER BY max(d) DESC LIMIT 1`,
    [userId]
  ).catch(() => ({ rows: [{ current: 0, longest: 0, broken: true }] }));
  return { current: parseInt(rows[0]?.current || 0), longest: parseInt(rows[0]?.longest || 0), broken: rows[0]?.broken || false };
}

function _detectBurnout(weekHistory, streak) {
  const signals = [];
  if (weekHistory.length < 4) return { risk: 'none', signals: [], insight: 'Not enough history to assess burnout risk.' };
  const recent = weekHistory.slice(-7), earlier = weekHistory.slice(0, 7);
  const avgC_r = _avg(recent.map(d => d.completed_count)), avgC_e = _avg(earlier.map(d => d.completed_count));
  if (avgC_r < avgC_e * 0.6 && avgC_e > 0) signals.push(`Completion rate dropped ${Math.round((1 - avgC_r/avgC_e)*100)}% vs last week`);
  const firstOpen = parseInt(recent[0]?.open_items || 0), lastOpen = parseInt(recent[recent.length-1]?.open_items || 0);
  if (lastOpen > firstOpen * 1.5 && firstOpen > 3) signals.push(`Open items grew ${lastOpen - firstOpen} over the last 7 days`);
  const avgB_r = _avg(recent.map(d => d.blocker_count)), avgB_e = _avg(earlier.map(d => d.blocker_count));
  if (avgB_r > avgB_e * 1.5 && avgB_r > 1) signals.push(`Blockers increased significantly`);
  if (streak.broken && streak.current < streak.longest * 0.5) signals.push(`Daily capture streak broken`);
  const risk = signals.length >= 3 ? 'high' : signals.length === 2 ? 'medium' : signals.length === 1 ? 'low' : 'none';
  return { risk, signals, insight: risk === 'none' ? 'No burnout signals detected.' : `${signals.length} burnout signal${signals.length > 1 ? 's' : ''} detected. Consider reducing load.` };
}

function _detectRecovery(weekHistory) {
  if (weekHistory.length < 10) return { inRecovery: false, insight: null };
  const recent = weekHistory.slice(-4), previous = weekHistory.slice(-8, -4);
  const inRecovery = _avg(recent.map(d => d.completed_count)) > _avg(previous.map(d => d.completed_count)) * 1.3 && _avg(previous.map(d => d.completed_count)) < 2;
  return { inRecovery, insight: inRecovery ? 'Your completion rate is recovering after a slow period. Keep the momentum.' : null };
}

function _describeOverload(ratio, load) {
  if (ratio <= 1.0) { const pct = Math.round(ratio * 100); return `You're at ${pct}% capacity — ${pct < 70 ? 'room for more' : 'well-loaded'}.`; }
  const overHours = Math.round((load.totalEstimatedMins - 1800) / 60);
  return `You're ~${overHours}h over capacity this week. Consider dropping or deferring ${Math.ceil(overHours / 1.5)} tasks.`;
}

function _recommend(ratio, burnoutRisk, inRecovery) {
  if (burnoutRisk === 'high') return 'Reduce workload now. Drop or defer at least 30% of open tasks.';
  if (ratio > 1.4)            return 'You are overcommitted. Use the what-if simulator to see what to drop.';
  if (inRecovery)             return 'Good momentum. Maintain current pace — do not overload.';
  if (ratio < 0.5)            return 'Plenty of capacity. Good time to tackle backlog items.';
  return 'Workload looks healthy.';
}

function _avg(arr) { return arr.length ? arr.reduce((s, v) => s + (parseInt(v) || 0), 0) / arr.length : 0; }

module.exports = { computeCapacity };
