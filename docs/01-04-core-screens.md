# FLOWRA — SCREEN SPECS (PART 1)
## Core Screens 01–04
**ASP-GCP Minimal Mode — Locked**

---

# SCREEN 01 — COMMAND CENTER
**The primary screen. Default on launch. Everything else orbits this.**

---

```yaml
unit_id:  SU-UI-001
title:    Command Center
version:  v1
status:   locked

goal: >
  Present one primary directive, three critical signals, and three
  execution moves. User acts within 5 seconds of opening the app.
  System presents decisions. User executes.

# ─── LAYOUT ──────────────────────────────────────────────────
layout:
  structure: vertical_stack
  max_visible_items: 5
  max_actions: 3

  zones:
    - zone: HEADER
      height: fixed_48px
      contents:
        - left:  Flowra wordmark (16px, weight 500)
        - right: date + notification bell icon
      behavior: sticky top, does not scroll

    - zone: PRIMARY_DIRECTIVE
      contents:
        - label: "FOCUS" (10px, uppercase, muted — not "task", not "priority")
        - directive_text: item.canonical_text (20px, weight 500, max 2 lines)
        - signal_row:
            - deadline_chip:  "2d left" | null (red if ≤ 1 day, amber if ≤ 3 days)
            - blocking_chip:  "blocks 3" | null (shown if downstream_open > 0)
            - state_chip:     "in progress" | null (shown if IN_PROGRESS)
        - confidence_bar: thin 2px line, fills left-to-right by confidence score
          show_only_if: confidence < 0.6 (low confidence = system is uncertain)
      behavior:
        tap:        → navigate to Task Intelligence (SU-UI-003)
        long_press: → open Decision Explainer overlay (SU-UI-004)
        swipe_right: → execute done() action, animate card out
        swipe_left:  → open Smart Reschedule overlay (OV-04)

    - zone: EXECUTION_QUEUE
      label: "NEXT" (10px, uppercase, muted)
      max_items: 3
      item_layout:
        - item_text: (15px, weight 400, single line, truncate at 85%)
        - right_side: deadline_chip | blocking_chip (one only, highest priority)
      behavior:
        tap:        → navigate to Task Intelligence (SU-UI-003)
        swipe_right: → done()
        swipe_left:  → snooze()
        long_press:  → Decision Explainer (SU-UI-004)

    - zone: CRITICAL_SIGNALS
      show_if: blockers.length > 0 OR contradictions.length > 0
      label: "SIGNALS" (10px, uppercase, muted)
      contents:
        - blocker_row: item text + "blocking X tasks" (amber left border)
        - conflict_row: conflict summary text (red left border)
      max_items: 2
      behavior:
        tap blocker:   → Blocker Resolution overlay (OV-03)
        tap conflict:  → contradiction detail modal

    - zone: RISK_INDICATOR
      show_if: capacity.status == 'overloaded' OR burnout.risk == 'high'
      contents:
        - single line: "You're 40% over capacity this week" | "Burnout signals detected"
        - right: "→" tap to open Strategic View (SU-UI-005)
      style: subtle — muted text, no alarming color unless burnout.risk == 'high'

# ─── NAVIGATION ───────────────────────────────────────────────
navigation:
  bottom_bar:
    tabs:
      - icon: grid     label: "Today"    → Command Center (active)
      - icon: compass  label: "Strategy" → Strategic View (SU-UI-005)
      - icon: clock    label: "Timeline" → Timeline (SU-UI-006)
      - icon: search   label: "Search"   → Search (SU-UI-007)
  fab:
    position: bottom_right, above tab bar
    icon: plus
    action: → Rapid Capture (SU-UI-002)
    gesture_alternative: swipe up anywhere on screen

# ─── EMPTY STATES ─────────────────────────────────────────────
empty_states:
  cold_start:
    headline: "Nothing captured yet"
    body: "Start by adding something on your mind."
    cta: "Capture" → opens SU-UI-002

  all_done:
    headline: "Clear"
    body: today's date + "No open directives."
    no_cta: true   # resist urge to add filler

  plan_error:
    headline: "Couldn't load your plan"
    retry_button: true
    error_detail: false   # INV-016: never show stack traces

# ─── API CALLS ────────────────────────────────────────────────
api:
  on_mount:
    - GET /api/plan/today          → populates all zones
    - GET /api/contradictions      → populates CRITICAL_SIGNALS if any
    - GET /api/capacity            → populates RISK_INDICATOR if triggered
  on_action_done:
    - POST /api/action { type: done, itemId }
    - refetch GET /api/plan/today
  on_action_snooze:
    - POST /api/action { type: snooze, itemId, snoozeMins: 180 }
    - refetch GET /api/plan/today
  refresh_interval: 300_000ms (5 min, background)

# ─── VISUAL RULES ─────────────────────────────────────────────
visual:
  background:     var(--bg)      # near-black in dark, off-white in light
  directive_size: 20px weight 500
  queue_size:     15px weight 400
  label_size:     10px uppercase letter-spacing 0.08em
  chip_radius:    20px (pill)
  chip_padding:   2px 8px
  swipe_threshold: 80px to trigger action
  swipe_animation: card slides out + springback if cancelled
  transition:     200ms ease-out for all state changes

# ─── CONSTRAINTS ──────────────────────────────────────────────
constraints:
  - Never show more than 5 items total (1 focus + 3 queue + 1 signal max)
  - Never show confidence score as a number — only as the thin bar
  - Primary directive must always occupy the top position — never scroll it off
  - Swipe right = done everywhere, swipe left = snooze everywhere — consistent
  - INV-020: only show user's own items
  - INV-016: never expose error details to user
  - Screen must render in under 300ms (cached plan) or show skeleton instantly
```

