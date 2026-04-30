/**
 * ✦ WEEKLY PLANNER
 * Clusters open items by project → scores goal clusters → allocates weekly hours.
 * Top 3 goals max (Doc 7). Exposed via: GET /plan/week
 */
'use strict';

const OpenAI = require('openai');
const { embed } = require('../memory/embed');

const GOAL_WEIGHTS = { urgency: 0.35, causalImportance: 0.25, backlogSize: 0.20, recency: 0.20 };
const RAG_QUERY = 'weekly planning progress blockers commitments decisions risks focus';

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
  const min = Math.min(...items.map(i => i.deadline_days !== null ? parseFloat(i.deadline_days) : 999));
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

function _serializeItem(item) { return { id: item.id, text: item.canonical_text, state: item.state, priority: parseFloat((item.priority||0).toFixed(3)), blocker: item.blocker||false, deadlineDays: item.deadline_days !== null ? Math.round(parseFloat(item.deadline_days)) : null }; }

async function buildTaskGraph(db, userId, { limit = 36 } = {}) {
  const cappedLimit = Math.min(Math.max(parseInt(limit, 10) || 36, 6), 80);
  const { rows: itemRows } = await db.query(
    `SELECT id, canonical_text, state, priority, confidence, blocker, category, deadline,
            mention_count, first_seen, last_seen, created_at, updated_at
       FROM items
      WHERE user_id=$1 AND state IN ('OPEN','IN_PROGRESS')
      ORDER BY blocker DESC, priority DESC, last_seen DESC
      LIMIT $2`,
    [userId, cappedLimit]
  );

  const activeIds = itemRows.map(row => row.id);
  let edgeRows = [];
  if (activeIds.length > 0) {
    const result = await db.query(
      `SELECT e.id, e.from_item, e.to_item, e.edge_type, e.weight, e.created_at,
              src.canonical_text AS from_text,
              dst.canonical_text AS to_text
         FROM item_edges e
         JOIN items src ON src.id = e.from_item
         JOIN items dst ON dst.id = e.to_item
        WHERE e.user_id=$1
          AND e.from_item = ANY($2::uuid[])
          AND e.to_item = ANY($2::uuid[])
        ORDER BY e.created_at DESC`,
      [userId, activeIds]
    ).catch(() => ({ rows: [] }));
    edgeRows = result.rows || [];
  }

  const nodes = itemRows.map(row => ({
    id: row.id,
    label: row.canonical_text,
    state: row.state,
    priority: parseFloat(row.priority || 0),
    confidence: parseFloat(row.confidence || 0),
    blocker: Boolean(row.blocker),
    category: row.category || 'uncategorized',
    deadline: row.deadline,
    mentionCount: parseInt(row.mention_count || 0, 10),
    firstSeen: row.first_seen,
    lastSeen: row.last_seen,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));

  const edges = edgeRows.map(row => {
    const edgeType = row.edge_type || 'relates_to';
    const dependsOn = edgeType === 'depends_on';
    return {
      id: row.id,
      source: dependsOn ? row.to_item : row.from_item,
      target: dependsOn ? row.from_item : row.to_item,
      rawFrom: row.from_item,
      rawTo: row.to_item,
      label: dependsOn ? 'unlocks' : edgeType.replace(/_/g, ' '),
      edgeType,
      weight: parseFloat(row.weight || 1),
      createdAt: row.created_at,
      fromText: row.from_text,
      toText: row.to_text,
    };
  });

  const degree = new Map(nodes.map(node => [node.id, { incoming: 0, outgoing: 0 }]));
  for (const edge of edges) {
    if (degree.has(edge.source)) degree.get(edge.source).outgoing++;
    if (degree.has(edge.target)) degree.get(edge.target).incoming++;
  }

  const bottlenecks = nodes
    .map(node => ({ ...node, ...(degree.get(node.id) || { incoming: 0, outgoing: 0 }) }))
    .filter(node => node.outgoing > 0 || node.blocker)
    .sort((a, b) => b.outgoing - a.outgoing || Number(b.blocker) - Number(a.blocker) || b.priority - a.priority)
    .slice(0, 5);

  const categories = [...new Set(nodes.map(node => node.category))].sort();
  return {
    nodes,
    edges,
    bottlenecks,
    stats: {
      nodeCount: nodes.length,
      edgeCount: edges.length,
      blockerCount: nodes.filter(node => node.blocker).length,
      categoryCount: categories.length,
      connectedNodeCount: [...degree.values()].filter(d => d.incoming + d.outgoing > 0).length,
    },
    categories,
    generatedAt: new Date().toISOString(),
  };
}

async function buildWeeklyMemoryInsights(db, userId, timezone = 'UTC', { days = 7, limit = 18 } = {}) {
  const windowDays = Math.min(Math.max(parseInt(days, 10) || 7, 1), 30);
  const evidenceLimit = Math.min(Math.max(parseInt(limit, 10) || 18, 6), 40);
  const from = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

  const [entriesResult, episodicResult, semanticResult, itemResult] = await Promise.all([
    db.query(
      `SELECT id, raw_text, source, timestamp
         FROM entries
        WHERE user_id=$1 AND timestamp >= $2
        ORDER BY timestamp DESC
        LIMIT $3`,
      [userId, from, evidenceLimit]
    ).catch(() => ({ rows: [] })),
    retrieveEpisodicMemory(db, userId, evidenceLimit),
    db.query(
      `SELECT id, key, value, confidence, updated_at, created_at
         FROM semantic_memory
        WHERE user_id=$1
        ORDER BY updated_at DESC NULLS LAST, created_at DESC
        LIMIT $2`,
      [userId, Math.ceil(evidenceLimit / 2)]
    ).catch(() => ({ rows: [] })),
    db.query(
      `SELECT id, canonical_text, state, priority, blocker, category, deadline, last_seen
         FROM items
        WHERE user_id=$1 AND state IN ('OPEN','IN_PROGRESS')
        ORDER BY blocker DESC, priority DESC, last_seen DESC
        LIMIT 12`,
      [userId]
    ).catch(() => ({ rows: [] })),
  ]);

  const evidence = [
    ...entriesResult.rows.map(row => ({
      type: 'entry',
      id: row.id,
      label: row.source || 'manual',
      text: row.raw_text,
      timestamp: row.timestamp,
      score: null,
    })),
    ...episodicResult.rows.map(row => ({
      type: 'episodic',
      id: row.id,
      label: 'memory',
      text: row.content,
      timestamp: row.ts || row.created_at,
      score: row.score !== null && row.score !== undefined ? parseFloat(row.score) : null,
    })),
    ...semanticResult.rows.map(row => ({
      type: 'semantic',
      id: row.id,
      label: row.key,
      text: row.value,
      timestamp: row.updated_at || row.created_at,
      score: row.confidence !== null && row.confidence !== undefined ? parseFloat(row.confidence) : null,
    })),
  ]
    .filter(item => item.text && String(item.text).trim())
    .slice(0, evidenceLimit)
    .map(item => ({ ...item, snippet: trimText(item.text, 220) }));

  const activeItems = itemResult.rows.map(row => ({
    id: row.id,
    text: row.canonical_text,
    state: row.state,
    priority: parseFloat(row.priority || 0),
    blocker: Boolean(row.blocker),
    category: row.category || 'uncategorized',
    deadline: row.deadline,
    lastSeen: row.last_seen,
  }));

  const generated = await generateWeeklySynthesis({ evidence, activeItems, timezone, windowDays });

  return {
    ...generated,
    evidence: evidence.slice(0, 8),
    activeItems: activeItems.slice(0, 8),
    sourceCounts: {
      entries: entriesResult.rows.length,
      episodic: episodicResult.rows.length,
      semantic: semanticResult.rows.length,
      activeItems: activeItems.length,
    },
    windowDays,
    generatedAt: new Date().toISOString(),
  };
}

async function retrieveEpisodicMemory(db, userId, limit) {
  const queryVec = await embed(RAG_QUERY).catch(() => []);
  const hasVector = Array.isArray(queryVec) && queryVec.some(v => v !== 0);
  if (hasVector) {
    const result = await db.query(
      `SELECT id, content, ts, created_at, 1 - (embedding <=> $2::vector) AS score
         FROM episodic_memory
        WHERE user_id=$1 AND embedding IS NOT NULL
        ORDER BY embedding <=> $2::vector
        LIMIT $3`,
      [userId, `[${queryVec.join(',')}]`, limit]
    ).catch(() => null);
    if (result?.rows?.length) return result;
  }

  return db.query(
    `SELECT id, content, ts, created_at, NULL::real AS score
       FROM episodic_memory
      WHERE user_id=$1
      ORDER BY ts DESC NULLS LAST, created_at DESC
      LIMIT $2`,
    [userId, limit]
  ).catch(() => ({ rows: [] }));
}

async function generateWeeklySynthesis({ evidence, activeItems, timezone, windowDays }) {
  const fallback = deterministicSynthesis(evidence, activeItems, windowDays);
  const key = process.env.OPENAI_API_KEY;
  if (!key || key === 'sk-your-openai-api-key' || evidence.length === 0) return fallback;

  try {
    const client = new OpenAI({ apiKey: key });
    const context = [
      'EVIDENCE',
      ...evidence.slice(0, 16).map((item, i) => `${i + 1}. [${item.type}] ${item.snippet}`),
      '',
      'ACTIVE ITEMS',
      ...activeItems.slice(0, 10).map((item, i) => `${i + 1}. ${item.text} (${item.category}, priority ${item.priority})`),
    ].join('\n');

    const response = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.2,
      max_tokens: 650,
      messages: [
        {
          role: 'system',
          content: 'Generate a concise weekly RAG insight for a personal operations command center. Return strict JSON with keys summary, themes, risks, suggestedFocus. Each array item must be short and grounded in the evidence.',
        },
        {
          role: 'user',
          content: `Timezone: ${timezone}\nWindow: ${windowDays} days\n\n${context}`,
        },
      ],
    });

    const parsed = JSON.parse(response.choices[0].message.content);
    return normalizeSynthesis(parsed, 'rag_llm');
  } catch (_) {
    return fallback;
  }
}

