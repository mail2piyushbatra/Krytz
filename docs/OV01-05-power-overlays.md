# FLOWRA — SCREEN SPECS (PART 4)
## Power Overlays OV-01 through OV-05
**ASP-GCP Minimal Mode — Locked**

Overlays are not screens. They appear on top of existing screens.
They never navigate away. They dismiss with swipe down or tap backdrop.
Max 3 actions per overlay. No nested navigation.

---

# OVERLAY OV-01 — QUICK ACTIONS
**Swipe or long press → all actions available in one gesture.**

---

```yaml
unit_id:  SU-UI-OV01
title:    Quick Actions Overlay
version:  v1
status:   locked

goal: >
  Give power users immediate access to all actions on a task
  without opening Task Intelligence. The fast path.

# ─── TRIGGER ──────────────────────────────────────────────────
trigger:
  - Long press any task card (Command Center or Search)
  - Swipe partially left and pause (reveals action row)
  - "⋮" overflow menu on Task Intelligence header

# ─── LAYOUT ──────────────────────────────────────────────────
layout:
  presentation: action_sheet (bottom, no backdrop dim — feels native)
  height: auto (content-driven, ~40vh max)

  zones:
    - zone: TASK_PREVIEW
      contents:
        - item_text: full text (14px, muted, max 2 lines)
      style: border-bottom separates from actions

    - zone: PRIMARY_ACTIONS
      layout: vertical list of action rows
      actions:
        - row: "Mark done"
          icon: checkmark
          style: accent text
          api:   POST /api/action { type: done, itemId }
          result: sheet closes, card animates out, toast "Done"

        - row: "Snooze"
          icon: clock
          style: default
          behavior: tap → expand inline to snooze options:
            sub_options:
              - "3 hours"    → snoozeMins: 180
              - "Tomorrow"   → snoozeMins: 1440
              - "Next week"  → snoozeMins: 10080
              - "Custom..."  → opens time picker
            api: POST /api/action { type: snooze, itemId, snoozeMins }

        - row: "Break this down"
          icon: arrow split
          style: default
          behavior: → closes sheet, opens OV-02 Subtask Breakdown

        - row: "Mark as blocker"
          icon: warning
          style: default
          show_if: item NOT already marked blocker
          api:   PATCH /api/items/:id { blocker: true }
          show_alternative_if: already blocker →
            row: "Remove blocker flag"
            api: PATCH /api/items/:id { blocker: false }

        - row: "Reschedule"
          icon: calendar
          style: default
          behavior: → closes sheet, opens OV-04 Smart Reschedule

        - row: "Why this now?"
          icon: info
          style: default
          behavior: → closes sheet, opens SU-UI-004 Decision Explainer

        - row: "Drop task"
          icon: trash
          style: red text
          behavior: confirm inline ("Drop this task?") → POST /api/action { type: drop, itemId }

    - zone: CANCEL
      contents:
        - cancel_row: "Cancel" (centered, muted, full-width tap target)
      behavior: tap → dismiss sheet

# ─── CONSTRAINTS ──────────────────────────────────────────────
constraints:
  - No nested sheets — snooze sub-options expand inline, not a new sheet
  - Drop requires inline confirm — not a separate dialog
  - "Break this down" and "Reschedule" close this sheet before opening next
  - Sheet dismisses on any action completion
```

---

# OVERLAY OV-02 — SUBTASK BREAKDOWN
**Turn vague tasks into concrete steps. The biggest usability unlock.**

---

