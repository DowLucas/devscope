# DevScope

[![License: PolyForm Shield](https://img.shields.io/badge/License-PolyForm%20Shield-purple.svg)](LICENSE)

Real-time monitoring dashboard for Claude Code developer sessions. A Claude Code plugin (bash hooks) sends events to a backend API, which broadcasts them via WebSocket to a React dashboard.

## Architecture

```
┌─────────────────┐     POST /api/events     ┌──────────────┐    WebSocket     ┌───────────────┐
│  Claude Code     │ ──────────────────────►  │   Backend    │ ──────────────►  │   Dashboard   │
│  Plugin (bash)   │                          │  (Hono/Bun)  │                  │  (React/Vite) │
└─────────────────┘                           └──────┬───────┘                  └───────────────┘
                                                     │
                                                     ▼
                                              ┌──────────────┐
                                              │  PostgreSQL   │
                                              └──────────────┘
```

**Packages** (Bun monorepo):

| Package | Description |
|---|---|
| `packages/shared` | TypeScript types — the contract between all packages |
| `packages/backend` | Hono REST API + WebSocket server on Bun |
| `packages/dashboard` | React 19 + Vite + TailwindCSS 4 + Zustand |
| `packages/plugin` | Bash hooks for Claude Code (local dev copy) |

## Quick Start

### 1. Install the Plugin

**One-liner (recommended):**

```bash
curl -fsSL https://raw.githubusercontent.com/DowLucas/devscope-plugin/main/install.sh | bash
```

**Manual install:**

```bash
# Add the marketplace (one-time)
claude plugin marketplace add DowLucas/devscope-plugin

# Install the plugin
claude plugin install devscope
```

Then configure your server URL by typing `/devscope:setup` in Claude Code, or manually create `~/.config/devscope/config`.

### 2. Run the Server

**With Docker (recommended):**

```bash
git clone https://github.com/DowLucas/devscope.git
cd devscope

# Copy and edit environment config
cp .env.production.example .env

# Production (Caddy with auto-TLS on ports 80/443)
docker compose -f docker-compose.yml up --build

# Development (Vite HMR on :5173, backend on :6767)
docker compose up --build
```

**Without Docker:**

Requires [Bun](https://bun.sh/) and PostgreSQL.

```bash
bun install
export DATABASE_URL="postgres://user:pass@localhost:5432/devscope"
bun run dev
```

### 3. Start Using It

Start a Claude Code session — events will flow automatically to your dashboard.

## Configuration

### Plugin

The plugin reads configuration from (in priority order):

1. Environment variables: `DEVSCOPE_URL`, `DEVSCOPE_API_KEY`
2. Config file: `~/.config/devscope/config`
3. Defaults: `http://localhost:6767`

### Server

See [`.env.production.example`](.env.production.example) for all available environment variables.

| Variable | Description | Default |
|---|---|---|
| `DOMAIN` | Domain for Caddy auto-TLS | `localhost` |
| `POSTGRES_PASSWORD` | PostgreSQL password | `devscope` |
| `GC_CORS_ORIGIN` | Allowed CORS origins | `http://localhost:5173` |
| `STALE_SESSION_TIMEOUT_MINUTES` | Auto-close stale sessions | `5` |
| `GEMINI_API_KEY` | Google Gemini for AI insights (optional) | — |
| `AI_DAILY_TOKEN_BUDGET` | Daily token limit for AI | `1000000` |

## API

| Endpoint | Method | Description |
|---|---|---|
| `/api/events` | POST | Ingest event from plugin |
| `/api/events/recent?limit=N` | GET | Recent events (default 50) |
| `/api/developers` | GET | All developers + active session counts |
| `/api/sessions` | GET | All sessions with event counts |
| `/api/sessions/active` | GET | Active sessions only |
| `/api/sessions/:id` | GET | Events for a session |
| `/api/health` | GET | Health check |
| `/ws` | WS | Real-time event stream |

## Database Backups

For production deployments, set up a cron job for `pg_dump`:

```bash
# Daily backup at 2 AM
0 2 * * * docker compose exec -T postgres pg_dump -U postgres devscope | gzip > /backups/devscope-$(date +\%Y\%m\%d).sql.gz
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

[PolyForm Shield 1.0.0](LICENSE)
