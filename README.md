# DevScope

[![License: PolyForm Shield](https://img.shields.io/badge/License-PolyForm%20Shield-purple.svg)](LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/DowLucas/devscope)](https://github.com/DowLucas/devscope/stargazers)
[![Bun](https://img.shields.io/badge/runtime-Bun-f9f1e1?logo=bun)](https://bun.sh/)

Real-time monitoring dashboard for [Claude Code](https://docs.anthropic.com/en/docs/claude-code) developer sessions. Track what your team is building, catch stuck sessions, and understand how AI-assisted development is being used across your organization.

<!-- TODO: Replace with actual screenshot -->
<!-- ![DevScope Dashboard](docs/images/dashboard-screenshot.png) -->

## Features

- **Live activity feed** — see every tool call, prompt, and agent action as it happens
- **Session topology** — visualize agent hierarchies and session flow in real time
- **Team insights** — compare developer activity, track velocity, and spot patterns
- **Stuck session alerts** — get notified when a session stalls or loops
- **AI-powered reports** — executive summaries for engineering leads (CEO, CTO, manager views)
- **Multi-tenant** — org-scoped teams with invite-based onboarding
- **Self-hostable** — deploy with Docker + Caddy (auto-TLS) in minutes

## Getting Started

### Prerequisites

- [Docker](https://www.docker.com/) (recommended) or [Bun](https://bun.sh/) v1.0+ with PostgreSQL

### Self-Hosting with Docker

```bash
git clone https://github.com/DowLucas/devscope.git
cd devscope

# Copy and configure environment
cp .env.production.example .env
# Edit .env — set BETTER_AUTH_SECRET, POSTGRES_PASSWORD, DOMAIN, etc.

# Start production stack (Caddy with auto-TLS on :80/:443)
docker compose -f docker-compose.yml up --build
```

See [`.env.production.example`](.env.production.example) for all available configuration options.

### Install the Plugin

Once your server is running, install the Claude Code plugin:

**One-liner:**

```bash
curl -fsSL https://raw.githubusercontent.com/DowLucas/devscope-plugin/main/install.sh | bash
```

**Or via the marketplace:**

```bash
claude plugin marketplace add DowLucas/devscope-plugin
claude plugin install devscope
```

Then run `/devscope:setup` inside Claude Code to point it at your server.

### Local Development

For contributors who want to hack on DevScope itself:

```bash
git clone https://github.com/DowLucas/devscope.git
cd devscope
bun install

# Start PostgreSQL + backend + dashboard with hot reload
docker compose up --build

# Or without Docker (requires local PostgreSQL)
export DATABASE_URL="postgres://user:pass@localhost:5432/devscope"
bun run dev
```

- Backend runs on `http://localhost:6767`
- Dashboard runs on `http://localhost:5173` (proxies API/WS to backend)
- Test the plugin locally: `claude --plugin-dir packages/plugin`

See [CONTRIBUTING.md](CONTRIBUTING.md) for full development guidelines.

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

| Package | Description |
|---|---|
| [`packages/shared`](packages/shared) | TypeScript types — the contract between all packages |
| [`packages/backend`](packages/backend) | Hono REST API + WebSocket server (Bun) |
| [`packages/dashboard`](packages/dashboard) | React 19 + Vite + TailwindCSS 4 + Zustand |
| [`packages/plugin`](packages/plugin) | Bash hooks for Claude Code ([standalone repo](https://github.com/DowLucas/devscope-plugin)) |

## Configuration

### Plugin

The plugin reads configuration from (in priority order):

1. Environment variables: `DEVSCOPE_URL`, `DEVSCOPE_API_KEY`
2. Config file: `~/.config/devscope/config`
3. Defaults: `http://localhost:6767`

### Server Environment Variables

| Variable | Description | Default |
|---|---|---|
| `BETTER_AUTH_SECRET` | Session signing secret (required) | — |
| `DOMAIN` | Domain for Caddy auto-TLS | `localhost` |
| `POSTGRES_PASSWORD` | PostgreSQL password | `devscope` |
| `GC_CORS_ORIGIN` | Allowed CORS origins | `http://localhost:5173` |
| `STALE_SESSION_TIMEOUT_MINUTES` | Auto-close inactive sessions | `5` |
| `GEMINI_API_KEY` | Google Gemini for AI reports (optional) | — |
| `DEVSCOPE_ADMIN_EMAIL` | Seed admin email | — |
| `DEVSCOPE_ADMIN_PASSWORD` | Seed admin password | — |

See [`.env.production.example`](.env.production.example) for the full list.

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

## Contributing

Contributions are welcome! Whether it's bug reports, feature requests, or pull requests — we appreciate your help.

- **Bug reports & feature requests**: [GitHub Issues](https://github.com/DowLucas/devscope/issues)
- **Security vulnerabilities**: See [SECURITY.md](SECURITY.md)
- **Development setup & guidelines**: See [CONTRIBUTING.md](CONTRIBUTING.md)

## License

DevScope uses a dual license:

- **[PolyForm Shield 1.0.0](LICENSE)** for the backend and dashboard (`packages/backend/`, `packages/dashboard/`) — use it freely, but don't build a competing product
- **[MIT](LICENSE)** for everything else (plugin, shared types, Docker config, docs) — do whatever you want

See [LICENSE](LICENSE) for full details.