---

# SCREEN 02 — RAPID CAPTURE
**Entry point. No friction. No categories. Under 1 second.**

---

```yaml
unit_id:  SU-UI-002
title:    Rapid Capture
version:  v1
status:   locked

goal: >
  User dumps anything into Flowra in under 1 second.
  No category selection. No priority. No friction.
  Submit → confirm → back to Command Center.

# ─── TRIGGER ──────────────────────────────────────────────────
trigger:
  - FAB tap from Command Center
  - Swipe up from bottom edge
  - Keyboard shortcut: ⌘N (desktop)

# ─── LAYOUT ──────────────────────────────────────────────────
layout:
  presentation: bottom_sheet  # slides up from bottom, not full screen
  height: 60vh minimum, expands with keyboard
  backdrop: dimmed Command Center behind (tappable to dismiss)

  zones:
    - zone: INPUT
      type: textarea
      placeholder: "What's on your mind?"
      font_size: 18px
      weight: 400
      auto_focus: true   # keyboard opens immediately on sheet open
      max_chars: 50000
      auto_expand: true  # grows with content, no scroll bar
      return_key: "Add" (not newline — shift+return for newlines)

    - zone: COMMAND_HINT
      show_if: input contains date-like text OR person name
      contents:
        - detected_temporal: "Tomorrow 5pm →" (shows resolved date)
        - detected_person:   "Raj →" (shows resolved entity)
      style: small, muted, below input — system showing its work

    - zone: ACTIONS
      layout: horizontal, space-between
      left:
        - voice_button: microphone icon (V2 — placeholder in V1)
      right:
        - cancel_button: "Cancel" (text, muted)
        - submit_button: "Add" (filled, accent color)

# ─── BEHAVIOR ─────────────────────────────────────────────────
behavior:
  on_submit:
    1. Optimistic: sheet closes immediately with spring animation
    2. Success toast: "Added" (2s, no undo option — too fast)
    3. Background: POST /api/capture { raw_input, source: 'manual' }
    4. If API fails: "Couldn't save — tap to retry" persistent toast
    5. Command Center refreshes after 1.5s (plan cache invalidated)

  on_dismiss:
    - tap backdrop → dismiss without saving
    - swipe down → dismiss without saving
    - escape key → dismiss

  command_parsing:
    - "call raj tomorrow 10am" → extracts: task=call raj, temporal=tomorrow 10am, entity=Raj
    - "prepare pitch by friday" → extracts: task=prepare pitch, deadline=friday
    - shown as hints ONLY — user does not confirm categories
    - system stores extraction metadata silently

# ─── API CALLS ────────────────────────────────────────────────
api:
  submit: POST /api/capture
    body: { raw_input: string, source: 'manual' }
    response: 202 { ok: true, entryId, status: 'processing' }
  rate_limit: 20/hour — show friendly message if hit

# ─── VISUAL RULES ─────────────────────────────────────────────
visual:
  sheet_bg:       var(--surface)
  handle:         4px wide pill, centered top, muted color
  input_bg:       transparent (inherits sheet)
  input_border:   none — no visual frame around text area
  submit_btn:     accent fill, 44px height min, rounded full
  cancel_btn:     no border, muted text
  animation:      sheet slides up 300ms cubic-bezier(0.34,1.56,0.64,1)

# ─── CONSTRAINTS ──────────────────────────────────────────────
constraints:
  - No category selection. Ever. System infers.
  - No priority slider. System computes.
  - No project assignment. System groups.
  - Input must auto-focus on open — user should never tap twice
  - Submit must be reachable with one thumb (bottom right)
  - Sheet must not cover the full screen — user sees where they came from
```

---

# SCREEN 03 — TASK INTELLIGENCE
**Full depth on one item. The node in the system, not an isolated checkbox.**

---

