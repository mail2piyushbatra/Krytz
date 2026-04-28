# ✦ FLOWRA — Master TODO Tracker

> **Rule:** See [STANDARDS.md](./STANDARDS.md) — NO stubs, NO partial code, NO TODOs left in source files.  
> **Vision:** See [docs/00_unified_vision.md](./docs/00_unified_vision.md) — Merged product + engine roadmap.  
> **Last Updated:** 2026-04-24

---

## Legend

- ✅ Done
- 🔨 In Progress
- ⬜ Not Started
- 🔴 Blocked

---

## Phase 0 — Project Setup

| # | Task | Status | Notes |
|---|---|---|---|
| 0.1 | Git repo initialized | ✅ | `D:\FLOWRA-APP` |
| 0.2 | Documentation suite (15 docs) | ✅ | `/docs/01-15` |
| 0.3 | Unified vision document | ✅ | `/docs/00_unified_vision.md` |
| 0.4 | Root package.json + workspaces | ✅ | |
| 0.5 | `.gitignore` | ✅ | |
| 0.6 | `.env.example` | ✅ | |
| 0.7 | `README.md` | ✅ | |
| 0.8 | `STANDARDS.md` (no-stub rule) | ✅ | |
| 0.9 | Install Node.js on machine | ✅ | Needed before anything runs |
| 0.10 | `npm install` (root + server) | 🔴 | Blocked on 0.9 |
| 0.11 | Initial git commit | ✅ | After Node installed |

---

## Phase 1A — Server Backend (Capture + State)

### Auth Module
| # | Task | Status |
|---|---|---|
| 1.1 | Register endpoint | ✅ |
| 1.2 | Login endpoint | ✅ |
| 1.3 | JWT + refresh token rotation | ✅ |
| 1.4 | Get profile endpoint | ✅ |
| 1.5 | Delete account (+ S3 purge) | ✅ |

### Entry Module
| # | Task | Status |
|---|---|---|
| 1.6 | Create entry | ✅ |
| 1.7 | List entries (paginated + filtered) | ✅ |
| 1.8 | Get single entry | ✅ |
| 1.9 | Delete entry (+ S3 purge + state recompute) | ✅ |
| 1.10 | Update entry (+ re-extraction) | ✅ |
| 1.11 | Full-text search | ✅ |
| 1.12 | tsvector FTS migration | ✅ |

### Engines (Core Intelligence)
| # | Task | Status |
|---|---|---|
| 1.13 | BaseEngine (lifecycle, health, tracking) | ✅ |
| 1.14 | CortexEngine (pipeline orchestrator) | ✅ |
| 1.15 | NormalizationEngine (7 normalizers) | ✅ |
| 1.16 | ExtractionEngine (LLM + Vision + PII stripping) | ✅ |
| 1.17 | StateEngine (daily/weekly/carry-overs) | ✅ |
| 1.18 | RecallEngine (time parsing + keyword + LLM) | ✅ |
| 1.19 | ConnectorEngine (adapter framework) | ✅ |
| 1.20 | Engine registry + Cortex wiring | ✅ |
| 1.21 | Modules wired to engines (no bridges) | ✅ |

### File Module
| # | Task | Status |
|---|---|---|
| 1.22 | Presigned upload URL | ✅ |
| 1.23 | Presigned download URL | ✅ |
| 1.24 | Upload confirmation (S3 verify + metadata) | ✅ |
| 1.25 | File deletion (single + batch) | ✅ |
| 1.26 | File type validation | ✅ |

### Middleware & Infra
| # | Task | Status |
|---|---|---|
| 1.27 | JWT auth middleware | ✅ |
| 1.28 | Zod validation middleware | ✅ |
| 1.29 | Global error handler | ✅ |
| 1.30 | Rate limiting | ✅ |
| 1.31 | CORS + Helmet | ✅ |
| 1.32 | Structured JSON logging | ✅ |
| 1.33 | Dockerfile (multi-stage) | ✅ |
| 1.34 | docker-compose (PG + Redis + MinIO + API) | ✅ |
| 1.35 | GitHub Actions CI/CD | ✅ |
| 1.36 | ESLint config | ✅ |
| 1.37 | Prisma schema (5 models) | ✅ |
| 1.38 | Seed file | ✅ |
| 1.39 | Run initial migration | 🔴 |
| 1.40 | BullMQ job queue for extraction | ✅ |

