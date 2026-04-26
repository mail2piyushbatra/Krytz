# ✦ Flowra V3 — Database Migration Guide

## Files

| File | What it does | Run order |
|---|---|---|
| `schema.additions.sql` | user columns, plan_cache, cost_usage, snoozes, capture_queue, notifications, feedback | 1 |
| `schema.entities.sql` | entities, entity_aliases, undo_log, user_intelligence_stage, suggestion_events | 2 |
| `schema.intelligence.sql` | contradictions, commitments, time_estimates, GDPR, Stripe | 3 |
| `rls.sql` | RLS policies for ALL user-scoped tables + `current_user_id()` helper | 4 |
| `schema.v3.sql` | **All 4 combined in correct order** — run this for a single-shot migration | — |

---

## How to run

### Option A — Single combined file (recommended)
```bash
psql $DATABASE_URL -f server/prisma/schema.v3.sql
```

### Option B — Step by step
```bash
psql $DATABASE_URL -f server/prisma/schema.additions.sql
psql $DATABASE_URL -f server/prisma/schema.entities.sql
psql $DATABASE_URL -f server/prisma/schema.intelligence.sql
psql $DATABASE_URL -f server/prisma/rls.sql
```

### Verify RLS is active
```sql
SELECT tablename, rowsecurity, forcerowsecurity
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;
```

---

## Prerequisites

1. **Extensions** — `uuid-ossp` and `vector` (pgvector) must be available:
   ```sql
   CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
   CREATE EXTENSION IF NOT EXISTS "vector";
   ```
2. **Base schema** — Prisma init migration must have run first:
   ```bash
   npx prisma migrate deploy
   ```
3. **App role** — Connect as `flowra_app` (not superuser) in production.  
   Superuser bypasses RLS. See the role grant template at the bottom of `rls.sql`.

---

## Tables covered by RLS (26 total)

### Core (from schema.sql)
`items`, `item_events`, `item_edges`, `episodic_memory`, `semantic_memory`,
`rules`, `action_runs`, `metrics`, `memory_summaries`, `events`

### V3 additions
`plan_cache`, `cost_usage`, `snoozes`, `capture_queue`, `notifications`, `feedback`

### V3 entities
`entities`, `entity_aliases`, `undo_log`, `user_intelligence_stage`, `suggestion_events`

### V3 intelligence
`contradictions`, `commitments`, `time_estimates`

### Special policies (user_id IS NULL allowed)
- `rules` — global system rules
- `action_runs` — inherits from rules
- `metrics` — global metrics
- `events` — system audit events

---

## Environment variables required

```env
DATABASE_URL=postgresql://flowra_app:password@host:5432/flowra
OPENAI_API_KEY=sk-...
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
REDIS_URL=redis://...          # optional — embedding cache
APP_URL=https://app.flowra.ai  # for Stripe redirect URLs
```

---

## After migration — verify with

```sql
-- Check all 26 tables have RLS enabled
SELECT tablename,
       rowsecurity         AS rls_enabled,
       forcerowsecurity    AS rls_forced
FROM pg_tables
WHERE schemaname = 'public'
  AND rowsecurity = true
ORDER BY tablename;

-- Check policies exist
SELECT schemaname, tablename, policyname
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename;

-- Test isolation (should return 0 rows with no user set)
SET app.current_user_id = '';
SELECT count(*) FROM items;  -- 0
```