```yaml
unit_id:  SU-UI-OV02
title:    Subtask Breakdown Overlay
version:  v1
status:   locked

goal: >
  User has a vague task. They tap "Break this down."
  System generates concrete steps. User edits, confirms.
  Steps become subtasks linked to the parent item.

# ─── TRIGGER ──────────────────────────────────────────────────
trigger:
  - "Break this down" in Quick Actions (OV-01)
  - "Break this down →" button in Task Intelligence (SU-UI-003)

# ─── LAYOUT ──────────────────────────────────────────────────
layout:
  presentation: full_sheet (80vh, handles like a modal)
  backdrop: dimmed

  zones:
    - zone: HEADER
      contents:
        - title: "Break it down" (16px, weight 500)
        - parent_task: item text (13px, muted, max 1 line)
        - close_button: "×" top right

    - zone: LOADING_STATE
      show_while: AI generating
      contents:
        - text: "Breaking this down..."
        - style: centered, muted, no spinner (text is enough)

    - zone: GENERATED_STEPS
      show_after: AI complete
      contents:
        - step_list: generated subtasks (editable)
          per_step:
            - drag_handle: left (reorder)
            - checkbox:    unchecked by default
            - text_input:  editable step text (14px)
            - delete_btn:  "×" right (removes step)
        - add_step_row:
            - plus icon + "Add step" (muted text input)
            - behavior: tap → focus new empty step at bottom

    - zone: ACTIONS
      contents:
        - regenerate_btn: "Regenerate →" (muted, left)
          behavior: re-calls AI with same parent task
        - confirm_btn:    "Save steps" (filled, accent, right)
          behavior: saves all steps as subtasks on parent item

    - zone: SKIP_OPTION
      contents:
        - link: "Add manually instead" (very small, muted, bottom center)
          behavior: clears generated steps, shows blank step list for manual entry

# ─── BEHAVIOR ─────────────────────────────────────────────────
behavior:
  on_open:
    1. Display loading state
    2. POST /api/simulate (or dedicated subtask endpoint V2) with item text
    3. Display generated steps (3–6 steps ideal)
    4. Auto-focus first step for editing

  on_confirm:
    1. Save each non-empty step as a subtask linked to parent
    2. Sheet closes
    3. Task Intelligence shows updated steps section
    4. No API designed yet → V1: store subtasks in items.metadata JSONB field

  step_count:
    min: 2
    max: 8
    ideal: 3–5
    if_task_simple: "This task looks clear enough to do directly." + show confirm without steps

# ─── CONSTRAINTS ──────────────────────────────────────────────
constraints:
  - AI generation: V1 uses OpenAI GPT-4o-mini with strict prompt
  - Steps are suggestions — user always edits before confirming
  - Never auto-save generated steps — user must tap "Save steps"
  - Regenerate available once per session (cost guard)
  - If AI unavailable (no API key or budget): show manual entry only
  - Subtask storage V1: JSONB field on parent item (no separate table needed)
```

---

# OVERLAY OV-03 — BLOCKER RESOLUTION PANEL
**User stuck → system helps move forward. Causal engine made visible.**

---

```yaml
unit_id:  SU-UI-OV03
title:    Blocker Resolution Panel
version:  v1
status:   locked

goal: >
  When a task is marked as a blocker or detected as stuck,
  show the user: why it's stuck, what they can do, what it unlocks.
  This is where the causal graph becomes a visible user feature.

# ─── TRIGGER ──────────────────────────────────────────────────
trigger:
  - Tap blocker item in CRITICAL_SIGNALS zone (Command Center)
  - Tap blocker badge on any task card
  - "Why is this blocked?" question from Command Palette (OV-05)

# ─── LAYOUT ──────────────────────────────────────────────────
layout:
  presentation: bottom_sheet (60vh)

  zones:
    - zone: BLOCKER_CONTEXT
      contents:
        - label: "BLOCKER" (10px, uppercase, amber)
        - item_text: blocker item full text (16px, weight 500)

    - zone: WHY_STUCK
      label: "WHY STUCK" (10px, uppercase, muted)
      contents:
        - reason_text:
            examples:
              - "Waiting on: [person name]" (if commitment detected)
              - "Depends on: [item text] (not started)"
              - "No clear next action detected"
              - "Deadline pressure causing avoidance pattern"
          style: 14px, muted

    - zone: DOWNSTREAM_IMPACT
      label: "WHAT THIS BLOCKS" (10px, uppercase, muted)
      contents:
        - blocked_count: "[N] tasks can't start until this is resolved"
        - blocked_list:  top 3 downstream items (13px, muted, with deadline chips)

    - zone: SUGGESTED_ACTIONS
      label: "WHAT TO DO" (10px, uppercase, muted)
      contents:
        - action_list: 2–3 concrete suggestions
          examples:
            - { text: "Break into smaller steps",   action: → OV-02 Subtask Breakdown }
            - { text: "Follow up with [person]",    action: → capture pre-filled "Follow up with [person] re: [task]" }
            - { text: "Reframe as waiting-for",     action: → mark item as waiting_for type }
            - { text: "Drop this blocker",          action: → confirm + POST /api/action { type: drop } }
          style: 14px, left border accent, tappable rows

    - zone: RESOLUTION_ACTIONS
      contents:
        - primary: "Mark resolved" (filled, accent)
          api: POST /api/action { type: done, itemId }
        - secondary: "Snooze blocker" (outlined)
          api: POST /api/action { type: snooze, itemId, snoozeMins: 1440 }
        - tertiary: "Dismiss" (text, muted)
          action: close sheet

# ─── CONSTRAINTS ──────────────────────────────────────────────
constraints:
  - Suggestions must be concrete — no generic "make progress"
  - Downstream impact always shown if downstream_open > 0
  - If no reason detected: "No specific reason found — mark as in progress?"
  - Max 3 suggestions — brevity over completeness
```

---

