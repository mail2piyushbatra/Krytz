/**
 * ✦ HYBRID ITEM MATCHER
 * score = 0.6*cosine + 0.2*lexical + 0.2*recency
 * Merge if cosine > 0.85 OR (cosine > 0.75 AND lexical > 0.6)
 */
'use strict';

const { embed } = require('../memory/embed');

const WEIGHTS = { cosine: 0.6, lexical: 0.2, recency: 0.2 };
const HARD_THRESHOLD = 0.85, SOFT_THRESHOLD = 0.75, LEXICAL_SOFT_MIN = 0.60;

function lexicalScore(a, b) {
  const tok = s => new Set(s.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(t => t.length > 2));
  const sA = tok(a), sB = tok(b);
  if (sA.size === 0) return 0;
  let hits = 0; for (const t of sA) if (sB.has(t)) hits++;
  return hits / sA.size;
}

function recencyScore(lastSeen) {
  const days = (Date.now() - new Date(lastSeen).getTime()) / 86_400_000;
  return Math.max(0, 1 - days / 30);
}

function distToSim(dist) { return Math.max(0, 1 - parseFloat(dist)); }

async function hybridMatchOrCreate(db, userId, text, { project = null, dueDate = null, sourceEntryId = null } = {}) {
  const vec    = await embed(text);
  const vecStr = `[${vec.join(',')}]`;

  const { rows: candidates } = await db.query(
    `SELECT id, canonical_text, last_seen, project, (embedding <=> $2::vector) AS vec_distance FROM items WHERE user_id=$1 AND state NOT IN ('DONE','DROPPED') ORDER BY embedding <=> $2::vector LIMIT 10`,
    [userId, vecStr]
  );

  let best = null, bestScore = -1;
  for (const c of candidates) {
    const cos     = distToSim(c.vec_distance);
    const lexical = lexicalScore(text, c.canonical_text);
    const recency = recencyScore(c.last_seen);
    const projectBonus = (project && c.project === project) ? 0.05 : 0;
    const hybrid  = WEIGHTS.cosine * cos + WEIGHTS.lexical * lexical + WEIGHTS.recency * recency + projectBonus;
    const shouldMerge = cos > HARD_THRESHOLD || (cos > SOFT_THRESHOLD && lexical > LEXICAL_SOFT_MIN);
    if (shouldMerge && hybrid > bestScore) { bestScore = hybrid; best = { ...c, cos, lexical, recency, hybrid }; }
  }

  if (best) {
    await db.query(`UPDATE items SET last_seen=now(), mention_count=mention_count+1, confidence=LEAST(1.0,confidence+0.1), updated_at=now() WHERE id=$1`, [best.id]);
    return { itemId: best.id, created: false, score: parseFloat(bestScore.toFixed(3)), breakdown: { cos: best.cos, lexical: best.lexical, recency: best.recency } };
  }

  const { v4: uuid } = require('uuid');
  const id = uuid();
  await db.query(`INSERT INTO items(id, user_id, canonical_text, embedding, state, project, deadline, source_entry_id, priority, confidence) VALUES($1,$2,$3,$4::vector,'OPEN',$5,$6,$7,0.5,0.7)`, [id, userId, text, vecStr, project, dueDate, sourceEntryId]);
  await db.query(`INSERT INTO item_events(id, item_id, from_state, to_state, confidence, source_entry_id, reason) VALUES(uuid_generate_v4(),$1,NULL,'OPEN',0.7,$2,'created')`, [id, sourceEntryId]);
  return { itemId: id, created: true, score: 0, breakdown: null };
}

module.exports = { hybridMatchOrCreate, lexicalScore, recencyScore, distToSim, WEIGHTS };
