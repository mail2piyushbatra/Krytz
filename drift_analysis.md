# ✦ Flowra — Vision vs. Build Drift Analysis

## What Flowra Was Supposed To Be

From the chats and PRD, the **core product identity** is crystal clear:

> **"I dump things here and it tells me what's going on in my life."**
> — PRD §1

The product loop is:

```
Capture → Timeline → State Inference → Insight → Action
   ↑                                              |
   └──────────────── Repeat ───────────────────────┘
```

From `gpt-4.txt`, the refined identity evolved to:

> **"Personal Operations Command Center"**
> — Not a task manager. A decision-first executive system.

The core screens should be:

| # | Screen | Purpose | Frequency |
|---|--------|---------|-----------|
| 1 | **Command Center** (Today) | What matters right now + next moves | Every session |
| 2 | **Capture** | Zero-friction input (text, voice, files) | Multiple/day |
| 3 | **Task Intelligence** | Deep view of one item + history + impact | On demand |
| 4 | **Decision Explainer** | Why system chose this priority | Trust building |
| 5 | **Search / All Tasks** | User override — "find anything anytime" | Weekly |
| 6 | **Timeline / History** | Audit trail of decisions + captures | Weekly |
| 7 | **Settings** | Privacy, AI control, export | Rare |

## Where The Build Drifted

### ❌ Drift 1: Over-engineered backend, under-built core loop

The backend has **11 intelligence subsystems** (Cortex, DAG executor, rule DSL, RL policy optimizer, contradiction detector, etc.) but the primary user-facing flow — **"I type a thing → I see it as a todo/action item → I mark it done"** — is incomplete.

**What a user actually wants on Day 1:**
```
Type "buy milk" → see it in my list → tap done → gone
```

**What the current system does:**
```
Type "buy milk" → entry saved → Cortex queues async DAG → normalize → extract → 
store extracted_state → recompute daily state → ... user sees a timeline entry, 
not a clear action item they can check off
```

### ❌ Drift 2: "Entries" vs. "Items" — the identity crisis

The codebase has **two data models** that should be one user-facing concept:

| Model | Table | What it is | User sees it as |
|-------|-------|------------|-----------------|
| **Entry** | `entries` | Raw text dump | "What I typed" |
| **Item** | `items` | Extracted action item from TSG | "What I need to do" |

The user doesn't think in "entries" and "items." They think: **"things I threw in."**

The current TodayScreen shows `entries` (raw text timeline) but the `items` table (the actual todo ledger) has **no UI surface at all**. The items only exist in the TSG's in-memory graph and (now) the database, but there's no screen that says:

```
☐ Buy milk
☐ Call dentist at 3pm  
☐ Review PR #42
☑ Deploy staging fix  ← done
```

### ❌ Drift 3: Command Center ≠ Timeline

From `gpt-4.txt`:
> **Command Center** = Situational awareness + decision trigger
> - PrimaryDirective (ONE thing)
> - CriticalSignals (blockers / deadlines)
> - ExecutionQueue (next 3 moves)

What TodayScreen actually shows:
- A capture input
- A timeline of raw entries
- Some stats

This is a **journal**, not a **command center**.

### ❌ Drift 4: No quick actions on items

From `gpt-4.txt` — Quick Action Overlay:
```
QuickActions = [done, snooze, break_into_subtasks, mark_blocker, reschedule]
```

Currently: zero quick actions. No swipe-to-done. No snooze. No mark-as-blocker.

## What's Actually Working (Keep This)

| Component | Status | Value |
|-----------|--------|-------|
| Capture input + file upload | ✅ | Core loop entry point |
| Extraction engine (local + LLM) | ✅ | Converts dumps → structured state |
| TSG (now DB-backed) | ✅ | Item lifecycle + confidence |
| `items` + `item_events` tables | ✅ | Persistent todo ledger exists in schema |
| Plan engine | ✅ | Can generate "what to focus on" |
| Daily state aggregation | ✅ | Knows open/blocked/done counts |
| Recall engine | ✅ | "What did I do last week?" |
| Auth + JWT | ✅ | Working |
| Dual-mode capture (todo + brain dump) | ✅ | Just implemented |

