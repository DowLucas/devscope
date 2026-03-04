# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [0.4.0] - 2026-03-04

### Added
- **Ethics & consent dashboard** — data retention controls, consent management, tooling health monitor, and ethics audit log
- **Privacy mode tracking** — plugin privacy mode (`redacted`/`full`) tracked end-to-end from plugin to dashboard
- **Soft-delete account** — users can delete their account with a confirmation dialog
- **Activity sidebar badge** — shows live event count from the last minute
- **Settings sidebar** — dedicated settings panel with skill detail dialog
- **Session response preview** — response text preview shown in session turn cards

### Fixed
- Timestamp sanitization for malformed plugin timestamps before DB insert
- Dashboard correctly loads historic data on initial load (not just real-time events)
- Dashboard navigation guards against non-array API responses and auth race conditions
- Drop FK constraint on `alert_events.rule_id` to allow auto-generated tooling health alerts
- Removed email from developer node in topology chart (privacy improvement)
- CI lint errors resolved across dashboard

### Changed
- Team Skills page refocused from coaching Claude to coaching developers
- Pattern analysis now uses local prompt feature extraction for developer-focused insights

## [0.3.0] - 2026-03-03

### Added
- **AI-generated team skills** — Gemini-powered skill detection from session data
- **Anti-pattern detection** — identifies recurring failure patterns across sessions
- **PostgreSQL migration** — migrated from SQLite to PostgreSQL with `Bun.sql`
- **Better Auth** — replaced env-var API key auth with database-managed API keys (`@better-auth/api-key`)
- **Organization support** — multi-tenant orgs with invite-based onboarding
- **Rate limiting** — per-IP rate limits on sign-in, sign-up, event ingestion, and public routes
- **CSRF protection** — CSRF middleware on all mutating API routes
- **Data retention** — configurable per-org retention policy with nightly purge job
- **AI insights jobs** — daily digest generation, session title generation, pattern analysis
- **Tooling health checks** — automatic alerts when tool failure rates exceed thresholds
- **Export API** — export session and event data as JSON/CSV
- **Email verification** — Resend-powered email verification and team invites
- **OAuth** — Google and GitHub social login
- **Docker production setup** — Caddy reverse proxy with auto-TLS (Let's Encrypt)
- **Railway deployment** — single-container Railway Dockerfile serving backend + static dashboard
- GitHub Actions CI (tests, lint, typecheck)
- CODEOWNERS, issue templates, PR template, CONTRIBUTING guide, SECURITY policy

### Fixed
- `IN (array)` queries with `Bun.sql` — replaced with `inList()` helper using `Sql.unsafe()`
- `auth.api.verifyApiKey` now correctly reads `key.referenceId` for the API key owner
- Wouter routing: `/dashboard/*?` pattern for optional wildcard matching
- AuthGuard stale API key list after onboarding — refetch on location change
- Dashboard navigation: all `navigate()` calls use `/dashboard/` prefix

## [0.2.0] - 2026-03-01

### Added
- **Session topology** — visualize agent hierarchies and session flow
- **AI-powered reports** — executive summary views (CEO, CTO, manager)
- **Stuck session alerts** — configurable alert rules for stalled sessions
- **Insights dashboard** — period comparison, activity over time, developer metrics
- **Playbooks** — team runbooks linked to recurring patterns
- **Projects view** — group sessions by project/working directory
- React dashboard with shadcn/ui, TailwindCSS 4, Zustand, and Framer Motion animations
- WebSocket real-time broadcast to org-scoped dashboard clients

## [0.1.0] - 2026-02-27

### Added
- Initial MVP: Bun + Hono backend with SQLite, REST API, and WebSocket server
- Claude Code plugin with bash hooks (`session-start`, `session-end`, `pre-tool-use`, `post-tool-use`, `stop`)
- React dashboard with live activity feed
- Shared TypeScript types package (`@devscope/shared`)
- Developer identity via `SHA256(git config user.email)`

[Unreleased]: https://github.com/DowLucas/devscope/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/DowLucas/devscope/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/DowLucas/devscope/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/DowLucas/devscope/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/DowLucas/devscope/releases/tag/v0.1.0
