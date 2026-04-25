import type { SQL } from "bun";
import type { SuggestionArtifact, SuggestionArtifactStatus } from "@devscope/shared";
import { insertArtifact } from "../../backend/src/db/suggestionQueries";
import type { SandboxArtifact } from "./sandboxRunner";

/**
 * Persist the sandbox-produced artifact to `suggestion_artifacts`. Failed
 * artifacts ARE written (status='failed') so the dashboard can show why a
 * candidate didn't ship; only the status differs from a passing run.
 *
 * Pass → 'shadow' (will graduate to 'ready' / 'published' downstream).
 * Fail → 'failed' (terminal).
 */
export async function persistArtifact(
  sql: SQL,
  candidateId: string,
  sandbox: SandboxArtifact
): Promise<SuggestionArtifact> {
  const status: SuggestionArtifactStatus =
    sandbox.status === "passed" ? "shadow" : "failed";

  // Failed sandbox runs may not have a meaningful title/body; ensure a
  // non-empty marker so the DB row is still useful for debugging.
  const title = sandbox.title || (sandbox.status === "failed" ? "(sandbox failed)" : "");
  const body = sandbox.body || sandbox.reason || "";

  return insertArtifact(sql, {
    id: crypto.randomUUID(),
    candidateId,
    patch: sandbox.patch,
    filesChanged: sandbox.filesChanged,
    title,
    body,
    model: sandbox.model,
    verificationResults: sandbox.verificationResults,
    status,
  });
}
