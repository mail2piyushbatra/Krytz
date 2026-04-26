-- ✦ FLOWRA — ROW LEVEL SECURITY POLICIES (Part 4 of 4)
-- Run LAST — after schema.additions, schema.entities, schema.intelligence.
-- Covers ALL user-scoped tables. Safe to re-run (IF NOT EXISTS policies).
--
-- How it works:
--   1. App sets:  SET LOCAL app.current_user_id = '<uuid>'
--      at the start of every request (rls.middleware.js)
--   2. Postgres enforces policies at storage layer — not the app
--   3. withAdminContext() sets current_user_id = '' to bypass for GDPR/admin ops

-- ─── Helper function ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION current_user_id() RETURNS UUID AS $$
  SELECT NULLIF(current_setting('app.current_user_id', true), '')::UUID;
$$ LANGUAGE sql STABLE;

-- ─── Core tables ─────────────────────────────────────────────────────────────
ALTER TABLE items ENABLE ROW LEVEL SECURITY;
ALTER TABLE items FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS items_isolation ON items;
CREATE POLICY items_isolation ON items
  USING (user_id = current_user_id());

-- item_events has no direct user_id — access via items join
ALTER TABLE item_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE item_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS item_events_isolation ON item_events;
CREATE POLICY item_events_isolation ON item_events
  USING (item_id IN (SELECT id FROM items WHERE user_id = current_user_id()));

ALTER TABLE item_edges ENABLE ROW LEVEL SECURITY;
ALTER TABLE item_edges FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS item_edges_isolation ON item_edges;
CREATE POLICY item_edges_isolation ON item_edges
  USING (user_id = current_user_id());

ALTER TABLE episodic_memory ENABLE ROW LEVEL SECURITY;
ALTER TABLE episodic_memory FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS episodic_memory_isolation ON episodic_memory;
CREATE POLICY episodic_memory_isolation ON episodic_memory
  USING (user_id = current_user_id());

ALTER TABLE semantic_memory ENABLE ROW LEVEL SECURITY;
ALTER TABLE semantic_memory FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS semantic_memory_isolation ON semantic_memory;
CREATE POLICY semantic_memory_isolation ON semantic_memory
  USING (user_id = current_user_id());

-- rules: user sees own + global system rules (user_id IS NULL)
ALTER TABLE rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE rules FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rules_isolation ON rules;
CREATE POLICY rules_isolation ON rules
  USING (user_id = current_user_id() OR user_id IS NULL);

-- action_runs isolated via rules join
ALTER TABLE action_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE action_runs FORCE ROW LEVEL SECURITY;
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

ALTER TABLE feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE feedback FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS feedback_isolation ON feedback;
CREATE POLICY feedback_isolation ON feedback
  USING (user_id = current_user_id());

-- metrics: user sees own + global (user_id IS NULL)
ALTER TABLE metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE metrics FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS metrics_isolation ON metrics;
CREATE POLICY metrics_isolation ON metrics
  USING (user_id = current_user_id() OR user_id IS NULL);

ALTER TABLE memory_summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_summaries FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS memory_summaries_isolation ON memory_summaries;
CREATE POLICY memory_summaries_isolation ON memory_summaries
  USING (user_id = current_user_id());

-- ─── V3 additions tables ─────────────────────────────────────────────────────
ALTER TABLE plan_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan_cache FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS plan_cache_isolation ON plan_cache;
CREATE POLICY plan_cache_isolation ON plan_cache
  USING (user_id = current_user_id());

ALTER TABLE cost_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE cost_usage FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cost_usage_isolation ON cost_usage;
CREATE POLICY cost_usage_isolation ON cost_usage
  USING (user_id = current_user_id());

ALTER TABLE snoozes ENABLE ROW LEVEL SECURITY;
ALTER TABLE snoozes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS snoozes_isolation ON snoozes;
CREATE POLICY snoozes_isolation ON snoozes
  USING (user_id = current_user_id());

ALTER TABLE capture_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE capture_queue FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS capture_queue_isolation ON capture_queue;
CREATE POLICY capture_queue_isolation ON capture_queue
  USING (user_id = current_user_id());

-- ─── V3 entity tables ────────────────────────────────────────────────────────
ALTER TABLE entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE entities FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS entities_isolation ON entities;
CREATE POLICY entities_isolation ON entities
  USING (user_id = current_user_id());

ALTER TABLE entity_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE entity_aliases FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS entity_aliases_isolation ON entity_aliases;
CREATE POLICY entity_aliases_isolation ON entity_aliases
  USING (user_id = current_user_id());

ALTER TABLE undo_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE undo_log FORCE ROW LEVEL SECURITY;
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

-- ─── V3 intelligence tables ──────────────────────────────────────────────────
ALTER TABLE contradictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE contradictions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS contradictions_isolation ON contradictions;
CREATE POLICY contradictions_isolation ON contradictions
  USING (user_id = current_user_id());

ALTER TABLE commitments ENABLE ROW LEVEL SECURITY;
ALTER TABLE commitments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS commitments_isolation ON commitments;
CREATE POLICY commitments_isolation ON commitments
  USING (user_id = current_user_id());

ALTER TABLE time_estimates ENABLE ROW LEVEL SECURITY;
ALTER TABLE time_estimates FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS time_estimates_isolation ON time_estimates;
CREATE POLICY time_estimates_isolation ON time_estimates
  USING (user_id = current_user_id());

-- events: user sees own + system events
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS events_isolation ON events;
CREATE POLICY events_isolation ON events
  USING (user_id = current_user_id() OR user_id IS NULL);

-- ─── App role grants ─────────────────────────────────────────────────────────
-- Run once as superuser to create the application role.
-- Production: connect as flowra_app, NOT as superuser (superuser bypasses RLS).
--
-- CREATE ROLE flowra_app LOGIN PASSWORD 'replace-with-strong-password';
-- GRANT CONNECT ON DATABASE flowra TO flowra_app;
-- GRANT USAGE ON SCHEMA public TO flowra_app;
-- GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO flowra_app;
-- GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO flowra_app;
-- ALTER DEFAULT PRIVILEGES IN SCHEMA public
--   GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO flowra_app;
