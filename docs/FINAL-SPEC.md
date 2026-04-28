# FLOWRA — FINAL COMPLETE SPECIFICATION
**Single source of truth. All 14 surfaces + all gaps resolved.**
**Version 1.0 — Locked**

---

## WHAT THIS IS

This document is the complete, final specification for the Flowra frontend.
Every surface is specced. Every ambiguity is resolved. Every gap is filled.
Build from this. No verbal instructions. No side-channel decisions.

---

## PRODUCT IDENTITY

```
Name:         Flowra
Category:     Personal Operations Command Center
NOT:          Task manager, todo app, notes app
IS:           System that computes what matters → tells you what to do → you execute

Core loop:    Capture → System computes → User executes
Key insight:  System presents decisions. User does not manage tasks.
```

---

## SURFACE MAP (ALL 14)

```
CORE SCREENS (daily use)
  SU-UI-001   Command Center       Default screen. One directive. Execute.
  SU-UI-002   Rapid Capture        Bottom sheet. Instant. No friction.
  SU-UI-003   Task Intelligence    Full depth on one item.
  SU-UI-004   Decision Explainer   Why this? Briefing, not explanation.

SUPPORT SCREENS (medium frequency)
  SU-UI-005   Strategic View       Weekly goals. Load. Commitments.
  SU-UI-006   Timeline             History. Feedback. Patterns.
  SU-UI-007   Search               Find anything. Ask anything.

SYSTEM SCREENS (low frequency)
  SU-UI-008   Settings             Control. AI on/off. Data. Account.
  SU-UI-009   Onboarding           3 screens. One-time. First capture.

POWER OVERLAYS (on demand)
  SU-UI-OV01  Quick Actions        Long press → all actions.
  SU-UI-OV02  Subtask Breakdown    Vague task → concrete steps.
  SU-UI-OV03  Blocker Panel        Stuck → system helps.
  SU-UI-OV04  Smart Reschedule     Snooze intelligently.
  SU-UI-OV05  Command Palette      Everything in one keystroke.

RECOVERED GAPS
  SU-UI-AUTH-RESET     Password reset flow
  SU-UI-AUTH-EXPIRY    Token expiry mid-session
  SU-UI-EDIT           Item edit (inline, Task Intelligence)
  SU-UI-ERROR-RECOVERY Action failure recovery
  SU-UI-NOTIFICATIONS  Notifications panel (bell icon)
  SU-UI-OFFLINE        Offline state + capture queue
  SU-UI-MULTI-CAPTURE  Paste list → split into items
```

---

## NAVIGATION MODEL (LOCKED)

```
DEFAULT SCREEN:    Command Center (SU-UI-001)

TAB BAR (4 tabs, always visible):
  [●] Today (grid icon)     → Command Center
  [ ] Strategy (compass)    → Strategic View
  [ ] Timeline (clock)      → Timeline
  [ ] Search (search)       → Search

FAB:
  Position:  bottom-right, 16px from edge, 80px from bottom
  Size:      52px circle, var(--accent) fill
  Action:    → Rapid Capture (bottom sheet)
  Gesture:   swipe up from bottom edge (alternative trigger)

SETTINGS:
  Trigger:   avatar/gear icon, top-right of Command Center header
  Not in tab bar (low frequency)

NOTIFICATIONS:
  Trigger:   bell icon, top-right of Command Center header
  Badge:     red dot when unread_count > 0

OVERLAYS:
  Dismiss:   swipe down OR tap backdrop (all overlays)
  Never navigate: overlays close, return to triggering screen

BACK NAVIGATION:
  "←" button (top-left) on all full-screen pushes
  Hardware back (Android) equivalent
  Swipe right from left edge (iOS)
```

---

## GESTURE SYSTEM (LOCKED, NO EXCEPTIONS)

```
GESTURE          TARGET              ACTION
swipe right >80px  any task card      done() immediately
swipe left >80px   any task card      reveal Quick Actions row (96px)
long press 500ms   any task card      Decision Explainer (OV-04)
tap                any task card      Task Intelligence (screen 03)
swipe up           Command Center     Rapid Capture (sheet)
swipe down top     any screen         Command Palette (OV-05)
⌘K                 any screen         Command Palette (OV-05)

CONSISTENCY RULES:
- Same gesture = same action everywhere. No screen-specific overrides.
- Partial swipe (<80px): spring back, no action.
- Haptic: light impact at 500ms long-press threshold (mobile).
```

