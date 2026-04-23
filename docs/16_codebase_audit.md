# ✦ FLOWRA — Independent Codebase Audit

> **Date:** 2026-04-24  
> **Auditor:** Antigravity  
> **Scope:** Every file in `D:\FLOWRA-APP`, assessed against the unified vision

---

## 1. CRITICAL BUGS (Would crash in production)

### 1.1 `index.js` still uses Morgan despite structured logger existing
- **File:** `server/src/index.js` line 5, 25
- **Issue:** `morgan('dev')` is imported and used, but `lib/logger.js` was built to replace it. Duplicate logging, and Morgan outputs unstructured text.
- **Fix:** Replace `morgan('dev')` with `logger.requestLogger()`

### 1.2 `auth.js` middleware throws instead of calling `next(err)`
- **File:** `server/src/middleware/auth.js` line 12
- **Issue:** `throw new AppError(...)` inside middleware. Express can't catch synchronous throws from middleware unless wrapped in try/catch. If no `Authorization` header, this will crash the process or return an unformatted error.
- **Fix:** Change to `return next(new AppError(...))`

### 1.3 `entry.schema.js` doesn't validate `fileMeta`
- **File:** `server/src/modules/entries/entry.schema.js`
- **Issue:** `entry.service.js` accepts `fileMeta` (array of `{fileName, fileType, fileSize}`) but the Zod schema doesn't validate it. Malformed fileMeta will silently pass through and could inject bad data or crash the file creation.
- **Fix:** Add `fileMeta` to schema with proper validation

### 1.4 `errorHandler.js` uses `console.error` not the logger
- **File:** `server/src/middleware/errorHandler.js` line 6
- **Issue:** `console.error('Error:', err.message)` — unstructured, no request context, no level tagging. In production this is useless noise.
- **Fix:** Use `logger.error(err.message, { error: err, path: req.path })`

### 1.5 Prisma client has no connection error handling
- **File:** `server/src/lib/prisma.js`
- **Issue:** No `$connect()` call, no error event listener, no graceful shutdown. If PostgreSQL is down at startup, the first request just throws an opaque Prisma error.
- **Fix:** Add explicit `$connect()` in server startup, `$disconnect()` on SIGTERM

### 1.6 `shared/constants.js` is never imported by server
- **File:** `shared/constants.js`
- **Issue:** We defined `MAX_FILE_SIZE`, `MAX_TEXT_LENGTH`, `ALLOWED_FILE_TYPES` but no server file imports them. File routes hardcode `10 * 1024 * 1024` locally. Entry schema hardcodes `10000`. These will diverge.
- **Fix:** Import from shared constants everywhere

---

## 2. ARCHITECTURAL PROBLEMS

### 2.1 Engines import Prisma directly — breaks separation
- **Files:** `state.engine.js`, `recall.engine.js`
- **Issue:** Engines are supposed to be the computation layer, but they do `const prisma = require('../../lib/prisma')` and run raw database queries. This means:
  - Engines can't be tested without a database
  - Engines can't be reused outside this server
  - The "module = API layer, engine = logic layer" distinction is fake — engines ARE the services now
- **Fix:** Engines should receive data, not fetch it. Inject a data access layer.

### 2.2 Circular dependency risk: Cortex ↔ Engines
- **File:** `engines/index.js`
- **Issue:** `cortex.setEngines()` creates runtime circular references. If any engine ever needs Cortex (e.g., ConnectorEngine fetching then calling Cortex.ingest), we get a circular dependency or undefined reference.
- **Fix:** Use an event bus or mediator pattern instead of direct references

### 2.3 Old `modules/ai/` directory has no clear purpose now
- **Files:** `modules/ai/recall.routes.js` (exists), `extraction.service.js` + `recall.service.js` (deleted)
- **Issue:** `recall.routes.js` is an orphan in `modules/ai/` — no service, no schema, no sibling files. The `ai` module concept doesn't exist anymore since engines handle AI.
- **Fix:** Move recall route to `modules/recall/recall.routes.js` or inline into state routes

