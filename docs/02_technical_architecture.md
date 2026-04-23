# Flowra — Technical Architecture Document (v2)

> **Version:** 2.0 | **Date:** 2026-04-23 | **Status:** Updated  
> **Changes from v1:** Mobile-first (React Native), file uploads in v1, PostgreSQL primary  

---

## 1. Architecture Overview

Flowra is a **modular monolith** for v1, designed for clean extraction into microservices later. Mobile-first.

```
┌───────────────────────────────────────────────────┐
│         Mobile App (React Native + Expo)          │
│                                                   │
│  ┌──────────┐  ┌──────────┐  ┌────────────────┐  │
│  │ Capture  │  │ Timeline │  │ State Dashboard│  │
│  │  Screen  │  │  Screen  │  │    Screen      │  │
│  └──────────┘  └──────────┘  └────────────────┘  │
└───────────────────────┬───────────────────────────┘
                        │ HTTPS / REST
┌───────────────────────┼───────────────────────────┐
│           Backend (Node.js + Express)             │
│                                                   │
│  ┌─────────────── Modules ──────────────────────┐ │
│  │ auth/ │ entries/ │ ai/ │ files/ │ state/     │ │
│  └─────────────────────────────────────────────┘ │
│              │          │         │               │
│       ┌──────┴──────┐   │    ┌────┴─────┐        │
│       │ PostgreSQL  │   │    │ S3 / R2  │        │
│       │  (Prisma)   │   │    │ (Files)  │        │
│       └─────────────┘   │    └──────────┘        │
└─────────────────────────┼────────────────────────┘
                          │
                  ┌───────┴────────┐
                  │   LLM API      │
                  │ (OpenAI/Claude)│
                  └────────────────┘
```

---

## 2. Technology Stack

| Layer | Technology | Rationale |
|---|---|---|
| **Mobile** | React Native + Expo SDK 52 | Cross-platform, OTA updates, JS ecosystem |
| **Navigation** | React Navigation v6 | Deep linking, tab/stack nav |
| **Mobile State** | Zustand | Lightweight, no boilerplate |
| **Styling** | React Native StyleSheet + custom tokens | Native performance |
| **Backend** | Node.js 20 + Express | Async-friendly, fast dev |
| **Database** | PostgreSQL 16 (Prisma ORM) | JSONB, full-text search, production-grade |
| **File Storage** | Cloudflare R2 (S3-compatible) | Cheap, no egress fees, global CDN |
| **AI** | OpenAI GPT-4o-mini + Vision | Extraction + image understanding |
| **Auth** | JWT (access + refresh tokens) | Stateless, mobile-friendly |
| **Push** | Expo Notifications | Cross-platform, managed service |
| **Jobs** | BullMQ + Redis | Async AI processing, file processing |
| **Deploy** | Railway (API) + Expo EAS (mobile) | Managed, simple CI/CD |

---

## 3. Data Model

```
User ──1:N──→ Entry ──1:1──→ ExtractedState
                 │
                 ├──1:N──→ FileAttachment
                 │
User ──1:N──→ DailyState
```

### Prisma Schema

```prisma
model User {
  id           String       @id @default(cuid())
  email        String       @unique
  passwordHash String
  name         String?
  settings     Json         @default("{}")
  entries      Entry[]
  dailyStates  DailyState[]
  createdAt    DateTime     @default(now())
}

model Entry {
  id             String           @id @default(cuid())
  userId         String
  user           User             @relation(fields: [userId], references: [id], onDelete: Cascade)
  rawText        String
  source         String           @default("manual")
  hasFiles       Boolean          @default(false)
  timestamp      DateTime         @default(now())
  extractedState ExtractedState?
  files          FileAttachment[]
  createdAt      DateTime         @default(now())

  @@index([userId, timestamp])
}

model FileAttachment {
  id            String   @id @default(cuid())
  entryId       String
  entry         Entry    @relation(fields: [entryId], references: [id], onDelete: Cascade)
  fileName      String
  fileType      String   // image/jpeg, application/pdf, etc.
  fileUrl       String   // S3/R2 URL
  fileSize      Int
  extractedText String?  // OCR/AI extracted content
  createdAt     DateTime @default(now())
}

model ExtractedState {
  id          String   @id @default(cuid())
  entryId     String   @unique
  entry       Entry    @relation(fields: [entryId], references: [id], onDelete: Cascade)
  actionItems Json     @default("[]")
  blockers    Json     @default("[]")
  completions Json     @default("[]")
  deadlines   Json     @default("[]")
  tags        Json     @default("[]")
  sentiment   String?
  processedAt DateTime @default(now())
}

model DailyState {
  id             String   @id @default(cuid())
  userId         String
  user           User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  date           DateTime @db.Date
  openItems      Int      @default(0)
  blockerCount   Int      @default(0)
  completedCount Int      @default(0)
  deadlines      Json     @default("[]")
  summary        String?
  computedAt     DateTime @default(now())

  @@unique([userId, date])
}
```