### Normalization Upgrades (Gap 3)
| # | Task | Status |
|---|---|---|
| 1.42 | Schema validation layer (reject malformed input) | ✅ |
| 1.43 | Ambiguity detection (is this a task? event? unclear?) | ✅ |
| 1.44 | Confidence scoring on extraction (0.0–1.0) | ✅ |
| 1.45 | Correction loop (ask user if confidence < 0.6) | ✅ |
| 1.41 | Extraction retry with backoff | ✅ |

**Phase 1A: 37/41 done (90%)**

---

## Phase 1B — Mobile App (React Native + Expo)

### Setup
| # | Task | Status |
|---|---|---|
| 2.1 | Initialize Expo project | ✅ |
| 2.2 | React Navigation (Tab + Stack) | ✅ |
| 2.3 | Design token system (from brand guide) | ✅ |
| 2.4 | Zustand stores (auth, entries, state) | ✅ |
| 2.5 | API service layer (fetch + JWT injection) | ✅ |
| 2.6 | SecureStore for tokens | ✅ |

### Screens
| # | Task | Status |
|---|---|---|
| 2.7 | Login screen | ✅ |
| 2.8 | Register screen | ✅ |
| 2.9 | Auto-login flow | ✅ |
| 2.10 | Token refresh interceptor | ✅ |
| 2.11 | Today View — capture input | ✅ |
| 2.12 | Today View — state panel (4 cards) | ✅ |
| 2.13 | Today View — timeline feed | ✅ |
| 2.14 | Entry card component | ✅ |
| 2.15 | Badge component (status pills) | ✅ |
| 2.16 | Pull-to-refresh | ✅ |
| 2.17 | Entry delete (swipe) | ✅ |
| 2.18 | Timeline View (grouped by day) | ✅ |
| 2.19 | Infinite scroll / pagination | ✅ |
| 2.20 | Date picker (jump to date) | ✅ |
| 2.21 | Recall View — query input | ✅ |
| 2.22 | Recall View — AI answer card | ✅ |
| 2.23 | Recall View — source entries | ✅ |
| 2.24 | Settings — profile, theme, export, delete, logout | ✅ |

### File Capture
| # | Task | Status |
|---|---|---|
| 2.25 | Image picker (camera + gallery) | ✅ |
| 2.26 | Document picker (PDF) | ✅ |
| 2.27 | Upload progress indicator | ✅ |
| 2.28 | File thumbnail in entry card | ✅ |

### Animations
| # | Task | Status |
|---|---|---|
| 2.29 | Entry slide-in | ✅ |
| 2.30 | Badge staggered fade-in | ✅ |
| 2.31 | State counter roll animation | ✅ |
| 2.32 | Capture expand on focus | ✅ |
| 2.33 | Empty states + loading skeletons | ✅ |

**Phase 1B: 0/33 done (0%)**

---

## Phase 2 — Retention & Polish

| # | Task | Status |
|---|---|---|
| 3.1 | Weekly digest generation (LLM) | ✅ |
| 3.2 | Weekly digest UI card | ✅ |
| 3.3 | Push notifications (morning + state) | ✅ |
| 3.4 | Offline capture + sync queue | ✅ |
| 3.5 | Pin/star entries | ✅ |
| 3.6 | Password reset flow | ✅ |
| 3.7 | Dark/light theme toggle | ✅ |
| 3.8 | Data export (JSON download) | ✅ |

---

## Phase 3 — Connectors

| # | Task | Status | Source |
|---|---|---|---|
| 4.1 | OAuth infrastructure | ✅ | BLUF.txt §3 |
| 4.2 | Google Calendar adapter | ✅ | BLUF.txt §7 |
| 4.3 | Gmail adapter | ✅ | BLUF.txt §7 |
| 4.4 | Notion adapter | ✅ | BLUF.txt §7 |
| 4.5 | Slash commands (`/calendar today`) | ✅ | BLUF.txt §4 |
| 4.6 | User approval flow | ✅ | BLUF.txt §4 |
| 4.7 | Data filtering (only actionable items) | ✅ | BLUF.txt §6 |
| 4.8 | Permission model (read/write/scope) | ✅ | BLUF.txt §5 |
| 4.9 | Connect/disconnect/pause UI | ✅ | BLUF.txt §10 |

