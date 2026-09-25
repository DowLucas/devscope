# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- **Choose whether your team sees your sessions.** Settings → Data Sharing → "Share my
  sessions with my team" now controls what teammates see. Off (the default): they only
  see that you're active: your name, session status, count and timing. On: they see
  what you see, including projects, session titles, prompts, tool inputs and results,
  Claude's responses, AI debriefs and token usage. You always see all of your own data,
  sessions in plugin `private` mode stay hidden from teammates either way, and turning
  sharing off hides past sessions again immediately.
  - Applies to the session list and detail, live feed and WebSocket updates, session
    titles, AI session debriefs and reports, similar-prompt search, exports and project
    views, where hidden sessions are grouped as "Private projects".
  - Also covers CLAUDE.md snapshots, friction and tooling-health alerts, digests, failure
    clusters, and what the AI chat assistant and team reports can quote (file paths,
    commands, error text).
  - Session API responses carry `visibility: "self" | "shared" | "activity"`.
  - Existing opt-ins are reset (migration 049): the old toggle promised details were
    never shared with teammates, so everyone opts in again under the new wording.
  - The toggle applies to every developer identity you have linked (several emails or
    machines), and shows "on" only when all of them share.
  - Tokens and cost of shared sessions show on the session's own page only, never in
    session lists or exports.
- **Semantic search over past prompts and sessions.** Every prompt and Claude's
  response is embedded by a local model on the homelab (`qwen3-embedding:0.6b` via
  Ollama, nothing leaves the box), so you can find earlier work by meaning rather than
  keywords, and see what it led to: tool calls, tool failures, duration, session intent.
  - `GET /api/similar/prompts?q=` returns the nearest past turns in your org.
  - `GET /api/similar/sessions/:id` returns sessions similar to a given one.
  - Both are org-scoped, API-key accessible, rate limited to 60/min, and never include
    developer identity. Private sessions are never indexed. Searches cover your own
    sessions and those of teammates who share their sessions with the team.
- `jobs/semanticIndexing.ts` keeps the index current every minute;
  `scripts/semantic-backfill.ts --write` indexes all history (dry run by default).
- `docker/postgres.Dockerfile`: `postgres:17.9-alpine` + pgvector, published to GHCR by
  `.github/workflows/postgres-image.yml`. Stays on Alpine so the existing data
  directory's collation is unchanged.

### Changed

- Teammates who haven't opted in to sharing now appear as activity only. Previously
  everyone in the org could see every teammate's project names, session titles and
  tool activity, and AI session debriefs appeared in the org-wide reports list.
- Privacy policy and the Data Sharing settings card rewritten to match.
- The AI chat assistant only gives per-developer breakdowns for your own developer ID,
  matching the insights API.

### Fixed

- An organization with no linked developers no longer sees every organization's
  sessions and recent events (an empty developer list was treated as "no filter").
- `POST /api/prompts/similar` only returns the caller's own prompts; it used to accept
  any `developer_id`.

- Local `docker compose` builds the pgvector Postgres image. Migration 045 is a no-op
  on an image without pgvector, so an out-of-order deploy still boots.

## [0.6.0] - 2026-09-21

### Added

- **B-tier TypeSafe surfaces**, completing the System One integration started in 0.5.0.
  All three fail open to prior behaviour when TypeSafe is unavailable.
  - Model-scored prompt specificity (`ai/detection/promptSpecificity.ts`). The local
    heuristic scored five regex probes and so rewarded prompts for *looking* specific;
    a rubric judges whether the prompt actually pins down what to change.
  - Chat intent routing (`ai/workflows/queryRouting.ts`). An individual-targeting
    question is now refused before any Gemini call and before any per-developer row is
    fetched, rather than after, by the output-side grounding check. Wired into both the
    blocking and streaming paths.
  - Usefulness reranking (`ai/detection/relevanceRank.ts`). Coaching cards are cut to
    three on usefulness instead of on the order the generator emitted them.
