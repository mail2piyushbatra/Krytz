# FLOWRA — SCREEN SPECS (PART 2)
## Support Screens 05–07
**ASP-GCP Minimal Mode — Locked**

---

# SCREEN 05 — STRATEGIC VIEW
**What am I actually working towards? Not a dashboard. A briefing.**

---

```yaml
unit_id:  SU-UI-005
title:    Strategic View
version:  v1
status:   locked

goal: >
  Show the user their 2–3 goal clusters for the week, progress on each,
  and a single weekly load signal. Not graphs. Not analytics.
  One glance → situational clarity.

# ─── TRIGGER ──────────────────────────────────────────────────
trigger:
  - Tab bar: "Strategy" (compass icon)
  - Tap RISK_INDICATOR on Command Center
  - Tap capacity warning anywhere

# ─── LAYOUT ──────────────────────────────────────────────────
layout:
  presentation: full_screen (tab)
  scroll: vertical

  zones:
    - zone: HEADER
      contents:
        - title: "This week" (16px, weight 500)
        - date_range: "Apr 21–27" (12px, muted)
        - week_number: "Week 17" (12px, muted)

    - zone: WEEKLY_LOAD
      contents:
        - load_bar:
            type: horizontal bar, full width
            fill_pct: capacity.capacityRatio * 100 (capped at 110%)
            color:
              < 80%:   var(--accent)   # healthy
              80–110%: var(--warn)     # stretched
              > 110%:  var(--danger)   # overloaded
            label_left:  "[N] hours committed"
            label_right: "[N] hours available"
        - load_insight: capacity.capacity.insight (13px, muted, below bar)
        - burnout_signal:
            show_if: burnout.risk != 'none'
            text: burnout.insight
            style: amber left border, 12px

    - zone: GOAL_CLUSTERS
      label: "FOCUS AREAS" (10px, uppercase, muted)
      contents:
        - cluster_cards: goals (max 3)
          per_card:
            - cluster_name:  goal.name (15px, weight 500)
            - item_count:    "[N] open tasks"
            - progress_bar:
                fill: items_done / (items_done + items_open)
                color: var(--accent)
                height: 2px
            - urgency_chip:  goal.urgency (color-coded pill)
            - top_item:      goal.focusItem.text (13px, muted, truncated)
            - hours_chip:    "~[N]h this week" (small, right-aligned)
          behavior:
            tap: → Search screen filtered to this project/cluster

    - zone: COMMITMENTS_STRIP
      label: "OPEN COMMITMENTS" (10px, uppercase, muted)
      show_if: commitments.length > 0
      contents:
        - commitment_list: open commitments (max 3)
          per_item:
            - commitment_text: (13px, truncated)
            - counterparty: "→ [name]" (muted)
            - due_chip: urgency-colored date
          behavior:
            tap: → modal showing full commitment detail + fulfill button

    - zone: CONTRADICTIONS_STRIP
      label: "CONFLICTS" (10px, uppercase, muted)
      show_if: contradictions.length > 0
      contents:
        - contradiction_list: active contradictions (max 2)
          per_item:
            - severity_indicator: red dot (high) | amber dot (medium)
            - message: contradiction.message (13px, truncated 2 lines)
          behavior:
            tap: → modal showing full contradiction detail + resolve button

    - zone: WEEKLY_STATS
      label: "THIS WEEK" (10px, uppercase, muted)
      contents:
        - stat_row: 3 stats in equal columns
            - completed:  "[N] done"
            - captured:   "[N] captured"
            - snoozed:    "[N] deferred"
        - streak_row:
            show_if: streak.current > 0
            text: "[N] day streak" (small, muted, accent if > 7 days)

# ─── API CALLS ────────────────────────────────────────────────
api:
  on_mount:
    - GET /api/plan/week        → goal clusters + weekly stats
    - GET /api/capacity         → weekly load bar + burnout signal
    - GET /api/commitments      → commitments strip
    - GET /api/contradictions   → conflicts strip
    - GET /api/stats            → weekly stats row

# ─── VISUAL RULES ─────────────────────────────────────────────
visual:
  cluster_card_bg:    var(--surface)
  cluster_card_border: 0.5px var(--border)
  cluster_card_radius: 12px
  cluster_card_padding: 14px 16px
  progress_bar_bg:    var(--border)
  zone_gap:           16px between zones

# ─── CONSTRAINTS ──────────────────────────────────────────────
constraints:
  - Maximum 3 goal clusters — never more
  - No line charts, bar charts, or analytics graphs in V1
  - Load bar is the only graph-like element permitted
  - Burnout signals shown factually — no alarming language
  - Contradictions: show message only, not full detail inline
  - INV-020: only user's own data
```

