# ✦ FLOWRA — Unified Product Vision

> **Version:** 3.0 | **Date:** April 2026  
> **Sources:** `BLUF.txt` (product focus) + `1.txt` (5D engine) + Gap Analysis (execution, data model, failure modes)

---

## 1. SYSTEM IDENTITY

**Flowra** is a **closed-loop, state-aware personal computation engine** that:

1. **Captures** raw human activity (text, files, external signals)
2. **Computes** structured state, priority, and decisions
3. **Executes** commands based on decisions
4. **Observes** every step for explainability
5. **Learns** from outcomes over time

```
A closed-loop system that computes, acts, and explains reality under constraints.
```

---

## 2. CORE EQUATION (Complete)

```
Input → Normalize → Event → State → Causality → Decision → Command → Execution → Event
                                ↑        ↑           ↑                      │
                              Graph     Time      Context/Limits            │
                                                                            │
                              ← ← ← ← ← ← ← ← ← ← ← ← ← ← ← ← ← ← ←┘
                                          (closed loop: execution produces new events)
```

---

## 3. EXECUTION MODEL (GAP 1 — RESOLVED)

> Without execution, the system is advisory. With it, it's operational.

### Command Types

```
type Command =
  | { type: "NOTIFY_USER", payload: { message, priority, channel } }
  | { type: "SCHEDULE_TASK", payload: { taskId, scheduledAt, duration } }
  | { type: "OPEN_CONTEXT", payload: { taskId, contextData } }
  | { type: "DEFER_TASK", payload: { taskId, deferUntil, reason } }
  | { type: "MARK_DONE", payload: { taskId } }
  | { type: "ESCALATE", payload: { taskId, reason } }
```

### Execution Flow

```
Decision → Command → ExecutionEngine → Side Effect → New Event
                          │
                          ├── Idempotent (safe to retry)
                          ├── Produces events (closed loop)
                          └── Failure → retry or fallback command
```

### Failure Handling

| Failure | Response |
|---|---|
| Command fails to execute | Retry 3x with exponential backoff |
| Command permanently fails | Log failure event, mark command as `FAILED` |
| Side effect partial | Rollback to last consistent state |
| User doesn't respond to notify | Re-escalate after timeout |

---

## 4. CANONICAL DATA MODEL (GAP 2 — RESOLVED)

> Every entity in Flowra extends a single base. No orphan models.

### Base Entity

```
type Entity = {
  id: string          // cuid
  type: "TASK" | "EVENT" | "ENTRY" | "SOURCE" | "TRACE" | "COMMAND"
  userId: string
  createdAt: Date
  updatedAt: Date
}
```

### Core Types

```
type Entry extends Entity {
  type: "ENTRY"
  rawText: string
  source: "manual" | "calendar" | "gmail" | "notion"
  files: FileAttachment[]
  extractedState: ExtractedState
}

type Task extends Entity {
  type: "TASK"
  title: string
  state: "ACTIVE" | "BLOCKED" | "DRIFT" | "DONE"
  priority: number             // EMA-damped
  priorityHistory: number[]
  dependencies: string[]       // task IDs (DAG)
  dueDate: Date | null
  estimatedMinutes: number | null
  signals: {
    urgency: number
    inactivity: number
    dependencyPressure: number
  }
  boosts: {
    context: number
    criticalPath: number
    fanout: number
  }
}

type Event extends Entity {
  type: "EVENT"
  eventType: string            // "STATE_CHANGE" | "PRIORITY_UPDATE" | "DECISION" | "COMMAND_EXECUTED" | "ANOMALY"
  payload: Record<string, any>
  sourceEntityId: string       // what caused this event
}

type Trace extends Entity {
  type: "TRACE"
  taskId: string
  state: string
  priority: number
  decision: string
  signals: Record<string, number>
  boosts: Record<string, number>
  reason: string
}

type Command extends Entity {
  type: "COMMAND"
  commandType: string
  payload: Record<string, any>
  status: "PENDING" | "EXECUTING" | "COMPLETED" | "FAILED"
  result: Record<string, any> | null
  retryCount: number
}
```

### Relationships