# OVERLAY OV-04 — SMART RESCHEDULE PANEL
**Delay intelligently, not blindly. Best slot, not random snooze.**

---

```yaml
unit_id:  SU-UI-OV04
title:    Smart Reschedule Panel
version:  v1
status:   locked

goal: >
  When user wants to delay a task, offer intelligent time slots
  based on history, energy patterns, and deadline constraints.
  Not just "snooze 3h" — suggest the right time.

# ─── TRIGGER ──────────────────────────────────────────────────
trigger:
  - "Snooze" action from Quick Actions (OV-01)
  - Swipe left on any task (Command Center or Search)
  - "Reschedule" in Task Intelligence

# ─── LAYOUT ──────────────────────────────────────────────────
layout:
  presentation: bottom_sheet (50vh)

  zones:
    - zone: TASK_PREVIEW
      contents:
        - item_text: task text (14px, muted, 1 line)
        - deadline_warning:
            show_if: item.deadlineDays < 3
            text: "⚠ Due in [N] days — rescheduling may cause issues"
            style: amber, 12px

    - zone: SMART_SLOTS
      label: "SUGGESTED TIMES" (10px, uppercase, muted)
      contents:
        - slot_list: 3–4 smart suggestions
          generation_logic:
            - "Later today" (3h from now) — if before 6pm
            - "Tomorrow morning" (9am) — if V2 energy pattern shows morning focus
            - "This weekend" — if low priority and no deadline pressure
            - "Next Monday" — always available as a safe defer
          per_slot:
            - time_label: "Tomorrow 9am" | "Friday" | "Next Monday" (14px, weight 500)
            - context:    "You usually focus in the morning" (12px, muted)
              show_if: pattern data available
            - deadline_warning: "Cuts close to deadline" (amber, 12px)
              show_if: slot is within 24h of item deadline
          behavior:
            tap slot: → POST /api/action { type: snooze, itemId, snoozeMins: [computed] }
                       → sheet closes + toast "Snoozed until [time]"

    - zone: CUSTOM_TIME
      contents:
        - label: "Choose a specific time"
        - time_picker: native date+time picker
        - confirm_button: "Snooze until this time" (accent)
          api: POST /api/action { type: snooze, itemId, snoozeMins: [computed from picker] }

    - zone: CANCEL
      contents:
        - "Don't snooze" (muted, full-width tap target)
        - behavior: dismiss sheet, no action

# ─── CONSTRAINTS ──────────────────────────────────────────────
constraints:
  - V1: smart slots are heuristic (time-of-day based), not ML-driven
  - V3: ML model learns energy patterns and suggests accordingly
  - Always show deadline warning if slot pushes close to deadline
  - Custom time: validate that chosen time is in the future
  - Maximum 4 suggested slots (including "custom")
  - Never snooze past the item's deadline without explicit warning
```

---

# OVERLAY OV-05 — COMMAND PALETTE
**Everything accessible in one step. The power user interface.**

---

