/**
 * Shared constants and types for Flowra.
 * Used across server engines, client services, and shared logic.
 */

const SOURCES = {
  MANUAL: 'manual',
  CALENDAR: 'calendar',
  GMAIL: 'gmail',
  NOTION: 'notion',
};

const SENTIMENTS = {
  FOCUSED: 'focused',
  STRESSED: 'stressed',
  NEUTRAL: 'neutral',
  PRODUCTIVE: 'productive',
  OVERWHELMED: 'overwhelmed',
};

const ALLOWED_FILE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
];

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_TEXT_LENGTH = 10000;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

// ─── 5D Engine Constants (Phase 4-7) ──────────────────────────────────────────

// Propagation safety limits
const MAX_PROPAGATION_DEPTH = 10;
const MAX_PROPAGATION_NODES = 50;

// Anomaly detection thresholds (defaults, per-user calibration via Learning Engine)
const ANOMALY_THRESHOLDS = {
  SPIKE_THRESHOLD:       0.5,     // priority delta that qualifies as spike
  OSCILLATION_WINDOW:    5,       // recent changes to check for oscillation
  OSCILLATION_MIN_FLIPS: 3,       // min sign flips to flag
  THRASH_WINDOW_DAYS:    7,       // days to check for state thrashing
  THRASH_MIN_CYCLES:     3,       // min ACTIVE→DRIFT cycles to flag
  EMA_DAMPING_ALPHA:     0.3,     // stronger EMA on spike
  FREEZE_DURATION_MS:    3600000, // 1 hour freeze on oscillation
};

// Decision engine
const DECISION_TYPES = {
  DO_NOW: 'DO_NOW',
  DEFER:  'DEFER',
  IGNORE: 'IGNORE',
};

// Execution engine command types
const COMMAND_TYPES = {
  NOTIFY_USER:   'NOTIFY_USER',
  SCHEDULE_TASK: 'SCHEDULE_TASK',
  DEFER_TASK:    'DEFER_TASK',
  MARK_DONE:     'MARK_DONE',
  ESCALATE:      'ESCALATE',
  OPEN_CONTEXT:  'OPEN_CONTEXT',
};

// Item states (canonical, matches TSG)
const ITEM_STATES = {
  OPEN:        'OPEN',
  IN_PROGRESS: 'IN_PROGRESS',
  DONE:        'DONE',
  DROPPED:     'DROPPED',
};

// Connector states
const CONNECTOR_STATES = {
  DISCONNECTED: 'disconnected',
  CONNECTED:    'connected',
  SYNCING:      'syncing',
  ERROR:        'error',
  PAUSED:       'paused',
};

// Intelligence stages (progressive)
const INTELLIGENCE_STAGES = {
  SIMPLE:       'simple',
  PERSONALIZED: 'personalized',
  PREDICTIVE:   'predictive',
};

module.exports = {
  SOURCES,
  SENTIMENTS,
  ALLOWED_FILE_TYPES,
  MAX_FILE_SIZE,
  MAX_TEXT_LENGTH,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  // Phase 4-7
  MAX_PROPAGATION_DEPTH,
  MAX_PROPAGATION_NODES,
  ANOMALY_THRESHOLDS,
  DECISION_TYPES,
  COMMAND_TYPES,
  ITEM_STATES,
  CONNECTOR_STATES,
  INTELLIGENCE_STAGES,
};
