-- ✦ FLOWRA V3 — FOUNDATION TABLES
-- Creates the snake_case tables expected by the V3 engine code.
-- These coexist with the Prisma PascalCase tables (User, Entry, etc.)
-- Run BEFORE schema.v3.sql
-- Safe to re-run: all CREATE TABLE IF NOT EXISTS

BEGIN;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";

-- ─── users (snake_case mirror — V3 engines reference this) ───────────────────
CREATE TABLE IF NOT EXISTS users (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email            TEXT UNIQUE,
  name             TEXT,
  password_hash    TEXT,
  timezone         TEXT NOT NULL DEFAULT 'UTC',
  daily_cost_usd   REAL NOT NULL DEFAULT 0.10,
  subscription_tier TEXT NOT NULL DEFAULT 'free',
  stripe_customer_id TEXT,
  trial_ends_at    TIMESTAMPTZ,
  onboarded        BOOLEAN NOT NULL DEFAULT false,
  settings         JSONB DEFAULT '{}',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── entries ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS entries (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID NOT NULL,
  raw_text   TEXT NOT NULL,
  source     TEXT NOT NULL DEFAULT 'manual',
  has_files  BOOLEAN NOT NULL DEFAULT false,
  timestamp  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_entries_user_ts ON entries(user_id, timestamp DESC);

-- ─── items (the core TSG node) ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS items (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL,
  canonical_text  TEXT NOT NULL,
  state           TEXT NOT NULL DEFAULT 'OPEN'
                    CHECK (state IN ('OPEN','IN_PROGRESS','DONE','DROPPED')),
  priority        REAL NOT NULL DEFAULT 0.5,
  confidence      REAL NOT NULL DEFAULT 0.5,
  blocker         BOOLEAN NOT NULL DEFAULT false,
  deadline        TIMESTAMPTZ,
  estimated_mins  INT,
  mention_count   INT NOT NULL DEFAULT 1,
  first_seen      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen       TIMESTAMPTZ NOT NULL DEFAULT now(),
  embedding       VECTOR(1536),
  source_entry_id UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_items_user_state ON items(user_id, state);
CREATE INDEX IF NOT EXISTS idx_items_user_priority ON items(user_id, priority DESC);
CREATE INDEX IF NOT EXISTS idx_items_embedding ON items
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 50);

-- ─── item_events (state transitions) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS item_events (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  item_id    UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  from_state TEXT,
  to_state   TEXT NOT NULL,
  confidence REAL,
  reason     TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_item_events_item ON item_events(item_id, created_at DESC);

-- ─── item_edges (dependency graph) ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS item_edges (
  id        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id   UUID NOT NULL,
  from_item UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  to_item   UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  edge_type TEXT NOT NULL DEFAULT 'blocks'
              CHECK (edge_type IN ('blocks','depends_on','relates_to')),
  weight    REAL NOT NULL DEFAULT 1.0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(from_item, to_item, edge_type)
);
CREATE INDEX IF NOT EXISTS idx_item_edges_from ON item_edges(from_item);
CREATE INDEX IF NOT EXISTS idx_item_edges_to ON item_edges(to_item);

-- ─── rules (automation) ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rules (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id          UUID,                -- NULL = system/global rule
  name             TEXT NOT NULL,
  condition        JSONB NOT NULL,
  action           JSONB NOT NULL,
  params           JSONB DEFAULT '{}',
  cooldown_seconds INT NOT NULL DEFAULT 0,
  priority         INT NOT NULL DEFAULT 0,
  mode             TEXT NOT NULL DEFAULT 'live'
                     CHECK (mode IN ('live','shadow')),
  enabled          BOOLEAN NOT NULL DEFAULT true,
  source           TEXT NOT NULL DEFAULT 'user',
  nl_input         TEXT,
  lint_warnings    JSONB DEFAULT '[]',
  last_fired_at    TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rules_user ON rules(user_id, enabled);

-- ─── action_runs (rule execution log) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS action_runs (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  rule_id    UUID NOT NULL REFERENCES rules(id) ON DELETE CASCADE,
  item_id    UUID REFERENCES items(id) ON DELETE SET NULL,
  result     JSONB DEFAULT '{}',
  dedupe_key TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_action_runs_rule ON action_runs(rule_id, created_at DESC);

-- ─── episodic_memory ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS episodic_memory (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID NOT NULL,
  entry_id   UUID,
  content    TEXT NOT NULL,
  embedding  VECTOR(1536),
  ts         TIMESTAMPTZ NOT NULL DEFAULT now(),
  indexed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_episodic_user ON episodic_memory(user_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_episodic_embedding ON episodic_memory
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 50);

-- ─── semantic_memory ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS semantic_memory (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID NOT NULL,
  key        TEXT NOT NULL,
  value      TEXT NOT NULL,
  embedding  VECTOR(1536),
  confidence REAL NOT NULL DEFAULT 0.5,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, key)
);
CREATE INDEX IF NOT EXISTS idx_semantic_user ON semantic_memory(user_id);
CREATE INDEX IF NOT EXISTS idx_semantic_embedding ON semantic_memory
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 50);

-- ─── memory_summaries ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS memory_summaries (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID NOT NULL,
  summary    TEXT NOT NULL,
  period     TEXT,
  episode_ids UUID[] DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_memory_summaries_user ON memory_summaries(user_id, created_at DESC);

-- ─── metrics ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS metrics (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID,               -- NULL = system metric
  name       TEXT NOT NULL,
  value      REAL NOT NULL DEFAULT 0,
  labels     JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_metrics_user ON metrics(user_id, name, created_at DESC);

-- ─── events (audit log) ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS events (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID,               -- NULL = system event
  type       TEXT NOT NULL,
  payload    JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(type, created_at DESC);

COMMIT;
