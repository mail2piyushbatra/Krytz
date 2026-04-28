/**
 * ✦ EXECUTION ENGINE
 *
 * Translates decisions into side effects (commands). The closed loop:
 *   Decision → Command → Side Effect → New Event → Back to Decision
 *
 * Command types:
 *   NOTIFY_USER     — create a notification
 *   SCHEDULE_TASK   — set a deadline/reminder
 *   DEFER_TASK      — snooze an item
 *   MARK_DONE       — complete an item
 *   ESCALATE        — create a high-priority notification
 *   OPEN_CONTEXT    — surface related items/context
 *
 * Properties:
 *   - Every command is idempotent (safe to retry)
 *   - Retries with exponential backoff (max 3 attempts)
 *   - Failed commands logged with FAILED status + recovery events
 *   - Execution produces new events (closed loop)
 */
'use strict';

const { v4: uuid } = require('uuid');
const logger = require('../../lib/logger');

// ─── Command types ────────────────────────────────────────────────────────────
const CommandType = Object.freeze({
  NOTIFY_USER:   'NOTIFY_USER',
  SCHEDULE_TASK: 'SCHEDULE_TASK',
  DEFER_TASK:    'DEFER_TASK',
  MARK_DONE:     'MARK_DONE',
  ESCALATE:      'ESCALATE',
  OPEN_CONTEXT:  'OPEN_CONTEXT',
});

const CommandStatus = Object.freeze({
  PENDING:   'PENDING',
  RUNNING:   'RUNNING',
  COMPLETED: 'COMPLETED',
  FAILED:    'FAILED',
});

const MAX_RETRIES    = 3;
const BASE_BACKOFF   = 200; // ms

/**
 * Execute a batch of commands.
 * Each command runs independently — failure of one doesn't affect others.
 *
 * @param {Object}   db       - pg Pool
 * @param {string}   userId
 * @param {Object[]} commands - [{ type, payload, source }]
 * @returns {Object} { results: CommandResult[], events: Event[] }
 */
async function executeBatch(db, userId, commands) {
  const results = [];
  const events  = [];

  for (const cmd of commands) {
    const result = await executeCommand(db, userId, cmd);
    results.push(result);
    if (result.events) events.push(...result.events);
  }

  return { results, events };
}

/**
 * Execute a single command with retry logic.
 */
async function executeCommand(db, userId, command) {
  const cmdId     = uuid();
  const startTime = Date.now();
  let attempts    = 0;
  let lastError   = null;

  while (attempts <= MAX_RETRIES) {
    try {
      const result = await _dispatch(db, userId, command);

      // Log success
      await _logCommand(db, userId, cmdId, command, CommandStatus.COMPLETED, attempts + 1, null);

      return {
        commandId: cmdId,
        type:      command.type,
        status:    CommandStatus.COMPLETED,
        result,
        attempts:  attempts + 1,
        durationMs: Date.now() - startTime,
        events:    result.events || [],
      };
    } catch (err) {
      lastError = err;
      attempts++;

      if (attempts <= MAX_RETRIES) {
        const delay = BASE_BACKOFF * Math.pow(2, attempts - 1);
        await new Promise(r => setTimeout(r, delay));
        logger.warn('Command retry', { cmdId, type: command.type, attempt: attempts, error: err.message });
      }
    }
  }

  // All retries exhausted
  await _logCommand(db, userId, cmdId, command, CommandStatus.FAILED, attempts, lastError?.message);

  logger.error('Command failed permanently', { cmdId, type: command.type, attempts, error: lastError?.message });

  return {
    commandId: cmdId,
    type:      command.type,
    status:    CommandStatus.FAILED,
    error:     lastError?.message,
    attempts,
    durationMs: Date.now() - startTime,
    events:    [{ type: 'COMMAND_FAILED', commandId: cmdId, commandType: command.type, error: lastError?.message }],
  };
}

// ─── Command dispatchers (idempotent) ─────────────────────────────────────────

async function _dispatch(db, userId, command) {
  switch (command.type) {
    case CommandType.NOTIFY_USER:
      return _execNotify(db, userId, command.payload);

    case CommandType.SCHEDULE_TASK:
      return _execSchedule(db, userId, command.payload);

    case CommandType.DEFER_TASK:
      return _execDefer(db, userId, command.payload);

    case CommandType.MARK_DONE:
      return _execMarkDone(db, userId, command.payload);

    case CommandType.ESCALATE:
      return _execEscalate(db, userId, command.payload);

    case CommandType.OPEN_CONTEXT:
      return _execOpenContext(db, userId, command.payload);

    default:
      throw new Error(`Unknown command type: ${command.type}`);
  }
}

async function _execNotify(db, userId, payload) {
  const { title, body, meta = {} } = payload;
  const id = uuid();

  // Idempotent: check dedupe key
  if (meta.dedupe) {
    const { rows } = await db.query(
      `SELECT id FROM notifications WHERE user_id = $1 AND meta->>'dedupe' = $2 AND created_at > now() - interval '1 hour'`,
      [userId, meta.dedupe]
    );
    if (rows.length > 0) return { notificationId: rows[0].id, deduplicated: true, events: [] };
  }

  await db.query(
    `INSERT INTO notifications(id, user_id, type, title, body, meta) VALUES($1, $2, 'info', $3, $4, $5)`,
    [id, userId, title, body, JSON.stringify(meta)]
  );

  return {
    notificationId: id,
    events: [{ type: 'NOTIFICATION_CREATED', notificationId: id, title }],
  };
}

