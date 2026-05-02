/**
 * ✦ Krytz — Items Service
 *
 * The core todo ledger. CRUD operations over the `items` table,
 * with filtering, dynamic sort scoring, and completion tracking.
 * This is the bridge between the TSG intelligence layer and the user's UI.
 */

const db = require('../../lib/db');
const logger = require('../../lib/logger');
const { AppError } = require('../../middleware/errorHandler');
const { embed } = require('../../engines/memory/embed');

// ─── Row → API mapping ────────────────────────────────────────────────────────

function toApiItem(row) {
  return {
    id:            row.id,
    text:          row.canonical_text,
    state:         row.state,
    category:      row.category || 'uncategorized',
    priority:      parseFloat(row.priority),
    confidence:    parseFloat(row.confidence),
    blocker:       row.blocker,
    deadline:      row.deadline,
    estimatedMins: row.estimated_mins,
    mentionCount:  row.mention_count,
    firstSeen:     row.first_seen,
    lastSeen:      row.last_seen,
    sourceEntryId: row.source_entry_id,
    createdAt:     row.created_at,
    updatedAt:     row.updated_at,
  };
}

// ─── Dynamic sort score ───────────────────────────────────────────────────────
// Items within each category auto-sort by composite relevance score.

function computeSortScore(item) {
  let score = 0;

  // Blockers first
  if (item.blocker) score += 100;

  // Deadline urgency
  if (item.deadline) {
    const hoursUntil = (new Date(item.deadline) - Date.now()) / (1000 * 60 * 60);
    if (hoursUntil < 0) score += 60;         // overdue
    else if (hoursUntil < 24) score += 50;   // due today
    else if (hoursUntil < 168) score += 25;  // due this week
  }

  // TSG priority (0-1 range)
  score += (parseFloat(item.priority) || 0.5) * 20;

  // Confidence / belief strength
  score += (parseFloat(item.confidence) || 0.5) * 5;

  // Recency boost (recently active items float up)
  if (item.last_seen) {
    let daysSince = (Date.now() - new Date(item.last_seen)) / (1000 * 60 * 60 * 24);
    if (daysSince < 0.1) daysSince = 0.1;
    score += Math.min(10, 10 / daysSince);
  }

  return score;
}

// ─── List items ───────────────────────────────────────────────────────────────

async function listItems(userId, { state, category, blocker, since, sort, page, limit }) {
  const conditions = ['i.user_id = $1'];
  const params = [userId];
  let idx = 2;

  // State filter (default: OPEN + IN_PROGRESS)
  if (state) {
    conditions.push(`i.state = $${idx}`);
    params.push(state);
    idx++;
  } else {
    conditions.push(`i.state IN ('OPEN', 'IN_PROGRESS')`);
  }

  // Category filter
  if (category) {
    conditions.push(`i.category = $${idx}`);
    params.push(category);
    idx++;
  }

  // Blocker filter
  if (blocker !== undefined) {
    conditions.push(`i.blocker = $${idx}`);
    params.push(blocker === 'true');
    idx++;
  }

  // Since filter (for completion ledger: "7d", "30d", or ISO date)
  if (since) {
    let sinceDate;
    const match = since.match(/^(\d+)d$/);
    if (match) {
      sinceDate = new Date(Date.now() - parseInt(match[1]) * 24 * 60 * 60 * 1000);
    } else {
      sinceDate = new Date(since);
    }
    if (!isNaN(sinceDate.getTime())) {
      conditions.push(`i.updated_at >= $${idx}`);
      params.push(sinceDate);
      idx++;
    }
  }

  // Sort
  let orderBy;
  switch (sort) {
    case 'deadline':  orderBy = 'i.deadline ASC NULLS LAST, i.priority DESC'; break;
    case 'recent':    orderBy = 'i.last_seen DESC'; break;
    case 'created':   orderBy = 'i.created_at DESC'; break;
    case 'priority':
    default:          orderBy = 'i.blocker DESC, i.priority DESC, i.last_seen DESC'; break;
  }

  const where = conditions.join(' AND ');
  const offset = (page - 1) * limit;

  // Count
  const countResult = await db.query(`SELECT COUNT(*)::int AS total FROM items i WHERE ${where}`, params);
  const total = countResult.rows[0].total;

  // Fetch
  const { rows } = await db.query(
    `SELECT * FROM items i WHERE ${where} ORDER BY ${orderBy} LIMIT $${idx} OFFSET $${idx + 1}`,
    [...params, limit, offset]
  );

  // If sort=priority, apply dynamic scoring for final order
  let items = rows.map(toApiItem);
  if (sort === 'priority') {
    items = rows
      .map(row => ({ ...toApiItem(row), _sortScore: computeSortScore(row) }))
      .sort((a, b) => b._sortScore - a._sortScore);
  }

  // State summary
  const statsResult = await db.query(
    `SELECT state, COUNT(*)::int AS count FROM items WHERE user_id = $1 GROUP BY state`,
    [userId]
  );
  const byState = {};
  for (const r of statsResult.rows) byState[r.state] = r.count;

  return {
    items,
    meta: { page, limit, total, hasMore: offset + limit < total, byState },
  };
}

