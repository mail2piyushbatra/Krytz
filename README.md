# ✦ FLOWRA

> A closed-loop, state-aware personal computation engine.  
> Capture anything → See your state → Know what matters → Act.

---

## What is Flowra?

Flowra reconstructs your reality from raw captures. You dump text, voice, or files — Flowra extracts action items, blockers, completions, deadlines, and sentiment. It shows you **what's going on** without you having to organize anything.

**Phase 1-3:** Capture + State + Connectors (what you're doing)  
**Phase 4-7:** Priority + Decision + Observability + Learning (what you should do)

See [docs/00_unified_vision.md](./docs/00_unified_vision.md) for the full vision.

---

## Architecture

```
Mobile App (React Native + Expo)
    │
    ▼
API Monolith (Express + Node.js)
    │
    ├── Modules (Auth, Entries, Files, State, Recall)
    │       │
    │       ▼
    ├── Engines (Cortex → Normalization → Extraction → State)
    │       │
    │       ▼
    ├── PostgreSQL (pg Pool — raw SQL)
    ├── Redis (Job queue)
    └── S3/R2 (File storage)
```

### Engines
| Engine | Purpose |
|---|---|
| **Cortex** | Orchestrates the full pipeline |
| **Normalization** | Raw input → Internal Representation |
| **Extraction** | IR → Structured state (GPT-4o-mini + Vision) |
| **State** | Daily/weekly aggregation, carry-overs |
| **Recall** | Natural language query over history |
| **Connector** | External source adapter framework |

---

## Quick Start

### Prerequisites
- Node.js 20+
- Docker + Docker Compose (for PostgreSQL, Redis, MinIO)

### 1. Clone & Install
```bash
git clone <repo-url>
cd FLOWRA-APP
npm install
```

### 2. Environment
```bash
cp .env.example .env
# Edit .env with your values (see .env.example for descriptions)
```

### 3. Start Infrastructure
```bash
docker-compose up -d postgres redis minio minio-init
```

### 4. Database Setup
```bash
cd server
psql $DATABASE_URL -f server/prisma/schema.v3.sql
npm run db:seed
```

### 5. Run Server
```bash
npm run dev:server
# API at http://localhost:8000
# Health: http://localhost:8000/health
# Engine health: http://localhost:8000/health/engines
```

### Or run everything via Docker:
```bash
docker-compose up
# API + PostgreSQL + Redis + MinIO — all in one command
```

---

## API Endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/auth/register` | Create account |
| `POST` | `/api/v1/auth/login` | Login |
| `POST` | `/api/v1/auth/refresh` | Refresh access token |
| `GET` | `/api/v1/auth/me` | Get profile |
| `DELETE` | `/api/v1/auth/me` | Delete account + all data |
| `POST` | `/api/v1/entries` | Create capture entry |
| `GET` | `/api/v1/entries` | List entries (paginated, filtered) |
| `GET` | `/api/v1/entries/:id` | Get single entry |
| `PUT` | `/api/v1/entries/:id` | Update entry + re-extract |
| `DELETE` | `/api/v1/entries/:id` | Delete entry |
| `GET` | `/api/v1/entries/search?q=` | Search entries |
| `GET` | `/api/v1/state/today` | Today's aggregated state |
| `GET` | `/api/v1/state/week` | Weekly state breakdown |
| `GET` | `/api/v1/state/carryovers` | Items carried over from past days |
| `POST` | `/api/v1/recall` | Natural language query |
| `POST` | `/api/v1/files/upload-url` | Get presigned upload URL |
| `POST` | `/api/v1/files/confirm` | Confirm upload + update metadata |
| `GET` | `/api/v1/files/:id/download-url` | Get presigned download URL |

---

## Project Structure

```
FLOWRA-APP/
├── docs/                    ← 16 design documents
├── server/
│   ├── prisma/              ← SQL schemas + migrations + seed
│   └── src/
│       ├── engines/         ← Core intelligence (6 engines)
│       ├── modules/         ← API routes + services
│       ├── middleware/      ← Auth, validation, error handling
│       └── lib/             ← DB pool, logger
├── shared/                  ← Constants shared across packages
├── mobile/                  ← React Native app (not yet scaffolded)
├── docker-compose.yml       ← Local dev stack
├── Dockerfile               ← Multi-stage build
├── TODO.md                  ← 212 tasks tracked
├── STANDARDS.md             ← No-stub coding policy
├── HANDOVER.md              ← Session handover notes
└── .github/workflows/       ← CI/CD pipeline
```

---

## Key Documents

| Document | Purpose |
|---|---|
| [Unified Vision](./docs/00_unified_vision.md) | Full product vision (7 phases) |
| [TODO.md](./TODO.md) | Master task tracker (212 tasks) |
| [STANDARDS.md](./STANDARDS.md) | Coding standards (no stubs policy) |
| [HANDOVER.md](./HANDOVER.md) | Session handover + next steps |

---

## Standards

See [STANDARDS.md](./STANDARDS.md). Key rule:

> **No partial code, no stubs, no placeholder logic, no unresolved TODOs in source files.**  
> Every file committed must be production-ready or not committed at all.

---

## License

Private. All rights reserved.
