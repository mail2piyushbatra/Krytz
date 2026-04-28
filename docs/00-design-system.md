# FLOWRA — DESIGN SYSTEM
**Locked. Every token, scale, and animation. No ambiguity.**

---

## COLOR TOKENS

```css
/* ─── Light mode ──────────────────────────────────────────── */
:root {
  /* Backgrounds */
  --bg:          #F5F4F0;   /* page background — warm off-white */
  --surface:     #FFFFFF;   /* cards, sheets, overlays */
  --surface-2:   #F0EEE8;   /* inset zones, secondary surfaces */

  /* Text */
  --text:        #1A1A18;   /* primary — near-black, not pure */
  --muted:       #6B6A65;   /* secondary — labels, descriptions */
  --hint:        #A8A7A1;   /* tertiary — placeholders, timestamps */

  /* Borders */
  --border:      #E4E2DA;   /* default border — 0.5px */
  --border-s:    #CBC9C0;   /* stronger border — hover, active */

  /* Accent (primary action color) */
  --accent:      #2D6A4F;   /* primary CTA, focus state, active tabs */
  --accent-l:    #E8F4EF;   /* accent tint — chips, tags, highlights */
  --accent-t:    #1F4E38;   /* accent dark — pressed states */

  /* Semantic */
  --danger:      #C0392B;   /* destructive, overdue, critical */
  --danger-l:    #FAEAEA;   /* danger tint */
  --warn:        #D4821A;   /* warning, amber signals, blockers */
  --warn-l:      #FEF3E2;   /* warn tint */
  --info:        #1A6FA8;   /* informational, links */
  --info-l:      #E6F0FA;   /* info tint */
  --success:     #1D7A4A;   /* done states, positive signals */
  --success-l:   #E8F5EE;   /* success tint */

  /* Radius */
  --radius-sm:   6px;
  --radius-md:   10px;
  --radius-lg:   14px;
  --radius-pill: 999px;
}

/* ─── Dark mode ───────────────────────────────────────────── */
@media (prefers-color-scheme: dark) {
  :root {
    /* Backgrounds */
    --bg:          #141413;
    --surface:     #1E1E1C;
    --surface-2:   #282826;

    /* Text */
    --text:        #E8E6DF;
    --muted:       #8A8982;
    --hint:        #555550;

    /* Borders */
    --border:      #2E2E2B;
    --border-s:    #3E3E3A;

    /* Accent */
    --accent:      #52B788;
    --accent-l:    #1A2E24;
    --accent-t:    #6DCBA0;

    /* Semantic */
    --danger:      #E05C4B;
    --danger-l:    #2A1715;
    --warn:        #E8943A;
    --warn-l:      #2A1E0E;
    --info:        #4A9FD4;
    --info-l:      #0E1E2A;
    --success:     #4ABA78;
    --success-l:   #0E1E15;
  }
}
```

---

## TYPOGRAPHY SCALE
**5 sizes only. Nothing else.**

```css
/* Scale */
--text-xs:   11px;  /* labels, chips, timestamps, uppercase tags */
--text-sm:   13px;  /* secondary body, descriptions, metadata */
--text-md:   15px;  /* primary body, task text in queue */
--text-lg:   18px;  /* section headers, sheet titles */
--text-xl:   22px;  /* primary directive (Command Center focus task) */

/* Weights: 400 (regular) and 500 (medium) only */
/* Never 600, 700 — too heavy against the surface */

/* Line heights */
--lh-tight:  1.3;   /* headlines, single-line labels */
--lh-normal: 1.5;   /* body text */
--lh-loose:  1.7;   /* explanatory text, onboarding */

/* Letter spacing */
--ls-label:  0.07em; /* ALL uppercase labels (xs size) */
--ls-normal: 0;
```

**Usage mapping:**

| Element | Size | Weight | Other |
|---|---|---|---|
| Uppercase section label | xs (11px) | 500 | uppercase, --ls-label, --muted |
| Chip / badge text | xs (11px) | 500 | — |
| Timestamp / metadata | xs (11px) | 400 | --hint |
| Secondary body / description | sm (13px) | 400 | --muted |
| Task text (queue) | md (15px) | 400 | --text |
| Sheet title / screen title | lg (18px) | 500 | --text |
| Primary directive (focus task) | xl (22px) | 500 | --text, --lh-tight |
| Onboarding headline | 28px (exception) | 500 | one-time use only |

---

## GESTURE SYSTEM
**Every gesture locked. No conflicts.**

### Resolution: swipe left

**Decision: swipe left = reveal Quick Actions row (not direct snooze)**

Rationale: revealing actions gives access to snooze, drop, explain, and mark-blocker in one gesture. Direct snooze would require a second swipe for everything else. The extra tap is worth the consistency.

```
Swipe right (>80px):  → done() immediately, card exits right
Swipe left  (>80px):  → reveal Quick Actions row beneath card
                         [Done] [Snooze] [Drop] [Why?]
                         tap action → executes
                         tap card again → dismisses actions

Partial swipe (<80px): → spring back (no action)

Long press (500ms):   → Decision Explainer sheet (OV-04)
                         500ms is the locked threshold everywhere

Tap:                  → Task Intelligence (screen 03)
                         EXCEPT on focus card header → also Task Intelligence

Double tap:           → not used (reserved for future)
```

### Gesture consistency rules
- Swipe right = done on every task card in every screen. No exceptions.
- Swipe left = reveal actions on every task card in every screen. No exceptions.
- Long press = Decision Explainer on every task card. No exceptions.
- Tap = Task Intelligence on every task card. No exceptions.
- If a gesture conflicts with platform scroll: platform wins. Use buttons instead.

