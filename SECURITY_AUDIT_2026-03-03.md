# DevScope Security Audit Report

**Date:** 2026-03-03
**Auditor:** Claude Opus 4.6 (Automated)
**Scope:** Full-stack audit -- backend, dashboard, infrastructure, plugin
**Repositories:** `devscope` (monorepo) + `devscope-plugin` (standalone)

---

## Executive Summary

**Overall Security Posture: MODERATE -- requires targeted hardening before production-scale deployment.**

The DevScope codebase demonstrates security awareness in many areas (Zod input validation, org-scoped middleware, privacy-first plugin defaults, HttpOnly session cookies, `escapeHtml` usage). However, the audit identified **67 findings** across 5 severity levels that require attention before the platform handles sensitive developer data at scale.

### Finding Distribution

| Severity | Count | Key Themes |
|----------|-------|------------|
| **Critical** | 3 | Docker secrets leak, hardcoded default credentials |
| **High** | 12 | IDOR, LLM prompt injection, missing CSP, SQL unsafe patterns, migration system |
| **Medium** | 22 | CSRF bypasses, rate limiter flaws, missing validation, cross-org data leak |
| **Low** | 22 | Logging secrets, file permissions, dependency ranges, input clamping |
| **Info** | 8 | Positive findings, documentation recommendations |

### Risk Score

| Category | Score (1-10) | Notes |
|----------|-------------|-------|
| Authentication | 6/10 | Better Auth is solid, but no password policy, undefined secret fallback |
| Authorization | 4/10 | IDOR on AI conversations, missing org-scoping on playbooks/patterns |
| Input Validation | 6/10 | Good Zod usage on events, gaps on playbooks/settings/AI routes |
| AI/LLM Security | 3/10 | Prompt injection + unvalidated tool args = cross-org data access |
| Infrastructure | 5/10 | Caddy runs as root, .env in Docker context, default credentials |
| Data Privacy | 7/10 | Good privacy defaults, but project paths leak in all modes |
| Frontend | 7/10 | React escaping protects today, but no CSP and custom MD renderers |
| Plugin | 7/10 | Safe JSON construction, but plaintext API key + process visibility |

---

## Critical Findings (3)

### C1. `.env` file not excluded from `.dockerignore` -- secrets leak into Docker build context

**CVSS: 9.1** | **Category:** Secrets Management

The `.dockerignore` does not exclude `.env` files. The current `.env` contains 6 live secrets (Gemini API key, Better Auth secret, GitHub/Google OAuth credentials). These are available in the Docker build context and could be captured by build cache layers, remote builders, or future `COPY . .` instructions.

**Files:** `.dockerignore`, `.env`
**Remediation:** Add `.env` and `.env.*` to `.dockerignore`. **Rotate all 6 secrets immediately** -- treat them as potentially compromised if any Docker build has been performed on a shared system.

---

### C2. Hardcoded default secrets in `docker-compose.yml` with no `NODE_ENV=production`

**CVSS: 9.0** | **Category:** Secrets Management

`docker-compose.yml` contains fallback defaults for 4 secrets: `POSTGRES_PASSWORD: devscope`, `BETTER_AUTH_SECRET: devscope-dev-secret-change-in-production`, `DEVSCOPE_ADMIN_PASSWORD: changeme123!`. The runtime guard only fires when `NODE_ENV=production` -- but `docker-compose.yml` does not set `NODE_ENV`. Any bare-metal Docker deployment will start with all defaults active.

**Files:** `docker-compose.yml:6,24,27,30`, `packages/backend/src/index.ts:36-47`
**Remediation:** Add `NODE_ENV: production` to docker-compose.yml. Replace fallback defaults with required-variable syntax: `${VAR:?VAR must be set}`. Add `POSTGRES_PASSWORD` to the runtime guard.

---

### C3. `.env.production.example` ships with a weak, known admin password

**CVSS: 8.1** | **Category:** Secrets Management

The production example file contains `DEVSCOPE_ADMIN_PASSWORD=changeme123!` with no warning comment. Operators following the copy-and-deploy flow will have a known admin password accessible from the internet.

**Files:** `.env.production.example:16`
**Remediation:** Replace with an empty value or placeholder like `<GENERATE_WITH_openssl_rand_-base64_32>`.

---

## High Findings (12)

### H1. IDOR -- AI Conversation Messages Accessible Without Ownership Check

**Category:** Authorization

`GET /api/ai/chat/conversations/:id` returns all messages for any conversation ID without verifying the requesting user owns it. Any authenticated user can read any other user's AI conversations by guessing UUIDs. The `POST /api/ai/chat` endpoint also allows appending to conversations without ownership verification.

