# DevScope GitHub Integration — Design Spec

**Status:** Approved for planning
**Date:** 2026-04-24
**Author:** Lucas + Claude (brainstorming session)

## Context

DevScope currently analyzes Claude Code sessions and produces AI insights, patterns, anti-patterns, and playbooks in its database (693 sessions, 619 insights, 64 playbooks as of this spec). The insights stay in the DevScope dashboard. This spec defines how DevScope becomes an active participant in the repos it observes: reading connected GitHub repositories, proposing `CLAUDE.md` updates, skills, hooks, commands, subagents, and config hygiene as draft PRs, and measuring whether those suggestions actually improve developer outcomes.

This is the first of three related sub-projects. The other two (AI pipeline hardening, agentic loop orchestration) will be specced separately once this integration has a concrete surface.

## Goals

1. **Close the observe → learn → ship loop.** When a Claude Code session reveals friction, DevScope proposes a concrete repo change within the same day — while context is fresh.
2. **Earn trust before taking action.** Every org starts in shadow mode; real PRs require admin approval or explicit opt-in per suggestion kind.
3. **Prove suggestions work.** Every merged suggestion is measured for its impact on subsequent session metrics. No vibes.
4. **Stay multi-tenant from day one.** GitHub App, not PAT. Clean org/installation boundaries.

## Non-goals