```yaml
unit_id:  SU-UI-OV05
title:    Command Palette
version:  v1
status:   locked

goal: >
  Power users should be able to do anything without navigating.
  Type a command → get instant results or actions.
  Replaces menu overload. The CEO's one-key interface.

# ─── TRIGGER ──────────────────────────────────────────────────
trigger:
  - Swipe down from top edge (mobile)
  - ⌘K keyboard shortcut (desktop/PWA)
  - Search icon long press

# ─── LAYOUT ──────────────────────────────────────────────────
layout:
  presentation: full_overlay (not a sheet — full screen takeover)
  style: dark overlay with centered search (like Spotlight / Raycast)
  backdrop: very dark (0.85 opacity), tappable to dismiss

  zones:
    - zone: COMMAND_INPUT
      position: top, 20% from top
      contents:
        - input:
            placeholder: "Type a command or search..."
            font_size: 20px
            weight: 400
            style: no border, white text on dark bg (or system appropriate)
            auto_focus: true
            clear_button: true

    - zone: COMMAND_RESULTS
      position: below input
      max_height: 60vh
      scroll: vertical

      empty_query:
        label: "COMMANDS" (10px, uppercase, muted)
        show_default_commands:
          - "Show all tasks"              → navigate to Search (SU-UI-007)
          - "Capture something new"       → open Capture (SU-UI-002)
          - "Show this week's goals"      → navigate to Strategic View (SU-UI-005)
          - "Show commitments"            → navigate to Strategic View commitments section
          - "Show conflicts"              → navigate to Strategic View conflicts section
          - "What am I working towards?"  → navigate to Strategic View
          - "Clear my backlog"            → confirm → snooze all non-focus items 7 days
          - "Undo last action"            → POST /api/action/undo

      with_query:
        group_1:
          label: "ACTIONS"
          matches: NL command matching (regex + keyword)
          command_patterns:
            - pattern: /show.*task|all task|list/i
              action:  → Search screen (all items)

            - pattern: /reschedule all|defer all|snooze all/i
              action:  → confirm dialog → snooze all non-focus snoozeable items

            - pattern: /undo|restore/i
              action:  → POST /api/action/undo directly

            - pattern: /capture|add|new task/i
              action:  → open Capture (SU-UI-002)

            - pattern: /what.*block|blocker|stuck/i
              action:  → navigate to Command Center, highlight CRITICAL_SIGNALS

            - pattern: /what.*commit|promises?/i
              action:  → navigate to Strategic View, scroll to COMMITMENTS_STRIP

            - pattern: /conflict|clash|contradict/i
              action:  → navigate to Strategic View, scroll to CONTRADICTIONS_STRIP

            - pattern: /week|strategy|goal/i
              action:  → navigate to Strategic View

            - pattern: /help|how.*(work|use)/i
              action:  → show 3 inline help cards:
                          "Swipe right = done"
                          "Swipe left = snooze"
                          "Long press = explain"

        group_2:
          label: "ITEMS"
          show_if: query doesn't match a command
          behavior: text search over all open items (same as Search screen)
          max_results: 5
          per_result:
            - item_text: (14px, match highlighted)
            - state_badge: small pill
          behavior:
            tap result: → Task Intelligence (SU-UI-003)

        no_match:
          text: "No commands or items found"
          suggestion: "Try 'show tasks', 'capture', or 'undo'"

# ─── BEHAVIOR ─────────────────────────────────────────────────
behavior:
  keyboard:
    arrow_up/down: navigate results
    enter:         execute highlighted result
    escape:        dismiss palette

  command_execution:
    immediate_actions: (undo, clear backlog) execute in-place, show result
    navigation_actions: dismiss palette + navigate to screen
    capture_actions: dismiss palette + open Capture sheet

  animation:
    open:  fade in 150ms + input slides down from top
    close: fade out 100ms

# ─── CONSTRAINTS ──────────────────────────────────────────────
constraints:
  - Input auto-focuses on open — no tap required
  - Commands execute without extra confirmation EXCEPT destructive ones
    (reschedule all, clear backlog → require confirm)
  - Item search: max 5 results in palette (see full results → navigate to Search)
  - Command matching: keyword/regex only in V1 — NLP matching in V3
  - Never execute commands that require auth if token is expired
  - Dismiss on any action completion (commands don't stack)
  - INV-020: only user's own items in search results
```

---

# SUMMARY — ALL 14 SURFACES

```yaml
surfaces:
  core_screens:
    SU-UI-001: Command Center    # default, primary, everything orbits this
    SU-UI-002: Rapid Capture     # FAB, swipe up, instant
    SU-UI-003: Task Intelligence # full depth on one item
    SU-UI-004: Decision Explainer # briefing on why — long press

  support_screens:
    SU-UI-005: Strategic View    # weekly goals, load, commitments
    SU-UI-006: Timeline          # history, feedback, patterns
    SU-UI-007: Search            # find anything, ask anything

  system_screens:
    SU-UI-008: Settings          # control, not feature dump
    SU-UI-009: Onboarding        # 3 screens, one-time, first capture

  power_overlays:
    SU-UI-OV01: Quick Actions    # long press → all actions
    SU-UI-OV02: Subtask Breakdown # vague task → concrete steps
    SU-UI-OV03: Blocker Panel    # stuck → system helps move forward
    SU-UI-OV04: Smart Reschedule # snooze intelligently
    SU-UI-OV05: Command Palette  # everything in one keystroke

navigation:
  default:         Command Center (SU-UI-001)
  tab_bar:         [Command Center, Strategic View, Timeline, Search]
  fab:             Rapid Capture
  overlay_dismiss: swipe down or tap backdrop (all overlays)
  back:            hardware back or "←" button (full screen pushes)

gestures:
  swipe_right:     done (all task cards, everywhere)
  swipe_left:      snooze → Smart Reschedule (all task cards, everywhere)
  long_press:      Decision Explainer (all task cards)
  swipe_up:        Rapid Capture (from Command Center)
  swipe_down:      Command Palette (from top)
  cmd_k:           Command Palette (desktop/PWA)

build_order:
  phase_1_v1: [001, 002, 004, 009]  # Command Center, Capture, Explainer, Onboarding
  phase_2_v1: [003, OV01, OV04]     # Task Intel, Quick Actions, Smart Reschedule
  phase_3_v2: [005, 006, 007, 008]  # Strategy, Timeline, Search, Settings
  phase_4_v2: [OV02, OV03, OV05]   # Subtask, Blocker Panel, Command Palette
```