```
Entry ──→ ExtractedState (1:1)
Entry ──→ FileAttachment (1:N)
Task  ──→ Task (N:N via dependencies DAG)
Task  ──→ Trace (1:N)
Task  ──→ Event (1:N)
Decision ──→ Command (1:1)
Command ──→ Event (produces)
User  ──→ DailyState (1:N)
```

---

## 5. INPUT NORMALIZATION (GAP 3 — RESOLVED)

> Current normalization is underpowered. Adding validation + ambiguity + correction.

### Full Pipeline

```
Raw Input
  → Schema Validation (reject malformed)
  → Type Detection (text? image? PDF? structured?)
  → Normalization (clean, structure)
  → Ambiguity Detection (is this a task? an event? unclear?)
  → Confidence Score (0.0 → 1.0)
  → IF confidence < threshold → Correction Loop (ask user)
  → IR Output
```

### Ambiguity Detection

```
type NormalizationResult = {
  ir: InternalRepresentation
  confidence: number           // 0.0 - 1.0
  ambiguities: {
    field: string              // "type" | "dueDate" | "taskOrEvent"
    candidates: string[]       // possible interpretations
    resolved: boolean
  }[]
}
```

### Correction Loop

```
IF confidence < 0.6:
  → Queue for user clarification
  → Show: "Did you mean X or Y?"
  → User selects → re-normalize → store

IF confidence >= 0.6:
  → Process automatically
  → User can correct later (edit entry → re-extract)
```

---

## 6. FAILURE & SAFETY MODEL (GAP 4 — RESOLVED)

### Propagation Safety

| Risk | Mitigation |
|---|---|
| Propagation explosion | Max depth: 10 levels. Max affected nodes: 50 per cascade. |
| Priority oscillation | Freeze updates after 5 direction flips in 10 readings. |
| Event corruption | Replay-based recovery from last known-good snapshot. |
| Circular dependencies | DAG enforcement at insert time. Cycle detection rejects. |
| LLM hallucination | Validate extraction output against schema. Reject invalid. |
| S3 file loss | Metadata in DB survives. Entry still works without file. |

### Thresholds

```
MAX_PROPAGATION_DEPTH = 10
MAX_CASCADE_NODES = 50
OSCILLATION_FLIP_LIMIT = 5
OSCILLATION_WINDOW = 10
SPIKE_THRESHOLD = 0.5
EMA_ALPHA_NORMAL = 0.3
EMA_ALPHA_SPIKE = 0.1        // stronger damping during spikes
COOLDOWN_DURATION_MS = 30000  // 30s freeze on oscillation
EXTRACTION_CONFIDENCE_MIN = 0.6
MAX_COMMAND_RETRIES = 3
COMMAND_RETRY_BACKOFF_MS = [1000, 5000, 15000]
```

### Recovery

```
On corruption detected:
  1. Halt propagation
  2. Find last snapshot before corruption (replay engine)
  3. Replay all events from snapshot forward
  4. Verify state consistency
  5. Resume normal operation
  6. Log recovery event for audit
```

---

## 7. SYSTEM BOUNDARIES (GAP 5 — RESOLVED)

### Flowra DOES

| Capability | Phase |
|---|---|
| Capture raw human activity (text, files) | 1 |
| Extract structured state from unstructured input | 1 |
| Show timeline and daily state overview | 1 |
| Answer natural language queries about history | 1 |
| Ingest from external sources (Calendar, Gmail, Notion) | 3 |
| Compute task priority from multiple signals | 4 |
| Determine what to do next (`DO_NOW / DEFER / IGNORE`) | 5 |
| Explain every decision with full trace | 6 |
| Detect anomalies and auto-stabilize | 6 |
| Learn from user behavior patterns | 7 |

### Flowra DOES NOT

| Boundary | Why |
|---|---|
| ❌ Replace calendar/email/task apps | Input sources, not replacements |
| ❌ Store full knowledge base | State reconstruction, not storage |
| ❌ Execute external workflows deeply | Commands are local (notify, schedule, defer) |
| ❌ Full-sync external data | Selective actionable-item ingestion only |
| ❌ Gamify behavior | No streaks, badges, or reward mechanics |
| ❌ General AI chat interface | LLM is processing layer, not product |
| ❌ Multi-user collaboration | Personal OS, not team tool |
| ❌ Document editing/creation | Capture is input, not authoring |