**Files:** `packages/backend/src/routes/ai.ts:87,184-188`, `packages/backend/src/db/aiQueries.ts:112-120`
**Remediation:** Add `user_id` filter to `getConversationMessages`. Verify ownership before appending to existing conversations.

---

### H2. LLM Prompt Injection via User Chat Input

**Category:** AI/LLM Security

User questions are concatenated directly into the Gemini conversation. The system prompt is injected as a fake "user" message (not Gemini's `systemInstruction` field), making it trivially overridable. A crafted prompt could instruct the LLM to call data-access tools with arbitrary developer IDs.

**Files:** `packages/backend/src/ai/workflows/queryWorkflow.ts:11-25,43-53`
**Remediation:** Use Gemini's dedicated `systemInstruction` field. Add input sanitization for known prompt injection patterns. Add output filtering.

---

### H3. LLM Tool Functions Accept Unvalidated `developerId` -- Cross-Org Data Access

**Category:** AI/LLM Security

Tool functions like `getDeveloperActivityOverTime`, `getToolUsageBreakdown`, etc. accept `args.developerId` from LLM output without checking org membership. When `developerId` is provided, queries filter by that ID alone, completely ignoring the org-scoped `developerIds` list. Combined with H2, this enables cross-org data exfiltration.

**Files:** `packages/backend/src/ai/tools.ts:75-481` (multiple execute functions)
**Remediation:** Validate that `args.developerId` is included in the `developerIds` array before executing any tool.

---

### H4. No Content Security Policy on Dashboard HTML

**Category:** Frontend Security

The Hono `secureHeaders()` middleware only applies to `/api/*` routes. The React SPA served by Caddy receives no CSP header. No `script-src`, `frame-ancestors`, or `object-src` restrictions exist. Any XSS payload would execute with full access to session cookies and API key state.

**Files:** `packages/dashboard/index.html`, `packages/backend/src/index.ts:81`
**Remediation:** Add CSP to Caddy config: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' wss:; frame-ancestors 'none'; object-src 'none'`.

---

### H5. No Password Strength Policy

**Category:** Authentication

Better Auth's `emailAndPassword` config enables password auth but does not configure any password policy. Users can register with passwords as short as 1 character.

**Files:** `packages/backend/src/auth.ts:30-33`
**Remediation:** Add `password: { minLength: 12 }` and consider a common-password dictionary check.

---

### H6. Email HTML Template URL Injection

**Category:** Injection

Verification and invitation URLs are interpolated directly into HTML `href` attributes without escaping. A `javascript:` URI or attribute-breakout via `"` could achieve XSS in email clients.

**Files:** `packages/backend/src/services/email.ts:48,85`
**Remediation:** Apply `escapeHtml()` to URLs. Validate protocol is `https:` or `http:`.

---

### H7. Caddy Container Runs as Root

**Category:** Docker Security

The Caddy Dockerfile has no `USER` directive. The internet-facing Caddy process runs as root, increasing blast radius of any container escape. Backend and dashboard Dockerfiles correctly use non-root users.

**Files:** `docker/caddy.Dockerfile`
**Remediation:** Add non-root user: `RUN addgroup -S caddy && adduser -S caddy -G caddy; USER caddy`.

---

### H8. No Rate Limiting on Event Ingestion Endpoint

**Category:** Denial of Service

`POST /api/events` has no rate limiting. Each event triggers 4-6 database operations plus WebSocket broadcast. The Better Auth API key rate limit of 100/s is far too permissive. A compromised key could flood the system with 8.6M events/day.

**Files:** `packages/backend/src/index.ts:143-144`, `packages/backend/src/auth.ts:61-65`
**Remediation:** Apply `rateLimitMiddleware` (~120 req/min). Reduce API key rate limit to 10-20/s.

---

### H9. `inList()` Uses `Sql.unsafe()` with Manual Escaping

**Category:** SQL Injection

The `inList()` utility builds `IN (...)` clauses via `Sql.unsafe()` with hand-rolled single-quote escaping. Used in 16+ call sites. Current IDs are SHA-256 hex (safe), but the generic function name invites future misuse with arbitrary input.

**Files:** `packages/backend/src/db/utils.ts:9-11`, `packages/backend/src/db/queries.ts` (16+ sites)
**Remediation:** Add hex-pattern validation guard (`/^[a-f0-9]+$/`). Long-term: replace with parameterized queries.

---

### H10. Duplicate Migration Prefixes + Re-execution on Every Startup

**Category:** Database Security

Two pairs of migration files share numeric prefixes (006, 007). All migrations re-execute on every startup via `sql.unsafe()` with no tracking table. Non-idempotent operations (constraint drop/recreate) run on every boot. Tampered migration files would execute arbitrary SQL.

**Files:** `packages/backend/src/db/schema.ts:19-27`, `packages/backend/src/db/migrations/006_*.sql`, `007_*.sql`
**Remediation:** Renumber migrations. Add `schema_migrations` tracking table. Wrap in transactions.

---

### H11. WebSocket Broadcast Leaks Data Across Organizations

**Category:** Authorization

When a developer has no organization, `broadcastToDevOrgs()` falls back to a global `broadcast()`, sending events to ALL connected WebSocket clients across ALL organizations.

**Files:** `packages/backend/src/routes/events.ts:94-102`
**Remediation:** Remove the `broadcast()` fallback. Log a warning instead.

---

### H12. Playbooks/Patterns Routes Missing Org-Scoping on Mutations

**Category:** Authorization

Create, update, and archive operations on playbooks/patterns do not filter by `orgId`. A user in Org A can modify playbooks belonging to Org B if they know the ID.

**Files:** `packages/backend/src/routes/playbooks.ts:34-62`, `packages/backend/src/routes/patterns.ts:23-92`
**Remediation:** Pass `orgId` from Hono context through to all database queries.

---

## Medium Findings (22)

| # | Finding | Files | Remediation |
|---|---------|-------|-------------|
| M1 | CSRF bypass: any `x-api-key` header (even invalid) skips CSRF | `middleware/csrf.ts:21-24` | Validate key before skipping |
| M2 | CSRF skip too broad: `startsWith("/api/events")` matches all sub-paths | `middleware/csrf.ts:17` | Use `path === "/api/events"` |
| M3 | Rate limiter uses last XFF IP (= proxy IP, not client) | `middleware/rateLimit.ts:24-31` | Use first IP or trusted-proxy-count |
| M4 | AI rate limiter uses raw XFF header as key (spoofable) | `routes/ai.ts:57` | Use authenticated user ID as key |
| M5 | Admin seed defaults to `changeme123!` outside production | `auth/seedAdmin.ts:10` | Generate random password if unset |
| M6 | `BETTER_AUTH_SECRET` can be undefined (not caught by guard) | `auth.ts:15`, `index.ts:37-42` | Add undefined/empty check |
| M7 | No explicit session cookie config (relies on library defaults) | `auth.ts:11-84` | Set httpOnly, secure, sameSite explicitly |
| M8 | API key rate limit 100/s is excessive | `auth.ts:61-65` | Reduce to 10-20/s with daily quotas |
| M9 | Missing Zod validation on playbook POST/PUT routes | `routes/playbooks.ts:34-54` | Add Zod schemas |
| M10 | JSON.parse of LLM output without structural validation | `ai/workflows/*.ts` (5 files) | Add Zod schemas for LLM output |
| M11 | Error object streamed to client in AI chat SSE | `ai/workflows/queryWorkflow.ts:302-309` | Return generic error, log details server-side |
| M12 | LLM content persisted without sanitization (stored XSS risk) | `ai/workflows/insight,pattern,report*.ts` | Sanitize before storage, use safe MD renderer |
| M13 | CORS origin check lacks normalization (case, trailing slash) | `index.ts:67-78` | Normalize both sides, return null for rejected |
| M14 | Custom Markdown renderer on unsanitized LLM content | `dashboard: AiReportViewer.tsx, ChatMessage.tsx` | Replace with `react-markdown` + `rehype-sanitize` |
| M15 | Plugin: API key in plaintext config file | `devscope-plugin: scripts/setup.sh` | Document risk, consider keychain integration |
| M16 | Plugin: API key visible in `ps` via curl args | `devscope-plugin: scripts/send-event.sh:78-79` | Pass via `curl --config -` stdin |
| M17 | Plugin: Session cache files world-readable (664) | `devscope-plugin: scripts/session-start.sh` | Add `chmod 600`, `mkdir -m 0700` |
| M18 | Plugin: Default URL falls back to HTTP | `devscope-plugin: scripts/_helpers.sh:20` | Add `--proto '=https'` enforcement |
| M19 | Plugin: Standard/full privacy tiers leak prompts + code | `devscope-plugin: scripts/prompt-submit.sh` | Improve tier naming, add explicit warnings |
| M20 | Default admin password in Docker Compose | `docker-compose.yml:30` | Use `${VAR:?required}` syntax |
| M21 | PostgreSQL exposed on 0.0.0.0:5432 in dev | `docker-compose.override.yml:2-4` | Bind to `127.0.0.1:5432:5432` |
| M22 | Inline `Sql.unsafe()` for org filtering in updateAlertRule | `db/queries.ts:889` | Refactor to parameterized query |

---

## Low Findings (22)

| # | Finding | Files |
|---|---------|-------|
| L1 | Unvalidated enum query params in AI routes | `routes/ai.ts:200-206` |
| L2 | Pattern/skills query params lack numeric clamping | `routes/patterns.ts`, `routes/skills.ts` |
| L3 | Missing Zod validation on team settings PUT | `routes/teams.ts:41-57` |
| L4 | Permissive `z.record(z.unknown())` for event payload | `routes/events.ts:34` |
| L5 | Sql.unsafe() for PostgreSQL array literals with tool_sequence | `db/playbookQueries.ts:22-27` |
| L6 | Verification URLs logged when email disabled | `services/email.ts:31,68` |
| L7 | Admin seed email logged | `auth/seedAdmin.ts:19` |
| L8 | Full error objects logged | `routes/patterns.ts:83`, `routes/playbooks.ts:73` |
| L9 | Caret version ranges on 0.x LangChain packages | `packages/backend/package.json` |
| L10 | No `bun audit` equivalent in CI | Backend package.json |
| L11 | Social login may accept unverified emails | `auth.ts:35-43` |
| L12 | Admin seed bypasses email verification | `auth/seedAdmin.ts:9-17` |
| L13 | API key transiently in React state and plaintext DOM | `dashboard: ApiKeysCard.tsx, OnboardingWizard.tsx` |
| L14 | Invite token stored in sessionStorage | `dashboard: InviteAcceptPage.tsx:21` |
| L15 | No SRI plugin configured for Vite | `dashboard: vite.config.ts` |
| L16 | Broad semver ranges on auth packages | `dashboard: package.json` |
| L17 | Plugin: Predictable timing file paths in /tmp | `devscope-plugin: scripts/tool-use.sh:25-27` |
| L18 | Plugin: Full project path sent in all privacy modes | `devscope-plugin: scripts/send-event.sh:45` |
| L19 | Plugin: Install script downloads gum binary without checksum | `devscope-plugin: install.sh:64-86` |
| L20 | Plugin: No plugin integrity verification in marketplace | `devscope-plugin: .claude-plugin/plugin.json` |
| L21 | Plugin: Install script suppresses stderr on claude commands | `devscope-plugin: install.sh:299,305` |
| L22 | Plugin: Inconsistent _helpers.sh import in agent scripts | `devscope-plugin: scripts/agent-start.sh` |

---

## Positive Findings

These security measures are well-implemented:

| # | Finding | Location |
|---|---------|----------|
| P1 | HttpOnly cookie session management (no JS-accessible tokens) | Dashboard auth-client.ts |
| P2 | Safe JSON construction via jq `--arg` in all plugin scripts | Plugin scripts/ |
| P3 | Zod schema validation on event ingestion | Backend routes/events.ts |
| P4 | Sensitive field stripping on WebSocket broadcasts | Backend utils/stripSensitiveFields.ts |
| P5 | No external scripts loaded in dashboard | Dashboard index.html |
| P6 | No source maps in production build | Dashboard dist/ |
| P7 | Privacy mode defaults to `redacted` | Plugin _helpers.sh |
| P8 | Production secret validation guard (exits on known defaults) | Backend index.ts:36-47 |
| P9 | 256KB body size limit on API routes | Backend index.ts:86 |
| P10 | Plugin curl timeout (5s) prevents session blocking | Plugin send-event.sh |
| P11 | Graceful failure (exit 0) in all plugin hooks | Plugin send-event.sh |
| P12 | Developer ID pseudonymization via SHA-256 | Plugin send-event.sh |
| P13 | Backend runs as non-root user in Docker | docker/backend.Dockerfile:37-39 |
| P14 | Config whitelist parsing prevents variable injection | Plugin _helpers.sh:12-16 |
| P15 | Path traversal prevention via `tr -cd` sanitization | Plugin tool-use.sh:21-22 |

---

## OWASP Top 10 Coverage

| OWASP Category | Status | Key Findings |
|---|---|---|
| A01: Broken Access Control | **FAIL** | H1 (IDOR), H11 (cross-org broadcast), H12 (missing org-scope) |
| A02: Cryptographic Failures | **WARN** | C1-C3 (secret management), M6 (undefined auth secret) |
| A03: Injection | **WARN** | H9 (SQL unsafe), H6 (email HTML), H2-H3 (prompt injection) |
| A04: Insecure Design | **PASS** | Ethics principles, privacy-first defaults |
| A05: Security Misconfiguration | **FAIL** | H4 (no CSP), H7 (root container), H10 (migration system) |
| A06: Vulnerable Components | **WARN** | L9-L10 (no audit, broad version ranges) |
| A07: Auth Failures | **WARN** | H5 (no password policy), M5-M7 (session config gaps) |
| A08: Data Integrity Failures | **WARN** | H10 (migration re-execution), L20 (no plugin signing) |
| A09: Logging Failures | **WARN** | L6-L8 (secrets in logs), M11 (error disclosure) |
| A10: SSRF | **PASS** | No user-controlled outbound requests |

---

## Remediation Roadmap

### Phase 1: Immediate (1-2 days) -- Block Critical Paths

| Priority | Finding | Effort | Impact |
|----------|---------|--------|--------|
| **P0** | C1: Add `.env` to `.dockerignore` + rotate secrets | 30 min | Prevents secret leakage |
| **P0** | C2: Add `NODE_ENV: production` + required vars | 30 min | Prevents default-credential deployment |
| **P0** | C3: Fix `.env.production.example` placeholders | 15 min | Prevents copy-paste credential reuse |
| **P0** | H1: Add ownership check on AI conversations | 1 hr | Closes direct IDOR |
| **P0** | H11: Remove global broadcast fallback | 30 min | Stops cross-org data leak |

### Phase 2: Short-term (1 week) -- Close High-Severity Gaps

| Priority | Finding | Effort | Impact |
|----------|---------|--------|--------|
| **P1** | H2-H3: Validate LLM tool args against org IDs + use systemInstruction | 2 hrs | Prevents cross-org data exfiltration via AI |
| **P1** | H4: Add CSP to Caddy config | 1 hr | Browser-level XSS defense |
| **P1** | H5: Add password policy | 30 min | Prevents trivial passwords |
| **P1** | H8: Rate limit event ingestion | 1 hr | DoS protection |
| **P1** | H12: Add orgId filtering to playbook/pattern mutations | 2 hrs | Multi-tenant isolation |
| **P1** | M1-M2: Tighten CSRF middleware | 1 hr | Defense in depth |
| **P1** | M3-M4: Fix rate limiter IP resolution | 1 hr | Effective rate limiting |

### Phase 3: Medium-term (2-4 weeks) -- Harden and Validate

| Priority | Finding | Effort | Impact |
|----------|---------|--------|--------|
| **P2** | H6: Escape email URLs + validate protocol | 1 hr | Injection prevention |
| **P2** | H7: Non-root Caddy container | 1 hr | Container hardening |
| **P2** | H9: Add hex validation to inList() | 1 hr | SQL injection defense |
| **P2** | H10: Migration tracking table | 4 hrs | Schema management safety |
| **P2** | M9-M10: Add Zod schemas for playbooks + LLM output | 3 hrs | Input validation |
| **P2** | M14: Replace custom MD renderers with react-markdown | 2 hrs | XSS prevention |
| **P2** | M16: Pass plugin API key via curl stdin | 30 min | Credential protection |
| **P2** | M17: Fix plugin cache file permissions | 30 min | File security |

### Phase 4: Long-term (ongoing) -- Operational Security

| Priority | Finding | Effort | Impact |
|----------|---------|--------|--------|
| **P3** | L9-L10: Dependency scanning in CI | 2 hrs | Supply chain security |
| **P3** | M7: Explicit cookie configuration | 1 hr | Session hardening |
| **P3** | M19: Improve privacy tier naming/warnings | 2 hrs | Informed consent |
| **P3** | L19-L20: Plugin integrity verification | 4 hrs | Supply chain trust |
| **P3** | M6: Block undefined BETTER_AUTH_SECRET | 30 min | Configuration safety |

---

## Methodology

This audit was conducted using 5 parallel automated security analysis agents:

1. **Authentication & Authorization Audit** -- Better Auth config, session management, CORS, middleware chain
2. **SAST / Backend Code Analysis** -- SQL injection, input validation, deserialization, AI/LLM security
3. **Infrastructure & Data Security** -- Docker, TLS, database, WebSocket, rate limiting, privacy
4. **Frontend Security Audit** -- XSS, CSP, state management, build security, token storage
5. **Plugin Security Audit** -- Credential storage, shell injection, supply chain, privacy controls

Each agent independently reviewed source code, configuration files, and deployment manifests. Findings were deduplicated and consolidated into this report.

**Limitations:** This is a static analysis audit. No dynamic testing, penetration testing, or runtime analysis was performed. Dependency CVE scanning was not executed (Bun lacks `audit` command). Network-level testing was not in scope.
