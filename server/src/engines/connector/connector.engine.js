/**
 * ✦ CONNECTOR ENGINE
 *
 * Framework for external data source adapters.
 * Manages connector lifecycle: register → auth → fetch → normalize → ingest.
 *
 * Each connector implements the BaseConnector interface:
 *   - auth(): Handle OAuth/API key setup
 *   - fetch(query): Pull data from external source
 *   - normalize(data): Convert to Flowra IR format
 *   - disconnect(): Revoke access, clean up
 */

const BaseEngine = require('../base.engine');

/**
 * Base class for all connectors.
 * Every connector (Calendar, Gmail, Notion, etc.) extends this.
 */
class BaseConnector {
  constructor(name, config = {}) {
    this.name = name;
    this.config = config;
    this.connected = false;
    this.lastSyncAt = null;
    this.permissions = {
      read: true,
      write: false,
      scope: [],
    };
  }

  async auth(credentials) {
    throw new Error(`${this.name}: auth() not implemented`);
  }

  async fetch(query) {
    throw new Error(`${this.name}: fetch() not implemented`);
  }

  async normalize(data) {
    throw new Error(`${this.name}: normalize() not implemented`);
  }

  async disconnect() {
    this.connected = false;
    this.lastSyncAt = null;
  }

  getStatus() {
    return {
      name: this.name,
      connected: this.connected,
      lastSyncAt: this.lastSyncAt,
      permissions: { ...this.permissions },
    };
  }
}

/**
 * Connector Engine — manages all registered connectors.
 */
class ConnectorEngine extends BaseEngine {
  constructor() {
    super('connector');
    this.connectors = new Map();
    this.userConnections = new Map(); // userId -> Map<connectorName, connectionState>
  }

  async initialize() {
    // Register available connector types (adapters are registered but not connected)
    // Actual connector implementations will be added in Phase 3
    // The framework is ready — just needs concrete adapters

    await super.initialize();
  }

  /**
   * Register a connector adapter type.
   * This makes the connector available for users to connect.
   */
  registerConnector(name, ConnectorClass) {
    this.connectors.set(name, ConnectorClass);
    console.log(`  ✦ Registered connector: ${name}`);
  }

  /**
   * Get list of available connector types.
   */
  getAvailable() {
    this.ensureReady();

    return Array.from(this.connectors.entries()).map(([name, ConnectorClass]) => ({
      name,
      description: ConnectorClass.description || `Connect to ${name}`,
      requiredScopes: ConnectorClass.requiredScopes || [],
    }));
  }

  /**
   * Connect a user to an external source.
   * Creates a connector instance for this user.
   *
   * @param {string} userId - User ID
   * @param {string} connectorName - Name of connector to connect
   * @param {Object} credentials - OAuth tokens or API keys
   * @returns {Object} Connection status
   */
  async connect(userId, connectorName, credentials) {
    this.ensureReady();
    this.trackCall();

    const ConnectorClass = this.connectors.get(connectorName);
    if (!ConnectorClass) {
      throw new Error(`Unknown connector: ${connectorName}`);
    }

    // Create connector instance for this user
    const connector = new ConnectorClass();
    await connector.auth(credentials);

    // Store connection state
    if (!this.userConnections.has(userId)) {
      this.userConnections.set(userId, new Map());
    }
    this.userConnections.get(userId).set(connectorName, connector);

    return connector.getStatus();
  }

  /**
   * Disconnect a user from an external source.
   */
  async disconnect(userId, connectorName) {
    this.ensureReady();
    this.trackCall();

    const userConns = this.userConnections.get(userId);
    if (!userConns || !userConns.has(connectorName)) {
      throw new Error(`Not connected to ${connectorName}`);
    }

    const connector = userConns.get(connectorName);
    await connector.disconnect();
    userConns.delete(connectorName);

    return { disconnected: true, connector: connectorName };
  }

  /**
   * Fetch data from a connected source and return normalized IR objects.
   *
   * @param {string} userId - User ID
   * @param {string} connectorName - Connector to fetch from
   * @param {Object} query - Query params (e.g., { date: 'today' })
   * @returns {Array} Array of IR objects ready for Cortex ingestion
   */
  async fetch(userId, connectorName, query) {
    this.ensureReady();
    this.trackCall();

    const connector = this._getUserConnector(userId, connectorName);

    // Fetch raw data from external source
    const rawData = await connector.fetch(query);

    // Normalize into IR format
    const irObjects = await connector.normalize(rawData);

    connector.lastSyncAt = new Date();

    return irObjects;
  }

  /**
   * Get connection status for a user.
   */
  getConnectionStatus(userId, connectorName) {
    this.ensureReady();

    const connector = this._getUserConnector(userId, connectorName);
    return connector.getStatus();
  }

  /**
   * Get all connections for a user.
   */
  getAllConnections(userId) {
    this.ensureReady();

    const userConns = this.userConnections.get(userId);
    if (!userConns) return [];

    return Array.from(userConns.entries()).map(([name, connector]) => ({
      name,
      ...connector.getStatus(),
    }));
  }

  /**
   * Get a user's connector instance (throws if not connected).
   */
  _getUserConnector(userId, connectorName) {
    const userConns = this.userConnections.get(userId);
    if (!userConns || !userConns.has(connectorName)) {
      throw new Error(`Not connected to ${connectorName}. Connect first.`);
    }
    return userConns.get(connectorName);
  }
}

module.exports = ConnectorEngine;
module.exports.BaseConnector = BaseConnector;
