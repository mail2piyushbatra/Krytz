/**
 * ✦ ENTITY RESOLVER
 * Resolves named entities across entries: "raj", "Rajesh", "Rajesh Kumar" → same entity_id.
 * Uses embedding cosine + edit distance + frequency for matching.
 */
'use strict';

const { v4: uuid } = require('uuid');
const { embed, cosine } = require('../memory/embed');

function editDistance(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1] : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
  return dp[m][n];
}

function editSimilarity(a, b) {
  if (!a || !b) return 0;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - editDistance(a.toLowerCase(), b.toLowerCase()) / maxLen;
}

const MATCH_THRESHOLD = 0.80, EMBED_WEIGHT = 0.5, EDIT_WEIGHT = 0.3, FREQ_WEIGHT = 0.2;

async function resolveEntity(db, userId, text, type = 'person') {
  const clean = text.trim();
  if (!clean) return null;

  const { rows: exact } = await db.query(`SELECT e.id, e.canonical_name, ea.frequency FROM entity_aliases ea JOIN entities e ON e.id = ea.entity_id WHERE ea.user_id=$1 AND LOWER(ea.alias)=LOWER($2) AND e.type=$3`, [userId, clean, type]);
  if (exact.length > 0) { await _bumpAlias(db, userId, exact[0].id, clean); return { entityId: exact[0].id, created: false, canonical: exact[0].canonical_name, score: 1.0 }; }

  const vec = await embed(clean);
  const vecStr = `[${vec.join(',')}]`;
  const { rows: candidates } = await db.query(`SELECT e.id, e.canonical_name, e.frequency, (e.embedding <=> $2::vector) AS vec_dist FROM entities e WHERE e.user_id=$1 AND e.type=$3 AND e.embedding IS NOT NULL ORDER BY e.embedding <=> $2::vector LIMIT 10`, [userId, vecStr, type]);

  let best = null, bestScore = -1;
  for (const c of candidates) {
    const cosSim = Math.max(0, 1 - parseFloat(c.vec_dist));
    const editSim = editSimilarity(clean, c.canonical_name);
    const freqNorm = Math.min(1, (c.frequency || 1) / 10);
    const score = EMBED_WEIGHT * cosSim + EDIT_WEIGHT * editSim + FREQ_WEIGHT * freqNorm;
    if (score > MATCH_THRESHOLD && score > bestScore) { bestScore = score; best = { ...c, score }; }
  }

  if (best) { await _bumpAlias(db, userId, best.id, clean); return { entityId: best.id, created: false, canonical: best.canonical_name, score: parseFloat(bestScore.toFixed(3)) }; }

  const id = uuid();
  await db.query(`INSERT INTO entities(id, user_id, canonical_name, type, embedding, frequency) VALUES($1,$2,$3,$4,$5::vector,1)`, [id, userId, clean, type, vecStr]);
  await db.query(`INSERT INTO entity_aliases(id, entity_id, user_id, alias, frequency) VALUES(uuid_generate_v4(),$1,$2,$3,1)`, [id, userId, clean]);
  return { entityId: id, created: true, canonical: clean, score: 0 };
}

function extractEntityMentions(text) {
  const mentions = [];
  const namePattern = /(?<=[a-z,.!?]\s)([A-Z][a-z]{2,})(?:\s[A-Z][a-z]{2,})*/g;
  let m;
  while ((m = namePattern.exec(text)) !== null) mentions.push({ text: m[0], type: 'person', start: m.index, end: m.index + m[0].length });
  const projectPattern = /(?:project\s+([A-Za-z0-9_-]+)|([A-Za-z0-9_-]+)\s+project|#([A-Za-z0-9_-]+))/gi;
  while ((m = projectPattern.exec(text)) !== null) { const name = m[1] || m[2] || m[3]; if (name) mentions.push({ text: name, type: 'project', start: m.index, end: m.index + m[0].length }); }
  return mentions;
}

async function resolveEntitiesInEntry(db, userId, text) {
  const mentions = extractEntityMentions(text);
  const results  = [];
  for (const mention of mentions) { const resolved = await resolveEntity(db, userId, mention.text, mention.type); if (resolved) results.push({ ...mention, ...resolved }); }
  return results;
}

async function _bumpAlias(db, userId, entityId, alias) {
  await db.query(`INSERT INTO entity_aliases(id, entity_id, user_id, alias, frequency) VALUES(uuid_generate_v4(),$1,$2,$3,1) ON CONFLICT(entity_id, user_id, alias) DO UPDATE SET frequency = entity_aliases.frequency + 1`, [entityId, userId, alias.toLowerCase()]);
  await db.query(`UPDATE entities SET frequency = frequency + 1 WHERE id=$1`, [entityId]);
}

module.exports = { resolveEntity, resolveEntitiesInEntry, extractEntityMentions, editSimilarity };
