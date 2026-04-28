ALTER TABLE entries ADD COLUMN IF NOT EXISTS search_vector tsvector GENERATED ALWAYS AS (to_tsvector('english', coalesce(raw_text, ''))) STORED;
CREATE INDEX IF NOT EXISTS idx_entries_search_vector ON entries USING GIN (search_vector);

ALTER TABLE items ADD COLUMN IF NOT EXISTS search_vector tsvector GENERATED ALWAYS AS (to_tsvector('english', coalesce(canonical_text, ''))) STORED;
CREATE INDEX IF NOT EXISTS idx_items_search_vector ON items USING GIN (search_vector);
