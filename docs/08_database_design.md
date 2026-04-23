# Flowra — Database Design Document

> **Version:** 1.0 | **Date:** April 2026 | **Database:** PostgreSQL 16 + Prisma ORM

---

## 1. Entity Relationship Diagram

```
┌──────────────┐       ┌──────────────────┐       ┌───────────────────┐
│     User     │       │      Entry       │       │  ExtractedState   │
├──────────────┤       ├──────────────────┤       ├───────────────────┤
│ id      (PK) │──┐    │ id         (PK)  │──┐    │ id          (PK)  │
│ email   (UQ) │  │    │ userId     (FK)  │  │    │ entryId  (FK,UQ)  │
│ passwordHash │  │    │ rawText          │  ├───>│ actionItems (JSON)│
│ name         │  ├──>│ source           │  │    │ blockers    (JSON)│
│ settings (J) │  │    │ hasFiles         │  │    │ completions (JSON)│
│ createdAt    │  │    │ timestamp        │  │    │ deadlines   (JSON)│
└──────────────┘  │    │ createdAt        │  │    │ tags        (JSON)│
                  │    └──────────────────┘  │    │ sentiment         │
                  │           │              │    │ processedAt       │
                  │           │ 1:N          │    └───────────────────┘
                  │           ▼              │
                  │    ┌──────────────────┐  │
                  │    │ FileAttachment   │  │
                  │    ├──────────────────┤  │
                  │    │ id         (PK)  │  │
                  │    │ entryId    (FK)  │──┘
                  │    │ fileName         │
                  │    │ fileType         │
                  │    │ fileUrl          │
                  │    │ fileSize         │
                  │    │ extractedText    │
                  │    │ createdAt        │
                  │    └──────────────────┘
                  │
                  │    ┌──────────────────┐
                  │    │   DailyState     │
                  │    ├──────────────────┤
                  │    │ id         (PK)  │
                  └──>│ userId     (FK)  │
                       │ date       (UQ*) │  * unique with userId
                       │ openItems        │
                       │ blockerCount     │
                       │ completedCount   │
                       │ deadlines  (JSON)│
                       │ summary          │
                       │ computedAt       │
                       └──────────────────┘
```

### Relationship Summary

| Parent | Child | Type | On Delete |
|---|---|---|---|
| User → Entry | userId | 1:N | CASCADE |
| User → DailyState | userId | 1:N | CASCADE |
| Entry → ExtractedState | entryId | 1:1 | CASCADE |
| Entry → FileAttachment | entryId | 1:N | CASCADE |

---

## 2. Indexing Strategy

### 2.1 Primary & Unique Indexes (Auto)

| Table | Index | Type |
|---|---|---|
| User | `id` | Primary Key |
| User | `email` | Unique |
| Entry | `id` | Primary Key |
| ExtractedState | `id` | Primary Key |
| ExtractedState | `entryId` | Unique |
| FileAttachment | `id` | Primary Key |
| DailyState | `id` | Primary Key |
| DailyState | `(userId, date)` | Unique Composite |

### 2.2 Query Performance Indexes

| Table | Index | Columns | Why |
|---|---|---|---|
| Entry | `idx_entry_user_time` | `(userId, timestamp DESC)` | Timeline queries: "show my entries today" |
| Entry | `idx_entry_user_source` | `(userId, source)` | Filter by source: "show calendar entries" |
| Entry | `idx_entry_text_search` | `rawText` (GIN tsvector) | Full-text search for recall |
| FileAttachment | `idx_file_entry` | `(entryId)` | Load files for an entry |
| DailyState | `idx_state_user_date` | `(userId, date DESC)` | State lookups |
| ExtractedState | `idx_extracted_entry` | `(entryId)` | Join with entry |

### 2.3 Full-Text Search Setup

```sql
-- Add tsvector column for fast text search
ALTER TABLE "Entry" ADD COLUMN "searchVector" tsvector
  GENERATED ALWAYS AS (to_tsvector('english', "rawText")) STORED;

CREATE INDEX idx_entry_fts ON "Entry" USING GIN ("searchVector");

-- Query example
SELECT * FROM "Entry"
WHERE "userId" = $1
  AND "searchVector" @@ plainto_tsquery('english', $2)
ORDER BY "timestamp" DESC;
```

