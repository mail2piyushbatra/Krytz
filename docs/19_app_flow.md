# ✦ FLOWRA — App Flow & Navigation Architecture

---

## 1. NAVIGATION STRUCTURE

### Tab Bar (Bottom — 4 tabs + center action)

```
┌─────────────────────────────────────────────┐
│                                             │
│              [Screen Content]               │
│                                             │
├─────────────────────────────────────────────┤
│  🏠        📋        ✦        🔍       ⚙️  │
│ Today    Timeline   [+]     Recall  Settings│
└─────────────────────────────────────────────┘
                       ↑
              Floating action button
              (center, elevated, branded color)
              Tap → Quick capture sheet
              Long press → Voice capture
```

### Screen Map

```
App Launch
  │
  ├── [No token] → Auth Stack
  │     ├── Onboarding (3 slides)
  │     ├── Login
  │     ├── Register
  │     └── Forgot Password
  │
  └── [Has token] → Main Tab Navigator
        │
        ├── Tab 1: TODAY (home)
        │     ├── State Panel (4 cards — tap any card → filtered list)
        │     ├── Carry-overs banner (tap → expand items)
        │     ├── Today Timeline (tap entry → Entry Detail)
        │     └── Weekly Digest card (tap → Digest Detail)
        │
        ├── Tab 2: TIMELINE
        │     ├── Full timeline (grouped by day)
        │     ├── Date picker header (tap → jump to date)
        │     ├── Project filter chips (tap → filter by project)
        │     └── Entry cards (tap → Entry Detail)
        │
        ├── Center: CAPTURE (not a tab — it's a bottom sheet)
        │     ├── Quick-action buttons (✅📋🚫💬)
        │     ├── Text input (auto-expanding)
        │     ├── Project selector
        │     ├── Attachment buttons (📷 camera, 🖼️ gallery, 📄 document)
        │     ├── Voice button (long-press to record)
        │     └── Submit → sheet closes, entry appears in timeline
        │
        ├── Tab 3: RECALL
        │     ├── Query input (top)
        │     ├── Quick suggestions ("What did I do this week?")
        │     ├── AI answer card (with sources)
        │     └── Recent queries list
        │
        └── Tab 4: SETTINGS
              ├── Profile section
              ├── Projects management
              ├── Connectors (connected sources)
              ├── Appearance (theme, widget config)
              ├── Privacy & Data
              ├── Export
              └── Account (logout, delete)
```

---

## 2. SCREEN-TO-SCREEN FLOWS

### Flow A: Capture → State Update (The Core Loop)

```
User opens app
  → Sees TODAY tab (state panel shows: 3 open, 1 blocked, 5 done)
  → Thinks "oh, I finished that auth thing"
  → Taps center [+] button
  → Capture sheet slides up
  → Taps ✅ Done button (pre-selects type)
  → Types "finished auth module"
  → Taps Submit
  → Sheet slides down
  → State panel animates: done count 5 → 6 (roll animation)
  → Entry appears at top of timeline (slide-in animation)
  → Badges fade in staggered (50ms each): "auth" tag, "productive" sentiment
  → Total time: 4 seconds
```

### Flow B: State Panel → Filtered View (Drill Down)

```
User sees state panel: "2 blockers"
  → Taps "Blockers" card
  → Slides right to filtered view (only entries with blockers)
  → Each entry shows the specific blocker text highlighted
  → Taps an entry → Entry Detail screen
  → Can edit entry text → re-extraction triggers
  → Back button → returns to filtered view
  → Back again → Today tab
```

### Flow C: Timeline → Entry Detail → Related

