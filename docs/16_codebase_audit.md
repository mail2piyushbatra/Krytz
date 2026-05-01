# KRYTZ Repo Audit

> **Date:** 2026-05-01
> **Scope:** Current source state in `E:\krytz`

## Closed Since The Earlier Audit

- `PATCH /api/v1/auth/me` exists for profile and settings updates.
- Export and stats endpoints exist.
- Request ID middleware and graceful shutdown are implemented.
- RLS middleware is mounted on the API path.
- Gmail, Google Calendar, and Notion connectors use real provider calls instead of mock/demo data.
- Password reset columns match the auth service.
- Task graph data is visible in the client.
- Weekly memory retrieval is wired to the client.
- Nightly memory consolidation is implemented and scheduled.
- Server tests now have a deterministic local unit runner.

## Current Gaps

1. **Runtime proof is still missing in this session**
   Source checks pass, but `http://localhost:8301/health` is not reachable here, so the backend stack was not live-verified.
2. **Literal React Flow usage is still absent**
   The graph UI is implemented through custom SVG rendering rather than `@xyflow/react`.
3. **API documentation is still incomplete**
   There is no full OpenAPI spec, Postman collection, or operational runbook covering the current route surface.
4. **Lint still carries warning debt**
   Root lint passes, but there are still many `no-unused-vars` and `require-await` warnings that should be cleaned down over time.

## Repo Health Snapshot

- Root `npm run lint`: passing, warnings only.
- `npm test --workspace=server`: passing.
- Client production build: passing.
- CI should focus on lint, unit tests, and build checks by default.
