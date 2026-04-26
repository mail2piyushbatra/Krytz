/**
 * ✦ WEEKLY PLANNER
 * Clusters open items by project → scores goal clusters → allocates weekly hours.
 * Top 3 goals max (Doc 7). Exposed via: GET /plan/week
 */
'use strict';

const GOAL_WEIGHTS = { urgency: 0.35, causalImportance: 0.25, backlogSize: 0.20, recency: 0.20 };

async function buildWeeklyPlan(db, userId, timezone = 'UTC') {
  const { rows: items } = await db.query(
    `SELECT i.*, EXTRACT(EPOCH FROM (now() - i.last_seen)) / 86400 AS recency_days, EXTRACT(EPOCH FROM (i.deadline - now())) / 86400 AS deadline_days, (SELECT count(*) FROM item_edges e JOIN items d ON d.id=e.to_item WHERE e.from_item=i.id AND d.state NOT IN ('DONE','DROPPED')) AS downstream_open FROM items i WHERE i.user_id=$1 AND i.state IN ('OPEN','IN_PROGRESS') ORDER BY i.priority DESC`,
    [userId]
  );

  if (items.length === 0) return { goals: [], weeklyHours: 40, empty: true, generatedAt: new Date().toISOString() };

  const clusters       = _clusterItems(items);
  const scoredClusters = clusters.map(cluster => ({ ...cluster, score: _scoreCluster(cluster) })).sort((a, b) => b.score - a.score);
  const topGoals       = scoredClusters.slice(0, 3);
  const totalScore     = topGoals.reduce((s, g) => s + g.score, 0);
  const WEEKLY_HOURS   = 40;

  const goals = topGoals.map(goal => ({ name: goal.name, items: goal.items.map(_serializeItem), score: parseFloat(goal.score.toFixed(3)), allocatedHours: totalScore > 0 ? Math.round((goal.score / totalScore) * WEEKLY_HOURS) : Math.floor(WEEKLY_HOURS / topGoals.length), focusItem: goal.items[0] ? _serializeItem(goal.items[0]) : null, urgency: goal.urgency, hasDeadline: goal.hasDeadline, blockerCount: goal.blockerCount, progress: { openItems: goal.items.length } }));

  const { rows: weeklyStats } = await db.query(`SELECT date, open_items, completed_count, blocker_count FROM daily_states WHERE user_id=$1 AND date >= CURRENT_DATE - 7 ORDER BY date ASC`, [userId]).catch(() => ({ rows: [] }));

  return { goals, weeklyHours: WEEKLY_HOURS, weeklyStats: weeklyStats || [], totalOpenItems: items.length, generatedAt: new Date().toISOString() };
}

function _clusterItems(items) {
  const byProject = {};
  for (const item of items) { const key = item.project || '_unassigned'; if (!byProject[key]) byProject[key] = []; byProject[key].push(item); }
  return Object.entries(byProject).map(([project, projectItems]) => ({ name: project === '_unassigned' ? 'General' : project, project, items: projectItems.sort((a, b) => (b.priority||0) - (a.priority||0)), urgency: _clusterUrgency(projectItems), hasDeadline: projectItems.some(i => i.deadline_days !== null && parseFloat(i.deadline_days || 999) < 7), blockerCount: projectItems.filter(i => i.blocker).length }));
}

function _clusterUrgency(items) {
  const min = Math.min(...items.map(i => i.deadline_days != null ? parseFloat(i.deadline_days) : 999));
  return min <= 1 ? 'critical' : min <= 3 ? 'high' : min <= 7 ? 'medium' : 'low';
}

function _scoreCluster(cluster) {
  const urgencyScore    = { critical: 1.0, high: 0.75, medium: 0.5, low: 0.25 }[cluster.urgency] || 0.25;
  const causalImportance = Math.min(1, cluster.items.reduce((s, i) => s + parseInt(i.downstream_open||0), 0) / 10);
  const backlogSize     = Math.min(1, cluster.items.length / 10);
  const minRecency      = Math.min(...cluster.items.map(i => parseFloat(i.recency_days||0)));
  const recency         = Math.max(0, 1 - minRecency / 7);
  return GOAL_WEIGHTS.urgency * urgencyScore + GOAL_WEIGHTS.causalImportance * causalImportance + GOAL_WEIGHTS.backlogSize * backlogSize + GOAL_WEIGHTS.recency * recency;
}

function _serializeItem(item) { return { id: item.id, text: item.canonical_text, state: item.state, priority: parseFloat((item.priority||0).toFixed(3)), blocker: item.blocker||false, deadlineDays: item.deadline_days != null ? Math.round(parseFloat(item.deadline_days)) : null }; }

module.exports = { buildWeeklyPlan };