### 2.4 `entry.service.js` requires engines inside functions
- **File:** `server/src/modules/entries/entry.service.js` lines 47-50
- **Issue:** `const { engines } = require('../../engines')` inside `createEntry()`. This is a deferred require to avoid circular imports, but it's fragile, untestable, and will break if engines aren't initialized yet.
- **Fix:** Inject engines via constructor or module-level import with proper initialization order

### 2.5 No graceful shutdown
- **File:** `server/src/index.js`
- **Issue:** No `SIGTERM`/`SIGINT` handlers. Docker sends SIGTERM on container stop. Without handling:
  - In-flight requests get killed
  - Database connections leak
  - S3 operations leave files in inconsistent state
- **Fix:** Add graceful shutdown (stop accepting requests, drain, disconnect Prisma, exit)

---

## 3. MISSING BACKEND COMPONENTS

### 3.1 No profile update endpoint
- **Issue:** `GET /auth/me` exists, `DELETE /auth/me` exists, but no `PATCH /auth/me` to update name/settings.

### 3.2 No data export endpoint
- **Issue:** Vision says "Data export (JSON download)" but no route exists.

### 3.3 No settings update
- **Issue:** User model has `settings Json` field but no endpoint to read or update it. Theme preference, notification settings, etc. have no API.

### 3.4 No entry count/stats endpoint
- **Issue:** Mobile app will need `GET /api/v1/stats` for dashboard (total entries, streak, entries this week, etc.) without downloading all entries.

### 3.5 File routes not registered properly
- **File:** `server/src/index.js` line 77
- **Issue:** `app.use('/api/v1/files', fileRoutes)` — file routes don't have the AI rate limiter, but upload confirmation triggers Cortex (which calls OpenAI). An attacker could spam `/files/confirm` to exhaust OpenAI credits.
- **Fix:** Add rate limiting to file confirm endpoint specifically.

### 3.6 No request ID tracking
- **Issue:** No `X-Request-Id` header generated per request. When debugging production issues across logs, there's no way to correlate a log entry to a specific request.

### 3.7 No API versioning strategy beyond URL
- **Issue:** Using `/api/v1/` in URLs, but no plan for what happens when v2 exists. No version header, no deprecation mechanism.

---

## 4. DATABASE ISSUES

### 4.1 `ExtractedState.processedAt` missing `@updatedAt`
- **File:** `schema.prisma` line 71
- **Issue:** `processedAt DateTime @default(now())` — this never updates when we re-extract. The `upsert` in Cortex manually sets it, but if someone calls Prisma directly, it stays as creation time.

### 4.2 No index on `FileAttachment.fileKey`
- **File:** `schema.prisma` line 83
- **Issue:** `deleteFilesFromS3` looks up files by `fileKey`, and `POST /files/confirm` updates by `fileKey`. Without an index, these are full table scans.

### 4.3 No `RefreshToken` expiry cleanup
- **Issue:** Expired refresh tokens are only deleted when a user tries to use them. Over time, the table accumulates dead tokens. No cron/scheduled cleanup.

### 4.4 No soft deletes
- **Issue:** Entry deletion is hard delete + cascade. If user accidentally deletes, data is gone. No recovery possible.
- **Consider:** `deletedAt DateTime?` with soft delete and 30-day retention.

### 4.5 No row-level security thinking
- **Issue:** Every query manually adds `where: { userId }`. One missed check = data leak. This is a pattern that should be enforced at the Prisma middleware level, not per-query.

---

## 5. SECURITY GAPS

### 5.1 Password has no complexity requirements
- **File:** `auth.schema.js` — `z.string().min(8)` only checks length.
- **Fix:** Add at least uppercase + number requirement, or use zxcvbn scoring.

### 5.2 No login attempt rate limiting
- **Issue:** The global rate limiter is 100/min. An attacker can try 100 passwords per minute. No account lockout, no CAPTCHA, no exponential backoff on failed logins.

