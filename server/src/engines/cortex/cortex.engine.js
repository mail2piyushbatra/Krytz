/**
 * ✦ CORTEX ENGINE
 *
 * Central orchestrator of Flowra's intelligence.
 * Coordinates: Normalization → Extraction → State pipeline.
 *
 * Cortex is the ONLY engine that calls other engines.
 * Individual engines never call each other directly.
 */

const BaseEngine = require('../base.engine');
const prisma = require('../../lib/prisma');

class CortexEngine extends BaseEngine {
  constructor() {
    super('cortex');
    this.normalization = null;
    this.extraction = null;
    this.state = null;
    this.recallEngine = null;
  }

  async initialize() {
    await super.initialize();
  }

  /**
   * Inject engine references. Called by registry after all engines init.
   */
  setEngines({ normalization, extraction, state, recall }) {
    this.normalization = normalization;
    this.extraction = extraction;
    this.state = state;
    this.recallEngine = recall;
  }

  /**
   * INGEST: Process a new entry through the full pipeline.
   * Normalize → Extract → Store → Recompute State
   */
  async ingest(entryId, rawText, options = {}) {
    this.ensureReady();
    this.trackCall();

    try {
      const ir = await this.normalization.normalize({
        type: options.fileType || 'text',
        content: rawText,
        source: options.source || 'manual',
        timestamp: new Date(),
        fileKey: options.fileKey || null,
      });

      const extracted = await this.extraction.extract(ir);

      await prisma.extractedState.upsert({
        where: { entryId },
        update: { ...extracted, processedAt: new Date() },
        create: { entryId, ...extracted },
      });

      const entry = await prisma.entry.findUnique({ where: { id: entryId } });
      if (entry) {
        await this.state.recomputeDaily(entry.userId, entry.timestamp);
      }

      console.log(`✦ Cortex ingested entry ${entryId}`);
      return extracted;
    } catch (err) {
      this.trackError();
      console.error(`✦ Cortex ingestion failed for ${entryId}:`, err.message);
      throw err;
    }
  }

  /**
   * INGEST ASYNC: Non-blocking version for API routes.
   */
  ingestAsync(entryId, rawText, options = {}) {
    setImmediate(() => {
      this.ingest(entryId, rawText, options).catch((err) => {
        console.error(`✦ Async ingestion failed for ${entryId}:`, err.message);
      });
    });
  }

  /**
   * RECALL: Query user's history in natural language.
   */
  async recall(userId, query) {
    this.ensureReady();
    this.trackCall();
    return this.recallEngine.query(userId, query);
  }

  /**
   * STATE: Get today's state.
   */
  async getTodayState(userId) {
    this.ensureReady();
    return this.state.getToday(userId);
  }

  /**
   * STATE: Get weekly breakdown.
   */
  async getWeeklyState(userId) {
    this.ensureReady();
    return this.state.getWeek(userId);
  }

  /**
   * STATE: Get carry-over items from previous days.
   */
  async getCarryOvers(userId) {
    this.ensureReady();
    return this.state.getCarryOvers(userId);
  }

  /**
   * RE-PROCESS: Re-extract state for an existing entry.
   */
  async reprocess(entryId) {
    this.ensureReady();
    this.trackCall();
    const entry = await prisma.entry.findUnique({ where: { id: entryId } });
    if (!entry) throw new Error(`Entry ${entryId} not found`);
    return this.ingest(entryId, entry.rawText, { source: entry.source });
  }

  /**
   * HEALTH: Get health status of all engines.
   */
  getSystemHealth() {
    return {
      cortex: this.getHealth(),
      normalization: this.normalization ? this.normalization.getHealth() : null,
      extraction: this.extraction ? this.extraction.getHealth() : null,
      state: this.state ? this.state.getHealth() : null,
      recall: this.recallEngine ? this.recallEngine.getHealth() : null,
    };
  }
}

module.exports = CortexEngine;
