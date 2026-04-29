# Krytz: The Autonomous Intelligence Pipeline & Task State Graph
*Engineering Whitepaper v3.0*

---

## 1. Executive Summary

Modern knowledge work is plagued by cognitive overload. Traditional task management applications—often functioning as little more than static digital spreadsheets—exacerbate this issue. They require the user to perform the labor of organization: manually categorizing, prioritizing, linking, and maintaining the state of their action items. When the human fails to maintain this administrative overhead, the system decays into "task debt," becoming a graveyard of unchecked boxes.

**Krytz** (formerly Flowra) represents a paradigm shift from *imperative task management* to *declarative intent capture and autonomous orchestration*. 

Krytz operates as a continuous intelligence pipeline and a personal exocortex. It allows users to frictionlessly ingest unstructured human thought—via raw text brain dumps, voice notes, or file uploads—and relies on an asynchronous background engine to normalize the data, extract structured semantic action items via Large Language Models (LLMs), and manage their lifecycle through a dynamic Temporal State Graph (TSG). By automatically applying heuristic auto-categorization, mathematical priority scoring, and proactive drift alerts (stale item detection), Krytz eliminates the friction of organization.

## 2. Core Engineering Philosophy

The architecture of Krytz is built upon four foundational pillars:

### 2.1 Frictionless Capture (Immutable Ingestion)
The capture interface is entirely decoupled from the organization interface. Users dump raw context into the system as an `Entry`. Entries are immutable, append-only logs of human intent. The system does not ask "what project does this belong to?" or "what is the due date?" at the point of capture. The only goal is zero-latency ingestion.

### 2.2 The Intelligence Pipeline (Cortex Engine)
Organization is a machine problem. Krytz utilizes an asynchronous, event-driven engine named **Cortex**. Cortex runs a continuous background worker that consumes the raw `Entries` from a durable Redis queue (BullMQ). It leverages OpenAI's models (specifically `gpt-4o-mini`) to semantically parse the raw text and extract structured JSON arrays of discrete `Items` (tasks), deadlines, blockers, and entity mentions.

### 2.3 Temporal State Graph (TSG) & Event Sourcing
Tasks in Krytz are not merely database rows; they are nodes in a directed graph. The TSG models the lifecycle of an intent. 
Instead of merely overwriting a status column, Krytz uses event sourcing. Every transition (e.g., `OPEN` → `IN_PROGRESS` → `DONE`) is recorded as an `item_event` with a timestamp, a confidence score, and a reason. This provides a fully auditable cryptographic-style history of execution, allowing the system to understand *how* work gets done over time.

### 2.4 Semantic Vector Memory
To combat duplication and enable intelligent retrieval, every extracted item is embedded using OpenAI's `text-embedding-3-small` model. These 1536-dimensional vectors are stored directly alongside the relational data in PostgreSQL using the `pgvector` extension. This enables semantic deduplication ("Buy milk" is mathematically similar to "Get groceries") and intelligent context retrieval for future AI prompts.

---

## 3. System Architecture

Krytz utilizes a decoupled, resilient microservices architecture orchestrated via Docker Compose, ensuring parity between local development and production environments.

### 3.1 Client Layer (Progressive Web App)
- **Framework & Build:** React 18 powered by Vite for instant Hot Module Replacement (HMR) and optimized rollup bundling.
- **Deployment Mechanics:** Fully configured Progressive Web App (PWA) with a `manifest.json` and a Service Worker, enabling offline-first caching of the application shell and native-like installation on iOS/Android home screens.
- **Styling:** A premium, glassmorphic UI utilizing raw CSS and CSS Variables (Custom Properties) for strict control over theme switching (dark/light), performance, and micro-animations.
- **State Management:** Zustand for lightweight, un-opinionated global state, coupled with localized React Context where necessary.

### 3.2 Backend Infrastructure
The backend is a multi-container Docker stack ensuring isolated execution environments:
- **API Server (Express.js):** A Node.js REST API handling authentication (JWT access/refresh rotation), synchronous CRUD operations, and serving as the gateway for the client.
- **Extraction Worker (Node.js):** A background daemon dedicated entirely to consuming the `ingestion-queue`, executing heavy LLM I/O, and hydrating the database.
- **Database (PostgreSQL 16 + pgvector):** The absolute source of truth. Handles complex relational joins, `pg_trgm` (trigram) text search, and `ivfflat` indexed vector similarity search.
- **Message Broker (Redis + BullMQ):** Provides durable queue management, exponential backoff for failed jobs, and distributed lock management.
- **Object Storage (MinIO / S3):** Scalable, S3-compatible storage for user media (images, PDFs) associated with captures, utilizing pre-signed URLs for secure, temporary access.

---

## 4. The Intelligence Pipeline Deep-Dive

The heartbeat of Krytz is its extraction pipeline, designed for resilience and accuracy.

### Phase 1: Ingestion & Normalization
When a user submits an `Entry`, the Express API validates the payload, immediately writes the raw text to the PostgreSQL `entries` table, and pushes a job ID to the Redis BullMQ `ingestion-queue`. The API responds to the client with a `201 Created` within milliseconds. This decouples the synchronous user interaction from the asynchronous, latency-heavy AI processing.