---

## 4. API Design

| Method | Path | Description |
|---|---|---|
| POST | `/api/auth/register` | Create account |
| POST | `/api/auth/login` | Login → JWT |
| POST | `/api/auth/refresh` | Refresh token |
| GET | `/api/auth/me` | Current user |
| POST | `/api/entries` | Create entry (+ files) |
| GET | `/api/entries?date=` | List entries |
| DELETE | `/api/entries/:id` | Delete entry |
| POST | `/api/files/upload-url` | Get presigned upload URL |
| GET | `/api/state/today` | Today's state |
| GET | `/api/state/week` | Weekly state |
| POST | `/api/recall` | Natural language query |

### File Upload Flow

```
Mobile                   Backend                S3/R2
  │                        │                      │
  │ POST /files/upload-url │                      │
  │───────────────────────>│                      │
  │ { presignedUrl }       │                      │
  │<───────────────────────│                      │
  │                        │                      │
  │ PUT (file binary)      │                      │
  │───────────────────────────────────────────────>│
  │ 200 OK                 │                      │
  │<───────────────────────────────────────────────│
  │                        │                      │
  │ POST /entries          │                      │
  │ {text, fileKeys:[...]} │                      │
  │───────────────────────>│                      │
  │                        │ Store entry + files  │
  │                        │ Queue AI processing  │
  │ 201 { entry }          │                      │
  │<───────────────────────│                      │
```

---

## 5. Mobile Architecture

### Screen Structure

```
App
├── AuthStack (unauthenticated)
│   ├── LoginScreen
│   └── RegisterScreen
└── MainTabs (authenticated)
    ├── TodayTab
    │   ├── CaptureInput
    │   ├── StatePanel
    │   └── TimelineFeed
    ├── TimelineTab
    │   └── FullTimeline (grouped by day)
    ├── RecallTab
    │   ├── QueryInput
    │   ├── AIAnswer
    │   └── RecentQueries
    └── SettingsTab
        ├── Profile
        ├── Theme
        └── DataExport
```

### Offline Support (v1.1)

- Entries cached in AsyncStorage
- Queue entries when offline → sync when back online
- Timeline viewable offline from cache

---

## 6. Project Structure

```
flowra/
├── mobile/                    # React Native + Expo
│   ├── app/                  # Expo Router screens
│   ├── components/           # Reusable components
│   ├── services/             # API client
│   ├── stores/               # Zustand stores
│   ├── theme/                # Design tokens
│   ├── utils/
│   ├── app.json
│   └── package.json
│
├── server/                    # Node.js + Express
│   ├── src/
│   │   ├── modules/
│   │   │   ├── auth/         # Routes, service, middleware
│   │   │   ├── entries/      # Routes, service
│   │   │   ├── ai/           # LLM integration, prompts
│   │   │   ├── files/        # Upload, processing
│   │   │   └── state/        # Aggregation, caching
│   │   ├── middleware/       # Global middleware
│   │   ├── utils/
│   │   └── index.js
│   ├── prisma/
│   │   └── schema.prisma
│   └── package.json
│
├── shared/                    # Shared types/constants
├── .env.example
├── .gitignore
└── README.md
```

---

## 7. Infrastructure Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Monolith vs Microservices | Modular monolith → extract later | Speed. Module boundaries prep for future split. |
| SPA vs Mobile | React Native mobile app | User feedback: mobile-first product |
| Polling vs WebSocket | Polling (short) for v1 | Simpler. WS for push notifications later. |
| File storage | Cloudflare R2 | S3-compatible, no egress fees |
| Caching | Redis (DailyState + job queue) | Shared state + async job processing |
| AI processing | Async (BullMQ jobs) | Don't block capture flow |
