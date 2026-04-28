# FLOWRA — MISSING SPECS (P0 + P1 RESOLVED)
**Every unhappy path. Every edge case. Locked.**

---

# PASSWORD RESET FLOW
**P0. Missing from all 14 surfaces. User gets locked out without this.**

---

```yaml
unit_id:  SU-UI-AUTH-RESET
title:    Password Reset Flow
version:  v1
status:   locked

goal: >
  User who forgets password can recover account via email token.
  3 steps: request → email → new password. Under 2 minutes.

flow:
  step_1_request:
    trigger: "Forgot password?" link on auth screen (below sign in button)
    screen:
      headline: "Reset your password"
      input:    email field (auto-filled if user typed email before tapping)
      cta:      "Send reset link"
      back:     "← Back to sign in"
    behavior:
      on_submit:
        - POST /api/auth/reset-request { email }
        - INV-003: always return 202 regardless of whether email exists
        - Show: "If that email is registered, you'll receive a link shortly."
        - Never say: "Email not found" or "Check your inbox" conditionally
      on_success: show confirmation screen (same screen, swaps content)

  confirmation_screen:
    headline: "Check your email"
    body:     "We've sent a reset link to [email]. It expires in 1 hour."
    subtext:  "Didn't receive it? Check spam, or try again in a minute."
    cta:      "Try again" (re-submits after 60s cooldown)
    back:     "← Back to sign in"

  step_2_email:
    content:
      subject: "Reset your Flowra password"
      body: |
        Hi,
        Click the link below to reset your password.
        This link expires in 1 hour and can only be used once.
        [Reset password →]
        If you didn't request this, ignore this email.
      link: https://app.flowra.com/auth/reset?token=[secure_token]

  step_3_new_password:
    trigger: user taps link in email → opens app / browser
    screen:
      headline: "Choose a new password"
      input_1:  "New password" (min 8 chars)
      input_2:  "Confirm password"
      cta:      "Set new password"
    validation:
      - passwords must match
      - min 8 characters
      - token must be valid and unexpired
    behavior:
      on_success:
        - POST /api/auth/reset-confirm { token, newPassword }
        - Show: "Password updated. Sign in with your new password."
        - Navigate: → auth screen (login tab active)
      on_expired_token:
        - Show: "This link has expired. Request a new one."
        - CTA: "Request new link" → step_1_request
      on_invalid_token:
        - Show: "Invalid link. Please request a new one."

api_endpoints_needed:
  - POST /api/auth/reset-request   # always 202, sends email if user exists
  - GET  /api/auth/reset/validate  # checks token validity (for deep link)
  - POST /api/auth/reset-confirm   # sets new password, invalidates token

constraints:
  - Token: 32-byte random hex, hashed in DB, expires 1h, single-use
  - INV-003: request endpoint always 202 — never reveals email existence
  - Rate limit: 3 reset requests per email per hour
  - Token invalidated immediately after use
  - Log all reset attempts for security audit
```

---

# TOKEN EXPIRY — MID-SESSION RECOVERY
**P0. Silent auth failure destroys trust.**

---

```yaml
unit_id:  SU-UI-AUTH-EXPIRY
title:    Token Expiry Handling
version:  v1
status:   locked

goal: >
  When JWT expires mid-session, recover silently if possible.
  If not, show clear message and preserve user's work.
  Never lose data. Never show a raw 401 error.

flow:
  intercept_layer:
    where: API wrapper function (all calls go through this)
    behavior:
      on_401_response:
        step_1: attempt silent token refresh
          POST /api/auth/refresh with current token (ignoreExpiration: true)
          if_success:
            - store new token
            - retry original request with new token
            - user notices nothing
          if_fail:
            - preserve any unsaved capture input in localStorage
            - show session_expired_modal

  session_expired_modal:
    presentation: full-screen overlay (not dismissable)
    headline: "Your session expired"
    body:     "Sign in again to continue. Your data is safe."
    input_1:  password field (email pre-filled, not editable)
    cta:      "Sign in"
    behavior:
      on_success:
        - store new token
        - dismiss modal
        - retry any failed actions
        - restore any preserved capture input
      on_different_account:
        - show: "Sign in as [email] to continue, or start fresh."

  capture_preservation:
    if user had text in capture input when expiry hit:
      - save to localStorage key: 'flowra_pending_capture'
      - after re-auth: restore text to capture input
      - show toast: "Your unsaved entry was restored"

constraints:
  - Never show raw "401 Unauthorized" to user
  - Never lose capture input to auth failure
  - Silent refresh must complete within 2s or show modal
  - Modal email field pre-filled and read-only (user confirms identity)
```

---

# ITEM EDIT
**P0. User captured wrong text. No way to fix it anywhere in current specs.**

---

