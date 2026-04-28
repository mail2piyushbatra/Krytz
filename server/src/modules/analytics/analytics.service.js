/**
 * ✦ FLOWRA — Analytics Service
 *
 * Big-picture intelligence over the items ledger.
 * Category health, blocker clusters, completion velocity,
 * focus allocation — the CEO dashboard data layer.
 */

const db = require('../../lib/db');
const logger = require('../../lib/logger');

// ─── Overview: category health + cross-cutting signals ─────────────────────────

async function getOverview(userId) {
  // 1. Category health
  const categoryHealth = await db.query(
    `SELECT
       COALESCE(i.category, 'uncategorized') AS category,
       COUNT(*) FILTER (WHERE i.state = 'OPEN')::int AS open_count,
       COUNT(*) FILTER (WHERE i.state = 'IN_PROGRESS')::int AS in_progress_count,
       COUNT(*) FILTER (WHERE i.blocker = true AND i.state IN ('OPEN','IN_PROGRESS'))::int AS blocked,
       COUNT(*) FILTER (WHERE i.state = 'DONE')::int AS done_total,
       COUNT(*) FILTER (WHERE i.state = 'DONE' AND i.updated_at >= NOW() - INTERVAL '7 days')::int AS done_this_week,
       MAX(CASE WHEN i.state IN ('OPEN','IN_PROGRESS')
           THEN EXTRACT(EPOCH FROM (NOW() - i.last_seen)) / 86400 END)::numeric(10,1) AS max_stale_days,
       AVG(CASE WHEN i.state = 'DONE'
           THEN EXTRACT(EPOCH FROM (i.updated_at - i.first_seen)) / 86400 END)::numeric(10,1) AS avg_completion_days
     FROM items i
     WHERE i.user_id = $1
     GROUP BY COALESCE(i.category, 'uncategorized')
     ORDER BY COUNT(*) FILTER (WHERE i.state = 'OPEN') + COUNT(*) FILTER (WHERE i.state = 'IN_PROGRESS') DESC`,
    [userId]
  );

  const categories = categoryHealth.rows.map(r => {
    const active = parseInt(r.open_count) + parseInt(r.in_progress_count);
    const blocked = parseInt(r.blocked);
    const staleDays = parseFloat(r.max_stale_days) || 0;

    let health;
    if (blocked > 0 && staleDays > 7) health = 'stalled';
    else if (blocked > 0) health = 'at-risk';
    else if (active === 0) health = 'clear';
    else health = 'active';

    return {
      name:             r.category,
      open:             parseInt(r.open_count),
      inProgress:       parseInt(r.in_progress_count),
      blocked:          blocked,
      doneTotal:        parseInt(r.done_total),
      doneThisWeek:     parseInt(r.done_this_week),
      avgCompletionDays: r.avg_completion_days ? parseFloat(r.avg_completion_days) : null,
      maxStaleDays:     staleDays,
      health,
    };
  });

  // 2. Top blockers (items flagged as blockers, grouped by similarity)
  const blockers = await db.query(
    `SELECT id, canonical_text, category, blocker,
            EXTRACT(EPOCH FROM (NOW() - last_seen)) / 86400 AS stale_days
     FROM items
     WHERE user_id = $1 AND blocker = true AND state IN ('OPEN', 'IN_PROGRESS')
     ORDER BY last_seen ASC
     LIMIT 10`,
    [userId]
  );

  // 3. Focus allocation — proportion of active items per category
  const totalActive = categories.reduce((sum, c) => sum + c.open + c.inProgress, 0);
  const focusAllocation = {};
  for (const c of categories) {
    const active = c.open + c.inProgress;
    if (active > 0) {
      focusAllocation[c.name] = totalActive > 0 ? parseFloat((active / totalActive).toFixed(2)) : 0;
    }
  }

  // 4. Weekly velocity — items created vs completed in last 7 days
  const velocity = await db.query(
    `SELECT
       COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days')::int AS created,
       COUNT(*) FILTER (WHERE state = 'DONE' AND updated_at >= NOW() - INTERVAL '7 days')::int AS completed
     FROM items
     WHERE user_id = $1`,
    [userId]
  );

  const created = velocity.rows[0].created;
  const completed = velocity.rows[0].completed;

  // 5. Completion trend — compare this week vs last week
  const lastWeek = await db.query(
    `SELECT COUNT(*)::int AS completed
     FROM items i
     JOIN item_events ie ON ie.item_id = i.id AND ie.to_state = 'DONE'
     WHERE i.user_id = $1
       AND ie.created_at >= NOW() - INTERVAL '14 days'
       AND ie.created_at < NOW() - INTERVAL '7 days'`,
    [userId]
  );

  const lastWeekCompleted = lastWeek.rows[0].completed;
  let completionTrend = 'stable';
  if (completed > lastWeekCompleted * 1.2) completionTrend = 'improving';
  else if (completed < lastWeekCompleted * 0.8) completionTrend = 'declining';

  // 6. Summary counts
  const totals = await db.query(
    `SELECT
       COUNT(*) FILTER (WHERE state = 'OPEN')::int AS total_open,
       COUNT(*) FILTER (WHERE state = 'IN_PROGRESS')::int AS total_in_progress,
       COUNT(*) FILTER (WHERE blocker = true AND state IN ('OPEN','IN_PROGRESS'))::int AS total_blocked,
       COUNT(*) FILTER (WHERE state = 'DONE')::int AS total_done,
       COUNT(*) FILTER (WHERE deadline IS NOT NULL AND deadline < NOW() AND state NOT IN ('DONE','DROPPED'))::int AS overdue
     FROM items WHERE user_id = $1`,
    [userId]
  );

  return {
    summary: {
      totalOpen:       totals.rows[0].total_open,
      totalInProgress: totals.rows[0].total_in_progress,
      totalBlocked:    totals.rows[0].total_blocked,
      totalDone:       totals.rows[0].total_done,
      overdue:         totals.rows[0].overdue,
    },
    categories,
    topBlockers: blockers.rows.map(b => ({
      id:        b.id,
      text:      b.canonical_text,
      category:  b.category,
      staleDays: parseFloat(parseFloat(b.stale_days).toFixed(1)),
    })),
    crossCutting: {
      focusAllocation,
      weeklyVelocity: { created, completed, net: completed - created },
      completionTrend,
    },
  };
}

