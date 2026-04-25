import type { SQL } from "bun";
import type {
  EvidenceBreakdown,
  EvidenceRefs,
  PrState,
  ReviewerVerdict,
  RubricScores,
  SuggestionArtifact,
  SuggestionArtifactStatus,
  SuggestionCandidate,
  SuggestionCandidateStatus,
  SuggestionKind,
  SuggestionOutcome,
  VerificationResult,
} from "@devscope/shared";

// ---------------------------------------------------------------------------
// Row shapes (snake_case) — what Postgres returns. Private to this module.
// ---------------------------------------------------------------------------

interface SuggestionCandidateRow {
  id: string;
  repo_installation_id: string;
  kind: SuggestionKind;
  evidence_refs: EvidenceRefs;
  evidence_score: number;
  evidence_breakdown: EvidenceBreakdown;
  summary: string;
  status: SuggestionCandidateStatus;
  priority: number;
  suppression_key: string;
  created_at: string | Date;
  claimed_at: string | Date | null;
  claim_expires_at: string | Date | null;
}

interface SuggestionArtifactRow {
  id: string;
  candidate_id: string;
  patch: string;
  files_changed: string[];
  title: string;
  body: string;
  model: string;
  verification_results: VerificationResult[];
  rubric_scores: RubricScores | null;
  quality_ranking: number | null;
  status: SuggestionArtifactStatus;
  github_pr_number: number | null;
  github_branch: string | null;
  published_at: string | Date | null;
  created_at: string | Date;
}

interface SuggestionOutcomeRow {
  id: string;
  artifact_id: string;
  pr_state: PrState | null;
  merged_at: string | Date | null;
  reviewer_verdict: ReviewerVerdict | null;
  reviewer_comment: string | null;
  persisted_30d: boolean | null;
  reverted_at: string | Date | null;
  measured_at: string | Date | null;
  created_at: string | Date;
}

function rowToCandidate(row: SuggestionCandidateRow): SuggestionCandidate {
  return {
    id: row.id,
    repoInstallationId: row.repo_installation_id,
    kind: row.kind,
    evidenceRefs: row.evidence_refs,
    evidenceScore: row.evidence_score,
    evidenceBreakdown: row.evidence_breakdown,
    summary: row.summary,
    status: row.status,
    priority: row.priority,
    suppressionKey: row.suppression_key,
    createdAt: row.created_at,
    claimedAt: row.claimed_at,
    claimExpiresAt: row.claim_expires_at,
  };
}

function rowToArtifact(row: SuggestionArtifactRow): SuggestionArtifact {
  return {
    id: row.id,
    candidateId: row.candidate_id,
    patch: row.patch,
    filesChanged: row.files_changed,
    title: row.title,
    body: row.body,
    model: row.model,
    verificationResults: row.verification_results,
    rubricScores: row.rubric_scores,
    qualityRanking: row.quality_ranking,
    status: row.status,
    githubPrNumber: row.github_pr_number,
    githubBranch: row.github_branch,
    publishedAt: row.published_at,
    createdAt: row.created_at,
  };
}

function rowToOutcome(row: SuggestionOutcomeRow): SuggestionOutcome {
  return {
    id: row.id,
    artifactId: row.artifact_id,
    prState: row.pr_state,
    mergedAt: row.merged_at,
    reviewerVerdict: row.reviewer_verdict,
    reviewerComment: row.reviewer_comment,
    persisted30d: row.persisted_30d,
    revertedAt: row.reverted_at,
    measuredAt: row.measured_at,
    createdAt: row.created_at,
  };
}

// ---------------------------------------------------------------------------
// Insert/upsert inputs (camelCase)
// ---------------------------------------------------------------------------

export interface SuggestionCandidateInsert {
  id: string;
  repoInstallationId: string;
  kind: SuggestionKind;
  evidenceRefs: EvidenceRefs;
  evidenceScore: number;
  evidenceBreakdown: EvidenceBreakdown;
  summary: string;
  suppressionKey: string;
  priority?: number;
  status?: SuggestionCandidateStatus;
}

export interface SuggestionArtifactInsert {
  id: string;
  candidateId: string;
  patch: string;
  filesChanged: string[];
  title: string;
  body: string;
  model: string;
  verificationResults: VerificationResult[];
  status: SuggestionArtifactStatus;
  rubricScores?: RubricScores;
  qualityRanking?: number;
}

