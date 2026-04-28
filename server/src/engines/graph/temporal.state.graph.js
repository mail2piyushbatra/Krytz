/**
 * ✦ TEMPORAL STATE GRAPH (TSG) — v2 (DB-backed)
 *
 * Tracks every action item as a node in a persistent state graph.
 * Items transition through states; confidence decays without evidence
 * and reinforces on reappearance.
 *
 * v2 changes:
 *   - All mutations write through to the `items` + `item_events` tables
 *   - `loadFromDB(userId)` hydrates in-memory cache from PostgreSQL
 *   - `loadAllFromDB()` bulk-loads on server startup (warm cache)
 *   - In-memory map is still the hot path for reads (zero latency)
 *   - Falls back gracefully to in-memory-only if DB unavailable
 *
 * State machine:
 *   OPEN → IN_PROGRESS → DONE
 *      ↘              ↗
 *        DROPPED (no mention for N days)
 *
 * Core algorithms:
 *   - Fuzzy item matching (token overlap — swap for cosine when pgvector available)
 *   - Bayesian-style confidence decay + reinforcement
 *   - Priority scoring: recency × frequency × blocker weight × deadline proximity
 *   - Lifecycle events recorded for audit + training (to `item_events` table)
 */

'use strict';

const logger = require('../../lib/logger');

// ─── Item states ──────────────────────────────────────────────────────────────
const ItemState = Object.freeze({
  OPEN:        'OPEN',
  IN_PROGRESS: 'IN_PROGRESS',
  DONE:        'DONE',
  DROPPED:     'DROPPED',
});