## Realignment Plan

### Phase A: Make the todo ledger visible (Critical — Day 1 value)

> [!IMPORTANT]
> The `items` table already exists and the TSG already populates it. The **only** missing piece is a UI that shows items as checkable todos and API endpoints to manage them.

**1. Items API** (`/api/v1/items`)
- `GET /items` — list user's open/in-progress items (sorted by priority)
- `GET /items?state=done` — completed items
- `PATCH /items/:id` — mark done, snooze, edit text, change state
- `POST /items` — create a direct todo (bypasses extraction, creates item directly)

**2. Today Screen redesign** — Command Center mode:
```
┌─────────────────────────────────────┐
│  ✦ Today — Tuesday, Apr 26          │
│                                      │
│  ┌── FOCUS ─────────────────────┐   │
│  │ Review PR #42                 │   │ ← primary directive (highest priority item)
│  │ Due: today · Confidence: 0.8  │   │
│  └──────────────────────────────┘   │
│                                      │
│  ── NEXT UP ──                       │
│  ☐ Call dentist at 3pm               │ ← swipe right = done
│  ☐ Buy milk                          │
│  ☐ Deploy staging fix                │
│                                      │
│  ── SIGNALS ──                       │
│  ⚠ 1 blocker · 1 overdue            │
│                                      │
│  ┌──────────────────────────────┐   │
│  │ What's happening?             │   │ ← capture input (always accessible)
│  │ 📎 🎤                         │   │
│  └──────────────────────────────┘   │
│                                      │
│  ── TIMELINE ──                      │
│  10:23  "deployed the fix for..."    │ ← collapsed, scrollable
│  09:15  "meeting with raj about..."  │
└─────────────────────────────────────┘
```

**3. Quick actions on items:**
- Tap checkbox → done
- Swipe right → done
- Swipe left → snooze
- Long press → edit / break down / mark blocker

### Phase B: Unify entries + items in the user's mind

The user should never think about "entries" vs "items." The flow is:

```
User types "buy milk" 
  → Entry created (raw text, source of truth)
  → Extraction runs (local fast-path: implicit todo detected)
  → Item created in TSG + items table
  → Item appears in "NEXT UP" list immediately

User types "had a long meeting with raj about the roadmap, 
            need to follow up on hiring timeline, 
            blocked on budget approval"
  → Entry created
  → Extraction runs (LLM: 1 action item, 1 blocker)
  → 1 Item created: "follow up on hiring timeline"
  → 1 Blocker surfaced: "budget approval"
  → Entry appears in timeline
  → Items appear in NEXT UP / SIGNALS
```

### Phase C: Missing screens from the vision

| Screen | What to build | Maps to |
|--------|--------------|---------|
| **Task Intelligence** | Tap any item → see full history, mentions, confidence, related items | `gpt-4.txt` §4 |
| **Search / All Tasks** | Full-text search over items + entries | `gpt-4.txt` §6 |
| **Decision Explainer** | Tap "why?" on any focus item → see reasoning | `gpt-4.txt` §3 |

### What NOT to build (confirmed out of scope)

- ❌ Connector adapters (Phase 3, no concrete adapters needed for MVP)
- ❌ Calendar view
- ❌ Dashboard with graphs (not the product)
- ❌ Team features
- ❌ Voice input (Phase 2)

## Summary: The One Sentence

**Flowra drifted from "todo ledger that understands you" to "intelligence engine with a text box."**

The intelligence engine is built and works. The todo ledger surface — the thing users actually see and interact with — needs to be pulled to the front. The `items` table, TSG, and extraction pipeline are all ready. What's missing is the **Items API** and a **Command Center UI** that shows items as checkable, actionable todos.
