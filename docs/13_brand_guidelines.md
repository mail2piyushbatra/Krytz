# Flowra — Brand Guidelines

> **Version:** 1.0 | **Date:** April 2026  
> **Note:** Name "Flowra" confirmed. Backup name: "Pulse"

---

## 1. Brand Identity

### 1.1 Mission

> Help people reconstruct what's happening in their lives without thinking about it.

### 1.2 Tagline

**Primary:** "Your life, reconstructed."  
**Secondary:** "Dump everything. See everything."  
**Technical:** "State-aware personal tracking."

### 1.3 Brand Personality

| Trait | How It Shows Up |
|---|---|
| **Calm** | Quiet UI, no aggressive notifications, soft animations |
| **Intelligent** | Extracts meaning without being told, surfaces patterns |
| **Honest** | Shows reality as-is. No gamification tricks. No vanity metrics. |
| **Minimal** | Every element earns its place. No clutter. |
| **Reliable** | Always there when you need it. Fast. Consistent. |

### 1.4 Voice & Tone

| Context | Tone | Example |
|---|---|---|
| **Empty state** | Warm, inviting | "Your day is a blank page. What's happening?" |
| **State summary** | Clear, factual | "3 items open. 1 blocker since Tuesday." |
| **Nudge** | Gentle, not pushy | "You haven't captured anything today. All good?" |
| **Error** | Honest, helpful | "Something went wrong. Your data is safe. Try again." |
| **Achievement** | Subtle, not gamified | "5 items completed today." (no confetti, no streaks) |
| **Marketing** | Confident, direct | "Stop organizing. Start knowing." |

**Writing Rules:**
- Short sentences. No jargon.
- Address user as "you" (never "the user")
- Never use: "excited", "revolutionary", "game-changing", "leverage"
- Preferred words: clear, aware, simple, real, track, state, capture

---

## 2. Logo

### 2.1 Concept

The Flowra logo combines a **pulse/wave motif** (representing continuous state awareness) with clean, modern typography.

### 2.2 Logo Variants

| Variant | Use Case |
|---|---|
| **Glyph + Wordmark** | Primary — app header, marketing, social |
| **Glyph only** | App icon, favicon, small spaces |
| **Wordmark only** | Large format, print, presentations |

### 2.3 App Icon Spec

```
Shape: Rounded square (iOS/Android standard)
Background: Deep purple gradient (#6c5ce7 → #4834d4)
Glyph: White pulse/wave mark — abstract "F" or wave
Size: 1024x1024 master, auto-generated variants
```

### 2.4 Clear Space

- Minimum clear space around logo = height of the "F" in Flowra
- Never crowd the logo with other elements

---

## 3. Color System

### 3.1 Primary Palette

| Name | Hex | Usage |
|---|---|---|
| **Purple 500** (Brand) | `#6c5ce7` | Primary actions, brand elements |
| **Purple 400** | `#7c6cf7` | Hover/pressed states |
| **Purple 600** | `#5a4bd6` | Active/focused states |
| **Purple Glow** | `rgba(108, 92, 231, 0.15)` | Glow effects, focus rings |

### 3.2 Semantic Colors

| Name | Hex | Usage |
|---|---|---|
| **Action Red** | `#ff6b6b` | Action items, alerts |
| **Blocker Amber** | `#ffa502` | Blockers, warnings |
| **Done Green** | `#2ed573` | Completed items, success |
| **Deadline Blue** | `#3498db` | Deadlines, info |

### 3.3 Dark Mode (Default)

| Token | Hex | Usage |
|---|---|---|
| `bg-primary` | `#0a0a0f` | Main background |
| `bg-secondary` | `#12121a` | Cards, panels |
| `bg-tertiary` | `#1a1a2e` | Elevated surfaces |
| `text-primary` | `#e8e8ed` | Main text |
| `text-secondary` | `#8888a0` | Subdued text |
| `text-tertiary` | `#55556a` | Hints, timestamps |
| `border-subtle` | `rgba(255,255,255,0.06)` | Dividers |

### 3.4 Light Mode

| Token | Hex | Usage |
|---|---|---|
| `bg-primary` | `#f8f8fc` | Main background |
| `bg-secondary` | `#ffffff` | Cards, panels |
| `bg-tertiary` | `#ededf5` | Elevated surfaces |
| `text-primary` | `#1a1a2e` | Main text |
| `text-secondary` | `#6b6b80` | Subdued text |
| `text-tertiary` | `#9999aa` | Hints |

---

## 4. Typography

### 4.1 Font Family

**Primary:** Inter (Google Fonts)  
**Fallback:** -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif  
**Monospace (code/data):** 'JetBrains Mono', 'Fira Code', monospace

### 4.2 Type Scale

| Name | Size | Weight | Line Height | Usage |
|---|---|---|---|---|
| **Display** | 32px | 700 | 1.2 | Page titles |
| **Heading** | 24px | 600 | 1.3 | Section headers |
| **Subheading** | 18px | 600 | 1.4 | Card titles |
| **Body** | 16px | 400 | 1.5 | Main content |
| **Body Small** | 14px | 400 | 1.5 | Secondary content |
| **Caption** | 12px | 500 | 1.4 | Timestamps, labels |
| **Overline** | 11px | 600 | 1.4 | Category labels (uppercase) |

---

## 5. Iconography

### 5.1 Icon Set

**Primary:** Lucide Icons (open source, consistent, React Native compatible)

### 5.2 Icon Sizes

| Context | Size | Stroke |
|---|---|---|
| Tab bar | 24px | 1.5px |
| Inline (body text) | 16px | 1.5px |
| Header actions | 20px | 1.5px |
| Large/hero | 32px | 1.5px |

### 5.3 Status Icons

| Status | Icon | Color |
|---|---|---|
| Action item | `circle-alert` | `#ff6b6b` |
| Blocker | `alert-triangle` | `#ffa502` |
| Completed | `check-circle` | `#2ed573` |
| Deadline | `clock` | `#3498db` |
| Capture | `plus-circle` | `#6c5ce7` |

---

## 6. Brand Do's and Don'ts

### ✅ Do

- Use the purple palette consistently
- Maintain generous whitespace
- Keep copy short and direct
- Use dark mode as the default experience
- Let the content breathe

### ❌ Don't

- Use gradients on text
- Add decorative elements without purpose
- Use more than 2 font weights per screen
- Use pure black (`#000000`) — always use `#0a0a0f`
- Use emoji in UI elements (okay in marketing)
- Gamify with badges, confetti, or reward animations
