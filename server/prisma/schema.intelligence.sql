-- ✦ FLOWRA — INTELLIGENCE TABLES (Part 3 of 4)
-- Run after schema.entities.sql.
-- Adds: contradictions, commitments, time_estimates, deletion_requests, Stripe columns

-- Contradictions (deadline conflicts, schedule overloads, commitment conflicts)
CREATE TABLE IF NOT EXISTS contradictions (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL,
  type        TEXT NOT NULL
                CHECK (type IN ('DEADLINE_CONFLICT','SCHEDULE_OVERLOAD','COMMITMENT_CONFLICT')),
  severity    TEXT NOT NULL DEFAULT 'medium'
                CHECK (severity IN ('low','medium','high')),
  message     TEXT NOT NULL,
  detail      JSONB DEFAULT '{}',
  hash        TEXT NOT NULL,        -- SHA-256 of (user_id + type + item_ids) for dedup
  resolved    BOOLEAN NOT NULL DEFAULT false,
  resolved_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, hash)
);
CREATE INDEX IF NOT EXISTS idx_contradictions_user ON contradictions(user_id, resolved, created_at DESC);

-- Commitments ("I'll send the report to Raj by Friday")
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

-- Commitment dependencies (for conflict graph)
CREATE TABLE IF NOT EXISTS commitment_dependencies (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  commitment_id  UUID NOT NULL REFERENCES commitments(id) ON DELETE CASCADE,
  depends_on_id  UUID NOT NULL REFERENCES commitments(id) ON DELETE CASCADE,
  UNIQUE(commitment_id, depends_on_id)
);

-- Time estimates (k-NN based estimation from past completions)
CREATE TABLE IF NOT EXISTS time_estimates (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id        UUID NOT NULL,
  item_id        UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  estimated_mins INT,
  actual_mins    INT,
  basis          JSONB DEFAULT '{}',    -- {method, neighbors, biasAdj}
  confidence     TEXT DEFAULT 'default',
  completed_at   TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, item_id)
);
CREATE INDEX IF NOT EXISTS idx_time_estimates_user ON time_estimates(user_id, completed_at DESC);

-- Add estimated_mins to items for capacity model
ALTER TABLE items ADD COLUMN IF NOT EXISTS estimated_mins INT;

-- GDPR deletion requests (24h grace period before hard delete)
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

-- Subscription tier columns
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS subscription_tier  TEXT NOT NULL DEFAULT 'free'
    CHECK (subscription_tier IN ('free','pro','team')),
  ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT,
  ADD COLUMN IF NOT EXISTS trial_ends_at      TIMESTAMPTZ;

-- Stripe customer ↔ user mapping
CREATE TABLE IF NOT EXISTS stripe_customers (
  customer_id TEXT PRIMARY KEY,
  user_id     UUID NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS for intelligence tables (also covered in rls.sql — safe to run twice)
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
