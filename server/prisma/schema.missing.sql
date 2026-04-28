CREATE TABLE IF NOT EXISTS daily_states (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  open_items INT NOT NULL DEFAULT 0,
  blocker_count INT NOT NULL DEFAULT 0,
  completed_count INT NOT NULL DEFAULT 0,
  deadlines JSONB DEFAULT '[]'::jsonb,
  by_project JSONB DEFAULT '{}'::jsonb,
  summary TEXT,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, date)
);