```yaml
unit_id:  SU-UI-EDIT
title:    Item Edit
version:  v1
status:   locked

goal: >
  User can correct the text of any captured item.
  Inline, fast, no modal. Edited text replaces canonical_text.
  History updated to record the edit.

trigger:
  - Tap the overflow menu "⋮" on Task Intelligence screen
    → "Edit text" option in dropdown
  - Long press on item text in Task Intelligence (2s threshold)

layout:
  presentation: inline on Task Intelligence screen
  behavior:
    on_trigger:
      - item text transforms to editable textarea
      - cursor placed at end of text
      - keyboard opens
      - confirm/cancel buttons appear below textarea:
          cancel: "Cancel" (restores original, no API call)
          save:   "Save" (filled, accent)

    on_save:
      - PATCH /api/items/:id { canonical_text: newText }
      - text field returns to read-only display
      - show brief inline confirmation: checkmark icon, 1s
      - plan cache invalidated (text change affects search)

    on_cancel:
      - text field returns to original, no change

    validation:
      - empty text: "Save" button disabled
      - unchanged text: "Save" button disabled (no-op)
      - max 10000 chars (same as capture)

api:
  PATCH /api/items/:id
    body: { canonical_text: string }
    response: 200 { ok: true, item: { id, canonical_text } }
    auth: required, INV-020: user must own item

constraints:
  - Edit is in-place on Task Intelligence — not a separate screen
  - No bulk edit (edit one item at a time)
  - Edit history: item_events logs the change as: from_state=OPEN, to_state=OPEN, reason='text_edited'
  - Re-embedding: PATCH triggers background re-embed of new text (async)
  - Plan cache invalidated after successful edit
```

---

# ERROR RECOVERY — ALL ACTION FAILURES
**P0. API fails mid-action. What does user see?**

---

```yaml
unit_id:  SU-UI-ERROR-RECOVERY
title:    Action Error Recovery
version:  v1
status:   locked

goal: >
  Every destructive action (done, snooze, drop) is optimistic.
  If the API fails, the user sees clear recovery options.
  No silent data loss. No confusing state.

pattern:
  optimistic_flow:
    step_1: user triggers action (swipe right = done)
    step_2: UI executes animation immediately (card slides out)
    step_3: API call fires in background
    step_4a: API success → done. No further action.
    step_4b: API failure → recovery flow

  recovery_flow_on_failure:
    step_1: card slides back in (reverse animation, 300ms)
    step_2: card shows error state:
              - red left border (2px, var(--danger))
              - error text below item: "Couldn't [action]. Tap to retry."
            style: same card, error state added
    step_3: retry button (in-card, small, muted): "Retry"
            dismiss option: "×" (removes error state, item stays in list)
    step_4: retry → re-attempts API call
            if success: normal done animation
            if fail again: persistent error state, "Try again later"

  error_messages:
    done_failed:    "Couldn't mark as done. Tap to retry."
    snooze_failed:  "Couldn't snooze. Tap to retry."
    drop_failed:    "Couldn't drop. Tap to retry."
    capture_failed: "Couldn't save. Tap to retry." (capture sheet stays open)
    generic:        "Something went wrong. Tap to retry."

  never_show:
    - HTTP status codes
    - Error codes (INTERNAL_ERROR, etc.)
    - Stack traces
    - Network error details
    - INV-016: enforced here too

  specific_errors:
    429_rate_limit:
      capture: re-open capture sheet + "Hourly limit reached. Try in [N] min."
      action:  show inline: "Rate limit hit. Try in [N] min."
    401_expired:
      → trigger token expiry flow (SU-UI-AUTH-EXPIRY)
    503_server_down:
      → show global banner: "Flowra is having issues. Your data is safe."
      → retry automatically every 30s

constraints:
  - optimistic UI mandatory for all action types — never block on API
  - card must animate back on failure — never leave orphaned empty space
  - all retries: same idempotent call with same parameters
  - if 3 retries fail: "Something's wrong. Check your connection."
```

---

# NOTIFICATIONS PANEL
**P1. Bell icon in header goes nowhere. Backend generates notifications constantly.**

---

