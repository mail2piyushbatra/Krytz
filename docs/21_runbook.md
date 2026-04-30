# ✦ Krytz — Operational Runbook

## 1. Local Development
To spin up the entire Krytz stack locally:
1. **Infrastructure**: Run `docker-compose up -d` to start PostgreSQL (with pgvector), Redis, and MinIO.
2. **Server**: `cd server` -> `npm install` -> `npm run dev`
3. **Client (PWA)**: `cd client` -> `npm install` -> `npm run dev`

## 2. Deployment Guide
The backend is dockerized and ready for Railway, Render, or any container service.

### Environment Variables
You MUST set the following in your production environment:
- `JWT_SECRET`: Secure random string.
- `OPENAI_API_KEY`: Active OpenAI key for the RAG / extraction engines.
- `POSTGRES_URL`: PostgreSQL connection string.
- `MINIO_ENDPOINT`, `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`: S3-compatible storage credentials.
- `KRYTZ_TOOL_ALLOWED_HOSTS`: Comma-separated list of allowed domains for agentic HTTP calls.
- `CORS_ORIGIN`: Your client domain (e.g., `https://app.krytz.com`).

### Database & PgVector
The Krytz database **requires the `pgvector` extension** for memory RAG to function. Ensure your managed PostgreSQL provider supports it.
On boot, the server runs `lib/bootMigrations.js` which automatically executes the SQL schemas (`schema.foundation.sql`, `schema.v3.sql`, `schema.additions.sql`). No manual `npx prisma migrate` is needed.

## 3. Operations & Debugging

### Health Checks
- `GET /health` — Basic API status and version.
- `GET /health/engines` — Internal status of the Cortex orchestration engines.

### Logging
The application uses structured JSON logging via `logger.js`. In production, pipe standard output to Datadog/CloudWatch. Errors emit a `request_id` to correlate logs.

### Rate Limiting
- Global API limit: `API_RATE_LIMIT_MAX` (defaults to 600 req/min).
- AI Endpoints (`/api/v1/recall`, `/api/v1/intelligence/*`): Strictly limited to 20 req/min to protect OpenAI credits from abuse.

## 4. Background Jobs & Cron
The application utilizes a nightly consolidation cycle managed in `server/src/lib/cron.js`.
- 00:00 - Midnight maintenance (GDPR, plan cache reset).
- 02:00 - Episodic Memory consolidation.
- 03:00 - RL Policy Optimization.
- 04:00 - TSG Graph Maintenance.

*Ensure the server is running continuously to allow the cron jobs to fire, or utilize a worker dyno.*
