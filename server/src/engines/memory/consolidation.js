'use strict';

const { embed } = require('./embed');
const logger = require('../../lib/logger');

async function consolidateAllUsers(db, options = {}) {
  const { rows: users } = await db.query(
    `SELECT DISTINCT user_id
       FROM episodic_memory
      WHERE ts >= now() - interval '45 days'
      ORDER BY user_id`
  ).catch(() => ({ rows: [] }));

  const results = [];
  for (const row of users) {
    try {
      results.push(await consolidateUserMemory(db, row.user_id, options));
    } catch (err) {
      logger.warn('Memory consolidation failed for user', { userId: row.user_id, error: err.message });
      results.push({ userId: row.user_id, created: false, error: err.message });
    }
  }

  return {
    users: users.length,
    summariesCreated: results.filter(result => result.created).length,
    results,
  };
}

async function consolidateUserMemory(db, userId, { limit = 80, minEpisodes = 3 } = {}) {
  const { rows: episodes } = await db.query(
    `SELECT em.id, em.content, em.ts, em.created_at
       FROM episodic_memory em
      WHERE em.user_id=$1
        AND em.ts < now() - interval '12 hours'
        AND NOT EXISTS (
          SELECT 1
            FROM memory_summaries ms
           WHERE ms.user_id=$1
             AND em.id = ANY(ms.episode_ids)
        )
      ORDER BY em.ts DESC NULLS LAST, em.created_at DESC
      LIMIT $2`,
    [userId, limit]
  ).catch(() => ({ rows: [] }));

  if (episodes.length < minEpisodes) {
    return { userId, created: false, reason: 'not_enough_new_episodes', episodeCount: episodes.length };
  }

  const ordered = episodes.slice().reverse();
  const period = buildPeriod(ordered);
  const summary = buildSummary(ordered);
  const episodeIds = ordered.map(episode => episode.id);
  const embedding = await embed(summary).catch(() => []);
  const vector = Array.isArray(embedding) && embedding.length > 0 ? `[${embedding.join(',')}]` : null;

  const { rows: [memorySummary] } = await db.query(
    `INSERT INTO memory_summaries(user_id, summary, period, episode_ids)
     VALUES($1, $2, $3, $4::uuid[])
     RETURNING id, created_at`,
    [userId, summary, period, episodeIds]
  );

  if (vector) {
    await db.query(
      `INSERT INTO semantic_memory(user_id, key, value, embedding, confidence)
       VALUES($1, $2, $3, $4::vector, 0.72)
       ON CONFLICT(user_id, key) DO UPDATE
         SET value=EXCLUDED.value,
             embedding=EXCLUDED.embedding,
             confidence=GREATEST(semantic_memory.confidence, EXCLUDED.confidence),
             updated_at=now()`,
      [userId, `memory_summary:${period}`, summary, vector]
    ).catch(err => logger.warn('Semantic memory summary upsert failed', { userId, error: err.message }));
  }

  return {
    userId,
    created: true,
    summaryId: memorySummary.id,
    episodeCount: episodes.length,
    period,
  };
}

function buildPeriod(episodes) {
  const first = episodes[0]?.ts || episodes[0]?.created_at || new Date();
  const last = episodes[episodes.length - 1]?.ts || episodes[episodes.length - 1]?.created_at || first;
  return `${toDate(first)}:${toDate(last)}`;
}

function buildSummary(episodes) {
  const text = episodes.map(episode => episode.content).join('\n');
  const terms = topTerms(text, 8);
  const highlights = episodes
    .map(episode => compact(episode.content, 140))
    .filter(Boolean)
    .slice(0, 6);

  return [
    `Consolidated ${episodes.length} episodes.`,
    terms.length ? `Recurring signals: ${terms.join(', ')}.` : null,
    'Highlights:',
    ...highlights.map(item => `- ${item}`),
  ].filter(Boolean).join('\n');
}

function topTerms(text, limit) {
  const stop = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'from', 'have', 'will', 'into', 'your', 'about', 'need', 'done']);
  const counts = new Map();
  for (const word of String(text).toLowerCase().match(/[a-z][a-z0-9-]{3,}/g) || []) {
    if (stop.has(word)) continue;
    counts.set(word, (counts.get(word) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([word]) => word);
}

function compact(text, max) {
  const singleLine = String(text || '').replace(/\s+/g, ' ').trim();
  return singleLine.length > max ? `${singleLine.slice(0, max - 3)}...` : singleLine;
}

function toDate(value) {
  return new Date(value).toISOString().slice(0, 10);
}

module.exports = { consolidateAllUsers, consolidateUserMemory };