// ─── Category-specific deep dive ──────────────────────────────────────────────

async function getCategoryAnalytics(userId, categoryName) {
  // Items in this category
  const items = await db.query(
    `SELECT * FROM items
     WHERE user_id = $1 AND category = $2
     ORDER BY
       CASE WHEN state = 'DONE' THEN 1 ELSE 0 END,
       blocker DESC, priority DESC, last_seen DESC
     LIMIT 100`,
    [userId, categoryName]
  );

  // Recent state transitions
  const transitions = await db.query(
    `SELECT ie.*, i.canonical_text
     FROM item_events ie
     JOIN items i ON i.id = ie.item_id
     WHERE i.user_id = $1 AND i.category = $2
     ORDER BY ie.created_at DESC
     LIMIT 20`,
    [userId, categoryName]
  );

  // Velocity for this category
  const velocity = await db.query(
    `SELECT
       COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days')::int AS created_7d,
       COUNT(*) FILTER (WHERE state = 'DONE' AND updated_at >= NOW() - INTERVAL '7 days')::int AS completed_7d,
       COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days')::int AS created_30d,
       COUNT(*) FILTER (WHERE state = 'DONE' AND updated_at >= NOW() - INTERVAL '30 days')::int AS completed_30d
     FROM items
     WHERE user_id = $1 AND category = $2`,
    [userId, categoryName]
  );

  return {
    category: categoryName,
    items: items.rows.map(r => ({
      id:       r.id,
      text:     r.canonical_text,
      state:    r.state,
      priority: parseFloat(r.priority),
      blocker:  r.blocker,
      deadline: r.deadline,
      lastSeen: r.last_seen,
    })),
    recentTransitions: transitions.rows.map(t => ({
      text:      t.canonical_text,
      fromState: t.from_state,
      toState:   t.to_state,
      when:      t.created_at,
    })),
    velocity: velocity.rows[0],
  };
}

module.exports = { getOverview, getCategoryAnalytics };
