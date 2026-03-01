# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is DevScope

A real-time monitoring dashboard for Claude Code developer sessions. A Claude Code plugin (bash hooks) sends events to a backend API, which broadcasts them via WebSocket to a React dashboard.

## Commands

```bash
# Development (runs backend + dashboard concurrently)
bun run dev

# Individual packages
bun run dev:backend          # Backend on :3001 with hot reload
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

**Bun monorepo** with 4 packages under `packages/`:

- **shared** — TypeScript types (`DevscopeEvent`, `Developer`, `Session`, `EventPayload` variants). This is the contract between all packages.
- **backend** — Bun + Hono REST API + WebSocket server. Uses `Bun.sql` (built-in PostgreSQL client) with connection pooling. Runs on port 3001.
- **dashboard** — React 19 + Vite + TailwindCSS 4 + Zustand. Proxies `/api` and `/ws` to backend in dev.
- **plugin** — Bash scripts that fire as Claude Code hooks (`SessionStart`, `UserPromptSubmit`, `PreToolUse`, etc.). They extract developer identity from `git config`, build a `DevscopeEvent` JSON, and POST to the backend. All hooks are async/non-blocking.

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

## Docker

```bash
# Production (nginx on :8080, backend internal)
docker compose -f docker-compose.yml up --build

# Development (Vite HMR on :5173, backend on :3001, override auto-merges)
docker compose up --build
```

**Files**: `docker/backend.Dockerfile`, `docker/dashboard.Dockerfile`, `docker/nginx/nginx.conf`, `docker-compose.yml`, `docker-compose.override.yml`.

**Production**: nginx serves dashboard static files and reverse-proxies `/api` + `/ws` to backend:3001. PostgreSQL data persists in named volume `gc-pgdata`.

**Development**: Vite dev server + backend hot reload with source bind-mounts. PostgreSQL exposed on port 5432 for local tooling.

**Docker env vars**: `DATABASE_URL` (PostgreSQL connection string, set automatically by compose), `POSTGRES_PASSWORD` (defaults to `devscope`), `VITE_PROXY_TARGET` (proxy target for Vite dev server, defaults to `localhost:3001`).

**Pitfall**: Both Dockerfiles must COPY all workspace `package.json` files (shared, backend, dashboard) or `bun install --frozen-lockfile` fails — Bun validates the lockfile against the full workspace graph.