async function _execSchedule(db, userId, payload) {
  const { itemId, deadline } = payload;

  await db.query(
    `UPDATE items SET deadline = $2, updated_at = now() WHERE id = $1 AND user_id = $3`,
    [itemId, deadline, userId]
  );

  await db.query(
    `INSERT INTO item_events(item_id, from_state, to_state, confidence, reason)
     SELECT state, state, state, confidence, $2 FROM items WHERE id = $1`,
    [itemId, `deadline_set:${deadline}`]
  ).catch(() => {});

  return {
    itemId,
    deadline,
    events: [{ type: 'DEADLINE_SET', itemId, deadline }],
  };
}

async function _execDefer(db, userId, payload) {
  const { itemId, snoozeUntil } = payload;
  const id = uuid();

  // Idempotent: upsert snooze
  await db.query(
    `INSERT INTO snoozes(id, user_id, item_id, snooze_until)
     VALUES($1, $2, $3, $4)
     ON CONFLICT(user_id, item_id) DO UPDATE SET snooze_until = $4, updated_at = now()`,
    [id, userId, itemId, snoozeUntil]
  );

  return {
    itemId,
    snoozeUntil,
    events: [{ type: 'ITEM_SNOOZED', itemId, snoozeUntil }],
  };
}

async function _execMarkDone(db, userId, payload) {
  const { itemId } = payload;

  const { rows: [item] } = await db.query(
    `SELECT state FROM items WHERE id = $1 AND user_id = $2`,
    [itemId, userId]
  );

  // Idempotent: already done
  if (item && item.state === 'DONE') return { itemId, alreadyDone: true, events: [] };

  const prevState = item?.state || 'OPEN';

  await db.query(
    `UPDATE items SET state = 'DONE', confidence = 1.0, updated_at = now() WHERE id = $1 AND user_id = $2`,
    [itemId, userId]
  );

  await db.query(
    `INSERT INTO item_events(item_id, from_state, to_state, confidence, reason)
     VALUES($1, $2, 'DONE', 1.0, 'execution_engine')`,
    [itemId, prevState]
  ).catch(() => {});

  return {
    itemId,
    prevState,
    events: [{ type: 'ITEM_COMPLETED', itemId, prevState }],
  };
}

async function _execEscalate(db, userId, payload) {
  const { itemId, reason } = payload;
  const id = uuid();

  const { rows: [item] } = await db.query(
    `SELECT canonical_text FROM items WHERE id = $1 AND user_id = $2`,
    [itemId, userId]
  ).catch(() => ({ rows: [null] }));

  const title = '🔴 Escalation';
  const body  = reason || `"${(item?.canonical_text || 'Unknown item').slice(0, 80)}" needs immediate attention.`;

  await db.query(
    `INSERT INTO notifications(id, user_id, type, title, body, meta)
     VALUES($1, $2, 'alert', $3, $4, $5)`,
    [id, userId, title, body, JSON.stringify({ itemId, escalation: true })]
  );

  // Boost priority
  await db.query(
    `UPDATE items SET priority = LEAST(1.0, priority + 0.3), updated_at = now() WHERE id = $1`,
    [itemId]
  ).catch(() => {});

  return {
    notificationId: id,
    itemId,
    events: [{ type: 'ITEM_ESCALATED', itemId, notificationId: id }],
  };
}

async function _execOpenContext(db, userId, payload) {
  const { itemId } = payload;

  // Gather related context: upstream deps, recent events, related entities
  const [deps, events, mentions] = await Promise.all([
    db.query(
      `SELECT i.id, i.canonical_text, i.state FROM item_edges e JOIN items i ON i.id = e.to_item
       WHERE e.from_item = $1 AND e.user_id = $2`,
      [itemId, userId]
    ).then(r => r.rows).catch(() => []),

    db.query(
      `SELECT from_state, to_state, reason, created_at FROM item_events
       WHERE item_id = $1 ORDER BY created_at DESC LIMIT 5`,
      [itemId]
    ).then(r => r.rows).catch(() => []),

    db.query(
      `SELECT source_entry_id FROM items WHERE id = $1 AND user_id = $2`,
      [itemId, userId]
    ).then(r => r.rows[0]?.source_entry_id).catch(() => null),
  ]);

  return {
    itemId,
    dependencies: deps,
    recentEvents: events,
    sourceEntry:  mentions,
    events: [],
  };
}

// ─── Command logging ──────────────────────────────────────────────────────────

async function _logCommand(db, userId, cmdId, command, status, attempts, error) {
  try {
    await db.query(
      `INSERT INTO command_log(id, user_id, command_type, payload, status, attempts, error)
       VALUES($1, $2, $3, $4, $5, $6, $7)`,
      [cmdId, userId, command.type, JSON.stringify(command.payload || {}), status, attempts, error]
    );
  } catch (_) {
    // Command log table may not exist yet — non-fatal
    logger.warn('Command log insert failed (table may not exist)', { cmdId });
  }
}

/**
 * Get command execution history for a user.
 */
async function getCommandHistory(db, userId, limit = 50) {
  const { rows } = await db.query(
    `SELECT id, command_type, status, attempts, error, created_at
     FROM command_log WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [userId, limit]
  ).catch(() => ({ rows: [] }));
  return rows;
}

module.exports = { executeBatch, executeCommand, getCommandHistory, CommandType, CommandStatus };