// ─── Get single item with history ─────────────────────────────────────────────

async function getItem(userId, itemId) {
  const { rows } = await db.query(
    `SELECT * FROM items WHERE id = $1 AND user_id = $2`,
    [itemId, userId]
  );
  if (rows.length === 0) throw new AppError('Item not found', 404);

  // Fetch event history
  const events = await db.query(
    `SELECT * FROM item_events WHERE item_id = $1 ORDER BY created_at DESC LIMIT 50`,
    [itemId]
  );

  return {
    item: toApiItem(rows[0]),
    events: events.rows.map(e => ({
      id:         e.id,
      fromState:  e.from_state,
      toState:    e.to_state,
      confidence: e.confidence ? parseFloat(e.confidence) : null,
      reason:     e.reason,
      createdAt:  e.created_at,
    })),
  };
}

// ─── Create item directly ─────────────────────────────────────────────────────

// ─── Auto-categorization ────────────────────────────────────────────────────────
// Matches item text against user's existing categories using keyword similarity.

const CATEGORY_KEYWORDS = {
  work:       ['meeting', 'email', 'call', 'project', 'deadline', 'presentation', 'client', 'report', 'task', 'review', 'team', 'office', 'manager', 'colleague', 'slack', 'standup', 'sprint', 'deploy', 'code', 'server', 'api', 'feature', 'design', 'ux', 'ui', 'launch', 'release', 'roadmap', 'bug', 'fix', 'test', 'hire', 'interview', 'pr'],
  infra:      ['server', 'deploy', 'ci', 'cd', 'docker', 'aws', 'cloud', 'devops', 'database', 'db', 'api', 'ssl', 'dns', 'kubernetes', 'pipeline', 'monitoring', 'backup', 'hosting', 'nginx', 'redis', 'postgres'],
  product:    ['feature', 'design', 'ux', 'ui', 'user', 'feedback', 'launch', 'release', 'roadmap', 'spec', 'prototype', 'wireframe', 'figma', 'landing', 'onboarding', 'conversion', 'analytics', 'dashboard', 'app', 'mobile', 'web'],
  hiring:     ['hire', 'hiring', 'interview', 'candidate', 'recruit', 'resume', 'offer', 'onboard', 'team', 'role', 'job', 'position', 'applicant', 'linkedin'],
  operations: ['process', 'ops', 'workflow', 'vendor', 'compliance', 'legal', 'finance', 'budget', 'invoice', 'contract', 'accounting', 'payroll', 'insurance', 'tax', 'audit', 'report'],
  personal:   ['gym', 'doctor', 'dentist', 'grocery', 'cook', 'clean', 'laundry', 'walk', 'run', 'exercise', 'meditate', 'read', 'book', 'family', 'friend', 'birthday', 'gift', 'vacation', 'travel', 'appointment', 'haircut', 'pharmacy', 'bills', 'rent', 'car', 'pet'],
  health:     ['gym', 'workout', 'exercise', 'doctor', 'appointment', 'medication', 'sleep', 'diet', 'run', 'yoga', 'meditation', 'therapy', 'dentist', 'checkup'],
  errands:    ['grocery', 'pharmacy', 'post', 'mail', 'package', 'pickup', 'drop', 'bank', 'store', 'shop', 'buy', 'return', 'exchange', 'repair', 'fix', 'clean', 'laundry', 'dry clean', 'car wash', 'oil change', 'renew', 'pay', 'bill'],
  finance:    ['budget', 'invoice', 'payment', 'tax', 'bank', 'investment', 'savings', 'expense', 'salary', 'bills', 'rent', 'mortgage'],
  learning:   ['study', 'course', 'learn', 'read', 'book', 'tutorial', 'practice', 'exam', 'class', 'lecture', 'certificate', 'skill'],
};

const URGENCY_KEYWORDS = ['urgent', 'asap', 'immediately', 'critical', 'important', 'deadline', 'overdue', 'today', 'now', 'emergency', 'priority'];

