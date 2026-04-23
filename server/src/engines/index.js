/**
 * ✦ FLOWRA ENGINE REGISTRY
 *
 * This file registers and exports all core engines.
 * Engines are the intelligence layer — they contain the actual product logic,
 * separated from the API/route layer (modules/).
 *
 * Architecture:
 *   Request → Module (route/validation) → Engine (logic) → Database/LLM
 *
 * Engines:
 *   1. CortexEngine     — Central state reconstruction & orchestration
 *   2. ExtractionEngine  — AI-powered state extraction from raw inputs
 *   3. RecallEngine      — Natural language query over user history
 *   4. StateEngine       — State aggregation, inference, pattern detection
 *   5. NormalizationEngine — Transform any input into Internal Representation (IR)
 *   6. ConnectorEngine   — External data source adapter framework
 */

const CortexEngine = require('./cortex/cortex.engine');
const ExtractionEngine = require('./extraction/extraction.engine');
const RecallEngine = require('./recall/recall.engine');
const StateEngine = require('./state/state.engine');
const NormalizationEngine = require('./normalization/normalization.engine');
const ConnectorEngine = require('./connector/connector.engine');

// Singleton instances
const engines = {
  cortex: new CortexEngine(),
  extraction: new ExtractionEngine(),
  recall: new RecallEngine(),
  state: new StateEngine(),
  normalization: new NormalizationEngine(),
  connector: new ConnectorEngine(),
};

/**
 * Initialize all engines. Call once at server startup.
 */
async function initializeEngines() {
  console.log('\n✦ Initializing Flowra engines...');

  for (const [name, engine] of Object.entries(engines)) {
    try {
      await engine.initialize();
      console.log(`  ✦ ${name} engine: ready`);
    } catch (err) {
      console.error(`  ✦ ${name} engine: FAILED — ${err.message}`);
      throw err; // Fail fast — all engines must initialize
    }
  }

  console.log('✦ All engines initialized.');

  // Wire Cortex with references to other engines
  engines.cortex.setEngines({
    normalization: engines.normalization,
    extraction: engines.extraction,
    state: engines.state,
    recall: engines.recall,
  });

  console.log('✦ Cortex wired to all engines.\n');
}

module.exports = { engines, initializeEngines };