```yaml
unit_id:  SU-UI-NOTIFICATIONS
title:    Notifications Panel
version:  v1
status:   locked

goal: >
  Surface commitment reminders, conflict alerts, and system notifications.
  Not a feed. Not a dashboard. A triage panel: act or dismiss.

trigger:
  - Tap bell icon in Command Center header
  - Bell icon shows unread badge (red dot) when unread_count > 0

layout:
  presentation: full_screen_push (not a sheet — needs space)

  zones:
    - zone: HEADER
      contents:
        - title: "Notifications" (18px, weight 500)
        - mark_all_read: "Mark all read" (right, muted, shown if unread > 0)
        - back: "←"

    - zone: NOTIFICATION_LIST
      group_by: today | earlier
      per_notification:
        - type_icon:
            COMMITMENT_DUE:    clock icon (warn color)
            CONFLICT_DETECTED: warning icon (danger color)
            BLOCKER_ALERT:     alert icon (warn color)
            SYSTEM:            info icon (muted)
        - title: notification.title (14px, weight 500 if unread, 400 if read)
        - body:  notification.body (13px, muted, max 2 lines)
        - time:  relative time (11px, hint)
        - unread_indicator: 6px dot (accent) left of row if unread
        - action_row (on tap to expand):
            COMMITMENT_DUE:
              - "View commitment" → Strategic View commitments section
              - "Mark fulfilled"  → POST /api/commitments/:id/fulfill
            CONFLICT_DETECTED:
              - "View conflict"   → Strategic View contradictions section
              - "Dismiss"         → POST /api/contradictions/:id/resolve
            BLOCKER_ALERT:
              - "View task"       → Task Intelligence for that item
              - "Dismiss"

      empty_state:
        icon:  bell (muted, large)
        text:  "No notifications"
        sub:   "Commitment reminders and conflict alerts will appear here."

  swipe_to_dismiss:
    swipe_left on notification → dismiss (POST /api/notifications/:id/read)

api:
  on_mount:
    - GET /api/notifications (last 50, unread first)
  on_mark_all_read:
    - POST /api/notifications/read-all
  on_notification_tap:
    - POST /api/notifications/:id/read (marks as read)
    - navigate to relevant screen

bell_badge:
  source: GET /api/notifications response unread_count
  update: on app foreground + every 5min polling
  display:
    0:    no badge
    1–9:  number
    10+:  "9+"

os_push_notifications:
  V1:   not implemented (polling only)
  V2:   web push API + service worker

constraints:
  - Max 100 notifications stored per user
  - Auto-expire after 30 days
  - Never show notification for actions user just took (avoid duplicate noise)
  - Mark read on tap (not on view — user may not see the expansion)
```

---

# OFFLINE STATE
**P1. App opened with no connection — not specced anywhere.**

---

```yaml
unit_id:  SU-UI-OFFLINE
title:    Offline State Handling
version:  v1
status:   locked

goal: >
  App works meaningfully when offline.
  User can see their last known plan.
  Captures are queued and sync on reconnect.
  No crashes. No blank screens.

detection:
  method: navigator.onLine + fetch probe (GET /health every 30s)
  events:
    online:  clear offline banner, sync queue, refresh plan
    offline: show offline banner, switch to cached data

offline_banner:
  position: sticky top (below header)
  style:    amber background (warn-l), warn text
  text:     "Offline — showing last updated plan"
  height:   32px
  dismiss:  not dismissable (auto-hides when online)

cached_data_strategy:
  plan_cache:
    store: localStorage key 'flowra_plan_cache'
    on_successful_plan_fetch: update cache with timestamp
    on_offline: serve from cache with "Last updated [X] ago" banner
    if_no_cache: "No data yet. Connect to the internet to load your plan."

capture_queue:
  store: localStorage key 'flowra_capture_queue' (array of pending captures)
  on_offline_capture:
    - add to queue: { raw_input, source, captured_at, local_id }
    - show optimistic item in plan: greyed out + "Queued" chip
    - toast: "Saved locally — will sync when online"
  on_reconnect:
    - drain queue: POST /api/capture for each queued item (sequential)
    - on_success: remove from queue, update item to normal state
    - on_failure: keep in queue, retry next reconnect
    - show toast: "[N] items synced"

actions_while_offline:
  done / snooze / drop:
    - queue the action locally (localStorage key 'flowra_action_queue')
    - execute optimistic UI update
    - toast: "Action saved — will sync when online"
    - on_reconnect: drain action queue before capture queue

constraints:
  - Never show blank screen when offline — always show last known state
  - Queued captures persist across app restarts (localStorage)
  - Queue drain order: actions first, then captures (preserves causality)
  - If offline for > 24h: "Plan may be outdated — connect to refresh"
  - Offline mode: read-only for plan (no refetch), write-capable via queue
```

---

# MULTI-CAPTURE
**P1. User pastes a list — behavior undefined.**

---

