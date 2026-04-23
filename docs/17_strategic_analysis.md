# ✦ FLOWRA — Strategic & Architectural Analysis

> Not a bug report. Not a task list. This is: **what should be different and why.**

---

## 1. THE FUNDAMENTAL QUESTION NOBODY ASKED

### What is the actual user action loop?

The docs say: `Capture → See → Understand → Adjust → Repeat`

But think about this honestly: **How many times per day will someone open an app to type what they're doing?**

The answer from every productivity app ever built: **almost zero after week 2.**

Journaling apps (Day One, Momento) have this exact problem. High intent at install, usage falls off a cliff. The BLUF.txt even warns: *"this wins only if you aggressively remove scope, not add it"*

### My analysis: Capture is the WRONG entry point.

The MVP should NOT lead with "dump text here." It should lead with **"here's what's going on"** — and THEN prompt capture.

**The correct loop is:**
```
Open app → See your state (what's pending, what's overdue, what happened)
         → React ("oh right, I need to add that meeting outcome")
         → Quick capture
         → State updates instantly
         → Close app
```

State display PULLS the user in. Capture is the response, not the trigger.

**Implication:** The Today View should show state FIRST (top), capture input SECOND (bottom). Not the other way around. The state panel IS the product. Capture is the mechanism.

---

## 2. TECH STACK: IS IT RIGHT?

### 2.1 PostgreSQL — Wrong database for an event-sourced system

The 1.txt vision says: *"event-sourced, deterministic"* — but we're using PostgreSQL with mutable rows.

**Problem:** When Phase 4-6 arrives (traces, replay, causality), we'll be fighting PostgreSQL. Event sourcing needs:
- Append-only event log
- Snapshot materialization
- Temporal queries ("what was state at time T?")

PostgreSQL CAN do this, but it's not built for it.

**Alternatives considered:**

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| **PostgreSQL (current)** | Familiar, Prisma support, good enough for Phase 1-3 | Not event-native, replay requires custom code | ✅ Keep for now |
| **EventStoreDB** | Purpose-built for event sourcing | New dependency, small ecosystem, overkill for MVP | ❌ Too early |
| **PostgreSQL + append-only events table** | Best of both — relational for queries, append-only for events | Custom event projection code needed | ✅ **Recommended for Phase 4** |
| **SQLite (local-first)** | Zero server dependency, works offline, instant | No multi-device sync without extra layer | 🤔 Consider for mobile |

**My recommendation:** Keep PostgreSQL for Phase 1-3. When Phase 4 starts, add an `events` table that's append-only, and build projections (materialized views) for current state. Don't switch databases. Don't add EventStoreDB. Just use PostgreSQL properly.

### 2.2 REST + Polling — Wrong transport for a real-time state system

The current API is pure REST. The mobile app will need to poll for updates. But Flowra's value prop is: **"your state is always current."**

Polling means:
- State is always stale by up to N seconds
- Battery drain on mobile from frequent polling
- Wasted bandwidth when nothing changed

**The right answer:** Server-Sent Events (SSE) for the mobile app. NOT WebSocket (overkill for unidirectional state updates). SSE is:
- Native HTTP (works through proxies)
- One-directional (server → client)
- Auto-reconnect built in
- Low battery impact

**When to add:** Phase 2, not Phase 6. The user experience of "I capture → state updates instantly" requires real-time push.

### 2.3 GPT-4o-mini — Right model, wrong dependency model

Every capture goes through OpenAI. This means:
- **$0.15/1M input tokens + $0.60/1M output** — 100 users × 10 entries/day = ~$1-2/day. Scales linearly.
- **Latency:** 500ms-2s per extraction. User sees stale state until extraction completes.
- **Privacy:** Every user's raw thoughts go to OpenAI's servers.
- **Offline:** Zero functionality without internet.

**Alternatives:**

| Option | Latency | Cost | Privacy | Offline |
|---|---|---|---|---|
| GPT-4o-mini (current) | 500ms-2s | $$/scale | ❌ Sent to OpenAI | ❌ |
| **Local regex + rules** | <10ms | Free | ✅ On-device | ✅ |
| **Small local model (Phi-3-mini, ONNX)** | 100-500ms | Free | ✅ On-device | ✅ |
| **Hybrid: local fast + cloud deep** | 10ms + async 1s | $ | ✅ Fast path local | ✅ Partial |

