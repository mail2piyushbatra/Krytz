# Flowra — Technical White Paper

> **Classification:** Confidential | **Version:** 1.0 | **Date:** April 2026  

---

## 1. System Overview

Flowra is a **mobile-first** state reconstruction platform. The system ingests unstructured user inputs (text, images, PDFs), applies AI-powered extraction to derive structured state, and presents a real-time life dashboard.

### High-Level Architecture

```
┌───────────────────────────────────────────────────┐
│            Mobile App (React Native + Expo)       │
│  ┌──────────┐  ┌──────────┐  ┌────────────────┐  │
│  │ Capture  │  │ Timeline │  │ State Dashboard│  │
│  │  Screen  │  │  Screen  │  │    Screen      │  │
│  └──────────┘  └──────────┘  └────────────────┘  │
└───────────────────────┬───────────────────────────┘
                        │ HTTPS / REST
┌───────────────────────┼───────────────────────────┐
│               API Gateway / Backend               │
│              (Node.js + Express)                   │
│                                                   │
│  ┌────────┐ ┌──────────┐ ┌──────┐ ┌───────────┐  │
│  │ Auth   │ │ Entry    │ │ AI   │ │ File      │  │
│  │Service │ │ Service  │ │Pipelne│ │ Service   │  │
│  └────────┘ └──────────┘ └──────┘ └───────────┘  │
│                     │          │         │         │
│              ┌──────┴──────┐   │    ┌────┴─────┐  │
│              │  PostgreSQL │   │    │ S3 / R2  │  │
│              │  (Prisma)   │   │    │ (Files)  │  │
│              └─────────────┘   │    └──────────┘  │
└────────────────────────────────┼───────────────────┘
                                │
                        ┌───────┴────────┐
                        │   LLM API      │
                        │ (OpenAI/Claude)│
                        └────────────────┘
```

---

## 2. Technology Stack

| Layer | Technology | Rationale |
|---|---|---|
| **Mobile** | React Native + Expo | Cross-platform (iOS + Android), JS ecosystem, OTA updates |
| **Navigation** | React Navigation v6 | Industry standard for RN, deep linking support |
| **State Mgmt** | Zustand | Lightweight, no boilerplate, works with RN |
| **Backend** | Node.js + Express | Same language as frontend, async-friendly |
| **Database** | PostgreSQL (via Prisma) | JSONB support, full-text search, production-ready |
| **File Storage** | Cloudflare R2 / AWS S3 | Cost-effective blob storage, CDN integration |
| **AI** | OpenAI GPT-4o-mini | Best cost/quality ratio for extraction tasks |
| **Auth** | JWT + bcrypt | Simple, stateless, mobile-friendly |
| **Push** | Expo Notifications | Cross-platform push, no native setup needed |
| **Deploy** | Railway (API) + Expo EAS (mobile) | Simple CI/CD, managed infra |

---

## 3. Data Architecture

### 3.1 Core Entities

```sql
-- Users
User {
  id          CUID (PK)
  email       UNIQUE
  passwordHash
  name
  settings    JSONB    -- theme, notification prefs, etc.
  createdAt   TIMESTAMP
}

-- Capture entries
Entry {
  id          CUID (PK)
  userId      FK → User
  rawText     TEXT
  source      ENUM (manual, calendar, gmail, notion)
  hasFiles    BOOLEAN
  timestamp   TIMESTAMP
  createdAt   TIMESTAMP
}

-- File attachments
FileAttachment {
  id          CUID (PK)
  entryId     FK → Entry
  fileName    TEXT
  fileType    TEXT (image/pdf/doc)
  fileUrl     TEXT        -- S3/R2 URL
  fileSize    INT
  extractedText TEXT      -- OCR/AI extracted content
  createdAt   TIMESTAMP
}

-- AI-extracted state per entry
ExtractedState {
  id          CUID (PK)
  entryId     FK → Entry (UNIQUE)
  actionItems JSONB     -- [{text, status, dueDate?}]
  blockers    JSONB     -- [{text, since?}]
  completions JSONB     -- [{text}]
  deadlines   JSONB     -- [{task, date}]
  tags        JSONB     -- ["project-x", "meeting"]
  sentiment   TEXT      -- focused/stressed/productive/neutral
  processedAt TIMESTAMP
}

-- Aggregated daily snapshot
DailyState {
  id          CUID (PK)
  userId      FK → User
  date        DATE
  openItems   INT
  blockers    INT
  completed   INT
  deadlines   JSONB
  summary     TEXT
  computedAt  TIMESTAMP
  UNIQUE(userId, date)
}
```

