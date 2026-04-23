# Flowra — Product Requirements Document (PRD)

> **Version:** 1.0  
> **Date:** 2026-04-23  
> **Status:** Draft  
> **Source:** BLUF.txt  

---

## 1. Product Vision

**Flowra** is a state-aware personal capture and tracking system.

**One-liner:**  
> "I dump things here and it tells me what's going on in my life."

**What it is:**
- An activity tracker with state inference
- A personal accountability engine
- A "life radar" — always-on awareness of your current state

**What it is NOT:**
- ❌ A knowledge base (Notion, Obsidian)
- ❌ A document management system (Google Drive)
- ❌ A general AI chat (ChatGPT, Claude)
- ❌ A full-sync integration platform (Zapier)

---

## 2. Target User

### Primary Persona: "The Overloaded Builder"

| Attribute | Detail |
|---|---|
| **Who** | Indie developers, freelancers, founders, knowledge workers |
| **Age** | 22–40 |
| **Pain** | Juggles multiple projects/responsibilities, forgets follow-ups, loses track of what happened and what's pending |
| **Current Tools** | Notion (too complex), Todoist (too simple), scattered notes, mental load |
| **Behavior** | Captures sporadically, rarely reviews, drowns in own backlog |
| **Desire** | "I want to know what's going on without having to organize anything" |

### User Stories

1. **As a user**, I want to quickly dump what I'm doing/thinking so I don't lose it
2. **As a user**, I want to capture images, PDFs, and files alongside text
3. **As a user**, I want to see a timeline of everything I captured today
4. **As a user**, I want the system to tell me what needs attention (follow-ups, blockers, deadlines)
5. **As a user**, I want to ask "what did I do last week?" and get a real answer
6. **As a user**, I want a daily overview of my current state without organizing anything
7. **As a user**, I want to use this on my phone — it's where I capture most things

---

## 3. Core Product Loop

```
Capture → Timeline → State Inference → Insight → Action
   ↑                                              |
   └──────────────── Repeat ───────────────────────┘
```

| Step | What Happens |
|---|---|
| **Capture** | User dumps raw text (thoughts, updates, events, tasks) |
| **Timeline** | System stores entries chronologically as ground truth |
| **State Inference** | AI extracts: action items, blockers, completions, deadlines, moods |
| **Insight** | System surfaces: "You have 2 overdue follow-ups", "You've been blocked on X for 3 days" |
| **Action** | User sees, adjusts, captures more |

---

## 4. Feature Set

### Phase 1 — MVP (Weeks 1–3)

| # | Feature | Description | Priority |
|---|---|---|---|
| F1 | **Quick Capture** | Single text input to dump thoughts/updates. Timestamp auto-added. | P0 |
| F2 | **File Capture** | Upload images, PDFs, documents alongside text entries. OCR/AI extraction from files. | P0 |
| F3 | **Timeline View** | Chronological feed of all captures, grouped by day | P0 |
| F4 | **State Extraction** | LLM parses each entry (text + file contents) → extracts action items, blockers, completions, deadlines | P0 |
| F5 | **Daily Overview** | Dashboard showing: open items, blockers, completions, upcoming deadlines | P0 |
| F6 | **Recall / Query** | "What did I do on Monday?" — natural language search over entries | P1 |
| F7 | **Tags / Auto-Labels** | AI auto-tags entries (project, type, urgency) | P1 |

### Phase 2 — Retention (Weeks 4–6)

| # | Feature | Description | Priority |
|---|---|---|---|
| F7 | **Weekly Digest** | Auto-generated weekly summary: done, pending, patterns | P1 |
| F8 | **Streak / Consistency** | Track capture habits, gentle nudges | P2 |
| F9 | **Pin / Star** | User can pin important items to keep them visible | P2 |
| F10 | **Dark Mode** | Essential for daily-driver apps | P1 |

### Phase 3 — Connectors (Weeks 7–10)

| # | Feature | Description | Priority |
|---|---|---|---|
| F11 | **Google Calendar Connector** | Pull today's events → auto-create timeline entries | P2 |
| F12 | **Gmail Connector** | Extract action items from unread emails | P2 |
| F13 | **Notion Connector** | Pull tasks/action items | P3 |
| F14 | **Slash Commands** | `/calendar today`, `/gmail unread` | P3 |

### Phase 4 — Intelligence (Weeks 11+)

| # | Feature | Description | Priority |
|---|---|---|---|
| F15 | **Pattern Detection** | "You always forget follow-ups on Fridays" | P3 |
| F16 | **Cross-Source Linking** | Calendar event + email + task → single context | P3 |
| F17 | **Background Sync** | Opt-in periodic pull from connected sources | P3 |

---

## 5. Success Metrics

| Metric | Target (v1) | Why It Matters |
|---|---|---|
| **Daily Active Captures** | ≥ 3 per user per day | Proves capture habit |
| **Day-7 Retention** | ≥ 40% | Proves value beyond novelty |
| **Query Usage** | ≥ 1 per user per week | Proves recall value |
| **State View Opens** | ≥ 1 per user per day | Proves overview value |

---

## 6. Out of Scope (v1)

- ❌ Team / collaborative features
- ❌ Full email sync
- ❌ Custom workflows / automation
- ❌ Voice input (Phase 2)
- ❌ Public API

> **In Scope (updated):** Mobile app (React Native) and file uploads (images, PDFs) are now v1 features.

---

## 7. Constraints

| Constraint | Detail |
|---|---|
| **Privacy** | All data is user-owned. No sharing. No training on user data. |
| **Performance** | Capture must feel instant (< 200ms perceived). State extraction can be async. |
| **Simplicity** | Every screen must be usable without instructions. If it needs a tutorial, it's wrong. |
| **Cost** | LLM calls should be efficient — batch where possible, cache state extractions. |

---

## 8. Open Questions

1. **Auth model**: Email/password? Google OAuth? Magic link?
2. **Offline support**: Needed for v1?
3. **Data export**: Day 1 requirement or later?
4. **Pricing model**: Free tier + paid? What's the gate?
