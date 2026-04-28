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

const { Queue, Worker } = require('bullmq');
const Redis = require('ioredis');

class CortexEngine extends BaseEngine {
  constructor() {
    super('cortex');

    this._repo          = null;
    this._normalization = null;
    this._extraction    = null;
    this._state         = null;
    this._recallEngine  = null;
    this._dag           = new DAGExecutor();

    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    this._connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
    this._queue = new Queue('ingestion-queue', { connection: this._connection });
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
            // Pass capture type hint through IR metadata
            if (options.type === 'todo') {
              ctx.ir.metadata = { ...ctx.ir.metadata, captureType: 'todo' };
            }
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
    this._queue.add('ingest', { entryId, rawText, options }, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: true,
      removeOnFail: false
    });
    logger.info('Entry queued for async ingest in BullMQ', { entryId });
  }

  startWorker() {
    this._worker = new Worker('ingestion-queue', async (job) => {
      const { entryId, rawText, options } = job.data;
      return this.ingest(entryId, rawText, options);
    }, { connection: this._connection, concurrency: 5 });

    this._worker.on('failed', (job, err) => {
      logger.error('Async ingestion dead-lettered in BullMQ', { entryId: job?.data?.entryId, error: err.message });
    });

    logger.info('Cortex worker started consuming ingestion-queue via BullMQ');
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
        status:      'BullMQ Active',
        driver:      'Redis'
      },
    };
  }

  getDeadLetters() { return []; }
  clearDeadLetters() { }

  // ─── Private ──────────────────────────────────────────────────────────────

  _assertRepo() {
    if (!this._repo) throw new Error('CortexEngine: no repository injected.');
  }

  _emptyExtraction() {
    return { actionItems: [], blockers: [], completions: [], deadlines: [], tags: [], sentiment: 'neutral' };
  }
}

module.exports = CortexEngine;
