/**
 * ✦ STATE ENGINE — v2
 *
 * Upgrades from v1:
 *   - Full timezone awareness (user's tz, not server tz)
 *   - Configurable carryover lookback (default 7 days, was hardcoded 2)
 *   - Item resolution detection via fuzzy token overlap
 *   - Removed direct Prisma imports — data access via injected repository
 *   - Per-project state aggregation
 *   - Weekly summary with productivity trend (up/down/flat)
 */

'use strict';

const BaseEngine = require('../base.engine');
const logger     = require('../../lib/logger');

function startOfDayInTz(date, tz) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const y = parts.find(p => p.type === 'year').value;
  const m = parts.find(p => p.type === 'month').value;
  const d = parts.find(p => p.type === 'day').value;
  return new Date(`${y}-${m}-${d}T00:00:00`);
}

function startAndEndOfDayInTz(date, tz) {
  const start = startOfDayInTz(date, tz);
  const end   = new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1);
  return { start, end };
}

function tokenOverlap(a, b) {
  const tokA = new Set(a.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(t => t.length > 2));
  const tokB = new Set(b.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(t => t.length > 2));
  if (tokA.size === 0) return 0;
  let matches = 0;
  for (const t of tokA) if (tokB.has(t)) matches++;
  return matches / tokA.size;
}

function isResolved(itemText, completions) {
  return completions.some(c => tokenOverlap(itemText, c.text) >= 0.5);
}

class StateEngine extends BaseEngine {
  constructor({ defaultTimezone = 'UTC', carryoverDays = 7 } = {}) {
    super('state');
    this._defaultTz     = defaultTimezone;
    this._carryoverDays = carryoverDays;
  }

  async initialize() {
    await super.initialize();
    logger.info('StateEngine ready', { defaultTz: this._defaultTz, carryoverDays: this._carryoverDays });
  }

  async recomputeDaily(userId, timestamp, repo, timezone) {
    this.ensureReady();
    const done = this.startCall();
    const tz   = timezone || this._defaultTz;
    const { start: dayStart, end: dayEnd } = startAndEndOfDayInTz(new Date(timestamp), tz);
    const dateKey = startOfDayInTz(new Date(timestamp), tz);
    const entries = await repo.getEntriesForDay(userId, dayStart, dayEnd);

    const allActionItems = [], allBlockers = [], allCompletions = [], allDeadlines = [];
    const byProject = {};

    for (const entry of entries) {
      const es      = entry.extractedState;
      if (!es) continue;
      const project = entry.project || 'general';
      if (!byProject[project]) byProject[project] = { open: 0, blocked: 0, completed: 0 };
      if (Array.isArray(es.actionItems))  { for (const i of es.actionItems)  { allActionItems.push({ ...i, entryId: entry.id, entryTime: entry.timestamp, project }); byProject[project].open++; } }
      if (Array.isArray(es.blockers))     { for (const i of es.blockers)     { allBlockers.push(   { ...i, entryId: entry.id, entryTime: entry.timestamp, project }); byProject[project].blocked++; } }
      if (Array.isArray(es.completions))  { for (const i of es.completions)  { allCompletions.push( { ...i, entryId: entry.id, entryTime: entry.timestamp, project }); byProject[project].completed++; } }
      if (Array.isArray(es.deadlines))    allDeadlines.push(...es.deadlines);
    }

    const resolvedItems   = allActionItems.filter(i =>  isResolved(i.text, allCompletions));
    const unresolvedItems = allActionItems.filter(i => !isResolved(i.text, allCompletions));
    const summary = this._generateSummary({ openItems: unresolvedItems.length, blockerCount: allBlockers.length, completedCount: allCompletions.length, deadlineCount: allDeadlines.length });

    await repo.upsertDailyState(userId, dateKey, { openItems: unresolvedItems.length, blockerCount: allBlockers.length, completedCount: allCompletions.length, deadlines: allDeadlines, byProject, summary, computedAt: new Date() });

    done();
    logger.info('Daily state recomputed', { userId, date: dateKey.toISOString().split('T')[0], open: unresolvedItems.length, resolved: resolvedItems.length });
    return { openItems: unresolvedItems.length, blockerCount: allBlockers.length, completedCount: allCompletions.length, deadlines: allDeadlines, summary, byProject };
  }

