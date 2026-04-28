/**
 * ✦ FLOWRA ENGINE REGISTRY — v4
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
 *
 * Subsystems:
 *   6. TemporalStateGraph   — DB-backed item lifecycle + confidence tracking
 *   7. DAGExecutor          — Parallel task graph execution
 *   8. QueryPlanner         — Intent classification + context packing
 *   9. EmbedPipeline        — Embedding cache + batch API calls
 *
 * Automation:
 *  10. RuleDSL              — Rule schema validation + NL compiler
 *  11. RuleEvaluator        — Deterministic condition interpreter
 *
 * Learning:
 *  12. PolicyOptimizer      — Contextual bandit for rule tuning
 *
 * Phase 4-7 Engines:
 *  13. DecisionEngine       — DO_NOW / DEFER / IGNORE classification + trace
 *  14. CausalityGraph       — Item dependency DAG, transitive closure, bottlenecks
 *  15. RipplePropagation    — Cascade state changes through dependency graph
 *  16. ExecutionEngine      — Command → Side Effect → Event closed loop
 *  17. ObservabilityEngine  — Trace storage, replay, anomaly detection + mitigation
 *  18. LearningEngine       — Adaptive weight calibration + behavior pattern detection
 *  19. ConnectorFramework   — External data source adapter registry (Phase 3)
 */

const CortexEngine = require('./cortex/cortex.engine');
const ExtractionEngine = require('./extraction/extraction.engine');
const RecallEngine = require('./recall/recall.engine');
const StateEngine = require('./state/state.engine');
const NormalizationEngine = require('./normalization/normalization.engine');
const repository = require('./repository');

// Subsystems (non-engine modules, available for direct use)
const { TemporalStateGraph } = require('./graph/temporal.state.graph');
const { embedStats } = require('./memory/embed');
const { validateRule, lintRule, compileRule } = require('./automation/rule.dsl');
const { evalCond, evaluateRulesForTSGItem } = require('./automation/rule.evaluator');
const { scoreExtraction, scoreRecall, chooseExtractionPath } = require('./eval/policy.optimizer');

// Phase 4-7 Engines
const decision      = require('./decision/decision.engine');
const causality     = require('./causality/causality.graph');
const propagation   = require('./propagation/ripple.engine');
const execution     = require('./execution/execution.engine');
const observability = require('./observability/observability.engine');
const learning      = require('./learning/learning.engine');
const connector     = require('./connector/connector.framework');
const googleCalendarAdapter = require('./connector/google_calendar.adapter');
const gmailAdapter = require('./connector/gmail.adapter');
const notionAdapter = require('./connector/notion.adapter');

// Intelligence subsystems (already existed, now formally registered)
const planEngine          = require('./intelligence/plan.engine');
const whatifSimulator     = require('./intelligence/whatif.simulator');
const capacityModel       = require('./intelligence/capacity.model');
const contradictionDetector = require('./intelligence/contradiction.detector');
const commitmentTracker   = require('./intelligence/commitment.tracker');
const timeEstimation      = require('./intelligence/time.estimation');
const progressiveIntel    = require('./intelligence/progressive.intelligence');
const entityResolver      = require('./intelligence/entity.resolver');
const temporalResolver    = require('./intelligence/temporal.resolver');
const weeklyPlanner       = require('./intelligence/weekly.planner');
const itemMatcher         = require('./intelligence/item.matcher');

const logger = require('../lib/logger');
const db     = require('../lib/db');

// ── Singleton instances ─────────────────────────────────────────────────────

const engines = {
  cortex:        new CortexEngine(),
  extraction:    new ExtractionEngine(),
  recall:        new RecallEngine(),
  state:         new StateEngine(),
  normalization: new NormalizationEngine(),
};

// ── TSG instance (shared across engines) ────────────────────────────────────
const tsg = new TemporalStateGraph();
tsg.setDB(db);  // Wire persistence — TSG writes through to items + item_events tables

/**
 * Initialize all engines. Call once at server startup.
 */
async function initializeEngines() {
  logger.info('Initializing Flowra engine fleet (v4)...');

  for (const [name, engine] of Object.entries(engines)) {
    try {
      await engine.initialize();
      logger.info(`${name} engine: ready`);
    } catch (err) {
      logger.error(`${name} engine: FAILED`, { error: err.message });
      throw err; // Fail fast — all engines must initialize
    }
  }

  // Register Connector Adapters
  connector.registry.register(googleCalendarAdapter);
  connector.registry.register(gmailAdapter);
  connector.registry.register(notionAdapter);

  // Wire Cortex with references to other engines
  engines.cortex.setEngines({
    normalization: engines.normalization,
    extraction:    engines.extraction,
    state:         engines.state,
    recall:        engines.recall,
  });

  // Inject repository into Cortex
  engines.cortex.setRepository(repository);

  // Hydrate TSG from database (load OPEN/IN_PROGRESS items into memory)
  await tsg.loadAllFromDB();

  logger.info('Engine fleet initialized (v4). Cortex wired. TSG hydrated. Phase 4-7 engines registered.');
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
    phase4to7: {
      decision:      'ready',
      causality:     'ready',
      propagation:   'ready',
      execution:     'ready',
      observability: 'ready',
      learning:      'ready',
      connector:     `${connector.registry.list().length} adapters registered`,
    },
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
  // Phase 4-7 engines
  decision,
  causality,
  propagation,
  execution,
  observability,
  learning,
  connector,
  // Intelligence subsystems
  intelligence: {
    plan:           planEngine,
    whatif:         whatifSimulator,
    capacity:       capacityModel,
    contradictions: contradictionDetector,
    commitments:    commitmentTracker,
    timeEstimation,
    progressive:    progressiveIntel,
    entities:       entityResolver,
    temporal:       temporalResolver,
    weeklyPlanner,
    itemMatcher,
  },
};