```yaml
unit_id:  SU-UI-003
title:    Task Intelligence
version:  v1
status:   locked

goal: >
  Show everything the system knows about one item.
  Not just the text — dependencies, downstream impact,
  history, suggested actions. Makes the system's model visible.

# ─── TRIGGER ──────────────────────────────────────────────────
trigger:
  - Tap any task on Command Center (focus or queue items)
  - Tap any task in Search results
  - Tap any task in Timeline

# ─── LAYOUT ──────────────────────────────────────────────────
layout:
  presentation: full_screen_push  # navigates in, back button returns
  scroll: vertical, all zones scrollable

  zones:
    - zone: HEADER
      sticky: true
      contents:
        - back_button: "←" left
        - item_state_badge: OPEN | IN_PROGRESS | DONE | DROPPED (top right)
        - overflow_menu: "⋮" (edit text, delete, share) top right

    - zone: DIRECTIVE
      contents:
        - item_text: full canonical_text (20px, weight 500, wraps fully)
        - meta_row:
            - project_chip:   item.project | null
            - created_label:  "Captured 3 days ago"
            - deadline_chip:  "Due Friday" (colored by urgency)

    - zone: PRIMARY_ACTIONS
      layout: horizontal row of 3
      actions:
        - DONE:     filled accent button
        - SNOOZE:   outlined, tap → Smart Reschedule overlay (OV-04)
        - DROP:     text button, muted, requires confirm
      style: full width, equal columns, 48px height

    - zone: INTELLIGENCE_PANEL
      label: "WHY THIS MATTERS" (10px, uppercase, muted)
      contents:
        - factor_list: explain/:id factors (2–3 items)
          format: "· [factor text]" (12px, muted)
        - confidence_row: "Confidence: 0.74" (small, right-aligned)
      behavior:
        tap panel: → expands to full Decision Explainer (SU-UI-004)

    - zone: DEPENDENCIES
      label: "DEPENDS ON" (10px, uppercase, muted)
      show_if: item has upstream dependencies
      contents:
        - dependency_list: upstream items (text only, muted)
          behavior: tap → navigate to that item's Task Intelligence

    - zone: DOWNSTREAM_IMPACT
      label: "UNLOCKS" (10px, uppercase, muted)
      show_if: item.downstream_open > 0
      contents:
        - impact_text: "Completing this unblocks [N] tasks"
        - blocked_list: downstream items (first 3, truncate rest)
          behavior: tap → navigate to that item's Task Intelligence

    - zone: SUBTASK_SECTION
      label: "STEPS" (10px, uppercase, muted)
      contents:
        - subtask_list: manual subtasks if any (checkboxes)
        - generate_button: "Break this down →" (muted, small)
          behavior: tap → Subtask Breakdown overlay (OV-02)

    - zone: HISTORY
      label: "HISTORY" (10px, uppercase, muted)
      contents:
        - event_list: last 5 state transitions
          format: "[state] · [relative time] · [reason]"
          example: "Snoozed · 2 days ago · user action"
        - mention_count: "Captured [N] times"

    - zone: RELATED_COMMITMENTS
      label: "COMMITMENTS" (10px, uppercase, muted)
      show_if: item linked to a commitment
      contents:
        - commitment_text: full commitment text
        - counterparty: "→ [person name]"
        - due_date: "by [date]"
        - fulfill_button: "Mark fulfilled"

    - zone: TIME_ESTIMATE
      label: "TIME" (10px, uppercase, muted)
      show_if: time estimate available
      contents:
        - estimate_text: "~[N] minutes estimated"
        - basis_text: "Based on [N] similar past tasks" (small, muted)
        - record_button: "Record actual time" → inline input (tap to expand)

# ─── API CALLS ────────────────────────────────────────────────
api:
  on_mount:
    - GET /api/explain/:itemId → INTELLIGENCE_PANEL
    - GET /api/items/:id/estimate → TIME_ESTIMATE (if available)
    - item data from plan cache (already loaded)
  on_done:
    - POST /api/action { type: done, itemId }
    - navigate back → Command Center refreshes
  on_snooze:
    - opens OV-04 Smart Reschedule
  on_drop:
    - confirm dialog → POST /api/action { type: drop, itemId }
    - navigate back
  on_fulfill_commitment:
    - POST /api/commitments/:id/fulfill
  on_record_time:
    - POST /api/items/:id/time { actualMins }
  on_generate_subtasks:
    - opens OV-02 Subtask Breakdown

# ─── VISUAL RULES ─────────────────────────────────────────────
visual:
  zone_separator:   0.5px border, var(--border)
  zone_padding:     16px horizontal, 14px vertical
  label_style:      10px, uppercase, letter-spacing 0.08em, color var(--muted)
  dependency_style: muted, 13px, left indent 8px
  factor_style:     12px, muted, bullet "·"
  history_style:    12px, muted, monospaced timestamp

# ─── CONSTRAINTS ──────────────────────────────────────────────
constraints:
  - Never show empty sections — hide if no data
  - INTELLIGENCE_PANEL must always show (even if only "No explanation yet")
  - Primary actions always visible, not scrolled off
  - INV-020: only show user's own item and its related data
  - Subtask generation: do not auto-generate — only on tap
```