**My recommendation: Hybrid approach.**
1. **Immediate:** Run simple regex/NLP extraction locally (find dates, @mentions, action verbs like "need to", "blocked on", "finished"). This gives INSTANT state update.
2. **Async:** Send to GPT-4o-mini for deep extraction (sentiment, nuanced action items). Update state when result comes back.
3. **Result:** User sees instant feedback + refined state seconds later. Works offline for the fast path.

This is not in any of the source docs. It should be.

### 2.4 React Native + Expo — Right choice, but consider the alternative

React Native is fine. But:

| Option | Pros | Cons |
|---|---|---|
| **React Native + Expo (current)** | Large ecosystem, Expo simplifies builds, JS across stack | Performance ceiling, large bundle, bridging issues |
| **Flutter** | Better animations, smaller binary, true compiled, hot reload | Dart (different language from server), smaller web story |
| **Native (Swift/Kotlin)** | Best performance, best UX, platform APIs | Two codebases, 2x development time |

**My take:** React Native is correct for this project. Same language as server (JS), Expo handles the painful parts (builds, push notifications, OTA updates), and the UI requirements (text input, lists, cards) don't need Flutter-level animation performance. **Keep it.**

### 2.5 Prisma — Wrong ORM for what's coming

Prisma is great for Phase 1. But:
- **No raw SQL support for tsvector** — We already identified this gap
- **JSON filtering is limited** — Tag queries are awkward
- **No event sourcing support** — append-only patterns need raw queries
- **Migration control is weak** — Can't write custom SQL migrations easily
- **Performance ceiling** — Prisma adds overhead vs raw `pg` driver

**My recommendation:** Keep Prisma for Phase 1-3. When Phase 4 starts, add a raw `pg` pool alongside Prisma for event/trace queries. Don't replace Prisma — supplement it.

---

## 3. ARCHITECTURE: WHAT'S WRONG WITH 6 ENGINES

### The engine architecture is over-abstracted

We have:
```
CortexEngine → NormalizationEngine → ExtractionEngine → StateEngine
                                                           ↓
                                                      RecallEngine
                                                           ↓
                                                    ConnectorEngine
```

**Problem:** This looks enterprise-grade but it's actually:
- **Tightly coupled** — Cortex manually calls each engine in sequence
- **Not event-driven** — It's synchronous orchestration pretending to be modular
- **Hard to test** — Each engine pulls from the DB directly
- **Hard to extend** — Adding a new engine means modifying Cortex

### What it should be: Event Bus

```
Entry Created (event)
  → NormalizationListener handles it
  → Emits "entry.normalized" event
  → ExtractionListener handles it
  → Emits "entry.extracted" event
  → StateListener handles it
  → Emits "state.recomputed" event
```

**Why this is better:**
- Engines don't know about each other
- Adding a new engine = adding a new listener
- Each step can fail independently without blocking others
- Natural audit trail (events = traces for free)
- Replay engine becomes trivial (replay events)

**When to refactor:** Phase 4. Not now. The current Cortex pipeline works fine for Phase 1-3. But the architecture should be PLANNED for event-driven so we don't paint ourselves into a corner.

---

## 4. PRODUCT STRATEGY GAPS

### 4.1 No voice capture — the biggest UX miss

Text capture requires:
1. Open app
2. Find input
3. Type thoughts
4. Submit

Voice capture requires:
1. Hold button
2. Speak
3. Release

For a "dump what's happening" product, **voice is 10x faster.** Every competitor (Otter, Day One, even Apple Notes) supports voice. Flowra doesn't even have it on the roadmap.

**Add to Phase 2:** Voice capture via Expo speech-to-text → normalize → extract. This single feature could be the difference between daily usage and abandonment.

### 4.2 No widget — the real capture UX

On iOS/Android, users live on their home screen. Opening an app is friction. A **home screen widget** with:
- Today's state (3 numbers: open, done, blocked)
- Quick capture button (one tap → text input or voice)
- Tap widget → opens full app

This is how Apple Reminders, Things 3, and Todoist drive daily engagement. It's not Phase 1, but it should be Phase 2.

### 4.3 Monetization model undefined

The docs never mention money. This matters because:
- OpenAI costs scale with users
- S3 storage costs scale with files
- Server costs scale with compute

**Options:**

| Model | Price Point | Risk |
|---|---|---|
| **Freemium** (10 entries/day free, unlimited paid) | $5-8/month | Free tier costs money, conversion rates low |
| **Free forever** (paid for connectors + advanced AI) | $10/month for Pro | Core product stays free, moat builds faster |
| **One-time purchase** (mobile app) | $15-20 | No recurring revenue, can't fund server costs |
| **Usage-based** (pay per AI extraction) | ~$0.01/extraction | Complex billing, user friction |