- `scripts/backfill-session-intent.ts` — classifies sessions the hourly job can never
  reach. The job caps at 30 days while the Contribution Pillars chart looks back up to
  52 weeks, so 2021 sessions were permanently `unclassified` and the chart rendered
  93.5% as one bar. Sends first prompt and files touched where privacy permits, which
  the live job does not: on a sample that cut below-floor answers from 46% to 27.5% and
  shrank the `other` bucket from 38% to 6%. Dry run is the default; re-running resumes.

### Changed

- `promptFeatures.ts` no longer claims prompt text is never sent to an LLM. It is, for
  `avg_specificity` only, and only for sessions in `open`/`full` privacy mode. Values
  from the model are tagged `specificity_source: "model"` with a confidence.
- The prompt-text query in `patternQueries.ts` now selects `privacy_mode` and joins
  `sessions`. It previously had no privacy filter at all, which was safe only while the
  text never left the box.


## [0.5.0] - 2026-09-21

### Added

- **TypeSafe System One (Jev) as a second AI provider**, alongside Gemini. Gemini
  generates prose; TypeSafe answers typed `Choice` / `Score` / `Noul` questions and
  returns probabilities plus calibrated confidence. It emits no free text at all, which
  is why it now backs the mission-critical surfaces: the no-individual-surveillance rule
  was previously enforced on Gemini by prompt instructions plus a post-hoc grounding
  check, and a model with no text channel cannot leak a developer name in the first
  place. Shared client in `packages/backend/src/ai/typesafe.ts`.
  - **Every call site falls back.** `askSystemOne` never throws — it returns `null` on a
    missing key, timeout, rate limit or any API error, and the caller drops back to its
    previous behaviour. With `TYPESAFE_API_KEY` unset the whole integration is inert and
    behaviour is identical to 0.4.1.
  - Session intent classification (`jobs/sessionIntentClassification.ts`) now fans every
    session in a batch out as its own `Choice` question against one shared state: one
    request instead of a JSON prompt, with no response parsing and answers constrained to
    the bucket labels by construction. Falls back to the Gemini prompt.
  - Semantic individual-targeting guard (`ai/grounding/semanticLeak.ts`), wired as a
    third stage in `validator.ts` after the roster and shape checks. Catches leaks that
    name nobody — "the engineer who owns the auth service has the highest failure rate" —
    which are invisible to lexical matching. A semantic hit always rejects rather than
    redacts, because there is no token to strike out.
  - Hallucinated-success detection split along the line it should always have had
    (`ai/detection/successClaim.ts`): code decides from the event log whether a
    verification tool ran, and the model decides only whether the response claims
    success. A second `Noul` asks whether the response discloses being unverified, so a
    session that follows the anti-pattern's own advice is no longer flagged for it.
  - Stuckness gate on the proactive nudge path (`ai/detection/stuckness.ts`). Counter
    rules cannot tell "three failures while narrowing down a cause" from "three
    identical retries"; a rubric score can. 600 ms budget, no retries, fails open to
    nudging. Carries tool names and success flags only — no prompt text.
  - Prompt-injection screening for ingested content (`ai/grounding/injectionScreen.ts`).
    Doc-gap terms are lifted verbatim out of `payload->'toolInput'->>'pattern'` into the
    weekly report prompt, an untrusted-input-to-LLM path that nothing previously checked.
    `assertScreenable` is a tripwire that throws on private-mode content rather than
    filtering it.
- `sessions.session_intent_confidence` (migration 041), so a confidently-classified
  "other" stays distinguishable from a genuinely ambiguous session.
- `by_model` on the token usage summary. Two providers now write to `ai_token_usage` and
  their tokens are not comparable — TypeSafe bills ~$0.042 per million input tokens with
  free output — so `total_tokens` is still a volume figure but is no longer a proxy for
  spend. A `source` label can also span both providers (`session-intent` is written by
  the TypeSafe classifier and by its Gemini fallback), so the model dimension is the only
  way to tell which ran.
- `TYPESAFE_API_KEY`, `TYPESAFE_MODEL` and `DEVSCOPE_INJECTION_SCREEN` in
  `.env.production.example`, and a live smoke test at
  `packages/backend/scripts/typesafe-smoke.ts` covering all five surfaces with
  hand-labelled fixtures.