export interface SuggestionOutcomeUpsert {
  id: string;
  artifactId: string;
  prState?: PrState;
  mergedAt?: string;
  reviewerVerdict?: ReviewerVerdict;
  reviewerComment?: string;
  persisted30d?: boolean;
  revertedAt?: string;
  measuredAt?: string;
}

// ---------------------------------------------------------------------------
// suggestion_candidates
// ---------------------------------------------------------------------------

export async function insertCandidate(
  sql: SQL,
  input: SuggestionCandidateInsert
): Promise<SuggestionCandidate> {
  const evidenceRefs = JSON.stringify(input.evidenceRefs);
  const evidenceBreakdown = JSON.stringify(input.evidenceBreakdown);
  const status: SuggestionCandidateStatus = input.status ?? "queued";
  const priority = input.priority ?? 0;

  const [row] = await sql`
    INSERT INTO suggestion_candidates (
      id, repo_installation_id, kind, evidence_refs, evidence_score,
      evidence_breakdown, summary, status, priority, suppression_key
    )
    VALUES (
      ${input.id}, ${input.repoInstallationId}, ${input.kind},
      ${evidenceRefs}::jsonb, ${input.evidenceScore},
      ${evidenceBreakdown}::jsonb, ${input.summary}, ${status},
      ${priority}, ${input.suppressionKey}
    )
    RETURNING *`;
  return rowToCandidate(row as SuggestionCandidateRow);
}

export async function getCandidate(
  sql: SQL,
  id: string
): Promise<SuggestionCandidate | null> {
  const [row] = await sql`SELECT * FROM suggestion_candidates WHERE id = ${id}`;
  return row ? rowToCandidate(row as SuggestionCandidateRow) : null;
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
  const rows = (await sql`
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
    RETURNING sc.*`) as SuggestionCandidateRow[];
  return rows[0] ? rowToCandidate(rows[0]) : null;
}

// ---------------------------------------------------------------------------
// suggestion_artifacts
// ---------------------------------------------------------------------------

export async function insertArtifact(
  sql: SQL,
  input: SuggestionArtifactInsert
): Promise<SuggestionArtifact> {
  const verification = JSON.stringify(input.verificationResults);
  const rubric = input.rubricScores !== undefined ? JSON.stringify(input.rubricScores) : null;

  const [row] = await sql`
    INSERT INTO suggestion_artifacts (
      id, candidate_id, patch, files_changed, title, body, model,
      verification_results, rubric_scores, quality_ranking, status
    )
    VALUES (
      ${input.id}, ${input.candidateId}, ${input.patch},
      ${input.filesChanged}, ${input.title}, ${input.body}, ${input.model},
      ${verification}::jsonb,
      ${rubric}::jsonb,
      ${input.qualityRanking ?? null},
      ${input.status}
    )
    RETURNING *`;
  return rowToArtifact(row as SuggestionArtifactRow);
}

export async function getArtifact(
  sql: SQL,
  id: string
): Promise<SuggestionArtifact | null> {
  const [row] = await sql`SELECT * FROM suggestion_artifacts WHERE id = ${id}`;
  return row ? rowToArtifact(row as SuggestionArtifactRow) : null;
}

export async function updateArtifactStatus(
  sql: SQL,
  id: string,
  status: SuggestionArtifactStatus,
  opts?: { githubPrNumber?: number; githubBranch?: string; publishedAt?: string }
): Promise<void> {
  // Single statement: status is always set; the optional fields are merged
  // via COALESCE so an absent value preserves the existing column.
  await sql`
    UPDATE suggestion_artifacts SET
      status           = ${status},
      github_pr_number = COALESCE(${opts?.githubPrNumber ?? null}, github_pr_number),
      github_branch    = COALESCE(${opts?.githubBranch ?? null}, github_branch),
      published_at     = COALESCE(${opts?.publishedAt ?? null}::timestamptz, published_at)
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
      ${input.id}, ${input.artifactId}, ${input.prState ?? null},
      ${input.mergedAt ?? null}::timestamptz, ${input.reviewerVerdict ?? null},
      ${input.reviewerComment ?? null}, ${input.persisted30d ?? null},
      ${input.revertedAt ?? null}::timestamptz, ${input.measuredAt ?? null}::timestamptz
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
  return rowToOutcome(row as SuggestionOutcomeRow);
}

export async function getOutcome(
  sql: SQL,
  artifactId: string
): Promise<SuggestionOutcome | null> {
  const [row] = await sql`SELECT * FROM suggestion_outcomes WHERE artifact_id = ${artifactId}`;
  return row ? rowToOutcome(row as SuggestionOutcomeRow) : null;
}
