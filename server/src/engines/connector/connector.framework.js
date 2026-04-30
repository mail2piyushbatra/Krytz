/**
 * ✦ CONNECTOR FRAMEWORK
 *
 * Base adapter pattern for external data sources (Google Calendar, Gmail, Notion, etc.).
 * Phase 3 foundation — adapters are plug-and-play:
 *
 *   BaseAdapter → CalendarAdapter extends BaseAdapter
 *                 GmailAdapter extends BaseAdapter
 *                 NotionAdapter extends BaseAdapter
 *
 * Each adapter must implement:
 *   - connect(userId, credentials)  → store OAuth tokens
 *   - disconnect(userId)            → revoke + delete tokens
 *   - sync(userId)                  → pull new data, filter actionable, return IRs
 *   - getStatus(userId)             → connected/disconnected/error
 *
 * Security:
 *   - OAuth tokens redacted from API responses
 *   - Production deployments should encrypt connector_state.meta at rest
 *   - Scoped permissions (read-only by default)
 *   - User approval required for each data type
 *   - Rate limiting per adapter (respect API quotas)
 *
 * Data pipeline:
 *   External API → Adapter.sync() → filter(actionable) → NormalizationEngine → Cortex
 */
'use strict';

const { v4: uuid } = require('uuid');
const logger = require('../../lib/logger');

// ─── Adapter states ───────────────────────────────────────────────────────────
const ConnectorState = Object.freeze({
  DISCONNECTED: 'disconnected',
  CONNECTED:    'connected',
  SYNCING:      'syncing',
  ERROR:        'error',
  PAUSED:       'paused',
});

// ─── Permission model ─────────────────────────────────────────────────────────
const PermissionScope = Object.freeze({
  READ:  'read',
  WRITE: 'write',
});

// ─── Base Adapter ─────────────────────────────────────────────────────────────
class BaseAdapter {
  constructor(name, options = {}) {
    this.name           = name;
    this.displayName    = options.displayName || name;
    this.description    = options.description || '';
    this.icon           = options.icon || '🔗';
    this.scopes         = options.scopes || [PermissionScope.READ];
    this.rateLimitPerMin = options.rateLimitPerMin || 30;
    this.requiresAuth   = options.requiresAuth !== false;
  }

  // Override in subclasses
  async connect(db, userId, credentials) { throw new Error(`${this.name}.connect() not implemented`); }
  async disconnect(db, userId)           { throw new Error(`${this.name}.disconnect() not implemented`); }
  async sync(db, userId)                 { throw new Error(`${this.name}.sync() not implemented`); }
  async getStatus(db, userId)            { return ConnectorState.DISCONNECTED; }

  /**
   * Get adapter metadata for UI display.
   */
  toJSON() {
    return {
      name:         this.name,
      displayName:  this.displayName,
      description:  this.description,
      icon:         this.icon,
      scopes:       this.scopes,
      requiresAuth: this.requiresAuth,
    };
  }
}

// ─── Adapter Registry ─────────────────────────────────────────────────────────
class ConnectorRegistry {
  constructor() {
    this._adapters = new Map();
  }

  register(adapter) {
    if (!(adapter instanceof BaseAdapter)) throw new Error('Adapter must extend BaseAdapter');
    this._adapters.set(adapter.name, adapter);
    logger.info('Connector adapter registered', { name: adapter.name });
  }

  get(name) {
    return this._adapters.get(name) || null;
  }

  list() {
    return [...this._adapters.values()].map(a => a.toJSON());
  }

  async getStatusAll(db, userId) {
    const results = [];
    for (const [name, adapter] of this._adapters) {
      try {
        const status = await adapter.getStatus(db, userId);
        results.push({ name, displayName: adapter.displayName, icon: adapter.icon, status });
      } catch (err) {
        results.push({ name, displayName: adapter.displayName, icon: adapter.icon, status: ConnectorState.ERROR, error: err.message });
      }
    }
    return results;
  }

  async connect(db, userId, adapterName, credentials) {
    const adapter = this.get(adapterName);
    if (!adapter) throw Object.assign(new Error(`Unknown adapter: ${adapterName}`), { status: 404 });
    return adapter.connect(db, userId, credentials);
  }

  async disconnect(db, userId, adapterName) {
    const adapter = this.get(adapterName);
    if (!adapter) throw Object.assign(new Error(`Unknown adapter: ${adapterName}`), { status: 404 });
    return adapter.disconnect(db, userId);
  }

  async sync(db, userId, adapterName) {
    const adapter = this.get(adapterName);
    if (!adapter) throw Object.assign(new Error(`Unknown adapter: ${adapterName}`), { status: 404 });
    return adapter.sync(db, userId);
  }
}

// ─── Slash Command Parser ─────────────────────────────────────────────────────
const SLASH_COMMANDS = {
  '/calendar':  { adapter: 'google_calendar', action: 'query',   description: 'Query your calendar (e.g. /calendar today)' },
  '/gmail':     { adapter: 'gmail',           action: 'query',   description: 'Search your email (e.g. /gmail unread from:boss)' },
  '/notion':    { adapter: 'notion',          action: 'query',   description: 'Search Notion pages (e.g. /notion project roadmap)' },
  '/connect':   { adapter: null,              action: 'connect', description: 'Connect a service (e.g. /connect google_calendar)' },
  '/status':    { adapter: null,              action: 'status',  description: 'Show connector status' },
};

function parseSlashCommand(text) {
  const trimmed = text.trim();
  if (!trimmed.startsWith('/')) return null;

  const parts   = trimmed.split(/\s+/);
  const cmd     = parts[0].toLowerCase();
  const args    = parts.slice(1).join(' ');
  const mapping = SLASH_COMMANDS[cmd];

  if (!mapping) return null;

  return {
    command:  cmd,
    adapter:  mapping.adapter,
    action:   mapping.action,
    args,
  };
}

// ─── Connector State Persistence ──────────────────────────────────────────────

async function saveConnectorState(db, userId, adapterName, state, meta = {}) {
  await db.query(
    `INSERT INTO connector_state(id, user_id, adapter_name, state, meta)
     VALUES($1, $2, $3, $4, $5)
     ON CONFLICT(user_id, adapter_name) DO UPDATE SET state = $4, meta = $5, updated_at = now()`,
    [uuid(), userId, adapterName, state, JSON.stringify(meta)]
  );
}

async function getConnectorState(db, userId, adapterName) {
  const { rows } = await db.query(
    `SELECT state, meta, updated_at FROM connector_state
     WHERE user_id = $1 AND adapter_name = $2`,
    [userId, adapterName]
  ).catch(() => ({ rows: [] }));
  return rows[0] || { state: ConnectorState.DISCONNECTED, meta: {} };
}

// ─── Data Filter (only actionable items) ──────────────────────────────────────

function filterActionable(items) {
  return items.filter(item => {
    // Must have text content
    if (!item.text && !item.title && !item.summary) return false;
    // Must have some actionable signal
    if (item.type === 'event' && item.status === 'cancelled') return false;
    if (item.type === 'email' && item.isRead && !item.requiresAction) return false;
    return true;
  });
}

// ─── Singleton registry ───────────────────────────────────────────────────────
const registry = new ConnectorRegistry();

module.exports = {
  BaseAdapter,
  ConnectorRegistry,
  registry,
  parseSlashCommand,
  saveConnectorState,
  getConnectorState,
  filterActionable,
  ConnectorState,
  PermissionScope,
  SLASH_COMMANDS,
};
