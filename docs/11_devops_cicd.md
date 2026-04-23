# Flowra — DevOps & CI/CD Pipeline Specification

> **Version:** 1.0 | **Date:** April 2026

---

## 1. Environment Strategy

| Environment | Purpose | URL | Deploy Trigger |
|---|---|---|---|
| **Local** | Development | `localhost:3000` (mobile), `localhost:8000` (API) | Manual |
| **Staging** | QA & testing | `staging-api.flowra.app` | Push to `main` |
| **Production** | Live users | `api.flowra.app` | Manual promote from staging |

### Environment Variables

```bash
# .env.example
NODE_ENV=development
PORT=8000
DATABASE_URL=postgresql://...
JWT_SECRET=...
JWT_REFRESH_SECRET=...
OPENAI_API_KEY=...
S3_ENDPOINT=...
S3_ACCESS_KEY=...
S3_SECRET_KEY=...
S3_BUCKET=flowra-files
EXPO_PUSH_TOKEN=...
```

---

## 2. Git Workflow

### Trunk-Based Development

```
main (protected)
  ├── feature/capture-input     ← short-lived branch
  ├── feature/ai-pipeline       ← short-lived branch
  ├── fix/auth-token-refresh    ← short-lived branch
  └── release/v1.0.0            ← release branch (tag)
```

| Rule | Policy |
|---|---|
| Branch from | `main` |
| Branch naming | `feature/`, `fix/`, `chore/`, `release/` |
| PR required | Yes, for `main` |
| Review required | Self-review for solo dev (add reviewers later) |
| Squash merge | Yes |
| Branch lifetime | < 3 days |

---

## 3. CI Pipeline (GitHub Actions)

### 3.1 On Every PR

```yaml
name: CI
on: [pull_request]

jobs:
  lint:
    - Checkout
    - Install dependencies (npm ci)
    - Run ESLint (server + mobile)
    - Run Prettier check

  test-server:
    - Checkout
    - Install dependencies
    - Setup PostgreSQL (service container)
    - Run Prisma migrations
    - Run unit tests (Jest/Vitest)
    - Run integration tests
    - Upload coverage report

  test-mobile:
    - Checkout
    - Install dependencies
    - Run unit tests (Jest)
    - Run component tests (React Native Testing Library)

  build-server:
    - Checkout
    - Install dependencies
    - Build TypeScript
    - Verify no build errors

  build-mobile:
    - Checkout
    - Install dependencies
    - Run expo-doctor
    - Verify no build errors
```

### 3.2 On Push to `main`

```yaml
name: Deploy Staging
on:
  push:
    branches: [main]

jobs:
  deploy-api:
    - Run full CI (above)
    - Deploy to Railway (staging)
    - Run database migrations
    - Run smoke tests against staging
    - Notify Slack/Discord

  deploy-mobile-preview:
    - Build Expo preview (EAS Update)
    - Generate QR code for testing
    - Notify team
```

### 3.3 On Release Tag

```yaml
name: Deploy Production
on:
  push:
    tags: ['v*']

jobs:
  deploy-api-prod:
    - Deploy to Railway (production)
    - Run migrations
    - Run smoke tests
    - Monitor error rate for 15min

  deploy-mobile-prod:
    - EAS Build (iOS + Android)
    - Submit to App Store Connect
    - Submit to Google Play Console
    - Create GitHub release
```

---

## 4. Mobile Build Pipeline (Expo EAS)

### 4.1 Build Profiles

```json
// eas.json
{
  "build": {
    "development": {
      "distribution": "internal",
      "ios": { "simulator": true },
      "android": { "buildType": "apk" }
    },
    "preview": {
      "distribution": "internal",
      "channel": "preview"
    },
    "production": {
      "channel": "production",
      "ios": { "autoIncrement": true },
      "android": { "autoIncrement": true }
    }
  },
  "submit": {
    "production": {
      "ios": { "appleId": "...", "ascAppId": "..." },
      "android": { "serviceAccountKeyPath": "..." }
    }
  }
}
```

