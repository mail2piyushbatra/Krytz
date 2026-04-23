# Flowra — User Journey Map

> **Version:** 1.0 | **Date:** April 2026

---

## 1. Journey Overview

```
Discovery → Install → Onboard → First Capture → Habit Loop → Retention → Expansion
   Day -1     Day 0    Day 0     Day 0-1       Day 2-7     Day 8-30    Day 30+
```

---

## 2. Day 0: Discovery & Install

### How They Find Us

| Channel | Message | CTA |
|---|---|---|
| App Store search | "personal tracker", "life organizer" | Install |
| Product Hunt | "Flowra: Stop organizing. Start knowing." | Get it |
| Twitter/X | "I just dump things in Flowra and it tells me what's going on" | Link |
| Word of mouth | "You NEED to try this app" | Search for it |

### App Store Listing

```
Title: Flowra — Your Life, Reconstructed
Subtitle: Dump everything. See your state.

Description:
Stop organizing your life. Start knowing what's going on.

Flowra is the world's simplest personal tracker. Just dump 
what you're doing, thinking, or working on — and Flowra 
tells you what needs attention.

✦ Capture anything in seconds
✦ See your day at a glance
✦ Know what's pending, blocked, or done
✦ Ask "what did I do last week?" and get answers

No folders. No tags. No setup. Just clarity.
```

---

## 3. Day 0: Onboarding (< 60 seconds)

### Flow: 3 screens max, then capture

```
Screen 1: Welcome
┌─────────────────────────┐
│                         │
│      ✦ flowra           │
│                         │
│  Your life,             │
│  reconstructed.         │
│                         │
│  Dump what's happening. │
│  We'll handle the rest. │
│                         │
│  [Get Started →]        │
│                         │
└─────────────────────────┘

Screen 2: Sign Up (minimal)
┌─────────────────────────┐
│                         │
│  Create your account    │
│                         │
│  [Email          ]      │
│  [Password       ]      │
│                         │
│  [Continue →]           │
│                         │
│  Already have an        │
│  account? Log in        │
│                         │
└─────────────────────────┘

Screen 3: First Capture (IMMEDIATE VALUE)
┌─────────────────────────┐
│                         │
│  What's on your mind    │
│  right now?             │
│                         │
│  ┌───────────────────┐  │
│  │ Type anything...  │  │
│  │                   │  │
│  │                   │  │
│  │           [Done]  │  │
│  └───────────────────┘  │
│                         │
│  Try: "Had call with    │
│  team. Need to review   │
│  the proposal by        │
│  Friday."               │
│                         │
└─────────────────────────┘

→ After submit → lands on Today View with their first entry + extracted state
```

### Key Principles

| Principle | Implementation |
|---|---|
| **No tutorial** | The app should be self-explanatory |
| **Immediate value** | First capture happens during onboarding |
| **Show extraction** | After first capture, show the extracted action items/deadlines |
| **"Aha moment"** | User sees: "Oh, it understood my entry and pulled out what matters" |

---

## 4. Day 1–3: Activation

### Goal: 3+ captures on Day 1

**Strategy: Gentle prompts, not nagging**

| Trigger | Action | Time |
|---|---|---|
| 3 hours after signup, no 2nd capture | Push: "Anything new happening? Quick capture →" | Afternoon |
| Morning of Day 2 | Push: "Good morning. What's on today?" | 9:00 AM |
| End of Day 1 | In-app: Show daily state summary (even with 1 entry) | Evening |

### What User Experiences

```
Day 1 Morning:
  → Opens app, captures: "Starting on the auth feature today"
  → Sees state: 🟡 1 item in progress
  → Captures: "Blocked — need API docs from Rajesh"
  → Sees state update: 🟡 1 blocker added

Day 1 Evening:
  → Captures: "Got the docs. Finished auth login endpoint."
  → Sees: 🟢 1 completed, 🟡 blocker resolved
  → State panel shows: "Productive day — 1 item done, blocker cleared"
  → User thinks: "Huh, that's actually useful"

Day 2 Morning:
  → Opens app, sees yesterday's carry-over
  → State: "1 item still in progress (auth feature)"
  → Captures today's plan
  → Pattern forming: dump → check state → dump more
```

---

## 5. Day 4–7: Habit Formation

### Goal: User opens app daily without prompts

**What Hooks Them:**

| Hook | Mechanism |
|---|---|
| **Morning check** | "What carried over from yesterday?" |
| **Quick dump** | < 5 seconds to capture a thought |
| **State awareness** | "I have 3 things pending" — visible at a glance |
| **End-of-day closure** | Mark things done, see daily summary |

