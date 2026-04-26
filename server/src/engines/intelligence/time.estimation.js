/**
 * ✦ TIME ESTIMATION ENGINE
 * Predicts task duration using k-nearest similar completed tasks + user bias correction.
 * Learns: after completion, records actual time and updates bias factor.
 */
'use strict';

const { embed } = require('../memory/embed');
const DEFAULT_ESTIMATE_MINS = 60;
const MIN_SAMPLES_FOR_BIAS  = 5;

async function estimateTime(db, userId, itemId) {
  const { rows: [item] } = await db.query(`SELECT id, canonical_text, project FROM items WHERE id=$1 AND user_id=$2`, [itemId, userId]);
  if (!item) throw Object.assign(new Error('Item not found'), { status: 404 });

  const targetVec = await embed(item.canonical_text);
  const vecStr    = `[${targetVec.join(',')}]`;

  const { rows: candidates } = await db.query(
    `SELECT te.item_id, te.actual_mins, te.estimated_mins, i.canonical_text, (i.embedding <=> $2::vector) AS vec_dist FROM time_estimates te JOIN items i ON i.id = te.item_id WHERE te.user_id=$1 AND te.actual_mins IS NOT NULL AND i.state='DONE' ORDER BY i.embedding <=> $2::vector LIMIT 10`,
    [userId, vecStr]
  ).catch(() => ({ rows: [] }));

  let estimateMins = DEFAULT_ESTIMATE_MINS, confidence = 'default';

  if (candidates.length >= 3) {
    const weights = candidates.map(c => Math.max(0, 1 - parseFloat(c.vec_dist)));
    const totalW  = weights.reduce((s, w) => s + w, 0);
    if (totalW > 0) { estimateMins = Math.round(candidates.reduce((s, c, i) => s + c.actual_mins * weights[i], 0) / totalW); confidence = candidates.length >= 7 ? 'high' : 'medium'; }
  } else if (candidates.length > 0) {
    estimateMins = Math.round(candidates.reduce((s, c) => s + c.actual_mins, 0) / candidates.length); confidence = 'low';
  }

  const bias = await _getUserBias(db, userId);
  const correctedEstimate = Math.round(estimateMins * bias.correctionFactor);

  await db.query(`INSERT INTO time_estimates(id, user_id, item_id, estimated_mins, basis, confidence) VALUES(uuid_generate_v4(),$1,$2,$3,$4,$5) ON CONFLICT(user_id, item_id) DO UPDATE SET estimated_mins=$3, basis=$4, confidence=$5, updated_at=now()`, [userId, itemId, correctedEstimate, JSON.stringify({ rawEstimate: estimateMins, biasApplied: bias.correctionFactor, sampleCount: candidates.length }), confidence]).catch(() => {});
  await db.query(`UPDATE items SET estimated_mins=$2 WHERE id=$1`, [itemId, correctedEstimate]).catch(() => {});

  return { itemId, estimatedMins: correctedEstimate, rawEstimateMins: estimateMins, confidence, sampleCount: candidates.length, biasApplied: bias.correctionFactor, biasLabel: bias.label, similarTasks: candidates.slice(0, 3).map(c => ({ text: c.canonical_text, actualMins: c.actual_mins, similarity: parseFloat((1 - parseFloat(c.vec_dist)).toFixed(2)) })) };
}

async function recordActualTime(db, userId, itemId, actualMins) {
  if (!actualMins || actualMins <= 0) return;
  await db.query(`INSERT INTO time_estimates(id, user_id, item_id, actual_mins) VALUES(uuid_generate_v4(),$1,$2,$3) ON CONFLICT(user_id, item_id) DO UPDATE SET actual_mins=$3, completed_at=now(), updated_at=now()`, [userId, itemId, actualMins]).catch(() => {});
}

async function getEstimationStats(db, userId) {
  const { rows } = await db.query(`SELECT count(*) AS total_tasks, avg(actual_mins) AS avg_actual, avg(estimated_mins) AS avg_estimated, avg(actual_mins::float / NULLIF(estimated_mins,0)) AS avg_ratio FROM time_estimates WHERE user_id=$1 AND actual_mins IS NOT NULL AND estimated_mins IS NOT NULL`, [userId]).catch(() => ({ rows: [{}] }));
  const stats = rows[0], ratio = parseFloat(stats.avg_ratio || 1);
  return { totalTasks: parseInt(stats.total_tasks || 0), avgActualMins: Math.round(parseFloat(stats.avg_actual || 0)), avgEstimateMins: Math.round(parseFloat(stats.avg_estimated || 0)), accuracyRatio: parseFloat(ratio.toFixed(2)), biasLabel: ratio > 1.3 ? 'You consistently underestimate' : ratio < 0.8 ? 'You consistently overestimate' : 'Your estimates are fairly accurate', insight: ratio > 1.3 ? `Tasks take ${Math.round((ratio-1)*100)}% longer than you estimate.` : ratio < 0.8 ? `Tasks take ${Math.round((1-ratio)*100)}% less time than you estimate.` : 'Your time estimates are well calibrated.' };
}

async function _getUserBias(db, userId) {
  const { rows } = await db.query(`SELECT count(*) AS n, avg(actual_mins::float / NULLIF(estimated_mins,0)) AS ratio FROM time_estimates WHERE user_id=$1 AND actual_mins IS NOT NULL AND estimated_mins IS NOT NULL`, [userId]).catch(() => ({ rows: [{ n: 0, ratio: 1 }] }));
  const n = parseInt(rows[0].n || 0), ratio = parseFloat(rows[0].ratio || 1);
  if (n < MIN_SAMPLES_FOR_BIAS) return { correctionFactor: 1.0, label: 'learning', sampleCount: n };
  const correctionFactor = isNaN(ratio) || ratio <= 0 ? 1.0 : parseFloat(ratio.toFixed(2));
  return { correctionFactor, label: correctionFactor > 1.2 ? 'underestimator' : correctionFactor < 0.9 ? 'overestimator' : 'accurate', sampleCount: n };
}

module.exports = { estimateTime, recordActualTime, getEstimationStats };
