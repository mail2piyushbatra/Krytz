/**
 * ✦ STATE ENGINE
 *
 * Aggregates extracted states into daily/weekly snapshots.
 * Handles state recomputation, carry-over detection, and trend analysis.
 *
 * Responsibilities:
 *   - Aggregate ExtractedStates → DailyState
 *   - Detect carry-over items (open from previous days)
 *   - Compute daily summaries
 *   - Track trends (productivity, blockers over time)
 */

const BaseEngine = require('../base.engine');
const prisma = require('../../lib/prisma');

class StateEngine extends BaseEngine {
  constructor() {
    super('state');
  }

  async initialize() {
    await super.initialize();
  }

  /**
   * Recompute the daily aggregated state for a user on a given date.
   * Called after every entry create/delete/update.
   */
  async recomputeDaily(userId, timestamp) {
    this.ensureReady();
    this.trackCall();

    const date = new Date(timestamp);
    date.setHours(0, 0, 0, 0);

    const dayEnd = new Date(date);
    dayEnd.setHours(23, 59, 59, 999);

    // Fetch all extracted states for entries on this day
    const entries = await prisma.entry.findMany({
      where: {
        userId,
        timestamp: { gte: date, lte: dayEnd },
      },
      include: { extractedState: true },
    });

    // Aggregate counts
    let openItems = 0;
    let blockerCount = 0;
    let completedCount = 0;
    const allDeadlines = [];
    const allActionItems = [];
    const allBlockers = [];

    for (const entry of entries) {
      if (!entry.extractedState) continue;
      const state = entry.extractedState;

      if (Array.isArray(state.actionItems)) {
        openItems += state.actionItems.length;
        for (const item of state.actionItems) {
          allActionItems.push({ ...item, entryId: entry.id, entryTime: entry.timestamp });
        }
      }
      if (Array.isArray(state.blockers)) {
        blockerCount += state.blockers.length;
        for (const item of state.blockers) {
          allBlockers.push({ ...item, entryId: entry.id, entryTime: entry.timestamp });
        }
      }
      if (Array.isArray(state.completions)) {
        completedCount += state.completions.length;
      }
      if (Array.isArray(state.deadlines)) {
        allDeadlines.push(...state.deadlines);
      }
    }

    // Generate summary
    const summary = this._generateSummary({
      openItems,
      blockerCount,
      completedCount,
      deadlineCount: allDeadlines.length,
    });

    // Upsert daily state
    await prisma.dailyState.upsert({
      where: { userId_date: { userId, date } },
      update: {
        openItems,
        blockerCount,
        completedCount,
        deadlines: allDeadlines,
        summary,
        computedAt: new Date(),
      },
      create: {
        userId,
        date,
        openItems,
        blockerCount,
        completedCount,
        deadlines: allDeadlines,
        summary,
      },
    });

    return { openItems, blockerCount, completedCount, deadlines: allDeadlines, summary };
  }

  /**
   * Get today's full state for a user — aggregated counts + detail items.
   */
  async getToday(userId) {
    this.ensureReady();
    this.trackCall();

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayEnd = new Date(today);
    todayEnd.setHours(23, 59, 59, 999);

    // Get or compute daily state
    let state = await prisma.dailyState.findUnique({
      where: { userId_date: { userId, date: today } },
    });

    if (!state) {
      state = {
        date: today,
        openItems: 0,
        blockerCount: 0,
        completedCount: 0,
        deadlines: [],
        summary: null,
      };
    }

    // Fetch detailed items for the state panel
    const entries = await prisma.entry.findMany({
      where: { userId, timestamp: { gte: today, lte: todayEnd } },
      include: { extractedState: true },
      orderBy: { timestamp: 'desc' },
    });

    const actionItems = [];
    const blockers = [];

    for (const entry of entries) {
      if (!entry.extractedState) continue;
      const es = entry.extractedState;

      if (Array.isArray(es.actionItems)) {
        for (const item of es.actionItems) {
          actionItems.push({ ...item, source: entry.id, timestamp: entry.timestamp });
        }
      }
      if (Array.isArray(es.blockers)) {
        for (const item of es.blockers) {
          blockers.push({ ...item, source: entry.id, timestamp: entry.timestamp });
        }
      }
    }

    return {
      date: state.date,
      openItems: state.openItems,
      blockerCount: state.blockerCount,
      completedCount: state.completedCount,
      deadlines: state.deadlines,
      summary: state.summary,
      actionItems,
      blockers,
    };
  }

  /**
   * Get weekly state — daily breakdown for the past 7 days.
   */
  async getWeek(userId) {
    this.ensureReady();
    this.trackCall();

    const now = new Date();
    const weekAgo = new Date(now);
    weekAgo.setDate(weekAgo.getDate() - 7);
    weekAgo.setHours(0, 0, 0, 0);

    const dailyStates = await prisma.dailyState.findMany({
      where: { userId, date: { gte: weekAgo } },
      orderBy: { date: 'asc' },
    });

    // Compute weekly totals
    const totals = dailyStates.reduce(
      (acc, d) => ({
        openItems: acc.openItems + d.openItems,
        completed: acc.completed + d.completedCount,
        blockers: acc.blockers + d.blockerCount,
      }),
      { openItems: 0, completed: 0, blockers: 0 }
    );

    return {
      weekOf: weekAgo.toISOString().split('T')[0],
      days: dailyStates.map((d) => ({
        date: d.date,
        openItems: d.openItems,
        completed: d.completedCount,
        blockers: d.blockerCount,
        summary: d.summary,
      })),
      totals,
    };
  }

  /**
   * Detect carry-over items — action items open for more than 1 day.
   */
  async getCarryOvers(userId) {
    this.ensureReady();

    const twoDaysAgo = new Date();
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Find action items from before today that haven't been marked done
    const oldEntries = await prisma.entry.findMany({
      where: {
        userId,
        timestamp: { gte: twoDaysAgo, lt: today },
      },
      include: { extractedState: true },
    });

    const carryOvers = [];

    for (const entry of oldEntries) {
      if (!entry.extractedState) continue;
      if (Array.isArray(entry.extractedState.actionItems)) {
        for (const item of entry.extractedState.actionItems) {
          carryOvers.push({
            ...item,
            fromDate: entry.timestamp,
            entryId: entry.id,
            daysOld: Math.floor((Date.now() - entry.timestamp.getTime()) / (24 * 60 * 60 * 1000)),
          });
        }
      }
    }

    return carryOvers;
  }

  /**
   * Generate a human-readable summary from state counts.
   */
  _generateSummary({ openItems, blockerCount, completedCount, deadlineCount }) {
    const parts = [];

    if (completedCount > 0) {
      parts.push(`${completedCount} item${completedCount > 1 ? 's' : ''} completed`);
    }
    if (openItems > 0) {
      parts.push(`${openItems} pending`);
    }
    if (blockerCount > 0) {
      parts.push(`${blockerCount} blocker${blockerCount > 1 ? 's' : ''}`);
    }
    if (deadlineCount > 0) {
      parts.push(`${deadlineCount} deadline${deadlineCount > 1 ? 's' : ''} upcoming`);
    }

    if (parts.length === 0) return 'No activity captured yet.';

    // Determine overall tone
    let prefix;
    if (completedCount > openItems && blockerCount === 0) {
      prefix = 'Productive day';
    } else if (blockerCount > 0) {
      prefix = 'Some blockers today';
    } else {
      prefix = 'Day in progress';
    }

    return `${prefix} — ${parts.join(', ')}.`;
  }
}

module.exports = StateEngine;
