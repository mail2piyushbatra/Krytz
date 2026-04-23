# Flowra — Security & Privacy Specification

> **Version:** 1.0 | **Date:** April 2026 | **Classification:** Internal

---

## 1. Threat Model (STRIDE)

| Threat | Category | Attack Vector | Mitigation |
|---|---|---|---|
| **Spoofing** | Identity | Stolen JWT, brute force login | Token expiry (15min), bcrypt, rate limiting |
| **Tampering** | Data | Modified API requests | Input validation (Zod), HTTPS only |
| **Repudiation** | Audit | User denies actions | Request logging, timestamps on all records |
| **Info Disclosure** | Privacy | Leaked user data, exposed files | Encryption at rest, presigned URLs, PII stripping for LLM |
| **Denial of Service** | Availability | Request flooding | Rate limiting, payload size limits |
| **Elevation** | Authorization | Access other user's data | userId scoping on every query, ownership checks |

---

## 2. Authentication

### 2.1 Auth Flow

```
┌────────┐                    ┌────────┐
│ Mobile │                    │ Server │
│  App   │                    │        │
└───┬────┘                    └───┬────┘
    │  POST /auth/login           │
    │  {email, password}          │
    │────────────────────────────>│
    │                             │ Verify bcrypt hash
    │                             │ Generate access + refresh tokens
    │  {accessToken, refreshToken}│
    │<────────────────────────────│
    │                             │
    │  GET /entries               │
    │  Authorization: Bearer <at> │
    │────────────────────────────>│
    │                             │ Verify JWT signature + expiry
    │  {entries}                  │
    │<────────────────────────────│
    │                             │
    │  --- 15 min later ---       │
    │  POST /auth/refresh         │
    │  {refreshToken}             │
    │────────────────────────────>│
    │                             │ Validate refresh token
    │                             │ Rotate: issue new pair
    │  {new accessToken,          │ Old refresh token invalidated
    │   new refreshToken}         │
    │<────────────────────────────│
```

### 2.2 Token Spec

| Token | Type | Expiry | Storage (Mobile) |
|---|---|---|---|
| Access Token | JWT (HS256) | 15 minutes | In-memory (Zustand) |
| Refresh Token | Opaque (cuid) | 30 days | Expo SecureStore |

### 2.3 JWT Payload

```json
{
  "sub": "user_cuid",
  "email": "user@example.com",
  "iat": 1714000000,
  "exp": 1714000900
}
```

### 2.4 Password Policy

| Rule | Value |
|---|---|
| Minimum length | 8 characters |
| Hashing | bcrypt, 12 salt rounds |
| Breach check | None for v1 (add HaveIBeenPwned API later) |
| Reset flow | Email-based reset link (v1.1) |

---

## 3. Authorization Model

### 3.1 Rule: User Isolation

Every database query MUST include `userId` filter:

```javascript
// ✅ CORRECT
const entries = await prisma.entry.findMany({
  where: { userId: req.user.id, ... }
});

// ❌ WRONG — exposes all users' data
const entries = await prisma.entry.findMany({
  where: { id: entryId }
});
```

### 3.2 Ownership Verification

```javascript
// Middleware for single-resource endpoints
async function verifyOwnership(req, res, next) {
  const entry = await prisma.entry.findUnique({ where: { id: req.params.id } });
  if (!entry) return res.status(404).json({ error: 'NOT_FOUND' });
  if (entry.userId !== req.user.id) return res.status(403).json({ error: 'FORBIDDEN' });
  req.entry = entry;
  next();
}
```

---

## 4. Data Encryption

| Layer | Method | Detail |
|---|---|---|
| **In Transit** | TLS 1.3 | All API calls over HTTPS. HSTS header. |
| **At Rest (DB)** | AES-256 | PostgreSQL managed encryption (Railway/RDS) |
| **At Rest (Files)** | SSE-S3 | S3/R2 server-side encryption |
| **Passwords** | bcrypt | 12 rounds, never stored plaintext |
| **Tokens** | Signed JWT | HS256 with 256-bit secret |

---

## 5. Mobile Security

| Concern | Approach |
|---|---|
| **Token storage** | Expo SecureStore (Keychain/Keystore) — never AsyncStorage |
| **Certificate pinning** | Pin API certificate in production builds |
| **Root/jailbreak detection** | Warn user, don't block (v1) |
| **Screenshot prevention** | Not for v1 (user-controlled data) |
| **Biometric auth** | v1.1 — optional fingerprint/face to open app |
| **Deep link security** | Validate all deep link parameters |