---

## 3. Query Patterns

| Query | Frequency | SQL Pattern | Index Used |
|---|---|---|---|
| Get today's entries | Very High | `WHERE userId=? AND timestamp >= today ORDER BY timestamp DESC` | `idx_entry_user_time` |
| Get entries by date range | High | `WHERE userId=? AND timestamp BETWEEN ? AND ?` | `idx_entry_user_time` |
| Get entry with state | High | `JOIN ExtractedState ON entryId` | PK + `idx_extracted_entry` |
| Get entry with files | Medium | `JOIN FileAttachment ON entryId` | `idx_file_entry` |
| Get today's state | Very High | `WHERE userId=? AND date=today` | `idx_state_user_date` |
| Full-text search | Medium | `WHERE searchVector @@ query` | `idx_entry_fts` |
| Count entries by day | Low | `GROUP BY date_trunc('day', timestamp)` | `idx_entry_user_time` |
| Delete user cascade | Rare | `DELETE FROM User WHERE id=?` | PK + cascades |

---

## 4. Migration Strategy

### 4.1 Tooling
- **Prisma Migrate** for schema changes
- All migrations versioned in `prisma/migrations/`
- Never edit existing migrations — always create new ones

### 4.2 Migration Workflow

```
1. Edit schema.prisma
2. npx prisma migrate dev --name descriptive_name
3. Review generated SQL
4. Test locally
5. Commit migration files
6. Deploy: npx prisma migrate deploy
```

### 4.3 Dangerous Operations Checklist

| Operation | Risk | Safe Approach |
|---|---|---|
| Drop column | Data loss | Deprecate → migrate data → drop in next release |
| Rename column | Breaks queries | Add new → copy data → drop old |
| Add NOT NULL | Fails on existing rows | Add nullable → backfill → add constraint |
| Change type | Data corruption | Add new column → migrate → drop old |
| Drop table | Data loss | Soft delete first → purge after confirmation |

---

## 5. Data Lifecycle

### 5.1 Retention

| Data | Retention | Rationale |
|---|---|---|
| User account | Until deletion | Core entity |
| Entries | Forever (default) | Timeline is the product |
| ExtractedState | Same as entry | Tied to entry lifecycle |
| Files (S3) | Same as entry | Cascade delete |
| DailyState | 1 year rolling | Can be recomputed |
| Auth refresh tokens | 30 days | Security |

### 5.2 Data Export

```json
// GET /api/auth/me/export
{
  "user": { "email": "...", "name": "...", "createdAt": "..." },
  "entries": [
    {
      "rawText": "...",
      "timestamp": "...",
      "source": "manual",
      "extractedState": { "actionItems": [...], ... },
      "files": [{ "fileName": "...", "fileUrl": "..." }]
    }
  ],
  "exportedAt": "2026-04-24T00:00:00Z"
}
```

### 5.3 Account Deletion

```
DELETE /api/auth/me → triggers:
  1. Delete all files from S3/R2
  2. CASCADE delete: entries, states, files, daily states
  3. Delete user record
  4. Invalidate all tokens
  5. Return confirmation
```

---

## 6. Backup & Recovery

| Component | Strategy | Frequency | Retention |
|---|---|---|---|
| PostgreSQL | Automated snapshots (Railway/RDS) | Daily | 7 days |
| PostgreSQL | WAL archiving for PITR | Continuous | 3 days |
| S3/R2 files | Versioning enabled | On write | 30 days |
| Prisma migrations | Git versioned | On change | Forever |

---

## 7. Performance Guidelines

| Guideline | Detail |
|---|---|
| **Pagination** | Always paginate entry lists. Default: 20, max: 100. Cursor-based preferred. |
| **Eager loading** | Use Prisma `include` for related data. Never N+1. |
| **JSONB queries** | Avoid deep JSONB queries in WHERE. Extract to columns if queried frequently. |
| **Connection pool** | Prisma default pool size: 10. Increase for production. |
| **Vacuuming** | Auto-vacuum enabled. Monitor dead tuples. |
| **Query timeout** | Set statement_timeout to 5s for API queries. |