---

## 8. UNDERPOWERED AREAS (PATCHED)

### 8.1 Bootstrap System (Enhanced)

```
Day 0:
  → 3-screen onboarding (welcome → signup → first capture)
  → First capture triggers extraction → immediate "aha" moment
  → Pre-loaded with 3 example categories (work, personal, health)

Day 1-3 (First-Day Intelligence Illusion):
  → Even with 1-3 entries, show state panel with real data
  → Nudge: "Capture 3 things today and I'll show you your state"
  → After 3 entries: show state summary (even if simple)

Day 4-7 (Progressive Reveal):
  → Unlock Recall after 10 entries ("You now have enough data to query")
  → Show first weekly digest after 7 days
  → Suggest connectors after 14 days of consistent use
```

### 8.2 Context Engine (Enhanced)

```
type UserContext = {
  // Basic (Phase 4)
  timeOfDay: "morning" | "afternoon" | "evening" | "night"
  energyLevel: "high" | "medium" | "low"    // user-reported or inferred
  focusMode: boolean

  // Advanced (Phase 6)
  sessionContinuity: {
    currentSessionStart: Date
    tasksSinceSessionStart: number
    lastBreak: Date
  }
  deviceContext: {
    platform: "mobile" | "desktop"
    isMoving: boolean                        // from accelerometer
    connectionQuality: "good" | "poor" | "offline"
  }
  interruptionAwareness: {
    recentInterruptions: number              // in last hour
    suggestFocusMode: boolean
  }
}
```

### 8.3 Learning Engine (What It Affects)

```
Learning feeds back into:
  → Limits Engine: adjust dailyMinutes based on actual capacity
  → Priority weights: increase/decrease signal weights based on accuracy
  → Context weighting: learn which context boosts work for this user
  → Time estimation: calibrate estimates based on actual completion times
  → Anomaly thresholds: adjust spike/oscillation thresholds per user
```

---

## 9. PHASE MAP

| Phase | Description | Core Delivery |
|---|---|---|
| **1** | Capture & State (MVP) | "I dump and see what's going on" |
| **2** | Retention & Polish | "I use it every day" |
| **3** | Connectors | "All my signals in one place" |
| **4** | Priority & State Machine | "It knows what matters" |
| **5** | Decision & Causality + Execution | "It tells me what to do and does it" |
| **6** | Observability & Inspector | "I can debug my decisions" |
| **7** | Intelligence & Learning | "It gets smarter over time" |

---

## 10. THE MOAT

> Your moat is NOT: LLM, integrations, or fancy architecture.  
> It IS: **consistent reconstruction of user activity into a computable, actionable state.**

- Phase 1–3 builds the **data moat** (user history nobody else has)
- Phase 4–5 builds the **computation moat** (intelligence requiring the data)
- Phase 6–7 builds the **cognition moat** (self-improving system nobody can replicate)

---

## 11. FINAL SYSTEM STATE (After All Phases)

```
Layer              Components
─────────────────  ──────────────────────────────
Input              Capture, Connectors, Normalization
Computation        State Machine, Priority, Decision, Causality
Execution          Commands, Side Effects, Closed Loop
Human Alignment    Limits, Control, Context
Observability      Traces, Replay, Anomaly Detection, Inspector
Intelligence       Learning, Patterns, Self-healing
Transport          WebSocket + SSE
```

### Guarantees

| Guarantee | Mechanism |
|---|---|
| **Determinism** | Same inputs → same outputs (event-sourced) |
| **Boundedness** | Never exceeds human capacity (limits engine) |
| **Observability** | Every decision explainable (trace engine) |
| **Stability** | No oscillation / jitter (EMA + anomaly detection) |
| **Consistency** | Event-sourced truth (replay recovery) |
| **Closed-loop** | Execution produces events (feedback cycle) |

---

**END OF UNIFIED VISION v3.0**
