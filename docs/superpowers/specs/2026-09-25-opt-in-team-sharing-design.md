# Opt-in team sharing (`share_details`) — design

## Goal

Make the existing "Share session details" toggle (`developers.share_details`) actually
control what teammates can see about a developer.

- **Opted out (default):** teammates see only that the developer is active — name,
  active/idle, session count and timing. No project names/paths, file paths, session
  titles, prompts, tool inputs/results, responses, AI summaries, tokens or cost.
- **Opted in:** teammates see everything the owner sees about that session (projects,
  titles, prompts, tool inputs/results, responses, tokens/cost) — never in a ranking.
- **Owner:** always sees all of their own data.
- **Audience:** every org member, no admin exception.
- **Timing:** evaluated at read time with the owner's current setting (retroactive both
  ways — turning it off hides history immediately).
- **Plugin private mode wins:** a session with `privacy_mode = 'private'` is
  activity-only for teammates even if the owner opted in.

## Visibility model

`packages/backend/src/services/visibility.ts` (SQL predicate `visibleSessionSql` lives in `db/utils.ts`):

```ts
type Visibility = "self" | "shared" | "activity";
resolveVisibility({ viewerDevIds, ownerDevId, ownerShareDetails, sessionPrivacyMode })
redactSession(session, v)   // activity: null projectName/projectPath/currentTitle/model/tokens/cost
redactEvent(event, v)       // activity: keep eventType + timestamp, drop payload & project
```

- Per session, not per developer (private-mode override).
- `activity` redaction replaces the old "teammate" strip (`stripSensitivePayload`).
- Session queries join `developers.share_details`; `isSelfView` duplication in
  `sessions.ts` / `ai.ts` is replaced by the shared resolver.

## Routes

| Route | Change |
|---|---|
| `GET /api/sessions`, `/active`, `/:id` | `redactSession`; `/:id` events via `redactEvent`; response carries `visibility` |
| `GET /api/sessions/:id/titles` | empty list for `activity` |
| `GET /api/events/recent` | `redactEvent`, project nulled for `activity` |
| `GET /api/similar/prompts`, `/sessions/:id` | only own sessions + sessions of opted-in owners that aren't private |
| `POST /api/ai/session-feedback` | 403 for `activity`; `self`/`shared` get the same content rule as the owner (content only in plugin `open` mode); `ai.report.completed` broadcast only when teammates may see it |
| `GET /api/ai/reports`, `/reports/:id` | session-feedback reports filtered by the same visibility |
| WebSocket `event.new`, `session.title.update` | redacted to teammate visibility (org-wide feed) |
| `GET /api/export/*` team | session rows through `redactSession` |
| topology | no change — `/api/topology` returns tool graphs only; session nodes come from `/api/sessions/active` (already redacted) |
| insights `/projects`, `/projects/overview`, `/projects/:name/*` | sessions the viewer may not see pool under a `NULL` project ("Private projects", not drillable); named-project drill-downs count only visible sessions, so contributors are always nameable (no `privateCount` needed) |
| `/api/developers`, `/teams/members/status` | unchanged (identity + activity only) |

Aggregates without project names (`/team-activity`, `/tokens`, `/hourly`, patterns, AI
reports) are unchanged.

## Dashboard and consent copy

- `SessionTimeline` / `SessionDetail`: "Private" badge when project is null; activity-only
  detail view; token/cost gate becomes `visibility !== "activity"`.
- `SessionTurnCard`: render prompt only when present.
- Projects overview: "Private projects" card (counts, contributor count, no drill-down).
- `DataSharingCard`: "Share my sessions with my team" with updated description and chips.
- `PrivacyPage`: sections 2, 4, 5 rewritten — content visible to teammates only on opt-in.
- `share_details_updated_at` written on change; ethics log entry kept.
- `CLAUDE.md` privacy rules updated.

## Testing and rollout

- Unit tests for `visibility.ts` (self / opted-in / opted-out / private matrix).
- Route tests: sessions (opted-in, opted-out, private), events/recent, similar/prompts,
  session-feedback 403, project contributors `privateCount`.
- Token leaderboard guardrail stays green (cost never in lists/rankings).
- No migration, backend + dashboard only, no plugin change.
- Rollout note: all teammates appear activity-only until they opt in.
