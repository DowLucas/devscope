import type { SQL } from "bun";
import type { AuditEntry } from "@devscope/shared";

// ---------------------------------------------------------------------------
// Append-only audit log. No update/delete by design — preserves history
// across install/org deletion (audit_log has no FKs).
// ---------------------------------------------------------------------------

// Row shape (snake_case) returned by Postgres. Private to this module.
interface AuditEntryRow {
  id: number;
  at: string | Date;
  actor: string;
  action: string;
  repo_installation_id: string | null;
  artifact_id: string | null;
  policy_version: string;
  details: Record<string, unknown> | null;
}

function rowToAuditEntry(row: AuditEntryRow): AuditEntry {
  return {
    id: row.id,
    at: row.at,
    actor: row.actor,
    action: row.action,
    repoInstallationId: row.repo_installation_id,
    artifactId: row.artifact_id,
    policyVersion: row.policy_version,
    details: row.details,
  };
}

export interface AuditEntryInput {
  actor: string;
  action: string;
  policyVersion: string;
  repoInstallationId?: string;
  artifactId?: string;
  details?: Record<string, unknown>;
}

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
      ${input.repoInstallationId ?? null}, ${input.artifactId ?? null},
      ${input.policyVersion},
      ${details}::jsonb
    )
    RETURNING *`;
  return rowToAuditEntry(row as AuditEntryRow);
}