- **Support for the nine hook events added in plugin 0.15.0**: `tool.batch`,
  `prompt.expansion`, `response.failed`, `model.switch`, `permission.denied`,
  `task.created`, `cwd.change`, `directory.added`, `plugin.setup`. These correspond to
  Claude Code hook events (`PostToolBatch`, `UserPromptExpansion`, `StopFailure`,
  `PostModelSwitch`, `PermissionDenied`, `TaskCreated`, `CwdChanged`, `DirectoryAdded`,
  `Setup`) introduced since the plugin was last updated.
  - `eventType` enum in `packages/backend/src/routes/events.ts` and the `EventType` union
    in `packages/shared/src/events.ts`. Deploy this **before** releasing plugin 0.15.0:
    `zValidator` rejects unknown types with 400, and the plugin drops 4xx events rather
    than queueing them, so events would be lost rather than delayed.
  - Regression tests pinning the whole set, plus tests asserting `worktree.create` /
    `worktree.remove` are still accepted — pre-0.15.0 plugins stay installed in the wild
    and keep sending them, so those enum members must not be removed.
  - Strict per-EventType payload schemas in `packages/backend/src/utils/eventSchemas.ts`
    for all nine, so the DEV-88 wire contract stays complete. The plugin↔backend contract
    test now parses the plugin's own fixture for each new type against those schemas,
    giving real cross-repo verification that the emitting scripts and the backend agree.
  - Dashboard rendering: colours, labels and summaries for the new types, and a generic
    live-feed item so they appear in the feed instead of being silently dropped by a
    switch with no default case.
- Event payloads now carry `promptId` (correlates every event back to the prompt that
  caused it, and joins to the `prompt.id` OpenTelemetry attribute), `permissionMode`, and
  `effortLevel`. The ingest route needed no change (`payload` is `z.record(z.unknown())`),
  but the three are now allowed on every payload in the strict schema's shared
  `privacyAnnotations` block — otherwise a strict parse would reject them as unknown keys
  for every event type.

### Changed


- Event presentation (colours, labels, per-type summaries) moved out of
  `EventCard.tsx` into `packages/dashboard/src/lib/eventDisplay.ts` so the event cards
  and the live feed share one source instead of drifting apart.

- **Hosting migration from Railway to self-hosted Docker.** Production now runs on a self-hosted Docker host behind Cloudflare Tunnel instead of Railway. CI publishes `ghcr.io/dowlucas/devscope-backend:{latest,sha}` on every push to `main`, and Watchtower auto-deploys by polling GHCR every 5 minutes. The Postgres database was dumped from Railway and restored on the new host with full row-count verification; no data loss. The public endpoint (`https://devscope.sh`) and plugin contract are unchanged.
- Renamed `docker/railway.Dockerfile` → `docker/production.Dockerfile` (the file is no longer Railway-specific).
- Removed `railway.toml` (Railway no longer in use).

### Fixed

- Migrations `028_session_intent.sql` and `029_coaching_cards.sql` were numbered into a
  range already taken on `main` (`028_tool_subcommand`,
  `029_user_developer_link_unique_developer`), re-introducing the collision that the
  contiguous-sequence rename set out to remove. Renumbered to 039 and 040. Migrations are
  re-run every boot with no ledger table and these are idempotent, so no data was
  affected.

## [0.4.1] - 2026-03-04

### Changed
- **Privacy mode rename**: `redacted` → `private`, `full` → `open`. Default changed to `standard`.
  - Backend ethics event trigger updated: fires for `privacyMode === "private"`
  - Consent overview SQL updated: counts sessions with `privacy_mode = 'private'`
  - Dashboard session detail and topology badges updated to show "Private"

## [0.4.0] - 2026-03-04

### Added
- **Ethics & consent dashboard** — data retention controls, consent management, tooling health monitor, and ethics audit log
- **Privacy mode tracking** — plugin privacy mode (`private`/`standard`/`open`) tracked end-to-end from plugin to dashboard
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