// ─── Config defaults ──────────────────────────────────────────────────────────
const DEFAULTS = {
  decayRate:          0.85,    // confidence multiplier per day without mention
  reinforceRate:      0.15,    // confidence boost on re-mention
  dropThresholdDays:  7,       // days of silence → DROPPED
  matchThreshold:     0.50,    // token overlap for "same item"
  maxPriorityAge:     30,      // days before age stops affecting priority
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function tokenOverlap(a, b) {
  const tok = (s) => new Set(
    s.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(t => t.length > 2)
  );
  const setA = tok(a);
  const setB = tok(b);
  if (setA.size === 0) return 0;
  let matches = 0;
  for (const t of setA) if (setB.has(t)) matches++;
  return matches / setA.size;
}

function daysSince(ts) {
  return (Date.now() - new Date(ts).getTime()) / (24 * 60 * 60 * 1000);
}

function deadlineProximityScore(dueDateStr) {
  if (!dueDateStr) return 0;
  const daysLeft = (new Date(dueDateStr) - Date.now()) / (24 * 60 * 60 * 1000);
  if (daysLeft <= 0)  return 1.0;   // overdue
  if (daysLeft <= 1)  return 0.9;
  if (daysLeft <= 3)  return 0.7;
  if (daysLeft <= 7)  return 0.5;
  if (daysLeft <= 14) return 0.3;
  return 0.1;
}

// ─── TSGNode ──────────────────────────────────────────────────────────────────
class TSGNode {
  constructor({ id, text, project = 'general', dueDate = null, source = null, userId = null }) {
    this.id         = id;
    this.text       = text;
    this.project    = project;
    this.dueDate    = dueDate;
    this.source     = source;    // entryId of first mention
    this.userId     = userId;

    this.state      = ItemState.OPEN;
    this.confidence = 0.7;       // initial

    this.firstSeen  = new Date();
    this.lastSeen   = new Date();
    this.mentions   = 1;

    // Full transition history for audit / training data
    this.transitions = [
      { from: null, to: ItemState.OPEN, ts: new Date(), confidence: 0.7 }
    ];
  }

  // ── State transitions ──────────────────────────────────────────────────────

  transitionTo(newState, confidence) {
    if (this.state === newState) return;

    this.transitions.push({
      from:       this.state,
      to:         newState,
      ts:         new Date(),
      confidence: confidence ?? this.confidence,
    });

    this.state = newState;
    if (confidence !== undefined) this.confidence = confidence;
  }

  // ── Decay: called each day this item is NOT mentioned ─────────────────────

  decay() {
    this.confidence = Math.max(0.05, this.confidence * DEFAULTS.decayRate);
  }

  // ── Reinforce: called when this item appears again in new evidence ─────────

  reinforce(delta = DEFAULTS.reinforceRate) {
    this.confidence = Math.min(1.0, this.confidence + delta);
    this.lastSeen   = new Date();
    this.mentions++;
  }

  // ── Priority score ────────────────────────────────────────────────────────

  get priority() {
    const recency  = Math.max(0, 1 - daysSince(this.lastSeen)  / DEFAULTS.maxPriorityAge);
    const freq     = Math.min(1, this.mentions / 10);
    const deadline = deadlineProximityScore(this.dueDate);

    // blocker weight: IN_PROGRESS items that haven't resolved = high urgency
    const blockerW = this.state === ItemState.IN_PROGRESS ? 0.8 : 0;

    return parseFloat((
      0.35 * recency  +
      0.25 * freq     +
      0.25 * deadline +
      0.15 * blockerW
    ).toFixed(3));
  }

  // ── Serialisable snapshot ─────────────────────────────────────────────────

  toJSON() {
    return {
      id:          this.id,
      text:        this.text,
      project:     this.project,
      dueDate:     this.dueDate,
      state:       this.state,
      confidence:  this.confidence,
      priority:    this.priority,
      firstSeen:   this.firstSeen,
      lastSeen:    this.lastSeen,
      mentions:    this.mentions,
      transitions: this.transitions,
    };
  }
}

// ─── TemporalStateGraph ───────────────────────────────────────────────────────
class TemporalStateGraph {
  constructor(opts = {}) {
    this._items    = new Map();          // itemId → TSGNode
    this._opts     = { ...DEFAULTS, ...opts };
    this._events   = [];                 // event log (event sourcing)
    this._db       = null;               // pg Pool — injected via setDB()
  }

  // ─── DB wiring ────────────────────────────────────────────────────────────

  /**
   * Inject the pg Pool for persistence. Call once at startup.
   * If never called, TSG operates in memory-only mode (tests, offline).
   */
  setDB(pool) {
    this._db = pool;
  }

  /**
   * Load all items from the DB into memory. Call once at server startup.
   * Hydrates the in-memory Map from the `items` table.
   */
  async loadAllFromDB() {
    if (!this._db) return;
    try {
      const { rows } = await this._db.query(
        `SELECT * FROM items WHERE state IN ('OPEN', 'IN_PROGRESS') ORDER BY last_seen DESC LIMIT 10000`
      );
      for (const row of rows) {
        const node = this._rowToNode(row);
        this._items.set(node.id, node);
      }
      logger.info('TSG hydrated from database', { itemCount: rows.length });
    } catch (err) {
      logger.warn('TSG failed to hydrate from DB — running in-memory only', { error: err.message });
    }
  }

  /**
   * Load items for a specific user from the DB.
   * Used when a user first interacts and their items aren't in cache yet.
   */
  async loadUserFromDB(userId) {
    if (!this._db) return;
    try {
      const { rows } = await this._db.query(
        `SELECT * FROM items WHERE user_id = $1 AND state IN ('OPEN', 'IN_PROGRESS') ORDER BY last_seen DESC LIMIT 1000`,
        [userId]
      );
      let loaded = 0;
      for (const row of rows) {
        if (!this._items.has(row.id)) {
          this._items.set(row.id, this._rowToNode(row));
          loaded++;
        }
      }
      if (loaded > 0) logger.info('TSG loaded user items', { userId, loaded });
    } catch (err) {
      logger.warn('TSG failed to load user items', { userId, error: err.message });
    }
  }

  // ─── Ingest new evidence ──────────────────────────────────────────────────

  /**
   * Process extracted state from a single entry.
   * Matches items to existing nodes (or creates new ones),
   * applies belief updates, and runs lifecycle transitions.
   *
   * @param {Object} extractedState  - Output from ExtractionEngine
   * @param {Object} opts
   * @param {string} opts.entryId
   * @param {string} opts.project
   * @param {string} opts.userId
   */
  async ingestEvidence(extractedState, { entryId, project = 'general', userId } = {}) {
    const { actionItems = [], completions = [], blockers = [] } = extractedState;

    // 1. Match / create nodes for each action item
    for (const item of actionItems) {
      const existing = this._findMatch(item.text, userId);

      if (existing) {
        const prevState = existing.state;
        existing.reinforce();
        if (existing.state === ItemState.OPEN) {
          // Check if there's motion (re-mention after a gap = in progress)
          const gap = daysSince(existing.lastSeen);
          if (gap > 0.5) existing.transitionTo(ItemState.IN_PROGRESS, existing.confidence + 0.1);
        }
        this._emit('BELIEF_UPDATED', { itemId: existing.id, state: existing.state, confidence: existing.confidence, entryId });
        await this._persistItem(existing, prevState !== existing.state ? prevState : null);
      } else {
        const node = new TSGNode({
          id:       `item_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          text:     item.text,
          project,
          dueDate:  item.dueDate || null,
          source:   entryId,
          userId,
        });
        this._items.set(node.id, node);
        this._emit('ITEM_CREATED', { itemId: node.id, text: node.text, entryId });
        await this._persistNewItem(node);
      }
    }

    // 2. Process completions — mark matching open items DONE
    for (const completion of completions) {
      const match = this._findMatch(completion.text, userId);
      if (match && match.state !== ItemState.DONE) {
        const prevState = match.state;
        match.transitionTo(ItemState.DONE, 1.0);
        this._emit('BELIEF_UPDATED', { itemId: match.id, state: ItemState.DONE, confidence: 1.0, entryId });
        await this._persistItem(match, prevState);
      }
    }

    // 3. Blockers mentioned → boost priority of blocked items
    for (const blocker of blockers) {
      const match = this._findMatch(blocker.text, userId);
      if (match) {
        match.reinforce(0.05);  // small boost — being a blocker increases salience
        await this._persistItem(match, null);
      }
    }
  }

  // ─── Daily maintenance ────────────────────────────────────────────────────

  /**
   * Run daily decay and drop detection.
   * Call once per day from a cron job or StateEngine.
   */
  async runDailyMaintenance() {
    const dropped = [];

    for (const node of this._items.values()) {
      if (node.state === ItemState.DONE || node.state === ItemState.DROPPED) continue;

      const silent = daysSince(node.lastSeen);

      // Decay confidence
      if (silent >= 1) node.decay();

      // Drop if too old without mention
      if (silent >= this._opts.dropThresholdDays && node.state !== ItemState.DONE) {
        const prevState = node.state;
        node.transitionTo(ItemState.DROPPED, node.confidence * 0.3);
        dropped.push(node.id);
        this._emit('BELIEF_UPDATED', { itemId: node.id, state: ItemState.DROPPED, confidence: node.confidence });
        await this._persistItem(node, prevState);
      } else if (silent >= 1) {
        // Persist decayed confidence
        await this._persistItem(node, null);
      }
    }

    // Evict DONE/DROPPED items from memory — but keep DONE for 7 days
    // so the completion ledger can serve recent completions from cache.
    // DB is the ultimate source of truth for older history.
    const evictionThresholdDays = 7;
    for (const [id, node] of this._items) {
      if (node.state === ItemState.DROPPED) {
        this._items.delete(id);
      } else if (node.state === ItemState.DONE) {
        const doneDays = daysSince(node.lastSeen);
        if (doneDays >= evictionThresholdDays) {
          this._items.delete(id);
        }
      }
    }

    return dropped;
  }

  // ─── Query interface ──────────────────────────────────────────────────────

  getOpenItems(project, userId) {
    return this._getByState([ItemState.OPEN, ItemState.IN_PROGRESS], project, userId)
      .sort((a, b) => b.priority - a.priority);
  }

  getDoneItems(project, userId) {
    return this._getByState([ItemState.DONE], project, userId);
  }

  getDroppedItems(project, userId) {
    return this._getByState([ItemState.DROPPED], project, userId);
  }

  getAllItems(userId) {
    const items = [...this._items.values()];
    if (userId) return items.filter(n => n.userId === userId).map(n => n.toJSON());
    return items.map(n => n.toJSON());
  }

  getItem(itemId) {
    return this._items.get(itemId)?.toJSON() || null;
  }

  getEvents(since) {
    if (!since) return [...this._events];
    return this._events.filter(e => e.ts >= since);
  }

  /**
   * Compute a project-level snapshot (for StateEngine).
   */
  getProjectSnapshot(project, userId) {
    let items = [...this._items.values()];
    if (userId) items = items.filter(n => n.userId === userId);
    if (project) items = items.filter(n => n.project === project);

    const byState = { OPEN: 0, IN_PROGRESS: 0, DONE: 0, DROPPED: 0 };
    for (const n of items) byState[n.state]++;

    const topPriority = items
      .filter(n => n.state !== ItemState.DONE && n.state !== ItemState.DROPPED)
      .sort((a, b) => b.priority - a.priority)
      .slice(0, 5)
      .map(n => n.toJSON());

    return { project: project || 'all', counts: byState, topPriority };
  }

  // ─── Serialization (kept for backwards compat / export) ───────────────────

  serialize() {
    return {
      items:  [...this._items.values()].map(n => n.toJSON()),
      events: this._events,
    };
  }

  static deserialize(data) {
    const tsg = new TemporalStateGraph();
    for (const item of data.items || []) {
      const node = new TSGNode(item);
      Object.assign(node, item);  // restore all fields
      tsg._items.set(node.id, node);
    }
    tsg._events = data.events || [];
    return tsg;
  }

  // ─── DB Persistence (write-through) ───────────────────────────────────────

  /**
   * Insert a new item into the `items` table + initial `item_events` record.
   */
  async _persistNewItem(node) {
    if (!this._db) return;
    try {
      await this._db.query(
        `INSERT INTO items(id, user_id, canonical_text, state, priority, confidence, deadline,
                           mention_count, first_seen, last_seen, source_entry_id)
         VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (id) DO NOTHING`,
        [node.id, node.userId, node.text, node.state, node.priority, node.confidence,
         node.dueDate, node.mentions, node.firstSeen, node.lastSeen, node.source]
      );
      await this._db.query(
        `INSERT INTO item_events(item_id, from_state, to_state, confidence, reason)
         VALUES($1, NULL, $2, $3, 'created')`,
        [node.id, node.state, node.confidence]
      );
    } catch (err) {
      logger.warn('TSG: failed to persist new item', { itemId: node.id, error: err.message });
    }
  }

  /**
   * Update an existing item in the `items` table.
   * If `prevState` is provided, also logs a state transition to `item_events`.
   */
  async _persistItem(node, prevState) {
    if (!this._db) return;
    try {
      await this._db.query(
        `UPDATE items SET
           state = $1, priority = $2, confidence = $3,
           mention_count = $4, last_seen = $5, updated_at = now()
         WHERE id = $6`,
        [node.state, node.priority, node.confidence, node.mentions, node.lastSeen, node.id]
      );
      if (prevState && prevState !== node.state) {
        await this._db.query(
          `INSERT INTO item_events(item_id, from_state, to_state, confidence, reason)
           VALUES($1, $2, $3, $4, 'auto')`,
          [node.id, prevState, node.state, node.confidence]
        );
      }
    } catch (err) {
      logger.warn('TSG: failed to persist item update', { itemId: node.id, error: err.message });
    }
  }

  /**
   * Convert a DB row from `items` table into a TSGNode.
   */
  _rowToNode(row) {
    const node = new TSGNode({
      id:       row.id,
      text:     row.canonical_text,
      project:  'general',
      dueDate:  row.deadline,
      source:   row.source_entry_id,
      userId:   row.user_id,
    });
    node.state      = row.state;
    node.confidence = row.confidence;
    node.firstSeen  = row.first_seen;
    node.lastSeen   = row.last_seen;
    node.mentions   = row.mention_count;
    node.transitions = []; // not loaded from DB — use item_events table for history
    return node;
  }

  // ─── Private ──────────────────────────────────────────────────────────────

  _findMatch(text, userId) {
    let bestNode  = null;
    let bestScore = this._opts.matchThreshold;

    for (const node of this._items.values()) {
      if (node.state === ItemState.DONE || node.state === ItemState.DROPPED) continue;
      if (userId && node.userId && node.userId !== userId) continue;
      const score = tokenOverlap(text, node.text);
      if (score > bestScore) {
        bestScore = score;
        bestNode  = node;
      }
    }

    return bestNode;
  }

  _getByState(states, project, userId) {
    return [...this._items.values()]
      .filter(n =>
        states.includes(n.state) &&
        (!project || n.project === project) &&
        (!userId || n.userId === userId)
      )
      .map(n => n.toJSON());
  }

  _emit(type, payload) {
    this._events.push({ type, ts: Date.now(), ...payload });
    if (this._events.length > 10_000) this._events.shift(); // ring buffer
  }
}

module.exports = { TemporalStateGraph, TSGNode, ItemState };