### Phase 2: Extraction (LLM + Fast-Path)
The Background Worker picks up the job. 
- **Fast-Path:** If the input is explicitly flagged as a `todo` (e.g., inline task creation), the worker bypasses the LLM to save latency and token costs, utilizing a local regex-based normalizer.
- **LLM Path:** For unstructured `captures`, the worker constructs a highly specific prompt instructing the OpenAI API to return a structured JSON schema. The model extracts Action Items, Deadlines, Blockers, Tags, and Sentiment. The system utilizes an in-memory SHA-256 Extraction Cache to prevent duplicate LLM calls for identical inputs.

### Phase 3: Auto-Categorization & Priority Scoring
Before an extracted item is inserted into the Temporal State Graph, Krytz applies deterministic, rule-based heuristics:
- **Auto-Categorization:** The system runs the canonical text through 10 highly-tuned keyword dictionaries representing user buckets (`work`, `personal`, `health`, `errands`, `learning`). For example, detecting "pharmacy", "buy", or "store" automatically maps the item to the `errands` category.
- **Priority Scoring Formulation:** Every item receives a floating-point score between `0.0` and `1.0`. The algorithm boosts the base score (`0.5`) based on the presence of urgency keywords ("ASAP", "urgent", "critical"), the temporal proximity of extracted deadlines, and whether the item is flagged as a blocker.

### Phase 4: Hydration & TSG Insertion
The processed item is upserted into PostgreSQL. The initial creation logs an `item_event` representing the `OPEN` state. The raw LLM JSON output is persisted to the `extracted_states` table for auditability and future fine-tuning. The client, utilizing optimistic polling or WebSockets, reflects the new categorized item.

---

## 5. Data Model & Persistence Strategy

The platform utilizes ~33 tables across 5 distinct storage layers, ensuring data integrity, fast retrieval, and machine-learning readiness.

### 5.1 The 5 Storage Layers:
1. **PostgreSQL (`Krytz2_pgdata`):** The persistent relational database. Stores all user data, event logs, and `vector(1536)` embeddings.
2. **Redis (`Krytz2_redis`):** Ephemeral storage for BullMQ job state (pending, active, completed, failed) and rate-limiting counters.
3. **MinIO (`Krytz2_minio`):** Persistent blob storage for file attachments.
4. **In-Memory (Node.js Heap):** Ephemeral state for TSG graph hydration, the Extraction Cache, and Circuit Breakers (preventing cascading failures if OpenAI is down).
5. **Browser Storage (Client):** `localStorage` for JWT token persistence and the Service Worker Cache Storage for offline asset availability.

### 5.2 Key Relational Domains:
- **Core Domain:** `users`, `entries`, `items`, `categories`.
- **Graph Domain:** `item_edges` (tracks dependencies, e.g., Item A *blocks* Item B), `item_events` (state transitions).
- **Intelligence Domain:** `extracted_states`, `daily_states`, `entities` (extracted people/places), `contradictions`.
- **Memory System:** `episodic_memory` (timestamped context), `semantic_memory` (key-value facts learned about the user).
- **Observability Domain:** `metrics`, `events` (audit log), `traces`, `cost_usage` (tracks daily LLM token spend per user).

---

## 6. Observability & Drift Management

Task debt is not a passive failure; it is an active metric that must be managed. Krytz implements a "Drift Management" system to combat stale data.

- **Staleness Heuristics:** The system continuously compares the `last_seen` or `updated_at` timestamps of `OPEN` items against the current clock.
- **Drift Alerts:** If tasks remain untouched for >7 days, the UI proactively surfaces an amber "Drift Alert" banner on the command center, and flags the individual tasks with a "Stale" badge.
- **Task Detail Drill-down:** Users can click any task to open a glassmorphic modal revealing the mathematical priority score, confidence metrics, and a full chronological timeline of its state transitions (e.g., When was it created? When was it marked IN_PROGRESS?).
- **System Observability:** The Express API and Worker emit structured JSON logs. Endpoints like `GET /health` ensure Docker Swarm or Kubernetes orchestration layers can route traffic securely.

---

## 7. Future Architecture Roadmap (V3)

While the current production build (V2) solidifies the intelligence pipeline, the V3 roadmap focuses on visualization and autonomy:

- **Agentic Task Execution:** Moving beyond passive tracking. If an item is "Schedule a meeting with John", Krytz will utilize external API tool-calling (via OpenAI function calling) to interact with Google Calendar autonomously.
- **Advanced Graph Visualization:** Implementing WebGL or `react-flow` to visually render the TSG. Users will see their tasks as a literal network graph, easily identifying bottlenecks and cluster dependencies.
- **Long-Term Autobiographical Memory (RAG):** Enhancing the `episodic_memory` tables to generate weekly insights. By using Retrieval-Augmented Generation (RAG) against the `pgvector` embeddings, Krytz will be able to answer questions like "What was my main bottleneck last month?"
- **SPRE Formulation:** Full implementation of State-Priority-Resource-Execution logic, allowing the system to calculate the exact critical path of execution for complex, multi-step projects automatically.

---
*Generated by Krytz Intelligence Core — Finalized April 2026*
