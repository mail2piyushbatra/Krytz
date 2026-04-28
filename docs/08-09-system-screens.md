# FLOWRA — SCREEN SPECS (PART 3)
## System Screens 08–09
**ASP-GCP Minimal Mode — Locked**

---

# SCREEN 08 — SETTINGS
**Control. Not a feature dump. Only what users actually need.**

---

```yaml
unit_id:  SU-UI-008
title:    Settings
version:  v1
status:   locked

goal: >
  Give users meaningful control over notifications, timezone, AI behaviour,
  and their data. Minimal. No feature graveyard.
  Every setting must have a clear user-facing reason to exist.

# ─── TRIGGER ──────────────────────────────────────────────────
trigger:
  - Profile avatar / gear icon (top right of Command Center header)
  - Not in tab bar — low-frequency screen

# ─── LAYOUT ──────────────────────────────────────────────────
layout:
  presentation: full_screen_push
  scroll: vertical, grouped sections

  zones:
    - zone: PROFILE
      contents:
        - avatar: initials circle (accent color, 48px)
        - name:   email address (14px)
        - tier_badge: "Free" | "Pro" | "Team" (small pill, muted or accent)
      behavior:
        tap tier_badge: → billing section / upgrade flow

    - zone: SECTION — PREFERENCES
      label: "Preferences"
      settings:
        - timezone:
            label: "Timezone"
            value: current timezone (e.g. "Asia/Kolkata")
            type:  picker → timezone list
            api:   PATCH /api/profile { timezone }
            why:   "Used to calculate deadlines and daily resets correctly"

        - focus_hours:
            label: "Focus hours per day"
            value: "6" (default)
            type:  stepper (1–12)
            api:   PATCH /api/profile { focus_hours_per_day }
            why:   "Used for capacity calculations"

        - week_start:
            label: "Week starts on"
            value: "Monday" (default)
            type:  toggle: Monday | Sunday
            api:   PATCH /api/profile { week_start }

    - zone: SECTION — NOTIFICATIONS
      label: "Notifications"
      settings:
        - daily_briefing:
            label: "Daily briefing"
            value: "9:00 AM" (editable time)
            type:  time_picker
            toggle: on/off
            api:   PATCH /api/profile { notifications: { daily_briefing } }

        - commitment_reminders:
            label: "Commitment reminders"
            description: "Alert when a commitment is approaching its due date"
            type:  toggle on/off (default on)
            api:   PATCH /api/profile { notifications: { commitments } }

        - conflict_alerts:
            label: "Conflict alerts"
            description: "Alert when the system detects conflicting deadlines"
            type:  toggle on/off (default on)
            api:   PATCH /api/profile { notifications: { conflicts } }

    - zone: SECTION — AI CONTROL
      label: "AI Control"
      description: "Transparent control over what the system does automatically"
      settings:
        - ai_ranking:
            label: "Smart ranking"
            description: "System reorders tasks based on patterns and signals"
            type:  toggle on/off (default on)
            if_off: "Tasks sorted by capture date only"
            api:   PATCH /api/profile { ai: { ranking_enabled } }

        - commitment_extraction:
            label: "Detect commitments"
            description: "System identifies promises to others in your captures"
            type:  toggle on/off (default on)
            api:   PATCH /api/profile { ai: { commitments_enabled } }

        - contradiction_detection:
            label: "Conflict detection"
            description: "System flags impossible schedules and conflicting deadlines"
            type:  toggle on/off (default on)
            api:   PATCH /api/profile { ai: { conflicts_enabled } }

        - cost_visibility:
            label: "AI usage today"
            type:  read_only display
            value: GET /api/metrics/costs → "[N] credits used / [max] daily limit"
            description: "Flowra uses AI for extraction and recall"

    - zone: SECTION — DATA
      label: "Your Data"
      settings:
        - export:
            label: "Export all data"
            type:  button → GET /api/export/json (V2)
            show:  grayed out with "Coming soon" in V1

        - account_info:
            label: "Member since"
            value: user.created_at formatted
            type:  read_only

    - zone: SECTION — DANGER ZONE
      label: "Account"
      settings:
        - sign_out:
            label: "Sign out"
            type:  button (muted)
            action: clear token → auth screen

        - delete_account:
            label: "Delete account and all data"
            type:  button (red text, no fill)
            behavior:
              tap: confirmation dialog:
                "This permanently deletes all your tasks, history, and data.
                 You have 24 hours to cancel."
              confirm: DELETE /api/auth/me/gdpr
              shows:   "Deletion scheduled. You'll be signed out now."

    - zone: SECTION — LEGAL
      label: ""
      settings:
        - version:   "Flowra 1.0.0" (read-only, small, muted)
        - privacy:   link to privacy policy
        - terms:     link to terms

# ─── API CALLS ────────────────────────────────────────────────
api:
  on_setting_change:
    - PATCH /api/profile { [changed field] }
    - debounce: 1000ms (don't fire on every keystroke)
    - success: no visible confirmation (instant feel)
    - error:   "Couldn't save. Try again." brief toast
  on_delete_account:
    - DELETE /api/auth/me/gdpr
    - POST /api/auth/me/gdpr/cancel (if user cancels within 24h)
  on_sign_out:
    - local only: clear JWT from storage → redirect to auth

# ─── VISUAL RULES ─────────────────────────────────────────────
visual:
  section_label:    12px, uppercase, muted, letter-spacing 0.06em
  setting_row:      48px min height, label left, value/control right
  description_text: 12px, muted, below label when present
  danger_section:   no visual treatment — just red text on buttons
  toggle:           native system toggle component

# ─── CONSTRAINTS ──────────────────────────────────────────────
constraints:
  - Maximum 4 sections in V1
  - Every setting must have a user-facing "why" (description field)
  - AI Control section must exist — users must be able to turn off AI features
  - Export grayed out in V1 (not removed — users see it's coming)
  - Delete account: 24h grace period enforced server-side
  - INV-003: never show other users' info
  - Settings changes take effect immediately — no "Save" button
```

