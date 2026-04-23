# Flowra — Testing Strategy

> **Version:** 1.0 | **Date:** April 2026

---

## 1. Testing Pyramid

```
        ╱╲
       ╱  ╲        E2E Tests (Detox)
      ╱ 10% ╲       - Critical user flows
     ╱────────╲      - Run on CI (release only)
    ╱          ╲
   ╱   30%      ╲   Integration Tests
  ╱──────────────╲   - API routes + DB
 ╱                ╲  - Service layer + AI mock
╱      60%         ╲ Unit Tests
╱──────────────────── - Pure functions, utils
                       - Component rendering
                       - Business logic
```

---

## 2. Coverage Targets

| Module | Unit | Integration | E2E | Overall Target |
|---|---|---|---|---|
| **Auth** | 80% | 90% | ✅ login/register flow | 85% |
| **Entries** | 80% | 90% | ✅ capture/view flow | 85% |
| **AI Pipeline** | 70% | 80% | — | 75% |
| **Files** | 70% | 80% | ✅ upload flow | 75% |
| **State** | 80% | 85% | ✅ state view | 80% |
| **Mobile UI** | 60% | — | ✅ core flows | 60% |

**Global target: 75% minimum** before production launch.

---

## 3. Unit Tests

### 3.1 Server (Vitest)

**What to test:**
- Input validation schemas (Zod)
- Business logic functions (state aggregation, filtering)
- Utility functions (PII stripping, date helpers)
- AI prompt builders
- Auth helpers (JWT generation, password hashing)

```javascript
// Example: State aggregation
describe('aggregateDailyState', () => {
  it('counts action items across entries', () => {
    const states = [
      { actionItems: [{ text: 'a' }, { text: 'b' }] },
      { actionItems: [{ text: 'c' }] },
    ];
    const result = aggregateDailyState(states);
    expect(result.openItems).toBe(3);
  });

  it('returns zeros for empty entries', () => {
    const result = aggregateDailyState([]);
    expect(result.openItems).toBe(0);
    expect(result.blockerCount).toBe(0);
  });
});
```

### 3.2 Mobile (Jest + React Native Testing Library)

**What to test:**
- Component rendering (correct elements appear)
- User interactions (press, type, submit)
- Store logic (Zustand state changes)
- Navigation flows (correct screen shown)

```javascript
// Example: CaptureInput component
describe('CaptureInput', () => {
  it('renders text input and submit button', () => {
    const { getByPlaceholderText, getByTestId } = render(<CaptureInput />);
    expect(getByPlaceholderText("What's happening?")).toBeTruthy();
    expect(getByTestId('capture-submit')).toBeTruthy();
  });

  it('disables submit when input is empty', () => {
    const { getByTestId } = render(<CaptureInput />);
    expect(getByTestId('capture-submit')).toBeDisabled();
  });

  it('calls onSubmit with text on press', async () => {
    const onSubmit = jest.fn();
    const { getByPlaceholderText, getByTestId } = render(
      <CaptureInput onSubmit={onSubmit} />
    );
    fireEvent.changeText(getByPlaceholderText("What's happening?"), 'test entry');
    fireEvent.press(getByTestId('capture-submit'));
    expect(onSubmit).toHaveBeenCalledWith('test entry');
  });
});
```

---

## 4. Integration Tests

### 4.1 API Routes (Supertest + Test DB)

**Setup:** Separate test database, migrations run before suite, cleaned between tests.

```javascript
// Example: Entry CRUD
describe('POST /api/v1/entries', () => {
  let token;
  
  beforeAll(async () => {
    // Register + login, get token
    token = await getTestToken();
  });

  it('creates entry and returns 201', async () => {
    const res = await request(app)
      .post('/api/v1/entries')
      .set('Authorization', `Bearer ${token}`)
      .send({ rawText: 'Had meeting with team' });
    
    expect(res.status).toBe(201);
    expect(res.body.data.entry.rawText).toBe('Had meeting with team');
    expect(res.body.data.entry.id).toBeDefined();
  });

  it('rejects empty rawText', async () => {
    const res = await request(app)
      .post('/api/v1/entries')
      .set('Authorization', `Bearer ${token}`)
      .send({ rawText: '' });
    
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects unauthenticated request', async () => {
    const res = await request(app)
      .post('/api/v1/entries')
      .send({ rawText: 'test' });
    
    expect(res.status).toBe(401);
  });
});
```