---

## COMPLETE API MAP

```
AUTH
  POST /api/auth/register        Onboarding screen 3, auth screen
  POST /api/auth/login           Auth screen
  POST /api/auth/refresh         Auto-refresh on 401
  POST /api/auth/reset-request   Password reset step 1
  POST /api/auth/reset-confirm   Password reset step 3
  DELETE /api/auth/me/gdpr       Settings → delete account

CAPTURE + PLAN
  POST /api/capture              Rapid Capture, Command Palette, Onboarding
  GET  /api/plan/today           Command Center (primary load)
  GET  /api/plan/week            Strategic View
  GET  /api/explain/:itemId      Decision Explainer, Task Intelligence panel

ACTIONS
  POST /api/action               All done/snooze/drop from any screen
  POST /api/action/undo          Toast undo button, Timeline restore
  GET  /api/action/history       Timeline, undo history

ITEMS
  PATCH /api/items/:id           Item edit (canonical_text)
  GET  /api/items/:id/estimate   Task Intelligence time estimate zone
  POST /api/items/:id/time       Task Intelligence record actual time

FEEDBACK
  POST /api/feedback             Timeline mark wrong, thumbs up/down

INTELLIGENCE
  GET  /api/contradictions       Command Center signals, Strategic View
  POST /api/contradictions/:id/resolve  Notifications panel, Strategic View
  GET  /api/commitments          Strategic View, Notifications panel
  POST /api/commitments/:id/fulfill    Strategic View, Notifications panel
  POST /api/simulate             Decision Explainer what-if section
  GET  /api/capacity             Command Center risk indicator, Strategic View

NOTIFICATIONS
  GET  /api/notifications        Notifications panel
  POST /api/notifications/:id/read     Notifications panel (tap)
  POST /api/notifications/read-all     Notifications panel header

SEARCH + RECALL
  POST /api/recall               Search screen (Ask mode)

SETTINGS
  GET  /api/stats                Strategic View weekly stats
  PATCH /api/profile             Settings (all preference changes)
  GET  /api/metrics/suggestions  Timeline pattern insight
  GET  /api/metrics/costs        Settings AI usage display

BILLING
  GET  /api/billing/tier         Settings tier badge
  POST /api/billing/checkout     Settings upgrade flow (V2)
```

---

## BUILD ORDER (PHASE-GATED)

```
PHASE 1 — V1 SHIP (build these first)
  Priority:  SU-UI-009 Onboarding      (first impression)
  Priority:  AUTH-RESET                (P0 gap, must exist at launch)
  Priority:  SU-UI-001 Command Center  (primary screen)
  Priority:  SU-UI-002 Rapid Capture   (core action)
  Priority:  SU-UI-004 Decision Explainer (trust)
  Priority:  ERROR-RECOVERY            (P0 gap)
  Priority:  AUTH-EXPIRY               (P0 gap)
  Priority:  OFFLINE                   (P1 gap, before any users)
  With:      SU-UI-NOTIFICATIONS       (bell icon exists, must work)
  With:      SU-UI-EDIT                (overflow menu exists, must work)

PHASE 2 — V1 DEPTH (adds real power)
  SU-UI-003  Task Intelligence
  SU-UI-OV01 Quick Actions
  SU-UI-OV04 Smart Reschedule
  MULTI-CAPTURE
  SU-UI-008  Settings (timezone critical)

PHASE 3 — V2 (after first real user, after phase gate)
  SU-UI-005  Strategic View
  SU-UI-006  Timeline
  SU-UI-007  Search + Recall
  SU-UI-OV02 Subtask Breakdown
  SU-UI-OV03 Blocker Panel
  SU-UI-OV05 Command Palette

V1 PHASE GATE (do not advance to V2 until):
  □ GET /plan/today: p99 < 300ms
  □ POST /capture: p99 < 500ms
  □ Zero crashes in 48h of live use
  □ INV-020 verified: cross-user isolation confirmed
  □ Password reset tested end-to-end
  □ Offline mode tested on real device
  □ 1 real user using it daily
```

---