function deterministicSynthesis(evidence, activeItems, windowDays) {
  const blockers = activeItems.filter(item => item.blocker);
  const byCategory = new Map();
  for (const item of activeItems) byCategory.set(item.category, (byCategory.get(item.category) || 0) + 1);
  const categories = [...byCategory.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  const recentTerms = topTerms(evidence.map(item => item.text).join(' '), 8);

  const summary = evidence.length === 0
    ? `No weekly memory evidence was found for the last ${windowDays} days.`
    : `Retrieved ${evidence.length} memory signals across ${windowDays} days; ${activeItems.length} active items remain in the current operating graph.`;

  const themes = categories.length > 0
    ? categories.map(([name, count]) => `${name}: ${count} active item${count === 1 ? '' : 's'}`)
    : recentTerms.slice(0, 3).map(term => `Recurring signal: ${term}`);

  const risks = [
    ...blockers.slice(0, 3).map(item => `Blocked: ${trimText(item.text, 90)}`),
    ...(activeItems.length > 12 ? ['Open workload is spreading across many items.'] : []),
  ];

  const suggestedFocus = activeItems
    .slice()
    .sort((a, b) => Number(b.blocker) - Number(a.blocker) || b.priority - a.priority)
    .slice(0, 3)
    .map(item => trimText(item.text, 110));

  return normalizeSynthesis({ summary, themes, risks, suggestedFocus }, 'deterministic_rag');
}

function normalizeSynthesis(data, mode) {
  return {
    mode,
    summary: String(data?.summary || 'Weekly memory insight is available, but no summary was generated.'),
    themes: asStringArray(data?.themes).slice(0, 5),
    risks: asStringArray(data?.risks).slice(0, 5),
    suggestedFocus: asStringArray(data?.suggestedFocus).slice(0, 5),
  };
}

function asStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map(item => typeof item === 'string' ? item : item?.text || item?.summary || '').filter(Boolean);
}

function topTerms(text, limit) {
  const stop = new Set(['the', 'and', 'for', 'that', 'with', 'this', 'from', 'have', 'need', 'will', 'your', 'about', 'into', 'onto', 'been', 'were', 'what', 'when']);
  const counts = new Map();
  for (const term of String(text || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)) {
    if (term.length < 4 || stop.has(term)) continue;
    counts.set(term, (counts.get(term) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([term]) => term);
}

function trimText(value, max) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}

module.exports = { buildWeeklyPlan, buildTaskGraph, buildWeeklyMemoryInsights };