```
Timeline tab
  → Scrolls through days
  → Taps an entry card
  → Entry Detail screen opens (slide from right):
      ┌──────────────────────────┐
      │ ← Back          ⋮ Menu  │
      │                          │
      │ "Call with Rajesh..."    │
      │ 2:30 PM · manual         │
      │ Project: Work            │
      │                          │
      │ ── Extracted State ──    │
      │ 📋 Send proposal by Fri │
      │ 📋 Crunch numbers       │
      │ 🏷️ rajesh, api, meeting │
      │ 😊 focused              │
      │                          │
      │ ── Attachments ──       │
      │ [image_thumb.jpg]       │
      │                          │
      │ ── Related Entries ──   │
      │ "Rajesh followup..."    │
      │ "API pricing draft..."  │
      │                          │
      │ [Edit] [Delete]         │
      └──────────────────────────┘
  → Taps "Related Entries" → navigates to that entry
  → Taps Edit → inline edit mode → save → re-extraction
  → Taps ⋮ Menu → Delete / Share / Move to project
```

### Flow D: Recall → Sources → Entry (Deep Dive)

```
Recall tab
  → Types "what happened with the API pricing?"
  → Loading shimmer plays
  → AI answer card appears:
      ┌──────────────────────────┐
      │ "You discussed API       │
      │  pricing with Rajesh on  │
      │  April 22. He needs a    │
      │  proposal by Friday.     │
      │  You noted you're       │
      │  blocked on pricing      │
      │  data from finance."     │
      │                          │
      │ Sources (3 entries) ▼    │
      └──────────────────────────┘
  → Taps "Sources" → expands to show entry previews
  → Taps any source entry → navigates to Entry Detail
  → Back → Recall tab (query and answer preserved)
```

### Flow E: Settings → Connectors (Connect External Source)

```
Settings tab
  → Taps "Connectors"
  → Connector list:
      ┌──────────────────────────┐
      │ Google Calendar   [Off]  │
      │ Gmail            [Off]  │
      │ Notion           [Off]  │
      └──────────────────────────┘
  → Taps Google Calendar
  → OAuth flow opens (in-app browser)
  → Grants permission
  → Returns to app
  → Scope selection:
      ┌──────────────────────────┐
      │ What to import:          │
      │ ☑ Events                │
      │ ☐ All-day events        │
      │ ☑ Meetings with people  │
      │                          │
      │ Auto-sync: [Daily ▼]    │
      │ [Connect]               │
      └──────────────────────────┘
  → Connected → badge shows on connector
  → Back → Settings (connector shows "Connected · 3 events synced")
```

### Flow F: Onboarding → First Value (60 seconds)

```
App install → First launch
  → Slide 1: "Flowra knows what's going on" (state panel preview)
  → Slide 2: "Just dump it" (capture demo)
  → Slide 3: "Your data stays yours" (privacy promise)
  → Register screen
  → After signup → guided first capture:
      ┌──────────────────────────┐
      │ "What are you working    │
      │  on right now?"          │
      │                          │
      │ [text input]             │
      │                          │
      │ Try: "Need to finish     │
      │  the proposal for       │
      │  Friday's meeting"       │
      │                          │
      │ [Capture This →]         │
      └──────────────────────────┘
  → User types or uses example
  → Submit → instant local extraction
  → TODAY tab appears with:
      ┌──────────────────────────┐
      │ YOUR STATE               │
      │ 1 open · 0 blocked      │
      │ 0 done · 1 deadline     │
      │                          │
      │ ↑ "That's your state.    │
      │   Keep capturing and     │
      │   it gets smarter."      │
      └──────────────────────────┘
  → User thinks "oh, it understood me" → hook established
```

---

## 3. GESTURE MAP

| Gesture | Where | Action |
|---|---|---|
| **Tap** center [+] | Tab bar | Open capture sheet |
| **Long-press** center [+] | Tab bar | Voice capture (hold to record) |
| **Swipe left** on entry | Timeline/Today | Reveal delete button |
| **Swipe right** on entry | Timeline/Today | Reveal quick-actions (done ✅, pin 📌) |
| **Pull down** | Today/Timeline | Refresh state + entries |
| **Swipe down** on capture sheet | Capture sheet | Dismiss/minimize sheet |
| **Tap** state card | Today | Filter entries by that state type |
| **Long-press** entry | Timeline | Multi-select mode |
| **Pinch** | Timeline | Zoom: day view ↔ week view ↔ month view |
| **Swipe between tabs** | Any tab | Switch tabs (disabled in capture sheet) |
| **Shake** | Any screen | Quick capture (accessibility) |

