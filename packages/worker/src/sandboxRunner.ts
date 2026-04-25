import type { SuggestionCandidate, VerificationResult } from "@devscope/shared";

/**
 * What `runSandbox` returns. Intentionally _not_ a `SuggestionArtifact` —
 * the sandbox produces the verification + patch payload; `persistArtifact`
 * decorates it with the DB-side fields (id, candidate_id, model, status
 * coercion to `shadow` vs `failed`).
 */
export interface SandboxArtifact {
  /** Unified diff produced by the sandbox. May be empty when status=failed. */
  patch: string;
  /** Files touched by `patch` (parsed for the DB row + PR body). */
  filesChanged: string[];
  /** Suggested PR title (sandbox-authored). */
  title: string;
  /** Suggested PR body (sandbox-authored). */
  body: string;
  /** Model identifier the sandbox used (e.g. "claude-opus-4-7"). */
  model: string;
  /** Each verification gate's pass/fail + reason. */
  verificationResults: VerificationResult[];
  /**
   * The sandbox's own verdict. `passed` → persistArtifact stores `shadow`.
   * `failed` → persistArtifact stores `failed` (the artifact still goes in,
   * for auditability and debugging).
   */
  status: "passed" | "failed";
  /** Human-readable explanation when `status === 'failed'`. */
  reason?: string;
}

/**
 * STUB for Task 5.2. Returns a hardcoded `failed` artifact noting that the
 * real sandbox runner has not been implemented yet. This keeps the main loop
 * end-to-end exercisable while Task 5.2 builds the actual Docker spawn.
 */
export async function runSandbox(
  _candidate: SuggestionCandidate
): Promise<SandboxArtifact> {
  return {
    patch: "",
    filesChanged: [],
    title: "",
    body: "",
    model: "stub",
    verificationResults: [],
    status: "failed",
    reason: "sandbox not implemented (Task 5.2)",
  };
}
