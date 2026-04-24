-- GitHub integration: repo installations, suggestion pipeline, outcomes, audit, and
-- plan-amendment tables (organization_settings, artifact_preferences, scheduled_jobs).
-- Spec: docs/superpowers/specs/2026-04-24-github-integration-design.md

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- repo_installations
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS repo_installations (
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

-- ---------------------------------------------------------------------------
-- suggestion_candidates
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS suggestion_candidates (
  id                    text PRIMARY KEY,
  repo_installation_id  text NOT NULL REFERENCES repo_installations(id),
  kind                  text NOT NULL CHECK (kind IN
                          ('claude_md','skill','hook','command','agent','config','remove')),
  evidence_refs         jsonb NOT NULL,
  evidence_score        numeric NOT NULL,
  evidence_breakdown    jsonb NOT NULL,          -- components, see formula in spec
  summary               text NOT NULL,
  status                text NOT NULL CHECK (status IN
                          ('queued','in_progress','artifact_ready','dismissed','failed','stale')),
  priority              int NOT NULL DEFAULT 0,
  suppression_key       text NOT NULL,           -- hash(repo, kind, patch-intent)
  created_at            timestamptz NOT NULL DEFAULT now(),
  claimed_at            timestamptz,
  claim_expires_at      timestamptz
);
CREATE INDEX IF NOT EXISTS idx_sc_queue ON suggestion_candidates(status, priority DESC, created_at)
  WHERE status IN ('queued','in_progress');

-- ---------------------------------------------------------------------------
-- suggestion_artifacts
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS suggestion_artifacts (
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

-- ---------------------------------------------------------------------------
-- suggestion_outcomes
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS suggestion_outcomes (
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

-- ---------------------------------------------------------------------------
-- suppression_ledger
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS suppression_ledger (
  suppression_key       text PRIMARY KEY,
  repo_installation_id  text NOT NULL REFERENCES repo_installations(id),
  kind                  text NOT NULL,
  last_rejected_at      timestamptz NOT NULL,
  rejection_reason      text,              -- reviewer comment, if any
  rejection_count       int NOT NULL DEFAULT 1,
  next_eligible_at      timestamptz NOT NULL
);

-- ---------------------------------------------------------------------------
-- webhook_deliveries (idempotency for GitHub webhook retries)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS webhook_deliveries (
  delivery_id    text PRIMARY KEY,  -- X-GitHub-Delivery header
  event          text NOT NULL,
  received_at    timestamptz NOT NULL DEFAULT now(),
  processed_at   timestamptz
);

-- ---------------------------------------------------------------------------
-- installation_tokens
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS installation_tokens (
  github_install_id  bigint PRIMARY KEY,
  token              text NOT NULL,        -- encrypted at rest (pgcrypto, app-level key)
  expires_at         timestamptz NOT NULL,
  refreshed_at       timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- audit_log
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_log (
  id                    bigserial PRIMARY KEY,
  at                    timestamptz NOT NULL DEFAULT now(),
  actor                 text NOT NULL,        -- 'suggestion-worker' | 'github-app' | user_id | 'system'
  action                text NOT NULL,        -- 'artifact.publish' | 'artifact.dismiss' | 'install.suspend' | ...
  repo_installation_id  text,
  artifact_id           text,
  policy_version        text,                 -- gate rules version hash
  details               jsonb
);
CREATE INDEX IF NOT EXISTS idx_audit_install ON audit_log(repo_installation_id, at DESC);

-- ---------------------------------------------------------------------------
-- sessions: link to git context for candidate generation
-- ---------------------------------------------------------------------------
ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS git_remote text,
  ADD COLUMN IF NOT EXISTS git_branch text,
  ADD COLUMN IF NOT EXISTS git_sha text;
CREATE INDEX IF NOT EXISTS idx_sessions_remote ON sessions(git_remote) WHERE git_remote IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Plan amendments (not in original spec)
-- ---------------------------------------------------------------------------

-- Per-org configuration (daily LLM budget, install gating).
-- Table was created in migration 005 for retention knobs; extend it here.
ALTER TABLE organization_settings
  ADD COLUMN IF NOT EXISTS daily_llm_budget_usd    numeric NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS github_installs_allowed boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS updated_at              timestamptz NOT NULL DEFAULT now();

-- Blind A/B preferences for shadow UI (Task 7.2).
CREATE TABLE IF NOT EXISTS artifact_preferences (
  id                  text PRIMARY KEY,
  artifact_id         text NOT NULL REFERENCES suggestion_artifacts(id) ON DELETE CASCADE,
  user_id             text NOT NULL REFERENCES auth_user(id),
  preferred           text NOT NULL CHECK (preferred IN ('a','b','neither')),
  alternative_source  text,    -- 'library' | 'hand_seeded' | etc. — audit of which alt they compared to
  submitted_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE(artifact_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_ap_artifact ON artifact_preferences(artifact_id);

-- Simple scheduled-job queue (used by webhook handler for persistence checks).
CREATE TABLE IF NOT EXISTS scheduled_jobs (
  id            text PRIMARY KEY,
  job_type      text NOT NULL,     -- 'persistence_check' etc.
  payload       jsonb NOT NULL,
  run_at        timestamptz NOT NULL,
  claimed_at    timestamptz,
  completed_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sj_due ON scheduled_jobs(run_at) WHERE completed_at IS NULL;