---

## 4. DEEP LINKING

```
flowra://today                    → Today tab
flowra://timeline                 → Timeline tab
flowra://timeline?date=2026-04-24 → Timeline at specific date
flowra://capture                  → Open capture sheet
flowra://capture?type=todo        → Capture sheet with Todo pre-selected
flowra://capture?text=...         → Pre-filled capture (from share sheet)
flowra://entry/{id}               → Entry detail
flowra://recall?q=...             → Recall with pre-filled query
flowra://settings/connectors      → Connector settings
```

**Share sheet integration:** User selects text in any app → Share → Flowra → capture sheet opens with text pre-filled.

---

## 5. WIDGETS (6 Types)

### Widget 1: MICRO STATE (2×1 — smallest)
```
┌───────────────┐
│ ✦ 3·1·5·1    │
│  O  B  D  DL  │
└───────────────┘
```
Open items · Blockers · Done · Deadlines
Tap → opens Today tab

### Widget 2: STATE CARD (2×2 — small square)
```
┌─────────────────┐
│ ✦ FLOWRA Today  │
│                 │
│  📋 3 open      │
│  🚫 1 blocked   │
│  ✅ 5 done      │
│  ⏰ 1 deadline  │
│                 │
│  [+ Capture]    │
└─────────────────┘
```
Tap numbers → opens filtered view
Tap capture → opens capture sheet

### Widget 3: QUICK CAPTURE (4×1 — wide bar)
```
┌─────────────────────────────────┐
│ ✦  [What's happening?]    🎤  │
└─────────────────────────────────┘
```
Tap text → opens capture sheet with keyboard
Tap 🎤 → voice capture

### Widget 4: TODAY TIMELINE (4×2 — medium)
```
┌─────────────────────────────────┐
│ ✦ FLOWRA           3 open      │
├─────────────────────────────────┤
│ 2:30  Call with Rajesh      📋 │
│ 1:15  Blocked on S3 config  🚫 │
│ 12:00 Finished auth module  ✅ │
│                    [+ More]    │
└─────────────────────────────────┘
```
Scrollable, shows last 3 entries with type badges
Tap entry → opens entry detail
Tap "+ More" → opens Timeline tab

### Widget 5: DEADLINES (2×2 — small square)
```
┌─────────────────┐
│ ✦ DEADLINES     │
│                 │
│ ⏰ API Proposal │
│   Friday, Apr 25│
│                 │
│ ⏰ Demo prep    │
│   Monday, Apr 28│
└─────────────────┘
```
Shows upcoming deadlines sorted by date
Red accent for overdue
Tap → opens entry detail

### Widget 6: PROJECT STATE (4×2 — medium)
```
┌─────────────────────────────────┐
│ ✦ PROJECTS                     │
├─────────────────────────────────┤
│ Work       3 open · 1 blocked  │
│ Personal   1 open · 0 blocked  │
│ Flowra     0 open · all done ✓ │
└─────────────────────────────────┘
```
Shows per-project breakdown
Tap project → opens Timeline filtered by project

---

## 6. TRANSITION ANIMATIONS

| Transition | Animation | Duration |
|---|---|---|
| Tab switch | Crossfade | 200ms |
| Capture sheet open | Slide up + backdrop fade | 300ms |
| Capture sheet close | Slide down + backdrop fade | 200ms |
| Entry detail open | Slide from right | 250ms |
| Entry detail close | Slide to right | 200ms |
| State card count change | Number roll (slot machine style) | 400ms |
| New entry appears | Slide down from top + fade in | 300ms |
| Badges appear | Staggered fade in | 50ms each |
| Entry delete | Slide left + height collapse | 300ms |
| Filter view open | Shared element (card expands to screen) | 350ms |
| Pull-to-refresh | Spring bounce | 500ms |
| Voice recording | Pulse animation on button | Continuous |
| AI processing | Shimmer skeleton | Until complete |