- Auto-merge or direct commits to protected branches (explicitly out of scope for v1).
- Reviewing human-authored PRs (that's a future product surface, not this spec).
- Supporting GitLab, Bitbucket, or self-hosted SCM.
- Real-time PR generation during a session (minutes-latency is fine).

## Decisions

| # | Decision | Rationale |
|---|---|---|
| 1 | Multi-tenant GitHub App from day one | Avoids PAT juggling; clean extension to customers |
| 2 | Allowed actions: read analysis + PR comments + draft PRs | Trust ladder; no auto-merge, no direct commits |
| 3 | Triggers: session-ended (automatic) + dashboard manual button | Fresh-context PRs; admin-initiated on demand |
| 4 | Suggestion kinds: `CLAUDE.md`, skills, hooks, commands, subagents, config hygiene | Full coverage of Claude Code extensibility |
| 5 | Repo linkage: auto-detect via `git remote` + admin override via `cwd_patterns` | 95% auto, escape hatch for weird cases |
| 6 | Quality gate: shadow mode first, then evidence threshold + admin approval | Private quality baseline before any customer-facing PR |
| 7 | Feedback loop: track merges + attribute metric deltas 28 days pre/post | Turns DevScope into a learning system, not a blind bot |
| 8 | LLM: Claude Sonnet 4.6 for draft, Opus 4.7 for self-critique | Agentic tool use, prompt caching, judgment separation |

## Architecture

Three new services, each with one clear job, joining the existing backend.

```
 plugin (user machine)
   │  session events (+ git remote, branch, sha)
   ▼
 backend/api ──► Postgres
   │             ├─ existing: sessions, events, ai_insights, session_patterns,
   │             │  anti_patterns, playbooks, workflow_profiles, ...
   │             └─ new: repo_installations, suggestion_candidates,
   │                suggestion_artifacts, suggestion_outcomes
   │
   ▼
 suggestion-promoter (cron q15min + nudge on session-end)
   │   SQL + rules engine; no LLM calls
   │   evidence threshold → suggestion_candidates(status='queued')
   ▼
 suggestion-worker (Postgres-queue consumer, claim-with-lease)
   │   clone repo → build context → Claude Sonnet draft (tool use)
   │   → Claude Opus self-critique → quality gate
   │   → suggestion_artifacts(status='shadow' | 'ready')
   ▼
 github-app (webhooks + Octokit)
   │   installation token exchange, PR create/update/close,
   │   webhook verify, outcome capture
   ▼
 GitHub
```

### Service boundaries

**`suggestion-promoter`** — pure data service. SQL against existing evidence tables, deterministic threshold rules, no LLM. Cheap, easy to test, easy to tune.

**`suggestion-worker`** — the agentic component. Separate container, own API key pool, own resource limits, own cost ceilings. Shadow-vs-live is a runtime config, not baked in. Writes to Postgres; never touches GitHub directly.

**`github-app`** — thin Octokit wrapper. Stateless. Only trusts `suggestion_artifacts.status='ready'` and `repo_installations.is_live=true`. Owns webhook verification and token lifecycle.

The three-service split is deliberate: each has a different failure mode, scaling profile, and security boundary. Merging any two makes all three harder to reason about.

## Data Model

All new tables below. One small column addition to `sessions` for repo linkage.

### `repo_installations`

One row per GitHub App install × repo.

```sql
CREATE TABLE repo_installations (
  id                   text PRIMARY KEY,
  organization_id      text NOT NULL REFERENCES organization(id),
  github_install_id    bigint NOT NULL,
  owner                text NOT NULL,
  repo                 text NOT NULL,
  default_branch       text NOT NULL,
  cwd_patterns         text[] NOT NULL DEFAULT '{}',  -- regex list for session→repo override
  is_live              boolean NOT NULL DEFAULT false, -- false = shadow only
  auto_open_pr_kinds   text[] NOT NULL DEFAULT '{}',   -- kinds allowed to auto-publish
  installed_at         timestamptz NOT NULL DEFAULT now(),
  suspended_at         timestamptz,
  UNIQUE(github_install_id, owner, repo)
);
CREATE INDEX idx_repo_inst_org ON repo_installations(organization_id) WHERE suspended_at IS NULL;
```

### `suggestion_candidates`

Promoter output, worker input.

```sql
CREATE TABLE suggestion_candidates (
  id                    text PRIMARY KEY,
  repo_installation_id  text NOT NULL REFERENCES repo_installations(id),
  kind                  text NOT NULL CHECK (kind IN ('claude_md','skill','hook','command','agent','config')),
  evidence_refs         jsonb NOT NULL, -- {pattern_ids, anti_pattern_ids, session_ids, insight_ids}
  evidence_score        numeric NOT NULL,
  summary               text NOT NULL,
  status                text NOT NULL CHECK (status IN ('queued','in_progress','artifact_ready','dismissed','failed')),
  priority              int NOT NULL DEFAULT 0,
  created_at            timestamptz NOT NULL DEFAULT now(),
  claimed_at            timestamptz,
  claim_expires_at      timestamptz
);
CREATE INDEX idx_sc_queue ON suggestion_candidates(status, priority DESC, created_at)
  WHERE status IN ('queued','in_progress');
```

### `suggestion_artifacts`

Worker output. One per successful generation.

```sql
CREATE TABLE suggestion_artifacts (
  id                 text PRIMARY KEY,
  candidate_id       text NOT NULL REFERENCES suggestion_candidates(id),
  patch              text NOT NULL,           -- unified diff
  files_changed      text[] NOT NULL,
  title              text NOT NULL,
  body               text NOT NULL,
  model              text NOT NULL,
  self_critique      jsonb NOT NULL,          -- {clarity, safety, evidence_fit, reversibility}
  quality_score      numeric NOT NULL,
  status             text NOT NULL CHECK (status IN ('shadow','ready','published','rejected_by_reviewer','failed')),
  github_pr_number   int,
  published_at       timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_sa_pending ON suggestion_artifacts(status, created_at) WHERE status IN ('shadow','ready');
```

### `suggestion_outcomes`

Feedback loop closure.

```sql
CREATE TABLE suggestion_outcomes (
  id                 text PRIMARY KEY,
  artifact_id        text NOT NULL REFERENCES suggestion_artifacts(id) UNIQUE,
  pr_state           text CHECK (pr_state IN ('open','merged','closed_without_merge')),
  merged_at          timestamptz,
  reviewer_verdict   text,              -- 'approved' | 'changes_requested' | 'rejected'
  reviewer_comment   text,              -- top negative comment, if any
  baseline_window    tstzrange,
  post_window        tstzrange,
  baseline_metrics   jsonb,
  post_metrics       jsonb,
  delta              jsonb,
  measured_at        timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);
```

### Additions to existing tables

```sql
ALTER TABLE sessions
  ADD COLUMN git_remote text,
  ADD COLUMN git_branch text,
  ADD COLUMN git_sha text;
CREATE INDEX idx_sessions_remote ON sessions(git_remote) WHERE git_remote IS NOT NULL;
```

## GitHub App

### Registration (one-time)

Create `devscope-bot` GitHub App under the DevScope GitHub org. Store credentials in backend `.env` at `/opt/stacks/devscope/.env`:

- `GITHUB_APP_ID`
- `GITHUB_APP_PRIVATE_KEY` (PEM, base64-encoded for single-line env)
- `GITHUB_WEBHOOK_SECRET`
- `GITHUB_APP_CLIENT_ID` / `GITHUB_APP_CLIENT_SECRET` (for OAuth callback state verification)

### Requested permissions (minimal)

| Permission | Access | Why |
|---|---|---|
| Repository → Contents | read & write | Push branch with patch |
| Repository → Pull requests | read & write | Open/update draft PRs |
| Repository → Metadata | read | List branches, default branch |
| Repository → Issues | read & write | PR comments (PRs are issues) |

Webhook events: `pull_request`, `pull_request_review`, `installation`, `installation_repositories`.

Deliberately not requested: Actions, Secrets, Workflows, Admin, Members. Keeps blast radius tight and install prompt reassuring.

### Install flow

1. Org admin clicks **Connect GitHub** in DevScope dashboard.
2. Redirect to `github.com/apps/devscope-bot/installations/new?state=<signed_org_id>`.
3. Admin picks repos (all or selected).
4. GitHub redirects to `/api/github/install/callback?installation_id=...&state=...`.
5. Backend verifies state signature, lists repos for the installation, writes `repo_installations` rows with `is_live=false`.
6. Admin sees each repo in dashboard with per-repo shadow/live toggle.

### Per-request auth

1. Sign JWT with app private key (10-min TTL).
2. Exchange JWT for installation access token (1-hour TTL, cached in-memory per installation).
3. All Octokit calls use the installation token; never the JWT directly.
4. Tokens auto-rotate on expiry.

### Webhook handling

Single endpoint `POST /api/github/webhook`. First step: verify `X-Hub-Signature-256` HMAC. Reject unsigned or invalid. Then dispatch:

- `pull_request.closed` → upsert `suggestion_outcomes` (pr_state, merged_at, reviewer_comment from most recent negative review).
- `pull_request_review.submitted` → update `suggestion_outcomes.reviewer_verdict`.
- `installation.deleted` → set `repo_installations.suspended_at`.
- `installation_repositories.removed` → suspend rows for removed repos.

Tokens never leave the `github-app` service. The worker writes to `suggestion_artifacts`; the github-app reads and publishes.

## Patch-generation Worker

### Runtime

Bun process in its own container (`devscope-suggestion-worker`) in the compose stack. Single replica at v1. Claims candidates via `UPDATE suggestion_candidates SET status='in_progress', claimed_at=now(), claim_expires_at=now()+interval '10 minutes' WHERE id = (SELECT id FROM suggestion_candidates WHERE status='queued' ORDER BY priority DESC, created_at LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING *`. Postgres-as-queue; no Redis/SQS needed at v1 scale.

### Per-candidate loop

1. **Clone.** Shallow clone at default-branch HEAD into `/tmp/devscope-worker/<artifact_id>/` via installation token over HTTPS.
2. **Build context.** Read all `CLAUDE.md`, `.claude/` tree, `package.json`/`pyproject.toml`, repo layout (top-level + depth-2 dirs). Assemble into a system-prompt bundle with `cache_control: {"type": "ephemeral"}` so repeat runs on the same repo hit Anthropic prompt cache.
3. **Draft.** Claude Sonnet 4.6, tool use enabled. Tools:
   - `read_file(path)` — read any file in the clone
   - `list_dir(path)` — list contents
   - `grep(pattern, glob)` — search
   - `propose_patch(unified_diff, title, body)` — terminal tool, emits the result
   System prompt is kind-specific (six variants, one per `kind`). Input includes the evidence bundle (excerpted session transcripts, pattern summaries, anti-pattern occurrences).
4. **Self-critique.** Claude Opus 4.7. Input = draft patch + evidence. Output = JSON with `{clarity, safety, evidence_fit, reversibility}` each 0–1, plus free-form critique. Compute `quality_score = weighted_sum`.
5. **Gate.** If `quality_score < 0.7` → artifact status `failed`, log, emit metric. Otherwise write `suggestion_artifacts` with `status='shadow'` (or `'ready'` if `repo_installations.is_live=true` and kind not in `auto_open_pr_kinds`).
6. **Cleanup.** Remove `/tmp/devscope-worker/<artifact_id>/` unconditionally.

### Tool discipline

Draft step has read-only tools plus the terminal `propose_patch`. Model cannot shell out, cannot write files, cannot fetch URLs. Emits patch only via the declared tool. Keeps the agent contained.

### Cost controls

- Per-candidate: 200k input tokens / 20k output tokens budget; hard-kill at 2×.
- Per-org: daily USD ceiling in `organization_settings.daily_llm_budget_usd`, default $5.
- Running tally in Redis (or Postgres if we skip Redis at v1); budget exhausted → candidates marked `dismissed` with reason `budget_exceeded` and surface in dashboard.

## Shadow → Live Transition

Three stages per org, per repo:

1. **Shadow mode (default).** Artifacts land as `status='shadow'`. Dashboard "Proposed Changes" tab shows full patch + evidence + "Would you have merged this?" thumbs-up/down. No GitHub access.
2. **Review mode.** Unlocked after 20 shadow approvals with ≥80% thumbs-up. Admin flips `is_live=true`. Artifacts land as `status='ready'`; admin clicks "Open PR" per artifact.
3. **Auto mode.** Per-kind opt-in. Admin adds a kind to `auto_open_pr_kinds`. Artifacts of that kind with `quality_score ≥ auto_threshold` (default 0.85) flow to GitHub as drafts automatically.

All DevScope PRs are **GitHub draft PRs**. Humans flip `ready_for_review` manually.

## Outcome Attribution Loop

**On `pull_request.closed`:**
1. Upsert `suggestion_outcomes` with `pr_state`, `merged_at`, `reviewer_verdict`, `reviewer_comment`.
2. If merged, schedule measurement job for `merged_at + 14 days`.

**Daily measurement job:**
- For each due outcome:
  - Baseline window: `[merged_at - 28d, merged_at]`
  - Post window: `[merged_at + 1d, merged_at + 28d]`
  - Compute repo-scoped session metrics in each window: anti-pattern rate per 100 sessions, retry-loop count, tool diversity, avg session depth, avg quality score.
  - Write `baseline_metrics`, `post_metrics`, `delta`.

**Feedback into the pipeline:**
- **Reject comments** → stored and injected as negative examples into the worker's draft prompt for that `kind`, via prompt caching.
- **Positive delta** → boosts `evidence_score` weighting for source patterns in the promoter.
- **Negative delta** → demotes source pattern weighting.

This is the learning loop. Runs on cron, not in the hot path.

## Error Handling

| Failure | Response |
|---|---|
| Clone fails (auth, deleted repo, private) | Mark candidate `failed`; alert org admin after 3 consecutive failures on same install |
| LLM returns invalid patch (apply dry-run fails) | Retry once with critique as input; if second fails, artifact `failed` |
| Invalid webhook signature | 401, log, no processing |
| Worker crash mid-candidate | `claim_expires_at` TTL (10m) → auto-released by promoter sweep |
| LLM budget exceeded | Candidate `dismissed`, reason surfaced |
| GitHub rate limit | Octokit throttling plugin; github-app backs off automatically |

## Rate Limits

- **1** open PR per repo at a time (next candidate queues until prior PR closes)
- **3** PRs per repo per rolling 7 days
- **10** artifacts generated per org per day (cost cap)
- GitHub API: Octokit built-in throttling, respects secondary rate limits

## Testing Strategy

- **Unit:** promoter SQL rules against fixture data; patch apply-in-sandbox validator; webhook HMAC verification; Octokit client mocked.
- **Integration:** full candidate → artifact → publish path with `nock` or `msw` stubbing the GitHub API; real Postgres seeded from session dumps.
- **Shadow E2E:** run worker against `devscope-cloud` itself for first two weeks post-deploy; every artifact human-rated by Lucas before any external org gets live mode.
- **Golden set:** 20 curated session-pattern → suggestion pairs as the worker regression suite; run on every prompt change.

## Open Questions / Deferred

1. **Patch merge conflicts at publish time.** If the default branch advanced between artifact creation and publish, we rebase the branch server-side and retry. If conflicts remain, mark artifact `failed` and re-enqueue the candidate. Design is sketched; implementation detail for the plan.
2. **Repo-level opt-out of specific kinds.** V1 is all-kinds-on per repo. Per-kind shadow/live toggles deferred to v1.1.
3. **Coaching comments on human-authored PRs** (Q3 option B). V1 covers DevScope-authored PR comments only; commenting on human PRs is a follow-up.
4. **Non-English repos.** Prompts assume English; non-English `CLAUDE.md`s may degrade suggestion quality. Deferred.

## Success Metrics

- **Shadow-mode approval rate ≥ 70%** before any org flips to live.
- **Merge rate of live PRs ≥ 50%** at steady state.
- **Positive `delta` in ≥ 60% of measured outcomes** by month 3 post-launch.
- **Zero security incidents** (leaked tokens, unauthorized writes, PR on non-consented repos) — hard gate.

## Implementation Sequence (for planning phase)

1. Data model migrations + session git-context capture in plugin
2. GitHub App registration + install flow + webhook scaffolding
3. `suggestion-promoter` with fixed rules on existing evidence tables
4. `suggestion-worker` with Claude integration, starting with `CLAUDE.md` kind only
5. Dashboard "Proposed Changes" shadow UI
6. Expand worker to remaining kinds (hook, skill, command, agent, config) one at a time
7. Shadow → live flow + admin controls
8. Outcome attribution job + learning loop feedback
9. Auto-mode opt-in per kind