### 4.2 Cross-User Isolation

```javascript
describe('User isolation', () => {
  it('user A cannot see user B entries', async () => {
    const tokenA = await getTestToken('a@test.com');
    const tokenB = await getTestToken('b@test.com');
    
    // User A creates entry
    const entry = await createEntry(tokenA, 'secret note');
    
    // User B tries to access it
    const res = await request(app)
      .get(`/api/v1/entries/${entry.id}`)
      .set('Authorization', `Bearer ${tokenB}`);
    
    expect(res.status).toBe(403);
  });
});
```

---

## 5. AI Pipeline Testing

### 5.1 Snapshot Testing (Golden Outputs)

```javascript
// Test with known inputs and expected extractions
const TEST_CASES = [
  {
    input: "Had call with Rajesh about API pricing. Need to follow up by Friday.",
    expected: {
      actionItems: [{ text: expect.stringContaining("follow up") }],
      deadlines: [{ date: expect.stringContaining("Friday") }],
      completions: [],
      blockers: [],
    }
  },
  {
    input: "Merged 3 PRs today. Blocked on OAuth docs.",
    expected: {
      completions: [{ text: expect.stringContaining("Merged") }],
      blockers: [{ text: expect.stringContaining("OAuth") }],
    }
  },
];

describe('State Extraction', () => {
  TEST_CASES.forEach(({ input, expected }, i) => {
    it(`extracts correctly for case ${i + 1}`, async () => {
      const result = await extractState(input);
      expect(result.actionItems).toEqual(expected.actionItems || []);
      expect(result.blockers).toEqual(expected.blockers || []);
    });
  });
});
```

### 5.2 LLM Mock for CI

```javascript
// Mock OpenAI in CI to avoid API costs
jest.mock('../services/openai', () => ({
  extractState: jest.fn().mockResolvedValue({
    actionItems: [{ text: 'mocked action' }],
    blockers: [],
    completions: [],
    deadlines: [],
    tags: ['test'],
    sentiment: 'neutral',
  }),
}));
```

---

## 6. E2E Tests (Detox — Mobile)

### 6.1 Critical Flows

| Flow | Steps | Priority |
|---|---|---|
| **Registration** | Open app → Sign up → See today view | P0 |
| **Login** | Open app → Log in → See today view | P0 |
| **Capture** | Open today → Type text → Submit → See in timeline | P0 |
| **State view** | Capture entry → See state panel update | P0 |
| **File upload** | Tap attach → Select image → Submit → See in timeline | P1 |
| **Recall** | Go to Recall → Ask question → See AI answer | P1 |
| **Delete entry** | Swipe entry → Confirm delete → Entry gone | P1 |
| **Logout** | Settings → Logout → See login screen | P2 |

### 6.2 Run Schedule

| Trigger | Which Tests | Environment |
|---|---|---|
| PR (CI) | Unit + Integration only | Test DB |
| Push to `main` | Unit + Integration + E2E (iOS sim) | Staging |
| Release tag | Full suite (iOS + Android) | Staging |

---

## 7. Load Testing (k6)

### 7.1 Targets

| Scenario | Target | Acceptable |
|---|---|---|
| Concurrent users | 500 | p95 < 500ms |
| Captures/second | 100 | p95 < 300ms |
| Timeline load | 200 req/s | p95 < 500ms |
| Recall query | 50 req/s | p95 < 5s |

### 7.2 Run Schedule

- **Pre-launch:** Full load test against staging
- **Monthly:** Baseline performance regression check
- **Pre-scale events:** Before any marketing push

---

## 8. QA Checklist (Per Release)

- [ ] All unit tests pass
- [ ] All integration tests pass
- [ ] E2E critical flows pass (iOS + Android)
- [ ] No new lint warnings
- [ ] Coverage meets targets
- [ ] Manual smoke test on real device
- [ ] Dark mode verified
- [ ] Offline behavior verified
- [ ] Error states verified (no internet, server down, invalid input)
- [ ] Performance: capture < 200ms, timeline < 500ms
