# DevScope GitHub Integration — Design Spec

**Status:** Approved for planning (revised 2026-04-24 after critique)
**Date:** 2026-04-24
**Author:** Lucas + Claude

## Context

DevScope analyzes Claude Code sessions and currently produces insights, patterns, anti-patterns, and playbooks in its database (693 sessions, 619 insights, 64 playbooks at spec time). Findings live in the dashboard and stop there. This spec defines how DevScope becomes an active participant in the repos it observes: reading connected GitHub repositories, proposing changes to `CLAUDE.md`, skills, hooks, commands, subagents, config hygiene — and removals of each — as draft PRs, then measuring whether those suggestions survive in the codebase.

This is the first of three linked sub-projects. AI pipeline hardening and agentic-loop orchestration are separate specs.

## Goals

1. **Close the observe → learn → ship loop** within hours of a session ending.
2. **Earn trust before acting.** Shadow mode by default; promotion to live requires behavioral evidence (not survey thumbs-up).
3. **Survive adversarial verification.** Every artifact passes binary, load-bearing gates (patch applies, evidence checks out, scope honored, tests green, lint passes, conventions match) before it can be published.
4. **Measure ground truth, not noise.** V1 outcome metric is "merged and persisted 30 days without revert." Delta-attribution is deferred until we can do it with counterfactuals.
5. **Multi-tenant from day one** with per-task sandbox isolation.

## Non-goals

- Auto-merge or direct commits to protected branches.
- Reviewing human-authored PRs (future product surface).
- GitLab, Bitbucket, or self-hosted SCM.
- Real-time PR generation during a session (minutes-latency is fine).
- Counterfactual impact attribution via session replay (powerful, but v1.5+ — see Deferred Directions).

## Decisions

| # | Decision | Rationale |
|---|---|---|
| 1 | Multi-tenant GitHub App from day one | Clean auth, extends to customers |
| 2 | Actions: read analysis + PR comments + draft PRs | No auto-merge, no direct commits |
| 3 | Triggers: session-ended + manual dashboard button | Fresh-context PRs + admin-initiated |
| 4 | Suggestion kinds: `claude_md`, `skill`, `hook`, `command`, `agent`, `config`, `remove` (subtractive) | Full coverage including pruning |
| 5 | Repo linkage: git remote auto-detect + admin `cwd_patterns` override | 95% auto, escape hatch |
| 6 | Quality gate: binary adversarial verification + blind-preference shadow mode | Non-gameable, non-rubric |
| 7 | V1 ground truth: persistence at 30 days post-merge, no revert, file still present | Defensible attribution without causal claim |
| 8 | LLM: Claude Sonnet 4.6 for draft; **no** self-critique gate; Opus rubric is a ranking signal only | Adversarial checks, not theater |
| 9 | Per-task sandboxed workers with egress allowlist | Multi-tenant safety from v1 |
| 10 | PR authored-as the triggering user (co-author-by) with session reference in body | Flips trust dynamic; cheap; large effect |

## Architecture

```
 plugin (user machine)
   │  session events (+ git remote, branch, sha)
   ▼
 backend/api ──► Postgres
   │             ├─ existing: sessions, events, ai_insights, session_patterns,
   │             │  anti_patterns, playbooks, workflow_profiles, ...
   │             └─ new: repo_installations, installation_tokens,
   │                suggestion_candidates, suggestion_artifacts,
   │                suggestion_outcomes, suppression_ledger,
   │                webhook_deliveries, audit_log
   │
   ▼
 suggestion-promoter (cron q15min + session-end nudge)
   │   SQL + rules; no LLM calls
   │   evidence threshold + suppression check → suggestion_candidates
   ▼
 suggestion-worker  (Postgres-queue consumer)
   │   claim candidate with 10-min lease
   │   revalidate evidence (< 72h stale)
   │   spawn per-task sandbox container
   │     └─ clone repo, run agent draft, run verification gates
   │   write suggestion_artifacts(status='shadow'|'ready'|'failed')
   │   teardown sandbox
   ▼
 github-app (stateless Octokit shim)
   │   installation tokens from Postgres (not memory)
   │   PR create/update/close, webhook verify + dedupe,
   │   rebase-on-publish, outcome capture
   ▼
 GitHub
```