---

## Phase 4 — Priority & State Machine (5D Engine Part 1)

> Source: `1.txt` — Begins transition from "capture app" to "computation engine"

### 4.Pre — Canonical Data Model (Gap 2)
| # | Task | Status |
|---|---|---|
| 5.0a | Unified Entity base type (id, type, userId, timestamps) | ✅ |
| 5.0b | Task model (state, priority, dependencies, signals, boosts) | ✅ |
| 5.0c | Event model (eventType, payload, sourceEntityId) | ✅ |
| 5.0d | Trace model (taskId, state, priority, decision, signals, boosts, reason) | ✅ |
| 5.0e | Command model (commandType, payload, status, retryCount) | ✅ |
| 5.0f | DB migration for new models | ✅ |

### 4.Pre — Failure & Safety (Gap 4)
| # | Task | Status |
|---|---|---|
| 5.0g | System constants (MAX_PROPAGATION_DEPTH, SPIKE_THRESHOLD, etc.) | ✅ |
| 5.0h | Propagation depth limiter (max 10 levels, 50 nodes) | ✅ |
| 5.0i | Replay-based recovery on corruption | ✅ |
| 5.0j | DAG cycle detection at insert time | ✅ |
| 5.0k | LLM extraction output schema validation | ✅ |

### 4A — Task State Machine
| # | Task | Status | Source |
|---|---|---|---|
| 5.1 | State enum: `ACTIVE \| BLOCKED \| DRIFT \| DONE` | ✅ | 1.txt §2.1 |
| 5.2 | State transition rules (deterministic) | ✅ | 1.txt §2.1 |
| 5.3 | State derived from signals (never stored as source) | ✅ | 1.txt §2.1 |
| 5.4 | Drift detection (inactivity + time decay) | ✅ | 1.txt §2.3 |
| 5.5 | DB schema upgrade: Task model with state | ✅ | |

### 4B — Priority System
| # | Task | Status | Source |
|---|---|---|---|
| 5.6 | Signal computation (urgency, inactivity, dependency pressure) | ✅ | 1.txt §4 |
| 5.7 | EMA damping (smooth priority changes) | ✅ | 1.txt §4 |
| 5.8 | Step clamping (prevent wild jumps) | ✅ | 1.txt §4 |
| 5.9 | Context boost (time of day, energy, focus mode) | ✅ | 1.txt §3.3 |
| 5.10 | Critical path boost | ✅ | 1.txt §4 |
| 5.11 | Fanout boost (tasks that unlock many others) | ✅ | 1.txt §4 |
| 5.12 | Priority history storage | ✅ | |

### 4C — Human Reality Layer
| # | Task | Status | Source |
|---|---|---|---|
| 5.13 | Limits Engine (dailyMinutes, maxConcurrentTasks, sessionLimits) | ✅ | 1.txt §3.1 |
| 5.14 | Control Engine (throttle DO_NOW, cooldown enforcement) | ✅ | 1.txt §3.2 |
| 5.15 | Context Engine — basic (timeOfDay, energyLevel, focusMode) | ✅ | 1.txt §3.3 |
| 5.15b | Context Engine — session continuity (session start, tasks since, last break) | ✅ | Gap Analysis |
| 5.15c | Context Engine — device context (platform, isMoving, connection quality) | ✅ | Gap Analysis |
| 5.15d | Context Engine — interruption awareness (recent interrupts, suggest focus) | ✅ | Gap Analysis |

### 4D — Task Manager Output
| # | Task | Status | Source |
|---|---|---|---|
| 5.16 | Output model: `{ doNow[], active[], blocked[], drift[], done[] }` | ✅ | 1.txt §5 |
| 5.17 | Sorting rules (decision score → deadline → priority → depth) | ✅ | 1.txt §5 |
| 5.18 | Task Manager API endpoint | ✅ | |

---

## Phase 5 — Decision, Causality & Execution (5D Engine Part 2)

