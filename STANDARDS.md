# ⚠️ FLOWRA — CODE STANDARDS (NON-NEGOTIABLE)

## RULE #1: NO PARTIAL CODE. NO STUBS. NO WRAPPERS. EVER.

```
╔═══════════════════════════════════════════════════════════════════╗
║                                                                   ║
║   EVERY FILE MUST BE COMPLETE, PRODUCTION-READY CODE.             ║
║                                                                   ║
║   NO placeholder functions.                                       ║
║   NO `// TODO` comments left unresolved.                          ║
║   NO `...` or `pass` or skeleton implementations.                 ║
║   NO "will implement later" patterns.                             ║
║   NO mock data pretending to be real logic.                       ║
║   NO partial implementations that "work for now".                 ║
║                                                                   ║
║   If a feature isn't ready, it doesn't exist in the code.         ║
║   If it's in the code, it works fully.                            ║
║                                                                   ║
║   This rule is ACTIVE until explicitly agreed otherwise.          ║
║                                                                   ║
╚═══════════════════════════════════════════════════════════════════╝
```

---

## RULE #2: NO WRAPPERS. NO PASS-THROUGHS. NO FAKE DEPTH.

```
╔═══════════════════════════════════════════════════════════════════╗
║                                                                   ║
║   A MODULE/ENGINE MUST CONTAIN REAL LOGIC.                        ║
║                                                                   ║
║   If a function's entire body is calling another function         ║
║   and returning its result — THAT IS A WRAPPER, NOT CODE.         ║
║                                                                   ║
║   If an "engine" is just db.query('SELECT...') + a for-loop,     ║
║   THAT IS A DATABASE QUERY WITH EXTRA STEPS, NOT AN ENGINE.       ║
║                                                                   ║
║   If an "AI engine" is one openai.chat.completions.create()       ║
║   call and nothing else — THAT IS AN API CALL, NOT INTELLIGENCE.  ║
║                                                                   ║
║   If a "framework" has zero concrete implementations,             ║
║   THAT IS AN ABSTRACT CLASS PRETENDING TO BE A PRODUCT.           ║
║                                                                   ║
║   Wrappers create the ILLUSION of architecture without            ║
║   delivering the SUBSTANCE of functionality.                      ║
║                                                                   ║
║   This is worse than no code at all — it wastes time,             ║
║   hides gaps, and fakes progress.                                 ║
║                                                                   ║
╚═══════════════════════════════════════════════════════════════════╝
```

### What Makes Code REAL vs WRAPPER

| ❌ WRAPPER (Forbidden) | ✅ REAL (Required) |
|---|---|
| Function calls one other function, returns result | Function contains transformation, validation, fallback, or computation |
| "Engine" that's just `db.query()` + loop | Engine that computes derived state, detects patterns, makes decisions |
| "AI engine" that's a single API call | AI pipeline with local fast-pass, validation, caching, fallback |
| "Framework" with `throw 'not implemented'` | Concrete implementation that handles real data |
| Orchestrator that calls A→B→C in sequence | Orchestrator with retry, error recovery, circuit breaking, event emission |
| Service that renames database columns | Service that enforces business rules, validates invariants, handles edge cases |

### The Test: "Would Deleting This File Break Anything?"

For every file, ask:
1. **Does this file contain logic that doesn't exist anywhere else?** If no → it's a wrapper.
2. **Does removing this file require rewriting significant logic?** If no → it's indirection.
3. **Does this file make decisions?** If it just passes data through → wrapper.
4. **Could a junior dev replace this with 5 lines of inline code?** If yes → it shouldn't be a file.

### Specific Violations This Rule Prevents

```
// ❌ THIS IS A WRAPPER — FORBIDDEN
async getTodayState(userId) {
  return this.state.getToday(userId);
}

// ❌ THIS IS A WRAPPER — FORBIDDEN
async recall(userId, query) {
  return this.recallEngine.query(userId, query);
}

// ❌ THIS IS A WRAPPER — FORBIDDEN
async extract(ir) {
  const result = await this.client.chat.completions.create({...});
  return JSON.parse(result.choices[0].message.content);
}

// ✅ THIS IS REAL — engine adds value beyond the API call
async extract(ir) {
  // 1. Local fast extraction (regex, instant, no API cost)
  const localResult = this._localExtract(ir.content);

  // 2. Confidence check — skip cloud if local is high confidence
  if (localResult.confidence > 0.85) {
    return localResult.state;
  }

  // 3. Cloud extraction with retry + caching
  const cacheKey = this._hash(ir.content);
  const cached = this.cache.get(cacheKey);
  if (cached) return cached;

  const cloudResult = await this._cloudExtract(ir);

  // 4. Merge local + cloud results
  const merged = this._mergeExtractions(localResult, cloudResult);

  // 5. Validate against schema
  const validated = this._validate(merged);

  // 6. Cache result
  this.cache.set(cacheKey, validated, { ttl: 3600 });

  // 7. Track cost
  this._trackTokenUsage(cloudResult.usage);

  return validated;
}
```

---

## RULE #3: WHAT THIS MEANS FOR ENGINES SPECIFICALLY

Every engine MUST deliver:

### Cortex (Orchestrator)
- NOT just A→B→C in sequence
- MUST have: retry logic, error recovery, partial failure handling, event emission, audit trail

### Extraction Engine
- NOT just one OpenAI API call
- MUST have: local fast extraction (regex), cloud deep extraction, merge logic, caching, cost tracking, confidence scoring

### State Engine
- NOT just db.query() + counting
- MUST have: timezone-aware aggregation, project-level breakdown, carry-over intelligence (not just 2-day lookback), trend detection, item lifecycle tracking

### Recall Engine
- NOT just time-string parsing + one OpenAI call
- MUST have: query intent classification, multi-strategy retrieval (time + keyword + semantic), context ranking, source attribution, answer confidence

### Normalization Engine
- NOT just .trim().replace()
- MUST have: confidence scoring, ambiguity detection, user correction loop, format detection, content validation

### Connector Engine
- NOT just an abstract class
- MUST have: at least one working adapter OR not exist at all

---

## RULE #4: FORBIDDEN PATTERNS

| Pattern | Why It's Banned |
|---|---|
| `// TODO: implement later` | Implement now or don't write it |
| `function doThing() { }` | Empty body = stub |
| `return mockData;` | Mock ≠ real |
| `throw new Error('not implemented')` | Then delete the function |
| `console.log` in production code | Use structured logger |
| Direct db.query() imports in engines | Breaks testability and separation — use repository |
| `setImmediate()` for async work | Use proper job queue |
| Deferred `require()` inside functions | Import at module level |
| Duplicate schemas across files | Single source of truth |
| In-memory state for persistent data | Use database |

---

## ENFORCEMENT

1. **Before committing:** Run this checklist against every changed file.
2. **Code reviews:** Reject any file that fails the "wrapper test."
3. **If a feature is deferred:** Remove the skeleton entirely. Track it in TODO.md.
4. **If an engine isn't ready:** Don't create the file. An honest gap is better than a fake module.
5. **Read this file at the start of every session.**
