# ⚠️ FLOWRA — CODE STANDARDS (NON-NEGOTIABLE)

## RULE #1: NO PARTIAL CODE. NO STUBS. EVER.

```
╔═══════════════════════════════════════════════════════════════╗
║                                                               ║
║   EVERY FILE MUST BE COMPLETE, PRODUCTION-READY CODE.         ║
║                                                               ║
║   NO placeholder functions.                                   ║
║   NO `// TODO` comments left unresolved.                      ║
║   NO `...` or `pass` or skeleton implementations.             ║
║   NO "will implement later" patterns.                         ║
║   NO mock data pretending to be real logic.                   ║
║   NO partial implementations that "work for now".             ║
║                                                               ║
║   If a feature isn't ready, it doesn't exist in the code.     ║
║   If it's in the code, it works fully.                        ║
║                                                               ║
║   This rule is ACTIVE until explicitly agreed otherwise.      ║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝
```

### What This Means In Practice

| ❌ FORBIDDEN | ✅ REQUIRED |
|---|---|
| `// TODO: implement later` | Implement it now or don't write it |
| `function doThing() { }` | Full working implementation |
| `return mockData;` | Return real computed data |
| `// placeholder` | Actual logic |
| Commented-out code blocks | Remove or implement |
| `throw new Error('not implemented')` | Implement or delete the function |

### Enforcement

- Every file committed must pass this standard
- Code reviews must reject any stub/partial code
- If a feature is deferred, remove the skeleton entirely — track it in TODO.md instead
