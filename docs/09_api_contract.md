# Flowra — API Contract Specification

> **Version:** 1.0 | **Base URL:** `https://api.flowra.app/api/v1`  
> **Auth:** Bearer JWT in `Authorization` header  

---

## 1. Common Patterns

### 1.1 Authentication Header

```
Authorization: Bearer <access_token>
```

### 1.2 Standard Response Envelope

```json
// Success
{
  "success": true,
  "data": { ... },
  "meta": { "page": 1, "limit": 20, "total": 150 }
}

// Error
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Email is required",
    "details": [{ "field": "email", "message": "Required" }]
  }
}
```

### 1.3 Error Codes

| HTTP | Code | Description |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Invalid request body/params |
| 401 | `UNAUTHORIZED` | Missing or invalid JWT |
| 401 | `TOKEN_EXPIRED` | JWT expired, use refresh |
| 403 | `FORBIDDEN` | Not allowed to access resource |
| 404 | `NOT_FOUND` | Resource doesn't exist |
| 409 | `CONFLICT` | Duplicate (e.g., email exists) |
| 429 | `RATE_LIMITED` | Too many requests |
| 500 | `INTERNAL_ERROR` | Server error |

### 1.4 Pagination

```
GET /entries?page=1&limit=20

Response meta:
{
  "page": 1,
  "limit": 20,
  "total": 150,
  "hasMore": true
}
```

### 1.5 Rate Limits

| Tier | Limit | Window |
|---|---|---|
| Free | 60 req/min | Per user |
| Pro | 200 req/min | Per user |
| AI endpoints | 20 req/min | Per user |

---

## 2. Auth Endpoints

### POST `/auth/register`

```yaml
Request:
  body:
    email: string (required, valid email)
    password: string (required, min 8 chars)
    name: string (optional)

Response 201:
  data:
    user: { id, email, name, createdAt }
    accessToken: string (JWT, expires 15min)
    refreshToken: string (expires 30 days)

Errors:
  409: Email already registered
  400: Validation error
```

### POST `/auth/login`

```yaml
Request:
  body:
    email: string (required)
    password: string (required)

Response 200:
  data:
    user: { id, email, name, createdAt }
    accessToken: string
    refreshToken: string

Errors:
  401: Invalid credentials
```

### POST `/auth/refresh`

```yaml
Request:
  body:
    refreshToken: string (required)

Response 200:
  data:
    accessToken: string (new)
    refreshToken: string (rotated)

Errors:
  401: Invalid or expired refresh token
```

### GET `/auth/me` 🔒

```yaml
Response 200:
  data:
    user: { id, email, name, settings, createdAt }
```

### DELETE `/auth/me` 🔒

```yaml
Response 200:
  data:
    message: "Account and all data deleted"

Side effects:
  - All entries, states, files deleted
  - S3 files purged
  - All tokens invalidated
```

---

## 3. Entry Endpoints

### POST `/entries` 🔒

```yaml
Request:
  body:
    rawText: string (required, max 10000 chars)
    source: string (optional, default "manual")
    fileKeys: string[] (optional, S3 keys from upload)
    timestamp: ISO datetime (optional, default now)

Response 201:
  data:
    entry:
      id: string
      rawText: string
      source: string
      hasFiles: boolean
      timestamp: string
      files: FileAttachment[]
      extractedState: null  # async, not yet processed
      createdAt: string

Side effects:
  - Queues AI extraction job
  - Queues file processing (if files attached)
```

### GET `/entries` 🔒

```yaml
Query params:
  date: YYYY-MM-DD (optional, filter to specific day)
  from: ISO datetime (optional, range start)
  to: ISO datetime (optional, range end)
  source: string (optional, filter by source)
  tag: string (optional, filter by tag)
  page: int (default 1)
  limit: int (default 20, max 100)

Response 200:
  data:
    entries: [
      {
        id, rawText, source, hasFiles, timestamp,
        extractedState: { actionItems, blockers, completions, deadlines, tags, sentiment },
        files: [{ id, fileName, fileType, fileSize }],
        createdAt
      }
    ]
  meta: { page, limit, total, hasMore }
```

### GET `/entries/:id` 🔒

```yaml
Response 200:
  data:
    entry: { ...full entry with extractedState and files }

Errors:
  404: Entry not found
  403: Not your entry
```

### DELETE `/entries/:id` 🔒

```yaml
Response 200:
  data:
    message: "Entry deleted"

Side effects:
  - Cascade delete: extractedState, files
  - Delete files from S3
  - Recompute DailyState
```

### GET `/entries/search` 🔒

```yaml
Query params:
  q: string (required, search query)
  page: int (default 1)
  limit: int (default 20)

Response 200:
  data:
    entries: [...matching entries with highlights]
  meta: { page, limit, total }
```

---

## 4. File Endpoints

### POST `/files/upload-url` 🔒

```yaml
Request:
  body:
    fileName: string (required)
    fileType: string (required, MIME type)
    fileSize: int (required, bytes, max 10MB)

Response 200:
  data:
    uploadUrl: string (presigned S3 URL, expires 5min)
    fileKey: string (use this when creating entry)

Errors:
  400: File too large or unsupported type
```

**Supported types:** `image/jpeg`, `image/png`, `image/webp`, `application/pdf`

### GET `/files/:id/download-url` 🔒

```yaml
Response 200:
  data:
    downloadUrl: string (presigned URL, expires 1hr)

Errors:
  404: File not found
  403: Not your file
```

---

## 5. State Endpoints

### GET `/state/today` 🔒

```yaml
Response 200:
  data:
    state:
      date: "2026-04-24"
      openItems: 3
      blockerCount: 1
      completedCount: 5
      deadlines: [
        { task: "API proposal", date: "2026-04-28" }
      ]
      summary: "Productive day — 5 items done, 1 blocker on OAuth docs"
      actionItems: [
        { text: "Follow up with Rajesh", source: "entry_abc", dueDate: "2026-04-25" }
      ]
      blockers: [
        { text: "Waiting on OAuth docs", source: "entry_def", since: "2026-04-22" }
      ]
```

### GET `/state/week` 🔒

```yaml
Response 200:
  data:
    weekOf: "2026-04-21"
    days: [
      { date: "2026-04-21", openItems: 2, completed: 3, blockers: 0 },
      { date: "2026-04-22", openItems: 4, completed: 1, blockers: 1 },
      ...
    ]
    digest: "This week you completed 12 items..."
```

---

## 6. Recall Endpoint

### POST `/recall` 🔒

```yaml
Request:
  body:
    query: string (required, natural language question)

Response 200:
  data:
    answer: "Last week you completed the auth flow, had 3 meetings..."
    sourceEntries: [
      { id: "entry_abc", rawText: "...", timestamp: "..." }
    ]
    confidence: "high"  # high | medium | low

Rate limit: 20 req/min (AI endpoint)
Latency: 2-5 seconds expected
```

---

## 7. Versioning Strategy

| Version | Status | End of Life |
|---|---|---|
| `v1` | Active | — |
| `v2` | Planned (microservice split) | — |

- All endpoints prefixed with `/api/v1/`
- Breaking changes → new version
- Non-breaking additions (new fields) → same version
- Deprecation notice: 3 months before EOL
