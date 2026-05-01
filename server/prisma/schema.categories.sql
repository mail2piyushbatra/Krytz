-- ─── Categories + Items.category ─────────────────────────────────────────────
-- Run after schema.v3.sql so current_user_id() is available.

-- Static user-defined categories
CREATE TABLE IF NOT EXISTS categories (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID NOT NULL,
  name       TEXT NOT NULL,
  color      TEXT NOT NULL DEFAULT '#6c5ce7',
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, name)
);
CREATE INDEX IF NOT EXISTS idx_categories_user ON categories(user_id, sort_order);

-- Add category column to items (if not exists)
ALTER TABLE items ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'uncategorized';
CREATE INDEX IF NOT EXISTS idx_items_user_category ON items(user_id, category);

-- RLS for categories
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS categories_isolation ON categories;
CREATE POLICY categories_isolation ON categories
  USING (user_id = current_user_id())
  WITH CHECK (user_id = current_user_id());