---

## ANIMATION SYSTEM

```
/* Standard durations */
--anim-instant:   100ms;  /* state changes (toggle on/off) */
--anim-fast:      200ms;  /* card enter/exit, fade transitions */
--anim-normal:    300ms;  /* sheet open/close, screen transitions */
--anim-slow:      400ms;  /* onboarding transitions */

/* Easing */
--ease-out:       cubic-bezier(0.16, 1, 0.3, 1);    /* most UI */
--ease-spring:    cubic-bezier(0.34, 1.56, 0.64, 1); /* sheets, FAB */
--ease-linear:    linear;                             /* progress bars only */

/* Card done animation (swipe right) */
done_animation:
  1. Card slides right, exits screen (200ms, ease-out)
  2. Cards below animate up to fill space (200ms, ease-out, 50ms delay)
  3. Toast appears: "Done" (fade in 100ms)

/* Card snooze animation (reveal actions, then tap Snooze) */
snooze_animation:
  1. Card slides left 96px revealing action row (200ms, ease-out)
  2. Action tap: card slides off left (200ms, ease-out)
  3. Cards below fill up (200ms, 50ms delay)

/* Spring back (partial swipe cancelled) */
spring_animation:
  card returns to origin (250ms, ease-spring)

/* Sheet open */
sheet_open:
  slides up from bottom (300ms, ease-spring)

/* Screen transitions */
push_forward:  slide in from right (250ms, ease-out)
push_back:     slide out to right (200ms, ease-out)
```

---

## SPACING SCALE

```
4px   — micro gaps (between chip and text)
8px   — tight (between related elements)
12px  — compact (within cards)
16px  — default (screen horizontal padding, card padding)
20px  — comfortable (between sections)
24px  — spacious (major section breaks)
32px  — large (above/below key content)
```

---

## COMPONENT TOKENS

```css
/* Task card */
.task-card {
  background:    var(--surface);
  border:        0.5px solid var(--border);
  border-radius: var(--radius-lg);
  padding:       14px 16px;
}
.task-card.focus {
  border-width:  1.5px;
  border-color:  var(--accent);
}
.task-card.blocker {
  border-left:   3px solid var(--warn);
  border-radius: 0 var(--radius-lg) var(--radius-lg) 0;
}

/* Chip / badge */
.chip {
  font-size:     var(--text-xs);
  font-weight:   500;
  padding:       2px 8px;
  border-radius: var(--radius-pill);
  white-space:   nowrap;
}
.chip-deadline-urgent  { background: var(--danger-l); color: var(--danger); }
.chip-deadline-warning { background: var(--warn-l);   color: var(--warn);   }
.chip-blocking         { background: var(--warn-l);   color: var(--warn);   }
.chip-in-progress      { background: var(--accent-l); color: var(--accent); }
.chip-project          { background: var(--surface-2); color: var(--muted); }

/* Section label */
.section-label {
  font-size:      var(--text-xs);
  font-weight:    500;
  text-transform: uppercase;
  letter-spacing: var(--ls-label);
  color:          var(--hint);
  margin-bottom:  8px;
}

/* Bottom sheet */
.sheet {
  background:    var(--surface);
  border-radius: var(--radius-lg) var(--radius-lg) 0 0;
  box-shadow:    none;  /* no shadows — flat design */
}
.sheet-handle {
  width:         36px;
  height:        4px;
  background:    var(--border-s);
  border-radius: var(--radius-pill);
  margin:        10px auto 0;
}

/* Confidence bar */
.confidence-bar {
  height:        2px;
  background:    var(--border);
  border-radius: var(--radius-pill);
}
.confidence-bar-fill {
  height:        100%;
  background:    var(--accent);
  border-radius: var(--radius-pill);
  transition:    width 300ms var(--ease-out);
}

/* Priority bar (in Search) */
.priority-bar {
  height:     2px;
  background: var(--border);
}
.priority-bar-fill {
  height:     100%;
  background: var(--accent);
  opacity:    0.6;
}

/* FAB */
.fab {
  width:         52px;
  height:        52px;
  background:    var(--accent);
  border-radius: var(--radius-pill);
  position:      fixed;
  bottom:        80px;  /* above tab bar */
  right:         16px;
}
```

---

## ICON SET
**Minimal. Every icon named.**

```
Navigation:
  home / grid-2x2     Command Center tab
  compass             Strategic View tab
  clock               Timeline tab
  search              Search tab
  plus                FAB (Rapid Capture)
  settings / gear     Settings (from header)
  bell                Notifications (from header)

Actions:
  check               Done
  clock-snooze        Snooze
  trash-2             Drop
  info                Why? / Explain
  git-branch          Break down (subtasks)
  alert-triangle      Mark as blocker
  calendar            Reschedule
  terminal            Command Palette

Status:
  circle-check        Done state
  x-circle            Dropped state
  clock               Snoozed state
  minus               Ignored state
  arrow-right         In progress

Misc:
  chevron-left        Back button
  x                   Close / dismiss
  more-horizontal     Overflow menu
  mic                 Voice capture (V2)
  grip-vertical       Drag handle (subtasks)

Icon library: Lucide (MIT license, consistent stroke width)
Size: 18px default, 16px in chips/tags, 20px in FAB
Stroke-width: 1.5px everywhere (Lucide default)
Color: inherits --muted unless semantic (done=accent, drop=danger)
```
