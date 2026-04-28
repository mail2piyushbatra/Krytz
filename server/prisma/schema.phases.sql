-- ✦ FLOWRA — Phase 2-7 Schema Extension
-- Adds tables for Decision Engine, Observability, Learning, Connectors, and Execution.
-- Run AFTER schema.v3.sql

-- ─── Decision Traces ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS decision_traces (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_id      TEXT NOT NULL,
  decision     TEXT NOT NULL CHECK (decision IN ('DO_NOW', 'DEFER', 'IGNORE')),
  score        REAL,
  signals      JSONB DEFAULT '{}',
  reason       TEXT,
  created_at   TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_decision_traces_user     ON decision_traces(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_decision_traces_item     ON decision_traces(user_id, item_id, created_at DESC);

-- ─── Traces (Observability) ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS traces (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_id      TEXT NOT NULL,
  state        TEXT,
  priority     REAL,
  decision     TEXT,
  signals      JSONB DEFAULT '{}',
  boosts       JSONB DEFAULT '{}',
  reason       TEXT,
  created_at   TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_traces_user_item ON traces(user_id, item_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_traces_user_time ON traces(user_id, created_at DESC);

-- ─── Anomaly Events ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS anomaly_events (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_id      TEXT,
  type         TEXT NOT NULL CHECK (type IN ('PRIORITY_SPIKE', 'PRIORITY_OSCILLATION', 'STATE_THRASH')),
  severity     TEXT DEFAULT 'medium',
  detail       JSONB DEFAULT '{}',
  mitigation   TEXT,
  mitigated_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_anomaly_events_user ON anomaly_events(user_id, created_at DESC);

-- ─── Command Log (Execution Engine) ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS command_log (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  command_type TEXT NOT NULL,
  payload      JSONB DEFAULT '{}',
  status       TEXT DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED')),
  attempts     INT DEFAULT 0,
  error        TEXT,
  created_at   TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_command_log_user ON command_log(user_id, created_at DESC);

-- ─── User Learning Model ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_learning_model (
  user_id      UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  model        JSONB DEFAULT '{}',
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now()
);

-- ─── User Intelligence Stage (if not exists from progressive.intelligence) ──
CREATE TABLE IF NOT EXISTS user_intelligence_stage (
  user_id       UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  stage         TEXT DEFAULT 'simple',
  entries_count INT DEFAULT 0,
  first_entry_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

-- ─── Connector State ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS connector_state (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  adapter_name TEXT NOT NULL,
  state        TEXT DEFAULT 'disconnected',
  meta         JSONB DEFAULT '{}',
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, adapter_name)
);
CREATE INDEX IF NOT EXISTS idx_connector_state_user ON connector_state(user_id);

-- ─── Commitment Dependencies (for contradiction detector) ──────────────────
CREATE TABLE IF NOT EXISTS commitment_dependencies (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  commitment_id  UUID NOT NULL REFERENCES commitments(id) ON DELETE CASCADE,
  depends_on_id  UUID NOT NULL REFERENCES commitments(id) ON DELETE CASCADE,
  created_at     TIMESTAMPTZ DEFAULT now(),
  UNIQUE(commitment_id, depends_on_id)
);

-- ─── RLS for new tables ──────────────────────────────────────────────────────
ALTER TABLE decision_traces       ENABLE ROW LEVEL SECURITY;
ALTER TABLE traces                ENABLE ROW LEVEL SECURITY;
ALTER TABLE anomaly_events        ENABLE ROW LEVEL SECURITY;
ALTER TABLE command_log           ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_learning_model   ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_intelligence_stage ENABLE ROW LEVEL SECURITY;
ALTER TABLE connector_state       ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS decision_traces_user ON decision_traces;
CREATE POLICY decision_traces_user      ON decision_traces      FOR ALL USING (user_id = current_user_id());
DROP POLICY IF EXISTS traces_user ON traces;
CREATE POLICY traces_user               ON traces               FOR ALL USING (user_id = current_user_id());
DROP POLICY IF EXISTS anomaly_events_user ON anomaly_events;
CREATE POLICY anomaly_events_user       ON anomaly_events       FOR ALL USING (user_id = current_user_id());
DROP POLICY IF EXISTS command_log_user ON command_log;
CREATE POLICY command_log_user          ON command_log          FOR ALL USING (user_id = current_user_id());
DROP POLICY IF EXISTS user_learning_model_user ON user_learning_model;
CREATE POLICY user_learning_model_user  ON user_learning_model  FOR ALL USING (user_id = current_user_id());
DROP POLICY IF EXISTS user_intelligence_stage_user ON user_intelligence_stage;
CREATE POLICY user_intelligence_stage_user ON user_intelligence_stage FOR ALL USING (user_id = current_user_id());
DROP POLICY IF EXISTS connector_state_user ON connector_state;
CREATE POLICY connector_state_user      ON connector_state      FOR ALL USING (user_id = current_user_id());
