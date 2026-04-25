import type { SQL } from "bun";

// ---------------------------------------------------------------------------
// Append-only audit log. No update/delete by design — preserves history
// across install/org deletion (audit_log has no FKs).
// ---------------------------------------------------------------------------

export type AuditEntryInput = {
  actor: string;
  action: string;
  policy_version: string;
  repo_installation_id?: string;
  artifact_id?: string;
  details?: Record<string, unknown>;
};

export type AuditEntry = {
  id: number;
  at: string;
  actor: string;
  action: string;
  repo_installation_id: string | null;
  artifact_id: string | null;
  policy_version: string;
  details: Record<string, unknown> | null;
};

export async function insertAuditEntry(
  sql: SQL,
  input: AuditEntryInput
): Promise<AuditEntry> {
  const details = input.details !== undefined ? JSON.stringify(input.details) : null;
  const [row] = await sql`
    INSERT INTO audit_log (
      actor, action, repo_installation_id, artifact_id, policy_version, details
    )
    VALUES (
      ${input.actor}, ${input.action},
      ${input.repo_installation_id ?? null}, ${input.artifact_id ?? null},
      ${input.policy_version},
      ${details}::jsonb
    )
    RETURNING *`;
  return row as AuditEntry;
}