  async getToday(userId, repo, timezone) {
    this.ensureReady();
    const done = this.startCall();
    const tz   = timezone || this._defaultTz;
    const now  = new Date();
    const { start, end } = startAndEndOfDayInTz(now, tz);
    const dateKey = startOfDayInTz(now, tz);
    let state = await repo.getDailyState(userId, dateKey);
    if (!state) state = { date: dateKey, openItems: 0, blockerCount: 0, completedCount: 0, deadlines: [], summary: null, byProject: {} };
    const entries = await repo.getEntriesForDay(userId, start, end, { includeExtracted: true, orderBy: 'desc' });
    const actionItems = [], blockers = [], completions = [];
    for (const entry of entries) {
      const es = entry.extractedState;
      if (!es) continue;
      if (Array.isArray(es.actionItems)) { for (const i of es.actionItems) { if (!isResolved(i.text, es.completions || [])) actionItems.push({ ...i, source: entry.id, timestamp: entry.timestamp, project: entry.project }); } }
      if (Array.isArray(es.blockers))    for (const i of es.blockers)    blockers.push(   { ...i, source: entry.id, timestamp: entry.timestamp });
      if (Array.isArray(es.completions)) for (const i of es.completions) completions.push( { ...i, source: entry.id, timestamp: entry.timestamp });
    }
    done();
    return { date: state.date, timezone: tz, openItems: state.openItems, blockerCount: state.blockerCount, completedCount: state.completedCount, deadlines: state.deadlines, byProject: state.byProject || {}, summary: state.summary, actionItems, blockers, completions };
  }

  async getWeek(userId, repo, timezone) {
    this.ensureReady();
    const done   = this.startCall();
    const tz     = timezone || this._defaultTz;
    const now    = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const start   = startOfDayInTz(weekAgo, tz);
    const dailyStates = await repo.getDailyStatesRange(userId, start, now);
    const totals = dailyStates.reduce((acc, d) => ({ openItems: acc.openItems + d.openItems, completed: acc.completed + d.completedCount, blockers: acc.blockers + d.blockerCount }), { openItems: 0, completed: 0, blockers: 0 });
    const mid = Math.floor(dailyStates.length / 2);
    const avg = arr => arr.length > 0 ? arr.reduce((s, d) => s + d.completedCount, 0) / arr.length : 0;
    const diff = avg(dailyStates.slice(mid)) - avg(dailyStates.slice(0, mid));
    let trend = 'flat';
    if (diff >  0.5) trend = 'up';
    if (diff < -0.5) trend = 'down';
    done();
    return { weekOf: start.toISOString().split('T')[0], timezone: tz, days: dailyStates.map(d => ({ date: d.date, openItems: d.openItems, completed: d.completedCount, blockers: d.blockerCount, summary: d.summary, byProject: d.byProject || {} })), totals, trend };
  }

  async getCarryOvers(userId, repo, timezone) {
    this.ensureReady();
    const tz     = timezone || this._defaultTz;
    const now    = new Date();
    const cutoff = new Date(now.getTime() - this._carryoverDays * 24 * 60 * 60 * 1000);
    const today  = startOfDayInTz(now, tz);
    const oldEntries = await repo.getEntriesRange(userId, cutoff, today, { includeExtracted: true });
    const allCompletions = [];
    for (const entry of oldEntries) { if (Array.isArray(entry.extractedState?.completions)) allCompletions.push(...entry.extractedState.completions); }
    const carryOvers = [];
    for (const entry of oldEntries) {
      const es = entry.extractedState;
      if (!es || !Array.isArray(es.actionItems)) continue;
      for (const item of es.actionItems) {
        if (isResolved(item.text, allCompletions)) continue;
        const daysOld = Math.floor((now - new Date(entry.timestamp)) / (24 * 60 * 60 * 1000));
        carryOvers.push({ ...item, fromDate: entry.timestamp, entryId: entry.id, daysOld, project: entry.project || 'general', urgency: daysOld >= 5 ? 'high' : daysOld >= 3 ? 'medium' : 'low' });
      }
    }
    carryOvers.sort((a, b) => b.daysOld - a.daysOld);
    logger.info('Carryovers computed', { userId, count: carryOvers.length, lookbackDays: this._carryoverDays });
    return carryOvers;
  }

  _generateSummary({ openItems, blockerCount, completedCount, deadlineCount }) {
    const parts = [];
    if (completedCount > 0) parts.push(`${completedCount} completed`);
    if (openItems      > 0) parts.push(`${openItems} pending`);
    if (blockerCount   > 0) parts.push(`${blockerCount} blocker${blockerCount > 1 ? 's' : ''}`);
    if (deadlineCount  > 0) parts.push(`${deadlineCount} deadline${deadlineCount > 1 ? 's' : ''} ahead`);
    if (parts.length === 0) return 'No activity captured yet.';
    let prefix;
    if (completedCount > openItems && blockerCount === 0) prefix = 'Productive day';
    else if (blockerCount > 2)                            prefix = 'Heavy blockers';
    else if (blockerCount > 0)                            prefix = 'Some friction';
    else                                                  prefix = 'Day in progress';
    return `${prefix} — ${parts.join(', ')}.`;
  }
}

module.exports = StateEngine;
