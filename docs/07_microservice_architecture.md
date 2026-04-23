# Flowra — Microservice Architecture Specification

> **Version:** 1.0 | **Date:** April 2026  
> **Status:** Target State (Phase 3+ deployment)  
> **Note:** v1 ships as monolith. This doc defines the decomposition target.

---

## 1. Service Decomposition

### 1.1 Service Map

```
                    ┌──────────────┐
                    │ API Gateway  │
                    │  (Kong/Nginx)│
                    └──────┬───────┘
                           │
        ┌──────────┬───────┼───────┬──────────┐
        │          │       │       │          │
   ┌────┴───┐ ┌───┴────┐ ┌┴─────┐ ┌┴────────┐ ┌┴──────────┐
   │  Auth  │ │ Entry  │ │  AI  │ │  File   │ │  State    │
   │Service │ │Service │ │Pipeln│ │ Service │ │Aggregator │
   └────────┘ └────────┘ └──────┘ └─────────┘ └───────────┘
       │          │          │         │            │
       │     ┌────┴────┐    │    ┌────┴────┐       │
       │     │Entry DB │    │    │  S3/R2  │       │
       │     └─────────┘    │    └─────────┘       │
   ┌───┴───┐           ┌───┴───┐            ┌─────┴─────┐
   │Auth DB│           │LLM API│            │ State DB  │
   └───────┘           └───────┘            └───────────┘

              ┌───────────────────────┐
              │    Message Bus        │
              │  (Redis Streams /     │
              │   RabbitMQ / NATS)    │
              └───────────────────────┘
```

### 1.2 Service Registry

| Service | Port | Responsibility | DB | Team Owner |
|---|---|---|---|---|
| **api-gateway** | 8000 | Routing, rate limiting, auth verification | — | Platform |
| **auth-service** | 8001 | Registration, login, JWT, user profiles | auth_db | Platform |
| **entry-service** | 8002 | CRUD for captures, timeline queries | entry_db | Core |
| **ai-pipeline** | 8003 | State extraction, recall, digest generation | — (stateless) | AI |
| **file-service** | 8004 | Upload, download, OCR, text extraction | file_meta_db + S3 | Core |
| **state-aggregator** | 8005 | Compute/cache daily state, weekly digests | state_db | Core |
| **connector-service** | 8006 | OAuth, external API adapters, normalization | connector_db | Integrations |

---

## 2. API Catalog

### 2.1 Auth Service (`/api/v1/auth`)

| Method | Endpoint | Description | Auth |
|---|---|---|---|
| POST | `/register` | Create account | Public |
| POST | `/login` | Authenticate, return JWT | Public |
| POST | `/refresh` | Refresh access token | Refresh token |
| GET | `/me` | Get current user profile | JWT |
| PUT | `/me` | Update profile | JWT |
| DELETE | `/me` | Delete account + all data | JWT |

### 2.2 Entry Service (`/api/v1/entries`)

| Method | Endpoint | Description | Auth |
|---|---|---|---|
| POST | `/` | Create new capture entry | JWT |
| GET | `/` | List entries (paginated, filterable) | JWT |
| GET | `/:id` | Get single entry with extracted state | JWT |
| DELETE | `/:id` | Delete entry + associated data | JWT |
| GET | `/search?q=` | Full-text search across entries | JWT |

**Query Params:** `date`, `from`, `to`, `source`, `tag`, `page`, `limit`

### 2.3 AI Pipeline (`/api/v1/ai`)

| Method | Endpoint | Description | Auth |
|---|---|---|---|
| POST | `/extract` | Extract state from text (internal) | Service token |
| POST | `/recall` | Answer natural language query | JWT |
| POST | `/digest` | Generate weekly digest | Service token |

### 2.4 File Service (`/api/v1/files`)

| Method | Endpoint | Description | Auth |
|---|---|---|---|
| POST | `/upload` | Get presigned upload URL | JWT |
| POST | `/confirm` | Confirm upload, trigger processing | JWT |
| GET | `/:id` | Get presigned download URL | JWT |
| DELETE | `/:id` | Delete file from storage | JWT |

### 2.5 State Aggregator (`/api/v1/state`)

| Method | Endpoint | Description | Auth |
|---|---|---|---|
| GET | `/today` | Get today's aggregated state | JWT |
| GET | `/week` | Get this week's state | JWT |
| GET | `/range?from=&to=` | Get state for date range | JWT |
| GET | `/digest/latest` | Get latest weekly digest | JWT |

