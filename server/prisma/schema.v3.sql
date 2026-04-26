-- ✦ FLOWRA V3 — FULL MIGRATION
-- Run order: schema.additions → schema.entities → schema.intelligence → rls
-- Execute: psql $DATABASE_URL -f schema.v3.sql
-- Safe to re-run: all statements use IF NOT EXISTS / IF NOT EXISTS / OR REPLACE

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- PART 1: schema.additions.sql
-- User profile extensions, plan cache, cost tracking, snoozes, capture queue
-- ─────────────────────────────────────────────────────────────────────────────

-- 1a. Enable pgvector extension (must be first)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";

-- 1b. User profile additions
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS timezone       TEXT    NOT NULL DEFAULT 'UTC',
  ADD COLUMN IF NOT EXISTS daily_cost_usd REAL    NOT NULL DEFAULT 0.10,
  ADD COLUMN IF NOT EXISTS onboarded      BOOLEAN NOT NULL DEFAULT false;

-- 1c. Plan cache (Today screen results, short TTL, 5 min in code)
CREATE TABLE IF NOT EXISTS plan_cache (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID NOT NULL,
  date         DATE NOT NULL,
  timezone     TEXT NOT NULL,
  plan         JSONB NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, date, timezone)
);
CREATE INDEX IF NOT EXISTS idx_plan_cache_user ON plan_cache(user_id, date DESC);

-- 1d. Daily LLM cost tracker
CREATE TABLE IF NOT EXISTS cost_usage (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL,
  date        DATE NOT NULL DEFAULT CURRENT_DATE,
  usd_spent   REAL NOT NULL DEFAULT 0,
  token_count INT  NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, date)
);
CREATE INDEX IF NOT EXISTS idx_cost_usage_user ON cost_usage(user_id, date DESC);

-- 1e. Snoozes (action: snooze item until datetime)
CREATE TABLE IF NOT EXISTS snoozes (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID NOT NULL,
  item_id      UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  snooze_until TIMESTAMPTZ NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, item_id)
);
CREATE INDEX IF NOT EXISTS idx_snoozes_user ON snoozes(user_id, snooze_until);

