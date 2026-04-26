-- ✦ FLOWRA — ENTITY + UNDO SCHEMA (Part 2 of 4)
-- Run after schema.additions.sql.
-- Adds: entities, entity_aliases, undo_log, user_intelligence_stage, suggestion_events

-- Canonical entities (persons, projects, tools, locations)
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

-- Entity aliases (all surface forms resolved to canonical entity)
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

-- Undo log (pre-action snapshots for last 10 reversible actions)
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

-- Progressive intelligence stage
-- Day 1 → simple, Day 7 → personalized, Day 30 → predictive
CREATE TABLE IF NOT EXISTS user_intelligence_stage (
  user_id        UUID PRIMARY KEY,
  stage          TEXT NOT NULL DEFAULT 'simple'
                   CHECK (stage IN ('simple','personalized','predictive')),
  entries_count  INT NOT NULL DEFAULT 0,
  first_entry_at TIMESTAMPTZ,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Suggestion events for accept rate tracking
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