**My recommendation:** Free core (capture + timeline + basic state). Paid Pro ($8/month) for: recall, connectors, weekly digest, export. This funds OpenAI costs from paying users only.

### 4.4 No onboarding thinking

The bootstrap section says "3-screen onboarding" but doesn't address the real problem:

**Flowra is worthless on Day 1.** It knows nothing about you. The state panel is empty. Recall has no data. The user sees an empty app and thinks "this is just a notes app."

**What needs to happen:**
1. **Guided first capture:** "Tell me what you're working on right now" → extract → show state → user thinks "oh, it understood me"
2. **Seed with existing data:** Import from existing apps (Google Tasks, Apple Reminders) during onboarding
3. **Show value in 60 seconds:** First capture → instant state panel → "You have 2 action items and 1 deadline"

### 4.5 Privacy is a product feature, not a technical detail

The PII stripping in ExtractionEngine removes emails/phones before sending to OpenAI. Good. But the user doesn't KNOW this.

**Privacy should be visible:**
- Show "Your data is processed locally first" in onboarding
- Show "Sending to AI for deep analysis..." indicator (opt-in per entry?)
- Offer "local-only mode" for sensitive entries
- This is a DIFFERENTIATOR. Most apps don't tell you where your data goes.

---

## 5. WHAT NOBODY MENTIONED

### 5.1 Time zones

The entire codebase uses `new Date()` which is server time. Users in different time zones will see entries on wrong days. `DailyState` aggregation will be wrong. This is a fundamental data integrity issue, not a cosmetic bug.

**Fix:** Store user timezone in profile. All date queries must be timezone-aware. `DailyState` must be computed per-user timezone.

### 5.2 Search is the wrong paradigm for recall

Currently: user types text → LIKE query or LLM search.

But the real question users ask isn't "search for X" — it's:
- "What happened with the Rajesh thing?"
- "What am I forgetting?"
- "What changed since yesterday?"

These are **temporal and relational queries**, not text search. The recall engine should:
1. Build an **embedding index** of all entries (vector search)
2. Support **temporal reasoning** ("since yesterday", "last week")
3. Support **entity tracking** ("Rajesh" appears in 5 entries → build a Rajesh context)

Vector embeddings (OpenAI ada-002 or local sentence-transformers) would make recall dramatically better than keyword search.

### 5.3 The "entry" model is too flat

Everything is an "entry" with raw text. But the user's mental model has types:
- "I just finished X" → completion
- "I need to do X" → action item
- "I'm stuck on X" → blocker
- "Meeting with Y about Z" → event

Right now the LLM infers these post-hoc from raw text. But what if the capture UI had **quick-action buttons**?
- ✅ Done (pre-tagged as completion)
- 📋 Todo (pre-tagged as action item)
- 🚫 Blocked (pre-tagged as blocker)
- 💬 Note (general text)

This gives INSTANT state updates without waiting for AI, AND makes extraction more accurate (known intent + AI extraction).

### 5.4 No concept of "projects" or grouping

Real life has projects: "Flowra app", "client work", "personal". The tag system is too flat. Users need to see state PER project, not just globally.

This doesn't need to be complex — just a `project` field on entries, and state aggregation per project.

### 5.5 Carry-over logic is naive

The StateEngine detects carry-overs by looking at action items from yesterday. But:
- What about items from 5 days ago that are still open?
- What about items that were implicitly resolved (user stopped mentioning them)?
- What about items that escalated (mentioned repeatedly with increasing frustration)?

This needs a proper **item lifecycle** — not just "was it mentioned yesterday?"

---

## 6. RECOMMENDED PRIORITY REORDER

Based on everything above, here's what I'd actually build:

### Immediate (before any mobile code):
1. Fix the 6 critical bugs (auth throw, morgan, schema, shutdown, etc.)
2. Add timezone support to user model and all date queries
3. Add quick-action capture types (done/todo/blocked/note) to entry schema

### Phase 1B (Mobile — design-first):
1. **Generate actual screen mockups** before writing code
2. Lead with state panel, not capture input
3. Add voice capture from day one
4. Build onboarding that shows value in 60 seconds

### Phase 2 (what actually drives retention):
1. SSE for real-time state push (not polling)
2. Home screen widget
3. Hybrid AI (local fast + cloud deep)
4. Project grouping

### Phase 4+ (engine evolution):
1. Append-only events table alongside current models
2. Event bus replacing Cortex orchestration
3. Vector embeddings for recall
4. Entity tracking (people, projects mentioned across entries)
