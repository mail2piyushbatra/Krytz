# Krytz: The Autonomous Intelligence Pipeline & Task State Graph
*Engineering Whitepaper v3.0*

---

## 1. Executive Summary

Krytz (formerly Flowra) is an agentic, state-aware personal capture and task execution system. Unlike traditional "todo apps" that act as static databases of unchecked boxes, Krytz operates as a continuous intelligence pipeline. It ingests unstructured human thought (text, voice, files), normalizes the data, extracts structured semantic action items via Large Language Models (LLMs), and manages their lifecycle through a Temporal State Graph (TSG).

The system is designed to combat "task debt" by applying autonomous priority scoring, auto-categorization heuristics, and drift alerts (stale item detection). It represents a shift from *manual organization* to *automated orchestration*.

## 2. Core Engineering Philosophy

Traditional task managers fail because they require humans to maintain the metadata (categories, priority, links). Krytz shifts this burden to the machine using the following primitives:

- **Frictionless Capture:** Ingest first, organize later. The user dumps raw context.
- **The Intelligence Pipeline:** An asynchronous, event-driven engine (Cortex) that runs background extraction using OpenAI (GPT-4o-mini).
- **Temporal State Graph (TSG):** Tasks are not rows; they are nodes in a directed graph. The system tracks state transitions (OPEN → IN_PROGRESS → DONE) with timestamps and confidence scores, providing an auditable history of execution.
- **Semantic Vector Memory:** Every task is embedded using OpenAI `text-embedding-3-small` and stored in `pgvector`. This enables semantic deduplication, similarity matching, and intelligent context retrieval.

## 3. System Architecture

Krytz utilizes a decoupled, resilient microservices architecture orchestrated via Docker.

### 3.1 Client Layer (PWA)
- **Framework:** React + Vite
- **Deployment:** Progressive Web App (PWA) with offline-first capabilities (Service Worker), manifest integration, and mobile installation.
- **Styling:** Premium, glassmorphic UI with micro-animations. Vanilla CSS for strict control over performance and aesthetics.

### 3.2 Backend Infrastructure
- **API Server (Express.js):** REST API handling auth (JWT), sync, and direct client queries.
- **Extraction Worker (Node.js):** Background daemon consuming the `ingestion-queue`.
- **Database (PostgreSQL 16 + pgvector):** The source of truth. Handles relational data and high-dimensional vector search.
- **Message Broker (Redis + BullMQ):** Durable queue management for asynchronous AI tasks.
- **Object Storage (MinIO / S3):** Scalable storage for file attachments (images, PDFs) associated with captures.

## 4. The Intelligence Pipeline

The heartbeat of Krytz is its extraction pipeline, powered by the **Cortex Engine**.

### Phase 1: Ingestion & Normalization
User input hits the API and is instantly written to the `entries` table. A job is pushed to BullMQ. The API responds immediately (low latency), decoupling user interaction from AI processing.

### Phase 2: Extraction (LLM + Fast-Path)
The Worker picks up the job. If the input is explicitly a `todo`, it takes a local fast-path. If it's a `capture`, the system queries the LLM to extract:
- Action Items
- Deadlines
- Blockers
- Tags & Sentiment

### Phase 3: Auto-Categorization & Priority Scoring
Before an item enters the TSG, Krytz applies rule-based heuristics:
- **Categorization:** Maps extracted text against seeded dictionaries (`work`, `personal`, `health`, `errands`, `learning`). "Buy groceries" automatically maps to `errands`.
- **Priority Scoring (0.0 - 1.0):** Dynamically computed based on urgency keywords ("ASAP", "urgent"), deadline proximity, and blocker status.

### Phase 4: Hydration & TSG Insertion
The item is upserted into the TSG. `item_events` are logged for traceability. `extracted_states` are persisted for auditing.

## 5. Data Model & Persistence

The platform utilizes ~33 tables across 5 distinct storage layers to ensure reliability.

### The 5 Storage Layers:
1. **PostgreSQL (pgvector):** Persistent relational and vector data.
2. **Redis:** BullMQ jobs (pending/failed extractions) and lock management.
3. **MinIO (S3):** Immutable object storage for user media.
4. **In-Memory (Worker):** TSG graph hydration, extraction caching (SHA-256), and circuit breakers.
5. **Browser (Client):** JWT tokens, Service Worker cache.

### Key Data Entities:
- **Entries:** The raw, immutable human input.
- **Items:** The synthesized task nodes.
- **Item_Events:** State transition logs.
- **Extracted_States:** The JSON output from the AI models.

## 6. Observability & Drift Management

Task debt is managed actively by the system:
- **Drift Alerts:** The UI highlights tasks that have remained stagnant for >7 days.
- **Task Detail Drill-down:** Users can view the exact state history, confidence scores, and origin entries of any item.
- **Observability:** Centralized logging, metric collection, and distributed tracing ensure the background worker pipeline remains healthy.

## 7. Future Roadmap (V3)
- **Agentic Task Execution:** Moving beyond tracking to actual autonomous execution of API-driven tasks.
- **Advanced Graph Visualization:** Implementing `react-flow` to visualize the TSG and complex dependency chains (SPRE formulation).
- **Long-Term Autobiographical Memory:** Enhancing the `episodic_memory` tables to generate weekly insights into user performance and focus degradation.

---
*Generated by Krytz Intelligence Core*