### 5.3 Refresh token not bound to user agent/IP
- **Issue:** Stolen refresh tokens work from any device/location. No fingerprinting.

### 5.4 No CORS origin list for production
- **File:** `index.js` line 22 — `CORS_ORIGIN || '*'`. In production, this allows any origin. Mobile app requests come from native, not a web origin, but this still shouldn't be wildcard.

### 5.5 S3 presigned URLs have no user-scoping validation
- **Issue:** Upload URL generates key `${req.user.id}/...` but download URL only checks FileAttachment ownership. If someone guesses or brute-forces a fileKey, the presigned URL is valid for any file in the bucket.

---

## 6. MISSING INFRASTRUCTURE

### 6.1 No `.env` file (only `.env.example`)
- **Issue:** Docker-compose references `${OPENAI_API_KEY}` from host env. No actual `.env` exists. First-time setup will fail silently.

### 6.2 No database migration files
- **Issue:** `prisma/migrations/` directory doesn't exist. Schema exists but has never been migrated. First run requires `npx prisma migrate dev`.

### 6.3 No test files exist
- **Issue:** `vitest` is in devDeps, `npm test` script exists, but zero test files. Not even a placeholder.

### 6.4 `docker-compose` MinIO healthcheck is wrong
- **File:** `docker-compose.yml` — MinIO healthcheck uses `mc ready local` but `mc` isn't available inside the minio server container. This healthcheck will always fail.
- **Fix:** Use `curl -f http://localhost:9000/minio/health/live`

### 6.5 No Prisma migration step in docker-compose
- **Issue:** API container starts and tries to query PostgreSQL, but no migration has been run. The tables don't exist. Server will crash on first request.
- **Fix:** Add entrypoint script: `npx prisma migrate deploy && node src/index.js`

### 6.6 `multer` in dependencies but never used
- **File:** `server/package.json` line 25
- **Issue:** File uploads use presigned URLs (client → S3 direct), not multipart upload through the API. Multer is dead weight.

---

## 7. FRONTEND/MOBILE — NOTHING EXISTS

Not just "0 tasks done" — there is literally:
- No `mobile/` directory
- No screen designs
- No design tokens
- No component library
- No navigation structure
- No API client

The mobile app is the ENTIRE user-facing product. The backend is invisible to users. Without this, Flowra is a JSON API that nobody can use.

---

## 8. DOCUMENTATION GAPS

### 8.1 15 docs but they're pre-code artifacts
- **Issue:** The docs were written BEFORE the code. The code has since diverged significantly (engines layer added, modules restructured, gaps patched). The docs describe a different architecture than what exists.

### 8.2 No API documentation
- **Issue:** No Swagger/OpenAPI spec. No Postman collection. No endpoint documentation that a frontend developer could use. The only "docs" are code comments.

### 8.3 No runbook
- **Issue:** No document that says "here's how to deploy, here's how to debug, here's what to do when X breaks."

---

## 9. SUMMARY: REAL STATE

| Area | State | Verdict |
|---|---|---|
| **Auth** | Functional with bugs | 🟡 Fix auth.js throw, add profile update, add login rate limit |
| **Entries** | Functional with gaps | 🟡 Fix schema validation, add stats endpoint |
| **Engines** | Architecture exists | 🟡 DB coupling issue, circular dep risk |
| **Files** | Functional | 🟡 Missing fileKey index, multer unused |
| **State** | Functional | 🟢 Works if DB exists |
| **Recall** | Functional | 🟡 Orphaned in modules/ai/ |
| **Database** | Schema only | 🔴 Never migrated, no migration files, no cleanup jobs |
| **Infrastructure** | Docker files exist | 🔴 MinIO healthcheck broken, no migration step, no .env |
| **Tests** | Nothing | 🔴 Zero test files |
| **Mobile** | Nothing | 🔴 No code, no designs, no screens |
| **API docs** | Nothing | 🔴 No OpenAPI spec |
| **Security** | Basic | 🟡 Weak passwords, no login lockout, wildcard CORS |
