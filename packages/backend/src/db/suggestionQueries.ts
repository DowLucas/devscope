import type { SQL } from "bun";

// ---------------------------------------------------------------------------
// Inline minimal types. Task 1.4 will replace these with @devscope/shared imports.
// ---------------------------------------------------------------------------

export type SuggestionKind =
  | "claude_md"
  | "skill"
  | "hook"
  | "command"
  | "agent"
  | "config"
  | "remove";

export type SuggestionCandidateStatus =
  | "queued"
  | "in_progress"
  | "artifact_ready"
  | "dismissed"
  | "failed"
  | "stale";

export type SuggestionArtifactStatus =
  | "shadow"
  | "ready"
  | "published"
  | "rejected_by_reviewer"
  | "failed"
  | "superseded";

export type PrState = "open" | "merged" | "closed_without_merge";

export type SuggestionCandidate = {
  id: string;
  repo_installation_id: string;
  kind: SuggestionKind;
  evidence_refs: unknown;
  evidence_score: number;
  evidence_breakdown: unknown;
  summary: string;
  status: SuggestionCandidateStatus;
  priority: number;
  suppression_key: string;
  created_at: string;
  claimed_at: string | null;
  claim_expires_at: string | null;
};

export type SuggestionCandidateInsert = {
  id: string;
  repo_installation_id: string;
  kind: SuggestionKind;
  evidence_refs: unknown;
  evidence_score: number;
  evidence_breakdown: unknown;
  summary: string;
  suppression_key: string;
  priority?: number;
  status?: SuggestionCandidateStatus;
};

export type SuggestionArtifact = {
  id: string;
  candidate_id: string;
  patch: string;
  files_changed: string[];
  title: string;
  body: string;
  model: string;
  verification_results: unknown;
  rubric_scores: unknown | null;
  quality_ranking: number | null;
  status: SuggestionArtifactStatus;
  github_pr_number: number | null;
  github_branch: string | null;
  published_at: string | null;
  created_at: string;
};

export type SuggestionArtifactInsert = {
  id: string;
  candidate_id: string;
  patch: string;
  files_changed: string[];
  title: string;
  body: string;
  model: string;
  verification_results: unknown;
  status: SuggestionArtifactStatus;
  rubric_scores?: unknown;
  quality_ranking?: number;
};

export type SuggestionOutcome = {
  id: string;
  artifact_id: string;
  pr_state: PrState | null;
  merged_at: string | null;
  reviewer_verdict: string | null;
  reviewer_comment: string | null;
  persisted_30d: boolean | null;
  reverted_at: string | null;
  measured_at: string | null;
  created_at: string;
};

export type SuggestionOutcomeUpsert = {
  id: string;
  artifact_id: string;
  pr_state?: PrState;
  merged_at?: string;
  reviewer_verdict?: string;
  reviewer_comment?: string;
  persisted_30d?: boolean;
  reverted_at?: string;
  measured_at?: string;
};

// ---------------------------------------------------------------------------
// suggestion_candidates
// ---------------------------------------------------------------------------

export async function insertCandidate(
  sql: SQL,
  input: SuggestionCandidateInsert
): Promise<SuggestionCandidate> {
  const evidenceRefs = JSON.stringify(input.evidence_refs);
  const evidenceBreakdown = JSON.stringify(input.evidence_breakdown);
  const status: SuggestionCandidateStatus = input.status ?? "queued";
  const priority = input.priority ?? 0;

  const [row] = await sql`
    INSERT INTO suggestion_candidates (
      id, repo_installation_id, kind, evidence_refs, evidence_score,
      evidence_breakdown, summary, status, priority, suppression_key
    )
    VALUES (
      ${input.id}, ${input.repo_installation_id}, ${input.kind},
      ${evidenceRefs}::jsonb, ${input.evidence_score},
      ${evidenceBreakdown}::jsonb, ${input.summary}, ${status},
      ${priority}, ${input.suppression_key}
    )
    RETURNING *`;
  return row as SuggestionCandidate;
}

export async function getCandidate(
  sql: SQL,
  id: string
): Promise<SuggestionCandidate | null> {
  const [row] = await sql`SELECT * FROM suggestion_candidates WHERE id = ${id}`;
  return (row as SuggestionCandidate) ?? null;
}

export async function updateCandidateStatus(
  sql: SQL,
  id: string,
  status: SuggestionCandidateStatus
): Promise<void> {
  await sql`UPDATE suggestion_candidates SET status = ${status} WHERE id = ${id}`;
}

/**
 * Atomically claim the next queued candidate. Uses
 * `UPDATE … FROM (SELECT … FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`
 * so concurrent workers never claim the same row.
 */