async function autoCategorize(userId, text) {
  const lower = text.toLowerCase();
  const words = lower.split(/\s+/);

  // Get user's actual categories
  const { rows: userCats } = await db.query(
    `SELECT name FROM categories WHERE user_id = $1`, [userId]
  );
  const userCatNames = userCats.map(c => c.name.toLowerCase());

  let bestCat = 'uncategorized';
  let bestScore = 0;

  for (const catName of userCatNames) {
    let score = 0;
    const keywords = CATEGORY_KEYWORDS[catName] || [];
    for (const kw of keywords) {
      if (lower.includes(kw)) score += 2;
    }
    if (lower.includes(catName)) score += 5;
    for (const word of words) {
      if (catName.includes(word) && word.length > 3) score += 1;
    }
    if (score > bestScore) { bestScore = score; bestCat = catName; }
  }

  return bestScore >= 2 ? bestCat : 'uncategorized';
}

function computeInitialPriority(text, deadline, blocker) {
  let priority = 0.5;
  const lower = text.toLowerCase();
  for (const kw of URGENCY_KEYWORDS) {
    if (lower.includes(kw)) { priority = Math.min(1.0, priority + 0.15); break; }
  }
  if (deadline) {
    const hoursUntil = (new Date(deadline) - Date.now()) / (1000 * 60 * 60);
    if (hoursUntil < 0) priority = Math.min(1.0, priority + 0.3);
    else if (hoursUntil < 24) priority = Math.min(1.0, priority + 0.25);
    else if (hoursUntil < 168) priority = Math.min(1.0, priority + 0.1);
  }
  if (blocker) priority = Math.min(1.0, priority + 0.2);
  return Math.round(priority * 100) / 100;
}

async function createItem(userId, { text, category, deadline, blocker, priority }) {
  // Auto-categorize if no category provided
  let resolvedCategory = category;
  if (!category || category === 'uncategorized') {
    resolvedCategory = await autoCategorize(userId, text);
  }

  // Auto-compute priority if not explicitly set
  const resolvedPriority = priority || computeInitialPriority(text, deadline, blocker);

  const { rows } = await db.query(
    `INSERT INTO items (user_id, canonical_text, category, deadline, blocker, priority, state, confidence, mention_count)
     VALUES ($1, $2, $3, $4, $5, $6, 'OPEN', 0.8, 1)
     RETURNING *`,
    [userId, text, resolvedCategory, deadline || null, blocker || false, resolvedPriority]
  );

  const item = toApiItem(rows[0]);

  await db.query(
    `INSERT INTO item_events (item_id, from_state, to_state, confidence, reason)
     VALUES ($1, NULL, 'OPEN', 0.8, $2)`,
    [item.id, resolvedCategory !== 'uncategorized' ? `Auto-categorized as "${resolvedCategory}"` : 'Direct creation']
  );

  logger.info('Item created', { userId, itemId: item.id, category: resolvedCategory, priority: resolvedPriority, autocat: !category });

  generateEmbedding(item.id, text).catch(err =>
    logger.warn('Embedding generation failed', { itemId: item.id, error: err.message })
  );

  try {
    const { engines } = require('../../engines');
    if (engines.state && engines.state._tsg) {
      // TSG will pick it up on next hydration; the DB is the source of truth
    }
  } catch (_) { /* TSG not critical for direct create */ }

  return item;
}


// ─── Embedding generation (fire-and-forget) ───────────────────────────────────

async function generateEmbedding(itemId, text) {
  const vec = await embed(text);
  // Don't store zero vectors (no API key configured)
  const isZero = vec.every(v => v === 0);
  if (isZero) return;

  await db.query(
    `UPDATE items SET embedding = $1 WHERE id = $2`,
    [`[${vec.join(',')}]`, itemId]
  );
}

// ─── Semantic search using pgvector ───────────────────────────────────────────

async function semanticSearch(userId, query, { limit = 10, threshold = 0.3 } = {}) {
  const queryVec = await embed(query);
  const isZero = queryVec.every(v => v === 0);
  if (isZero) {
    // Fallback to text search if no embeddings available
    const { rows } = await db.query(
      `SELECT *, ts_rank(search_vector, plainto_tsquery('english', $2)) AS rank
       FROM items
       WHERE user_id = $1
         AND search_vector @@ plainto_tsquery('english', $2)
       ORDER BY rank DESC
       LIMIT $3`,
      [userId, query, limit]
    );
    return rows.map(r => ({ ...toApiItem(r), score: parseFloat(r.rank) }));
  }

  const { rows } = await db.query(
    `SELECT *,
            1 - (embedding <=> $2::vector) AS similarity
     FROM items
     WHERE user_id = $1
       AND embedding IS NOT NULL
       AND 1 - (embedding <=> $2::vector) > $3
     ORDER BY embedding <=> $2::vector
     LIMIT $4`,
    [userId, `[${queryVec.join(',')}]`, threshold, limit]
  );

  return rows.map(r => ({ ...toApiItem(r), score: parseFloat(r.similarity) }));
}

// ─── Update item ──────────────────────────────────────────────────────────────

