# ✦ FLOWRA — Product Strategy, SKUs & Suggestions

---

## PART 1: MY CONCRETE SUGGESTIONS

### What to change RIGHT NOW (before writing more code)

#### S1. Flip the UX — State first, capture second

**Current thinking:** User opens app → sees capture box → types → sees state
**My suggestion:** User opens app → sees their state (what's pending, blocked, done today) → taps to capture

**Why:** State is the hook. "You have 3 open items and a deadline Friday" makes you want to interact. An empty text box does not. Every successful dashboard product (Stripe, Linear, Notion homepage) leads with state.

**Impact on code:** Today View screen layout changes. State panel at top, capture at bottom (collapsed, expands on tap). No code rewrite — just design decision before we build mobile.

---

#### S2. Add entry types at capture time

**Current:** Everything is raw text → AI figures out what it means
**My suggestion:** Four quick-action buttons above the text input:

```
[ ✅ Done ]  [ 📋 To Do ]  [ 🚫 Blocked ]  [ 💬 Note ]
```

**Why:**
- Instant state update without waiting for AI (tap "Done" + "finished auth module" → completedCount++ immediately)
- AI extraction becomes VALIDATION, not sole source of truth
- 2-tap capture for simple items vs typing full sentences
- Dramatically better extraction accuracy (known intent + AI)

**Impact on code:** Add `entryType` field to Entry schema (`done | todo | blocked | note | raw`). StateEngine counts types directly. AI still extracts for deeper detail.

---

#### S3. Hybrid AI — local fast + cloud deep

**Current:** Every entry → OpenAI API → wait 1-2s → state updates
**My suggestion:** Two-pass extraction:

```
Pass 1 (instant, local):
  - Regex: dates ("by Friday", "due March 15")
  - Keyword: action verbs ("need to", "have to", "should", "must")
  - Keyword: blockers ("stuck on", "waiting for", "blocked by", "can't")
  - Keyword: completions ("finished", "done", "completed", "shipped")
  - Result: immediate state update in <10ms

Pass 2 (async, cloud):
  - Full GPT-4o-mini extraction
  - Sentiment, nuanced items, tag inference
  - Result: refined state update 1-2s later
```

**Why:** User sees INSTANT feedback. Works offline. Saves money (skip cloud for simple entries). Cloud refines but doesn't block.

**Impact on code:** New `LocalExtractionEngine` with pure JS regex/NLP. Runs in Cortex before cloud call. If confidence is high enough, skip cloud entirely.

---

#### S4. Add voice capture

**My suggestion:** Long-press capture button → speak → release → speech-to-text → normalize → extract

**Why:** Typing "Had a call with Rajesh, he needs the proposal by Friday, I'm blocked on pricing data from finance" takes 20 seconds. Speaking it takes 5. For a "dump your brain" product, voice is 4x faster.

**Impact on code:** Expo Speech-to-Text API. Text result feeds into the existing pipeline. No backend changes. Phase 2 feature.

---

#### S5. Timezone-aware everything

**Current:** All `new Date()` calls use server UTC time. DailyState aggregation, entry grouping, "today" queries — all wrong for non-UTC users.

**My suggestion:** Store `timezone` in User settings. All date boundaries computed per-user timezone. `DailyState` keyed by user's local date.

**Impact on code:** User model gets `timezone` field. StateEngine and entry queries use timezone-adjusted date ranges. Critical fix — do before mobile launch.

---

#### S6. Project/context grouping

**Current:** Entries are a flat stream. Tags exist but are AI-inferred and inconsistent.
**My suggestion:** Optional `project` field on entries. State view filters by project. User creates projects manually ("Work", "Personal", "Flowra App").

**Why:** "You have 5 open items" is less useful than "Work: 3 open, Personal: 2 open, Flowra: 0 — everything done." Projects give structure without complexity.

**Impact on code:** `project` field on Entry. ProjectSetting model for user's project list. State aggregation adds per-project breakdown.

---

#### S7. Vector embeddings for recall

**Current:** Recall uses keyword search + LLM re-reading entries
**My suggestion:** Embed every entry with `text-embedding-3-small` ($0.02/1M tokens). Store embeddings. Recall does cosine similarity search THEN gives top-K entries to LLM.

**Why:** Keyword search misses semantic matches ("busy day" won't match "overwhelmed with meetings"). Embedding search finds meaning. LLM gets better context → better answers. Also enables "related entries" feature for free.

**Impact on code:** Add `embedding Float[]` to Entry schema (or separate table). Embed on ingest. pgvector extension for PostgreSQL. RecallEngine uses vector search as first pass.

---

#### S8. Event bus for engine coordination (Phase 4 prep)

**Current:** Cortex calls engines sequentially
**My suggestion:** Introduce a simple in-process event emitter NOW, even if you don't fully use it. When Phase 4 arrives, you're already event-driven.

```js
// Instead of: cortex.ingestAsync()
// Do: eventBus.emit('entry.created', { entryId, rawText })
// Listeners: normalizer, extractor, stateComputer — all independent
```

**Impact on code:** Replace Cortex orchestration with Node.js EventEmitter. Each engine becomes a listener. Natural audit trail. Prep for trace engine.

---

#### S9. Home screen widget (Phase 2)

**My suggestion:** iOS/Android widget showing:
```
┌─────────────────────┐
│  FLOWRA    Today     │
│  3 open · 1 blocked  │
│  5 done · 1 deadline │
│  [+ Capture]         │
└─────────────────────┘
```

**Why:** The #1 driver of daily engagement in mobile apps. User sees their state 50 times a day glancing at home screen. Doesn't need to open the app. Capture button opens app directly to input.

---

#### S10. Privacy as a feature

**My suggestion:** Show the user exactly what happens to their data:
- Onboarding screen: "Your captures are processed locally first. AI analysis is optional."
- Per-entry indicator: 🔒 Local only / ☁️ AI enhanced
- Settings toggle: "Local-only mode" (disables cloud AI, uses local extraction only)
- This becomes a marketing differentiator

---

## PART 2: PRODUCT SKUs

### Product Line Architecture

```
┌────────────────────────────────────────────────────┐
│                    FLOWRA ECOSYSTEM                  │
│                                                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐          │
│  │  FLOWRA  │  │  FLOWRA  │  │  FLOWRA  │          │
│  │  CORE    │  │  PRO     │  │  API     │          │
│  │ (Free)   │  │ ($8/mo)  │  │ (Usage)  │          │
│  └──────────┘  └──────────┘  └──────────┘          │
│                                                      │
│  ┌──────────────────────────┐                       │
│  │      FLOWRA TEAMS        │                       │
│  │      ($15/seat/mo)       │                       │
│  └──────────────────────────┘                       │
└────────────────────────────────────────────────────┘
```

---

### SKU 1: FLOWRA CORE (Free)

**Target:** Individual users, habit builders, students
**Price:** $0/month forever
**Goal:** Build data moat, drive habit, convert to Pro

| Feature | Included |
|---|---|
| Text capture (manual) | ✅ Unlimited |
| Voice capture | ✅ Unlimited |
| Entry types (done/todo/blocked/note) | ✅ |
| Local AI extraction (instant) | ✅ |
| Cloud AI extraction | ✅ 20/day |
| Timeline view | ✅ |
| Today state panel | ✅ |
| Daily state aggregation | ✅ |
| Dark/Light theme | ✅ |
| Home screen widget | ✅ |
| File attachments | ✅ 3/day, 5MB max |
| Data retention | ✅ 90 days |
| Projects | ✅ Up to 3 |
| Weekly digest | ❌ |
| Recall (AI query) | ❌ |
| Connectors | ❌ |
| Data export | ❌ |
| Inspector (traces) | ❌ |
| Priority engine | ❌ |

**Why this works:** Core capture + state is useful enough to build a daily habit. The 90-day retention limit creates natural upgrade pressure ("upgrade to keep your history"). 20 cloud AI calls/day is plenty for casual use. Local extraction handles the rest.

---

### SKU 2: FLOWRA PRO ($7.99/month or $79/year)

**Target:** Professionals, founders, knowledge workers
**Price:** $7.99/month · $79/year (save 17%)
**Goal:** Revenue driver, power users

| Feature | Included |
|---|---|
| Everything in Core | ✅ |
| Cloud AI extraction | ✅ Unlimited |
| Recall (AI-powered query) | ✅ Unlimited |
| Weekly digest (AI-generated) | ✅ |
| Connectors (Calendar, Gmail, Notion) | ✅ Up to 3 |
| File attachments | ✅ Unlimited, 10MB max |
| Data retention | ✅ Unlimited |
| Projects | ✅ Unlimited |
| Data export (JSON/CSV) | ✅ |
| Vector search (semantic recall) | ✅ |
| Priority engine (Phase 4) | ✅ When available |
| Decision engine (Phase 5) | ✅ When available |
| Inspector UI (Phase 6) | ✅ When available |
| Priority support | ✅ |

**Unit economics at $8/month:**
- OpenAI cost per user: ~$0.50-1.00/month (20 entries/day × $0.001/extraction)
- S3 storage per user: ~$0.05/month
- Server cost per user: ~$0.10/month
- **Margin: ~85%** ✅

---

### SKU 3: FLOWRA API ($0.002/extraction call)

**Target:** Developers, indie hackers, other apps
**Price:** Usage-based, metered
**Goal:** Platform play, ecosystem

| Endpoint | Price |
|---|---|
| `POST /extract` — Extract state from text | $0.002/call |
| `POST /normalize` — Normalize any input to IR | $0.001/call |
| `POST /recall` — Query over provided entries | $0.005/call |
| `POST /prioritize` — Compute priority for tasks | $0.003/call |
| Batch endpoints | 30% discount |
| Free tier | 1,000 calls/month |

**Why this exists:** The extraction + normalization engine is valuable OUTSIDE Flowra. Other apps want "extract action items from text" without building their own LLM pipeline. This is an API product.

**Example customers:**
- Project management tools wanting AI extraction
- CRM tools wanting email action item detection
- Note-taking apps wanting structured state
- Personal productivity apps wanting priority computation

---

### SKU 4: FLOWRA TEAMS ($14.99/seat/month)

**Target:** Small teams (5-50 people), agencies, startups
**Price:** $14.99/seat/month
**Goal:** B2B revenue, higher ARPU

| Feature | Included |
|---|---|
| Everything in Pro | ✅ |
| Shared projects | ✅ |
| Team state dashboard | ✅ "Team has 15 open items, 3 blockers" |
| Visibility controls | ✅ Choose what to share |
| Standup report generation | ✅ "Here's what everyone did yesterday" |
| Admin panel | ✅ |
| SSO (Google Workspace) | ✅ |
| Audit log | ✅ |
| API access for integrations | ✅ 10,000 calls/month included |

**Why this matters:** The standup report alone is worth $15/month. Every team wastes 15 minutes daily on standups. Flowra generates them automatically from captures.

**Timeline:** Phase 3-4. Don't build until individual product is validated.

---

## PART 3: REVENUE MODELING

### Conservative Growth Scenario

| Metric | Month 3 | Month 6 | Month 12 | Month 24 |
|---|---|---|---|---|
| Total users | 500 | 2,000 | 10,000 | 50,000 |
| Free users | 450 | 1,700 | 8,500 | 42,000 |
| Pro users (5% conv) | 50 | 200 | 1,000 | 5,000 |
| API customers | 0 | 5 | 20 | 100 |
| Team seats | 0 | 0 | 50 | 500 |
| **MRR** | **$400** | **$1,700** | **$9,500** | **$50,000** |

### Cost at Scale

| Cost | 1K users | 10K users | 100K users |
|---|---|---|---|
| OpenAI (extraction + recall) | $50/mo | $400/mo | $3,000/mo |
| S3/R2 storage | $5/mo | $40/mo | $300/mo |
| PostgreSQL (managed) | $15/mo | $50/mo | $200/mo |
| Server compute | $20/mo | $100/mo | $500/mo |
| **Total infra** | **$90/mo** | **$590/mo** | **$4,000/mo** |
| **Revenue (5% Pro)** | **$400/mo** | **$4,000/mo** | **$40,000/mo** |
| **Margin** | 78% | 85% | 90% |

---

## PART 4: COMPETITIVE MOAT

### Why Flowra wins over time

```
Month 1:   "It's a nice capture app"
           (Competitors can match this)

Month 6:   "It knows my patterns"
           (Data moat — competitors start from zero)

Month 12:  "It predicts what I should do"
           (Computation moat — requires data + algorithms)

Month 24:  "I can't leave — it IS my operating system"
           (Lock-in — history, patterns, learned weights are non-portable)
```

### Moat layers:

| Layer | What | When | Defensibility |
|---|---|---|---|
| **Data** | User's capture history | Day 1 | Medium — data is portable |
| **State** | Aggregated state model | Month 1 | High — derived, not stored |
| **Patterns** | Learned behavior patterns | Month 3 | Very high — requires months of data |
| **Intelligence** | Priority weights, context calibration | Month 6 | Extremely high — personalized model |

---

## PART 5: GO-TO-MARKET

### Phase 1: Private Beta (Month 1-2)
- 50 users, invite-only
- Free, all features
- Goal: validate capture → state loop, measure retention
- Channel: ProductHunt pre-launch, Twitter/X, indie hacker communities

### Phase 2: Public Launch (Month 3)
- Core (free) + Pro ($8/month)
- Launch on ProductHunt, Hacker News
- Goal: 500 users, 5% Pro conversion
- Content: "I replaced my TODO app with a state engine" blog post

### Phase 3: API Launch (Month 6)
- API product for developers
- Goal: 5 paying API customers
- Channel: dev blogs, API marketplaces, integration partnerships

### Phase 4: Teams (Month 12)
- Teams product for small companies
- Goal: 10 team accounts
- Channel: direct sales, founder communities

---

## SUMMARY: THE 10 SUGGESTIONS RANKED

| # | Suggestion | Impact | Effort | Do When |
|---|---|---|---|---|
| S1 | State-first UX | 🔴 Critical | Low | Before mobile |
| S2 | Entry types (done/todo/blocked) | 🔴 Critical | Low | Now |
| S3 | Hybrid AI (local + cloud) | 🔴 Critical | Medium | Phase 1B |
| S5 | Timezone support | 🔴 Critical | Medium | Now |
| S4 | Voice capture | 🟡 High | Medium | Phase 2 |
| S6 | Projects | 🟡 High | Low | Phase 1B |
| S7 | Vector embeddings for recall | 🟡 High | High | Phase 2 |
| S10 | Privacy as feature | 🟡 High | Low | Phase 1B |
| S9 | Home screen widget | 🟢 Medium | Medium | Phase 2 |
| S8 | Event bus architecture | 🟢 Medium | High | Phase 4 |