---

# SCREEN 04 — DECISION EXPLAINER
**A briefing, not an explanation. Real signals only. No hallucination.**

---

```yaml
unit_id:  SU-UI-004
title:    Decision Explainer
version:  v1
status:   locked

goal: >
  Show the user exactly why the system ranked this item here.
  Builds trust. No fabricated reasons. Every signal traceable
  to a real data point. Accessible in under 1 gesture.

# ─── TRIGGER ──────────────────────────────────────────────────
trigger:
  - Long press any task on Command Center
  - Tap INTELLIGENCE_PANEL on Task Intelligence screen
  - Tap "Why?" quick action in Quick Actions overlay

# ─── LAYOUT ──────────────────────────────────────────────────
layout:
  presentation: bottom_sheet  # 50vh, can expand to 80vh
  backdrop: dimmed, tappable to dismiss

  zones:
    - zone: ITEM_HEADER
      contents:
        - small_label: "WHY THIS NOW" (10px, uppercase, muted)
        - item_text: task text (16px, weight 500, max 2 lines, truncated)

    - zone: BRIEFING
      contents:
        - factor_list:
            format: |
              [SIGNAL_TYPE]: [plain language explanation]

            examples:
              - "DEADLINE: Due in 2 days — passes critical threshold tomorrow"
              - "BLOCKING: Prevents 3 other tasks from starting"
              - "PATTERN: You completed similar tasks after working on this yesterday"
              - "DEPENDENCY: Required for Q3 review which is your top goal cluster"
              - "URGENCY: Mentioned 4 times in the last week"

            max_factors: 3
            min_factors: 1
            style: 14px, weight 400, line-height 1.6
            signal_type_style: weight 500, accent color

        - confidence_row:
            label: "CONFIDENCE"
            value: "0.74"   # shown as number here — this is the briefing context
            bar: thin fill bar (same as Command Center)
            context: "Based on [N] historical signals"

    - zone: WHAT_IF
      label: "WHAT IF YOU DELAY?" (10px, uppercase, muted)
      show_if: item has downstream dependencies OR deadline
      contents:
        - impact_preview: single line showing ripple effect
          examples:
            - "3 tasks remain blocked"
            - "Deadline missed — committed to Sarah by Friday"
            - "No cascading impact"
      behavior:
        tap: → POST /api/simulate { mutation: { type: SNOOZE_ITEM, itemId } }
             → shows full what-if result inline (expands zone)

    - zone: QUICK_ACTIONS
      contents:
        - action_row:
            - "Do it now →"   → closes sheet, marks IN_PROGRESS, scrolls to focus
            - "Snooze"        → opens OV-04 Smart Reschedule
            - "Dismiss"       → closes sheet, no action

# ─── TRUST RULES (CRITICAL) ───────────────────────────────────
trust:
  - Every factor must map to a real data field — never generated prose
  - DEADLINE factor: only shown if item.deadline IS NOT NULL
  - BLOCKING factor: only shown if downstream_open > 0
  - PATTERN factor: only shown if ≥ 3 similar historical completions
  - DEPENDENCY factor: only shown if item has explicit item_edges
  - URGENCY factor: only shown if mention_count ≥ 3
  - If no factors available: "Not enough data yet — confidence will improve"
  - confidence score: rounded to 2 decimal places, never fabricated

# ─── API CALLS ────────────────────────────────────────────────
api:
  on_mount:
    - GET /api/explain/:itemId
  on_what_if_tap:
    - POST /api/simulate { mutation: { type: SNOOZE_ITEM, itemId } }
  on_do_it_now:
    - no API call — just UI state change + close sheet

# ─── VISUAL RULES ─────────────────────────────────────────────
visual:
  sheet_bg:       var(--surface)
  signal_type:    weight 500, color var(--accent) or var(--danger) for risk signals
  factor_spacing: 12px between factors
  confidence_bar: 2px height, var(--accent) fill on var(--border) track
  what_if_bg:     var(--bg) inset, subtle separation from factors

# ─── CONSTRAINTS ──────────────────────────────────────────────
constraints:
  - Maximum 3 factors. Never more. Brevity = trust.
  - Minimum 1 factor. If 0 available: show "not enough data" — never fabricate.
  - confidence shown as decimal (0.74) in this context only
  - what-if simulation: read-only, never persists state
  - INV-020: only user's own item data
```
