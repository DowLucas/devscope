<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="packages/dashboard/public/logo-full.png">
    <source media="(prefers-color-scheme: light)" srcset="packages/dashboard/public/logo-full.png">
    <img alt="DevScope" src="packages/dashboard/public/logo-full.png" width="400">
  </picture>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-PolyForm%20Shield-purple.svg" alt="License: PolyForm Shield"></a>
  <a href="https://devscope.sh"><img src="https://img.shields.io/badge/Cloud-devscope.sh-blueviolet" alt="Cloud"></a>
  <a href="https://github.com/DowLucas/devscope/stargazers"><img src="https://img.shields.io/github/stars/DowLucas/devscope" alt="GitHub stars"></a>
  <a href="https://bun.sh/"><img src="https://img.shields.io/badge/runtime-Bun-f9f1e1?logo=bun" alt="Bun"></a>
  <a href="https://github.com/DowLucas/devscope/actions/workflows/ci.yml"><img src="https://github.com/DowLucas/devscope/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://railway.app"><img src="https://img.shields.io/badge/deployed%20on-Railway-0B0D0E?logo=railway" alt="Deployed on Railway"></a>
</p>

Real-time monitoring dashboard for [Claude Code](https://docs.anthropic.com/en/docs/claude-code) developer sessions. Track what your team is building, catch stuck sessions, and understand how AI-assisted development is being used across your organization.

**[devscope.sh](https://devscope.sh)** — try the hosted version, no setup required.

<!-- TODO: Replace with actual screenshot -->
<!-- ![DevScope Dashboard](docs/images/dashboard-screenshot.png) -->

## Features

- **Live activity feed** — see every tool call, prompt, and agent action as it happens
- **Session topology** — visualize agent hierarchies and session flow in real time
- **Team insights** — compare developer activity, track velocity, and spot patterns
- **Stuck session alerts** — get notified when a session stalls or loops
- **AI-powered reports** — executive summaries for engineering leads (CEO, CTO, manager views)
- **Multi-tenant** — org-scoped teams with invite-based onboarding
- **Cloud or self-hosted** — use [devscope.sh](https://devscope.sh) or deploy with Docker

## Getting Started

### Option 1: Cloud (recommended)

The fastest way to get started — no server to manage.

1. **Sign up** at [devscope.sh](https://devscope.sh)
2. **Create a team** and generate an API key
3. **Install the plugin:**

```bash
curl -fsSL https://raw.githubusercontent.com/DowLucas/devscope-plugin/main/install.sh | bash
```

Select `https://devscope.sh` when prompted and enter your API key. That's it.

### Option 2: Self-Hosting with Docker

For teams that want full control over their data.

**Prerequisites:** [Docker](https://www.docker.com/) with Compose

```bash
git clone https://github.com/DowLucas/devscope.git
cd devscope

# 1. Copy the env template
cp .env.production.example .env
```

Edit `.env` and set at minimum:

```bash
BETTER_AUTH_SECRET=<openssl rand -base64 32>
POSTGRES_PASSWORD=<openssl rand -base64 32>
BETTER_AUTH_URL=https://your-domain.com
DOMAIN=your-domain.com
GC_CORS_ORIGIN=https://your-domain.com

# Optional — seed admin account on first startup
DEVSCOPE_ADMIN_EMAIL=admin@your-domain.com
DEVSCOPE_ADMIN_PASSWORD=<strong-password>
DEVSCOPE_ADMIN_NAME=Admin
```

```bash
# 2. Start the production stack (Caddy auto-TLS on :80/:443)
docker compose -f docker-compose.yml up --build -d
```

After startup, open your domain and sign in with the admin credentials you set. Create an organization, generate an API key, then install the plugin (see below).

See [`.env.production.example`](.env.production.example) for all configuration options including OAuth, email, and AI features.

### Install the Plugin

```bash
curl -fsSL https://raw.githubusercontent.com/DowLucas/devscope-plugin/main/install.sh | bash
```

Or via the marketplace:

```bash
claude plugin marketplace add DowLucas/devscope-plugin
claude plugin install devscope
```

Then run `/devscope:setup` inside Claude Code to configure your server URL and API key.

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
| [`devscope-plugin`](https://github.com/DowLucas/devscope-plugin) | Bash hooks for Claude Code (separate repo) |

## Configuration

### Plugin

The plugin reads configuration from (in priority order):

1. Environment variables: `DEVSCOPE_URL`, `DEVSCOPE_API_KEY`
2. Config file: `~/.config/devscope/config`
3. Defaults: `http://localhost:6767`

### Server Environment Variables

**Required:**

| Variable | Description |
|---|---|
| `BETTER_AUTH_SECRET` | Session signing secret — generate with `openssl rand -base64 32` |
| `POSTGRES_PASSWORD` | PostgreSQL password (used by Docker Compose) |

**Core (strongly recommended):**

| Variable | Description | Default |
|---|---|---|
| `BETTER_AUTH_URL` | Public URL of the backend — used for OAuth callbacks and email links | `http://localhost:6767` |
| `DOMAIN` | Domain for Caddy auto-TLS (Let's Encrypt) | `localhost` |
| `GC_CORS_ORIGIN` | Allowed CORS origins — must match your dashboard URL | `http://localhost:5173` |
| `STALE_SESSION_TIMEOUT_MINUTES` | Auto-close sessions with no activity | `5` |

**Admin seed account** (created on first startup if no users exist):

| Variable | Description | Default |
|---|---|---|
| `DEVSCOPE_ADMIN_EMAIL` | Admin email address | — |
| `DEVSCOPE_ADMIN_PASSWORD` | Admin password | — |
| `DEVSCOPE_ADMIN_NAME` | Admin display name | `Admin` |
| `DEVSCOPE_ORG_NAME` | Default organization name | `DevScope` |

**OAuth providers** (optional — email/password login always works):

| Variable | Description |
|---|---|
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth app credentials |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | GitHub OAuth app credentials |

**Email — Resend** (optional — invite URLs logged to console if not set):

| Variable | Description |
|---|---|
| `RESEND_API_KEY` | [Resend](https://resend.com) API key for invitation emails |
| `RESEND_FROM` | From address, e.g. `DevScope <noreply@yourdomain.com>` |

**AI features — Google Gemini** (optional):

| Variable | Description | Default |
|---|---|---|
| `GEMINI_API_KEY` | Google Gemini API key for AI insights and session titles | — |
| `AI_DAILY_TOKEN_BUDGET` | Max tokens per day across all AI calls | `1000000` |
| `AI_INSIGHT_SCHEDULE` | Hour (0–23 UTC) for daily AI insight job | `0` (midnight) |
| `SESSION_TITLE_INTERVAL_MINUTES` | How often to generate session titles | `3` |
| `PATTERN_ANALYSIS_SCHEDULE` | How often (hours) to run pattern analysis | `1` |

See [`.env.production.example`](.env.production.example) for an annotated template.

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

## Troubleshooting

### Plugin not sending events

**Missing git identity** — the plugin derives your developer ID from `git config user.email`. If it's not set, events can't be attributed:

```bash
git config --global user.email "you@example.com"
git config --global user.name "Your Name"
```

**Config not found** — verify your config exists and has the right URL:

```bash
cat ~/.config/devscope/config
```

**Server unreachable** — test the connection:

```bash
curl -sf https://devscope.sh/api/health   # cloud
curl -sf http://localhost:6767/api/health  # self-hosted
```

### Dashboard shows no data

- Check that the plugin is installed and enabled: `claude plugin list`
- Verify WebSocket connects (browser console should show `ws` or `wss` connection)
- Ensure `GC_CORS_ORIGIN` includes your dashboard URL (self-hosted only)

### Plugin update not taking effect

Claude Code caches plugins by version. After updating:

```bash
claude plugin update devscope
# Restart Claude Code for changes to take effect
```

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
