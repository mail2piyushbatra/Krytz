-- ✦ Krytz — Missing Tables Migration
-- Run after schema.foundation.sql to add tables referenced by the entry service
-- Safe to re-run: all CREATE TABLE IF NOT EXISTS

-- Extracted states (AI extraction output per entry)
CREATE TABLE IF NOT EXISTS extracted_states (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  entry_id     UUID NOT NULL,
  action_items JSONB DEFAULT '[]',
  blockers     JSONB DEFAULT '[]',
  deadlines    JSONB DEFAULT '[]',
  completions  JSONB DEFAULT '[]',
  tags         JSONB DEFAULT '[]',
  sentiment    TEXT DEFAULT 'neutral',
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_extracted_states_entry ON extracted_states(entry_id);

-- File attachments (uploaded images, documents, etc.)
CREATE TABLE IF NOT EXISTS file_attachments (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  entry_id       UUID NOT NULL,
  file_name      TEXT NOT NULL,
  file_type      TEXT,
  file_size      INT,
  file_key       TEXT NOT NULL,
  s3_url         TEXT,
  extracted_text TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_file_attachments_entry ON file_attachments(entry_id);