## GLOBAL CONSTRAINTS (EVERY SURFACE, NO EXCEPTIONS)

```
INVARIANTS
  INV-001  session.user_id never null on authenticated request
  INV-003  auth endpoints never reveal if email exists
  INV-004  auth endpoints rate-limited (10 req/min per IP)
  INV-016  stack traces never in API responses or UI
  INV-020  user never sees another user's data

UI RULES
  max_visible_tasks:     5 (focus 1 + queue 3 + signal 1)
  max_actions_per_surface: 3
  max_factors_in_explainer: 3
  min_tap_target:        44px × 44px
  never_show:            HTTP codes, raw errors, stack traces
  always_show:           empty states (never blank screen)
  loading_state:         skeleton immediately (<16ms), data replaces
  error_state:           human message + retry option

PERFORMANCE
  plan_load:      <300ms (cached), <2s (cold)
  capture_submit: 202 response <200ms
  action_response: <200ms
  animation_fps:  60fps (never drop below 30fps)
  offline:        last cache shown instantly

TRUST RULES (Decision Explainer + Intelligence)
  every_factor:   must map to a real data field
  never_fabricate: if no signals → "Not enough data yet"
  recall_answers:  grounded in user's entries only

DATA
  capture_max:    50000 chars
  item_text_max:  10000 chars (edit)
  multi_capture:  max 10 items per split

ACCESSIBILITY (V2, spec now, implement with V2)
  font_scaling:   all text in relative units (rem)
  touch_targets:  min 44px × 44px
  color_contrast: WCAG AA minimum (4.5:1)
  screen_reader:  all interactive elements have aria-label
  reduce_motion:  @media prefers-reduced-motion: skip animations
```

---

## DESIGN SYSTEM REFERENCE

```
COLORS (full palette in 00-design-system.md)
  --bg:       #F5F4F0 / #141413
  --surface:  #FFFFFF / #1E1E1C
  --accent:   #2D6A4F / #52B788
  --danger:   #C0392B / #E05C4B
  --warn:     #D4821A / #E8943A
  --text:     #1A1A18 / #E8E6DF
  --muted:    #6B6A65 / #8A8982
  --hint:     #A8A7A1 / #555550
  --border:   #E4E2DA / #2E2E2B

TYPOGRAPHY (5 sizes only)
  11px (xs)   uppercase labels, chips, timestamps
  13px (sm)   secondary body, descriptions
  15px (md)   primary body, queue task text
  18px (lg)   sheet titles, screen titles
  22px (xl)   primary directive (focus task)
  28px        onboarding headline only (exception)

WEIGHTS: 400 and 500 only. Never 600+.

GESTURES (locked)
  swipe right:  done
  swipe left:   reveal actions
  long press:   explainer (500ms threshold)
  tap:          task intelligence

ANIMATIONS (full spec in 00-design-system.md)
  fast:    200ms ease-out
  normal:  300ms ease-spring
  done:    card exits right
```

---

## FILES IN THIS SPEC SET

```
00-design-system.md          Tokens, typography, gestures, animations, icons
01-04-core-screens.md        Command Center, Capture, Task Intelligence, Explainer
05-07-support-screens.md     Strategic View, Timeline, Search
08-09-system-screens.md      Settings, Onboarding
OV01-05-power-overlays.md    Quick Actions, Subtask, Blocker, Reschedule, Palette
99-missing-specs-resolved.md P0+P1 gaps, error recovery, offline, notifications
FINAL-SPEC.md                This document (master reference)
```

---

## WHAT IS EXPLICITLY OUT OF SCOPE (V1)

```
❌ Projects screen (projects auto-detected from captures)
❌ Calendar screen (calendar integration V2)
❌ Analytics dashboard (Strategic View is the limit)
❌ Habit tracking (different product)
❌ Finance tracking (different product)
❌ Social / sharing features (V3+)
❌ Push notifications (web push API — V2)
❌ Native mobile app (React Native — V2, PWA first)
❌ Browser extension (V3)
❌ Connector integrations: Gmail, Notion, Slack (V2)
❌ Voice capture (V2)
❌ Export (V2)
❌ Tablet/desktop optimised layout (V2)
```

---

**This is the complete product surface.**
**Not minimal. Not bloated. Exactly right.**
