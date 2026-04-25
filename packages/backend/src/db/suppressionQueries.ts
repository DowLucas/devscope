import type { SQL } from "bun";

// ---------------------------------------------------------------------------
// Inline minimal type. Task 1.4 will replace with @devscope/shared import.
// ---------------------------------------------------------------------------

export type SuppressionEntry = {
  suppression_key: string;
  repo_installation_id: string;
  kind: string;
  last_rejected_at: string;
  rejection_reason: string | null;
  rejection_count: number;
  next_eligible_at: string;
};

export type SuppressionUpsertInput = {
  suppression_key: string;
  repo_installation_id: string;
  kind: string;
  /** ISO timestamp at which the suggestion may be reconsidered. */
  next_eligible_at: string;
  rejection_reason?: string;
};

export async function getSuppression(
  sql: SQL,
  suppressionKey: string
): Promise<SuppressionEntry | null> {
  const [row] = await sql`
    SELECT * FROM suppression_ledger
    WHERE suppression_key = ${suppressionKey}`;
  return (row as SuppressionEntry) ?? null;
}

/**
 * Insert a new suppression entry, or — if one exists — bump the rejection
 * count, refresh `last_rejected_at`, and extend `next_eligible_at` to the
 * later of the existing value and the proposed one (never shrink the
 * cooldown). This is a single statement, so it is concurrency-safe.
 */
export async function upsertSuppression(
  sql: SQL,
  input: SuppressionUpsertInput
): Promise<SuppressionEntry> {
  await sql`
    INSERT INTO suppression_ledger (
      suppression_key, repo_installation_id, kind,
      last_rejected_at, rejection_reason, rejection_count, next_eligible_at
    )
    VALUES (
      ${input.suppression_key}, ${input.repo_installation_id}, ${input.kind},
      NOW(), ${input.rejection_reason ?? null}, 1, ${input.next_eligible_at}::timestamptz
    )
    ON CONFLICT (suppression_key) DO UPDATE SET
      last_rejected_at = NOW(),
      rejection_reason = COALESCE(EXCLUDED.rejection_reason, suppression_ledger.rejection_reason),
      rejection_count  = suppression_ledger.rejection_count + 1,
      next_eligible_at = GREATEST(suppression_ledger.next_eligible_at, EXCLUDED.next_eligible_at)`;

  const [row] = await sql`
    SELECT * FROM suppression_ledger WHERE suppression_key = ${input.suppression_key}`;
  return row as SuppressionEntry;
}