---

# SCREEN 09 — ONBOARDING
**3 screens. One-time. Activation + trust. Never shown again.**

---

```yaml
unit_id:  SU-UI-009
title:    Onboarding
version:  v1
status:   locked

goal: >
  Activate the user in under 60 seconds.
  Set the right expectation: this is not a todo app.
  It's a system that computes what matters and tells you what to do.
  Build immediate trust. Get first capture.

# ─── TRIGGER ──────────────────────────────────────────────────
trigger:
  - First launch after registration only
  - Never shown again after completion
  - Skip button always visible (respects user's time)

# ─── FLOW ────────────────────────────────────────────────────
flow:
  screens: 3 (strict maximum)
  navigation: full-width swipe or "Next" button
  progress: 3 dots below content

# ─── SCREEN 09A — WHAT FLOWRA DOES ────────────────────────────
onboarding_1:
  headline: "You don't manage tasks."
  subline:  "Flowra does."
  body: |
    Capture anything — tasks, ideas, notes, commitments.
    Flowra figures out what matters and tells you what to do next.
    You just execute.
  visual:
    type: simple illustration (not screenshot)
    content: three lines of text becoming one highlighted directive
    style: minimal, large type, single accent line
  cta: "Next →"

# ─── SCREEN 09B — HOW IT WORKS ────────────────────────────────
onboarding_2:
  headline: "Three things. That's it."
  body: |
    [1] CAPTURE — dump anything, any time
    [2] TODAY — see what to do right now
    [3] WHY — understand every decision
  visual:
    type: three numbered items with simple icons
    style: monospaced number, 16px label, minimal
  trust_line: "No setup. No categories. No manual sorting."
  cta: "Next →"

# ─── SCREEN 09C — FIRST CAPTURE ───────────────────────────────
onboarding_3:
  headline: "What's on your mind?"
  subline:  "Add your first task. Anything."
  visual:
    type: embedded capture input (real, not a demo)
    placeholder: "e.g. Finish the proposal by Friday"
    auto_focus: true
  trust_line: |
    Flowra never sells your data. Your information stays private.
    You can export or delete everything anytime.
  cta_primary:   "Add and start →" (submits capture + completes onboarding)
  cta_secondary: "Skip for now" (completes onboarding, no capture)
  behavior:
    on_submit:
      1. POST /api/capture { raw_input }
      2. Mark onboarding complete in local storage
      3. Navigate to Command Center
    on_skip:
      1. Mark onboarding complete in local storage
      2. Navigate to Command Center (cold start state)

# ─── VISUAL RULES ─────────────────────────────────────────────
visual:
  background:     var(--bg) — same as rest of app (no special onboarding color)
  headline_size:  28px, weight 500
  body_size:      16px, weight 400, line-height 1.7
  trust_line:     13px, muted, center-aligned
  progress_dots:  4px circles, accent = active, muted = inactive
  cta_position:   fixed bottom, 16px from edges
  skip_position:  top right, muted text, always visible

# ─── CONSTRAINTS ──────────────────────────────────────────────
constraints:
  - Exactly 3 screens — never more, never fewer
  - No feature tour, no gif animations, no modal popups within onboarding
  - Skip always visible — never trap the user
  - Screen 3 capture is real — data goes to the real API
  - Trust line on screen 3 is mandatory — privacy first message
  - Onboarding state stored in localStorage — not server-side
  - If user refreshes during onboarding: restart from screen 1 (stateless)
  - Never shown again once completed — even if user clears app data (use server flag too)
```