---

## 6. LLM Data Handling

### 6.1 What Gets Sent to LLM

```
✅ Sent: Raw text content (anonymized)
✅ Sent: Extracted file text
❌ NOT sent: User ID, email, name
❌ NOT sent: File URLs, database IDs
❌ NOT sent: Timestamps (unless relevant to content)
```

### 6.2 PII Stripping (Pre-LLM)

```javascript
function stripPII(text) {
  // Remove email addresses
  text = text.replace(/[\w.-]+@[\w.-]+\.\w+/g, '[EMAIL]');
  // Remove phone numbers
  text = text.replace(/\b\d{10,}\b/g, '[PHONE]');
  // User's own name is kept (it's their data)
  return text;
}
```

### 6.3 LLM Provider Requirements

| Requirement | Status |
|---|---|
| Data not used for training | ✅ OpenAI API (data not used by default) |
| No data retention by provider | ✅ API calls not stored (30-day abuse log only) |
| SOC 2 compliance | ✅ OpenAI is SOC 2 Type II |

---

## 7. Privacy & Compliance

### 7.1 Data Principles

1. **User owns all data** — export anytime, delete anytime
2. **Minimal collection** — only what's needed for the product
3. **No selling** — user data is never sold or shared
4. **No training** — user data is never used to train models
5. **Transparency** — clear privacy policy explaining all data flows

### 7.2 GDPR Readiness

| Right | Implementation |
|---|---|
| **Right to access** | `GET /auth/me/export` — full data export (JSON) |
| **Right to erasure** | `DELETE /auth/me` — full account + data deletion |
| **Right to portability** | JSON export format, machine-readable |
| **Right to rectification** | Edit profile, edit/delete entries |
| **Data minimization** | Only collect email, name, entries |
| **Consent** | Explicit consent at registration |

### 7.3 Data Collected

| Data | Purpose | Retention |
|---|---|---|
| Email | Authentication | Until deletion |
| Name | Display | Until deletion |
| Entries (text) | Core product | Until deletion |
| Files | Core product | Until deletion |
| Extracted state | Core product (derived) | Until entry deletion |
| Usage analytics | Product improvement | 90 days, anonymized |

---

## 8. File Security

| Concern | Approach |
|---|---|
| **Upload** | Presigned URLs (5min expiry). Direct to S3, not through API server. |
| **Download** | Presigned URLs (1hr expiry). No public bucket access. |
| **Validation** | File type whitelist (jpeg, png, webp, pdf). Max 10MB. |
| **Scanning** | v1.1: ClamAV for malware scanning on upload |
| **Bucket policy** | Private. No public access. No listing. |

---

## 9. Rate Limiting & Abuse Prevention

| Endpoint Group | Limit | Window | Action on Breach |
|---|---|---|---|
| Auth (login/register) | 10 req | 15 min | Block IP for 15min |
| General API | 100 req | 1 min | 429 response |
| AI endpoints | 20 req | 1 min | 429 response |
| File upload | 20 req | 1 hour | 429 response |

---

## 10. Input Validation

```javascript
// All request bodies validated with Zod
const createEntrySchema = z.object({
  rawText: z.string().min(1).max(10000),
  source: z.enum(['manual', 'calendar', 'gmail', 'notion']).default('manual'),
  fileKeys: z.array(z.string()).max(5).optional(),
  timestamp: z.string().datetime().optional(),
});

// XSS prevention: sanitize HTML in rawText before storage
// SQL injection: prevented by Prisma parameterized queries
```

---

## 11. Security Checklist (Per Phase)

### Phase 1 (MVP) ✅
- [ ] bcrypt password hashing
- [ ] JWT auth with 15min expiry
- [ ] Refresh token rotation
- [ ] HTTPS only
- [ ] Input validation (Zod)
- [ ] userId scoping on all queries
- [ ] Rate limiting
- [ ] CORS whitelist
- [ ] Presigned URLs for files
- [ ] PII stripping before LLM calls

### Phase 2 ✅
- [ ] Certificate pinning (mobile)
- [ ] Biometric unlock option
- [ ] Account recovery flow
- [ ] Audit logging

### Phase 3 ✅
- [ ] OAuth token encryption at rest
- [ ] Connector permission model
- [ ] File malware scanning