async function updateItem(userId, itemId, updates) {
  // Fetch current state
  const { rows: current } = await db.query(
    `SELECT * FROM items WHERE id = $1 AND user_id = $2`,
    [itemId, userId]
  );
  if (current.length === 0) throw new AppError('Item not found', 404);

  const old = current[0];
  const sets = [];
  const params = [];
  let idx = 1;

  if (updates.text !== undefined) {
    sets.push(`canonical_text = $${idx}`); params.push(updates.text); idx++;
  }
  if (updates.state !== undefined) {
    sets.push(`state = $${idx}`); params.push(updates.state); idx++;
  }
  if (updates.category !== undefined) {
    sets.push(`category = $${idx}`); params.push(updates.category); idx++;
  }
  if (updates.deadline !== undefined) {
    sets.push(`deadline = $${idx}`); params.push(updates.deadline); idx++;
  }
  if (updates.blocker !== undefined) {
    sets.push(`blocker = $${idx}`); params.push(updates.blocker); idx++;
  }
  if (updates.priority !== undefined) {
    sets.push(`priority = $${idx}`); params.push(updates.priority); idx++;
  }

  if (sets.length === 0) throw new AppError('No fields to update', 400);

  sets.push(`updated_at = now()`);
  sets.push(`last_seen = now()`);

  params.push(itemId, userId);
  const { rows } = await db.query(
    `UPDATE items SET ${sets.join(', ')} WHERE id = $${idx} AND user_id = $${idx + 1} RETURNING *`,
    params
  );

  const item = toApiItem(rows[0]);

  // Record state transition if state changed
  if (updates.state && updates.state !== old.state) {
    await db.query(
      `INSERT INTO item_events (item_id, from_state, to_state, confidence, reason)
       VALUES ($1, $2, $3, $4, $5)`,
      [itemId, old.state, updates.state, item.confidence, 'User action']
    );

    logger.info('Item state changed', {
      userId, itemId, from: old.state, to: updates.state,
    });
  }

  return item;
}

// ─── Soft-delete (mark DROPPED) ───────────────────────────────────────────────

async function deleteItem(userId, itemId) {
  const { rows } = await db.query(
    `UPDATE items SET state = 'DROPPED', updated_at = now()
     WHERE id = $1 AND user_id = $2 AND state != 'DROPPED'
     RETURNING *`,
    [itemId, userId]
  );
  if (rows.length === 0) throw new AppError('Item not found or already dropped', 404);

  await db.query(
    `INSERT INTO item_events (item_id, from_state, to_state, confidence, reason)
     VALUES ($1, $2, 'DROPPED', $3, 'User deleted')`,
    [itemId, rows[0].state, rows[0].confidence]
  );

  logger.info('Item dropped', { userId, itemId });
  return { message: 'Item dropped' };
}

// ─── Completion stats ─────────────────────────────────────────────────────────

async function getCompletionStats(userId, days = 7) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  // Completed items in period
  const completed = await db.query(
    `SELECT i.*, ie.created_at AS completed_at
     FROM items i
     JOIN item_events ie ON ie.item_id = i.id AND ie.to_state = 'DONE'
     WHERE i.user_id = $1 AND ie.created_at >= $2
     ORDER BY ie.created_at DESC`,
    [userId, since]
  );

  // By category breakdown
  const byCategory = await db.query(
    `SELECT i.category, COUNT(*)::int AS count
     FROM items i
     JOIN item_events ie ON ie.item_id = i.id AND ie.to_state = 'DONE'
     WHERE i.user_id = $1 AND ie.created_at >= $2
     GROUP BY i.category ORDER BY count DESC`,
    [userId, since]
  );

  // Average time to complete (first_seen → DONE event)
  const avgTime = await db.query(
    `SELECT i.category,
            AVG(EXTRACT(EPOCH FROM (ie.created_at - i.first_seen)) / 86400)::numeric(10,1) AS avg_days
     FROM items i
     JOIN item_events ie ON ie.item_id = i.id AND ie.to_state = 'DONE'
     WHERE i.user_id = $1 AND ie.created_at >= $2
     GROUP BY i.category`,
    [userId, since]
  );

  return {
    period: `${days}d`,
    totalCompleted: completed.rows.length,
    items: completed.rows.map(r => ({
      ...toApiItem(r),
      completedAt: r.completed_at,
    })),
    byCategory: byCategory.rows,
    avgCompletionDays: avgTime.rows.reduce((acc, r) => {
      acc[r.category] = parseFloat(r.avg_days);
      return acc;
    }, {}),
  };
}

module.exports = {
  listItems,
  getItem,
  createItem,
  updateItem,
  deleteItem,
  getCompletionStats,
  semanticSearch,
  generateEmbedding,
};