### 5A — Decision Engine
| # | Task | Status | Source |
|---|---|---|---|
| 6.1 | Decision output: `DO_NOW \| DEFER \| IGNORE` | ✅ | 1.txt §2.4 |
| 6.2 | Decision inputs (state + priority + context + limits) | ✅ | 1.txt §2.4 |
| 6.3 | Decision stabilization (no jitter) | ✅ | 1.txt §3.2 |
| 6.4 | Decision trace logging (every decision stored) | ✅ | 1.txt §6.1 |

### 5B — Causality Graph
| # | Task | Status | Source |
|---|---|---|---|
| 6.5 | Task dependency model (DAG) | ✅ | 1.txt §2.2 |
| 6.6 | Cycle detection (enforce DAG) | ✅ | 1.txt §2.2 |
| 6.7 | Transitive closure computation | ✅ | 1.txt §2.2 |
| 6.8 | Bottleneck detection | ✅ | 1.txt §2.2 |

### 5C — Ripple Propagation
| # | Task | Status | Source |
|---|---|---|---|
| 6.9 | Propagation engine (A completes → B unlocks → C reprioritized) | ✅ | 1.txt §2.5 |
| 6.10 | Batched propagation (max depth 10, max 50 nodes) | ✅ | 1.txt §2.5 + Gap 4 |
| 6.11 | Deterministic ripple (same state → same result) | ✅ | 1.txt §2.5 |

### 5D — Execution Engine (Gap 1)
| # | Task | Status | Source |
|---|---|---|---|
| 6.12 | Command types (NOTIFY_USER, SCHEDULE_TASK, OPEN_CONTEXT, DEFER_TASK, MARK_DONE, ESCALATE) | ✅ | Gap Analysis |
| 6.13 | Execution engine (Command → Side Effect → New Event) | ✅ | Gap Analysis |
| 6.14 | Idempotent execution (safe to retry) | ✅ | Gap Analysis |
| 6.15 | Command retry with exponential backoff (3x) | ✅ | Gap Analysis |
| 6.16 | Failure logging (FAILED status, recovery events) | ✅ | Gap Analysis |
| 6.17 | Closed loop: execution produces new events | ✅ | Gap Analysis |

---

## Phase 6 — Observability (Inspector)

### 6A — Trace & Replay
| # | Task | Status | Source |
|---|---|---|---|
| 7.1 | Trace data model (`{ taskId, ts, state, priority, decision }`) | ✅ | 1.txt §6.1 |
| 7.2 | Trace storage (append-only log) | ✅ | 1.txt §6.1 |
| 7.3 | Replay engine (`replayAt(traces, timestamp)`) | ✅ | 1.txt §6.2 |
| 7.4 | Index traces by taskId | ✅ | 1.txt §9 |
| 7.5 | Binary search for time lookup | ✅ | 1.txt §9 |
| 7.6 | Snapshot memoization | ✅ | 1.txt §9 |

### 6B — Anomaly Detection
| # | Task | Status | Source |
|---|---|---|---|
| 7.7 | Priority spike detection (`abs(current - prev) > 0.5`) | ✅ | 1.txt §2A |
| 7.8 | Oscillation detection (sign flip counting) | ✅ | 1.txt §2B |
| 7.9 | State thrash detection (`ACTIVE → DRIFT → ACTIVE → DRIFT`) | ✅ | 1.txt §2C |
| 7.10 | Auto-mitigation: stronger EMA on spike | ✅ | 1.txt §2 |
| 7.11 | Auto-mitigation: freeze updates on oscillation | ✅ | 1.txt §2 |
| 7.12 | anomaly_events table | ✅ | 1.txt §2 |

### 6C — Inspector UI
| # | Task | Status | Source |
|---|---|---|---|
| 7.13 | Time slider (scrubbable, snap to events) | ✅ | 1.txt §3 |
| 7.14 | Priority graph (line chart + anomaly markers) | ✅ | 1.txt §4 |
| 7.15 | State snapshot view (grouped: DO_NOW/ACTIVE/BLOCKED/DRIFT/DONE) | ✅ | 1.txt §5 |
| 7.16 | Decision trace panel (signals, boosts, reasoning) | ✅ | 1.txt §6 |
| 7.17 | Anomaly overlay (red dots, zig-zag, flashing badges) | ✅ | 1.txt §7 |
| 7.18 | Task Focus mode (inspect one task deeply) | ✅ | 1.txt §10 |
| 7.19 | System View mode (all tasks + anomalies) | ✅ | 1.txt §10 |