Three new services, each one clear job. A fourth boundary — the **per-task sandbox** — is implemented as short-lived Docker containers spawned by the worker, not a standing service.

### Service boundaries

**`suggestion-promoter`** — SQL + rules. No LLM. Cheap, deterministic, easy to test.

**`suggestion-worker`** — the agentic core. Manages sandbox lifecycle; does not itself execute untrusted code. Writes to Postgres; never touches GitHub.

**`github-app`** — thin Octokit wrapper. Stateless aside from Postgres-backed token cache. Only trusts artifacts with `status='ready'` AND `repo_installations.is_live=true`.

**Per-task sandbox** — ephemeral Docker container per candidate. Separate non-root UID, tmpfs workspace, network egress allowlist (`api.anthropic.com`, `api.github.com`, `<installation-token>@github.com` for clone only). Torn down unconditionally at job end. No cross-tenant shared filesystem.

## Data Model

### `repo_installations`

```sql
CREATE TABLE repo_installations (
  id                   text PRIMARY KEY,
  organization_id      text NOT NULL REFERENCES organization(id),
  github_install_id    bigint NOT NULL,
  owner                text NOT NULL,
  repo                 text NOT NULL,
  default_branch       text NOT NULL,
  cwd_patterns         text[] NOT NULL DEFAULT '{}',
  is_live              boolean NOT NULL DEFAULT false,
  auto_open_pr_kinds   text[] NOT NULL DEFAULT '{}',
  convention_profile   jsonb NOT NULL DEFAULT '{}'::jsonb, -- discovered from last 20 merged PRs
  installed_at         timestamptz NOT NULL DEFAULT now(),
  suspended_at         timestamptz,
  UNIQUE(github_install_id, owner, repo)
);
```

`convention_profile` is populated on install and refreshed weekly: commit message style, PR title format (conventional commits / plain / ticket-prefix), DCO required, sign-off, branch naming. Consumed by the worker so generated PRs don't fail format checks.

### `suggestion_candidates`

```sql
CREATE TABLE suggestion_candidates (
  id                    text PRIMARY KEY,
  repo_installation_id  text NOT NULL REFERENCES repo_installations(id),
  kind                  text NOT NULL CHECK (kind IN
                          ('claude_md','skill','hook','command','agent','config','remove')),
  evidence_refs         jsonb NOT NULL,
  evidence_score        numeric NOT NULL,
  evidence_breakdown    jsonb NOT NULL,          -- components, see formula below
  summary               text NOT NULL,
  status                text NOT NULL CHECK (status IN
                          ('queued','in_progress','artifact_ready','dismissed','failed','stale')),
  priority              int NOT NULL DEFAULT 0,
  suppression_key       text NOT NULL,           -- hash(repo, kind, patch-intent)
  created_at            timestamptz NOT NULL DEFAULT now(),
  claimed_at            timestamptz,
  claim_expires_at      timestamptz
);
CREATE INDEX idx_sc_queue ON suggestion_candidates(status, priority DESC, created_at)
  WHERE status IN ('queued','in_progress');
```

**`evidence_score` formula (v1).** Weighted sum, each component 0..1:

```
evidence_score =
    0.30 * log1p(distinct_session_count) / log1p(20)       -- breadth
  + 0.25 * log1p(distinct_user_count)    / log1p(5)        -- engineer diversity
  + 0.25 * recency_weight(latest_event)                    -- half-life 14 days
  + 0.10 * consistency(pattern_across_sessions)            -- 1 - variance of signals
  + 0.10 * severity_weight(anti_pattern.severity)          -- critical > warning > info
```