---

# SCREEN 06 — TIMELINE
**Audit trail. Memory. What happened. Closes the feedback loop.**

---

```yaml
unit_id:  SU-UI-006
title:    Timeline
version:  v1
status:   locked

goal: >
  Show the user what they completed, what they ignored, what they deferred.
  Surface patterns. Let them correct the system's understanding.
  Control memory — not just history.

# ─── TRIGGER ──────────────────────────────────────────────────
trigger:
  - Tab bar: "Timeline" (clock icon)

# ─── LAYOUT ──────────────────────────────────────────────────
layout:
  presentation: full_screen (tab)
  scroll: vertical, infinite scroll (paginated)

  zones:
    - zone: HEADER
      contents:
        - title: "Timeline" (16px, weight 500)
        - filter_chips:
            - "All"       (default selected)
            - "Completed"
            - "Ignored"
            - "Deferred"
          behavior: tap chip → filter list

    - zone: PATTERN_INSIGHT
      show_if: patterns detected from last 7 days
      contents:
        - insight_text:
            examples:
              - "You complete tasks 3× more on Tuesday mornings"
              - "78% of your snoozed items never come back"
              - "Your completion rate dropped 40% this week"
          style: 13px, muted, amber left-border if negative, accent if positive
      show_max: 1 insight (highest relevance)

    - zone: TIMELINE_LIST
      group_by: date (today, yesterday, this week, earlier)
      per_item:
        - state_icon:
            done:    filled circle (accent)
            dropped: X mark (muted)
            snoozed: clock icon (muted)
            ignored: dash (very muted)
        - item_text:  (14px)
        - time_label: "2h ago" | "Yesterday 4pm" (12px, muted, right)
        - action_row (on swipe or tap for actions):
            - "Mark wrong" → thumbs_down feedback
            - "Restore"    → re-opens item (POST /api/action undo-like)
            - "Why?"       → shows explanation for why system ranked this

      empty_state:
        text: "Nothing here yet. Complete some tasks first."

    - zone: FEEDBACK_SUMMARY
      position: sticky bottom
      show_if: user has not given feedback in 48h
      contents:
        - prompt: "Were today's suggestions useful?"
        - actions: "Yes" | "Somewhat" | "No"
      behavior:
        any tap: POST /api/feedback { type: thumbs_up|thumbs_down, targetType: suggestion }
                 → dismiss strip for 48h

# ─── API CALLS ────────────────────────────────────────────────
api:
  on_mount:
    - GET /api/action/history (last 50 actions, paginated)
    - GET /api/metrics/suggestions (pattern insight data)
  on_filter_change:
    - re-filter local data (no API call — already loaded)
  on_mark_wrong:
    - POST /api/feedback { type: thumbs_down, targetType: item, targetId }
  on_restore:
    - POST /api/action/undo
  on_explain:
    - GET /api/explain/:itemId → show Decision Explainer sheet (SU-UI-004)
  on_feedback_strip:
    - POST /api/feedback { type: thumbs_up|thumbs_down, targetType: suggestion }

# ─── VISUAL RULES ─────────────────────────────────────────────
visual:
  timeline_line:    1px dashed var(--border), left-aligned
  state_icon_size:  16px
  group_label:      11px, uppercase, muted, letter-spacing 0.08em
  item_row_height:  52px min
  swipe_actions:    revealed on swipe left (Mark wrong | Restore)

# ─── CONSTRAINTS ──────────────────────────────────────────────
constraints:
  - No analytics graphs — text and icons only
  - Pattern insight: max 1 shown, must be from real data (≥ 5 data points)
  - Restore: only available for items in DONE or DROPPED state
  - Feedback strip: shown max once per 48h per user
  - Infinite scroll: paginate 20 items at a time
  - INV-020: only user's own history
```

---

# SCREEN 07 — SEARCH / ALL ITEMS
**User override. "I can find anything anytime." Required for trust.**

---

