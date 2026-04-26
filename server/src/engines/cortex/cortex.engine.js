/**
 * ✦ CORTEX ENGINE — v3
 *
 * Policy-driven control plane. Orchestrates the full pipeline via DAG.
 *
 * Upgrades from v2:
 *   - DAG execution replaces linear pipeline (parallel-safe, dep-aware)
 *   - Per-node retry with exponential backoff
 *   - Partial failure isolation: extraction fail ≠ ingestion fail
 *   - Backpressure: degrades gracefully under queue load
 *   - p50/p95 latency tracking via BaseEngine v2
 *   - Circuit breaker inherited from BaseEngine v2
 *   - Cost tracking aggregated across all engines
 */

'use strict';

const BaseEngine  = require('../base.engine');
const DAGExecutor = require('../dag.executor');
const logger      = require('../../lib/logger');

class IngestQueue {
  constructor({ onError, backpressureDepth = 100 } = {}) {
    this._queue           = [];
    this._running         = false;
    this._onError         = onError || (() => {});
    this._backpressure    = backpressureDepth;
    this.deadLetters      = [];
    this._processed       = 0;
  }

  enqueue(job) {
    if (this._queue.length >= this._backpressure) {
      logger.warn('Queue backpressure limit reached — dropping non-critical job', { jobId: job.meta?.entryId });
      this.deadLetters.push({ ...job.meta, reason: 'backpressure', ts: new Date().toISOString() });
      return false;
    }
    this._queue.push(job);
    if (!this._running) this._drain();
    return true;
  }

  async _drain() {
    this._running = true;
    while (this._queue.length > 0) {
      const job = this._queue.shift();
      try {
        await job.run();
        this._processed++;
      } catch (err) {
        const dead = { ...job.meta, error: err.message, failedAt: new Date().toISOString() };
        this.deadLetters.push(dead);
        this._onError(err, dead);
      }
    }
    this._running = false;
  }

  get depth()     { return this._queue.length; }
  get processed() { return this._processed; }
}

class CortexEngine extends BaseEngine {
  constructor() {
    super('cortex');

    this._repo          = null;
    this._normalization = null;
    this._extraction    = null;
    this._state         = null;
    this._recallEngine  = null;
    this._dag           = new DAGExecutor();

    this._queue = new IngestQueue({
      onError: (err, dead) => logger.error('Async ingestion dead-lettered', dead),
      backpressureDepth: parseInt(process.env.INGEST_QUEUE_DEPTH || '100', 10),
    });
  }

  async initialize() {
    await super.initialize();
    logger.info('Cortex engine ready');
  }

  setEngines({ normalization, extraction, state, recall }) {
    this._normalization = normalization;
    this._extraction    = extraction;
    this._state         = state;
    this._recallEngine  = recall;
  }

  setRepository(repo) { this._repo = repo; }

  // ─── INGEST (DAG) ─────────────────────────────────────────────────────────

  async ingest(entryId, rawText, options = {}) {
    this.ensureReady();
    this._assertRepo();
    const done = this.startCall();

    logger.info('Ingesting entry via DAG', { entryId });

    try {
      const ctx = {};

      const { trace, partialFailures } = await this._dag.execute([
        {
          id:    'normalize',
          deps:  [],
          retry: 2,
          run:   async () => {
            ctx.ir = await this._normalization.normalize({
              type:      options.fileType  || 'text',
              content:   rawText,
              source:    options.source    || 'manual',
              timestamp: options.timestamp || new Date(),
              fileKey:   options.fileKey   || null,
            });
          },
        },
        {
          id:    'extract',
          deps:  ['normalize'],
          retry: 3,
          backoff: 400,
          // critical: false → extraction failure won't kill store + state
          critical: false,
          run:   async () => {
            ctx.extracted = await this._extraction.extract(ctx.ir);
          },
        },
        {
          id:   'store',
          deps: ['normalize'],   // store IR even if extraction fails
          run:  async () => {
            const state = ctx.extracted || this._emptyExtraction();
            await this._repo.upsertExtractedState(entryId, state);
          },
        },
        {
          id:   'state',
          deps: ['store'],
          run:  async () => {
            const entry = await this._repo.findEntry(entryId);
            if (entry) {
              await this._state.recomputeDaily(entry.userId, entry.timestamp, this._repo);
            }
          },
        },
      ], ctx, { timeoutMs: 45_000 });

      done();

      if (partialFailures.length > 0) {
        logger.warn('Ingest completed with partial failures', { entryId, partialFailures });
      } else {
        logger.info('Entry ingested successfully', { entryId, trace: trace.map(t => `${t.id}:${t.status}`) });
      }

      return { extracted: ctx.extracted || null, partialFailures, trace };

    } catch (err) {
      done(err);
      logger.error('Ingest DAG failed', { entryId, error: err.message });
      throw err;
    }
  }

  ingestAsync(entryId, rawText, options = {}) {
    const queued = this._queue.enqueue({
      meta: { entryId, source: options.source || 'manual', enqueuedAt: new Date().toISOString() },
      run:  () => this.ingest(entryId, rawText, options),
    });

    if (queued) {
      logger.info('Entry queued for async ingest', { entryId, queueDepth: this._queue.depth });
    }
  }

  // ─── Recall ───────────────────────────────────────────────────────────────

  async recall(userId, query) {
    this.ensureReady();
    this.trackCall();
    return this._recallEngine.query(userId, query, this._repo);
  }

  // ─── State ────────────────────────────────────────────────────────────────

  async getTodayState(userId)   { this.ensureReady(); return this._state.getToday(userId, this._repo); }
  async getWeeklyState(userId)  { this.ensureReady(); return this._state.getWeek(userId, this._repo); }
  async getCarryOvers(userId)   { this.ensureReady(); return this._state.getCarryOvers(userId, this._repo); }

  // ─── Reprocess ────────────────────────────────────────────────────────────

  async reprocess(entryId) {
    this.ensureReady();
    this._assertRepo();
    const entry = await this._repo.findEntry(entryId);
    if (!entry) throw new Error(`Entry ${entryId} not found`);
    return this.ingest(entryId, entry.rawText, { source: entry.source });
  }

  // ─── Observability ────────────────────────────────────────────────────────

  getSystemHealth() {
    return {
      cortex:        this.getHealth(),
      normalization: this._normalization?.getHealth() || null,
      extraction:    this._extraction?.getHealth()    || null,
      state:         this._state?.getHealth()         || null,
      recall:        this._recallEngine?.getHealth()  || null,
      queue: {
        depth:       this._queue.depth,
        processed:   this._queue.processed,
        deadLetters: this._queue.deadLetters.length,
      },
    };
  }

  getDeadLetters() { return [...this._queue.deadLetters]; }
  clearDeadLetters() { this._queue.deadLetters = []; }

  // ─── Private ──────────────────────────────────────────────────────────────

  _assertRepo() {
    if (!this._repo) throw new Error('CortexEngine: no repository injected.');
  }

  _emptyExtraction() {
    return { actionItems: [], blockers: [], completions: [], deadlines: [], tags: [], sentiment: 'neutral' };
  }
}

module.exports = CortexEngine;
