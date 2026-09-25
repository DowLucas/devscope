# Opt-in team sharing — implementation plan

Spec: `docs/superpowers/specs/2026-09-25-opt-in-team-sharing-design.md`

## Backend

1. `src/privacy/visibility.ts` + tests
   - `resolveVisibility`, `redactSessionRow` (allowlist), `redactEvent` (allowlist),
     `teammateVisibility(ownerShareDetails, privacyMode)` for org-wide broadcasts,
     `sharedDevIds(sql, orgDevIds)` for semantic search,
     `visibleSessionSql(viewerDevIds, alias)` SQL fragment for aggregates.
   - `getViewerDevIds(sql, c)` loader.
2. Queries: `getAllSessions`, `getActiveSessions`, `getSessionDetail`, `getRecentEvents`
   select `d.share_details AS owner_share_details`.
3. `routes/sessions.ts`: redact list/active/detail, `visibility` in detail response,
   titles empty for `activity`.
4. `routes/events.ts`: `/recent` redaction; WS `event.new` uses teammate visibility.
5. `jobs/sessionTitleGeneration.ts`: skip `session.title.update` broadcast for activity sessions.
6. `routes/ai.ts` session-feedback: visibility gate (403 for activity), content rule
   `visibility !== "activity" && privacyMode === "open"`; broadcast report only when
   teammate visibility is shared.
7. `routes/similar.ts`: `/prompts` and `/sessions/:id` search own + opted-in devs only;
   source session of `/sessions/:id` must not be `activity`.
8. Export `sessions`: rows through `redactSessionRow`.
9. Project aggregates (`getProjectActivity`, `getProjectsOverview`, `/projects/:name/*`):
   hidden sessions grouped under `NULL` project ("Private projects"); named-project
   drill-downs only count visible sessions.
10. `privacy.ts` / `updateDeveloperPrivacy`: write `share_details_updated_at`.
11. Retire `stripSensitiveFields.ts` (replaced by `redactEvent`).

## Dashboard

12. Types: `Session.projectName/projectPath/currentTitle` nullable, `visibility`.
13. `SessionTimeline`, `LiveFeed`/`EventCard`, `SessionNode`: "Private" badge on null project.
14. `SessionDetail`: activity-only view; token/cost gate on visibility; pass `canSeeContent`.
15. `SessionTurnCard` / `ToolChainTimeline`: render content when present & allowed.
16. `ProjectsView`: "Private projects" row, not clickable.
17. `DataSharingCard`, `PrivacyPage` copy; cloud `CLAUDE.md` privacy rules.

## Verify

- `bun test` (backend), dashboard typecheck/build, guardrail test green.
