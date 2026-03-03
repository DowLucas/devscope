# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is DevScope

A real-time monitoring dashboard for Claude Code developer sessions. A Claude Code plugin (bash hooks) sends events to a backend API, which broadcasts them via WebSocket to a React dashboard.

## Commands

```bash
# Development (runs backend + dashboard concurrently)
bun run dev

# Individual packages
bun run dev:backend          # Backend on :6767 with hot reload
bun run dev:dashboard        # Dashboard on :5173 with Vite HMR

# Dashboard build & lint
cd packages/dashboard
bun run build                # tsc -b && vite build
bun run lint                 # eslint

# Backend tests
cd packages/backend
bun test
```

## Architecture

**Bun monorepo** with 3 packages under `packages/`:

- **shared** — TypeScript types (`DevscopeEvent`, `Developer`, `Session`, `EventPayload` variants). This is the contract between all packages.
- **backend** — Bun + Hono REST API + WebSocket server. Uses `Bun.sql` (built-in PostgreSQL client) with connection pooling. Runs on port 6767.
- **dashboard** — React 19 + Vite + TailwindCSS 4 + Zustand. Proxies `/api` and `/ws` to backend in dev.

The **plugin** (Bash hooks for Claude Code) lives in a separate repo: [`DowLucas/devscope-plugin`](https://github.com/DowLucas/devscope-plugin).

## Event Flow

Plugin hook → `POST /api/events` → backend persists to PostgreSQL + broadcasts via WebSocket → dashboard Zustand store updates → React components re-render.

WebSocket message types: `event.new`, `session.update`, `developer.update`.

## Key Patterns

**snake_case API responses**: PostgreSQL queries return snake_case column names (`developer_id`, `started_at`, `project_name`). The shared TypeScript types use camelCase. Dashboard components must handle both — see `SessionTimeline.tsx` (defines its own snake_case interface) and `DeveloperCards.tsx` (uses fallback access `dev.lastSeen ?? (dev as any).last_seen`).

**Async database layer**: All DB operations use `Bun.sql` tagged templates (async/Promise-based). Every query function, route handler, and background job uses `async/await`. Schema is managed via SQL migration files in `packages/backend/src/db/migrations/`.

**Dashboard imports**: Use `@/` path alias (maps to `src/`). E.g., `import { useActivityStore } from "@/stores/activityStore"`.

**UI components**: Shadcn/ui with Radix primitives in `src/components/ui/`. Icons from `lucide-react`. Animations via `motion/react` (Framer Motion).

**State**: Single Zustand store (`activityStore`) holds events (max 200), developers, active sessions, and connection status. WebSocket hook (`useWebSocket.ts`) populates it.

**Developer identity**: The plugin derives developer ID as `SHA256(git config user.email)`. This is the primary key linking developers to sessions.

**Bun.sql array parameters**: `IN (${array})` DOES NOT WORK — Bun.sql serializes JS arrays as a single comma-separated string, silently matching zero rows. Use the `inList()` helper in `packages/backend/src/db/queries.ts` which builds safe `IN (...)` clauses via `Sql.unsafe()`. Same issue affects `sql.array()` + `= ANY()`.

**Better Auth API keys**: The `apikey` table uses `referenceId` (not `userId`) for the key owner. `auth.api.verifyApiKey()` returns `result.key.referenceId`. The `member` table uses camelCase column names (`"userId"`, `"organizationId"`).

**Org-scoped queries**: Dashboard API routes use `orgScopeMiddleware` which reads `session.activeOrganizationId`, resolves developer IDs from `organization_developer` table, and passes them as `orgDeveloperIds` on the Hono context. Plugin developers are auto-linked to the API key owner's org on event ingestion (`autoLinkDeveloperToOrg` in `services/developerLink.ts`).

**Zustand init defaults**: `teamStore.loading` must default to `true`. If `false`, AuthGuard sees `!teamLoading && !currentTeam` before org data loads and redirects to `/onboarding`.

## REST API

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/events` | POST | Ingest event from plugin |
| `/api/events/recent?limit=N` | GET | Recent events (default 50) |
| `/api/developers` | GET | All developers + active session counts |
| `/api/sessions` | GET | All sessions with event counts |
| `/api/sessions/active` | GET | Active sessions only |
| `/api/sessions/:id` | GET | Events for a session |
| `/api/health` | GET | Health check + WS client count |
| `/ws` | WS | Real-time event stream |

## Plugin & Marketplace

The plugin lives in a **separate repo**: [`DowLucas/devscope-plugin`](https://github.com/DowLucas/devscope-plugin). It is not part of this monorepo.

The standalone repo acts as both the plugin source and its own marketplace:
- `.claude-plugin/plugin.json` — plugin manifest (name, version)
- `.claude-plugin/marketplace.json` — marketplace manifest (makes the repo discoverable as a marketplace)

Users install with:
```bash
claude plugin marketplace add DowLucas/devscope-plugin   # Add marketplace source
claude plugin install devscope                            # Install plugin
```

Or the one-liner: `bash <(curl -fsSL https://raw.githubusercontent.com/DowLucas/devscope-plugin/main/install.sh)`

### Versioning & Releases

**Version bumps are required** for users to get updates. Claude Code caches plugins by version at `~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/`.

To release:
1. Bump `version` in **both** `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json` (versions must match)
2. Push to `main`
3. Users run `claude plugin update devscope` (restart required)

**Both files must be bumped** — `plugin.json` defines the plugin version and `marketplace.json` advertises it. If only one is bumped, `claude plugin update` won't pick up the new code.

### Useful CLI Commands

```bash
claude plugin list                                        # List installed plugins
claude plugin marketplace list                            # List marketplace sources
claude plugin update devscope                             # Update plugin (after version bump)
```

## Ethics & Design Principles

DevScope exists to improve **team workflow and tooling** — not to monitor, rank, or compare individual developers.

**Core principles:**
- **No individual surveillance**: Never build features that track, rank, or compare individual developer activity, productivity, or output. Activity data is for understanding team-wide patterns and tooling health.
- **No developer comparisons**: Dashboards and reports must present aggregate team metrics only. Leaderboards, individual heatmaps, per-developer workload charts, and "status" indicators (active/idle/offline) are not acceptable.
- **Tooling focus, not people focus**: When surfacing problems (e.g., high failure rates), attribute them to sessions, tools, or projects — never to individuals.
- **AI guardrails**: LLM prompts must explicitly instruct against including individual developer names, rankings, or performance comparisons in generated insights and reports.
- **Consent-first**: Developers opt in via plugin installation. Privacy mode (`DEVSCOPE_PRIVACY=redacted`) is the default. Data collection should be minimal and transparent.

When in doubt, ask: "Does this feature help the team improve their tools and workflow, or does it enable monitoring individuals?" Only build the former.

## Docker

```bash
# Production (Caddy with auto-TLS on :80/:443)
docker compose -f docker-compose.yml up --build

# Development (Vite HMR on :5173, backend on :6767, override auto-merges)
docker compose up --build
```

**Files**: `docker/backend.Dockerfile`, `docker/caddy.Dockerfile`, `docker/Caddyfile`, `docker/dashboard.Dockerfile` (dev only), `docker/nginx/nginx.conf` (legacy/dev), `docker-compose.yml`, `docker-compose.override.yml`.

**Production**: Caddy serves dashboard static files, reverse-proxies `/api` + `/ws` to backend:6767, and handles TLS via Let's Encrypt automatically. Set `DOMAIN` env var for your domain. PostgreSQL data persists in named volume `gc-pgdata`. Caddy TLS certs persist in `caddy-data`.

**Development**: Vite dev server + backend hot reload with source bind-mounts. Caddy is disabled via profiles. PostgreSQL exposed on port 5432 for local tooling.

**Docker env vars**: `DATABASE_URL` (PostgreSQL connection string, set automatically by compose), `POSTGRES_PASSWORD` (defaults to `devscope`), `DOMAIN` (for Caddy auto-TLS, defaults to `localhost`), `GC_CORS_ORIGIN` (allowed CORS origins), `VITE_PROXY_TARGET` (proxy target for Vite dev server, defaults to `localhost:6767`).

**Pitfall**: Both Dockerfiles must COPY all workspace `package.json` files (shared, backend, dashboard) or `bun install --frozen-lockfile` fails — Bun validates the lockfile against the full workspace graph.