### Retention Triggers

```
If user misses a day:
  → Day+1 morning: "Yesterday was quiet. What's happening today?"
  → No more pushes until they return
  → NEVER: "You broke your streak!" (no gamification)

If user is active:
  → No pushes needed
  → In-app: "4-day streak of captures" (subtle, not prominent)
```

---

## 6. Day 8–14: Value Discovery

### Goal: User discovers Recall + patterns

**Nudges:**

| Day | Nudge | Purpose |
|---|---|---|
| Day 8 | "You've captured 20 entries. Try asking: 'What did I do this week?'" | Introduce Recall |
| Day 10 | Show weekly digest for the first time | Show pattern value |
| Day 12 | "You had 3 blockers this week. 2 resolved." | Show state intelligence |

### What User Discovers

```
Week 2:
  → User tries Recall: "What meetings did I have?"
  → Gets accurate answer from their own data
  → User thinks: "This actually knows what I've been doing"
  
  → Weekly digest arrives:
    "This week: 8 items completed, 2 pending, 1 blocker 
     (OAuth docs — open since Monday). 
     You tend to capture most in the morning."
  → User thinks: "This is like having a personal assistant"
```

---

## 7. Day 15–30: Retention & Deepening

### Goal: Flowra becomes default "dump" destination

**Indicators of Retention:**

| Signal | Healthy | At Risk |
|---|---|---|
| Daily captures | ≥ 2/day | < 1/day |
| State views | ≥ 1/day | 0/day |
| Recall queries | ≥ 1/week | 0/week |
| Session length | 30–120s | < 10s |

### Features That Unlock

| Day | Feature | Why Now |
|---|---|---|
| Day 15 | File uploads tutorial | "You can attach photos and PDFs too" |
| Day 20 | Data export option | Build trust |
| Day 25 | "Try dark/light mode" | Personalization |
| Day 30 | Pro upgrade prompt (if free) | Proven value |

---

## 8. Day 30–90: Power User

### What Power Users Do

```
Morning:
  → Open Flowra (habit)
  → Check state: "2 carry-overs, 1 deadline today"
  → Capture morning plan

Throughout day:
  → Quick captures after meetings, calls, work blocks
  → Attach photos of whiteboard drawings
  → Upload PDF of contract for extraction

Evening:
  → Check state: "5 done, 2 pending"
  → Capture any loose ends

Weekly:
  → Review weekly digest
  → Use Recall: "What did I promise the client?"
  → Plan next week based on patterns

Monthly:
  → Notice patterns: "I always forget Friday follow-ups"
  → Trust the system fully
```

---

## 9. Churn Prevention

### Warning Signals

| Signal | Days Inactive | Response |
|---|---|---|
| 🟡 Light churn risk | 2 days | Single gentle push notification |
| 🟠 Medium churn risk | 5 days | Push: "Your last capture was Monday. Quick update?" |
| 🔴 High churn risk | 10+ days | Email: "Your data is safe. Come back anytime." |
| ⚫ Churned | 30+ days | Monthly email (max 2): "Still here when you need us." |

### Re-engagement

```
When user returns after absence:
  → Don't guilt them ("You've been away for 5 days!")
  → Welcome back warmly: "Welcome back. What's happening?"
  → Show last state: "When you left, you had 2 pending items"
  → Let them pick up naturally
```

---

## 10. Success Metrics by Stage

| Stage | Metric | Target |
|---|---|---|
| **Install → Signup** | Conversion | > 60% |
| **Signup → First Capture** | Activation | > 80% (during onboarding) |
| **Day 1** | Captures | ≥ 3 |
| **Day 1 → Day 2** | Return rate | > 50% |
| **Day 7** | Retention | > 40% |
| **Day 14** | Recall usage | > 30% of active users |
| **Day 30** | Retention | > 25% |
| **Day 30** | Pro conversion | > 5% of active |

---

## 11. Empty States (Critical UX)

| State | Message | Action |
|---|---|---|
| First ever open | "Your day is a blank page. What's happening?" | Focus capture input |
| No entries today | "Nothing captured yet today. What's going on?" | Focus capture input |
| No state data | Counts show "–" with "Capture something to see your state" | — |
| Recall, no data | "I need more entries to answer that. Keep capturing!" | — |
| Recall, no match | "I couldn't find anything about that in your entries." | Suggest rephrase |