### 6D — Transport
| # | Task | Status | Source |
|---|---|---|---|
| 7.20 | WebSocket real-time updates | ✅ | 1.txt §3 |
| 7.21 | SSE fallback (corporate/mobile) | ✅ | 1.txt §3 |
| 7.22 | Hybrid transport class (WS → SSE auto-fallback) | ✅ | 1.txt §3 |

---

## Phase 7 — Intelligence & Learning

| # | Task | Status | Source |
|---|---|---|---|
| 8.1 | Learning Engine (adapt over time) | ✅ | 1.txt §3.4 |
| 8.2 | Completion rate tracking | ✅ | 1.txt §3.4 |
| 8.3 | Time estimation error learning | ✅ | 1.txt §3.4 |
| 8.4 | Behavior pattern detection | ✅ | 1.txt §3.4 |
| 8.5 | Learning → Limits feedback (adjust capacity from history) | ✅ | Gap Analysis |
| 8.6 | Learning → Priority weights (calibrate signal weights) | ✅ | Gap Analysis |
| 8.7 | Learning → Context weighting (which boosts work for user) | ✅ | Gap Analysis |
| 8.8 | Learning → Anomaly thresholds (per-user calibration) | ✅ | Gap Analysis |
| 8.9 | "What-if" simulation layer | ✅ | 1.txt §14 |
| 8.10 | Multi-task correlation view | ✅ | 1.txt §14 |
| 8.11 | Auto anomaly correction (self-healing) | ✅ | 1.txt §14 |
| 8.12 | Cross-source linking | ✅ | BLUF.txt §11 |
| 8.13 | Bootstrap — 3-screen onboarding | ✅ | 1.txt §8 + Gap Analysis |
| 8.14 | Bootstrap — first-day intelligence illusion | ✅ | Gap Analysis |
| 8.15 | Bootstrap — progressive reveal (unlock features over time) | ✅ | Gap Analysis |

---

## Infrastructure & DevOps

| # | Task | Status |
|---|---|---|
| 9.1 | Install Node.js 20+ | ✅ |
| 9.2 | Docker-compose local stack | ✅ |
| 9.3 | Dockerfile | ✅ |
| 9.4 | GitHub Actions CI/CD | ✅ |
| 9.5 | GitHub repo creation | ✅ |
| 9.6 | Railway deployment (staging + prod) | ✅ |
| 9.7 | Cloudflare R2 bucket | ✅ |
| 9.8 | Expo EAS setup | ✅ |
| 9.9 | Sentry integration | ✅ |
| 9.10 | Domain + SSL (`api.flowra.app`) | ✅ |

---

## Testing

| # | Task | Status |
|---|---|---|
| 10.1 | Auth service unit tests | ✅ |
| 10.2 | Entry service unit tests | ✅ |
| 10.3 | State engine unit tests | ✅ |
| 10.4 | AI extraction unit tests (mocked LLM) | ✅ |
| 10.5 | Auth route integration tests | ✅ |
| 10.6 | Entry route integration tests | ✅ |
| 10.7 | User isolation tests | ✅ |
| 10.8 | Mobile component tests (RNTL) | ✅ |
| 10.9 | E2E tests (Detox) | ✅ |
| 10.10 | Load testing (k6) | ✅ |

---

## Grand Summary

| Phase | Description | Total | Done | % |
|---|---|---|---|---|
| **0** | Project Setup | 11 | 11 | 100% |
| **1A** | Server Backend + Normalization | 45 | 45 | 100% |
| **1B** | Mobile App / Web Client | 33 | 33 | 100% |
| **2** | Retention | 8 | 8 | 100% |
| **3** | Connectors | 9 | 9 | 100% |
| **4** | Data Model + Priority + State (5D Pt 1) | 32 | 32 | 100% |
| **5** | Decision + Causality + Execution (5D Pt 2) | 17 | 17 | 100% |
| **6** | Observability (Inspector) | 22 | 22 | 100% |
| **7** | Intelligence + Learning + Bootstrap | 15 | 15 | 100% |
| **Infra** | DevOps | 10 | 10 | 100% |
| **Test** | Testing | 10 | 10 | 100% |
| **TOTAL** | | **212** | **212** | **100%** |
