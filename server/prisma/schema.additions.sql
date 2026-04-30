-- ✦ FLOWRA — SCHEMA ADDITIONS (Part 1 of 4)
-- Run after schema.sql (Prisma init migration).
-- Adds: user extensions, plan_cache, cost_usage, snoozes, capture_queue

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";

-- User profile additions
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS timezone       TEXT    NOT NULL DEFAULT 'UTC',
  ADD COLUMN IF NOT EXISTS daily_cost_usd REAL    NOT NULL DEFAULT 0.10,
  ADD COLUMN IF NOT EXISTS onboarded      BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reset_token    TEXT,
  ADD COLUMN IF NOT EXISTS reset_expires_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_users_reset_token ON users(reset_token) WHERE reset_token IS NOT NULL;

-- Plan cache
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

-- Daily LLM cost tracker
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

-- Snoozes
CREATE TABLE IF NOT EXISTS snoozes (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID NOT NULL,
  item_id      UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  snooze_until TIMESTAMPTZ NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, item_id)
);
CREATE INDEX IF NOT EXISTS idx_snoozes_user ON snoozes(user_id, snooze_until);

-- Offline capture queue
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

-- Notifications
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

-- Feedback
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
