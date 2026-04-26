/**
 * ✦ WHAT-IF SIMULATOR
 * "What happens to my plan if I drop/move/add/snooze this task?"
 * Runs hypothetical mutations WITHOUT persisting. Returns diff vs current plan.
 * Exposed via: POST /simulate
 */
'use strict';

function applyMutation(items, mutation) {
  const cloned = items.map(i => ({ ...i }));
  switch (mutation.type) {
    case 'DROP_ITEM':     return cloned.filter(i => i.id !== mutation.itemId);
    case 'COMPLETE_ITEM': return cloned.filter(i => i.id !== mutation.itemId);
    case 'MOVE_DEADLINE': return cloned.map(i => { if (i.id !== mutation.itemId) return i; const newDl = new Date(mutation.newDeadline); return { ...i, deadline: mutation.newDeadline, deadline_days: (newDl - Date.now()) / 86_400_000 }; });
    case 'ADD_ITEM': {
      const now = new Date();
      return [...cloned, { id: `sim_${Date.now()}`, canonical_text: mutation.text || 'New task', state: 'OPEN', priority: 0.5, blocker: false, project: mutation.project || null, deadline: mutation.dueDate || null, deadline_days: mutation.dueDate ? (new Date(mutation.dueDate) - now) / 86_400_000 : null, mention_count: 1, first_seen: now, last_seen: now, recency_days: 0, persistence_days: 0, downstream_open: 0, snoozed: false, _simulated: true }];
    }
    case 'SNOOZE_ITEM': return cloned.map(i => i.id === mutation.itemId ? { ...i, snoozed: true } : i);
    default:            return cloned;
  }
}

function scoreItem(item) {
  const recency  = Math.max(0, 1 - (parseFloat(item.recency_days)  || 0) / 7);
  const freq     = Math.min(1, (item.mention_count || 1) / 5);
  const deadline = item.deadline_days != null ? Math.max(0, 1 - parseFloat(item.deadline_days) / 7) : 0;
  const blocker  = item.blocker ? 1.0 : 0;
  const causal   = Math.min(1, (parseInt(item.downstream_open) || 0) / 5);
  const inProg   = item.state === 'IN_PROGRESS' ? 0.2 : 0;
  return 0.30*recency + 0.20*freq + 0.20*deadline + 0.15*blocker + 0.10*causal + 0.05*inProg;
}

function buildSimPlan(items) {
  const active     = items.filter(i => !i.snoozed && ['OPEN','IN_PROGRESS'].includes(i.state));
  const scored     = active.map(i => ({ ...i, _score: scoreItem(i) })).sort((a, b) => b._score - a._score);
  const blockers   = scored.filter(i => i.blocker);
  const actionable = scored.filter(i => !i.blocker);
  const inProgress = actionable.filter(i => i.state === 'IN_PROGRESS');
  return { focus: inProgress[0] || actionable[0] || null, next: actionable.filter(i => i.id !== (inProgress[0] || actionable[0])?.id).slice(0, 5), blockers: blockers.slice(0, 3), totalOpen: active.length, simulated: true };
}

function diffPlans(before, after, mutation) {
  const changes = [];
  if (before.focus?.id !== after.focus?.id) changes.push({ type: 'FOCUS_CHANGED', message: before.focus ? `Focus shifts from "${_short(before.focus.canonical_text)}" to "${_short(after.focus?.canonical_text || 'nothing')}"` : `New focus: "${_short(after.focus?.canonical_text)}"` });
  const beforeNextIds = new Set(before.next.map(i => i.id)), afterNextIds = new Set(after.next.map(i => i.id));
  for (const item of after.next) if (!beforeNextIds.has(item.id) && !item._simulated) changes.push({ type: 'SURFACED', message: `"${_short(item.canonical_text)}" moves up into your next list` });
  for (const item of before.next) if (!afterNextIds.has(item.id)) changes.push({ type: 'REMOVED_FROM_NEXT', message: `"${_short(item.canonical_text)}" drops off your next list` });
  if (before.blockers.length !== after.blockers.length) { const delta = after.blockers.length - before.blockers.length; changes.push({ type: 'BLOCKERS_CHANGED', message: delta > 0 ? `${delta} more blocker${delta > 1 ? 's' : ''} surface` : `${Math.abs(delta)} fewer blocker${Math.abs(delta) > 1 ? 's' : ''}` }); }
  const loadDelta = after.totalOpen - before.totalOpen;
  if (loadDelta !== 0) changes.push({ type: 'LOAD_CHANGE', message: `Open items: ${before.totalOpen} → ${after.totalOpen} (${loadDelta > 0 ? '+' : ''}${loadDelta})` });
  if (mutation.type === 'DROP_ITEM' && changes.length === 0) changes.push({ type: 'NO_IMPACT', message: 'Dropping this item has no significant impact on your plan.' });
  return changes;
}

function simulate(currentItems, currentPlan, mutation) {
  const mutatedItems = applyMutation(currentItems, mutation);
  const afterPlan    = buildSimPlan(mutatedItems);
  const changes      = diffPlans(currentPlan, afterPlan, mutation);
  const _s = i => i ? { id: i.id, text: i.canonical_text, state: i.state, priority: parseFloat((i.priority || 0).toFixed(3)), score: i._score ? parseFloat(i._score.toFixed(3)) : undefined } : null;
  return { mutation, changes, before: { focus: _s(currentPlan.focus), next: (currentPlan.next || []).map(_s), blockers: (currentPlan.blockers || []).map(_s), totalOpen: currentPlan.totalOpen }, after: { focus: _s(afterPlan.focus), next: afterPlan.next.map(_s), blockers: afterPlan.blockers.map(_s), totalOpen: afterPlan.totalOpen }, impactLevel: changes.some(c => c.type === 'FOCUS_CHANGED') ? 'high' : changes.some(c => c.type === 'BLOCKERS_CHANGED') ? 'medium' : changes.length === 0 || changes.some(c => c.type === 'NO_IMPACT') ? 'none' : 'low' };
}

function _short(text, max = 50) { return text?.length > max ? text.slice(0, max) + '…' : (text || ''); }

module.exports = { simulate, applyMutation, buildSimPlan, diffPlans };