export async function claimNextCandidate(
  sql: SQL
): Promise<SuggestionCandidate | null> {
  const rows = await sql`
    UPDATE suggestion_candidates sc
    SET status = 'in_progress',
        claimed_at = NOW(),
        claim_expires_at = NOW() + INTERVAL '10 minutes'
    FROM (
      SELECT id FROM suggestion_candidates
      WHERE status = 'queued'
      ORDER BY priority DESC, created_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    ) picked
    WHERE sc.id = picked.id
    RETURNING sc.*`;
  const list = rows as SuggestionCandidate[];
  return list[0] ?? null;
}

// ---------------------------------------------------------------------------
// suggestion_artifacts
// ---------------------------------------------------------------------------

export async function insertArtifact(
  sql: SQL,
  input: SuggestionArtifactInsert
): Promise<SuggestionArtifact> {
  const verification = JSON.stringify(input.verification_results);
  const rubric = input.rubric_scores !== undefined ? JSON.stringify(input.rubric_scores) : null;

  const [row] = await sql`
    INSERT INTO suggestion_artifacts (
      id, candidate_id, patch, files_changed, title, body, model,
      verification_results, rubric_scores, quality_ranking, status
    )
    VALUES (
      ${input.id}, ${input.candidate_id}, ${input.patch},
      ${input.files_changed}, ${input.title}, ${input.body}, ${input.model},
      ${verification}::jsonb,
      ${rubric}::jsonb,
      ${input.quality_ranking ?? null},
      ${input.status}
    )
    RETURNING *`;
  return row as SuggestionArtifact;
}

export async function getArtifact(
  sql: SQL,
  id: string
): Promise<SuggestionArtifact | null> {
  const [row] = await sql`SELECT * FROM suggestion_artifacts WHERE id = ${id}`;
  return (row as SuggestionArtifact) ?? null;
}

export async function updateArtifactStatus(
  sql: SQL,
  id: string,
  status: SuggestionArtifactStatus,
  opts?: { github_pr_number?: number; github_branch?: string; published_at?: string }
): Promise<void> {
  // Single statement: status is always set; the optional fields are merged
  // via COALESCE so an absent value preserves the existing column.
  await sql`
    UPDATE suggestion_artifacts SET
      status           = ${status},
      github_pr_number = COALESCE(${opts?.github_pr_number ?? null}, github_pr_number),
      github_branch    = COALESCE(${opts?.github_branch ?? null}, github_branch),
      published_at     = COALESCE(${opts?.published_at ?? null}::timestamptz, published_at)
    WHERE id = ${id}`;
}

// ---------------------------------------------------------------------------
// suggestion_outcomes
// ---------------------------------------------------------------------------

export async function upsertOutcome(
  sql: SQL,
  input: SuggestionOutcomeUpsert
): Promise<SuggestionOutcome> {
  const [row] = await sql`
    INSERT INTO suggestion_outcomes (
      id, artifact_id, pr_state, merged_at, reviewer_verdict,
      reviewer_comment, persisted_30d, reverted_at, measured_at
    )
    VALUES (
      ${input.id}, ${input.artifact_id}, ${input.pr_state ?? null},
      ${input.merged_at ?? null}::timestamptz, ${input.reviewer_verdict ?? null},
      ${input.reviewer_comment ?? null}, ${input.persisted_30d ?? null},
      ${input.reverted_at ?? null}::timestamptz, ${input.measured_at ?? null}::timestamptz
    )
    ON CONFLICT (artifact_id) DO UPDATE SET
      pr_state         = COALESCE(EXCLUDED.pr_state, suggestion_outcomes.pr_state),
      merged_at        = COALESCE(EXCLUDED.merged_at, suggestion_outcomes.merged_at),
      reviewer_verdict = COALESCE(EXCLUDED.reviewer_verdict, suggestion_outcomes.reviewer_verdict),
      reviewer_comment = COALESCE(EXCLUDED.reviewer_comment, suggestion_outcomes.reviewer_comment),
      persisted_30d    = COALESCE(EXCLUDED.persisted_30d, suggestion_outcomes.persisted_30d),
      reverted_at      = COALESCE(EXCLUDED.reverted_at, suggestion_outcomes.reverted_at),
      measured_at      = COALESCE(EXCLUDED.measured_at, suggestion_outcomes.measured_at)
    RETURNING *`;
  return row as SuggestionOutcome;
}

export async function getOutcome(
  sql: SQL,
  artifactId: string
): Promise<SuggestionOutcome | null> {
  const [row] = await sql`SELECT * FROM suggestion_outcomes WHERE artifact_id = ${artifactId}`;
  return (row as SuggestionOutcome) ?? null;
}