-- 1f. Offline capture queue
CREATE TABLE IF NOT EXISTS capture_queue (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID NOT NULL,
  raw_input  TEXT NOT NULL,
  client_ts  TIMESTAMPTZ NOT NULL,
  status     TEXT NOT NULL DEFAULT 'PENDING'
               CHECK (status IN ('PENDING','PROCESSING','DONE','FAILED')),
  entry_id   UUID,
  error      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_capture_queue_user ON capture_queue(user_id, status, created_at DESC);


-- ─────────────────────────────────────────────────────────────────────────────
-- PART 2: schema.entities.sql
-- Entity resolution, alias table, undo log, progressive intelligence, suggestion events
-- ─────────────────────────────────────────────────────────────────────────────

-- 2a. Canonical entities (persons, projects, tools, locations)
CREATE TABLE IF NOT EXISTS entities (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id        UUID NOT NULL,
  canonical_name TEXT NOT NULL,
  type           TEXT NOT NULL DEFAULT 'person'
                   CHECK (type IN ('person','project','tool','location','other')),
  embedding      VECTOR(1536),
  frequency      INT NOT NULL DEFAULT 1,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_entities_user ON entities(user_id, type);
CREATE INDEX IF NOT EXISTS idx_entities_embedding ON entities
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 50);

-- 2b. Entity aliases (all observed surface forms → canonical entity)
CREATE TABLE IF NOT EXISTS entity_aliases (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  entity_id  UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL,
  alias      TEXT NOT NULL,
  frequency  INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(entity_id, user_id, alias)
);
CREATE INDEX IF NOT EXISTS idx_aliases_lookup ON entity_aliases(user_id, LOWER(alias));

-- 2c. Undo log (pre-action snapshots, last 10 per user)
CREATE TABLE IF NOT EXISTS undo_log (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL,
  action_type TEXT NOT NULL CHECK (action_type IN ('done','snooze','drop','edit')),
  item_id     UUID REFERENCES items(id) ON DELETE CASCADE,
  snapshot    JSONB NOT NULL,
  reversed    BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_undo_user ON undo_log(user_id, created_at DESC);

-- 2d. Progressive intelligence stage tracking
--     Day 1 → simple, Day 7 → personalized, Day 30 → predictive
CREATE TABLE IF NOT EXISTS user_intelligence_stage (
  user_id        UUID PRIMARY KEY,
  stage          TEXT NOT NULL DEFAULT 'simple'
                   CHECK (stage IN ('simple','personalized','predictive')),
  entries_count  INT NOT NULL DEFAULT 0,
  first_entry_at TIMESTAMPTZ,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2e. Suggestion events (shown / accepted / ignored / snoozed / dropped)
CREATE TABLE IF NOT EXISTS suggestion_events (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL,
  item_id         UUID REFERENCES items(id) ON DELETE SET NULL,
  event_type      TEXT NOT NULL
                    CHECK (event_type IN ('shown','accepted','ignored','snoozed','dropped')),
  plan_confidence REAL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_suggestions_user ON suggestion_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_suggestions_item ON suggestion_events(item_id);


-- ─────────────────────────────────────────────────────────────────────────────
-- PART 3: schema.intelligence.sql
-- Contradictions, commitments, time estimates, GDPR, Stripe tiers
-- ─────────────────────────────────────────────────────────────────────────────

-- 3a. Contradictions (deadline conflicts, schedule overloads, commitment conflicts)
CREATE TABLE IF NOT EXISTS contradictions (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL,
  type        TEXT NOT NULL
                CHECK (type IN ('DEADLINE_CONFLICT','SCHEDULE_OVERLOAD','COMMITMENT_CONFLICT')),
  severity    TEXT NOT NULL DEFAULT 'medium'
                CHECK (severity IN ('low','medium','high')),
  message     TEXT NOT NULL,
  detail      JSONB DEFAULT '{}',
  hash        TEXT NOT NULL,
  resolved    BOOLEAN NOT NULL DEFAULT false,
  resolved_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, hash)
);
CREATE INDEX IF NOT EXISTS idx_contradictions_user ON contradictions(user_id, resolved, created_at DESC);

-- 3b. Commitments (I promised X to Y by Z)
CREATE TABLE IF NOT EXISTS commitments (
  id                     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id                UUID NOT NULL,
  commitment_text        TEXT NOT NULL,
  counterparty_entity_id UUID REFERENCES entities(id) ON DELETE SET NULL,
  counterparty_name      TEXT,
  due_date               TIMESTAMPTZ,
  confidence             REAL NOT NULL DEFAULT 0.7,
  source_entry_id        UUID,
  status                 TEXT NOT NULL DEFAULT 'open'
                           CHECK (status IN ('open','fulfilled','overdue','dropped')),
  fulfilled_at           TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_commitments_user  ON commitments(user_id, status, due_date);
CREATE INDEX IF NOT EXISTS idx_commitments_party ON commitments(counterparty_entity_id);

-- 3c. Commitment dependencies (for contradiction detection)
CREATE TABLE IF NOT EXISTS commitment_dependencies (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  commitment_id  UUID NOT NULL REFERENCES commitments(id) ON DELETE CASCADE,
  depends_on_id  UUID NOT NULL REFERENCES commitments(id) ON DELETE CASCADE,
  UNIQUE(commitment_id, depends_on_id)
);

-- 3d. Time estimates (k-NN estimation + actual time recording + bias calibration)
CREATE TABLE IF NOT EXISTS time_estimates (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id        UUID NOT NULL,
  item_id        UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  estimated_mins INT,
  actual_mins    INT,
  basis          JSONB DEFAULT '{}',
  confidence     TEXT DEFAULT 'default',
  completed_at   TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, item_id)
);
CREATE INDEX IF NOT EXISTS idx_time_estimates_user ON time_estimates(user_id, completed_at DESC);

-- Add estimated_mins to items (for capacity model)
ALTER TABLE items ADD COLUMN IF NOT EXISTS estimated_mins INT;

-- 3e. GDPR deletion requests (24h grace period)
CREATE TABLE IF NOT EXISTS deletion_requests (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID UNIQUE NOT NULL,
  scheduled_at TIMESTAMPTZ NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','cancelled','completed')),
  cancelled_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3f. Billing / Stripe tier columns
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS subscription_tier  TEXT NOT NULL DEFAULT 'free'
    CHECK (subscription_tier IN ('free','pro','team')),
  ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT,
  ADD COLUMN IF NOT EXISTS trial_ends_at      TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS stripe_customers (
  customer_id TEXT PRIMARY KEY,
  user_id     UUID NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3g. Notifications (rule actions, contradiction alerts, commitment reminders)
CREATE TABLE IF NOT EXISTS notifications (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID NOT NULL,
  type       TEXT NOT NULL DEFAULT 'info' CHECK (type IN ('info','alert','reminder','system')),
  title      TEXT NOT NULL,
  body       TEXT,
  meta       JSONB DEFAULT '{}',
  read       BOOLEAN NOT NULL DEFAULT false,
  dismissed  BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read, created_at DESC);

-- 3h. Feedback table (thumbs up/down, ignore, dismiss)
CREATE TABLE IF NOT EXISTS feedback (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL,
  type        TEXT NOT NULL CHECK (type IN ('thumbs_up','thumbs_down','ignore','dismiss')),
  target_type TEXT NOT NULL,
  target_id   TEXT NOT NULL,
  payload     JSONB DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_feedback_user ON feedback(user_id, created_at DESC);


-- ─────────────────────────────────────────────────────────────────────────────
-- PART 4: rls.sql
-- Row Level Security — every user-scoped table locked to current_user_id()
-- ─────────────────────────────────────────────────────────────────────────────

-- 4a. Helper function: reads SET LOCAL app.current_user_id from transaction context
CREATE OR REPLACE FUNCTION current_user_id() RETURNS UUID AS $$
  SELECT NULLIF(current_setting('app.current_user_id', true), '')::UUID;
$$ LANGUAGE sql STABLE;

-- 4b. Core tables (should already exist from schema.sql)
ALTER TABLE items        ENABLE ROW LEVEL SECURITY;
ALTER TABLE items        FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS items_isolation ON items;
CREATE POLICY items_isolation ON items
  USING (user_id = current_user_id());

-- item_events: no direct user_id — join through items
ALTER TABLE item_events  ENABLE ROW LEVEL SECURITY;
ALTER TABLE item_events  FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS item_events_isolation ON item_events;
CREATE POLICY item_events_isolation ON item_events
  USING (item_id IN (SELECT id FROM items WHERE user_id = current_user_id()));

ALTER TABLE item_edges   ENABLE ROW LEVEL SECURITY;
ALTER TABLE item_edges   FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS item_edges_isolation ON item_edges;
CREATE POLICY item_edges_isolation ON item_edges
  USING (user_id = current_user_id());

ALTER TABLE episodic_memory   ENABLE ROW LEVEL SECURITY;
ALTER TABLE episodic_memory   FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS episodic_memory_isolation ON episodic_memory;
CREATE POLICY episodic_memory_isolation ON episodic_memory
  USING (user_id = current_user_id());

ALTER TABLE semantic_memory   ENABLE ROW LEVEL SECURITY;
ALTER TABLE semantic_memory   FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS semantic_memory_isolation ON semantic_memory;
CREATE POLICY semantic_memory_isolation ON semantic_memory
  USING (user_id = current_user_id());

-- rules: user sees own rules + global system rules (user_id IS NULL)
ALTER TABLE rules        ENABLE ROW LEVEL SECURITY;
ALTER TABLE rules        FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rules_isolation ON rules;
CREATE POLICY rules_isolation ON rules
  USING (user_id = current_user_id() OR user_id IS NULL);

-- action_runs: isolated via rules join
ALTER TABLE action_runs  ENABLE ROW LEVEL SECURITY;
ALTER TABLE action_runs  FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS action_runs_isolation ON action_runs;
CREATE POLICY action_runs_isolation ON action_runs
  USING (rule_id IN (
    SELECT id FROM rules WHERE user_id = current_user_id() OR user_id IS NULL
  ));

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS notifications_isolation ON notifications;
CREATE POLICY notifications_isolation ON notifications
  USING (user_id = current_user_id());

ALTER TABLE feedback      ENABLE ROW LEVEL SECURITY;
ALTER TABLE feedback      FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS feedback_isolation ON feedback;
CREATE POLICY feedback_isolation ON feedback
  USING (user_id = current_user_id());

-- metrics: user sees own + global (user_id IS NULL)
ALTER TABLE metrics       ENABLE ROW LEVEL SECURITY;
ALTER TABLE metrics       FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS metrics_isolation ON metrics;
CREATE POLICY metrics_isolation ON metrics
  USING (user_id = current_user_id() OR user_id IS NULL);

ALTER TABLE memory_summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_summaries FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS memory_summaries_isolation ON memory_summaries;
CREATE POLICY memory_summaries_isolation ON memory_summaries
  USING (user_id = current_user_id());

-- 4c. New V3 tables
ALTER TABLE plan_cache    ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan_cache    FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS plan_cache_isolation ON plan_cache;
CREATE POLICY plan_cache_isolation ON plan_cache
  USING (user_id = current_user_id());

ALTER TABLE cost_usage    ENABLE ROW LEVEL SECURITY;
ALTER TABLE cost_usage    FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cost_usage_isolation ON cost_usage;
CREATE POLICY cost_usage_isolation ON cost_usage
  USING (user_id = current_user_id());

ALTER TABLE snoozes       ENABLE ROW LEVEL SECURITY;
ALTER TABLE snoozes       FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS snoozes_isolation ON snoozes;
CREATE POLICY snoozes_isolation ON snoozes
  USING (user_id = current_user_id());

ALTER TABLE capture_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE capture_queue FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS capture_queue_isolation ON capture_queue;
CREATE POLICY capture_queue_isolation ON capture_queue
  USING (user_id = current_user_id());

ALTER TABLE entities      ENABLE ROW LEVEL SECURITY;
ALTER TABLE entities      FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS entities_isolation ON entities;
CREATE POLICY entities_isolation ON entities
  USING (user_id = current_user_id());

ALTER TABLE entity_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE entity_aliases FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS entity_aliases_isolation ON entity_aliases;
CREATE POLICY entity_aliases_isolation ON entity_aliases
  USING (user_id = current_user_id());

ALTER TABLE undo_log      ENABLE ROW LEVEL SECURITY;
ALTER TABLE undo_log      FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS undo_log_isolation ON undo_log;
CREATE POLICY undo_log_isolation ON undo_log
  USING (user_id = current_user_id());

ALTER TABLE user_intelligence_stage ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_intelligence_stage FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_intelligence_stage_isolation ON user_intelligence_stage;
CREATE POLICY user_intelligence_stage_isolation ON user_intelligence_stage
  USING (user_id = current_user_id());

ALTER TABLE suggestion_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE suggestion_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS suggestion_events_isolation ON suggestion_events;
CREATE POLICY suggestion_events_isolation ON suggestion_events
  USING (user_id = current_user_id());

ALTER TABLE contradictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE contradictions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS contradictions_isolation ON contradictions;
CREATE POLICY contradictions_isolation ON contradictions
  USING (user_id = current_user_id());

ALTER TABLE commitments   ENABLE ROW LEVEL SECURITY;
ALTER TABLE commitments   FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS commitments_isolation ON commitments;
CREATE POLICY commitments_isolation ON commitments
  USING (user_id = current_user_id());

ALTER TABLE time_estimates ENABLE ROW LEVEL SECURITY;
ALTER TABLE time_estimates FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS time_estimates_isolation ON time_estimates;
CREATE POLICY time_estimates_isolation ON time_estimates
  USING (user_id = current_user_id());

-- events: user sees own + system events (user_id IS NULL)
ALTER TABLE events        ENABLE ROW LEVEL SECURITY;
ALTER TABLE events        FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS events_isolation ON events;
CREATE POLICY events_isolation ON events
  USING (user_id = current_user_id() OR user_id IS NULL);


-- ─────────────────────────────────────────────────────────────────────────────
-- PART 5: App role grants
-- Connect as flowra_app role (not superuser) in production.
-- Uncomment and run once as superuser to create the role:
-- ─────────────────────────────────────────────────────────────────────────────
--
-- CREATE ROLE flowra_app LOGIN PASSWORD 'replace-with-strong-password';
-- GRANT CONNECT ON DATABASE flowra TO flowra_app;
-- GRANT USAGE ON SCHEMA public TO flowra_app;
-- GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO flowra_app;
-- GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO flowra_app;
-- ALTER DEFAULT PRIVILEGES IN SCHEMA public
--   GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO flowra_app;

COMMIT;