### 3.2 Data Flow

```
User Input (text + files)
    │
    ▼
[Entry Service] ──→ Store Entry + Files ──→ DB + S3
    │
    ▼ (async job)
[AI Pipeline]
    ├── Text → State Extraction Prompt → LLM → ExtractedState
    ├── Image → Vision API → Text → State Extraction
    └── PDF → Text Extraction → State Extraction
    │
    ▼
[State Aggregator] ──→ Recompute DailyState ──→ DB
    │
    ▼
[Push Notification] ──→ "Your state updated" (optional)
```

---

## 4. AI Pipeline

### 4.1 State Extraction

**Input:** Raw text (+ extracted file text)  
**Output:** Structured JSON

```json
{
  "actionItems": [
    {"text": "Follow up with Rajesh", "dueDate": "2026-04-25"}
  ],
  "blockers": [
    {"text": "Waiting on OAuth docs"}
  ],
  "completions": [
    {"text": "Merged 2 PRs"}
  ],
  "deadlines": [
    {"task": "API proposal", "date": "2026-04-28"}
  ],
  "tags": ["api", "meeting", "rajesh"],
  "sentiment": "focused"
}
```

**Model:** GPT-4o-mini (cost: ~$0.0003/call)  
**Latency:** 1–3 seconds (async, non-blocking)

### 4.2 File Processing Pipeline

| File Type | Processing |
|---|---|
| **Image** | GPT-4o vision → describe + extract text/action items |
| **PDF** | pdf-parse library → extract text → feed to state extraction |
| **Document** | Convert to text → feed to state extraction |

### 4.3 Recall (Natural Language Query)

```
User Query: "What did I do last week?"
    │
    ▼
[Retrieve entries from date range]
    │
    ▼
[Build context: entries + extracted states]
    │
    ▼
[LLM: Answer query from context]
    │
    ▼
[Return: answer + source entries]
```

---

## 5. Security Model

| Concern | Approach |
|---|---|
| **Auth** | bcrypt (12 rounds), JWT (httpOnly, secure), refresh tokens |
| **API** | All routes require valid JWT. Rate limiting (100 req/min) |
| **Files** | Signed URLs (expire in 1hr). No public bucket access. |
| **LLM** | Strip PII before sending. No user identifiers sent to LLM. |
| **Data** | User owns all data. Export anytime. Delete account = full purge. |
| **Mobile** | Certificate pinning. Secure storage for tokens. |
| **Encryption** | TLS in transit. AES-256 at rest (DB + files). |

---

## 6. Scalability Path

### Phase 1: Monolith (0–10K users)
```
Single Node.js process → PostgreSQL → S3
```
- Handles 100+ req/sec easily
- AI calls are async (non-blocking)
- Cost: ~$20/month

### Phase 2: Vertical Scale (10K–100K users)
```
Larger instance + read replicas + Redis cache + job queue
```
- Add BullMQ for async AI jobs
- Redis for DailyState cache
- PG read replica for queries
- Cost: ~$200/month

### Phase 3: Microservices (100K+ users)
- See **Microservice Architecture Spec** (Doc 07)
- Service decomposition: Auth, Entry, AI, File, State, Connector
- Event-driven via message bus
- Independent scaling per service

---

## 7. Performance Targets

| Operation | Target | Approach |
|---|---|---|
| Capture submit | < 200ms | Direct DB insert, async AI |
| Timeline load | < 500ms | Paginated, indexed queries |
| State panel | < 300ms | Cached DailyState |
| Recall query | < 5s | LLM latency (acceptable for search) |
| File upload | < 3s (10MB) | Presigned URL → direct to S3 |
| App cold start | < 2s | Expo optimized bundle |