`evidence_breakdown` stores each component value, so a `0.82` candidate from "hot-and-narrow" (1 user, 15 sessions) vs "broad-and-cold" (10 users, 2 sessions) is distinguishable later. Promotion rules (kind-specific) can require minimum thresholds per component — e.g., `claude_md` kind requires `distinct_user_count >= 2` to filter out idiosyncratic noise.

**Suppression.** `suppression_key = sha256(repo_installation_id || kind || normalized_intent)`. Before enqueue, promoter checks `suppression_ledger` — if the same key was rejected in the last 60 days, candidate is dismissed unless evidence_score has grown by >50% since the rejection.

### `suggestion_artifacts`

```sql
CREATE TABLE suggestion_artifacts (
  id                     text PRIMARY KEY,
  candidate_id           text NOT NULL REFERENCES suggestion_candidates(id),
  patch                  text NOT NULL,
  files_changed          text[] NOT NULL,
  title                  text NOT NULL,
  body                   text NOT NULL,
  model                  text NOT NULL,
  verification_results   jsonb NOT NULL, -- binary gates; see worker section
  rubric_scores          jsonb,          -- supplementary; not a gate
  quality_ranking        numeric,        -- used for ordering only
  status                 text NOT NULL CHECK (status IN
                           ('shadow','ready','published','rejected_by_reviewer','failed','superseded')),
  github_pr_number       int,
  github_branch          text,
  published_at           timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now()
);
```

### `suggestion_outcomes`

V1 is simple: track publish, merge, persistence. No pre/post-metric deltas.

```sql
CREATE TABLE suggestion_outcomes (
  id                    text PRIMARY KEY,
  artifact_id           text NOT NULL REFERENCES suggestion_artifacts(id) UNIQUE,
  pr_state              text CHECK (pr_state IN ('open','merged','closed_without_merge')),
  merged_at             timestamptz,
  reviewer_verdict      text,               -- 'approved' | 'changes_requested' | 'rejected'
  reviewer_comment      text,
  persisted_30d         boolean,            -- ground truth: merged AND no revert AND file still present
  reverted_at           timestamptz,
  measured_at           timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now()
);
```

Counterfactual impact measurement is explicitly deferred — see Deferred Directions.

### `suppression_ledger`

```sql
CREATE TABLE suppression_ledger (
  suppression_key       text PRIMARY KEY,
  repo_installation_id  text NOT NULL REFERENCES repo_installations(id),
  kind                  text NOT NULL,
  last_rejected_at      timestamptz NOT NULL,
  rejection_reason      text,              -- reviewer comment, if any
  rejection_count       int NOT NULL DEFAULT 1,
  next_eligible_at      timestamptz NOT NULL
);
```

Also serves as a negative-example bank for the worker's prompt.

### `webhook_deliveries`

Idempotency for GitHub webhook retries.

```sql
CREATE TABLE webhook_deliveries (
  delivery_id    text PRIMARY KEY,  -- X-GitHub-Delivery header
  event          text NOT NULL,
  received_at    timestamptz NOT NULL DEFAULT now(),
  processed_at   timestamptz
);
```

Handler's first SQL statement is `INSERT ... ON CONFLICT DO NOTHING RETURNING`. If no row inserted, webhook is a replay — 200 OK, no processing.

### `installation_tokens`

```sql
CREATE TABLE installation_tokens (
  github_install_id  bigint PRIMARY KEY,
  token              text NOT NULL,        -- encrypted at rest (pgcrypto, app-level key)
  expires_at         timestamptz NOT NULL,
  refreshed_at       timestamptz NOT NULL DEFAULT now()
);
```

Survives restarts, shareable across workers, refreshed lazily on expiry.

### `audit_log`