```yaml
unit_id:  SU-UI-MULTI-CAPTURE
title:    Multi-line Capture Handling
version:  v1
status:   locked

goal: >
  When user pastes or types multiple lines in capture,
  offer to split into separate items.
  Decision: split is opt-in, not automatic.

detection:
  trigger: capture input contains 2+ newlines
  threshold: ≥ 2 line breaks in input

behavior:
  on_detection:
    - show inline hint below input:
        "Looks like multiple items. Split into separate tasks?"
        [Split] [Keep as one]
      style: 12px, muted, accent buttons

  on_split_chosen:
    - parse lines: split on \n, filter empty lines
    - show preview: numbered list of items to be created
      "[1] Call the client
       [2] Send the proposal
       [3] Book flights"
    - confirm button: "Add [N] tasks"
    - cancel: "Keep as one"
    - on_confirm: POST /api/capture for each line (sequential, not parallel)
    - progress indicator: "Adding 2 of 3..."
    - completion toast: "3 tasks added"

  on_keep_as_one:
    - submit as single capture (existing behavior)

  paste_detection:
    - on paste event: check line count immediately
    - if > 10 lines: cap at 10 + "First 10 items only. Edit or delete below."

constraints:
  - Never auto-split without user confirmation
  - Max split: 10 items per multi-capture
  - Empty lines ignored in split
  - Each split item ≤ 5000 chars (truncate with indicator if exceeded)
  - If API fails on one split item: show "3 of 4 added. 1 failed." + retry
```

---

# ITEM EDIT API ENDPOINT
**Required backend addition for P0 item edit spec.**

```javascript
// Add to support.routes.js or product.routes.js

// PATCH /api/items/:id — edit item text
router.patch('/items/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { canonical_text } = req.body;
  const userId = req.user.id;

  if (!canonical_text?.trim()) {
    return res.status(400).json({ error: 'canonical_text required' });
  }
  if (canonical_text.length > 10000) {
    return res.status(400).json({ error: 'Text too long' });
  }

  const { rows } = await db.query(
    `UPDATE items
     SET canonical_text = $1, updated_at = now()
     WHERE id = $2 AND user_id = $3
     RETURNING id, canonical_text`,
    [canonical_text.trim(), id, userId]
  );

  if (rows.length === 0) {
    return res.status(404).json({ error: 'Item not found' });
  }

  // Log edit in item_events
  await db.query(
    `INSERT INTO item_events(id, item_id, from_state, to_state, reason)
     SELECT uuid_generate_v4(), $1, state, state, 'text_edited'
     FROM items WHERE id = $1`,
    [id]
  );

  // Invalidate plan cache (async — don't block response)
  invalidatePlanCache(db, userId).catch(() => {});

  // Queue re-embed (async)
  // embed(canonical_text).then(vec => db.query(
  //   `UPDATE items SET embedding=$1 WHERE id=$2`, [vec, id]
  // )).catch(() => {});

  res.json({ ok: true, item: rows[0] });
}));
```

---

# INTERACTION AMBIGUITIES — ALL RESOLVED

```yaml
resolved_decisions:

  swipe_left_behavior:
    decision: reveal Quick Actions row (96px reveal)
    not:      direct snooze
    rationale: gives access to all actions, not just snooze

  long_press_threshold:
    decision: 500ms
    applies:  every task card, every screen
    haptic:   light impact feedback at threshold (mobile)

  long_press_target:
    decision: always opens Decision Explainer (SU-UI-004)
    not:      Task Intelligence
    tap:      always opens Task Intelligence

  done_card_animation:
    decision: slides right, exits screen right
    duration: 200ms ease-out
    fill:     cards below animate up 200ms with 50ms delay

  capture_enter_key:
    desktop:  Enter = submit (Shift+Enter = newline)
    mobile:   Enter = newline (Submit button for submit)
    rationale: mobile keyboards can't reliably detect Shift+Enter

  midnight_transition:
    decision: silent background refresh
    if_app_open: banner appears: "Plan updated for today" (3s, auto-dismiss)
    no_forced_navigation: user stays on current screen

  command_palette_ambiguity:
    text_matches_command: show command result in group_1 (ACTIONS)
    text_matches_item:    show item in group_2 (ITEMS)
    text_matches_both:    show commands first, then items
    neither:              "No results. Try 'capture', 'show tasks', or 'undo'."

  typography_cuts:
    keep:   11px (labels), 13px (secondary), 15px (body), 18px (titles), 22px (directive)
    remove: 12px, 14px, 16px, 20px, 28px (28px exception for onboarding only)

  color_chip_urgency:
    deadline_days <= 0:  danger chip "Overdue"
    deadline_days == 1:  danger chip "Tomorrow"
    deadline_days <= 3:  warn chip "[N] days"
    deadline_days <= 7:  muted chip "[N] days"
    deadline_days > 7:   no chip shown

  project_creation:
    decision: system auto-creates from item.project field in captures
    manual:   user can rename by tapping project chip → inline rename
    no:       no separate "Create project" screen in V1

  waiting_for_items:
    decision: captured items containing "waiting on [person]" or "pending [person]"
              are extracted with type=WAITING_FOR during ingest
    display:  greyed card, clock icon, "Waiting on [name]" label
    ranking:  NOT ranked in plan (excluded from today plan)
    shown_in: Critical Signals section if overdue, Search (all items)
    V1:       basic implementation — pattern matching only
    V2:       ML-based classification
```
