# Unit Tests & GitHub Rules Design

**Date:** 2026-03-03
**Goal:** Regression prevention on critical backend paths
**Scope:** Backend unit tests (mock DB), GitHub Actions CI, branch protection rules

## Decisions

- **Test runner:** Bun-native (`bun:test`) — zero new dependencies, fastest execution
- **DB strategy:** Mock `Bun.sql` at module level — no real Postgres needed in CI
- **Scope:** Backend only (dashboard tests deferred)
- **Branch protection:** Standard open source (1 approval, CI checks required, no direct push)

## Test File Structure

Tests in `__tests__/` directories adjacent to source modules:

```
packages/backend/src/
├── ai/detection/__tests__/antiPatternRules.test.ts
├── db/__tests__/utils.test.ts
├── middleware/__tests__/{rateLimit,csrf,orgScope}.test.ts
├── routes/__tests__/{events,sessions,developers}.test.ts
├── services/__tests__/{developerLink,developerStatus}.test.ts
├── jobs/__tests__/cleanupStaleSessions.test.ts
└── utils/__tests__/stripSensitiveFields.test.ts
```

## Test Priority Tiers

### Tier 1 — Pure functions (no mocking)
- `ai/detection/antiPatternRules.ts` — retry loop, failure cascade, abandoned session detection
- `utils/stripSensitiveFields.ts` — privacy-critical payload stripping
- `db/utils.ts` — `inList()` SQL helper (injection prevention)
- `services/developerLink.ts` — `computeDeveloperId` hash

### Tier 2 — Middleware (mock Hono context)
- `middleware/rateLimit.ts` — rate limiting, window expiry, IP extraction
- `middleware/csrf.ts` — origin validation, safe method passthrough
- `middleware/orgScope.ts` — org ID extraction, developer ID resolution

### Tier 3 — Route handlers (mock DB + services)
- `routes/events.ts` — event ingestion validation, error responses
- `routes/sessions.ts` — query parameter handling, response shaping
- `routes/developers.ts` — developer list, filtering

### Tier 4 — Services & Jobs (mock DB + external calls)
- `services/developerLink.ts` — `autoLinkDeveloperToOrg`
- `services/developerStatus.ts` — status computation
- `jobs/cleanupStaleSessions.ts` — stale session criteria

### Out of scope
- AI workflows (heavy LLM dependency)
- WebSocket handler (integration-level)
- `auth.ts` / `seedAdmin.ts` (Better Auth internals)
- Dashboard (deferred)

## Mocking Strategy

**`Bun.sql`:** Mock at module level with `mock.module()`. Each test file that touches DB imports mocks the `sql` tagged template to return controlled data.

**Hono routes:** Use `app.request()` test helper for HTTP-level tests without starting a server.

**Auth:** Mock `auth.api.verifyApiKey()` to return valid/invalid keys.

**Pure functions:** No mocking — test directly with input/output assertions.

## GitHub Actions CI

File: `.github/workflows/ci.yml`

Three parallel jobs on push to `main` and all PRs:

| Job | Command | Purpose |
|---|---|---|
| `test` | `cd packages/backend && bun test` | Run all unit tests |
| `lint` | `cd packages/dashboard && bun run lint` | ESLint checks |
| `typecheck` | `cd packages/dashboard && bunx tsc --noEmit` | TypeScript type checking |

## GitHub Branch Protection

Applied to `main` via GitHub UI or `gh` CLI:

| Rule | Value |
|---|---|
| Require PR before merging | Yes |
| Required approvals | 1 |
| Require status checks to pass | Yes |
| Required checks | `test`, `lint`, `typecheck` |
| Require branches up to date | Yes |
| No direct push to main | Yes |
| No force pushes | Yes |
| No branch deletions | Yes |