```sql
CREATE TABLE audit_log (
  id                    bigserial PRIMARY KEY,
  at                    timestamptz NOT NULL DEFAULT now(),
  actor                 text NOT NULL,        -- 'suggestion-worker' | 'github-app' | user_id | 'system'
  action                text NOT NULL,        -- 'artifact.publish' | 'artifact.dismiss' | 'install.suspend' | ...
  repo_installation_id  text,
  artifact_id           text,
  policy_version        text,                 -- gate rules version hash
  details               jsonb
);
CREATE INDEX idx_audit_install ON audit_log(repo_installation_id, at DESC);
```

First question from any customer security review. Every write to a customer repo logs actor + policy version + evidence refs.

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

Create `devscope-bot` under the DevScope GitHub org. Store in `/opt/stacks/devscope/.env`:

- `GITHUB_APP_ID`
- `GITHUB_APP_PRIVATE_KEY` (PEM, base64 single-line)
- `GITHUB_WEBHOOK_SECRET`

### Requested permissions

| Permission | Access | Why |
|---|---|---|
| Repository → Contents | read & write | Push branch with patch |
| Repository → Pull requests | read & write | Open/update draft PRs |
| Repository → Metadata | read | Branches, default branch, convention discovery |
| Repository → Issues | read & write | PR comments |

Events: `pull_request`, `pull_request_review`, `installation`, `installation_repositories`.

Explicitly not requested: Actions, Secrets, Workflows, Admin, Members.

### Install flow

1. Admin clicks Connect GitHub in dashboard.
2. Redirect to `github.com/apps/devscope-bot/installations/new?state=<signed_org_id>`.
3. GitHub callback → `/api/github/install/callback`.
4. Backend verifies state signature, lists repos, writes `repo_installations` (`is_live=false`, `convention_profile={}`).
5. Async job: discover conventions from last 20 merged PRs per repo, populate `convention_profile`.

### Per-request auth

JWT (10-min) → installation token (1-hour, Postgres-backed) → Octokit. Token rotation lazy, encrypted at rest.

### Webhook handling

`POST /api/github/webhook` — verify `X-Hub-Signature-256`. Dedupe via `webhook_deliveries`. Dispatch:

- `pull_request.closed` → upsert `suggestion_outcomes` with pr_state, merged_at, reviewer_comment.
- `pull_request_review.submitted` → `reviewer_verdict`.
- `installation.deleted` → `repo_installations.suspended_at`.
- `installation_repositories.removed` → suspend matching rows.

## Suggestion Worker (agentic core)

### Runtime + sandbox

Bun process, claims candidates via `SELECT FOR UPDATE SKIP LOCKED`. For each claim:

1. **Revalidate.** Re-query the evidence. If the pattern's occurrence count in the last 72h is 0, mark candidate `stale` and release. If `suppression_ledger` now has this key, mark `dismissed`.
2. **Spawn sandbox.** `docker run --rm --network=devscope-egress-allowlist --read-only --tmpfs /work --user 1000:1000 --cap-drop=ALL --memory=2g --pids-limit=256 devscope/worker-sandbox:<pinned-sha> ...` — one container per candidate, isolated filesystem, network allowlist at Docker network level (Anthropic API + GitHub API + nothing else). Clone target repo inside the sandbox using the installation token.
3. **Build context.** All `CLAUDE.md`, `.claude/` tree, manifest files, top-level layout, `convention_profile`. Attach with `cache_control: {"type": "ephemeral", "ttl": "1h"}` (1-hour variant so repeat runs on same repo within a candidate batch hit cache).
4. **Agent draft.** Claude Sonnet 4.6, tools: `read_file`, `list_dir`, `grep`, `propose_patch`. Kind-specific system prompt. Negative-example bank from `suppression_ledger` for this repo+kind injected into the prompt.
5. **Verification gates** (each binary, all required — see below).
6. **Rubric scoring** (supplementary, for ranking among passing artifacts — not a gate).
7. **Write artifact.** Status `shadow` (default) or `ready` (if `is_live`) or `failed` (verification fail).
8. **Teardown sandbox.** Unconditional.