### 4.2 OTA Updates

| Scenario | Method |
|---|---|
| Bug fix (no native changes) | `eas update --channel production` — instant OTA |
| New native module | Full `eas build` + store submission |
| Critical fix | OTA update + force-update prompt in app |

---

## 5. Infrastructure

### 5.1 Current (Solo Dev / v1)

```
┌─────────────────────────────┐
│  Railway (API)              │
│  ├── Node.js server         │
│  ├── PostgreSQL (managed)   │
│  └── Redis (managed)        │
├─────────────────────────────┤
│  Cloudflare R2 (Files)      │
├─────────────────────────────┤
│  Expo EAS (Mobile builds)   │
├─────────────────────────────┤
│  GitHub (Code + CI/CD)      │
└─────────────────────────────┘

Monthly cost estimate: ~$25–40
```

### 5.2 Scale (Post-PMF)

```
┌──────────────────────────────────┐
│  Kubernetes (EKS / GKE)         │
│  ├── API pods (auto-scale)      │
│  ├── Worker pods (AI jobs)      │
│  ├── PostgreSQL (RDS)           │
│  ├── Redis (ElastiCache)        │
│  ├── Monitoring (Prometheus)    │
│  └── Logging (Loki)             │
├──────────────────────────────────┤
│  Cloudflare (CDN + R2 + DNS)    │
├──────────────────────────────────┤
│  Expo EAS (Mobile)              │
└──────────────────────────────────┘
```

---

## 6. Monitoring & Observability

### 6.1 Stack

| Component | Tool | Purpose |
|---|---|---|
| **Metrics** | Prometheus + Grafana | API latency, error rates, DB connections |
| **Logging** | Loki (or Railway logs for v1) | Structured JSON logs |
| **Tracing** | OpenTelemetry → Jaeger (Phase 2) | Request flow across services |
| **Error tracking** | Sentry | Crash reports (mobile + API) |
| **Uptime** | BetterStack / UptimeRobot | Endpoint health checks |

### 6.2 Key Dashboards

| Dashboard | Metrics |
|---|---|
| **API Health** | Request rate, error rate (4xx/5xx), p50/p95 latency |
| **Database** | Query time, connection pool usage, table sizes |
| **AI Pipeline** | Extraction latency, success rate, queue depth |
| **Mobile** | Crash-free rate, app start time, OTA update adoption |
| **Business** | DAU, captures/day, recall queries, file uploads |

### 6.3 Alerting Rules

| Alert | Condition | Severity | Action |
|---|---|---|---|
| API down | Health check fails 3x | 🔴 Critical | Page on-call |
| Error rate > 5% | 5xx responses exceed 5% of traffic | 🔴 Critical | Page on-call |
| Latency p95 > 2s | API response time spike | 🟡 Warning | Investigate |
| DB connections > 80% | Pool exhaustion risk | 🟡 Warning | Scale or optimize |
| AI queue depth > 100 | Processing backlog | 🟡 Warning | Scale workers |
| Disk usage > 80% | Storage filling up | 🟡 Warning | Cleanup or expand |

---

## 7. Rollback Strategy

| Component | Rollback Method | Time |
|---|---|---|
| API (Railway) | Redeploy previous commit | < 2 min |
| Database | Revert migration (if reversible) | < 5 min |
| Mobile (OTA) | Publish previous update to channel | < 5 min |
| Mobile (native) | Cannot rollback store builds. Publish hotfix. | Hours |

---

## 8. Secrets Management

| Secret | Storage | Access |
|---|---|---|
| API keys | Railway env vars (encrypted) | Server only |
| JWT secrets | Railway env vars | Server only |
| S3 credentials | Railway env vars | Server only |
| Expo tokens | GitHub Secrets (for CI) | CI only |
| Apple/Google certs | EAS Credentials | EAS only |