### 2.6 Connector Service (`/api/v1/connectors`)

| Method | Endpoint | Description | Auth |
|---|---|---|---|
| GET | `/available` | List available connectors | JWT |
| POST | `/:type/connect` | Initiate OAuth flow | JWT |
| POST | `/:type/callback` | OAuth callback handler | OAuth state |
| DELETE | `/:type/disconnect` | Revoke access, delete tokens | JWT |
| POST | `/:type/sync` | Manual sync trigger | JWT |
| GET | `/:type/status` | Connection status + last sync | JWT |

---

## 3. Inter-Service Communication

### 3.1 Sync (Request/Response)

Used for: User-facing API calls where response is needed immediately.

```
Mobile App → API Gateway → Entry Service → DB → Response
```

### 3.2 Async (Event-Driven)

Used for: AI processing, state recomputation, file processing.

```
Entry Service ──[entry.created]──→ Message Bus
                                       │
                     ┌─────────────────┼────────────────┐
                     ▼                 ▼                ▼
               AI Pipeline      State Aggregator   File Service
              (extract state)  (queue recompute)  (process files)
                     │                 │                │
                     ▼                 ▼                ▼
           [state.extracted]    [state.updated]   [file.processed]
```

### 3.3 Event Schema

| Event | Publisher | Subscribers | Payload |
|---|---|---|---|
| `entry.created` | Entry Service | AI Pipeline, State Aggregator | `{entryId, userId, rawText, hasFiles}` |
| `entry.deleted` | Entry Service | State Aggregator, File Service | `{entryId, userId}` |
| `state.extracted` | AI Pipeline | State Aggregator, Entry Service | `{entryId, extractedState}` |
| `state.updated` | State Aggregator | (Push notifications) | `{userId, date, summary}` |
| `file.uploaded` | File Service | AI Pipeline | `{fileId, entryId, fileType, fileUrl}` |
| `file.processed` | File Service | AI Pipeline | `{fileId, extractedText}` |
| `connector.synced` | Connector Svc | Entry Service | `{userId, source, entries[]}` |

---

## 4. Infrastructure

### 4.1 API Gateway (Kong / Nginx)

| Feature | Config |
|---|---|
| Rate limiting | 100 req/min per user |
| Auth | JWT validation (forward to services) |
| Routing | Path-based to services |
| CORS | Mobile app origins |
| Logging | Request/response logging |

### 4.2 Message Bus (Redis Streams → NATS in production)

| Feature | Config |
|---|---|
| Delivery | At-least-once |
| Retention | 7 days |
| Consumer groups | Per service |
| Dead letter queue | Yes, with retry (3x) |

### 4.3 Deployment (Kubernetes — Target State)

```yaml
# Namespace: flowra-prod
Services:
  auth-service:      replicas: 2, cpu: 0.25, mem: 256Mi
  entry-service:     replicas: 3, cpu: 0.5,  mem: 512Mi
  ai-pipeline:       replicas: 2, cpu: 0.5,  mem: 512Mi
  file-service:      replicas: 2, cpu: 0.25, mem: 256Mi
  state-aggregator:  replicas: 2, cpu: 0.25, mem: 256Mi
  connector-service: replicas: 1, cpu: 0.25, mem: 256Mi

Infrastructure:
  postgresql:    managed (RDS / Supabase)
  redis:         managed (ElastiCache / Upstash)
  s3:            Cloudflare R2
  monitoring:    Grafana + Prometheus
  logging:       Loki
  tracing:       Jaeger (OpenTelemetry)
```

---

## 5. Migration Path: Monolith → Microservices

### Step 1: Monolith with clear module boundaries (v1)
```
/server/src/
  ├── modules/
  │   ├── auth/       ← future auth-service
  │   ├── entries/    ← future entry-service
  │   ├── ai/         ← future ai-pipeline
  │   ├── files/      ← future file-service
  │   ├── state/      ← future state-aggregator
  │   └── connectors/ ← future connector-service
```

### Step 2: Extract first service (AI Pipeline)
- Highest benefit: independent scaling for LLM calls
- Communicate via Redis Streams

### Step 3: Extract file-service
- Independent blob storage management
- Process files without blocking main API

### Step 4: Full decomposition
- Each module becomes its own deployable
- API Gateway routes traffic
- Event bus handles async communication