### Verification gates (load-bearing, binary)

| Gate | Check |
|---|---|
| **Patch applies** | `git apply --check` against current HEAD succeeds. If HEAD advanced since clone, rebase once; if conflicts, fail. |
| **Evidence dereferences** | Every session/pattern/insight ID in `evidence_refs` exists in DB and matches claimed strings (e.g., if the agent quoted a session tool call, the quote must be found verbatim in the session transcript). |
| **Kind scope** | Touched files fall within the kind's allowed paths. `claude_md` kind only touches `**/CLAUDE.md`. `skill` kind only touches `.claude/skills/**`. `remove` kind only deletes, never adds. Enforced by matching `files_changed` against a per-kind allowlist. |
| **Tests (best-effort)** | If `package.json` has a `test` script with known-fast runner (vitest, jest, bun test), run it in sandbox with patch applied. Timeout 3 min. Fail on test regression. Skip if no detectable runner. |
| **Lint / format** | If `eslint`/`prettier`/`ruff`/`gofmt` config detected, run it. Fail on new lint errors in touched files only (don't penalize pre-existing). |
| **Conventions** | Generated PR title matches `convention_profile.title_format`. Branch name matches `convention_profile.branch_format`. Commit signed-off if required. |

Any gate failure → artifact `failed`, results written to `verification_results`, no retry beyond the rebase-once inside gate 1.

### Rubric (not a gate)

Optional Opus call producing `{clarity, evidence_fit, reversibility}` per artifact. Used only to order artifacts in the dashboard for human review and to break ties when multiple candidates compete for the single open PR slot. Never a pass/fail gate — the critique model rubber-stamps plausible patches and can't be trusted with publishing authority.

### PR framing

Title: kind-appropriate, conventional-commit-formatted when required. Example: `chore(claude): add Railway env check to prevent retry loop (DevScope)`.

Body template:
```
Your Claude Code session(s) hit this pattern:

• 2026-04-21 14:32 — <pattern summary> — failed 3x
• 2026-04-22 09:15 — same pattern

DevScope's suggestion:
<short rationale>

Evidence: <links to DevScope dashboard for cited sessions>
Verification: patch applies, tests pass, lint clean, convention match.

---
Co-authored-by: <triggering user via mapped GitHub handle>
🤖 Opened by DevScope. [Provide feedback](...)
```

Attribution-to-user is a cheap UX win with disproportionate effect: the reader expects a generic bot and finds their own friction mirrored back. `user_developer_link` already maps DevScope user → GitHub handle where available; fall back to an anonymized session id when not.

### Cost controls

- Per-candidate: 200k input / 20k output; hard kill 2×.
- Per-org daily USD ceiling in `organization_settings.daily_llm_budget_usd` (default $5). Running tally in Postgres. Exceeded → candidate `dismissed`, surfaced in dashboard.
- Policy-based budget auto-scaling is Deferred Direction #8.

## Shadow → Live Transition

V1 gate is **behavioral, not survey**.

1. **Shadow mode (default).** Artifacts land `shadow`. Dashboard shows the patch alongside a **blind preference** — DevScope's patch vs a hand-written alternative for the same candidate, unlabeled, admin picks which they'd merge (or "neither"). Alternative is produced from the negative-example library for the same kind, or hand-seeded during bootstrap.
2. **Review mode.** Unlocked after ≥10 candidates where DevScope's patch was preferred AND the admin subsequently landed a commit on their own repo addressing the same friction (fuzzy match on touched files + kind). Preference alone is not enough — an actual commit is the behavioral signal. Admin flips `is_live=true` per repo.
3. **Auto mode.** Per-kind opt-in. `auto_open_pr_kinds` array on `repo_installations`. Artifact must pass all gates and rank in top quartile of historical rubric for that kind.

All DevScope PRs open as **GitHub draft**. Humans flip `ready_for_review`.

## Outcome Attribution (v1 — persistence only)

**On `pull_request.closed` (merged):**
1. Schedule persistence check at `merged_at + 30d`.

**Persistence check job:**
- Merge commit still in default branch? (no revert, no force-push over it)
- Files from `files_changed` still present?
- If yes → `persisted_30d = true`. Ground truth positive.
- If no → `persisted_30d = false`, `reverted_at` populated. Ground truth negative, feeds suppression.

**Feedback into pipeline:**
- Rejected PR comments → `suppression_ledger.rejection_reason`, injected into worker prompt as negative examples for that kind.
- `persisted_30d = false` → suppression extended, evidence-score recency weight dampened for source pattern.
- `persisted_30d = true` → source pattern gets a small recurrence bonus in the promoter.

No pre/post metric deltas. No causal attribution. That's the v1.5 project — see Deferred Directions #1.

## Error Handling

| Failure | Response |
|---|---|
| Clone fails (auth, deleted, private) | Candidate `failed`. 3 consecutive failures on same install → admin alert. |
| Invalid patch at generation | Single retry with critique in prompt. Second failure → artifact `failed`. |
| Invalid patch at publish (HEAD advanced) | Rebase once server-side. Conflict → re-enqueue candidate, `superseded` old artifact. |
| Verification gate fails | Artifact `failed`, gate result logged. No retry. |
| Invalid webhook signature | 401, log, no state change. |
| Duplicate webhook | Dedupe table short-circuits, 200 OK. |
| Worker crash mid-candidate | `claim_expires_at` TTL (10m) auto-releases. |
| Sandbox escape attempt | Impossible by construction (network allowlist, read-only FS, non-root, no caps); any anomaly alerts + quarantines install. |
| LLM budget exhausted | Candidate `dismissed`, reason surfaced. |

## Rate Limits + Lifecycle

- **1** open DevScope PR per repo at a time; next candidate queues.
- **3** DevScope PRs per repo per 7 days.
- **10** artifacts generated per org per day.
- **Max open PR age: 30 days.** After 30 days with no review activity, auto-close with a polite comment ("DevScope closed this due to inactivity; the pattern may recur — we'll re-propose if evidence reappears"). Suppression key bumped.
- Octokit throttling plugin respects primary + secondary GitHub rate limits.

## Audit + Security

- Every write to a customer repo → `audit_log` row: actor, action, policy_version (hash of gate ruleset), evidence_refs, artifact_id. Retained indefinitely.
- Installation tokens encrypted at rest (pgcrypto with an app-level key from env).
- Sandbox network policy enforced at Docker network level — container cannot reach anything but the allowlisted hosts; no egress fallback.
- Clone URLs use installation token in URL, never written to disk (passed to `git` via stdin/env).
- Webhook secret rotated on GitHub App secret rotation; multiple active secrets supported during rotation windows.

## Testing Strategy

- **Unit:** promoter rule SQL against fixture sessions; `evidence_score` formula against known distributions; verification gates (patch applier, evidence deref, kind-scope); webhook HMAC + dedupe; convention discovery.
- **Integration:** candidate → sandbox → artifact → publish with mocked Octokit (`msw`), real Postgres seeded from a session dump.
- **Sandbox smoke:** a malicious fixture repo (attempts curl to evil.example, attempts write outside `/work`, attempts fork-bomb) must be fully contained. CI gate.
- **Shadow E2E:** worker runs against `devscope-cloud` for 2 weeks post-deploy. Every artifact rated by Lucas against a hand-written alternative (blind). This is the bootstrap for the behavioral live gate.
- **Golden set:** 20 curated (session-pattern → suggestion) pairs as regression suite. Re-run on every prompt change. Gate any prompt change on golden-set non-regression.

## Deferred Directions (v1.5+)

These are the moves that change what kind of product DevScope is. Captured now so we don't forget.

1. **Session replay as counterfactual.** Before shipping any `claude_md` change, replay the N most-recent sessions on the repo through Claude with the proposed CLAUDE.md and measure predicted delta in pattern/anti-pattern rate. Offline evaluation per suggestion + causally-grounded deltas. This replaces the pre/post metric math that v1 explicitly drops. Highest-leverage single move after v1 ships.
2. **Just-in-time intervention.** Plugin injects a transient skill/CLAUDE.md override at session start based on user+repo anti-pattern profile. Promotes to a permanent PR only if the session-scoped override proves valuable. Shifts the loop latency from "hours" to "zero." Natural A/B: intervened vs matched non-intervened sessions.
3. **Cross-org pattern federation.** Hash pattern signatures, find nearest neighbors across orgs anonymously, surface "this resembles 4 patterns solved by other teams" with a generalized template. Source fixes never leave source org. Turns DevScope into the pattern-knowledge layer of Claude Code.
4. **Skill marketplace.** Automatic extraction of generalizable skills across the fleet, stripped of org-specifics, offered as installable templates with evidence attached ("adopted by 14 orgs, median retry-loop reduction X"). Distribution infrastructure, not just suggestion bot.
5. **Variant A/B in shadow mode.** Per-candidate 2–3 variants with different framings/scopes; blind-displayed to different reviewers; preference deltas inform prompt design. Online learning over suggestion-design itself.
6. **Retirement loop for past suggestions.** Track DevScope's own previously-accepted suggestions; if evidence has gone cold, propose removal. Self-pruning keeps surface area small. `remove` kind is implemented in v1; the automated triggering of retirement candidates is deferred.
7. **Policy-based budget allocation.** Budget auto-scales with measured persistence rate per org. Earning trust → more runway. Not delivering → throttled. No human tuning.
8. **Claude Code as reviewer-side pre-digester.** When DevScope opens a PR, the customer's Claude Code session can pre-review against their full repo context and summarize for the human. Reduces reviewer cognitive cost; uses Claude Code as a trust bridge.
9. **Multi-session pattern clustering.** Cluster related sessions across user+repo+time+semantic-similarity; emit candidates on cluster events, not single sessions. Catches cross-session friction.
10. **Commit-style attribution.** Instead of single triggering session, attribute PRs to the cluster of sessions across the team that surfaced the pattern. Reflects the reality of distributed engineering friction.

## Success Metrics (v1)

- **Blind-preference rate for DevScope patches ≥ 60%** vs hand-written alternatives in shadow mode.
- **Merge rate of live PRs ≥ 50%.**
- **`persisted_30d = true` rate ≥ 70%** of merged PRs.
- **Zero security incidents.** Hard gate. Any sandbox escape, token leak, or unauthorized write triggers full live-mode suspension across all orgs pending RCA.
- **Zero multi-tenant data leakage incidents.** Hard gate.

## Implementation Sequence (input to planning phase)

1. Data model migrations + plugin git-context capture + webhook dedupe table + audit log table.
2. GitHub App registration + install flow + `installation_tokens` table + Postgres-backed token caching + webhook scaffolding.
3. Sandbox container image + Docker egress-allowlist network + smoke tests (malicious fixture).
4. `suggestion-promoter` with `evidence_score` formula + suppression ledger.
5. `suggestion-worker` v1 skeleton: claim → sandbox spawn → clone → agent draft → verification gates → teardown. Start with `claude_md` kind only.
6. Convention discovery job + `convention_profile` population.
7. Dashboard Proposed Changes UI with blind A/B preference.
8. Expand worker to remaining kinds one at a time (`hook`, `skill`, `command`, `agent`, `config`, `remove`).
9. Live-mode flow (behavioral gate: preference + own-commit match).
10. Outcome persistence job + suppression feedback.
11. Auto-mode opt-in per kind.
