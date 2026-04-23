/**
 * ✦ BASE ENGINE
 *
 * Abstract base class for all Flowra engines.
 * Every engine must implement initialize() and provides
 * standard lifecycle methods.
 */
class BaseEngine {
  constructor(name) {
    this.name = name;
    this.initialized = false;
    this.startedAt = null;
    this.stats = {
      totalCalls: 0,
      totalErrors: 0,
      lastCallAt: null,
    };
  }

  /**
   * Initialize the engine. Called once at startup.
   * Subclasses override this to set up connections, load configs, etc.
   */
  async initialize() {
    this.initialized = true;
    this.startedAt = new Date();
  }

  /**
   * Ensure the engine is initialized before any operation.
   */
  ensureReady() {
    if (!this.initialized) {
      throw new Error(`${this.name} engine is not initialized. Call initialize() first.`);
    }
  }

  /**
   * Track a call for observability.
   */
  trackCall() {
    this.stats.totalCalls++;
    this.stats.lastCallAt = new Date();
  }

  /**
   * Track an error.
   */
  trackError() {
    this.stats.totalErrors++;
  }

  /**
   * Get engine health status.
   */
  getHealth() {
    return {
      name: this.name,
      initialized: this.initialized,
      startedAt: this.startedAt,
      uptime: this.startedAt ? Date.now() - this.startedAt.getTime() : 0,
      stats: { ...this.stats },
    };
  }
}

module.exports = BaseEngine;
