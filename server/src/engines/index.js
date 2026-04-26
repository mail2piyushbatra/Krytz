/**
 * ✦ FLOWRA ENGINE REGISTRY — v3
 *
 * This file registers and exports all core engines.
 * Engines are the intelligence layer — they contain the actual product logic,
 * separated from the API/route layer (modules/).
 *
 * Architecture:
 *   Request → Module (route/validation) → Engine (logic) → Repository → Database
 *                                                       ↘ LLM (OpenAI)
 *
 * Core Engines:
 *   1. CortexEngine         — DAG-based orchestration & ingestion pipeline
 *   2. ExtractionEngine     — AI-powered state extraction from raw inputs
 *   3. RecallEngine         — Intent-aware retrieval with semantic ranking
 *   4. StateEngine          — State aggregation, daily/weekly snapshots
 *   5. NormalizationEngine  — Transform any input into Internal Representation (IR)
 *   6. ConnectorEngine      — External data source adapter framework
 *
 * Subsystems:
 *   7. TemporalStateGraph   — In-memory item lifecycle + confidence tracking
 *   8. DAGExecutor          — Parallel task graph execution
 *   9. QueryPlanner         — Intent classification + context packing
 *  10. EmbedPipeline        — Embedding cache + batch API calls
 *
 * Automation:
 *  11. RuleDSL              — Rule schema validation + NL compiler
 *  12. RuleEvaluator        — Deterministic condition interpreter
 *
 * Learning:
 *  13. PolicyOptimizer      — Contextual bandit for rule tuning
 */

const CortexEngine = require('./cortex/cortex.engine');
const ExtractionEngine = require('./extraction/extraction.engine');
const RecallEngine = require('./recall/recall.engine');
const StateEngine = require('./state/state.engine');
const NormalizationEngine = require('./normalization/normalization.engine');
const ConnectorEngine = require('./connector/connector.engine');
const repository = require('./repository');

// Subsystems (non-engine modules, available for direct use)
const { TemporalStateGraph } = require('./graph/temporal.state.graph');
const { embedStats } = require('./memory/embed');
const { validateRule, lintRule, compileRule } = require('./automation/rule.dsl');
const { evalCond, evaluateRulesForTSGItem } = require('./automation/rule.evaluator');
const { scoreExtraction, scoreRecall, chooseExtractionPath } = require('./eval/policy.optimizer');

const logger = require('../lib/logger');

// ── Singleton instances ─────────────────────────────────────────────────────

const engines = {
  cortex:        new CortexEngine(),
  extraction:    new ExtractionEngine(),
  recall:        new RecallEngine(),
  state:         new StateEngine(),
  normalization: new NormalizationEngine(),
  connector:     new ConnectorEngine(),
};

// ── TSG instance (shared across engines) ────────────────────────────────────
const tsg = new TemporalStateGraph();

/**
 * Initialize all engines. Call once at server startup.
 */
async function initializeEngines() {
  logger.info('Initializing Flowra engine fleet (v3)...');

  for (const [name, engine] of Object.entries(engines)) {
    try {
      await engine.initialize();
      logger.info(`${name} engine: ready`);
    } catch (err) {
      logger.error(`${name} engine: FAILED`, { error: err.message });
      throw err; // Fail fast — all engines must initialize
    }
  }

  // Wire Cortex with references to other engines
  engines.cortex.setEngines({
    normalization: engines.normalization,
    extraction:    engines.extraction,
    state:         engines.state,
    recall:        engines.recall,
  });

  // Inject repository into Cortex
  engines.cortex.setRepository(repository);

  logger.info('Engine fleet initialized. Cortex wired. Repository injected.');
}

/**
 * Get system-wide health — all engines + subsystems.
 */
function getSystemHealth() {
  return {
    engines: engines.cortex.getSystemHealth(),
    tsg: {
      totalItems: tsg.getAllItems().length,
      snapshot:   tsg.getProjectSnapshot(),
    },
    embedding: embedStats(),
  };
}

module.exports = {
  engines,
  initializeEngines,
  getSystemHealth,
  repository,
  tsg,
  // Subsystem utilities
  automation: { validateRule, lintRule, compileRule, evalCond, evaluateRulesForTSGItem },
  eval:       { scoreExtraction, scoreRecall, chooseExtractionPath },
};
