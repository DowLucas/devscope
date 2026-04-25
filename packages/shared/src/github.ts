// Canonical types for the GitHub integration data model.
// Schema source of truth: packages/backend/src/db/migrations/028_github_integration.sql.
// Convention: camelCase property names; `Date | string` for timestamp columns
// (PG returns Date, JSON serialization round-trips strings).

// ---------------------------------------------------------------------------
// Enums (must match SQL CHECK constraints exactly)
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

export type ReviewerVerdict = "approved" | "changes_requested" | "rejected";

// ---------------------------------------------------------------------------
// Evidence model — see evidence_score formula in the spec.
// ---------------------------------------------------------------------------

/** Five components that combine into evidence_score. */
export interface EvidenceBreakdown {
  breadth: number;
  engineerDiversity: number;
  recency: number;
  consistency: number;
  severity: number;
}

/**
 * IDs the candidate cites as evidence. Each list may be empty; downstream
 * verification dereferences these to confirm the rows still exist.
 */
export interface EvidenceRefs {
  patternIds: string[];
  antiPatternIds: string[];
  sessionIds: string[];
  insightIds: string[];
}

// ---------------------------------------------------------------------------
// Verification & ranking (suggestion_artifacts)
// ---------------------------------------------------------------------------

/** Binary gate. All gates must pass for an artifact to leave 'shadow'. */
export interface VerificationResult {
  gate:
    | "patch_applies"
    | "evidence_dereferences"
    | "kind_scope"
    | "tests"
    | "lint"
    | "conventions";
  pass: boolean;
  reason: string;
}

/** Supplementary 0..1 ranking signals. Not gates — used for ordering only. */
export interface RubricScores {
  clarity?: number;
  evidenceFit?: number;
  reversibility?: number;
}

// ---------------------------------------------------------------------------
// Convention profile (discovered from last 20 merged PRs by a later job)
// ---------------------------------------------------------------------------

export interface ConventionProfile {
  titleFormat?: "conventional_commits" | "ticket_prefix" | "plain";
  branchFormat?: string;
  signOffRequired?: boolean;
  dcoRequired?: boolean;
}

// ---------------------------------------------------------------------------
// repo_installations
// ---------------------------------------------------------------------------

export interface RepoInstallation {
  id: string;
  organizationId: string;
  /**
   * GitHub installation ID. Stored as `bigint` in Postgres; represented as
   * `number` in TS because GitHub installation IDs comfortably fit within
   * JS's safe-integer range (currently ~8 digits).
   */
  githubInstallId: number;
  owner: string;
  repo: string;
  defaultBranch: string;
  cwdPatterns: string[];
  isLive: boolean;
  autoOpenPrKinds: SuggestionKind[];
  conventionProfile: ConventionProfile;
  installedAt: Date | string;
  suspendedAt: Date | string | null;
}

// ---------------------------------------------------------------------------
// suggestion_candidates
// ---------------------------------------------------------------------------

export interface SuggestionCandidate {
  id: string;
  repoInstallationId: string;
  kind: SuggestionKind;
  evidenceRefs: EvidenceRefs;
  evidenceScore: number;
  evidenceBreakdown: EvidenceBreakdown;
  summary: string;
  status: SuggestionCandidateStatus;
  priority: number;
  /** hash(repo, kind, patch-intent) — see spec. */
  suppressionKey: string;
  createdAt: Date | string;
  claimedAt: Date | string | null;
  claimExpiresAt: Date | string | null;
}

// ---------------------------------------------------------------------------
// suggestion_artifacts
// ---------------------------------------------------------------------------

export interface SuggestionArtifact {
  id: string;
  candidateId: string;
  patch: string;
  filesChanged: string[];
  title: string;
  body: string;
  model: string;
  verificationResults: VerificationResult[];
  rubricScores: RubricScores | null;
  qualityRanking: number | null;
  status: SuggestionArtifactStatus;
  /** PR number stored as bigint; safely fits in JS number. */
  githubPrNumber: number | null;
  githubBranch: string | null;
  publishedAt: Date | string | null;
  createdAt: Date | string;
}

// ---------------------------------------------------------------------------
// suggestion_outcomes
// ---------------------------------------------------------------------------

export interface SuggestionOutcome {
  id: string;
  artifactId: string;
  prState: PrState | null;
  mergedAt: Date | string | null;
  reviewerVerdict: ReviewerVerdict | null;
  reviewerComment: string | null;
  /** Ground truth: merged AND no revert AND file still present after 30d. */
  persisted30d: boolean | null;
  revertedAt: Date | string | null;
  measuredAt: Date | string | null;
  createdAt: Date | string;
}

// ---------------------------------------------------------------------------
// suppression_ledger
// ---------------------------------------------------------------------------

export interface SuppressionEntry {
  suppressionKey: string;
  repoInstallationId: string;
  kind: SuggestionKind;
  lastRejectedAt: Date | string;
  rejectionReason: string | null;
  rejectionCount: number;
  nextEligibleAt: Date | string;
}

// ---------------------------------------------------------------------------
// webhook_deliveries (idempotency for GitHub webhook retries)
// ---------------------------------------------------------------------------

export interface WebhookDelivery {
  /** X-GitHub-Delivery header. */
  deliveryId: string;
  event: string;
  receivedAt: Date | string;
  processedAt: Date | string | null;
}

// ---------------------------------------------------------------------------
// audit_log (append-only; intentionally no FKs in SQL)
// ---------------------------------------------------------------------------

export interface AuditEntry {
  id: number;
  at: Date | string;
  /** 'suggestion-worker' | 'github-app' | user_id | 'system' */
  actor: string;
  /** 'artifact.publish' | 'artifact.dismiss' | 'install.suspend' | ... */
  action: string;
  repoInstallationId: string | null;
  artifactId: string | null;
  /** Gate-rules version hash. */
  policyVersion: string;
  details: Record<string, unknown> | null;
}

// ---------------------------------------------------------------------------
// installation_tokens (server-internal; encrypted at rest)
// ---------------------------------------------------------------------------

export interface InstallationToken {
  githubInstallId: number;
  /** Plaintext at the application boundary; encrypted in Postgres via pgcrypto. */
  token: string;
  expiresAt: Date | string;
  refreshedAt: Date | string;
}