```yaml
unit_id:  SU-UI-007
title:    Search
version:  v1
status:   locked

goal: >
  Let the user find any item instantly — by text search or natural language.
  User override of the system's plan. Trust anchor: nothing is lost.
  Two modes: simple text filter (fast) and semantic recall (deep).

# ─── TRIGGER ──────────────────────────────────────────────────
trigger:
  - Tab bar: "Search" (search icon)
  - Swipe down on Command Center
  - ⌘K keyboard shortcut (desktop)

# ─── LAYOUT ──────────────────────────────────────────────────
layout:
  presentation: full_screen (tab)
  keyboard: opens immediately on tab switch

  zones:
    - zone: SEARCH_INPUT
      sticky: true
      contents:
        - input:
            placeholder: "Find anything or ask a question..."
            auto_focus: true
            clear_button: true (shown when text present)
        - mode_toggle:
            options: ["Items", "Ask"]
            default: "Items"
            behavior:
              Items: text filter over all items (local, instant)
              Ask:   semantic recall via POST /api/recall (LLM-powered)

    - zone: FILTER_ROW
      show_if: mode == Items
      contents:
        - state_chips: All | Open | Done | Dropped (horizontal scroll)
        - project_chip: dropdown (if projects exist)
      behavior: stacked filter (state AND project)

    - zone: RESULTS — ITEMS MODE
      show_if: mode == Items
      behavior:
        empty_query: show ALL open items (flat list, sorted by priority)
        with_query:  fuzzy match on canonical_text
      per_item:
        - item_text:     (15px, match highlighted in accent)
        - state_badge:   OPEN | IN_PROGRESS | DONE | DROPPED
        - project_chip:  if set
        - deadline_chip: if set
        - priority_bar:  thin 2px fill bar (shows priority score)
      item_behavior:
        tap:        → Task Intelligence (SU-UI-003)
        swipe_right: → done()
        swipe_left:  → snooze()

    - zone: RESULTS — ASK MODE
      show_if: mode == Ask
      behavior:
        empty_query: show prompt suggestions
          examples:
            - "What did I work on last week?"
            - "What's blocking my most important task?"
            - "What have I promised to deliver?"
        with_query: POST /api/recall { query }
      recall_result:
        - answer_text:    (14px, weight 400, line-height 1.6)
        - intent_label:   "FACT" | "SUMMARY" | "CAUSAL" | "TEMPORAL" (muted, small)
        - confidence_label: "High" | "Medium" | "Low" (muted, small)
        - source_entries:  "Based on [N] entries" (tap to expand list)
        - source_list:     collapsed by default, shows entry snippets on expand
      loading_state:
        text: "Searching your history..." (simple, no spinner overload)
      error_state:
        text: "Couldn't search right now" + retry button

    - zone: EMPTY_STATE
      show_if: query present + no results
      contents:
        - text: "Nothing found for '[query]'"
        - suggestion: "Try a different phrase, or switch to Ask mode"

# ─── API CALLS ────────────────────────────────────────────────
api:
  items_mode:
    on_mount: load all items from local cache (plan/today already loaded)
    on_query_change: filter locally (no API call for text search)
    all_items_needed: GET /api/plan/today already has open items
                      for DONE/DROPPED: GET /api/action/history
  ask_mode:
    on_submit_query: POST /api/recall { query }
      debounce: 500ms after user stops typing
      timeout:  10s (show timeout message if exceeded)
  on_item_action:
    - POST /api/action { type, itemId }

# ─── VISUAL RULES ─────────────────────────────────────────────
visual:
  search_input_bg:    var(--surface)
  search_input_border: none (borderless, large, 18px text)
  result_highlight:   accent color background on matched text
  priority_bar:       2px height, fills to priority * 100%, var(--accent)
  mode_toggle:        segmented control, pill shape
  source_entries:     indented, 12px, muted, expandable

# ─── CONSTRAINTS ──────────────────────────────────────────────
constraints:
  - Items mode: instant local filter — no loading states
  - Ask mode: always show loading state (LLM takes time)
  - Ask mode: answer grounded ONLY in user's entries — system must never fabricate
  - If recall returns empty: "I couldn't find information about that in your history"
  - Never show a blank screen — empty query shows full item list
  - INV-020: only user's own items and entries
  - Rate limit: Ask mode limited to 5 queries/min (show friendly message)
```
